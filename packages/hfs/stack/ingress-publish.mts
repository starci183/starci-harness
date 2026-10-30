// ingress-publish.mjs - `starci app stack ingress publish`: puts the app's own routes file (deploy.ingress.routes) into the dynamic directory the
// shared ingress serves, under `publish.file`, and retires the old generic file(s) listed in `publish.supersedes`. The directory is shared with
// tenants that write their own files: those files are NEVER touched; the only remote writes and removals are `publish.file`, its `.tmp` upload
// name and the superseded names.
//   Preconditions (all or nothing): the routes file parses, no router or service name clashes with a tenant file, the ingress service runs, the old
//   edge does not, every service of the app stack is healthy, the age recipient and the backup directory exist.
//   --execute: baseline of every host -> age backup of each superseded file AND of the current publish.file when it exists -> upload as <file>.tmp (ignored by the file provider because of its
//   extension) -> ONE remote command swaps it in and removes the superseded files -> every host is verified (declared status exact, otherwise the
//   baseline status class; a host that did not answer before is new: it must answer 2xx-4xx over a certificate valid for its name, whatever the
//   default certificate was; certificates of hosts that answered before unchanged) -> any failure puts the superseded files AND the previous
//   publish.file back from memory (publish.file is removed only when there was none) and re-verifies the baseline (RESTORED ok / RESTORE FAILED (manual: ...)).
// Route files may carry header values or tokens: they are held in memory only and NEVER printed; lines carry names, hosts and statuses.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import type { DeployConfig, IngressConfig, IngressPublish } from './config.mjs';
import { firstLine } from './context.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { Baseline, Check, Observation, PublishKit, Target } from './ingress.mjs';
import { remoteDocker, shellQuote } from './remote.mjs';
import type { ActionResult, Runner } from './remote.mjs';

/** An ingress known to declare what publish needs: the file to publish and the routes file it comes from. */
type PublishIngress = IngressConfig & { publish: IngressPublish; routes: string };
const declaresPublish = (ingress: IngressConfig): ingress is PublishIngress => ingress.publish !== null && ingress.routes !== null;

/** The app's own routes file as read. */
type OwnFile = { text: string; routers: string[]; services: string[]; error?: undefined } | { error: string; text?: undefined; routers?: undefined; services?: undefined };
type OwnRoutesFile = Extract<OwnFile, { text: string }>;
/** The route files of the live directory (name -> text), or why they could not be read. */
type LiveDirectory = { files: Map<string, string>; error?: undefined } | { error: string; files?: undefined };
/** The age recipient, or why there is none. */
type RecipientRead = { recipient: string; error?: undefined } | { error: string; recipient?: undefined };
/** One host row of a verification. */
interface VerifyRow { entry: Baseline; code: number; same: string; ok: boolean }
/** The files retired before the swap, in memory, with their encrypted backups. */
interface Retired { contents: Map<string, string>; previous: string | null; backups: string[]; error?: undefined }

const FILE_MARK = /^#@@FILE (.+)$/mu;
const HEALTHY = /^([1-9]\d*)\/\1$/u;
const VERIFY_ATTEMPTS = 6;
const VERIFY_MS = 2000;

const asMap = (value: unknown): Record<string, unknown> => (plain(value) ? (value as Record<string, unknown>) : {});
const classOf = (code: number): number => Math.floor(code / 100);
const answers = (code: number): boolean => code >= 200 && code < 500;
const label = (target: Target): string => `${target.host}${target.path}`;
const result = (ok: boolean, lines: string[], steps: string[], extra: Record<string, unknown> = {}): ActionResult => ({ ok, lines, data: { ok, steps, ...extra } });
const quote = (value: string): string => shellQuote(value);
const shScript = (script: string): string => `sh -c ${quote(script)}`;

/** The app's own routes file: { text, routers, services } or { error }. */
function readOwn(config: DeployConfig, ingress: PublishIngress): OwnFile {
  let text = '';
  let doc: unknown = null;
  try {
    text = fs.readFileSync(path.join(config.envDir, ingress.routes), 'utf8');
    doc = parseYaml(text);
  } catch {
    return { error: `${ingress.routes} cannot be read as YAML` };
  }
  const http = asMap(doc).http;
  if (!plain(http) || !plain(asMap(http).routers) || !plain(asMap(http).services)) return { error: `${ingress.routes} needs http.routers and http.services mappings` };
  return { text, routers: Object.keys(asMap(asMap(http).routers)), services: Object.keys(asMap(asMap(http).services)) };
}

/** The route files of the live directory: Map name -> text (listing only; the contents are never printed). */
function readFiles(run: Runner, kit: PublishKit, dir: string): LiveDirectory {
  const listed = run(kit.liveCommand(dir));
  if (listed.status !== 0) return { error: `cannot read ${dir} on the manager: ${firstLine(listed.stderr)}` };
  const parts = String(listed.stdout).split(FILE_MARK);
  const files = new Map<string, string>();
  for (let index = 1; index < parts.length; index += 2) files.set(parts[index] as string, parts[index + 1] as string);
  return { files };
}

/** Router and service names of the other files that the own file would collide with (superseded files and the target are ignored). */
function clashes(files: Map<string, string>, own: OwnRoutesFile, ignore: Set<string>): { found: string[]; unreadable: string[] } {
  const found: string[] = [];
  const unreadable: string[] = [];
  for (const [name, body] of files) {
    if (ignore.has(name)) continue;
    let doc: unknown = null;
    try { doc = parseYaml(body); } catch { unreadable.push(name); continue; }
    const http = asMap(asMap(doc).http);
    for (const router of Object.keys(asMap(http.routers))) if (own.routers.includes(router)) found.push(`router ${router} (${name})`);
    for (const service of Object.keys(asMap(http.services))) if (own.services.includes(service)) found.push(`service ${service} (${name})`);
  }
  return { found, unreadable };
}

/** Every service of the app stack is N/N with N >= 1. */
function stackHealth(run: Runner, stack: string): { ok: boolean; unhealthy: (string | undefined)[]; count: number } {
  const listed = remoteDocker(run, ['stack', 'services', stack, '--format', '{{.Name}} {{.Replicas}}']);
  const rows = String(listed.stdout).split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split(' '));
  const unhealthy = rows.filter(([, replicas]) => !HEALTHY.test(replicas ?? '')).map(([name]) => name);
  return { ok: listed.status === 0 && rows.length > 0 && unhealthy.length === 0, unhealthy, count: rows.length };
}

function recipientOf(kit: PublishKit, config: DeployConfig): RecipientRead {
  try {
    return { recipient: kit.readRecipient(config.repoRoot) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const legacyRunning = (run: Runner, ingress: IngressConfig): boolean => String(remoteDocker(run, ['inspect', '--format', '{{.State.Running}}', ingress.legacy.container]).stdout).trim() === 'true';

function preconditions(run: Runner, config: DeployConfig, ingress: PublishIngress, kit: PublishKit, context: { own: OwnFile; live: LiveDirectory; recipient: { error: string | undefined } }): Check[] {
  const { own, live, recipient } = context;
  const ignore = new Set([ingress.publish.file, ...ingress.publish.supersedes]);
  const swarm = remoteDocker(run, ['info', '--format', '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}']);
  const service = kit.serviceState(run, `${ingress.name}_${ingress.service}`);
  const health = stackHealth(run, config.stack);
  const clash = (own.error !== undefined || live.error !== undefined) ? { found: [], unreadable: [] } : clashes(live.files, own, ignore);
  const checks: [string, boolean, string | undefined][] = [
    [`${ingress.routes} parses with routers and services`, !own.error, own.error],
    [`${ingress.legacy.dynamicDir} is readable`, !live.error, live.error],
    ['no router or service name clashes with a file of another tenant', clash.found.length === 0, clash.found.join(', ')],
    ['every other file of the directory can be checked', clash.unreadable.length === 0, `not valid YAML: ${clash.unreadable.join(', ')}`],
    ['swarm active (manager)', swarm.status === 0 && String(swarm.stdout).trim() === 'active true', 'this host is not an active swarm manager'],
    [`ingress service ${ingress.name}_${ingress.service} is running`, service.desired >= 1 && service.running >= 1, 'run the takeover first'],
    [`old edge ${ingress.legacy.container} is not running`, !legacyRunning(run, ingress), 'an old edge watching the same directory would load the new file too'],
    [`every service of the stack ${config.stack} is healthy`, health.ok, health.count === 0 ? 'no service listed' : `not healthy: ${health.unhealthy.join(', ')}`],
    ['age recipient and backup directory declared', recipient.error === undefined && ingress.backup !== null, recipient.error ?? 'declare deploy.ingress.backup'],
  ];
  return checks.map(([name, ok, detail]) => ({ name, ok, detail }));
}

// ---- remote writes: only publish.file, its .tmp and the superseded names ------------------------------------------------------------------

const remoteFile = (ingress: IngressConfig, name: string): string => `${ingress.legacy.dynamicDir}/${name}`;

/** The encrypted backup directory the preconditions required. */
const backupDirOf = (ingress: IngressConfig): string => (ingress.backup as { dir: string }).dir;

function readRemote(run: Runner, ingress: IngressConfig, name: string): string | null {
  const read = run(`cat -- ${quote(remoteFile(ingress, name))}`);
  return read.status === 0 ? String(read.stdout) : null;
}

/** Uploads `content` as <name>.tmp (never a route file name: the file provider ignores it). Returns an error text or null. */
function upload(run: Runner, ingress: IngressConfig, name: string, content: string): string | null {
  const tmp = remoteFile(ingress, `${name}.tmp`);
  const done = run(shScript(`umask 022 && cat > ${quote(tmp)}`), { input: content });
  return done.status === 0 ? null : `uploading ${name}.tmp FAILED: ${firstLine(done.stderr)}`;
}

/** Moves each <name>.tmp over <name> and removes the given files in ONE remote command. */
function swapIn(run: Runner, ingress: IngressConfig, moves: string[], removals: string[]): string | null {
  const steps = moves.map((name) => {
    const tmp = remoteFile(ingress, `${name}.tmp`);
    return `mv -f ${quote(tmp)} ${quote(remoteFile(ingress, name))}`;
  });
  if (removals.length > 0) steps.push(`rm -f ${removals.map((name) => quote(remoteFile(ingress, name))).join(' ')}`);
  const done = run(shScript(steps.join(' && ')));
  return done.status === 0 ? null : firstLine(done.stderr);
}

/** Age-encrypted copy of one file into the backup directory, fed through stdin (the content never touches argv). */
function backupOne(ctx: Pick<StackContext, 'now'>, run: Runner, ingress: IngressConfig, kit: PublishKit, { recipient, name, content }: { recipient: string; name: string; content: string }): { file: string; error?: undefined } | { error: string; file?: undefined } {
  const dir = backupDirOf(ingress);
  const file = `${dir}/${name}-${kit.stampOf(ctx.now())}.age`;
  const script = ['umask 077', `mkdir -p ${quote(dir)}`, `age -r ${quote(recipient)} -o ${quote(file)}`, `test -s ${quote(file)}`].join(' && ');
  const done = run(`bash -c ${quote(script)}`, { input: content });
  return done.status === 0 ? { file } : { error: `backup of ${name} FAILED: ${firstLine(done.stderr)}` };
}

// ---- verification -----------------------------------------------------------------------------------------------------------------------

/** A host that did not answer before the swap (status 0: unrouted, with no certificate or the default one) is new: it gets a fresh certificate. */
const isNew = (entry: Observation): boolean => !answers(entry.code);

/**
 * After the swap: a declared status is exact; otherwise the baseline class. A new host must answer 2xx-4xx (curl verifies the certificate against the
 * name, so an answer proves a valid certificate for it) and is never compared with its old default certificate; a host that answered before keeps
 * its certificate.
 */
function forwardOk(entry: Baseline, seen: Observation): boolean {
  let statusOk = answers(seen.code);
  if (entry.target.status !== null) statusOk = seen.code === entry.target.status;
  else if (!isNew(entry)) statusOk = classOf(seen.code) === classOf(entry.code);
  return statusOk && (isNew(entry) || entry.certificate === null || seen.certificate === entry.certificate);
}

/** After a restore: every host that answered before answers in the same class with the same certificate. */
const restoreOk = (entry: Baseline, seen: Observation): boolean => classOf(seen.code) === classOf(entry.code) && seen.certificate === entry.certificate;

function certificateState(entry: Baseline, seen: Observation): string {
  if (isNew(entry) || entry.certificate === null) return 'new';
  return seen.certificate === entry.certificate ? 'equal' : 'different';
}

function verify(ctx: Pick<StackContext, 'sleep'>, run: Runner, kit: PublishKit, entries: Baseline[], accept: (entry: Baseline, seen: Observation) => boolean): Promise<{ ok: boolean; rows: VerifyRow[] }> {
  return kit.settle(ctx, VERIFY_ATTEMPTS, VERIFY_MS, () => {
    const rows = entries.map((entry): VerifyRow => {
      const seen = kit.observe(run, entry.target);
      return { entry, code: seen.code, same: certificateState(entry, seen), ok: accept(entry, seen) };
    });
    return { ok: rows.every((row) => row.ok), rows };
  });
}

function rowLine(row: VerifyRow): string {
  return `${row.ok ? 'ok' : 'MISMATCH'} ${label(row.entry.target)}: status ${row.code} (baseline ${row.entry.code}), certificate serial ${row.same}`;
}

const hostsData = (rows: VerifyRow[]) => rows.map((row) => ({ host: row.entry.target.host, path: row.entry.target.path, status: row.code, certificate: row.same }));

/** Writes the superseded files and the previous publish.file back from memory (one atomic swap; publish.file is deleted only when there was none) and re-verifies the baseline. */
async function restore(ctx: Pick<StackContext, 'sleep'>, run: Runner, ingress: PublishIngress, kit: PublishKit, context: { contents: Map<string, string>; previous: string | null; base: Baseline[]; steps: string[] }): Promise<{ ok: boolean; line: string }> {
  const { contents, previous, base, steps } = context;
  const back = new Map(contents);
  if (previous !== null) back.set(ingress.publish.file, previous);
  const names = [...back.keys()];
  const failedUpload = names.map((name) => upload(run, ingress, name, back.get(name) as string)).find((error) => error !== null);
  const failedSwap = failedUpload ?? swapIn(run, ingress, names, previous === null ? [ingress.publish.file] : []);
  steps.push('restore');
  const manual = `RESTORE FAILED (manual: encrypted backups in ${backupDirOf(ingress)})`;
  if (failedSwap) return { ok: false, line: manual };
  const proof = await verify(ctx, run, kit, base.filter((entry) => answers(entry.code)), restoreOk);
  steps.push('restore-verify');
  return proof.ok ? { ok: true, line: 'RESTORED ok: the superseded files are back and every host answers as before' } : { ok: false, line: manual };
}

async function apply(ctx: Pick<StackContext, 'sleep'>, run: Runner, ingress: PublishIngress, kit: PublishKit, context: { own: OwnRoutesFile; base: Baseline[]; lines: string[]; steps: string[] } & Retired): Promise<ActionResult> {
  const { own, base, lines, steps, contents, backups, previous } = context;
  const uploadError = upload(run, ingress, ingress.publish.file, own.text);
  steps.push('upload');
  if (uploadError) return result(false, [...lines, uploadError, 'publish refused: nothing was changed'], steps);
  lines.push(`uploaded ${ingress.publish.file}.tmp`);
  const swapError = swapIn(run, ingress, [ingress.publish.file], [...contents.keys()]);
  steps.push('swap');
  const proof: { ok: boolean; rows: VerifyRow[] } = swapError ? { ok: false, rows: [] } : await verify(ctx, run, kit, base, forwardOk);
  steps.push('verify');
  lines.push(...proof.rows.map(rowLine));
  if (!swapError && proof.ok) {
    lines.push(`published ${ingress.publish.file}; retired ${[...contents.keys()].join(', ') || 'nothing'}; ${proof.rows.length} host(s) verified`);
    return result(true, lines, steps, { backups, hosts: hostsData(proof.rows), restored: null });
  }
  lines.push(swapError ? `swap FAILED: ${swapError}` : 'verification FAILED');
  const back = await restore(ctx, run, ingress, kit, { contents, previous, base, steps });
  lines.push(back.line);
  return result(false, lines, steps, { backups, hosts: hostsData(proof.rows), restored: back.ok ? 'ok' : 'failed' });
}

/** Reads and backs up every superseded file that exists, then the current publish.file (about to be overwritten); returns { contents, previous, backups } or { error }. */
function retire(ctx: Pick<StackContext, 'now'>, run: Runner, ingress: PublishIngress, kit: PublishKit, { recipient, names }: { recipient: string; names: string[] }): Retired | { error: string } {
  const contents = new Map<string, string>();
  const backups: string[] = [];
  for (const name of names) {
    const content = readRemote(run, ingress, name);
    if (content === null) continue;
    const saved = backupOne(ctx, run, ingress, kit, { recipient, name, content });
    if (saved.file === undefined) return { error: saved.error };
    contents.set(name, content);
    backups.push(saved.file);
  }
  const previous = readRemote(run, ingress, ingress.publish.file);
  if (previous !== null) {
    const saved = backupOne(ctx, run, ingress, kit, { recipient, name: ingress.publish.file, content: previous });
    if (saved.file === undefined) return { error: saved.error };
    backups.push(saved.file);
  }
  return { contents, previous, backups };
}

/** `ingress publish`: see the top of the file. `kit` carries the shared probe helpers of ingress.mjs. */
export async function publishIngress(ctx: StackContext, run: Runner, config: DeployConfig, ingress: IngressConfig, execute: boolean, kit: PublishKit): Promise<ActionResult> {
  if (ingress.publish === null) throw refusal('STACK_INGRESS_PUBLISH_UNDECLARED', 'deploy.ingress.publish ({ file, supersedes }) is not declared: nothing to publish');
  if (!declaresPublish(ingress)) throw refusal('STACK_INGRESS_PUBLISH_NO_ROUTES', 'deploy.ingress.routes is not declared: there is no routes file to publish');
  const steps = ['preconditions'];
  const own = readOwn(config, ingress);
  const live = readFiles(run, kit, ingress.legacy.dynamicDir);
  const { recipient, error } = recipientOf(kit, config);
  const checks = preconditions(run, config, ingress, kit, { own, live, recipient: { error } });
  const lines = checks.map((check) => (check.ok ? `precondition ok: ${check.name}` : `precondition FAILED: ${check.name} (${check.detail})`));
  if (checks.some((check) => !check.ok)) return result(false, [...lines, 'publish refused: nothing was changed'], steps);
  // the preconditions above hold: the routes file and the live directory were read, and the recipient exists
  const ownFile = own as OwnRoutesFile;
  const files = (live as { files: Map<string, string> }).files;
  const age = recipient as string;
  const present = ingress.publish.supersedes.filter((name) => files.has(name));
  if (readRemote(run, ingress, ingress.publish.file) === ownFile.text && present.length === 0) return result(true, [...lines, `nothing to do: ${ingress.publish.file} is current and no superseded file exists`], steps, { changed: false });
  const base = kit.baselines(run, kit.targets(config, ingress));
  steps.push('baseline');
  for (const entry of base) lines.push(`baseline ${label(entry.target)}: status ${entry.code}`);
  if (!execute) {
    lines.push(`dry run: would back up ${present.join(', ') || 'no superseded file'} (age) to ${backupDirOf(ingress)}, upload ${ingress.publish.file}, swap it in, retire ${present.join(', ') || 'nothing'} and verify ${base.length} host(s), restoring on any failure`);
    return result(true, lines, steps, { changed: false });
  }
  const retired = retire(ctx, run, ingress, kit, { recipient: age, names: present });
  if (retired.error !== undefined) return result(false, [...lines, retired.error, 'publish refused: nothing was changed'], steps);
  steps.push('backup');
  lines.push(`backups written: ${retired.backups.join(', ') || 'none needed'}`);
  return apply(ctx, run, ingress, kit, { own: ownFile, base, lines, steps, ...retired });
}
