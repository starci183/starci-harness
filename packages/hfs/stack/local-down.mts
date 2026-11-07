// local-down.mts - `starci app stack down --env <dev env> [--execute]` (PROJECT-STACKS-6): ends the native processes this environment started and stops
// its compose project. It never removes a volume or an image, never touches a container of another project, and keeps the sealed values and
// the host-local custody files. A dry run names what would stop.
import type { StackContext } from './context.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { compose, isAlive, stateOf, stopProcess } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { readRecord, writeRecord } from './local-state.mjs';

/** `down` for a dev environment. */
export async function downLocal(ctx: StackContext, local: LocalConfig, { execute = false }: { execute?: boolean } = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  const alive = deps.alive ?? isAlive;
  const running = Object.entries(record.processes).filter(([, entry]) => alive(entry.pid));
  const lines = [`processes to end: ${running.map(([name, entry]) => `${name} (pid ${entry.pid})`).join(', ') || 'none'}`, `compose project to stop: ${local.project} (volumes and images stay)`];
  if (!execute) return { ok: true, lines: [...lines, 'dry run: nothing was stopped; arm it with --execute'], data: { processes: running.map(([name]) => name) } };
  for (const [name, entry] of running) {
    stopProcess(ctx, entry.pid, deps);
    lines.push(`process ${name}: ended`);
  }
  writeRecord(dir, { ...record, processes: {} });
  const stopped = await compose(ctx, local, ['down'], { label: 'compose down' });
  lines.push(stopped.status === 0 ? `compose ${local.project}: stopped, volumes kept` : `compose ${local.project}: down failed (${(stopped.stderr.trim().split(/\r?\n/u)[0] ?? '').slice(0, 160)})`);
  return { ok: stopped.status === 0, lines, data: { processes: running.map(([name]) => name) } };
}
