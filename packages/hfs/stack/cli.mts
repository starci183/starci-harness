// cli.mjs - `starci app stack <action>` for the Swarm deploy tooling: flags, dry run versus --execute, dispatch, text and --json output.
//   starci app stack <action> --env <env> [the action's FLAGS]     (only the READ_ONLY actions default --env to production)
// Each action takes only its own flags: a flag of another action is a refusal, never ignored.
// (`starci app world <up|down|status>` is the test world's, dispatched by packages/hfs/src/main.mjs; `stack status` below is the deploy's drift report.)
// Every action module exports one async function (ctx, config, options) -> { ok, lines, data }; a refusal throws StackError.
import path from 'node:path';
import { stackContext } from './context.mjs';
import type { SpawnOptions, StackContext, StackIo } from './context.mjs';
import { loadDeployConfig } from './config.mjs';
import type { DeployConfig } from './config.mjs';
import { withDockerTransport } from './docker-transport.mjs';
import { StackError, EXIT, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import { parseTargetBinding, bindStackTarget, nativeToolEnvironment } from './target-binding.mjs';
import type { TargetBinding } from './target-binding.mjs';
import { oneCommand, prepareUrgentRelease } from './urgent-release.mjs';
import type { UrgentReleaseOptions, UrgentReleaseResult } from './urgent-release.mjs';

/** The parsed flags of one action: boolean flags, value flags and the repeatable ones as lists. */
export interface Flags {
  env?: string;
  json?: boolean;
  execute?: boolean;
  'swarm-state'?: boolean;
  'init-swarm'?: boolean;
  'owner-approved'?: boolean;
  'fix-live-restore'?: boolean;
  'skip-public'?: boolean;
  'skip-internal'?: boolean;
  'allow-unpinned'?: boolean;
  push?: boolean;
  urgent?: boolean;
  'first-start'?: boolean;
  redeploy?: boolean;
  image?: string[];
  keep?: string[];
  'extra-compose'?: string[];
  project?: string[];
  sha?: string;
  previous?: string;
  out?: string;
  release?: string;
  since?: string;
  timeout?: string;
  retry?: string;
  app?: string;
  'ssh-cmd'?: string;
  'target-binding'?: string;
  'db-url-env'?: string;
  'backup-out'?: string;
  'db-service'?: string;
  reason?: string;
  remote?: string;
  'ci-run'?: string;
}

/** What each OPTIONS entry reads. */
interface OptionInput { flags: Flags; positional: string[]; cwd: string }
/** One action module's entry point. */
type Handler = (ctx: StackContext, config: DeployConfig, options: Record<string, unknown>) => Promise<ActionResult>;

/** The actions that drive the docker CLI of the operator machine (pointed at the manager by docker-transport.mjs when the key is sealed). */
const DOCKER_ACTIONS = new Set(['deploy', 'accept', 'converge', 'verify', 'rollback', 'prune', 'status']);

export const ACTIONS = Object.freeze(['prepare', 'connect', 'disconnect', 'build-args', 'render', 'deploy', 'converge', 'verify', 'rollback', 'prune', 'backup', 'jobs', 'task', 'ingress', 'retire', 'build', 'accept', 'status'] as const);

/** One action of `starci app stack`. */
export type Action = (typeof ACTIONS)[number];
/** True when `value` names one action of `starci app stack`. */
export const isAction = (value: unknown): value is Action => (ACTIONS as readonly unknown[]).includes(value);

export const BOOLEAN = new Set(['--execute', '--json', '--swarm-state', '--init-swarm', '--owner-approved', '--fix-live-restore', '--skip-public', '--skip-internal', '--allow-unpinned', '--push', '--urgent', '--first-start', '--redeploy']);
export const VALUE = new Set(['--env', '--image', '--sha', '--previous', '--out', '--release', '--since', '--timeout', '--retry', '--keep', '--app', '--ssh-cmd', '--extra-compose', '--project', '--target-binding', '--db-url-env', '--backup-out', '--db-service', '--reason', '--remote', '--ci-run']);
export const REPEAT = new Set(['--image', '--keep', '--extra-compose', '--project']);
/** `--ssh-cmd` replaces the configured alias for an action whose module (or the Docker transport) reaches the manager over SSH. */
const SSH: string[] = ['--ssh-cmd'];

/**
 * The flags each action takes besides `--env` and `--json`: exactly the flags its OPTIONS entry below reads, plus `--ssh-cmd` where the
 * action reaches the manager. Any other flag is refused with the action named, so `verify --execute` never reads as an effect.
 */
export const FLAGS: Readonly<Record<Action, string[]>> = Object.freeze({
  prepare: ['--execute', '--init-swarm', '--owner-approved', '--fix-live-restore', ...SSH],
  connect: ['--execute'],
  disconnect: ['--execute'],
  'build-args': ['--app'],
  render: ['--image', '--sha', '--previous', '--out', '--allow-unpinned', '--extra-compose'],
  deploy: ['--image', '--sha', '--execute', '--out', '--timeout', '--retry', '--skip-public', '--target-binding', '--urgent', '--reason', '--remote', '--db-url-env', '--backup-out', '--first-start', '--db-service', '--ci-run', '--redeploy', ...SSH],
  converge: ['--since', '--timeout', ...SSH],
  verify: ['--retry', '--skip-public', '--skip-internal', '--target-binding', ...SSH],
  rollback: ['--release', '--execute', '--timeout', ...SSH],
  prune: ['--keep', '--execute', ...SSH],
  backup: ['--swarm-state', '--execute', ...SSH],
  jobs: ['--execute', ...SSH],
  task: ['--execute', ...SSH],
  ingress: ['--execute', ...SSH],
  retire: ['--project', '--execute', ...SSH],
  build: ['--push', '--execute'],
  accept: ['--release', '--execute', '--retry', '--db-url-env', ...SSH],
  status: [...SSH],
});

/** The operands of the actions that take any, as the usage prints them. */
export const OPERANDS: Readonly<Partial<Record<Action, string>>> = Object.freeze({ jobs: '<action> [<arg>...]', task: '<name> [<arg>...]', ingress: '<action> [<arg>...]' });

/** The read-only actions, whose `--env` defaults to production. Every action with an effect names its environment, so none reaches production by omission. */
export const READ_ONLY: readonly string[] = Object.freeze(['build-args', 'render', 'verify', 'status']);

/** Splits argv into { flags, positional }; an unknown flag, a flag of another action or a flag without its value is a refusal. */
function parseFlags(action: Action, argv: string[]): { flags: Flags; positional: string[] } {
  const own = new Set(['--env', '--json', ...FLAGS[action]]);
  const flags: Record<string, string | boolean | string[]> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg.startsWith('--') && !BOOLEAN.has(arg) && !VALUE.has(arg)) throw refusal('STACK_USAGE', `unknown flag ${arg}`);
    if (arg.startsWith('--') && !own.has(arg)) throw refusal('STACK_USAGE', `stack ${action} takes no ${arg}: its flags are ${[...own].join(', ')}`);
    if (BOOLEAN.has(arg)) flags[arg.slice(2)] = true;
    else if (VALUE.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw refusal('STACK_USAGE', `${arg} needs a value`);
      index += 1;
      const key = arg.slice(2);
      flags[key] = REPEAT.has(arg) ? [...((flags[key] as string[] | undefined) ?? []), value] : value;
    } else positional.push(arg);
  }
  return { flags: flags as Flags, positional }; // BOOLEAN, VALUE and REPEAT decide each flag's kind above
}

/** The flag combinations of deploy's two forms: the one-command urgent release (no --image, no --sha) and the image form, and the urgent floor's own flags. */
function checkDeployForm(flags: Flags): void {
  if (!flags.urgent && (flags.reason || flags.remote)) throw refusal('STACK_USAGE', '--reason and --remote release HEAD in the one-command urgent deploy: add --urgent');
  if (flags.reason || flags.remote) {
    if (flags.sha || flags.image) throw refusal('STACK_USAGE', '--reason and --remote belong to the one-command urgent deploy without --image and --sha; the image form deploys a commit whose urgent record was already pushed');
  }
  if (!flags.urgent && (flags['first-start'] || flags['db-service'])) throw refusal('STACK_USAGE', '--first-start and --db-service are the first start of an empty database under the urgent floor: add --urgent');
  if (flags.urgent && flags['ci-run']) throw refusal('STACK_USAGE', '--ci-run names the CI run that deploys; an urgent deploy runs no CI (the CI run of its tag is the back-fill)');
  if (flags['ci-run'] !== undefined && !/^[0-9]{1,20}$/u.test(flags['ci-run'])) throw refusal('STACK_USAGE', '--ci-run takes the numeric id of the CI run');
}

/** `--image api=ghcr.io/o/x@sha256:...` (repeatable or comma separated) -> { api: 'ghcr.io/o/x@sha256:...' }. */
function parseImages(values: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of values.flatMap((value) => value.split(','))) {
    const at = item.indexOf('=');
    const service = item.slice(0, at);
    if (at < 1 || at === item.length - 1 || Object.hasOwn(out, service)) throw refusal('STACK_USAGE', `--image takes <service>=<reference>, once per service (got ${service || item})`);
    out[service] = item.slice(at + 1);
  }
  return out;
}

const number = (flags: Flags, name: 'timeout' | 'retry'): number | undefined => {
  if (flags[name] === undefined) return undefined;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < 0) throw refusal('STACK_USAGE', `--${name} must be a number of seconds`);
  return value;
};

/** The options object each action module receives, from the parsed flags. */
const OPTIONS: Record<Action, (input: OptionInput) => Record<string, unknown>> = {
  prepare: ({ flags }) => ({ execute: flags.execute === true, initSwarm: flags['init-swarm'] === true, ownerApproved: flags['owner-approved'] === true, fixLiveRestore: flags['fix-live-restore'] === true }),
  connect: ({ flags }) => ({ execute: flags.execute === true }),
  disconnect: ({ flags }) => ({ execute: flags.execute === true }),
  'build-args': ({ flags }) => ({ app: flags.app }),
  render: ({ flags, cwd }) => ({
    images: parseImages(flags.image), sourceSha: flags.sha, previous: flags.previous ?? null,
    out: flags.out ? path.resolve(cwd, flags.out) : null, allowUnpinned: flags['allow-unpinned'] === true,
    extraCompose: (flags['extra-compose'] ?? []).map((file) => path.resolve(cwd, file)),
  }),
  deploy: ({ flags, cwd }) => ({
    images: parseImages(flags.image), sourceSha: flags.sha, execute: flags.execute === true,
    out: flags.out ? path.resolve(cwd, flags.out) : null, timeoutSeconds: number(flags, 'timeout'), retrySeconds: number(flags, 'retry'), skipPublic: flags['skip-public'] === true,
    urgent: flags.urgent === true, dbUrlEnv: flags['db-url-env'], backupOut: flags['backup-out'] ? path.resolve(cwd, flags['backup-out']) : undefined,
    firstStart: flags['first-start'] === true, dbService: flags['db-service'], reason: flags.reason, remote: flags.remote,
    ciRun: flags['ci-run'], redeploy: flags.redeploy === true,
  }),
  converge: ({ flags }) => ({ since: flags.since, timeoutSeconds: number(flags, 'timeout') }),
  verify: ({ flags }) => ({ retrySeconds: number(flags, 'retry'), skipPublic: flags['skip-public'] === true, skipInternal: flags['skip-internal'] === true }),
  rollback: ({ flags }) => ({ release: flags.release ?? null, execute: flags.execute === true, timeoutSeconds: number(flags, 'timeout') }),
  prune: ({ flags, cwd }) => ({ keepFiles: (flags.keep ?? []).map((file) => path.resolve(cwd, file)), execute: flags.execute === true }),
  backup: ({ flags }) => ({ swarmState: flags['swarm-state'] === true, execute: flags.execute === true }),
  ingress: ({ flags, positional }) => ({ action: positional[0], execute: flags.execute === true, args: positional.slice(1) }),
  build: ({ flags }) => ({ push: flags.push === true, execute: flags.execute === true }),
  accept: ({ flags }) => ({ release: flags.release ?? null, execute: flags.execute === true, retrySeconds: number(flags, 'retry'), dbUrlEnv: flags['db-url-env'] }),
  status: () => ({}),
  retire: ({ flags }) => ({ projects: flags.project ?? [], execute: flags.execute === true }),
  jobs: ({ flags, positional }) => ({ action: positional[0], args: positional.slice(1), execute: flags.execute === true }),
  task: ({ flags, positional }) => ({ name: positional[0], args: positional.slice(1), execute: flags.execute === true }),
};

const MODULES: Record<Action, [string, string]> = {
  prepare: ['./prepare.mjs', 'prepareHost'],
  connect: ['./remote.mjs', 'connectCi'], disconnect: ['./remote.mjs', 'disconnectCi'],
  'build-args': ['./build-args.mjs', 'buildArgs'], render: ['./render.mjs', 'renderRelease'],
  deploy: ['./deploy.mjs', 'deployRelease'], converge: ['./converge.mjs', 'convergeStack'],
  verify: ['./verify.mjs', 'verifyStack'], rollback: ['./deploy.mjs', 'rollbackRelease'],
  prune: ['./prune.mjs', 'pruneStack'], backup: ['./backup.mjs', 'backupVolumes'], jobs: ['./jobs.mjs', 'runJobs'], task: ['./task.mjs', 'runTask'],
  ingress: ['./ingress.mjs', 'runIngress'],
  retire: ['./retire.mjs', 'retireCompose'],
  build: ['./build.mjs', 'buildImages'],
  accept: ['./deploy.mjs', 'acceptRelease'],
  status: ['./status.mjs', 'statusStack'],
};

async function handlerOf(action: Action, importer: (file: string) => Promise<Record<string, unknown>>): Promise<Handler> {
  const [file, name] = MODULES[action];
  return (await importer(file))[name] as Handler; // each MODULES entry names an exported action function
}

function print(ctx: StackContext, action: Action, flags: Flags, result: ActionResult): void {
  if (flags.json) ctx.stdout(`${JSON.stringify({ verb: action, ok: result.ok, ...result.data }, null, 2)}\n`);
  else for (const line of result.lines ?? []) ctx.stdout(`${line}\n`);
}

function nativeToolContext(ctx: StackContext, binding: Readonly<TargetBinding> | null): StackContext {
  if (!binding) return ctx;
  return Object.create(ctx, { spawn: { value: (command: string, args: string[], options: SpawnOptions = {}) => ctx.spawn(command, args,
    { ...options, env: nativeToolEnvironment(options.env ?? ctx.env) }) } });
}

/** Runs one action; returns the exit code. `io.importer` lets a spec load fake action modules. */
export async function stackMain(argv: string[], io: StackIo = {}): Promise<number> {
  const ctx = stackContext(io);
  try {
    const action = argv[0];
    if (!isAction(action)) throw refusal('STACK_USAGE', `starci app stack takes ${[...ACTIONS, 'up', 'down', 'status'].join(', ')}`);
    const { flags, positional } = parseFlags(action, argv.slice(1));
    if (flags.env === undefined && !READ_ONLY.includes(action)) throw refusal('STACK_USAGE', `stack ${action} has an effect: name its environment with --env <env> (only ${READ_ONLY.join(', ')} default to production)`);
    if (action === 'deploy') checkDeployForm(flags);
    const binding = parseTargetBinding(flags['target-binding'], 'docker-swarm');
    if (binding && (flags['ssh-cmd'] || flags['skip-public'] || flags['skip-internal']))
      throw refusal('STACK_USAGE', 'the bound native consumer supports only complete deploy or verify');
    const config = bindStackTarget(ctx, loadDeployConfig({ repoRoot: ctx.cwd, env: flags.env ?? 'production' }), binding);
    let options = OPTIONS[action]({ flags, positional, cwd: ctx.cwd });
    // The one-command urgent deploy releases HEAD and builds its images here, before the Docker transport reaches the server.
    let prepared: UrgentReleaseResult | null = null;
    if (action === 'deploy' && oneCommand(options as UrgentReleaseOptions)) { // OPTIONS.deploy builds the deploy options
      prepared = await prepareUrgentRelease(ctx, config, { ...options, role: io.harness?.role ?? ctx.env.STARCI_ROLE });
      if (!prepared.images) {
        print(ctx, action, flags, prepared);
        return prepared.ok ? EXIT.ok : EXIT.failed;
      }
      options = { ...options, images: prepared.images, sourceSha: prepared.sourceSha };
    }
    const handler = await handlerOf(action, io.importer ?? ((file: string) => import(file)));
    const sshCmd = flags['ssh-cmd'] ?? null;
    const call = (context: StackContext): Promise<ActionResult> => handler(context, config, { ...options, sshCmd });
    const toolContext = nativeToolContext(ctx, binding);
    const ran = DOCKER_ACTIONS.has(action) ? await withDockerTransport(toolContext, config, { sshCmd }, call) : await call(toolContext);
    const result = prepared ? { ...ran, lines: [...prepared.lines, ...(ran.lines ?? [])] } : ran;
    print(ctx, action, flags, result);
    // A floor step of an urgent deploy that failed is a refusal with its own code (urgent-floor.mjs), printed after the lines that led to it.
    if (result.refused) {
      ctx.stderr(`starci app stack: ${result.refused.code}: ${result.refused.message}\n`);
      return EXIT.refused;
    }
    return result.ok ? EXIT.ok : EXIT.failed;
  } catch (error) {
    if (!(error instanceof StackError)) throw error;
    ctx.stderr(`starci app stack: ${error.message}\n`);
    return error.exit;
  }
}
