// local-restart.mts - `starci app stack restart --env <dev env> --process <name>[,<name>] [--watch] [--execute] [--timeout <seconds>]`: rebuilds and
// restarts the named native processes of a running dev environment (the api, the web) and nothing else. The compose services (the database,
// the storage), their volumes, the custody files and the dev tunnel stay up untouched. Each named process is ended (only when it is the one
// this environment started), built from the code of the checkout (serve mode: its `serve.build`), started on the built artifact (its
// `serve.argv`; its own watcher argv only with --watch) and waited for: its health probe on the loopback, and, when the dev tunnel routes its
// port, the same path over the tunnel's public hostname. `starci dev sync` and the batch lander run it after a dev checkout moved.
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { openCustody } from './local-custody.mjs';
import { DEFAULT_TIMEOUT_SECONDS, ownedProcess, probe, stateOf, stopProcess, waitFor } from './local-run.mjs';
import type { LocalDeps, ProcessMode } from './local-run.mjs';
import { readRecord, writeRecord } from './local-state.mjs';
import { launchProcess, processPlan } from './local-up.mjs';
import { endEarlierTrees } from './local-edge.mjs';
import type { HttpProbe, LocalProcess } from '../runtime/scripts/hfs/stack-local-config.mjs';

/** The probes a restarted process must pass: its loopback health, then the same path over each tunnel hostname that routes its port. Pure. */
export function restartProbes(local: LocalConfig, run: LocalProcess): HttpProbe[] {
  if (run.health === null) return [];
  const probes: HttpProbe[] = [run.health];
  if (run.port === null) return probes;
  const pathOf = (url: string): string => /^https?:\/\/[^/]+(\/.*)?$/u.exec(url)?.[1] ?? '/';
  for (const route of local.tunnel?.routes ?? []) {
    if (route.port !== run.port) continue;
    probes.push({ ...run.health, name: `${run.name}-tunnel`, url: `https://${route.host}${pathOf(run.health.url)}` });
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

/** `restart` for a dev environment. */
export async function restartLocal(ctx: StackContext, local: LocalConfig, { execute = false, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, process: names, watch = false }: { execute?: boolean; timeoutSeconds?: number; process?: string | undefined; watch?: boolean } = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const mode: ProcessMode = watch ? 'watch' : 'serve';
  const runs = namedProcesses(local, names);
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  if (Object.keys(record.processes).length === 0) throw refusal('STACK_LOCAL_NOT_UP', `${local.env} has no running process to restart: bring the environment up first (starci app stack up --env ${local.env} --execute)`);
  const keep = 'kept up: the compose services, their volumes, the custody files and the dev tunnel';
  if (!execute) {
    return { ok: true, lines: [...runs.flatMap((run) => [`plan stop ${run.name}${record.processes[run.name] ? ` (pid ${record.processes[run.name]?.pid})` : ''}`, ...processPlan(run, mode), ...restartProbes(local, run).map((row) => `plan wait ${row.name}: ${row.url}`)]), keep, 'dry run: nothing was restarted; arm it with --execute'], data: { processes: runs.map((run) => run.name), mode } };
  }
  const custody = openCustody(ctx, local);
  const lines: string[] = [];
  for (const run of runs) {
    const known = record.processes[run.name];
    if (known) {
      const owned = await ownedProcess(ctx, known, deps);
      if (owned.ours) { stopProcess(ctx, known.pid, deps); lines.push(`process ${run.name}: ended (pid ${known.pid})`); }
      else if (owned.stale !== null) lines.push(`process ${run.name}: discarded a stale record, left running: ${owned.stale}`);
      Reflect.deleteProperty(record.processes, run.name);
      writeRecord(dir, record);
    }
  }
  for (const run of runs) {
    lines.push(...endEarlierTrees(ctx, local, run, record, deps));
    lines.push(await launchProcess(ctx, local, run, custody, mode, record, deps));
    writeRecord(dir, record);
  }
  const deadline = ctx.now() + timeoutSeconds * 1000;
  for (const run of runs) {
    for (const row of restartProbes(local, run)) {
      const result = await waitFor(ctx, deadline, () => probe(ctx, local, row));
      lines.push(`${result.ok ? 'ok    ' : 'FAIL  '}ready ${result.detail}`);
      if (!result.ok) return { ok: false, lines: [...lines, `${run.name} is not healthy; read its log with: starci app stack logs --env ${local.env} --service ${run.name}`], data: { processes: runs.map((item) => item.name), mode, failed: row.name } };
    }
  }
  lines.push(keep);
  return { ok: true, lines, data: { processes: runs.map((run) => run.name), mode } };
}
