// local-verify.mts - `starci app stack verify --env <dev env>` (PROJECT-STACKS-6): after a real start, the environment's declared journeys through its
// ingress origin: liveness, authenticated or denied requests as the app declares them under `local.verify`. A static render or a passing status
// is not verification; a stack that is not running fails here, and restart and restore stay swarm-verify concerns. Read-only.
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { ownedProcess, probe, stateOf } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { readRecord } from './local-state.mjs';
import { probeRoutes } from './local-tunnel.mjs';

/** `verify` for a dev environment. */
export async function verifyLocal(ctx: StackContext, local: LocalConfig, _options: Record<string, unknown> = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  if (local.verify.length === 0) throw refusal('STACK_LOCAL_VERIFY_UNDECLARED', `environment ${local.env} declares no local.verify journey: a liveness probe alone is not verification`);
  const record = readRecord(stateOf(ctx, local));
  const down: typeof local.processes = [];
  for (const run of local.processes) {
    const entry = record.processes[run.name];
    if (!entry || !(await ownedProcess(ctx, entry, deps)).ours) down.push(run);
  }
  if (down.length) return { ok: false, lines: [`FAIL  ${down.map((run) => run.name).join(', ')} not running: start the environment with starci app stack up --env ${local.env} --execute`] };
  const lines: string[] = [];
  let ok = true;
  for (const row of local.verify) {
    const result = await probe(ctx, local, row);
    ok &&= result.ok;
    lines.push(`${result.ok ? 'ok    ' : 'FAIL  '}${result.detail}`);
  }
  const publicRows = await probeRoutes(ctx, local, true);
  ok &&= publicRows.every((row) => row.startsWith('ok'));
  lines.push(...publicRows);
  return { ok, lines, data: { checked: local.verify.length + publicRows.length } };
}
