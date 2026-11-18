// local-status.mts - `starci app stack status --env <dev env>` (PROJECT-STACKS-6): desired against running. A container that exists is not status:
// each declared service must be running (and healthy where it declares health), each process alive, the migration receipt current and every
// readiness probe answering. Read-only.
import type { StackContext } from './context.mjs';
import { firstLine } from './context.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { migrationsDigest } from './local-up.mjs';
import { compose, ownedProcess, probe, stateOf } from './local-run.mjs';
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
  for (const run of local.processes) {
    const entry = record.processes[run.name];
    const owned = entry ? await ownedProcess(ctx, entry, deps) : null;
    mark(owned?.ours === true, entry && owned ? `process ${run.name}: pid ${entry.pid} ${owned.ours ? 'alive' : owned.stale === null ? 'gone' : `stale record, ${owned.stale}`}` : `process ${run.name}: not started`);
  }
  if (local.database) {
    const receipt = record.receipts.migrate;
    const current = migrationsDigest(local.repoRoot);
    mark(receipt?.digest === current, receipt ? `migrations: receipt ${receipt.digest} ${receipt.digest === current ? 'is current' : `is stale, the folder is ${current}`}` : 'migrations: no receipt');
  }
  for (const row of local.ready) { const result = await probe(ctx, local, row); mark(result.ok, `ready ${result.detail}`); }
  return { ok, lines, data: { processes: record.processes } };
}
