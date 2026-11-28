// task.mts - `starci app stack task <name>`: runs ONE declared one-off command (deploy.tasks.<name>.command) inside the running task of
// deploy.tasks.<name>.service on the manager, through the docker CLI of this invocation (DOCKER_HOST=ssh://<alias>, the transport the CI key's
// gate admits; never a shell over ssh), and relays its stdout. Which command runs is the app's declaration, never a
// flag: the only argument is the task name. Without --execute a dry-run line says what would run. Output is relayed as the command prints it; this
// module never reads or prints environment values.
import type { DeployConfig, TaskEntry } from './config.mjs';
import { firstLine, lines as splitLines, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { failure, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';

/** What `task` takes: the declared task name (the only operand). */
export interface TaskOptions { name?: string | undefined; args?: string[]; execute?: boolean; sshCmd?: string | null }

const TASK_NAME = /^[a-z][a-z0-9-]{0,40}$/u;

function undeclared(config: DeployConfig, why: string): Error {
  const names = Object.keys(config.tasks ?? {});
  const listing = names.length > 0 ? `declared tasks: ${names.join(', ')}` : 'the environment declares no deploy.tasks';
  return refusal('STACK_TASK_UNDECLARED', `${why}; ${listing}`);
}

function runningTask(ctx: Pick<StackContext, 'spawn'>, service: string): string {
  const result = tool(ctx, 'docker', ['ps', '-q', '--filter', `label=com.docker.swarm.service.name=${service}`, '--filter', 'status=running']);
  const task = result.status === 0 ? splitLines(result.stdout)[0] : undefined;
  if (task) return task;
  const reason = result.status === 0 ? 'none is running' : firstLine(result.stderr);
  throw failure('STACK_TASK_NO_TASK', `no running task of service ${service} on the manager (${reason})`);
}

/** task: runs the declared one-off command `name`. */
export async function runTask(ctx: StackContext, config: DeployConfig, { name, args = [], execute = false }: TaskOptions = {}): Promise<ActionResult> {
  if (name === undefined || !TASK_NAME.test(String(name)) || !Object.hasOwn(config.tasks ?? {}, name)) {
    throw undeclared(config, name === undefined ? 'task takes the name of a declared task' : `no task named ${String(name).slice(0, 41)} is declared`);
  }
  if (args.length > 0) throw refusal('STACK_USAGE', 'task takes only the task name; the command is the app\'s declaration');
  const declared = config.tasks[name] as TaskEntry; // declared: Object.hasOwn(config.tasks, name) held above
  if (!execute) {
    return { ok: true, lines: [`dry run: would run task ${name} (${declared.command.join(' ')}) in the running ${declared.service} task (add --execute)`], data: { name, status: null } };
  }
  const task = runningTask(ctx, `${config.stack}_${declared.service}`);
  const result = tool(ctx, 'docker', ['exec', task, ...declared.command]);
  const lines = splitLines(result.stdout);
  if (result.status !== 0) lines.push(`FAIL  task ${name} exited ${result.status}: ${firstLine(result.stderr)}`);
  return { ok: result.status === 0, lines, data: { name, status: result.status } };
}
