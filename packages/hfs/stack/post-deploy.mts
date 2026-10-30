// post-deploy.mjs - the release tasks of a deploy (deploy.postDeploy): after the stack converged and before verification, each declared task
// (deploy.tasks.<name>) runs in order inside the running task of its service, through the daemon of this invocation like verify's checks.
// A post-deploy task is the place for an idempotent write a release owes the data (a catalogue sync, a seed upsert), so verification stays read-only.
// The first task that exits non-zero, or runs past its timeout, fails the step and the deploy rolls back; a rollback cannot undo what a task wrote.
// The deploy output carries the task's name, its exit and its line count only: the container holds decrypted secrets and the output reaches the
// CI log, so stdout and stderr are never relayed (`starci app stack task <name>` is the operator verb that shows them).
import { findInOrder } from '../runtime/scripts/lib/in-order.mjs';
import type { DeployConfig, TaskEntry } from './config.mjs';
import { lines as splitLines, tool } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import type { ActionResult } from './remote.mjs';

/** The outcome of one post-deploy task. */
interface TaskOutcome { name: string; ok: boolean; detail: string; outputLines: number }

/** The running container of a service on this daemon, or undefined. */
function runningContainer(ctx: StackContext, config: DeployConfig, service: string): string | undefined {
  const found = tool(ctx, 'docker', ['ps', '-q', '--filter', `label=com.docker.swarm.service.name=${config.stack}_${service}`, '--filter', 'status=running']);
  return splitLines(found.stdout)[0];
}

/** The verdict of one finished `docker exec`: a timeout, a launch failure or a non-zero exit is a failure, whatever it printed. */
function verdictOf(run: RunResult, timeoutSeconds: number): { ok: boolean; detail: string } {
  if (run.error?.code === 'ETIMEDOUT') return { ok: false, detail: `timed out after ${timeoutSeconds}s` };
  if (run.error) return { ok: false, detail: 'could not run' };
  if (run.status === null || run.status === undefined) return { ok: false, detail: 'ended without an exit status' };
  return run.status === 0 ? { ok: true, detail: 'ok' } : { ok: false, detail: `exit ${run.status}` };
}

/** Runs one declared task; returns { name, ok, detail, outputLines }. */
function runTask(ctx: StackContext, config: DeployConfig, name: string): TaskOutcome {
  const declared = config.tasks[name] as TaskEntry; // every postDeploy name is a declared task (stack-deploy-config.mjs)
  const container = runningContainer(ctx, config, declared.service);
  if (!container) return { name, ok: false, detail: `no running container of ${config.stack}_${declared.service} on the daemon`, outputLines: 0 };
  const run = tool(ctx, 'docker', ['exec', container, ...declared.command], { timeout: declared.timeoutSeconds * 1000, killSignal: 'SIGKILL' });
  return { name, ...verdictOf(run, declared.timeoutSeconds), outputLines: splitLines(run.stdout).length + splitLines(run.stderr).length };
}

/**
 * Runs the declared post-deploy tasks in order and stops at the first failure.
 * Returns { ok, lines, data: { tasks: [{ name, ok }] } }; the lines read `PASS|FAIL  post-deploy <name>  detail (N output lines withheld)`.
 */
export async function postDeployStack(ctx: StackContext, config: DeployConfig): Promise<ActionResult> {
  const results: TaskOutcome[] = [];
  await findInOrder(config.postDeploy, async (name: string) => {
    results.push(runTask(ctx, config, name));
    return !results.at(-1)?.ok;
  });
  return {
    ok: results.every((entry) => entry.ok),
    lines: results.map((entry) => `${entry.ok ? 'PASS' : 'FAIL'}  post-deploy ${entry.name}  ${entry.detail} (${entry.outputLines} output line${entry.outputLines === 1 ? '' : 's'} withheld)`),
    data: { tasks: results.map(({ name, ok }) => ({ name, ok })) },
  };
}
