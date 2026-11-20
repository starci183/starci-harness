// standby.mts - `starci app stack standby` and `starci app stack resume` (PROJECT-STACKS-18): a whole stack taken out of service and given back, in order.
//   standby  --env <env> [--renamed-from] [--timeout <s>] [--execute]   writers to 0, then stores to 0, then the router labels off (traefik.enable=false)
//   resume   --env <env> [--renamed-from] [--timeout <s>] [--execute]   stores back and healthy, then writers back and healthy, then the router labels back
// A store is a service that mounts a named volume; every other service is a writer (it serves or writes through a store). A replicated service is scaled,
// a global one is held by a placement constraint no node carries. Both verbs are dry runs until --execute, and each execute is one recorded attempt under
// the deploy lock (journal.mts, kinds `standby` and `resume`): the standby writes the services as they ran (mode, replicas, role, router labels) into its
// attempt document before it changes anything, and resume reads the newest standby record of the journal back. `--renamed-from` acts on the stack the
// environment was renamed from (`deploy.renamedFrom`), its releases base and its lock. A service runs again only when its tasks report running: a task
// with a healthcheck is `starting` until the check passes, so running is healthy. The routes come back last, after every upstream is ready.
// Every change is a `docker service` call through the Docker transport (docker-transport.mts), so the same code serves CI and the owner's machine.
import type { DeployConfig } from './config.mjs';
import { firstLine, lines as splitLines, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import { recordedAttempt } from './journal.mjs';
import type { Recorder, StandbyRecord, StandbyService } from './journal.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import { ownerSshRunner } from './remote.mjs';
import type { ActionResult, Runner, SshOptions } from './remote.mjs';
import { gateIsOn } from './ssh-gate.mjs';

/** What standby and resume take. */
export interface StandbyOptions extends SshOptions { execute?: boolean | undefined; timeoutSeconds?: number | undefined; renamedFrom?: boolean | undefined; lockWaitSeconds?: number | undefined }

/** The collaborators a spec or a caller replaces: the manager's runner and the release store over it. */
export interface StandbyDeps { ssh?: Runner | undefined; releaseStore?: ((config: DeployConfig, run: Runner) => ReleaseStore) | undefined }

/** The router switch of the Traefik providers (the shared edge renders it, an external ingress writes it by hand). */
export const ROUTER_LABEL = 'traefik.enable';
/** The placement constraint no node carries: a global service under it has no node to run on. */
export const STANDBY_CONSTRAINT = 'node.labels.starci-standby == 1';
const DEFAULT_TIMEOUT_SECONDS = 300;
const POLL_MS = 3000;

/** One live service of a stack, as standby judges it. */
export interface ServiceFacts {
  /** The full service name (`<stack>_<service>`). */
  name: string;
  mode: 'replicated' | 'global';
  /** The desired replicas of a replicated service; 0 or 1 for a global one (held by the standby constraint, or not). */
  replicas: number;
  /** The named volumes the service mounts. */
  volumes: string[];
  /** The service labels that switch a route (`traefik.enable`). */
  labels: Record<string, string>;
  /** A global service held by the standby constraint. */
  held: boolean;
}

/** The services of `stack` (sorted by name) with their mode, replicas, volumes, router labels and standby constraint. Throws when docker cannot be asked. */
export function stackServiceFacts(ctx: Pick<StackContext, 'spawn'>, stack: string): ServiceFacts[] {
  const listed = tool(ctx, 'docker', ['service', 'ls', '--filter', `label=com.docker.stack.namespace=${stack}`, '--format', '{{.Name}}']);
  if (listed.status !== 0) throw refusal('STACK_STANDBY_DOCKER', `cannot list the services of stack ${stack}: ${firstLine(listed.stderr)}`);
  const names = splitLines(listed.stdout).sort();
  if (names.length === 0) return [];
  const inspected = tool(ctx, 'docker', ['service', 'inspect', '--format', '{{json .Spec}}', ...names]);
  if (inspected.status !== 0) throw refusal('STACK_STANDBY_DOCKER', `cannot inspect the services of stack ${stack}: ${firstLine(inspected.stderr)}`);
  return splitLines(inspected.stdout).map((line, index): ServiceFacts => {
    // reason: `docker service inspect` JSON, read defensively
    const spec: any = JSON.parse(line);
    const constraints: string[] = spec?.TaskTemplate?.Placement?.Constraints ?? [];
    const held = constraints.map((item) => item.replaceAll(' ', '')).includes(STANDBY_CONSTRAINT.replaceAll(' ', ''));
    const global = spec?.Mode?.Global !== undefined;
    const labels = Object.fromEntries(Object.entries<string>(spec?.Labels ?? {}).filter(([key]) => key === ROUTER_LABEL));
    const volumes = (spec?.TaskTemplate?.ContainerSpec?.Mounts ?? []).filter((mount: any) => mount?.Type === 'volume' && typeof mount?.Source === 'string').map((mount: any) => String(mount.Source));
    return { name: String(spec?.Name ?? names[index]), mode: global ? 'global' : 'replicated', replicas: global ? (held ? 0 : 1) : Number(spec?.Mode?.Replicated?.Replicas ?? 1), volumes, labels, held };
  });
}

/** True when the service has tasks to run (a replicated one above 0, a global one not held). */
export const isRunning = (facts: ServiceFacts): boolean => (facts.mode === 'global' ? !facts.held : facts.replicas > 0);

/** The role a service plays in the order: a store mounts a named volume, every other service writes through one. */
const roleOf = (facts: ServiceFacts): 'writer' | 'store' => (facts.volumes.length > 0 ? 'store' : 'writer');

/**
 * The view of the environment's configuration that acts on the stack it was renamed from: its name, its releases base (and so its lock and journal).
 * Refused when the environment declares no `deploy.renamedFrom`.
 */
export function renamedSource(config: DeployConfig, code = 'STACK_STANDBY_RENAMED_UNDECLARED'): DeployConfig {
  const from = config.renamedFrom;
  if (!from) throw refusal(code, `environments.${config.env}.deploy declares no renamedFrom: there is no old stack to act on`);
  return { ...config, stack: from.stack, remote: { ...config.remote, releasesBase: from.releasesBase }, renamedFrom: undefined };
}

/** The running tasks and the desired count of every service of the stack, by name (`docker service ls` REPLICAS, `running/desired`). */
function replicaCounts(ctx: Pick<StackContext, 'spawn'>, stack: string): Map<string, { running: number; desired: number }> {
  const run = tool(ctx, 'docker', ['service', 'ls', '--filter', `label=com.docker.stack.namespace=${stack}`, '--format', '{{.Name}} {{.Replicas}}']);
  const out = new Map<string, { running: number; desired: number }>();
  if (run.status !== 0) return out;
  for (const line of splitLines(run.stdout)) {
    const [name, replicas = ''] = line.split(' ');
    const counted = /^(\d+)\/(\d+)/u.exec(replicas);
    if (name && counted) out.set(name, { running: Number(counted[1]), desired: Number(counted[2]) });
  }
  return out;
}

/** Waits until `done(counts of name)` holds for every named service, polling; returns the names still waiting when the time ran out. */
async function waitFor(ctx: Pick<StackContext, 'spawn' | 'now' | 'sleep'>, stack: string, names: string[], done: (count: { running: number; desired: number } | undefined, name: string) => boolean, seconds: number): Promise<string[]> {
  const deadline = ctx.now() + seconds * 1000;
  for (;;) {
    const counts = replicaCounts(ctx, stack);
    const waiting = names.filter((name) => !done(counts.get(name), name));
    if (waiting.length === 0 || ctx.now() >= deadline) return waiting;
    await ctx.sleep(POLL_MS);
  }
}

/** Runs one `docker service` change; the failure line, or null. */
function serviceChange(ctx: Pick<StackContext, 'spawn'>, args: string[]): string | null {
  const run = tool(ctx, 'docker', ['service', ...args]);
  return run.status === 0 ? null : `docker service ${args[0]} ${args.at(-1) ?? ''} failed: ${firstLine(run.stderr)}`;
}

/** Stops one group of services (replicated to 0, global held) and waits until none of their tasks runs. */
export async function stopGroup(ctx: StackContext, stack: string, group: ServiceFacts[], seconds: number, what: string): Promise<ActionResult> {
  const live = group.filter(isRunning);
  if (live.length === 0) return { ok: true, lines: [`${what}: nothing runs`] };
  const scaled = live.filter((facts) => facts.mode === 'replicated');
  const failures = [
    ...(scaled.length > 0 ? [serviceChange(ctx, ['scale', '--detach', ...scaled.map((facts) => `${facts.name}=0`)])] : []),
    ...live.filter((facts) => facts.mode === 'global').map((facts) => serviceChange(ctx, ['update', '--detach', '--constraint-add', STANDBY_CONSTRAINT, facts.name])),
  ].filter((line): line is string => line !== null);
  if (failures.length > 0) return { ok: false, lines: [`${what}: FAILED`, ...failures.map((line) => `  ${line}`)] };
  const waiting = await waitFor(ctx, stack, live.map((facts) => facts.name), (count) => count !== undefined && count.running === 0, seconds);
  if (waiting.length > 0) return { ok: false, lines: [`${what}: TIMEOUT after ${seconds}s, still running: ${waiting.join(', ')}`] };
  return { ok: true, lines: [`${what}: stopped ${live.map((facts) => facts.name).join(', ')}`] };
}

/** Starts one group of recorded services back (replicated to their count, global released) and waits until every task runs, which is healthy. */
export async function startGroup(ctx: StackContext, stack: string, group: StandbyService[], present: Set<string>, seconds: number, what: string): Promise<ActionResult> {
  const wanted = group.filter((service) => service.replicas > 0 && present.has(service.name));
  const missing = group.filter((service) => service.replicas > 0 && !present.has(service.name)).map((service) => `${what}: ${service.name} no longer exists; it is not started`);
  if (wanted.length === 0) return { ok: true, lines: [...missing, `${what}: nothing to start`] };
  const scaled = wanted.filter((service) => service.mode === 'replicated');
  const failures = [
    ...(scaled.length > 0 ? [serviceChange(ctx, ['scale', '--detach', ...scaled.map((service) => `${service.name}=${service.replicas}`)])] : []),
    ...wanted.filter((service) => service.mode === 'global').map((service) => serviceChange(ctx, ['update', '--detach', '--constraint-rm', STANDBY_CONSTRAINT, service.name])),
  ].filter((line): line is string => line !== null);
  if (failures.length > 0) return { ok: false, lines: [...missing, `${what}: FAILED`, ...failures.map((line) => `  ${line}`)] };
  const expected = new Map(wanted.map((service) => [service.name, service]));
  const waiting = await waitFor(ctx, stack, wanted.map((service) => service.name), (count, name) => {
    const service = expected.get(name);
    if (!count || !service) return false;
    return count.desired > 0 && count.running === count.desired && (service.mode === 'global' || count.desired === service.replicas);
  }, seconds);
  if (waiting.length > 0) return { ok: false, lines: [...missing, `${what}: TIMEOUT after ${seconds}s, not running and healthy: ${waiting.join(', ')}`] };
  return { ok: true, lines: [...missing, `${what}: running and healthy ${wanted.map((service) => service.name).join(', ')}`] };
}

/** Sets the router label of every service that carries one to `value(service)`; services without the label keep their spec. */
export function setRoutes(ctx: Pick<StackContext, 'spawn'>, services: { name: string; labels: Record<string, string> }[], value: (service: { name: string; labels: Record<string, string> }) => string | null, what: string): ActionResult {
  const lines: string[] = [];
  let ok = true;
  for (const service of services) {
    const next = value(service);
    if (next === null || service.labels[ROUTER_LABEL] === undefined) continue;
    const failed = serviceChange(ctx, ['update', '--detach', '--label-add', `${ROUTER_LABEL}=${next}`, service.name]);
    if (failed) { ok = false; lines.push(`  ${failed}`); } else lines.push(`${what}: ${service.name} ${ROUTER_LABEL}=${next}`);
  }
  if (lines.length === 0) lines.push(`${what}: no service carries ${ROUTER_LABEL} (an own ingress stops with its stack)`);
  return { ok, lines };
}

/**
 * The newest standby or resume of a journal (oldest first): an attempt that recorded a standby (a `standby`, or the rollback of an adopted release that put
 * this stack in standby) with its record, or a finished resume; null when there is none.
 */
export function lastQuiet(documents: readonly Record<string, unknown>[]): { attempt: string; kind: 'standby' | 'resume'; standby: StandbyRecord | null } | null {
  for (const document of [...documents].reverse()) {
    if (typeof document.standby === 'object' && document.standby !== null && Array.isArray((document.standby as StandbyRecord).services)) {
      return { attempt: String(document.attempt), kind: 'standby', standby: document.standby as StandbyRecord };
    }
    if (document.kind === 'resume' && document.outcome === 'done') return { attempt: String(document.attempt), kind: 'resume', standby: null };
  }
  return null;
}

/**
 * The record of a standby from the services as they run now. A service a standby that did not finish already stopped takes its count from that earlier
 * record, so a second standby never records a 0 that resume would keep. Stop order: writers, then stores.
 */
export function standbyRecord(ctx: Pick<StackContext, 'now'>, facts: ServiceFacts[], earlier: StandbyRecord | null): StandbyRecord {
  const before = new Map((earlier?.services ?? []).map((service) => [service.name, service]));
  const services = facts.map((service): StandbyService => {
    const prior = isRunning(service) ? undefined : before.get(service.name);
    return prior ?? { name: service.name, mode: service.mode, replicas: service.replicas, role: roleOf(service), labels: service.labels };
  });
  const order = (role: string): number => (role === 'writer' ? 0 : 1);
  return { at: new Date(ctx.now()).toISOString(), services: services.sort((a, b) => order(a.role) - order(b.role) || a.name.localeCompare(b.name)) };
}

/** The standby steps under an open attempt (or none, inside another attempt): writers, then stores, then the routes. */
export async function quietStack(ctx: StackContext, config: DeployConfig, record: StandbyRecord, seconds: number, rec: Recorder | null): Promise<ActionResult> {
  const facts = new Map(stackServiceFacts(ctx, config.stack).map((service) => [service.name, service]));
  const of = (role: string): ServiceFacts[] => record.services.filter((service) => service.role === role).map((service) => facts.get(service.name)).filter((service): service is ServiceFacts => service !== undefined);
  const lines: string[] = [];
  const steps: [string, () => Promise<ActionResult> | ActionResult][] = [
    ['stop-writers', () => stopGroup(ctx, config.stack, of('writer'), seconds, 'writers')],
    ['stop-stores', () => stopGroup(ctx, config.stack, of('store'), seconds, 'stores')],
    ['routes-off', () => setRoutes(ctx, record.services, (service) => (service.labels[ROUTER_LABEL] === 'false' ? null : 'false'), 'routes')],
  ];
  for (const [name, step] of steps) {
    const done = rec ? await rec.phase(name, step, (result) => result.ok) : await step();
    lines.push(...done.lines);
    if (!done.ok) return { ok: false, lines: [...lines, `standby of ${config.stack} stopped at ${name}`] };
  }
  return { ok: true, lines };
}

/** The resume steps under an open attempt: stores back and healthy, writers back and healthy, then the routes as they were. */
export async function wakeStack(ctx: StackContext, config: DeployConfig, record: StandbyRecord, seconds: number, rec: Recorder | null): Promise<ActionResult> {
  const present = new Set(stackServiceFacts(ctx, config.stack).map((service) => service.name));
  const lines: string[] = [];
  const of = (role: string): StandbyService[] => record.services.filter((service) => service.role === role);
  const steps: [string, () => Promise<ActionResult> | ActionResult][] = [
    ['start-stores', () => startGroup(ctx, config.stack, of('store'), present, seconds, 'stores')],
    ['start-writers', () => startGroup(ctx, config.stack, of('writer'), present, seconds, 'writers')],
    ['routes-on', () => setRoutes(ctx, record.services.filter((service) => present.has(service.name)), (service) => service.labels[ROUTER_LABEL] ?? null, 'routes')],
  ];
  for (const [name, step] of steps) {
    const done = rec ? await rec.phase(name, step, (result) => result.ok) : await step();
    lines.push(...done.lines);
    if (!done.ok) return { ok: false, lines: [...lines, `resume of ${config.stack} stopped at ${name}`] };
  }
  return { ok: true, lines };
}

/** Opens the runner and the release store of `config` (its releases base, lock and journal). */
function openStore(ctx: StackContext, config: DeployConfig, options: StandbyOptions, deps: StandbyDeps): { store: ReleaseStore; close: () => void } {
  const run = deps.ssh ?? ownerSshRunner(ctx, config, { sshCmd: options.sshCmd ?? null });
  const store = deps.releaseStore ? deps.releaseStore(config, run) : createReleaseStore(config, run, { gated: gateIsOn(ctx.env) });
  return { store, close: () => { if (!deps.ssh) run.cleanup?.(); } };
}

const describe = (record: StandbyRecord): string[] => record.services.map((service) => `  ${service.role.padEnd(6)} ${service.name}  ${service.mode === 'global' ? 'global' : `replicas ${service.replicas}`}${service.labels[ROUTER_LABEL] === undefined ? '' : `  ${ROUTER_LABEL}=${service.labels[ROUTER_LABEL]}`}`);

/** Resumes the stack of `config` from the newest standby record of its own journal, as one recorded attempt under its lock (also the rollback of an adopted release). */
export async function resumeRecorded(ctx: StackContext, config: DeployConfig, store: ReleaseStore, options: StandbyOptions): Promise<ActionResult> {
  const seconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  return recordedAttempt(ctx, config, store, { kind: 'resume', trigger: 'dispatch' }, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
    const last = await rec.phase('journal', async () => lastQuiet(await store.journals()));
    if (!last || last.kind !== 'standby' || !last.standby) throw refusal('STACK_RESUME_NO_STANDBY', `the journal of ${config.stack} holds no standby since its last resume: nothing to give back (it runs as it is)`);
    const woke = await wakeStack(ctx, config, last.standby, seconds, rec);
    return { ok: woke.ok, lines: [`resume of ${config.stack} from the standby ${last.attempt}`, ...woke.lines, ...(woke.ok ? [`resumed ${config.stack}`] : [])], data: { stack: config.stack, standby: last.attempt } };
  });
}

/**
 * `stack standby`: the plan (the services, their role and what each step changes) without --execute; with it one recorded attempt under the deploy lock that
 * records the services first and then stops writers, stores and routes, in that order. Refused when nothing of the stack runs.
 */
export async function standbyStack(ctx: StackContext, config: DeployConfig, options: StandbyOptions = {}, deps: StandbyDeps = {}): Promise<ActionResult> {
  const target = options.renamedFrom === true ? renamedSource(config) : config;
  const seconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const facts = stackServiceFacts(ctx, target.stack);
  if (facts.length === 0) throw refusal('STACK_STANDBY_NO_SERVICES', `stack ${target.stack} has no service on this swarm; nothing to stand by`);
  if (!facts.some(isRunning)) throw refusal('STACK_STANDBY_ALREADY', `every service of ${target.stack} is already stopped: it is in standby (stack resume --env ${config.env}${options.renamedFrom ? ' --renamed-from' : ''} gives it back from the recorded standby)`);
  if (options.execute !== true) {
    const plan = standbyRecord(ctx, facts, null);
    return { ok: true, lines: [`dry run: standby of ${target.stack} would stop the writers, then the stores, then set ${ROUTER_LABEL}=false, recording:`, ...describe(plan), `then: stack resume --env ${config.env}${options.renamedFrom ? ' --renamed-from' : ''} --execute gives it back in start order`], data: { stack: target.stack, executed: false, standby: plan } };
  }
  const { store, close } = openStore(ctx, target, options, deps);
  try {
    return await recordedAttempt(ctx, target, store, { kind: 'standby', trigger: 'dispatch' }, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
      const earlier = await rec.phase('journal', async () => lastQuiet(await store.journals()));
      const record = standbyRecord(ctx, stackServiceFacts(ctx, target.stack), earlier?.kind === 'standby' ? earlier.standby : null);
      rec.note({ standby: record });
      const quiet = await quietStack(ctx, target, record, seconds, rec);
      return { ok: quiet.ok, lines: [`standby of ${target.stack}:`, ...describe(record), ...quiet.lines, ...(quiet.ok ? [`${target.stack} is in standby: no task runs and its routes are off`] : [])], data: { stack: target.stack, executed: true, standby: record } };
    });
  } finally {
    close();
  }
}

/** `stack resume`: the plan from the newest standby record without --execute; with it the recorded resume (stores, writers, routes; each waits for healthy). */
export async function resumeStack(ctx: StackContext, config: DeployConfig, options: StandbyOptions = {}, deps: StandbyDeps = {}): Promise<ActionResult> {
  const target = options.renamedFrom === true ? renamedSource(config) : config;
  const { store, close } = openStore(ctx, target, options, deps);
  try {
    if (options.execute !== true) {
      const last = lastQuiet(await store.journals());
      if (!last || last.kind !== 'standby' || !last.standby) throw refusal('STACK_RESUME_NO_STANDBY', `the journal of ${target.stack} holds no standby since its last resume: nothing to give back`);
      return { ok: true, lines: [`dry run: resume of ${target.stack} from the standby ${last.attempt} would start the stores, wait for healthy, start the writers, wait for healthy, then restore the routes:`, ...describe(last.standby)], data: { stack: target.stack, executed: false, standby: last.attempt } };
    }
    return await resumeRecorded(ctx, target, store, options);
  } finally {
    close();
  }
}
