// index.mjs - `starci app release <gate|push>` and the plumbing the release and database verbs share: the context built from the app's IO, strict flag
// parsing, the optional `release:` / `database:` blocks of .starcistacks/application-stacks.yaml, text and --json output and the exit-code mapping.
//   starci app release gate [--execute] [--sonar] [--source <ref>] [--tag-prefix <prefix>] [--backfill <tag>] [--json]
//   starci app release push [--execute] [--remote <name>] [--urgent --reason <text>] [--json]
// `harness` of the app IO ({ version, role, openTicket }) is what the starci CLI hands in: the caller's role an urgent record names and the ticket
// queue a red back-fill files into.
// Every action is a dry run unless --execute is given. A refusal is a StackError (exit 2); a failed step returns ok false (exit 1).
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { isRuntimeExampleApp } from '../runtime/scripts/lib/runtime-example.mjs';
import { hasEntityList } from '../db/entity-list.mjs';
import { STACKS_DIR, STACKS_FILE } from '../stack/config.mjs';
import { stackContext, type StackContext } from '../stack/context.mjs';
import { EXIT, StackError, refusal } from '../stack/errors.mjs';
import { RELEASE_CODE, VERSION, normalizeRelease, releaseGate } from './gate.mjs';
import { releasePush } from './push.mjs';
import { releaseUrgentPush } from './urgent.mjs';

const IO_KEYS = ['cwd', 'stdout', 'stderr', 'env', 'sops', 'hostIdentity'] as const;

/** What a spawned tool answers (ctx.spawn is never a shell). */
export interface SpawnResult { status: number | null; stdout: string; stderr: string; error?: Error | undefined }

/** The seams every release and database verb runs through: the stack context contextOf builds (stack/context.mjs stackContext). */
export type VerbContext = StackContext;

/** The app IO a verb receives from the starci CLI (cwd, writers, environment, secret seams, the stack seams of `stackIo`, the CLI `harness`). */
export interface VerbIo {
  cwd?: string | undefined;
  stdout?: ((text: string) => unknown) | undefined;
  stderr?: ((text: string) => unknown) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  sops?: unknown;
  hostIdentity?: unknown;
  stackIo?: Record<string, unknown> | undefined;
  harness?: { version?: string | undefined; role?: string | undefined; openTicket?: ((ticket: unknown) => unknown) | undefined } | undefined;
}

/** The flags of one verb ({ boolean, value, retired }); the parser refuses every other. */
export interface FlagSpec { boolean: readonly string[]; value: readonly string[]; retired?: readonly string[] }

/** The parsed flags of a verb: a boolean flag is true, a value flag its string. */
export type VerbFlags = Record<string, string | boolean | undefined>;

/** What a verb answers: `ok` maps to the exit code, `lines` print as text and `data` joins the --json answer. */
export interface VerbResult { ok: boolean; lines?: string[]; data?: Record<string, unknown> }

/** The stack context of one invocation: the IO of the app (cwd, writers, env, sops, hostIdentity) over the injectable seams of `io.stackIo` (spawn, sleep, now, fetch). */
export function contextOf(io: VerbIo = {}): VerbContext {
  const own = Object.fromEntries(IO_KEYS.filter((key) => io[key] !== undefined).map((key) => [key, io[key]]));
  return stackContext({ ...io.stackIo, ...own });
}

/** Splits argv into { flags, positional }; an unknown flag or a flag without its value is a refusal. */
function parseVerbFlags(argv: readonly string[], spec: FlagSpec, code = 'RELEASE_USAGE'): { flags: VerbFlags; positional: string[] } {
  const flags: VerbFlags = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (spec.boolean.includes(arg)) flags[arg.slice(2)] = true;
    else if (spec.value.includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw refusal(code, `${arg} needs a value`);
      index += 1;
      flags[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) throw refusal(code, `unknown flag ${arg}`);
    else positional.push(arg);
  }
  return { flags, positional };
}

/** The top-level mapping of .starcistacks/application-stacks.yaml; a missing file is an empty declaration, an unreadable one a refusal. */
export function readDeclaration(root: string): Record<string, any> { // reason: the stack declaration is YAML parsed from disk; each reader checks the blocks it uses
  let source: string;
  try { source = fs.readFileSync(path.join(root, STACKS_DIR, STACKS_FILE), 'utf8'); } catch { return {}; }
  let doc: unknown;
  try { doc = parseYaml(source); } catch { throw refusal('STACKS_DEPLOY_FILE_INVALID', `${STACKS_FILE} is not valid YAML`); }
  return plain(doc) ? doc as Record<string, any> : {}; // reason: narrowed by the plain-object check above; YAML-parsed
}

function readPackage(root: string): any { // reason: package.json parsed from disk
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { throw refusal('RELEASE_PACKAGE_UNREADABLE', 'package.json is not readable JSON'); }
}

/** The normalised `release:` block (tolerant of absence) with the package version: { root, version, gates, tagPrefix, defaultBranch, requireCi }. */
export function loadReleaseConfig(root: string) {
  const pkg = readPackage(root);
  if (typeof pkg.version !== 'string' || !VERSION.test(pkg.version)) throw refusal(RELEASE_CODE, 'package.json needs a version like 1.2.3 (the release tag derives from it)');
  const declaration = readDeclaration(root);
  const { config, problems } = normalizeRelease(declaration.release, pkg.scripts, declaration.services, { example: isRuntimeExampleApp(root), entities: hasEntityList(root) });
  if (!config) throw refusal(RELEASE_CODE, `${problems.length} problem(s) in release: ${problems.slice(0, 6).join('; ')}`);
  return { root, version: pkg.version, ...config };
}

function print(ctx: VerbContext, name: string, flags: VerbFlags, result: VerbResult): void {
  if (flags.json) ctx.stdout(`${JSON.stringify({ verb: name, ok: result.ok, ...result.data }, null, 2)}\n`);
  else for (const line of result.lines ?? []) ctx.stdout(`${line}\n`);
}

/** Parses the flags, runs `run(ctx, flags, positional)` and prints its result; returns the exit code. Only StackError is mapped, anything else is a bug and propagates. */
export async function runVerb({ label, name, io, argv, spec, run, code = 'RELEASE_USAGE' }: {
  label: string; name: string; io: VerbIo; argv: readonly string[]; spec: FlagSpec; code?: string;
  run: (ctx: VerbContext, flags: VerbFlags, positional: string[]) => VerbResult | Promise<VerbResult>;
}): Promise<number> {
  const ctx = contextOf(io);
  try {
    const { flags, positional } = parseVerbFlags(argv, spec, code);
    const result = await run(ctx, flags, positional);
    print(ctx, name, flags, result);
    return result.ok ? EXIT.ok : EXIT.failed;
  } catch (error) {
    if (!(error instanceof StackError)) throw error;
    const refused = error as { message: string; exit: number }; // narrowed by the instanceof check above (StackError is untyped until stack/ converts)
    ctx.stderr(`${label}: ${refused.message}\n`);
    return refused.exit;
  }
}

type Harness = VerbIo['harness'];
interface ReleaseAction { spec: FlagSpec; run: (ctx: VerbContext, flags: VerbFlags, harness: Harness) => VerbResult | Promise<VerbResult> }

const ACTIONS: Record<string, ReleaseAction> = {
  gate: {
    spec: { boolean: ['--execute', '--json', '--sonar'], value: ['--source', '--tag-prefix', '--backfill'] },
    run: (ctx, flags, harness) => releaseGate(ctx, loadReleaseConfig(ctx.cwd), {
      execute: flags.execute === true, sonar: flags.sonar === true, source: flags.source, tagPrefix: flags['tag-prefix'], backfill: flags.backfill, openTicket: harness?.openTicket,
    }),
  },
  push: {
    spec: { boolean: ['--execute', '--json', '--urgent'], value: ['--remote', '--reason', '--lint-baseline'], retired: ['--lint-baseline'] },
    run: (ctx, flags, harness) => {
      if (flags.reason !== undefined && flags.urgent !== true) throw refusal('RELEASE_USAGE', '--reason belongs to an urgent release (--urgent)');
      if (flags['lint-baseline'] !== undefined && flags.urgent !== true) throw refusal('RELEASE_USAGE', '--lint-baseline belongs to an urgent release (--urgent)');
      const config = loadReleaseConfig(ctx.cwd);
      if (flags.urgent === true) return releaseUrgentPush(ctx, config, { execute: flags.execute === true, remote: flags.remote, reason: flags.reason, lintBaseline: flags['lint-baseline'], role: harness?.role ?? ctx.env.STARCI_ROLE });
      return releasePush(ctx, config, { execute: flags.execute === true, remote: flags.remote });
    },
  },
};

/** The flags of each release action ({ boolean, value, retired }): the parser refuses every other flag, and the usage of `starci app` is generated from them (a retired flag is parsed only to refuse it with its own code). */
export const RELEASE_FLAGS = Object.freeze(Object.fromEntries(Object.entries(ACTIONS).map(([name, action]) => [name, action.spec])));

/** Runs `starci app release <gate|push>`; `io` is the app IO (cwd, stdout, stderr, env, sops, stackIo). Returns the exit code. */
export async function releaseMain(argv: string[], io: VerbIo = {}): Promise<number> {
  const first = argv[0] as string;
  const action = Object.hasOwn(ACTIONS, first) ? ACTIONS[first] ?? null : null;
  if (!action) {
    contextOf(io).stderr('starci app release: takes gate or push\n');
    return EXIT.refused;
  }
  return runVerb({ label: 'starci app release', name: first, io, argv: argv.slice(1), spec: action.spec, run: (ctx, flags) => action.run(ctx, flags, io.harness) });
}
