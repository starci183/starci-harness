// local-status.mjs - `starci app stack status --env <dev env>` (PROJECT-STACKS-6): desired against running. A container that exists is not status:
// each declared service must be running (and healthy where it declares health), each process alive, the migration receipt current and every
// readiness probe answering. Read-only.
import type { StackContext } from './context.mjs';
import { firstLine } from './context.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { migrationsDigest } from './local-up.mjs';
import { compose, isAlive, probe, stateOf } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { readRecord } from './local-state.mjs';

/** `status` for a dev environment. */
export async function statusLocal(ctx: StackContext, local: LocalConfig, _options: Record<string, unknown> = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const record = readRecord(stateOf(ctx, local));
  const lines: string[] = [];
  let ok = true;
  const mark = (good: boolean, text: string): void => { ok &&= good; lines.push(`${good ? 'ok    ' : 'FAIL  '}${text}`); };
  for (const service of local.services) {
    const id = firstLine((await compose(ctx, local, ['ps', '-q', service.name])).stdout);
    if (!id) { mark(false, `service ${service.name}: not created`); continue; }
    const inspected = ctx.spawn('docker', ['inspect', '-f', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}', id]);
    const [state, health] = firstLine(inspected.stdout).split(' ');
    mark(state === 'running' && (service.wait !== 'healthy' || health === 'healthy'), `service ${service.name}: ${state}${health === 'nohealth' ? '' : `, ${health}`}`);
  }
  const alive = deps.alive ?? isAlive;
  for (const run of local.processes) {
    const entry = record.processes[run.name];
    mark(entry !== undefined && alive(entry.pid), entry ? `process ${run.name}: pid ${entry.pid} ${alive(entry.pid) ? 'alive' : 'gone'}` : `process ${run.name}: not started`);
  }
  if (local.database) {
    const receipt = record.receipts.migrate;
    const current = migrationsDigest(local.repoRoot);
    mark(receipt?.digest === current, receipt ? `migrations: receipt ${receipt.digest} ${receipt.digest === current ? 'is current' : `is stale, the folder is ${current}`}` : 'migrations: no receipt');
  }
  for (const row of local.ready) { const result = await probe(ctx, local, row); mark(result.ok, `ready ${result.detail}`); }
  return { ok, lines, data: { processes: record.processes } };
}
