// local-peers.mts - the other apps this machine knows and the base port each declares, for the overlap row of `starci app stack doctor`
// (PROJECT-STACKS-10): the machine registry (machine.sqlite `ledgers`, one per registered project) names their checkouts, and each checkout's
// .starcistacks/application-stacks.yaml names `environments.<env>.local.basePort`. Read-only; a checkout that cannot be read is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { machineFileFor, readMachine } from '../runtime/engine/db/machine.mjs';
import { BASE_PORT_SPAN, basePortProblems, overlapsReserved, rangesOverlap, RESERVED_PORTS } from '../runtime/scripts/hfs/stack-base-port.mjs';
import { readYaml, STACKS_DIR, STACKS_FILE } from './config.mjs';
import type { StackContext } from './context.mjs';
import type { LocalConfig } from './local-config.mjs';
import type { Prerequisite } from './local-host.mjs';

/** Another app on this machine and the base port its environment declares. */
export interface PeerBase { project: string; repoRoot: string; basePort: number }

/** The repository roots the machine registry enrols (retired ledgers excluded); empty when the registry is absent or unreadable. */
function registeredRoots(env: NodeJS.ProcessEnv): string[] {
  try {
    const file = machineFileFor(env);
    if (!fs.existsSync(file)) return [];
    return readMachine((m) => m.listLedgers().map((ledger) => ledger.repoRoot), [] as string[], { file, env });
  } catch { return []; }
}

/** The base port environment `env` declares in the checkout at `repoRoot`, with the project name; null when it declares none. */
function peerOf(repoRoot: string, env: string): PeerBase | null {
  try {
    const declaration = readYaml(path.join(repoRoot, STACKS_DIR, STACKS_FILE), STACKS_FILE);
    const basePort = declaration?.environments?.[env]?.local?.basePort;
    if (!Number.isInteger(basePort)) return null;
    const project = String(JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')).project);
    return { project, repoRoot, basePort };
  } catch { return null; }
}

/** The other apps of this machine that declare a base port for environment `local.env`: one per project (a lane worktree of this app is the app itself). */
export function machinePeers(ctx: Pick<StackContext, 'env'>, local: Pick<LocalConfig, 'repoRoot' | 'appProject' | 'env'>): PeerBase[] {
  const own = path.resolve(local.repoRoot).toLowerCase();
  const seen = new Set<string>([local.appProject]);
  const peers: PeerBase[] = [];
  for (const root of new Set(registeredRoots(ctx.env))) {
    if (path.resolve(root).toLowerCase() === own) continue;
    const peer = peerOf(root, local.env);
    if (!peer || seen.has(peer.project)) continue;
    seen.add(peer.project);
    peers.push(peer);
  }
  return peers;
}

/** The doctor rows of the base port: the role table, then the overlap with the other apps of the machine. */
export function basePortRows(local: LocalConfig, peers: readonly PeerBase[]): Prerequisite[] {
  const base = local.basePort;
  if (base === null) return [{ id: 'base port', ok: true, detail: 'not declared: declare environments.<env>.local.basePort so the ports follow the role table (R389)', fix: null }];
  const problems = basePortProblems(local);
  const rows: Prerequisite[] = [problems.length === 0
    ? { id: 'base port', ok: true, detail: `${base} (${base}..${base + BASE_PORT_SPAN - 1}): the native process ports follow the role table`, fix: null }
    : { id: 'base port', ok: false, detail: problems.map((problem) => `${problem.at} ${problem.message}`).join('; '), fix: 'set the ports of environments.<env>.local.ports to the role table of PROJECT-STACKS-10 (front end base, api base+1, AI gateway base+2, the rest above)' }];
  const clashes = peers.filter((peer) => rangesOverlap(base, peer.basePort));
  if (overlapsReserved(base)) rows.push({ id: 'port range reserved', ok: false, detail: `${base}..${base + BASE_PORT_SPAN - 1} overlaps ${RESERVED_PORTS.from}..${RESERVED_PORTS.to}, reserved for the shared UI-lane next dev preview`, fix: `change local.basePort so the range stays clear of ${RESERVED_PORTS.from}..${RESERVED_PORTS.to}` });
  rows.push(clashes.length === 0
    ? { id: 'port range', ok: true, detail: `${base}..${base + BASE_PORT_SPAN - 1} overlaps no other app of this machine (${peers.length} with a base port checked)`, fix: null }
    : { id: 'port range', ok: false, detail: `${base}..${base + BASE_PORT_SPAN - 1} overlaps ${clashes.map((peer) => `${peer.project} (${peer.basePort}..${peer.basePort + BASE_PORT_SPAN - 1}, ${peer.repoRoot})`).join(', ')}`, fix: 'change local.basePort of one of the apps to a base at least 100 away from the other' });
  return rows;
}
