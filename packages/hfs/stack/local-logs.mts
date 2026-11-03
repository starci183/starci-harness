// local-logs.mjs - `starci app stack logs --env <dev env> --service <name> [--lines N]` (PROJECT-STACKS-6): one named process or compose service,
// bounded in lines, redacted; never the environment or the credentials.
import fs from 'node:fs';
import type { StackContext } from './context.mjs';
import { lines as splitLines } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { compose, redact, stateOf } from './local-run.mjs';
import { logFile } from './local-state.mjs';

const DEFAULT_LINES = 200;
const MAX_LINES = 2000;

/** `logs` for a dev environment. */
export async function logsLocal(ctx: StackContext, local: LocalConfig, { service, lines = DEFAULT_LINES }: { service?: string | undefined; lines?: number } = {}): Promise<ActionResult> {
  if (!service) throw refusal('STACK_LOCAL_LOGS_SERVICE', `name one process or service with --service: ${[...local.processes.map((run) => run.name), ...local.services.map((item) => item.name)].join(', ')}`);
  if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LINES) throw refusal('STACK_LOCAL_LOGS_LINES', `--lines is a whole number from 1 to ${MAX_LINES}`);
  let text: string;
  if (local.processes.some((run) => run.name === service)) {
    try { text = fs.readFileSync(logFile(stateOf(ctx, local), service), 'utf8'); } catch { text = ''; }
  } else if (local.services.some((item) => item.name === service)) {
    text = (await compose(ctx, local, ['logs', '--no-color', '--tail', String(lines), service])).stdout;
  } else throw refusal('STACK_LOCAL_LOGS_SERVICE', `${service} is neither a process nor a service of ${local.env}`);
  const tail = splitLines(text).slice(-lines).map(redact);
  return { ok: true, lines: tail.length ? tail : [`${service}: no log lines yet`], data: { service, count: tail.length } };
}
