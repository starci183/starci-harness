// local-peers.mts - the other projects this machine knows and the ports each one holds, for the overlap row of `starci app stack doctor`, the refusal
// of `starci app stack up`, the report-only finding of `starci app check --env local` and the base `starci app scaffold` gives a new app (PROJECT-STACKS-10). Each project owns its own hundred, base..base+99, and no two overlap.
//
// Where the projects are read from: the `ledgers` table (one row per registered project, retired ones left out) of every machine registry
// this process can see: the state base's machine.sqlite (machineFileFor) and, unless STARCI_LOCAL_ROOT or the test registry pins one store,
// the machine.sqlite of the harness home (<home>/.runtime, the nearest ancestor of the app that is a harness checkout or holds one as
// `.claude`), since an app's installed CLI keeps its own state base and the projects are registered by the harness checkout's. Each project
// is read from its registered checkout and every worktree of it (`git worktree list`, lanes included): its hfs.json `project` and the dev
// environment's `local.basePort` in .starcistacks/application-stacks.yaml; a project that declares no base holds the ports its `local.ports`
// declares. A checkout that cannot be read is named, never skipped silently. Read-only: no registry or checkout is written.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { machineFileFor, TEST_REGISTRY_ENV } from '../runtime/engine/db/machine.mjs';
import { LOCAL_ROOT_ENV } from '../runtime/engine/runtime-root.mjs';
import { BASE_PORT_SPAN, basePortProblems, overlapsReserved, rangesOverlap, RESERVED_PORTS } from '../runtime/scripts/hfs/stack-base-port.mjs';
import { readYaml, STACKS_DIR, STACKS_FILE } from './config.mjs';
import type { StackContext } from './context.mjs';
import type { LocalConfig } from './local-config.mjs';
import type { Prerequisite } from './local-host.mjs';

const require = createRequire(import.meta.url);

/** Another project on this machine: its base (null when it declares none), the ports it holds without one, and the checkout they were read from. */
export interface PeerBase { project: string; repoRoot: string; basePort: number | null; ports?: number[] }
/** A registered checkout that could not be read, and why. */
export interface UnreadPeer { repoRoot: string; why: string }
/** What the machine's registries hold besides this app: the projects compared, the checkouts that could not be read, the registries read. */
export interface MachinePeers { peers: PeerBase[]; unread: UnreadPeer[]; registries: string[] }

/** True when `dir` is a harness checkout: the folder that holds cli/, ops/checks.yaml and policy/quality.yaml. */
const isHarnessCheckout = (dir: string): boolean =>
  fs.existsSync(path.join(dir, 'cli')) && fs.existsSync(path.join(dir, 'ops', 'checks.yaml')) && fs.existsSync(path.join(dir, 'policy', 'quality.yaml'));

/** The harness home of `from`: the nearest ancestor (itself included) that is a harness checkout, or whose `.claude` folder is one; null when none. */
export function harnessHomeOf(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (isHarnessCheckout(dir)) return dir;
    if (isHarnessCheckout(path.join(dir, '.claude'))) return path.join(dir, '.claude');
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The machine registries to read, existing files only: the state base's, then the harness home's unless the environment pins one store. */
export function machineRegistries(env: NodeJS.ProcessEnv, from: string): string[] {
  const own = path.resolve(machineFileFor(env));
  const pinned = Boolean(env[LOCAL_ROOT_ENV] || env[TEST_REGISTRY_ENV]);
  const home = pinned ? null : harnessHomeOf(from);
  const files = [own, ...(home ? [path.join(home, '.runtime', 'machine.sqlite')] : [])];
  return [...new Set(files.map((file) => path.resolve(file)))].filter((file) => fs.existsSync(file));
}

/** The repository roots a registry enrols (retired ledgers left out), read straight from its `ledgers` table so any schema version serves. */
function registeredRoots(file: string): string[] {
  // node:sqlite is loaded on demand, as the machine connection loads it, so a module that never reads a registry never needs it
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try { return (db.prepare("SELECT repo_root FROM ledgers WHERE state <> 'retired'").all() as Array<{ repo_root: string }>).map((row) => row.repo_root); }
  finally { db.close(); }
}

/** The checkouts of the repository at `root`: itself and every worktree git lists (lanes included); itself alone when git cannot list them. */
function checkoutsOf(root: string): string[] {
  const listed = spawnSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', windowsHide: true });
  const worktrees = listed.status === 0 ? listed.stdout.split(/\r?\n/u).filter((line) => line.startsWith('worktree ')).map((line) => path.resolve(line.slice('worktree '.length))) : [];
  return [...new Set([path.resolve(root), ...worktrees])];
}

/** What one checkout declares for environment `env`: its project, its base, the ports it declares. */
function declarationOf(checkout: string, env: string): { project: string; basePort: number | null; ports: number[] } {
  const project = String(JSON.parse(fs.readFileSync(path.join(checkout, 'hfs.json'), 'utf8')).project);
  const declaration = readYaml(path.join(checkout, STACKS_DIR, STACKS_FILE), STACKS_FILE);
  const local = declaration?.environments?.[env]?.local ?? {};
  const ports = Object.values(local.ports ?? {}).filter((port): port is number => Number.isInteger(port));
  return { project, basePort: Number.isInteger(local.basePort) ? Number(local.basePort) : null, ports };
}

/**
 * The other projects of this machine for environment `local.env`, one per project name (a lane or worktree of this app is the app itself):
 * a project's base is the first its checkouts declare (registered checkout first), else it holds the union of the ports they declare.
 */
export function machinePeers(ctx: Pick<StackContext, 'env'>, local: Pick<LocalConfig, 'repoRoot' | 'appProject' | 'env'>): MachinePeers {
  const own = path.resolve(local.repoRoot).toLowerCase();
  const registries = machineRegistries(ctx.env, local.repoRoot);
  const unread: UnreadPeer[] = [];
  const roots: string[] = [];
  for (const file of registries) {
    try { roots.push(...registeredRoots(file)); } catch (error) { unread.push({ repoRoot: file, why: `the registry could not be read (${(error as Error).message})` }); }
  }
  const byProject = new Map<string, PeerBase>();
  const seen = new Set<string>();
  for (const root of roots) {
    for (const checkout of checkoutsOf(root)) {
      const key = checkout.toLowerCase();
      if (key === own || seen.has(key)) continue;
      seen.add(key);
      let declared: ReturnType<typeof declarationOf>;
      try { declared = declarationOf(checkout, local.env); } catch (error) { unread.push({ repoRoot: checkout, why: fs.existsSync(checkout) ? `hfs.json or ${STACKS_DIR}/${STACKS_FILE} could not be read (${(error as Error).message.split('\n')[0]})` : 'the checkout no longer exists' }); continue; }
      if (declared.project === local.appProject) continue;
      const known = byProject.get(declared.project);
      if (!known) byProject.set(declared.project, { project: declared.project, repoRoot: checkout, basePort: declared.basePort, ports: declared.basePort === null ? declared.ports : [] });
      else if (known.basePort === null && declared.basePort !== null) byProject.set(declared.project, { project: declared.project, repoRoot: checkout, basePort: declared.basePort, ports: [] });
      else if (known.basePort === null) known.ports = [...new Set([...(known.ports ?? []), ...declared.ports])].sort((a, b) => a - b);
    }
  }
  return { peers: [...byProject.values()], unread, registries };
}

/** The peers whose hundred, or whose declared ports when they declare no base, fall inside base..base+99. */
export function overlapsOf(base: number, peers: readonly PeerBase[]): PeerBase[] {
  return peers.filter((peer) => (peer.basePort !== null ? rangesOverlap(base, peer.basePort) : (peer.ports ?? []).some((port) => port >= base && port < base + BASE_PORT_SPAN)));
}

/** The first base from `preferred` up (3000 .. 4900 in steps of the span, wrapping once, never the reserved preview range) that overlaps no peer; null when none is free. */
export function nextFreeBase(preferred: number, peers: readonly PeerBase[], { from = 3000, to = 4900 }: { from?: number; to?: number } = {}): number | null {
  const slots = (to - from) / BASE_PORT_SPAN + 1;
  const start = Math.max(0, Math.round((preferred - from) / BASE_PORT_SPAN));
  for (let step = 0; step < slots; step += 1) {
    const base = from + ((start + step) % slots) * BASE_PORT_SPAN;
    if (!overlapsReserved(base) && overlapsOf(base, peers).length === 0) return base;
  }
  return null;
}

/** One compared project in words: its project, what it holds and where it was read. */
export const describePeer = (peer: PeerBase): string => peer.basePort !== null
  ? `${peer.project} ${peer.basePort}..${peer.basePort + BASE_PORT_SPAN - 1} (${peer.repoRoot})`
  : `${peer.project} no basePort, ports ${(peer.ports ?? []).join(', ') || 'none'} (${peer.repoRoot})`;

/**
 * The range of `base` against the machine's other projects, the one judgement the doctor row, `app check --env local` and `stack up` share: the
 * peers it overlaps, the next free base when it does, what was compared and read, and the remedy.
 */
export interface BaseOverlap { base: number; clashes: PeerBase[]; free: number | null; compared: string; read: string; fix: string | null }

/** The overlap of `base` with `found`. */
export function baseOverlap(base: number, found: MachinePeers): BaseOverlap {
  const clashes = overlapsOf(base, found.peers);
  const free = clashes.length === 0 ? null : nextFreeBase(base, found.peers);
  return {
    base, clashes, free,
    compared: found.peers.length === 0 ? 'no other project' : found.peers.map(describePeer).join('; '),
    read: `${found.registries.length === 0 ? 'no machine registry found' : `registries ${found.registries.join(', ')}`}${found.unread.length ? `; not read: ${found.unread.map((entry) => `${entry.repoRoot} (${entry.why})`).join('; ')}` : ''}`,
    fix: clashes.length === 0 ? null : `each project owns its own hundred: change local.basePort${free === null ? '' : ` to ${free}, the next free base,`} and the ports that derive from it`,
  };
}

/** The overlap in one line: `<base>..<base+99> overlaps <peer>; ...` (or `overlaps no other project`), then what was compared and read. */
export const overlapLine = (overlap: BaseOverlap): string =>
  `${overlap.base}..${overlap.base + BASE_PORT_SPAN - 1} overlaps ${overlap.clashes.length === 0 ? 'no other project' : overlap.clashes.map(describePeer).join('; ')}; compared ${overlap.compared}; ${overlap.read}`;

/** The other projects of the machine for `local`: the seam a spec gives (`peers`), else the machine registries. */
export const peersOf = (ctx: Pick<StackContext, 'env'>, local: Pick<LocalConfig, 'repoRoot' | 'appProject' | 'env'>, peers?: () => PeerBase[]): MachinePeers =>
  peers ? { peers: peers(), unread: [], registries: [] } : machinePeers(ctx, local);

/** The doctor rows of the base port: the role table, then the overlap with every other project of the machine, naming each one compared. */
export function basePortRows(local: LocalConfig, found: MachinePeers): Prerequisite[] {
  const base = local.basePort;
  if (base === null) return [{ id: 'base port', ok: true, detail: 'not declared: declare environments.<env>.local.basePort so the ports follow the role table (R389)', fix: null }];
  const problems = basePortProblems(local);
  const rows: Prerequisite[] = [problems.length === 0
    ? { id: 'base port', ok: true, detail: `${base} (${base}..${base + BASE_PORT_SPAN - 1}): the native process and compose ports follow the role table`, fix: null }
    : { id: 'base port', ok: false, detail: problems.map((problem) => `${problem.at} ${problem.message}`).join('; '), fix: 'set the ports of environments.<env>.local.ports to the role table of PROJECT-STACKS-10 (front end base, api base+1, AI gateway base+2, further processes up to base+79, the compose services from base+80), or run starci app sync --execute' }];
  if (overlapsReserved(base)) rows.push({ id: 'port range reserved', ok: false, detail: `${base}..${base + BASE_PORT_SPAN - 1} overlaps ${RESERVED_PORTS.from}..${RESERVED_PORTS.to}, reserved for the shared UI-lane next dev preview`, fix: `change local.basePort so the range stays clear of ${RESERVED_PORTS.from}..${RESERVED_PORTS.to}` });
  const overlap = baseOverlap(base, found);
  rows.push({ id: 'port range', ok: overlap.clashes.length === 0, detail: overlapLine(overlap), fix: overlap.fix });
  return rows;
}
