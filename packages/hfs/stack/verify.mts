// verify.mjs - functional verification after convergence: the declared HTTP journeys (config.verify.http) and the declared checks inside a
// running task (config.verify.exec). Probes are bounded and read-only; a POST body comes only from the declared config and nothing here
// mutates business data. HTTP goes through ctx.fetch, docker through ctx.spawn, waits through ctx.sleep and time through ctx.now.
import { isDeepStrictEqual } from 'node:util';
import { eachInOrder, repeatInOrder } from '../runtime/scripts/lib/in-order.mjs';
import type { DeployConfig, ExecCheck, HttpCheck } from './config.mjs';
import { lines as splitLines, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { edgeAttachmentsOf, verifyEdgeAttachment } from './edge-alias.mjs';
import type { EdgeAttachment } from './edge-alias.mjs';
import type { ActionResult } from './remote.mjs';

/** The record of one check. */
interface CheckResult { name: string; ok: boolean; detail: string }

const RETRY_MS = 6000;
const HTTP_TIMEOUT_MS = 8000;

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Runs one check, retrying every 6 s up to `retrySeconds` when `retry` is set; records { name, ok, detail }. */
async function runCheck(ctx: Pick<StackContext, 'now' | 'sleep'>, results: CheckResult[], name: string, run: () => string | Promise<string>, { retry = false, retrySeconds = 0 }: { retry?: boolean; retrySeconds?: number } = {}): Promise<void> {
  const deadline = ctx.now() + (retry ? retrySeconds * 1000 : 0);
  const outcome = await repeatInOrder(async (): Promise<{ ok: boolean; detail: string } | undefined> => {
    try {
      return { ok: true, detail: await run() };
    } catch (error) {
      if (ctx.now() >= deadline) return { ok: false, detail: String((error as Error).message) };
      await ctx.sleep(RETRY_MS);
      return undefined;
    }
  });
  // repeatInOrder resolves undefined only when its attempts run out, and they never do.
  if (outcome) results.push({ name, ...outcome });
}

function checkJson(text: string, expected: Record<string, unknown>): void {
  let body: Record<string, unknown> | null;
  try { body = JSON.parse(text); } catch { throw new Error('body is not JSON'); }
  for (const [key, value] of Object.entries(expected)) expect(isDeepStrictEqual(body?.[key], value), `body.${key} is not the declared value`);
}

/** One declared HTTP journey; throws a message when the answer is not the declared one. */
async function probeHttp(ctx: StackContext, check: HttpCheck): Promise<string> {
  const init: RequestInit = { method: check.method, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) };
  if (check.body !== null) Object.assign(init, { body: check.body, headers: { 'content-type': 'application/json' } });
  const response = await ctx.fetch(check.url, init);
  expect(response.status === check.status, `HTTP ${response.status}`);
  const text = check.json === null && check.contains === null ? '' : await response.text();
  if (check.json !== null) checkJson(text, check.json);
  if (check.contains !== null) expect(text.includes(String(check.contains)), `no ${String(check.contains)} in the answer`);
  return String(response.status);
}

/** `docker exec` of a declared command in the running container; exit 0 and, when declared, stdout matching the regex. */
function probeExec(ctx: StackContext, container: string, check: ExecCheck): string {
  const run = tool(ctx, 'docker', ['exec', container, ...check.command]);
  expect(run.status === 0, `exit ${run.status}`);
  if (check.stdout === null) return 'ok';
  expect(new RegExp(check.stdout, 'u').test(run.stdout), `stdout does not match ${check.stdout}`);
  return run.stdout.trim();
}

/** The running-task check of one service, then its declared commands (skipped when no task runs). */
async function verifyService(ctx: StackContext, config: DeployConfig, results: CheckResult[], service: string): Promise<void> {
  const found = tool(ctx, 'docker', ['ps', '-q', '--filter', `label=com.docker.swarm.service.name=${config.stack}_${service}`, '--filter', 'status=running']);
  const container = splitLines(found.stdout)[0];
  await runCheck(ctx, results, `a ${service} task is running on this manager`, () => {
    expect(container, `no running container of ${config.stack}_${service} on the daemon`);
    return container.slice(0, 12);
  });
  if (!container) return;
  await eachInOrder(config.verify.exec.filter((entry) => entry.service === service), (check: ExecCheck) => runCheck(ctx, results, check.name, () => probeExec(ctx, container, check)));
}

/** Every edge-attached service carries exactly its declared aliases (never the implicit short name) on the shared external network. */
async function verifyEdge(ctx: StackContext, config: DeployConfig, results: CheckResult[], file: string): Promise<void> {
  let attachments: EdgeAttachment[];
  try {
    attachments = edgeAttachmentsOf(file);
  } catch (error) {
    results.push({ name: 'edge aliases: the stack file is readable', ok: false, detail: String((error as Error).message) });
    return;
  }
  await eachInOrder(attachments, (item: EdgeAttachment) => runCheck(ctx, results, `edge aliases of ${item.service} on ${item.network} are exactly the declared ones`, () => verifyEdgeAttachment(ctx, config, item)));
}

const verifyExec = (ctx: StackContext, config: DeployConfig, results: CheckResult[]): Promise<void> => eachInOrder([...new Set(config.verify.exec.map((check) => check.service))], (service: string) => verifyService(ctx, config, results, service));

/**
 * Runs the declared verification. Returns { ok, lines, data: { checks: [{ name, ok }] } }; the lines read `PASS|FAIL  name  detail`.
 * `skipPublic` skips the HTTP journeys, `skipInternal` the checks inside a task. `stackFile` (default: the stack source) is read for the services
 * attached to an external network: each must carry exactly its declared aliases, never the implicit short name.
 */
export async function verifyStack(ctx: StackContext, config: DeployConfig, { retrySeconds = 180, skipPublic = false, skipInternal = false, stackFile = config.stackFile }: { retrySeconds?: number | undefined; skipPublic?: boolean; skipInternal?: boolean; stackFile?: string | undefined } = {}): Promise<ActionResult> {
  const results: CheckResult[] = [];
  if (!skipPublic) await eachInOrder(config.verify.http, (check: HttpCheck) => runCheck(ctx, results, check.name, () => probeHttp(ctx, check), { retry: check.retry, retrySeconds }));
  if (!skipInternal && stackFile) await verifyEdge(ctx, config, results, stackFile);
  if (!skipInternal) await verifyExec(ctx, config, results);
  return {
    ok: results.every((entry) => entry.ok),
    lines: results.map((entry) => `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}  ${entry.detail}`),
    data: { checks: results.map(({ name, ok }) => ({ name, ok })) },
  };
}
