// ingress.mjs - `starci app stack ingress plan|attach|takeover`: the Swarm ingress becomes the SHARED ingress (80/443) of the VPS.
// The other tenants (plain docker compose systems on the same host) are reached over an attachable overlay network.
//   plan      read-only. Reads the dynamic route files of the OLD compose edge over ssh and compares their hosts with the declaration
//             (declared upstreams + the app's own routes file). Any live host the declaration does not cover is a refusal (ok false).
//   attach    --execute: creates the attachable overlay network if missing and connects every upstream container to it (idempotent).
//   takeover  --execute: the cutover switch. All preconditions must pass or NOTHING changes; every host is probed on the old edge and on
//             the new ingress (probe ports) BEFORE anything stops; then the old edge is stopped, the swarm ingress service is forced to
//             rebind the freed ports and every host is verified on 443. Any failure after the stop triggers the AUTOMATIC FALLBACK
//             (scale the swarm ingress to 0, start the old edge, re-verify it).
// Everything remote goes through the ssh runner (remote.mjs) as `docker ...` or `curl ...` strings built only from validated pieces
// (names, hosts, ports and paths are validated by stack-ingress-config.mjs; every argument is shell-quoted). Route files can carry
// header values or tokens: they are parsed in memory and ONLY host names and service origins (scheme://host:port) are ever printed.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { byCodeUnit } from '../runtime/engine/by-code-unit.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import type { BackupBlock, DeployConfig, IngressConfig, IngressLegacy, IngressUpstream, IngressVerify } from './config.mjs';
import { firstLine } from './context.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import { remoteDocker, shellQuote, withRunner } from './remote.mjs';
import type { ActionResult, Runner, RunnerDeps } from './remote.mjs';
import { createIngress } from './ingress-create.mjs';
import { publishIngress } from './ingress-publish.mjs';

/** A host (and path) the takeover proves, with the status the declaration expects (null: whatever the baseline answered). */
export type Target = IngressVerify;
/** What 127.0.0.1:<port> serves for one host: the HTTP status (0 = connection or TLS error) and the certificate serial and subject. */
export interface Observation { code: number; certificate: string | null }
/** The old edge's answer for one target. */
export interface Baseline extends Observation { target: Target; ok: boolean }
/** Replica state of a swarm service. */
export interface ServiceState { exists: boolean; desired: number; running: number }
/** One precondition: its name, whether it holds and what to do when it does not. */
export interface Check { name: string; ok: boolean; detail: string | undefined }
/** The probe helpers the publish action shares with the takeover. */
export interface PublishKit {
  readRecipient(repoRoot: string): string;
  stampOf(epochMs: number): string;
  observe(run: Runner, target: Target, port?: number): Observation;
  baselines(run: Runner, targets: Target[]): Baseline[];
  settle: typeof settle;
  serviceState(run: Runner, name: string): ServiceState;
  liveCommand(dir: string): string;
  targets(config: DeployConfig, ingress: IngressConfig): Target[];
}

type IngressAction = 'plan' | 'attach' | 'create' | 'takeover' | 'rehearse' | 'publish';
/** What `ingress` takes. */
export interface IngressOptions { action?: string | undefined; execute?: boolean; args?: string[]; sshCmd?: string | null }

interface RouteEntry { host: string; targets: string[] }
interface OwnRoutes { routes: RouteEntry[]; middlewares: string[] }
interface LiveFiles { routes: RouteEntry[]; files: string[]; unparsable: string[]; error?: undefined }
interface ContainerState { present: boolean; attached: boolean }
type NetworkState = 'missing' | 'wrong' | 'ok';
interface Gathered {
  declared: Map<string, string>;
  liveHosts: Map<string, string[]>;
  live: LiveFiles;
  own: OwnRoutes;
  missing: string[];
  declaredNotLive: string[];
  badMiddlewares: string[];
  containers: Record<string, ContainerState>;
  network: NetworkState;
  certificates: boolean;
  error?: undefined;
}
/** An ingress known to declare its encrypted backup directory. */
type BackedIngress = IngressConfig & { backup: { dir: string } };
const declaresBackup = (ingress: IngressConfig): ingress is BackedIngress => ingress.backup !== null;
/** The image, arguments and mount targets of the live ingress service that the rehearsal copies. */
interface IngressSpec { image: string; args: string[]; dynamicTarget: string; acmeTarget: string }
/** What the rehearsal created, to tear down. */
interface Created { volume: boolean; service: boolean }
/** One host compared on the rehearsal ports. */
interface RehearsalRow { target: Target; live: number; code?: number; sameCertificate?: boolean; skipped: boolean; ok: boolean }

const MATCHER = /(Host|HostRegexp)\(([^)]*)\)/gu;
const QUOTED = /`([^`]*)`/gu;
const FILE_MARK = /^#@@FILE (.+)$/mu;
const SETTLE_ATTEMPTS = 6;
const SETTLE_MS = 2000;
const START_ATTEMPTS = 6;
const AGE_RECIPIENT = /age1[0-9a-z]{50,}/u;
const MOUNTPOINT = /^\/[A-Za-z0-9._/-]+$/u;

const asMap = (value: unknown): Record<string, unknown> => (plain(value) ? (value as Record<string, unknown>) : {});
const sorted = (items: Iterable<string>): string[] => [...items].sort(byCodeUnit);
const originOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[unparsed]';
  }
};

// ---- the live and the declared routes -------------------------------------------------------------------------------------------

/** Host keys of a proxy router rule: `a.example` for Host(...), `regexp:<pattern>` for HostRegexp(...). */
function hostsOfRule(rule: unknown): string[] {
  const out: string[] = [];
  for (const [, kind = '', args = ''] of String(rule).matchAll(MATCHER)) {
    for (const [, value = ''] of args.matchAll(QUOTED)) out.push(kind === 'Host' ? value.toLowerCase() : `regexp:${value}`);
  }
  return out;
}

/** { routes: [{ host, targets }], middlewares: [name] } of one parsed file-provider dynamic document (any shape is tolerated). */
function routesOfDocument(doc: unknown): OwnRoutes {
  const http = asMap(asMap(doc).http);
  const services = asMap(http.services);
  const targetsOf = (name: unknown): string[] => {
    const servers = asMap(asMap(services[String(name).split('@')[0] as string]).loadBalancer).servers;
    return (Array.isArray(servers) ? servers : []).map((server) => originOf(String(asMap(server).url)));
  };
  const routes = Object.values(asMap(http.routers)).flatMap((router): RouteEntry[] => {
    const own = asMap(router);
    const targets = typeof own.service === 'string' ? targetsOf(own.service) : [];
    return hostsOfRule(own.rule ?? '').map((host) => ({ host, targets }));
  });
  return { routes, middlewares: Object.keys(asMap(http.middlewares)) };
}

function liveCommand(dir: string): string {
  const loop = String.raw`for f in *.yml *.yaml; do if [ -f "$f" ]; then printf '#@@FILE %s\n' "$f"; cat "$f"; echo; fi; done`;
  return `cd ${shellQuote(dir)} && ${loop}`;
}

/** Reads every route file of the old edge: { routes, files, unparsable }. */
function readLive(run: Runner, legacy: IngressLegacy): LiveFiles | { error: string } {
  const result = run(liveCommand(legacy.dynamicDir));
  if (result.status !== 0) return { error: `cannot read ${legacy.dynamicDir} on the manager: ${firstLine(result.stderr)}` };
  const parts = String(result.stdout).split(FILE_MARK);
  const live: LiveFiles = { routes: [], files: [], unparsable: [] };
  for (let index = 1; index < parts.length; index += 2) {
    const name = parts[index] as string;
    live.files.push(name);
    try {
      live.routes.push(...routesOfDocument(parseYaml(parts[index + 1] as string)).routes);
    } catch {
      live.unparsable.push(name);
    }
  }
  return live;
}

/** The app's own routes file (relative to the environment dir): { routes, middlewares } or an empty set. */
function readOwnRoutes(config: DeployConfig, ingress: IngressConfig): OwnRoutes {
  if (ingress.routes === null) return { routes: [], middlewares: [] };
  try {
    return routesOfDocument(parseYaml(fs.readFileSync(path.join(config.envDir, ingress.routes), 'utf8')));
  } catch {
    throw refusal('STACK_INGRESS_ROUTES', `cannot read ${ingress.routes} (deploy.ingress.routes) as YAML`);
  }
}

/** Declared host -> where it is declared (`upstream <name>` or `routes file`). */
function declaredHosts(ingress: IngressConfig, own: OwnRoutes): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of own.routes) out.set(entry.host, 'routes file');
  for (const host of ingress.drop) out.set(host, 'dropped');
  for (const entry of ingress.redirects) out.set(entry.host, `redirect to ${entry.to}`);
  for (const entry of ingress.upstreams) for (const host of entry.hosts) out.set(host, `upstream ${entry.name}`);
  return out;
}

function undeclaredMiddlewares(ingress: IngressConfig, own: OwnRoutes): string[] {
  const known = new Set([...Object.keys(ingress.middlewares), ...own.middlewares]);
  return ingress.upstreams.flatMap((entry) => entry.middlewares.filter((name) => !known.has(name)).map((name) => `${name} (upstream ${entry.name})`));
}

// ---- docker probes over ssh ---------------------------------------------------------------------------------------------------

function containerState(run: Runner, container: string, network: string): ContainerState {
  const inspect = remoteDocker(run, ['inspect', '--type', 'container', '--format', '{{.State.Running}}|{{json .NetworkSettings.Networks}}', container]);
  if (inspect.status !== 0) return { present: false, attached: false };
  const [running, json = 'null'] = String(inspect.stdout).trim().split(/\|(.*)/su);
  let networks: unknown = null;
  try { networks = JSON.parse(json); } catch { networks = null; }
  return { present: running === 'true', attached: plain(networks) && Object.hasOwn(networks as object, network) };
}

/** 'missing' | 'wrong' (exists, not an attachable overlay) | 'ok'. */
function networkState(run: Runner, network: string): NetworkState {
  const inspect = remoteDocker(run, ['network', 'inspect', '--format', '{{.Driver}} {{.Attachable}}', network]);
  if (inspect.status !== 0) return 'missing';
  return String(inspect.stdout).trim() === 'overlay true' ? 'ok' : 'wrong';
}

const onOverlay = (ingress: IngressConfig): IngressUpstream[] => ingress.upstreams.filter((entry) => entry.container !== null);

const volumePresent = (run: Runner, volume: string): boolean => remoteDocker(run, ['volume', 'inspect', volume]).status === 0;

// ---- plan ---------------------------------------------------------------------------------------------------------------------------

function gather(run: Runner, config: DeployConfig, ingress: IngressConfig): Gathered | { error: string } {
  const own = readOwnRoutes(config, ingress);
  const live = readLive(run, ingress.legacy);
  if (live.error !== undefined) return { error: live.error };
  const declared = declaredHosts(ingress, own);
  const liveHosts = new Map<string, string[]>();
  for (const entry of live.routes) liveHosts.set(entry.host, sorted(new Set([...(liveHosts.get(entry.host) ?? []), ...entry.targets])));
  const containers = Object.fromEntries(onOverlay(ingress).map((entry): [string, ContainerState] => [entry.container as string, containerState(run, entry.container as string, ingress.network)])); // onOverlay keeps only entries with a container
  return {
    declared, liveHosts, live, own,
    missing: sorted([...liveHosts.keys()].filter((host) => !declared.has(host))),
    declaredNotLive: sorted([...declared.keys()].filter((host) => !liveHosts.has(host))),
    badMiddlewares: undeclaredMiddlewares(ingress, own),
    containers,
    network: networkState(run, ingress.network),
    certificates: volumePresent(run, ingress.acmeVolume),
  };
}

function containerText(state: ContainerState): string {
  if (!state.present) return 'MISSING or not running';
  return state.attached ? 'running, attached' : 'running, not attached';
}

function planLines(ingress: IngressConfig, found: Gathered): string[] {
  const lines = [`live edge files: ${found.live.files.length === 0 ? 'none' : found.live.files.join(', ')}`];
  for (const file of found.live.unparsable) lines.push(`WARNING ${file} is not valid YAML: its routes could not be compared`);
  for (const host of sorted(found.liveHosts.keys())) {
    const state = found.declared.has(host) ? `declared (${found.declared.get(host)})` : 'NOT DECLARED';
    lines.push(`live ${host} -> ${(found.liveHosts.get(host) ?? []).join(', ') || '(no target)'}: ${state}`);
  }
  for (const host of found.declaredNotLive) lines.push(`declared, not live yet: ${host} (${found.declared.get(host)})`);
  for (const name of found.badMiddlewares) lines.push(`middleware ${name} is declared nowhere`);
  for (const [name, state] of Object.entries(found.containers)) {
    lines.push(`container ${name}: ${containerText(state)}`);
  }
  lines.push(`network ${ingress.network}: ${found.network}`, `certificates volume ${ingress.acmeVolume}: ${found.certificates ? 'present' : 'MISSING'}`);
  return lines;
}

const planOk = (found: Gathered): boolean => found.missing.length === 0 && found.badMiddlewares.length === 0 && found.live.unparsable.length === 0;

function planResult(ingress: IngressConfig, found: Gathered): ActionResult {
  const lines = planLines(ingress, found);
  const ok = planOk(found);
  if (found.missing.length > 0) lines.push(`REFUSED: ${found.missing.length} live host(s) not covered by the declaration: ${found.missing.join(', ')}`);
  lines.push(ok ? 'plan green: every live host is covered' : 'plan NOT green');
  const data = {
    ok, steps: ['plan'], live: sorted(found.liveHosts.keys()), declared: sorted(found.declared.keys()), missing: found.missing,
    declaredNotLive: found.declaredNotLive, badMiddlewares: found.badMiddlewares, unparsable: found.live.unparsable,
    containers: found.containers, network: found.network, certificates: found.certificates,
  };
  return { ok, lines, data };
}

function planAction(run: Runner, config: DeployConfig, ingress: IngressConfig): ActionResult {
  const found = gather(run, config, ingress);
  if (found.error !== undefined) return { ok: false, lines: [found.error], data: { ok: false, steps: ['plan'], error: found.error } };
  return planResult(ingress, found);
}

// ---- attach -------------------------------------------------------------------------------------------------------------------------

function attachFailure(lines: string[], steps: string[], message: string): ActionResult {
  lines.push(message);
  return { ok: false, lines, data: { ok: false, steps } };
}

function connectArgs(ingress: IngressConfig, entry: IngressUpstream): string[] {
  return ['network', 'connect', ...entry.aliases.flatMap((alias) => ['--alias', alias]), '--gw-priority', '-1', ingress.network, entry.container as string];
}

/** Connects every upstream container; stops at the first failed command. */
function connectAll(run: Runner, ingress: IngressConfig, pending: IngressUpstream[], lines: string[], steps: string[]): ActionResult | null {
  for (const entry of pending) {
    const done = remoteDocker(run, connectArgs(ingress, entry));
    if (done.status !== 0) return attachFailure(lines, steps, `connect ${entry.container} to ${ingress.network} FAILED: ${firstLine(done.stderr)}`);
    steps.push(`connect:${entry.container}`);
    lines.push(`connected ${entry.container} to ${ingress.network} (aliases ${entry.aliases.join(', ')})`);
  }
  return null;
}

/** Creates the overlay when it is missing (execute) or says it would; returns a failure result or null. */
function ensureNetwork(run: Runner, ingress: IngressConfig, { network, execute, lines, steps }: { network: NetworkState; execute: boolean; lines: string[]; steps: string[] }): ActionResult | null {
  if (network !== 'missing') return null;
  if (!execute) {
    lines.push(`dry run: would create the attachable overlay network ${ingress.network}`);
    return null;
  }
  const created = remoteDocker(run, ['network', 'create', '--driver', 'overlay', '--attachable', ingress.network]);
  if (created.status !== 0) return attachFailure(lines, steps, `creating ${ingress.network} FAILED: ${firstLine(created.stderr)}`);
  steps.push('network-create');
  lines.push(`created the attachable overlay network ${ingress.network}`);
  return null;
}

function attachAction(run: Runner, ingress: IngressConfig, execute: boolean): ActionResult {
  const lines: string[] = [];
  const steps: string[] = [];
  const states = onOverlay(ingress).map((entry) => ({ entry, state: containerState(run, entry.container as string, ingress.network) })); // onOverlay keeps only entries with a container
  const absent = states.filter(({ state }) => !state.present).map(({ entry }) => entry.container);
  if (absent.length > 0) return attachFailure(lines, steps, `upstream container(s) missing or not running: ${absent.join(', ')}; nothing was changed`);
  const network = networkState(run, ingress.network);
  if (network === 'wrong') return attachFailure(lines, steps, `network ${ingress.network} exists but is not an attachable overlay; nothing was changed`);
  const pending = states.filter(({ state }) => !state.attached).map(({ entry }) => entry);
  for (const { entry, state } of states) if (state.attached) lines.push(`${entry.container} is already on ${ingress.network}: skipped`);
  const failedNetwork = ensureNetwork(run, ingress, { network, execute, lines, steps });
  if (failedNetwork) return failedNetwork;
  const done = { ok: true, lines, data: { ok: true, steps, network, pending: pending.map((entry) => entry.container) } };
  if (!execute) {
    for (const entry of pending) lines.push(`dry run: would connect ${entry.container} to ${ingress.network} (aliases ${entry.aliases.join(', ')})`);
    return done;
  }
  return connectAll(run, ingress, pending, lines, steps) ?? done;
}

// ---- takeover: probes ---------------------------------------------------------------------------------------------------------------

/** The hosts to prove: the declared `verify` list or every plain declared host that is not dropped (path /). */
function targetsOf(ingress: IngressConfig, declared: Map<string, string>): Target[] {
  if (ingress.verify.length > 0) return ingress.verify;
  const plainHosts = [...declared.entries()].filter(([host, where]) => !host.startsWith('regexp:') && where !== 'dropped').map(([host]) => host);
  return sorted(plainHosts).map((host) => ({ host, path: '/', status: null }));
}

const bashScript = (script: string): string => `bash -c ${shellQuote(script)}`;

/** The URL and the Host stay exactly as in production (a redirect rule that matches on the URL must see the same text): an alternate port is reached with --connect-to, never by putting the port in the URL. */
function statusCommand(target: Target, port: number): string {
  const route = port === 443 ? ['--resolve', `${target.host}:443:127.0.0.1`] : ['--connect-to', `${target.host}:443:127.0.0.1:${port}`];
  const args = ['-sS', '--max-time', '10', ...route, '-o', '/dev/null', '-w', '%{http_code}', `https://${target.host}${target.path}`];
  return `curl ${args.map(shellQuote).join(' ')}`;
}

function certificateCommand(target: Target, port: number): string {
  const connect = ['openssl', 's_client', '-connect', `127.0.0.1:${port}`, '-servername', target.host].map(shellQuote).join(' ');
  return bashScript(`printf '' | ${connect} 2>/dev/null | openssl x509 -noout -serial -subject`);
}

/** What 127.0.0.1:<port> serves for one host: the HTTP status (0 = connection or TLS error) and the certificate serial and subject (public data). */
function observe(run: Runner, target: Target, port = 443): Observation {
  const status = run(statusCommand(target, port));
  const code = String(status.stdout).trim();
  const certificate = run(certificateCommand(target, port));
  const text = String(certificate.stdout).trim();
  return {
    code: status.status === 0 && /^\d{3}$/u.test(code) ? Number(code) : 0,
    certificate: certificate.status === 0 && text !== '' ? text : null,
  };
}

const label = (target: Target): string => `${target.host}${target.path}`;
const answers = (code: number): boolean => code >= 200 && code < 500;

/**
 * The old edge is the baseline: it must answer every host and present a certificate, and whatever it answers IS the expectation of the takeover (the new
 * ingress serves the same dynamic directory, so every host must answer exactly the same). The declared `verify.status` values describe the state AFTER
 * `ingress publish` (for example a 308 redirect that only the app's own routes file creates) and are judged by publish and by `stack verify`.
 */
function baselines(run: Runner, targets: Target[]): Baseline[] {
  return targets.map((target) => {
    const seen = observe(run, target);
    return { target, ...seen, ok: answers(seen.code) && seen.certificate !== null };
  });
}

/** Runs `check` until it is ok or the attempts are used up, sleeping between attempts. */
async function settle<T extends { ok: boolean }>(ctx: Pick<StackContext, 'sleep'>, attempts: number, intervalMs: number, check: () => T | Promise<T>): Promise<T> {
  const last = await check();
  if (last.ok || attempts <= 1) return last;
  await ctx.sleep(intervalMs);
  return settle(ctx, attempts - 1, intervalMs, check);
}

/** Every host answers the baseline status and presents the baseline certificate (retried while the edge boots). */
function matchBaseline(ctx: Pick<StackContext, 'sleep'>, run: Runner, base: Baseline[]): Promise<{ ok: boolean; rows: { target: Target; code: number; ok: boolean }[] }> {
  return settle(ctx, SETTLE_ATTEMPTS, SETTLE_MS, () => {
    const rows = base.map((entry) => {
      const seen = observe(run, entry.target);
      return { target: entry.target, code: seen.code, ok: seen.code === entry.code && seen.certificate === entry.certificate };
    });
    return { ok: rows.every((row) => row.ok), rows };
  });
}

const mismatches = (rows: { target: Target; code: number; ok: boolean }[]): string => rows.filter((row) => !row.ok).map((row) => `${label(row.target)}=${row.code}`).join(', ');

// ---- takeover: backup ---------------------------------------------------------------------------------------------------------------

/** The first age recipient of the creation_rules of <repoRoot>/.sops.yaml (the custody's own public recipient). */
function readRecipient(repoRoot: string): string {
  let rules: unknown;
  try { rules = parseYaml(fs.readFileSync(path.join(repoRoot, '.sops.yaml'), 'utf8'))?.creation_rules; } catch { rules = null; }
  const found = AGE_RECIPIENT.exec(JSON.stringify(rules ?? null));
  if (!found) throw refusal('STACK_INGRESS_RECIPIENT', 'no age recipient found in the creation_rules of .sops.yaml');
  return found[0];
}

const stampOf = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '').replace('T', '-');

function archiveStep(run: Runner, { source, file, recipient, dir }: { source: string; file: string; recipient: string; dir: string }): string | null {
  const steps = [
    `mkdir -p ${shellQuote(dir)}`,
    `sudo -n tar -cf - -C ${shellQuote(source)} . | age -r ${shellQuote(recipient)} -o ${shellQuote(file)}`,
    `test -s ${shellQuote(file)}`,
  ];
  const done = run(bashScript(`set -o pipefail; umask 077; ${steps.join(' && ')}`));
  return done.status === 0 ? null : firstLine(done.stderr);
}

/** Age-encrypted copies of the certificates store and of the dynamic directory, made ON the manager: { files } or { error }. */
function backupStores(ctx: Pick<StackContext, 'now'>, run: Runner, ingress: BackedIngress, recipient: string): { error: string; files?: undefined } | { files: string[]; error?: undefined } {
  const mount = remoteDocker(run, ['volume', 'inspect', '--format', '{{.Mountpoint}}', ingress.acmeVolume]);
  const mountpoint = String(mount.stdout).trim();
  if (mount.status !== 0 || !MOUNTPOINT.test(mountpoint)) return { error: `cannot locate the volume ${ingress.acmeVolume}` };
  const { dir } = ingress.backup;
  const stamp = stampOf(ctx.now());
  const jobs = [
    { source: mountpoint, file: `${dir}/acme-${stamp}.tar.age` },
    { source: ingress.legacy.dynamicDir, file: `${dir}/dynamic-${stamp}.tar.age` },
  ];
  for (const job of jobs) {
    const reason = archiveStep(run, { ...job, recipient, dir });
    if (reason !== null) return { error: `backup ${job.file} FAILED: ${reason}` };
  }
  return { files: jobs.map((job) => job.file) };
}

// ---- takeover: preconditions --------------------------------------------------------------------------------------------------------

const serviceName = (ingress: IngressConfig): string => `${ingress.name}_${ingress.service}`;

/** { exists, desired, running } of a swarm service from the service listing (desired = the replica count the service is set to). */
function serviceState(run: Runner, name: string): ServiceState {
  const listed = remoteDocker(run, ['service', 'ls', '--filter', `name=${name}`, '--format', '{{.Name}} {{.Replicas}}']);
  const row = String(listed.stdout).split('\n').map((line) => line.trim().split(' ')).find(([found]) => found === name);
  if (listed.status !== 0 || !row) return { exists: false, desired: -1, running: -1 };
  const [running, desired] = String(row[1]).split('/').map(Number) as [number, number];
  return { exists: true, desired, running };
}

function preconditions(run: Runner, ingress: IngressConfig, found: Gathered): Check[] {
  const swarm = remoteDocker(run, ['info', '--format', '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}']);
  const service = serviceState(run, serviceName(ingress));
  const detached = Object.entries(found.containers).filter(([, state]) => !state.attached).map(([name]) => name);
  const checks: [string, boolean, string][] = [
    ['plan green', planOk(found), `${found.missing.length} live host(s) not covered`],
    ['swarm active (manager)', swarm.status === 0 && String(swarm.stdout).trim() === 'active true', 'this host is not an active swarm manager'],
    [`swarm service ${serviceName(ingress)} exists with 0 replicas (host-mode ports bind only when a task starts)`, service.exists && service.desired === 0, 'create it with replicas 0 first'],
    [`network ${ingress.network} is an attachable overlay`, found.network === 'ok', `network state: ${found.network}`],
    ['every upstream container attached', detached.length === 0, `not attached: ${detached.join(', ')}`],
    [`certificates volume ${ingress.acmeVolume} present`, found.certificates, 'the persisted certificates volume is missing'],
  ];
  return checks.map(([name, ok, detail]) => ({ name, ok, detail }));
}

// ---- takeover: the switch -----------------------------------------------------------------------------------------------------------

const dockerLine = (args: string[]): string => ['docker', ...args.map(shellQuote)].join(' ');

/** Waits until 127.0.0.1:443 accepts a TCP connection (every 100 ms, at most gateSeconds). */
const tcpLoop = (gateSeconds: number): string => bashScript(`for i in $(seq 1 ${gateSeconds * 10}); do if (exec 3<>/dev/tcp/127.0.0.1/443) 2>/dev/null; then exit 0; fi; sleep 0.1; done; exit 1`);

/** T0: stop the old edge and start the ingress in one remote command; then wait for 443 and prove every host. Returns { failure, gapMs }. */
async function swap(ctx: Pick<StackContext, 'now' | 'sleep'>, run: Runner, ingress: IngressConfig, base: Baseline[]): Promise<{ failure: string | null; gapMs: number }> {
  const gateMs = ingress.takeover.gateSeconds * 1000;
  const t0 = ctx.now();
  const stop = dockerLine(['stop', '-t', '10', ingress.legacy.container]);
  const start = dockerLine(['service', 'scale', `${serviceName(ingress)}=1`]);
  const switched = run(`${stop} && ${start}`);
  if (switched.status !== 0) return { failure: `stop and scale FAILED: ${firstLine(switched.stderr)}`, gapMs: ctx.now() - t0 };
  const up = run(tcpLoop(ingress.takeover.gateSeconds));
  const gapMs = ctx.now() - t0;
  if (up.status !== 0 || gapMs > gateMs) return { failure: `port 443 was not accepting connections within ${ingress.takeover.gateSeconds} s`, gapMs };
  const proof = await matchBaseline(ctx, run, base);
  return proof.ok ? { failure: null, gapMs } : { failure: `hosts differ from the old edge: ${mismatches(proof.rows)}`, gapMs };
}

/** Automatic fallback: free the ports, start the old edge, prove it answers every host as before. */
async function fallback(ctx: Pick<StackContext, 'sleep'>, run: Runner, ingress: IngressConfig, base: Baseline[], steps: string[]): Promise<{ ok: boolean; line: string }> {
  const name = serviceName(ingress);
  const scale = remoteDocker(run, ['service', 'scale', `${name}=0`]);
  steps.push('fallback-scale-0');
  const manual = `docker service scale ${name}=0; docker start ${ingress.legacy.container}; check every host`;
  const started = await settle(ctx, START_ATTEMPTS, SETTLE_MS, () => ({ ok: remoteDocker(run, ['start', ingress.legacy.container]).status === 0 }));
  steps.push('fallback-start-old-edge');
  if (scale.status !== 0 || !started.ok) return { ok: false, line: `FALLBACK FAILED (manual: ${manual})` };
  const proof = await matchBaseline(ctx, run, base);
  steps.push('fallback-verify');
  if (!proof.ok) return { ok: false, line: `FALLBACK FAILED (manual: the old edge started but does not answer as before (${mismatches(proof.rows)}); ${manual})` };
  return { ok: true, line: `FALLBACK ok: ${ingress.legacy.container} answers every host again; the ingress service is scaled to 0 (docker service scale ${name}=1 after fixing the cause)` };
}

const result = (ok: boolean, lines: string[], steps: string[], extra: Record<string, unknown> = {}): ActionResult => ({ ok, lines, data: { ok, steps, ...extra } });

async function cutover(ctx: Pick<StackContext, 'now' | 'sleep'>, run: Runner, ingress: IngressConfig, context: { base: Baseline[]; lines: string[]; steps: string[]; files: string[] }): Promise<ActionResult> {
  const { base, lines, steps, files } = context;
  const outcome = await swap(ctx, run, ingress, base);
  steps.push('stop-and-scale');
  lines.push(`measured unavailability gap: ${outcome.gapMs} ms (gate ${ingress.takeover.gateSeconds} s)`);
  if (outcome.failure === null) {
    lines.push(`takeover complete: the swarm ingress serves ${base.length} host(s) with the old edge's certificates; ${ingress.legacy.container} is stopped, not removed`);
    return result(true, lines, steps, { gapMs: outcome.gapMs, backups: files, fallback: null });
  }
  lines.push(`takeover FAILED: ${outcome.failure}`);
  const back = await fallback(ctx, run, ingress, base, steps);
  lines.push(back.line);
  return result(false, lines, steps, { gapMs: outcome.gapMs, backups: files, fallback: back.ok ? 'ok' : 'failed' });
}

async function takeoverAction(ctx: StackContext, run: Runner, config: DeployConfig, ingress: IngressConfig, execute: boolean): Promise<ActionResult> {
  if (!declaresBackup(ingress)) throw refusal('STACK_INGRESS_BACKUP_UNDECLARED', 'deploy.ingress.backup (dir) is not declared: the takeover needs an encrypted backup');
  const recipient = readRecipient(config.repoRoot);
  const steps = ['plan'];
  const found = gather(run, config, ingress);
  if (found.error !== undefined) return result(false, [found.error], steps);
  const checks = preconditions(run, ingress, found);
  const lines = checks.map((check) => (check.ok ? `precondition ok: ${check.name}` : `precondition FAILED: ${check.name} (${check.detail})`));
  steps.push('preconditions');
  if (checks.some((check) => !check.ok)) return result(false, [...lines, 'takeover refused: nothing was changed'], steps);
  const base = baselines(run, targetsOf(ingress, found.declared));
  steps.push('baseline');
  for (const row of base) lines.push(`${row.ok ? 'baseline ok' : 'baseline FAILED'} ${label(row.target)}: old edge answers ${row.code}`);
  if (base.some((row) => !row.ok)) return result(false, [...lines, 'takeover refused: the old edge does not answer as declared; nothing was changed'], steps);
  if (!execute) {
    lines.push(`dry run: would back up the certificates store and the dynamic directory (age) to ${ingress.backup.dir}, stop ${ingress.legacy.container} and scale ${serviceName(ingress)} to 1, verify ${base.length} host(s) and fall back on any failure`);
    return result(true, lines, steps);
  }
  const saved = backupStores(ctx, run, ingress, recipient);
  if (saved.files === undefined) return result(false, [...lines, saved.error, 'takeover refused: nothing was changed'], steps);
  steps.push('backup');
  lines.push(`backup written: ${saved.files.join(', ')}`);
  return cutover(ctx, run, ingress, { base, lines, steps, files: saved.files });
}

// ---- rehearse -----------------------------------------------------------------------------------------------------------------------
// A throwaway copy of the ingress on alternate host ports, proving that the persisted certificates and the dynamic routes serve every host
// exactly as the live edge does. The live edge, its container, the production certificates volume and ports 80/443 are never touched: the
// store is only READ (read-only mount of a helper container) into a NEW volume, the service reads the legacy dynamic directory read-only,
// the ACME http challenge is moved to an unused internal entrypoint so no certificate can be requested, and everything created is torn
// down in a finally path.

const UNUSED_ENTRYPOINT = 'rehearsal-unused';
const CHALLENGE_ARG = /^(--certificatesresolvers\.[^.]+\.acme\.httpchallenge\.entrypoint)=.*$/iu;
const ACME_ACTIVITY = /\b(?:obtain|obtaining|registering|new account|authorization)\b/iu;
const READY_ATTEMPTS = 12;

const rehearsalName = (ingress: IngressConfig): string => `${ingress.name}-rehearsal`;
const rehearsalVolume = (ingress: IngressConfig): string => `${ingress.acmeVolume}-rehearsal`;
const classOf = (code: number): number => Math.floor(code / 100);

/** The static arguments of the ingress service with the ACME http challenge moved to an unused internal entrypoint. */
function rehearsalArgs(args: string[]): string[] {
  const quiet = args.map((arg) => arg.replace(CHALLENGE_ARG, `$1=${UNUSED_ENTRYPOINT}`));
  return [...quiet, `--entrypoints.${UNUSED_ENTRYPOINT}.address=127.0.0.1:1`];
}

/** Image, static arguments and the container paths of the two mounts the rehearsal copies; null when the service cannot be rehearsed. */
function ingressSpec(run: Runner, ingress: IngressConfig): IngressSpec | null {
  const inspect = remoteDocker(run, ['service', 'inspect', '--format', '{{json .Spec.TaskTemplate.ContainerSpec}}', serviceName(ingress)]);
  // reason: `docker service inspect` ContainerSpec, parsed JSON read defensively and checked for completeness below
  let spec: any = null;
  try { spec = JSON.parse(inspect.stdout); } catch { spec = null; }
  const mounts: any[] = Array.isArray(spec?.Mounts) ? spec.Mounts : [];
  const targetOf = (source: string): unknown => mounts.find((mount) => asMap(mount).Source === source)?.Target;
  const out = {
    image: spec?.Image,
    args: (Array.isArray(spec?.Args) ? spec.Args : []).filter((arg: unknown) => typeof arg === 'string'),
    dynamicTarget: targetOf(ingress.legacy.dynamicDir),
    acmeTarget: targetOf(ingress.acmeVolume),
  };
  const complete = typeof out.image === 'string' && out.args.length > 0 && typeof out.dynamicTarget === 'string' && typeof out.acmeTarget === 'string';
  return inspect.status === 0 && complete ? (out as IngressSpec) : null; // complete: every field was checked above
}

function rehearseChecks(run: Runner, config: DeployConfig, ingress: IngressConfig, found: Gathered, spec: IngressSpec | null): Check[] {
  const leftoverService = remoteDocker(run, ['service', 'inspect', rehearsalName(ingress)]).status === 0;
  const leftoverVolume = volumePresent(run, rehearsalVolume(ingress));
  const checks: [string, boolean, string][] = [
    ['plan green', planOk(found), `${found.missing.length} live host(s) not covered`],
    [`network ${ingress.network} is an attachable overlay`, found.network === 'ok', `network state: ${found.network}`],
    [`certificates volume ${ingress.acmeVolume} present`, found.certificates, 'the persisted certificates volume is missing'],
    ['helper image declared (deploy.backup.image)', typeof config.backup?.image === 'string', 'the copy of the store needs a digest-pinned helper image'],
    [`swarm service ${serviceName(ingress)} readable (image, arguments, dynamic and certificates mounts)`, spec !== null, 'create the ingress service first'],
    [`no leftover ${rehearsalName(ingress)} service or ${rehearsalVolume(ingress)} volume`, !leftoverService && !leftoverVolume, 'remove the leftover of an earlier rehearsal first'],
  ];
  return checks.map(([name, ok, detail]) => ({ name, ok, detail }));
}

function serviceCreateArgs(ingress: IngressConfig, spec: IngressSpec): string[] {
  const ports = ingress.takeover.rehearsalPorts;
  const mounts = [
    `type=bind,source=${ingress.legacy.dynamicDir},target=${spec.dynamicTarget},readonly`,
    `type=volume,source=${rehearsalVolume(ingress)},target=${spec.acmeTarget}`,
  ];
  return [
    'service', 'create', '--detach', '--name', rehearsalName(ingress), '--replicas', '1', '--restart-condition', 'none', '--network', ingress.network,
    '--publish', `mode=host,target=80,published=${ports.http}`, '--publish', `mode=host,target=443,published=${ports.https}`,
    ...mounts.flatMap((mount) => ['--mount', mount]), spec.image, ...rehearsalArgs(spec.args),
  ];
}

/** Volume, read-only copy of the store, service: stops at the first failed step. Returns a failure message or null. */
async function rehearsalUp(ctx: Pick<StackContext, 'sleep'>, run: Runner, config: DeployConfig, ingress: IngressConfig, context: { spec: IngressSpec; steps: string[]; created: Created }): Promise<string | null> {
  const { spec, steps, created } = context;
  const volume = rehearsalVolume(ingress);
  const made = remoteDocker(run, ['volume', 'create', volume]);
  if (made.status !== 0) return `creating ${volume} FAILED: ${firstLine(made.stderr)}`;
  created.volume = true;
  steps.push('volume-create');
  const copy = remoteDocker(run, ['run', '--rm', '--network', 'none', '-v', `${ingress.acmeVolume}:/from:ro`, '-v', `${volume}:/to`, (config.backup as BackupBlock).image, 'cp', '-a', '/from/.', '/to/']);
  if (copy.status !== 0) return `copying the certificates store FAILED: ${firstLine(copy.stderr)}`;
  steps.push('volume-copy');
  const service = remoteDocker(run, serviceCreateArgs(ingress, spec));
  if (service.status !== 0) return `creating ${rehearsalName(ingress)} FAILED: ${firstLine(service.stderr)}`;
  created.service = true;
  steps.push('service-create');
  const ready = await settle(ctx, READY_ATTEMPTS, SETTLE_MS, () => {
    const state = serviceState(run, rehearsalName(ingress));
    return { ok: state.desired > 0 && state.running === state.desired };
  });
  steps.push('service-ready');
  return ready.ok ? null : `${rehearsalName(ingress)} did not start`;
}

/** Status class and certificate of every host on the rehearsal ports against the live edge baseline; hosts without a live certificate are skipped. */
function compareRehearsal(run: Runner, ingress: IngressConfig, base: Baseline[]): RehearsalRow[] {
  const port = ingress.takeover.rehearsalPorts.https;
  return base.map((entry) => {
    if (entry.certificate === null) return { target: entry.target, live: entry.code, skipped: true, ok: true };
    const seen = observe(run, entry.target, port);
    const sameStatus = classOf(seen.code) === classOf(entry.code);
    const sameCertificate = seen.certificate === entry.certificate;
    return { target: entry.target, live: entry.code, code: seen.code, sameCertificate, skipped: false, ok: sameStatus && sameCertificate };
  });
}

function certificateVerdict(row: RehearsalRow): string {
  if (row.skipped) return 'skipped';
  return row.sameCertificate ? 'equal' : 'different';
}

function rowLine(row: RehearsalRow): string {
  if (row.skipped) return `skipped: needs fresh issuance ${label(row.target)} (the live edge presents no certificate for it)`;
  return `${row.ok ? 'ok' : 'MISMATCH'} ${label(row.target)}: status ${row.code} (live ${row.live}), certificate serial and subject ${certificateVerdict(row)}`;
}

/** The rehearsal log must show no certificate request (obtain, register, authorization). Returns a failure message or null. */
function acmeLogProblem(run: Runner, ingress: IngressConfig): string | null {
  const logs = remoteDocker(run, ['service', 'logs', '--raw', '--no-task-ids', rehearsalName(ingress)]);
  if (logs.status !== 0) return 'cannot read the rehearsal log: no proof that no certificate was requested';
  return String(logs.stdout).split('\n').some((line) => ACME_ACTIVITY.test(line)) ? 'the rehearsal log shows certificate activity (a certificate was requested)' : null;
}

/** Brings the rehearsal up, probes every host and checks the log. Returns { failure, rows }. */
async function rehearsalBody(ctx: Pick<StackContext, 'sleep'>, run: Runner, config: DeployConfig, ingress: IngressConfig, context: { spec: IngressSpec; steps: string[]; created: Created; base: Baseline[] }): Promise<{ failure: string | null; rows: RehearsalRow[] }> {
  const failure = await rehearsalUp(ctx, run, config, ingress, context);
  if (failure !== null) return { failure, rows: [] };
  const compared = await settle(ctx, SETTLE_ATTEMPTS, SETTLE_MS, () => {
    const rows = compareRehearsal(run, ingress, context.base);
    return { ok: rows.every((row) => row.ok), rows };
  });
  context.steps.push('probe');
  const problem = acmeLogProblem(run, ingress);
  context.steps.push('acme-log');
  const mismatched = compared.rows.filter((row) => !row.ok).map((row) => label(row.target));
  const failures = [mismatched.length > 0 ? `mismatch on ${mismatched.join(', ')}` : null, problem].filter((item): item is string => Boolean(item));
  return { failure: failures.length > 0 ? failures.join('; ') : null, rows: compared.rows };
}

/** Removes what was created: the service, then its tasks, then the volume. Always reports each step. */
async function rehearsalTeardown(ctx: Pick<StackContext, 'sleep'>, run: Runner, ingress: IngressConfig, created: Created, steps: string[]): Promise<{ clean: boolean; lines: string[] }> {
  const lines: string[] = [];
  let clean = true;
  const record = (name: string, done: boolean, text: string): void => {
    steps.push(`teardown:${name}`);
    lines.push(done ? `teardown: ${text}` : `TEARDOWN FAILED: ${text} not done`);
    clean = clean && done;
  };
  if (created.service) {
    record('service-rm', remoteDocker(run, ['service', 'rm', rehearsalName(ingress)]).status === 0, 'service removed');
    const gone = await settle(ctx, READY_ATTEMPTS, SETTLE_MS, () => ({ ok: String(remoteDocker(run, ['ps', '-q', '--filter', `label=com.docker.swarm.service.name=${rehearsalName(ingress)}`]).stdout).trim() === '' }));
    record('tasks-gone', gone.ok, 'tasks gone');
  }
  if (created.volume) {
    const removed = await settle(ctx, SETTLE_ATTEMPTS, SETTLE_MS, () => ({ ok: remoteDocker(run, ['volume', 'rm', rehearsalVolume(ingress)]).status === 0 }));
    record('volume-rm', removed.ok, 'volume removed');
  }
  if (!clean) lines.push(`manual: remove the service ${rehearsalName(ingress)} and the volume ${rehearsalVolume(ingress)}`);
  return { clean, lines };
}

async function rehearsalRun(ctx: Pick<StackContext, 'sleep'>, run: Runner, config: DeployConfig, ingress: IngressConfig, context: { spec: IngressSpec; base: Baseline[]; lines: string[]; steps: string[] }): Promise<ActionResult> {
  const created: Created = { volume: false, service: false };
  let body: { failure: string | null; rows: RehearsalRow[] } = { failure: 'rehearsal did not run', rows: [] };
  let down: { clean: boolean; lines: string[] } = { clean: true, lines: [] };
  try {
    body = await rehearsalBody(ctx, run, config, ingress, { ...context, created });
  } finally {
    down = await rehearsalTeardown(ctx, run, ingress, created, context.steps);
  }
  const lines = [...context.lines, ...body.rows.map(rowLine), ...down.lines];
  if (body.failure !== null) lines.push(`rehearsal FAILED: ${body.failure}`);
  const ok = body.failure === null && down.clean;
  if (ok) lines.push('rehearsal passed: every host matches the live edge and nothing of the rehearsal is left');
  const hosts = body.rows.map((row) => ({ host: row.target.host, path: row.target.path, status: row.code ?? null, certificate: certificateVerdict(row) }));
  return result(ok, lines, context.steps, { hosts, teardown: down.clean ? 'clean' : 'failed' });
}

async function rehearseAction(ctx: Pick<StackContext, 'sleep'>, run: Runner, config: DeployConfig, ingress: IngressConfig, execute: boolean): Promise<ActionResult> {
  const steps = ['plan'];
  const found = gather(run, config, ingress);
  if (found.error !== undefined) return result(false, [found.error], steps);
  const spec = ingressSpec(run, ingress);
  const checks = rehearseChecks(run, config, ingress, found, spec);
  const readySpec = spec as IngressSpec; // a missing spec fails the checks below, which return before it is used
  const lines = checks.map((check) => (check.ok ? `precondition ok: ${check.name}` : `precondition FAILED: ${check.name} (${check.detail})`));
  steps.push('preconditions');
  if (checks.some((check) => !check.ok)) return result(false, [...lines, 'rehearsal refused: nothing was changed'], steps);
  const base = baselines(run, targetsOf(ingress, found.declared));
  steps.push('baseline');
  for (const row of base) lines.push(`live edge ${label(row.target)}: status ${row.code}`);
  if (!execute) {
    const ports = ingress.takeover.rehearsalPorts;
    lines.push(`dry run: would copy ${ingress.acmeVolume} read-only into ${rehearsalVolume(ingress)}, start ${rehearsalName(ingress)} on host ports ${ports.http}/${ports.https} with no certificate requests, compare ${base.length} host(s) with the live edge and tear everything down`);
    return result(true, lines, steps);
  }
  return rehearsalRun(ctx, run, config, ingress, { spec: readySpec, base, lines, steps });
}

// ---- entry --------------------------------------------------------------------------------------------------------------------------

/** The probe helpers the publish action shares with the takeover (injected so the two modules never import each other). */
const PUBLISH_KIT: PublishKit = {
  readRecipient,
  stampOf,
  observe,
  baselines,
  settle,
  serviceState,
  liveCommand,
  targets: (config, ingress) => targetsOf(ingress, declaredHosts(ingress, readOwnRoutes(config, ingress))),
};

const ACTIONS: readonly string[] = ['plan', 'attach', 'create', 'takeover', 'rehearse', 'publish'];
const isAction = (value: unknown): value is IngressAction => ACTIONS.includes(value as string);

/**
 * `starci app stack ingress <plan|attach|create|takeover|rehearse|publish>`; effects need execute === true.
 *   deps.ssh  an injected ssh runner (specs).
 */
export async function runIngress(ctx: StackContext, config: DeployConfig, { action, execute = false, args = [], sshCmd = null }: IngressOptions, deps: RunnerDeps = {}): Promise<ActionResult> {
  if (!isAction(action)) throw refusal('STACK_USAGE', `starci app stack ingress takes ${ACTIONS.join(' | ')}`);
  if (args.length > 0) throw refusal('STACK_USAGE', `ingress ${action} takes no further argument (got ${args.join(' ')})`);
  const { ingress } = config;
  if (!ingress) throw refusal('STACK_INGRESS_UNDECLARED', 'deploy.ingress is not declared for this environment');
  return withRunner(ctx, config, { sshCmd }, deps, async (run, notes): Promise<ActionResult> => {
    const table: Record<IngressAction, () => ActionResult | Promise<ActionResult>> = {
      plan: () => planAction(run, config, ingress),
      attach: () => attachAction(run, ingress, execute),
      create: () => createIngress(run, ingress, execute),
      takeover: () => takeoverAction(ctx, run, config, ingress, execute),
      rehearse: () => rehearseAction(ctx, run, config, ingress, execute),
      publish: () => publishIngress(ctx, run, config, ingress, execute, PUBLISH_KIT),
    };
    const outcome = await table[action]();
    return { ...outcome, lines: [...notes, ...outcome.lines], data: { action, ...outcome.data } };
  });
}
