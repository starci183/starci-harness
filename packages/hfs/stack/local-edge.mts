// local-edge.mts - two guards of a dev environment's native processes, used by `stack up` and `stack restart` (local-up.mts launchProcess).
//
// The edge of a web. A front-end process (its cwd under fe/) whose port a dev tunnel route publishes runs behind an edge (edge-server.mts): the
// edge holds the declared port, the web itself listens on a free backend port, and the edge forwards to it only once its page probe passed (the
// page answers 200, every stylesheet it links answers 200 and, in an app on Grammar, holds Grammar's `.starci-core-icon` rule). Until then the
// tunnel gets a page saying the app is updating that reloads itself, never a page with no Grammar CSS. The edge is started once and outlives
// every restart and `dev sync` (it is no recorded process of the stack, and it runs a copy of its script from the state folder, so no install
// touches it); `stack down` ends it.
//
// One tree per process. Before a process starts, every earlier tree of the same command started from the same checkout is ended by its root
// process: a tree another state base recorded, or one whose record was lost, would otherwise keep running beside the new one (two api
// watchers of one checkout). A tree is recognised by its command line: a process that runs from the checkout (`<root>/node_modules/` or the
// process's own folder) with every literal argument of the declared argv, and its ancestors that carry the same arguments (the npx and cmd
// shims above it).
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StackContext } from './context.mjs';
import type { EdgeConfig, EdgeStatus } from './edge-server.mjs';
import type { LocalConfig } from './local-config.mjs';
import type { LocalDeps } from './local-run.mjs';
import { ownedProcess, stateOf, stopProcess } from './local-run.mjs';
import type { LocalRecord } from './local-state.mjs';
import { logFile } from './local-state.mjs';
import type { LocalProcess } from '../runtime/scripts/hfs/stack-local-config.mjs';

/** One row of the host's process table. */
export interface TableRow { pid: number; ppid: number; command: string }

/** The seams of the edge and of the tree guard a spec replaces. */
export interface EdgeDeps {
  /** The host's process table, or null when it cannot be read. */
  processTable?: (() => TableRow[] | null) | undefined;
  /** A free loopback port for a backend. */
  freePort?: (() => Promise<number>) | undefined;
  /** Starts the edge of a process and says whether it listens (the real one spawns edge-server.mjs and waits for its status). */
  startEdge?: ((config: EdgeConfig) => Promise<{ pid: number; command: string } | string>) | undefined;
}

const normal = (text: string): string => text.replaceAll('\\', '/').replaceAll(/["']/gu, '').replaceAll(/\/{2,}/gu, '/').toLowerCase();

/** The literal arguments of a declared argv: everything after the program, without the `${...}` values that change between starts. Pure. */
export const literalArguments = (argv: readonly string[]): string[] => argv.slice(1).filter((part) => !part.includes('${'));

/**
 * The root pids of the earlier trees of a process in the table: each process that runs from the checkout with every literal argument, climbed
 * to its topmost ancestor that still carries them all; never `keep` (this command and what it must not end) nor an ancestor of it. Pure.
 */
export function earlierTrees(table: readonly TableRow[], repoRoot: string, run: Pick<LocalProcess, 'argv' | 'cwd'>, keep: ReadonlySet<number>): number[] {
  const words = literalArguments(run.argv).map(normal);
  if (words.length === 0) return [];
  const root = normal(repoRoot).replace(/\/$/u, '');
  const homes = [`${root}/node_modules/`, `${root}/${normal(run.cwd).replace(/^\.\/?/u, '').replace(/\/$/u, '')}/`].filter((home) => !home.endsWith('//'));
  const byPid = new Map(table.map((row) => [row.pid, row]));
  const carries = (row: TableRow): boolean => { const line = normal(row.command); return words.every((word) => line.includes(word)); };
  const roots = new Set<number>();
  for (const row of table) {
    const line = normal(row.command);
    if (!homes.some((home) => line.includes(home)) || !carries(row)) continue;
    let top = row;
    for (let parent = byPid.get(top.ppid); parent !== undefined && parent.pid !== top.pid && carries(parent); parent = byPid.get(top.ppid)) top = parent;
    roots.add(top.pid);
  }
  const guarded = new Set<number>();
  for (const pid of keep) for (let row = byPid.get(pid); row !== undefined && !guarded.has(row.pid); row = byPid.get(row.ppid)) guarded.add(row.pid);
  return [...roots].filter((pid) => !guarded.has(pid));
}

/** The host's process table: PowerShell CIM on Windows, ps elsewhere; null when it cannot be read. */
export function readProcessTable(ctx: Pick<StackContext, 'spawn' | 'platform'>): TableRow[] | null {
  if (ctx.platform === 'win32') {
    const result = ctx.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress']);
    if (result.error || result.status !== 0) return null;
    try {
      const parsed = JSON.parse(result.stdout) as unknown;
      const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ ProcessId?: number; ParentProcessId?: number; CommandLine?: string | null }>;
      return rows.filter((row) => typeof row.ProcessId === 'number').map((row) => ({ pid: row.ProcessId as number, ppid: row.ParentProcessId ?? 0, command: row.CommandLine ?? '' }));
    } catch { return null; }
  }
  const result = ctx.spawn('ps', ['-eo', 'pid=,ppid=,args=']);
  if (result.error || result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line)).filter((match) => match !== null).map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }));
}

/** Ends every earlier tree of `run` started from this checkout (earlierTrees); the lines saying which. */
export function endEarlierTrees(ctx: StackContext, local: LocalConfig, run: LocalProcess, record: LocalRecord, deps: LocalDeps & EdgeDeps): string[] {
  const table = (deps.processTable ?? (() => readProcessTable(ctx)))();
  if (table === null) return [`process ${run.name}: the process table could not be read, so no earlier tree of this checkout was looked for`];
  const keep = new Set<number>([process.pid, ...Object.values(record.edges ?? {}).map((edge) => edge.pid)]);
  const roots = earlierTrees(table, local.repoRoot, run, keep);
  for (const pid of roots) stopProcess(ctx, pid, deps);
  return roots.length === 0 ? [] : [`process ${run.name}: ended ${roots.length === 1 ? 'an earlier tree' : `${roots.length} earlier trees`} of this checkout still running (root pid ${roots.join(', ')})`];
}

/** The edge a process runs behind: a front-end process (cwd under fe/) whose port a dev tunnel route publishes. Pure. */
export const needsEdge = (local: Pick<LocalConfig, 'tunnel'>, run: Pick<LocalProcess, 'port' | 'cwd'>): boolean =>
  run.port !== null && /^(\.\/)?fe(\/|$)/u.test(run.cwd.replaceAll('\\', '/')) && (local.tunnel?.routes ?? []).some((route) => route.port === run.port);

/** The rule an app on Grammar must serve in its CSS before its page is whole, or null for an app without Grammar. */
export const grammarMarker = (repoRoot: string): string | null => (fs.existsSync(path.join(repoRoot, 'node_modules', '@starci', 'grammar')) ? '.starci-core-icon' : null);

/** The folder of an environment's edges under its state folder. */
export const edgeDirectory = (ctx: StackContext, local: LocalConfig): string => path.join(stateOf(ctx, local), 'edge');

const SCRIPT = fileURLToPath(new URL('./edge-server.mjs', import.meta.url));

/** The digest of the edge script this hfs ships: an edge started from another one is replaced. */
const scriptDigest = (): string => { try { return crypto.createHash('sha256').update(fs.readFileSync(SCRIPT)).digest('hex').slice(0, 16); } catch { return 'none'; } };

const writeJson = (file: string, value: unknown): void => {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

/** The status an edge wrote, or null. */
export function readEdgeStatus(file: string): EdgeStatus | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as EdgeStatus; } catch { return null; }
}

/** A free loopback port, picked by the OS. */
export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => { if (address !== null && typeof address === 'object') resolve(address.port); else reject(new Error('no port')); });
  });
});

/** The real edge start: the script copied into the edge folder, run detached from there, waited for until it listens (10 s). */
function realStartEdge(ctx: StackContext, dir: string, name: string): (config: EdgeConfig) => Promise<{ pid: number; command: string } | string> {
  return async (config) => {
    const script = path.join(dir, 'edge-server.mjs');
    fs.copyFileSync(SCRIPT, script);
    const configFile = path.join(dir, `${name}.config.json`);
    writeJson(configFile, config);
    fs.rmSync(config.statusFile, { force: true });
    const log = logFile(path.dirname(dir), `${name}-edge`);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const descriptor = fs.openSync(log, 'a');
    let pid: number | undefined;
    try {
      const child = ctx.spawn(process.execPath, [script, configFile], { background: true, detached: true, cwd: dir, env: ctx.env, stdio: ['ignore', descriptor, descriptor], windowsHide: true });
      pid = child.pid;
      child.unref?.();
    } finally { fs.closeSync(descriptor); }
    if (typeof pid !== 'number') return 'the edge did not start';
    for (let waited = 0; waited < 10_000; waited += 250) {
      const status = readEdgeStatus(config.statusFile);
      if (status?.listening) return { pid, command: `${process.execPath} ${script} ${configFile}` };
      if (status?.error) return status.error;
      await new Promise((done) => setTimeout(done, 250));
    }
    stopProcess(ctx, pid);
    return 'the edge did not listen within 10 s';
  };
}

/**
 * Makes sure the edge of `run` listens on its declared port, starting it when none of this script runs (an edge of another hfs is replaced),
 * and points it at `backend` when given. The line it says, and whether the edge holds the port (false: the process runs on the port itself).
 */
export async function ensureEdge(ctx: StackContext, local: LocalConfig, run: LocalProcess, record: LocalRecord, backend: number | null, deps: LocalDeps & EdgeDeps = {}): Promise<{ ok: boolean; line: string | null }> {
  const port = run.port === null ? undefined : local.ports[run.port];
  if (port === undefined) return { ok: false, line: null };
  const dir = edgeDirectory(ctx, local);
  fs.mkdirSync(dir, { recursive: true });
  const backendFile = path.join(dir, `${run.name}.backend.json`);
  const statusFile = path.join(dir, `${run.name}.status.json`);
  if (backend !== null) writeJson(backendFile, { port: backend });
  const edges = record.edges ?? {};
  record.edges = edges;
  const digest = scriptDigest();
  const known = edges[run.name];
  if (known) {
    const owned = await ownedProcess(ctx, known, deps);
    if (owned.ours && known.digest === digest) return { ok: true, line: null };
    if (owned.ours) stopProcess(ctx, known.pid, deps);
    Reflect.deleteProperty(edges, run.name);
  }
  const marker = grammarMarker(local.repoRoot);
  // The CSS marker check needs a page that links stylesheets; a health route (e.g. /health/live) answers JSON with none, so the edge never
  // went live for a web whose health url is not a page (StarCi Next's landing). With a marker the edge probes the root page.
  const probePath = marker !== null ? '/' : /^https?:\/\/[^/]+(\/[^?#]*)?/u.exec(run.health?.url ?? '')?.[1] ?? '/';
  const config: EdgeConfig = { listen: port, backendFile, statusFile, probePath, marker, title: local.project };
  const started = await (deps.startEdge ?? realStartEdge(ctx, dir, run.name))(config);
  if (typeof started === 'string') return { ok: false, line: `edge ${run.name}: not started on port ${port} (${started}); ${run.name} runs on the port itself` };
  edges[run.name] = { pid: started.pid, startedAt: new Date(ctx.now()).toISOString(), port, command: started.command, digest };
  return { ok: true, line: `edge ${run.name}: listening on port ${port} (pid ${started.pid}); it forwards only to a ${run.name} whose page${marker === null ? '' : ` and Grammar CSS (${marker})`} answered` };
}

/** Ends the edges an environment recorded (stack down); the lines saying which. */
export async function stopEdges(ctx: StackContext, record: LocalRecord, deps: LocalDeps = {}): Promise<string[]> {
  const lines: string[] = [];
  for (const [name, edge] of Object.entries(record.edges ?? {})) {
    if ((await ownedProcess(ctx, { ...edge, port: null }, deps)).ours) { stopProcess(ctx, edge.pid, deps); lines.push(`edge ${name}: ended`); }
  }
  record.edges = {};
  return lines;
}
