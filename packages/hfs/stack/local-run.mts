// local-run.mts - what the dev verbs share: the compose command line of an environment, governed heavy runs, native process control,
// HTTP probes and the redaction of logs. Nothing here prints a value; every command is an argv list run without a shell.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { firstLine } from './context.mjs';
import { materializedDirectory } from '../runtime/scripts/hfs/secret-files.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { failure, refusal } from './errors.mjs';
import type { LocalConfig } from './local-config.mjs';
import { fileEnvironment, grantDirectory } from './local-custody.mjs';
import type { Custody } from './local-custody.mjs';
import { hostTool, launch } from './local-host.mjs';
import type { HostDeps } from './local-host.mjs';
import { tcpOpen } from './local-ports.mjs';
import type { PeerBase } from './local-peers.mjs';
import { logFile, stateDirectory } from './local-state.mjs';
import { expandPorts } from '../runtime/scripts/hfs/stack-local-config.mjs';
import type { HttpProbe, LocalCommand, LocalProcess } from '../runtime/scripts/hfs/stack-local-config.mjs';

/** The seams a spec replaces besides the context's own. */
export interface LocalDeps extends HostDeps {
  alive?: ((pid: number) => boolean) | undefined;
  kill?: ((pid: number) => void) | undefined;
  /** The live command line of a process id, or null when the host cannot tell (a spec replaces it). */
  commandLine?: ((pid: number) => string | null) | undefined;
  tcpOpen?: ((port: number) => Promise<boolean>) | undefined;
  /** The other projects of the machine (the doctor's overlap row); the machine registries when absent (local-peers.mts machinePeers). */
  peers?: (() => PeerBase[]) | undefined;
  migrate?: ((urlEnv: string, env: NodeJS.ProcessEnv, cwd: string) => Promise<number>) | undefined;
  /** `starci app db adopt` of the started database: the report lines it printed are pushed on `report`; the exit code. */
  adopt?: ((urlEnv: string, env: NodeJS.ProcessEnv, cwd: string, report: string[]) => Promise<number>) | undefined;
}

export const DEFAULT_TIMEOUT_SECONDS = 180;
export const stateOf = (ctx: StackContext, local: LocalConfig): string => stateDirectory(ctx.env, local.project, local.env);

/** The data directory of the environment under its state directory (`${data}` in a declared value, `STACK_DATA_DIR` in compose). */
export const dataOf = (ctx: StackContext, local: LocalConfig): string => path.join(stateOf(ctx, local), 'data');

/** Expands `${port.<name>}` and `${data}` in a declared value. */
export const expand = (ctx: StackContext, local: LocalConfig, value: string): string => expandPorts(value, local.ports).replaceAll('${data}', dataOf(ctx, local).replaceAll('\\', '/'));

/** Creates the declared data directories. */
export function makeDataDirectories(ctx: StackContext, local: LocalConfig): void {
  for (const name of local.dirs) fs.mkdirSync(path.join(dataOf(ctx, local), name), { recursive: true });
}

/** `STACK_PORT_<NAME>` for every declared port: the names compose files interpolate (`127.0.0.1:${STACK_PORT_DB}:5432`). */
export const portEnvironment = (ports: Readonly<Record<string, number>>): Record<string, string> =>
  Object.fromEntries(Object.entries(ports).map(([name, port]) => [`STACK_PORT_${name.toUpperCase().replaceAll('-', '_')}`, String(port)]));

/** `STACK_GRANT_<NAME>` for every least grant: the private directory a compose service mounts to read only its own keys. */
export function grantEnvironment(ctx: StackContext, local: LocalConfig): Record<string, string> {
  if (local.grants.length === 0) return {};
  const directory = materializedDirectory(local.repoRoot, local.env, ctx.env, ctx.platform);
  return Object.fromEntries(local.grants.map((grant) => [`STACK_GRANT_${grant.name.toUpperCase().replaceAll('-', '_')}`, grantDirectory(directory, grant.name).replaceAll('\\', '/')]));
}

/** The docker compose argv of the environment's project and files. */
export const composeArgs = (local: LocalConfig, args: readonly string[]): string[] =>
  ['compose', '-p', local.project, ...local.composeFiles.flatMap((file) => ['-f', file]), ...args];

/** Runs one docker compose command; `values` are the compose-interpolated custody values, passed in memory only. */
export async function compose(ctx: StackContext, local: LocalConfig, args: readonly string[], { values = {}, heavy = false, label = `compose ${args[0]}`, input }: { values?: Record<string, string>; heavy?: boolean; label?: string; input?: string } = {}): Promise<RunResult> {
  const bare = local.composeEnv.filter((item) => !Object.hasOwn(values, item.name)).map((item) => item.name);
  // A command that creates or enters a container needs the real values; the others only interpolate the file, where a placeholder does.
  if (bare.length && ['up', 'exec', 'run', 'create', 'start', 'restart'].includes(String(args[0]))) throw refusal('STACK_LOCAL_COMPOSE_VALUES', `docker compose ${String(args[0])} needs the custody values of ${bare.join(', ')}`);
  const env = { ...ctx.env, ...portEnvironment(local.ports), ...grantEnvironment(ctx, local), STACK_DATA_DIR: dataOf(ctx, local).replaceAll('\\', '/'), ...Object.fromEntries(bare.map((name) => [name, 'placeholder'])), ...values };
  const argv = composeArgs(local, args);
  if (heavy && ctx.heavy) return ctx.heavy({ kind: 'build', label: `${local.project} ${label}`, cwd: local.repoRoot, argv: ['docker', ...argv], env });
  return ctx.spawn('docker', argv, { cwd: local.repoRoot, env, ...(input === undefined ? {} : { input }) });
}

/** The compose-interpolated values of the environment (the keys `composeEnv` maps), from the opened custody. */
export function composeValues(local: LocalConfig, custody: Custody | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const item of local.composeEnv) {
    const value = custody?.values.get(item.key);
    if (value !== undefined) values[item.name] = value;
  }
  return values;
}

/** The `files` key a run lists to receive the environment's owner connection string as `DATABASE_OWNER_URL_FILE`. */
export const OWNER_URL_KEY = 'DATABASE_OWNER_URL';

/** The environment a command or process runs with: ports expanded, custody as `<KEY>_FILE`, the database URL as the environment declares. */
export function runEnvironment(ctx: StackContext, local: LocalConfig, run: LocalCommand, custody: Custody | null, role: 'owner' | 'app' | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...ctx.env, ...portEnvironment(local.ports) };
  for (const [key, value] of Object.entries(run.env)) env[key] = expand(ctx, local, value);
  if (custody) Object.assign(env, fileEnvironment(custody, run.files));
  const url = custody && role ? databaseUrl(local, custody, role) : null;
  if (local.database && url !== null && custody) {
    if (local.database.urlAs === 'env') env[local.database.urlEnv] = url;
    else {
      const file = path.join(custody.directory, local.database.urlEnv);
      fs.writeFileSync(file, url, { mode: 0o600 });
      env[`${local.database.urlEnv}_FILE`] = file;
    }
  }
  // The environment's OWNER connection reaches only a run that lists `DATABASE_OWNER_URL` in `files`: the whole-database store of a
  // seed-backup (PROJECT-STACKS-13) reads every table past row level security and restores with session_replication_role, which the
  // app role may not; the app role is never widened for it.
  if (custody && local.database && run.files.includes(OWNER_URL_KEY)) {
    const owner = databaseUrl(local, custody, 'owner');
    if (owner !== null) {
      const file = path.join(custody.directory, OWNER_URL_KEY);
      fs.writeFileSync(file, owner, { mode: 0o600 });
      env[`${OWNER_URL_KEY}_FILE`] = file;
    }
  }
  // A further database reaches only the runs that list its URL key in `files` (the owner of the connection).
  if (custody && role) {
    for (const database of local.databases) {
      if (!run.files.includes(database.urlEnv)) continue;
      const other = connectionUrl(local, custody, database);
      if (other === null) continue;
      if (database.urlAs === 'env') env[database.urlEnv] = other;
      else {
        const file = path.join(custody.directory, database.urlEnv);
        fs.writeFileSync(file, other, { mode: 0o600 });
        env[`${database.urlEnv}_FILE`] = file;
      }
    }
  }
  return env;
}

/** The loopback connection string of a further database's own role, built in memory from custody (the password key is its own). */
export function connectionUrl(local: LocalConfig, custody: Custody, database: LocalConfig['databases'][number]): string | null {
  const password = custody.values.get(database.password.key);
  if (!password) return null;
  return `postgresql://${database.role}:${encodeURIComponent(password)}@127.0.0.1:${local.ports[database.port]}/${database.name}`;
}

/** The loopback connection string of the environment's own database role, built in memory from custody. */
export function databaseUrl(local: LocalConfig, custody: Custody, role: 'owner' | 'app' = 'owner'): string | null {
  const database = local.database;
  if (!database) return null;
  const app = role === 'app' && database.appRole !== null && database.appPassword !== null;
  const user = app ? database.appRole : database.role;
  const password = custody.values.get(app ? (database.appPassword as { key: string }).key : database.password.key);
  if (!password) return null;
  return `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${local.ports[database.port]}/${database.name}`;
}

const launcher = (ctx: Pick<StackContext, 'platform'>, argv: readonly string[]): [string, string[]] => launch(ctx.platform, argv[0] ?? '', argv.slice(1));

/**
 * How a native process runs: `serve` (the default) builds the code of the checkout once and runs the built artifact, never a watcher, so
 * a merge on dev never hot-reloads a half-written tree; `watch` runs the process's own `argv` (next dev, ts-node-dev), the explicit opt-in
 * for live coding (`stack up --watch`, `stack restart --watch`). A process that declares no `serve` runs its `argv` in both modes.
 */
export type ProcessMode = 'serve' | 'watch';

/** The mode a process actually runs in: `serve` only when it declares a built mode. */
export const modeOf = (run: LocalProcess, mode: ProcessMode): ProcessMode => (mode === 'serve' && run.serve !== null ? 'serve' : 'watch');

/** The command a process is launched with in `mode`: its `serve.argv` (from `serve.cwd`, else its own cwd), or its own argv. */
export const launchedCommand = (run: LocalProcess, mode: ProcessMode): LocalProcess =>
  modeOf(run, mode) === 'serve' && run.serve !== null ? { ...run, argv: run.serve.argv, cwd: run.serve.cwd ?? run.cwd } : run;

/** The build of a process in serve mode (heavy class build, from `serve.build.cwd`, else the process's cwd), or null when it has none. */
export const buildCommand = (run: LocalProcess, mode: ProcessMode): LocalCommand | null => {
  const build = modeOf(run, mode) === 'serve' ? run.serve?.build ?? null : null;
  if (build === null) return null;
  return { name: `${run.name}-build`, argv: build.argv, cwd: build.cwd ?? run.cwd, heavy: 'build', skipIfExists: null, env: run.env, files: [], after: 'migrate' };
};

/** Runs one setup or seed command to its end, through the governor when its class is heavy. A non-zero exit is a failure naming the command and its first error line. */
export async function runCommand(ctx: StackContext, local: LocalConfig, run: LocalCommand, env: NodeJS.ProcessEnv): Promise<void> {
  const cwd = path.join(local.repoRoot, run.cwd);
  const [command, args] = launcher(ctx, run.argv.map((part) => expand(ctx, local, part)));
  const result = run.heavy !== 'none' && ctx.heavy
    ? await ctx.heavy({ kind: run.heavy, label: `${local.project} ${run.name}`, cwd, argv: [command, ...args], env })
    : ctx.spawn(command, args, { cwd, env });
  if (result.error || result.status !== 0) throw failure('STACK_LOCAL_COMMAND', `${run.name} (${run.argv.join(' ')}) failed: ${firstLine(result.stderr) || firstLine(result.stdout) || result.error?.message || `exit ${result.status}`}`);
}

/** The digest of a command's argv and cwd: the key of its receipt. */
export const commandDigest = (run: LocalCommand): string => createHash('sha256').update(JSON.stringify([run.argv, run.cwd, run.env])).digest('hex').slice(0, 16);

/** True when `pid` is alive. */
export const isAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** The command line a native process is launched with (executable and arguments, as spawned): what its record keeps to recognise it again. */
export function processCommand(ctx: StackContext, local: LocalConfig, run: LocalCommand): string {
  const [command, args] = launcher(ctx, run.argv.map((part) => expand(ctx, local, part)));
  return [command, ...args].join(' ');
}

/** The command line of a live process: PowerShell CIM on Windows, ps elsewhere; null when it cannot be read. */
export function liveCommandLine(ctx: Pick<StackContext, 'spawn' | 'platform'>, pid: number): string | null {
  const result = ctx.platform === 'win32'
    ? ctx.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}').CommandLine`])
    : ctx.spawn('ps', ['-p', String(Math.trunc(pid)), '-o', 'args=']);
  if (result.error || result.status !== 0) return null;
  const text = result.stdout.trim();
  return text === '' ? null : text;
}

const normalize = (text: string): string => text.replaceAll(/["']/gu, '').replaceAll('\\', '/').toLowerCase();
const baseName = (command: string): string => normalize(command).split('/').pop()?.replace(/\.(exe|cmd|bat)$/u, '') ?? '';

/** True when a live command line is the recorded one: the same executable and every recorded argument present (quoting and slashes aside). */
export function sameCommand(recorded: string, live: string): boolean {
  const tokens = recorded.split(/\s+/u).filter((token) => token !== '');
  const [executable, ...rest] = tokens;
  if (executable === undefined) return true;
  const haystack = normalize(live);
  return haystack.includes(baseName(executable)) && rest.every((token) => haystack.includes(normalize(token)));
}

/** A recorded process, judged against the host. */
export interface Ownership { ours: boolean; /** Why a live pid is not ours (the log line); null when ours or simply gone. */ stale: string | null }

/**
 * Whether the process a record names is still the one this environment started. A pid alone proves nothing: Windows reuses ids after a reboot or crash,
 * so a live pid counts only when its command line is still the recorded one AND its declared port listens (a process younger than the startup window
 * may still be booting). A record from before command lines were kept is judged by the port alone; with neither the pid is trusted.
 */
export async function ownedProcess(ctx: StackContext, entry: { pid: number; startedAt: string; port: number | null; command?: string | undefined }, deps: LocalDeps = {}): Promise<Ownership> {
  if (!(deps.alive ?? isAlive)(entry.pid)) return { ours: false, stale: null };
  const live = entry.command === undefined ? null : (deps.commandLine ?? ((pid: number) => liveCommandLine(ctx, pid)))(entry.pid);
  if (entry.command !== undefined && live !== null && !sameCommand(entry.command, live)) {
    return { ours: false, stale: `pid ${entry.pid} is alive but runs another command (recorded "${entry.command}", found "${live.slice(0, 160)}"): the id was reused` };
  }
  if (entry.port === null) return { ours: true, stale: null };
  if (await (deps.tcpOpen ?? tcpOpen)(entry.port)) return { ours: true, stale: null };
  const age = ctx.now() - Date.parse(entry.startedAt);
  if (Number.isFinite(age) && age < DEFAULT_TIMEOUT_SECONDS * 1000) return { ours: true, stale: null };
  return { ours: false, stale: `pid ${entry.pid} is alive but nothing listens on its port ${entry.port} (started ${entry.startedAt}): the id was reused` };
}

/** Starts a native process detached from this command, its output in the environment's log. Returns the pid. */
export function startProcess(ctx: StackContext, local: LocalConfig, run: LocalCommand, env: NodeJS.ProcessEnv): number {
  const dir = stateOf(ctx, local);
  const log = logFile(dir, run.name);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const descriptor = fs.openSync(log, 'a');
  try {
    const [command, args] = launcher(ctx, run.argv.map((part) => expand(ctx, local, part)));
    const child = ctx.spawn(command, args, { background: true, detached: true, cwd: path.join(local.repoRoot, run.cwd), env, stdio: ['ignore', descriptor, descriptor], windowsHide: true });
    const pid = child.pid;
    if (typeof pid !== 'number') throw failure('STACK_LOCAL_COMMAND', `${run.name} did not start: ${child.spawnError?.message ?? 'no process id'}`);
    child.unref?.();
    return pid;
  } finally { fs.closeSync(descriptor); }
}

/** Ends a native process and its children. */
export function stopProcess(ctx: Pick<StackContext, 'spawn' | 'platform'>, pid: number, deps: LocalDeps = {}): void {
  if (deps.kill) { deps.kill(pid); return; }
  if (ctx.platform === 'win32') { ctx.spawn('taskkill', ['/PID', String(pid), '/T', '/F']); return; }
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}

/** One HTTP probe against its expanded URL; the verdict and a detail line. */
export async function probe(ctx: StackContext, local: LocalConfig, row: HttpProbe): Promise<{ ok: boolean; detail: string }> {
  const url = expand(ctx, local, row.url);
  try {
    const response = await ctx.fetch(url, { method: row.method, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (response.status !== row.status) return { ok: false, detail: `${row.name}: ${url} answered ${response.status}, ${row.status} expected` };
    if (row.contains !== null && !(await response.text()).includes(row.contains)) return { ok: false, detail: `${row.name}: ${url} answered without the expected text` };
    return { ok: true, detail: `${row.name}: ${url} answered ${response.status}` };
  } catch (error) {
    return { ok: false, detail: `${row.name}: ${url} does not answer (${(error as Error).message})` };
  }
}

/** Polls a probe until it passes or the deadline passes. */
export async function waitFor(ctx: StackContext, deadline: number, attempt: () => Promise<{ ok: boolean; detail: string }>): Promise<{ ok: boolean; detail: string }> {
  let last = await attempt();
  while (!last.ok && ctx.now() < deadline) {
    await ctx.sleep(1000);
    last = await attempt();
  }
  return last;
}

/** The per-service readiness the environment declares: compose health, an open port, or just started. */
export async function serviceReady(ctx: StackContext, local: LocalConfig, name: string, deadline: number, deps: LocalDeps = {}): Promise<{ ok: boolean; detail: string }> {
  const service = local.services.find((item) => item.name === name);
  if (!service) return { ok: false, detail: `${name} is not a declared service` };
  return waitFor(ctx, deadline, async () => {
    const ids = await compose(ctx, local, ['ps', '-q', name]);
    const id = firstLine(ids.stdout);
    if (!id) return { ok: false, detail: `${name}: no container` };
    if (service.wait === 'tcp') return (await (deps.tcpOpen ?? tcpOpen)(local.ports[service.port as string] as number)) ? { ok: true, detail: `${name}: port ${local.ports[service.port as string]} accepts` } : { ok: false, detail: `${name}: port ${local.ports[service.port as string]} does not accept yet` };
    const inspected = ctx.spawn('docker', ['inspect', '-f', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}', id]);
    const [state, health] = firstLine(inspected.stdout).split(' ');
    if (state !== 'running') return { ok: false, detail: `${name}: ${state ?? 'unknown'}` };
    if (service.wait === 'started') return { ok: true, detail: `${name}: running` };
    if (health === 'nohealth') throw refusal('STACK_LOCAL_NO_HEALTHCHECK', `${name} declares wait: healthy but its compose service has no healthcheck: add one to the compose file, or declare wait: tcp or started`);
    return health === 'healthy' ? { ok: true, detail: `${name}: healthy` } : { ok: false, detail: `${name}: ${health}` };
  });
}

/** Masks the value of anything that reads like a credential assignment, so a log tail never carries one. */
export const redact = (line: string): string => line.replaceAll(/((?:pass(?:word)?|secret|token|credential|private[_-]?key|api[_-]?key|authorization)[\w-]*["']?\s*[=:]\s*(?:Bearer\s+)?)[^\s"',;]+/giu, '$1[redacted]');

export { hostTool };
