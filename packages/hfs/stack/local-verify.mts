// local-verify.mts - `starci app stack verify --env <dev env>` (PROJECT-STACKS-6): after a real start, the environment's declared journeys through its
// ingress origin: liveness, authenticated or denied requests as the app declares them under `local.verify`. A static render or a passing status
// is not verification; a stack that is not running fails here, and restart and restore stay swarm-verify concerns. Read-only.
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { isAlive, probe, stateOf } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { readRecord } from './local-state.mjs';

/** `verify` for a dev environment. */
export async function verifyLocal(ctx: StackContext, local: LocalConfig, _options: Record<string, unknown> = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  if (local.verify.length === 0) throw refusal('STACK_LOCAL_VERIFY_UNDECLARED', `environment ${local.env} declares no local.verify journey: a liveness probe alone is not verification`);
  const record = readRecord(stateOf(ctx, local));
  const alive = deps.alive ?? isAlive;
  const down = local.processes.filter((run) => !(record.processes[run.name] && alive((record.processes[run.name] as { pid: number }).pid)));
  if (down.length) return { ok: false, lines: [`FAIL  ${down.map((run) => run.name).join(', ')} not running: start the environment with starci app stack up --env ${local.env} --execute`] };
  const lines: string[] = [];
  let ok = true;
  for (const row of local.verify) {
    const result = await probe(ctx, local, row);
    ok &&= result.ok;
    lines.push(`${result.ok ? 'ok    ' : 'FAIL  '}${result.detail}`);
  }
  return { ok, lines, data: { checked: local.verify.length } };
}
