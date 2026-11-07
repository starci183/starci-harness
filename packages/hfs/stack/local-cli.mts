// local-cli.mts - the dev actions of `starci app stack` (PROJECT-STACKS-6): doctor, up, down and logs, and prepare, status and verify when the
// named environment runs docker-compose. Each takes only its own flags; effects (up, down, prepare) are dry runs until --execute.
//   starci app stack doctor  --env <env>
//   starci app stack prepare --env <env> [--execute]
//   starci app stack up      --env <env> [--execute] [--timeout <seconds>]
//   starci app stack status  --env <env>
//   starci app stack logs    --env <env> --service <name> [--lines <n>]
//   starci app stack verify  --env <env>
//   starci app stack down    --env <env> [--execute]
import { loadLocalConfig, isLocalEnvironment } from './local-config.mjs';
import type { LocalConfig } from './local-config.mjs';
import type { StackContext } from './context.mjs';
import { EXIT, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalDeps } from './local-run.mjs';

/** The actions that exist only for a dev environment. */
export const LOCAL_ONLY = Object.freeze(['doctor', 'up', 'down', 'logs'] as const);
/** The actions a swarm environment already has, which a docker-compose environment answers with its dev implementation. */
export const LOCAL_SHARED = Object.freeze(['prepare', 'status', 'verify'] as const);
/** True when `value` is an action only a dev environment has. */
export const isLocalOnly = (value: unknown): boolean => (LOCAL_ONLY as readonly unknown[]).includes(value);
/** True when `value` is an action both kinds have. */
export const isLocalShared = (value: unknown): boolean => (LOCAL_SHARED as readonly unknown[]).includes(value);

const FLAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  doctor: [], up: ['--execute', '--timeout'], down: ['--execute'], logs: ['--service', '--lines'], prepare: ['--execute'], status: [], verify: [],
});
const VALUES = new Set(['--env', '--timeout', '--service', '--lines']);

/** The parsed flags of a dev action. */
export interface LocalFlags { env?: string; json: boolean; execute: boolean; timeout?: string; service?: string; lines?: string }

/** Parses the flags of one dev action; a flag of another action, an unknown flag and a missing value are refusals. */
export function parseLocalFlags(action: string, argv: readonly string[]): LocalFlags {
  const own = new Set(['--env', '--json', ...(FLAGS[action] ?? [])]);
  const flags: LocalFlags = { json: false, execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith('--')) throw refusal('STACK_USAGE', `stack ${action} takes no operand (got ${arg})`);
    if (!own.has(arg)) throw refusal('STACK_USAGE', `stack ${action} takes no ${arg}: its flags are ${[...own].join(', ')}`);
    if (arg === '--json') flags.json = true;
    else if (arg === '--execute') flags.execute = true;
    else if (VALUES.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw refusal('STACK_USAGE', `${arg} needs a value`);
      index += 1;
      (flags as unknown as Record<string, string>)[arg.slice(2)] = value;
    }
  }
  if (flags.env === undefined) throw refusal('STACK_USAGE', `stack ${action} names its environment with --env <env>`);
  return flags;
}

const whole = (value: string | undefined, name: string, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw refusal('STACK_USAGE', `${name} must be a whole number`);
  return parsed;
};

type LocalHandler = (ctx: StackContext, local: LocalConfig, options: Record<string, unknown>, deps?: LocalDeps) => Promise<ActionResult>;

/** The module of each dev action. */
const MODULES: Record<string, [string, string]> = {
  doctor: ['./local-doctor.mjs', 'doctorLocal'], prepare: ['./local-prepare.mjs', 'prepareLocal'], up: ['./local-up.mjs', 'upLocal'], status: ['./local-status.mjs', 'statusLocal'],
  logs: ['./local-logs.mjs', 'logsLocal'], verify: ['./local-verify.mjs', 'verifyLocal'], down: ['./local-down.mjs', 'downLocal'],
};

/** Runs one dev action and returns the exit code. */
export async function runLocal(ctx: StackContext, action: string, argv: readonly string[], deps: LocalDeps = {}): Promise<number> {
  const flags = parseLocalFlags(action, argv);
  const local = loadLocalConfig({ repoRoot: ctx.cwd, env: flags.env as string });
  const [file, name] = MODULES[action] as [string, string];
  const handler = (await import(file) as Record<string, LocalHandler>)[name] as LocalHandler;
  const result = await handler(ctx, local, { execute: flags.execute, timeoutSeconds: whole(flags.timeout, '--timeout', 180), service: flags.service, lines: whole(flags.lines, '--lines', 200) }, deps);
  if (flags.json) ctx.stdout(`${JSON.stringify({ verb: action, ok: result.ok, ...result.data }, null, 2)}\n`);
  else for (const line of result.lines) ctx.stdout(`${line}\n`);
  if (result.refused) {
    ctx.stderr(`starci app stack: ${result.refused.code}: ${result.refused.message}\n`);
    return EXIT.refused;
  }
  return result.ok ? EXIT.ok : EXIT.failed;
}

export { isLocalEnvironment };
