// local-restart.mts - `starci app stack restart --env <dev env> --process <name>[,<name>] [--watch] [--execute] [--timeout <seconds>]`: rebuilds and
// restarts the named native processes of a running dev environment (the api, the web) and nothing else. The compose services (the database,
// the storage), their volumes, the custody files and the dev tunnel stay up untouched. Each named process is built first from the code of the
// checkout (serve mode: its `serve.build`, into the build slot the running copy does not use) while the running copy keeps serving; then it is
// started on the built artifact (its `serve.argv`; its own watcher argv only with --watch). A web behind its edge starts beside the running copy
// on a new backend port, the edge switches to it once its page passed, and only then is the old copy ended, so the tunnel never gets the
// updating page for a rebuild; any other process is ended (only when it is the one this environment started) just before its start. Each is then
// waited for: its health probe on the loopback, and, when the dev tunnel routes its port, the same path over the tunnel's public hostname, which
// is advisory (a WARN, never a failure). `starci dev sync` runs it after a dev checkout moved.
import fs from 'node:fs';
import path from 'node:path';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { openCustody } from './local-custody.mjs';
import { DEFAULT_TIMEOUT_SECONDS, buildCommand, modeOf, nextSlot, ownedProcess, probe, stateOf, stopProcess, waitFor } from './local-run.mjs';
import type { LocalDeps, ProcessMode } from './local-run.mjs';
import { readRecord, writeRecord } from './local-state.mjs';
import { buildProcess, launchProcess, processPlan } from './local-up.mjs';
import { edgeDirectory, endEarlierTrees, needsEdge, readEdgeStatus } from './local-edge.mjs';
import type { HttpProbe, LocalProcess } from '../runtime/scripts/hfs/stack-local-config.mjs';

/** The suffix of a restart probe over a tunnel hostname (restartProbes). */
const TUNNEL_SUFFIX = '-tunnel';

/** How long a restart waits for a tunnel hostname at most. */
const TUNNEL_WAIT_MS = 30_000;

/**
 * Whether a restart probe goes over a tunnel hostname. Such a probe is advisory: its failure is reported as WARN and the restart stays green, since the
 * loopback probe before it proved the process, and a route whose DNS record does not exist yet (a new tunnel route) answers 404 however often the stack
 * is brought up again; the dev sync runner retried `stack up` on it in a loop and stayed in "syncing". Pure.
 */
export const isTunnelProbe = (name: string): boolean => name.endsWith(TUNNEL_SUFFIX);

/** The probes a restarted process must pass: its loopback health, then the same path over each tunnel hostname that routes its port. Pure. */
export function restartProbes(local: LocalConfig, run: LocalProcess): HttpProbe[] {
  if (run.health === null) return [];
  const probes: HttpProbe[] = [run.health];
  if (run.port === null) return probes;
  const pathOf = (url: string): string => /^https?:\/\/[^/]+(\/.*)?$/u.exec(url)?.[1] ?? '/';
  for (const route of local.tunnel?.routes ?? []) {
    if (route.port !== run.port) continue;
    probes.push({ ...run.health, name: `${run.name}${TUNNEL_SUFFIX}`, url: `https://${route.host}${pathOf(run.health.url)}` });
  }
  return probes;
}

/** The process names of `--process` (comma separated), each one the environment declares; a refusal names the declared ones. */
export function namedProcesses(local: LocalConfig, value: string | undefined): LocalProcess[] {
  const names = (value ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '');
  const declared = local.processes.map((run) => run.name);
  if (names.length === 0) throw refusal('STACK_USAGE', `stack restart names the processes to restart with --process <name>[,<name>] (declared: ${declared.join(', ') || 'none'})`);
  const unknown = names.filter((name) => !declared.includes(name));
  if (unknown.length > 0) throw refusal('STACK_USAGE', `--process names no process of ${local.env}: ${unknown.join(', ')} (declared: ${declared.join(', ')})`);
  return local.processes.filter((run) => names.includes(run.name));
}

/** Whether the edge of `name` forwards to backend `port` now (its status file), with the edge's own detail. */
export function edgeServes(ctx: StackContext, local: LocalConfig, name: string, port: number | null): { ok: boolean; detail: string } {
  const status = readEdgeStatus(path.join(edgeDirectory(ctx, local), `${name}.status.json`));
  if (status === null) return { ok: false, detail: 'the edge wrote no status' };
  return { ok: port !== null && status.backend === port && status.live, detail: status.detail };
}

/** `restart` for a dev environment. */
export async function restartLocal(ctx: StackContext, local: LocalConfig, { execute = false, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, process: names, watch = false }: { execute?: boolean; timeoutSeconds?: number; process?: string | undefined; watch?: boolean } = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const mode: ProcessMode = watch ? 'watch' : 'serve';
  const runs = namedProcesses(local, names);
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  if (Object.keys(record.processes).length === 0) throw refusal('STACK_LOCAL_NOT_UP', `${local.env} has no running process to restart: bring the environment up first (starci app stack up --env ${local.env} --execute)`);
  const keep = 'kept up: the compose services, their volumes, the custody files and the dev tunnel';
  if (!execute) {
    return { ok: true, lines: [...runs.flatMap((run) => {
      const pid = record.processes[run.name]?.pid;
      const swap = modeOf(run, mode) === 'serve' && needsEdge(local, run);
      const stop = `plan stop ${run.name}${pid === undefined ? '' : ` (pid ${pid})`}${swap ? ' once its edge serves the new copy' : ''}`;
      return [...processPlan(run, mode), stop, ...restartProbes(local, run).map((row) => `plan wait ${row.name}: ${row.url}`)];
    }), keep, 'dry run: nothing was restarted; arm it with --execute'], data: { processes: runs.map((run) => run.name), mode } };
  }
  const custody = openCustody(ctx, local);
  const lines: string[] = [];
  const deadline = ctx.now() + timeoutSeconds * 1000;
  // One build per command, folder and slot in a restart: the api and its MCP doors share `npm run build:be` from `be`.
  const builds = new Set<string>();
  for (const run of runs) {
    const known = record.processes[run.name];
    const owned = known ? await ownedProcess(ctx, known, deps) : null;
    const slot = nextSlot(known);
    // The build runs while the running copy keeps serving: a failed build throws here and leaves it running.
    const build = buildCommand(run, mode, slot);
    if (build !== null) {
      const key = JSON.stringify([build.argv, build.cwd, slot]);
      if (builds.has(key)) lines.push(`process ${run.name}: its build (${build.argv.join(' ')}) already ran in this restart`);
      else {
        await buildProcess(ctx, local, run, custody, mode, slot);
        builds.add(key);
        lines.push(`process ${run.name}: built (slot ${slot})${owned?.ours === true && known ? ` while pid ${known.pid} kept serving` : ''}`);
      }
    }
    const swap = known !== undefined && owned?.ours === true && known.port !== null && modeOf(run, mode) === 'serve' && needsEdge(local, run);
    if (!swap) {
      if (known && owned) {
        if (owned.ours) { stopProcess(ctx, known.pid, deps); lines.push(`process ${run.name}: ended (pid ${known.pid})`); }
        else if (owned.stale !== null) lines.push(`process ${run.name}: discarded a stale record, left running: ${owned.stale}`);
        Reflect.deleteProperty(record.processes, run.name);
        writeRecord(dir, record);
      }
      lines.push(...endEarlierTrees(ctx, local, run, record, deps));
      lines.push(await launchProcess(ctx, local, run, custody, mode, record, deps, { built: true, slot }));
      writeRecord(dir, record);
      continue;
    }
    // A web behind its edge: the new copy starts beside the running one, the edge switches once its page passed, then the old copy ends.
    lines.push(...endEarlierTrees(ctx, local, run, record, deps, new Set([known.pid])));
    lines.push(await launchProcess(ctx, local, run, custody, mode, record, deps, { built: true, slot }));
    const fresh = record.processes[run.name];
    writeRecord(dir, record);
    const switched = await waitFor(ctx, deadline, async () => edgeServes(ctx, local, run.name, fresh?.port ?? null));
    if (switched.ok) {
      stopProcess(ctx, known.pid, deps);
      lines.push(`edge ${run.name}: serves backend port ${String(fresh?.port)} (${switched.detail}); process ${run.name}: ended the previous copy (pid ${known.pid})`);
      continue;
    }
    // The new copy never passed: it ends, the edge is pointed back at the running copy, and the record keeps that one.
    if (fresh) stopProcess(ctx, fresh.pid, deps);
    fs.writeFileSync(path.join(edgeDirectory(ctx, local), `${run.name}.backend.json`), `${JSON.stringify({ port: known.port })}\n`);
    record.processes[run.name] = known;
    writeRecord(dir, record);
    return { ok: false, lines: [...lines, `FAIL  edge ${run.name}: the new copy on backend port ${String(fresh?.port)} never passed (${switched.detail}); it was ended and pid ${known.pid} keeps serving on backend port ${known.port}`, `read its log with: starci app stack logs --env ${local.env} --service ${run.name}`], data: { processes: runs.map((item) => item.name), mode, failed: run.name } };
  }
  const advisory: string[] = [];
  for (const run of runs) {
    for (const row of restartProbes(local, run)) {
      const tunneled = isTunnelProbe(row.name);
      // A tunnel hostname is waited for a short while only: it fails for reasons outside the process (a DNS route not made yet), and the loopback probe already proved the process.
      const result = await waitFor(ctx, tunneled ? Math.min(deadline, ctx.now() + TUNNEL_WAIT_MS) : deadline, () => probe(ctx, local, row));
      if (!result.ok && tunneled) {
        advisory.push(row.name);
        lines.push(`WARN  ready ${result.detail} (the process answers on the loopback; its public route is not reachable yet: check the tunnel route and its DNS record, nothing is retried)`);
        continue;
      }
      lines.push(`${result.ok ? 'ok    ' : 'FAIL  '}ready ${result.detail}`);
      if (!result.ok) return { ok: false, lines: [...lines, `${run.name} is not healthy; read its log with: starci app stack logs --env ${local.env} --service ${run.name}`], data: { processes: runs.map((item) => item.name), mode, failed: row.name } };
    }
  }
  lines.push(keep);
  return { ok: true, lines, data: { processes: runs.map((run) => run.name), mode, ...(advisory.length > 0 ? { advisory } : {}) } };
}
