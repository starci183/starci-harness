// The @starci/hfs implementation behind `starci app`: one repository, `<app>/`, with one package.json, lockfile and node_modules
// at its root and two sides, be/ and fe/, declared by the one hfs.json of kind app. Every verb runs at the app root.
//   starci app check [--cwd <dir>] [--json] [--full] [--hfs] [--format] [--db] [--secrets] [--wiring] [--types] [--lint] [--test] [--sonar] [--coverage-from <lcov>] | check --staged
//                                            every tracked path has a slot; required files exist; nothing forbidden or
//                                            tracked-that-must-be-ignored; pins match; every managed file equals its render
//                                            (sync/managed.mjs, the .gitignore block and sonar-project.properties included); no empty or ghost
//                                            directory, no untracked entry outside an ignored slot; plaintext secrets, the .starcistacks shape, CI
//                                            and pre-push canon steps, dependency version skew, the contract snapshot and the test, wire and i18n
//                                            trees; prettier over every tracked file through the repository's own install (sync/format.mjs; a repository
//                                            without prettier is a refusal); soft-size backlog (report only); then the whole
//                                            architecture machine (tiers, owners, clones, dead exports, module registration, the
//                                            front-end and back-end source rules), each violation a finding with its why.
//                                            ESLint executes once per side through the installed managed config; the FE config composes
//                                            the universal canon and the explicitly selected Grammar-family canon.
//                                            The results are committed in .starcistacks/cache/ (cache/, contexts/project/check-cache.md): with no selector every
//                                            family runs diff-only against it and writes what it judged back; --full runs the selected families in full; a
//                                            selector (--hfs, --format, --db, --secrets, --wiring, --types, --lint, --test, --sonar) runs only that family, and
//                                            selectors combine. Each family prints one diagnosis line (full or diff and why, checked, reused, findings new, known,
//                                            fixed); progress goes to stderr (--quiet silences it). STARCI_APP_CHECK_CACHE=verify runs diff then full and fails (exit 2)
//                                            on any difference; =full never reads the cache (the release gate).
//                                            --coverage-from <lcov> judges a coverage report produced elsewhere (the merge of a sharded unit run) and records nothing.
//                                            --staged: the pre-commit guard alone (sync/hygiene.mjs: staged .starciwork and .starcistacks paths, the secrets
//                                            guard and the bypass guard over every staged file read from the index, a new back-end logic file staged
//                                            without its unit spec); it takes no other flag.
//                                            Exit 1 at 20 error findings or a hard blocker (gate-threshold.mjs). The root checks run once and
//                                            the side checks and the machine once per side, the side folder as their root; every path is app-relative.
//   starci app lint [--cwd <dir>] [--changed <file>...] [--workspace <dir>] [--side be|fe] [--fix] [--full] [--json] [--out <file>]
//                                            the ONE lint entry (npm run lint): ESLint per side with that side's canon config (per-file rules and
//                                            the project-graph rules), this check's findings, and stylelint over the fe side, as one starci/lint@1
//                                            report; --out writes the one Sonar import file. Exit 0 under 20 error findings and no hard blocker, 1 otherwise, 2 a tool could not run (lint/run.mjs).
//                                            --workspace <dir> (from the current directory) scopes the same lint to one fe workspace: the
//                                            `lint` script of fe/apps/<app> and fe/packages/<pkg>, run by the turbo lint task.
//   starci app scaffold <name> [--cwd <dir>]  a new app <dir>/<name>/ (<dir> is the global --cwd): the root (hfs.json, package.json, managed files, .starciwork) and the
//                                            be/ and fe/ skeletons (scaffold/app.mjs). Accepts an empty unborn main Git root.
//   starci app slot <path> [--cwd <dir>] [--json]   which slot owns the path, its tier, allowed imports, required tests.
//   starci app emit [--cwd <dir>]      write be/contracts/<app>/schema.graphql of every api app that serves GraphQL (emit/contracts.mjs):
//                                            printSchema(lexicographicSortSchema) of the resolvers the app root composes; no env, no database, no network.
//   starci app sync [--execute] [--cwd <dir>]  the managed files of the root (scripts, husky, CI, .gitignore block, sonar, prettier) and
//                                            of each side (tsconfig, eslint, jest, stylelint); sync/cli.mjs. Dry run unless --execute: it reports drift and exits 1 on it.
//   starci app coverage merge --out <lcov> <lcov-or-dir>...  the lcov reports of the sharded unit run merged into one (coverage/cli.mjs; the managed CI coverage job)
//   starci app add service <dir> <name> [--inject <Decorator>=<module>:<Type> | <Class>=<module>]... [--cwd <dir>]
//                                            a back-end `<name>.service.ts` and its `<name>.service.spec.ts` skeleton (scaffold/service.mjs; <dir> is
//                                            relative to be/): the spec is built
//                                            with Test.createTestingModule, one provider per constructor dependency (kit doubles from @starci/jest-preset),
//                                            one placeholder it per public method. Never overwrites a file. Both editions: a lite back end keeps full's unit specs (ruling:R212/case-1 (owner:lite-production-swarm), amended by ruling:R212/case-4).
//   starci app add image [--cwd <dir>]                  the Dockerfile of every declared app that has none, from the image canon (scaffold/image.mjs); never overwrites
//   starci app add spec <file>.service.ts [--cwd <dir>]  the spec skeleton of an existing service, read from its constructor with the repository's TypeScript
//                                            (service, spec and image take only what is written here: an option another noun takes is refused, as --inject is on every other noun)
//   starci app world <up|down|status> [--stack <dir>] [--services <list>] [--k3d] [--force] [--json]   the full edition's local test world (the installed @starci/test-world cli)
//   starci app stack <action> --env <env> [--execute]
//                                            the Swarm deploy tooling of stack/ (dry run unless --execute; never prints a secret value; see docs/application-stacks.md).
//   starci app secret init | set --env <env> <slug> <KEY> [--generate <bytes>] | get --env <env> <slug> [KEY] --to-file [--reveal]
//   starci app secret unset --env <env> <slug> <KEY> [--execute] | rename --env <env> <slug> <OLD> <NEW> [--execute] | remove --env <env> <slug> [--execute] [--force-nonempty]
//   starci app secret materialize --env <env> | list --env <env> | verify --env <env> | recipients --env <env> [--add|--remove <age1...|owner>] [--execute]
//                                            dotenv custody in .starcistacks, public age rule initialization, private KEY files outside Git;
//                                            values reach stdout only when get explicitly receives --reveal.
//   starci app ci secret set <NAME> [--env E | --dependabot] [--repo owner/name] [--execute]  reads the value from stdin only; dry until --execute.
//   starci app ci var set <NAME> [--env E] [--value v] [--execute] | var sync [--execute] | verify [--json] | local [--execute]
//                                            declared GitHub CI custody; verify compares names, scopes and public values; local prints the CI plan, --execute runs it.
//   starci app db new <name> | baseline | restamp --map <restamp.yaml> | migrate | post-cutover | dump | drift   [--db-url-env <NAME>]
//                                            baseline and restamp preview and mutate only with --execute; migrate without --execute prints the plan and compares
//                                            the database with the repo (exit 0 agree, 1 drift, 2 refused).
//   starci app add <api|webhook|realtime|saga|job|reactor|queue|projection> <name> [--event <event> --from <service> --service <Class>=<module>] [--owner <service> --failed <event> --done <event>] [--connection <name>] [--cwd <dir>]
//                                            exactly that kind's file tree, generated FROM the files: tree of its pattern topic (knowledge/patterns/be) with the
//                                            one template body of each entry (templates/be/patterns), plus the platform capabilities it needs when they are missing;
//                                            it registers the patterns and the trigger kind in hfs.json (sides.be.patterns, sides.be.kinds). Never overwrites a file (scaffold/add.mjs). In a lite app a noun whose slots lite does not have refuses: `add <noun>: full edition only`.
//   starci app add <block|composite|branch|leaf> <name> [--shapes a,b,c] [--read <read>] [--app <fe app>] [--cwd <dir>]
//   starci app add <page|layout> <route> [--blocks a,b] [--tabs a,b (page)] | overlay <name> --kind modal|drawer [--form]   a route page, segment layout
//                                            or overlay owner (scaffold/add-fe-page.mjs, add-fe-layout.mjs, add-fe-overlay.mjs).
//                                            one front-end unit in the shape-slot pattern from templates/fe/units (scaffold/add-fe-unit.mjs); the
//                                            first block writes the app's one copy of the status owners. Never overwrites a unit.
// The flags of every verb are those of USAGE below, generated from the parser tables that refuse every other flag.
// Every finding names a why code and carries its Vietnamese text. check, lint and slot read the app, never write to it. Exit codes:
// 0 clean, 1 error findings, 2 a refusal or bad usage.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from '../runtime/scripts/lib/is-main.mjs';
import { explainPath, readWhy, trackedFiles, withCheckProofs } from '../runtime/scripts/hfs/check.mjs';
import { withWhy } from '../runtime/scripts/hfs/check-results.mjs';
import { skillRoot } from '../runtime/engine/runtime-root.mjs';
import { secretMain } from '../runtime/scripts/hfs/secret.mjs';
import { dbBaselineMain } from '../runtime/scripts/hfs/db-baseline-verb.mjs';
import { dbRestampMain } from '../runtime/scripts/hfs/db-restamp-verb.mjs';
import { formatCoverageReport } from '../runtime/scripts/hfs/coverage-from.mjs';
import { gateVerdict } from '../runtime/scripts/hfs/gate-threshold.mjs';
import { HFS_DECLARATION_FILE, HfsSlotsError, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { main as syncMain } from '../sync/cli.mjs';
import { runWorkHygiene } from '../sync/hygiene.mjs';
import { SyncError, bundledPresets } from '../sync/index.mjs';
import { emitContracts } from '../emit/contracts.mjs';
import { ScaffoldError, newService, newSpec } from '../scaffold/service.mjs';
import { EditionRefusal } from '../scaffold/edition-gate.mjs';
import { addKind } from '../scaffold/add.mjs';
import { scaffoldApp, type LockResult } from '../scaffold/app.mjs';
import { newImages } from '../scaffold/image.mjs';
import { cachedLinters, eslintRepository, lintRepository, parseLintArgs, printLintText } from '../lint/run.mjs';
import { runSonarForApp, runTestForApp, runTestShard, runTypesForApp } from '../cache/app-families.mjs';
import { CACHE_ENV, createDiskSession, type DiskSession } from '../cache/session.mjs';
import { DEFAULT_FAMILIES, runAppFamilies } from '../cache/run.mjs';
import { createProgress, silentProgress } from '../cache/progress.mjs';
import { familyLine } from '../cache/report.mjs';
import { writeRunLog } from '../cache/run-log.mjs';
import { FAMILIES, type FamilyId, type FamilyReport } from '../cache/types.mjs';
import { SECRET_CODES as SECRET_CODE_LIST } from '../cache/hfs-family.mjs';
import { writeReport } from '../report/sonar.mjs';
import { checkEdition } from '../upgrade/check.mjs';
import { UpgradeError, upgradeMain } from '../upgrade/index.mjs';
import { ACTIONS as STACK_ACTIONS, FLAGS as STACK_FLAGS, OPERANDS as STACK_OPERANDS, READ_ONLY as STACK_READ_ONLY, REPEAT as STACK_REPEAT, VALUE as STACK_VALUE, stackMain as deployStackMain } from '../stack/cli.mjs';
import { RELEASE_FLAGS, releaseMain } from '../release/index.mjs';
import { SPEC as DB_MIGRATE_FLAGS, dbMigrateMain } from '../db/migrate.mjs';
import { SPEC as DB_POST_CUTOVER_FLAGS, dbPostCutoverMain } from '../db/post-cutover.mjs';
import { SPEC as DB_DUMP_FLAGS, dbDumpMain } from '../db/dump.mjs';
import { SPEC as DB_NEW_FLAGS, dbNewMain } from '../db/new.mjs';
import { SPEC as DB_DRIFT_FLAGS, dbDriftMain } from '../db/drift.mjs';
import { BASELINE_OPTIONS, DB_BOOLEAN_OPTIONS } from '../runtime/scripts/hfs/db-baseline-verb.mjs';
import { RESTAMP_OPTIONS } from '../runtime/scripts/hfs/db-restamp-verb.mjs';
import { SECRET_VERBS, secretUsage } from '../runtime/scripts/hfs/secret.mjs';
import { BOOLEAN as CI_BOOLEAN, COMMANDS as CI_COMMANDS } from '../ci/cli.mjs';
import { LOCAL_FLAGS as CI_LOCAL_FLAGS } from '../ci/local.mjs';
import { USAGE as COVERAGE_USAGE } from '../coverage/cli.mjs';
import { SYNC_USAGE } from '../sync/cli.mjs';
import { codemodMain } from '../codemod/button-intent.mjs';
import type { VerbIo } from '../release/index.mjs';
import type { GhSpawn } from '../ci/github.mjs';
import type { Prompt } from '../runtime/scripts/hfs/secret-prompt.mjs';
import type { AgeHost, SecretToolOverrides } from '../runtime/scripts/hfs/secret-init.mjs';
import type { SecretSops } from '../runtime/scripts/hfs/secret-sops.mjs';
import type { Prettier } from '../sync/format.mjs';
import type { LinterRunner } from '../lint/run.mjs';
import type { Presets } from '../sync/index.mjs';

// reason: results of the check machine and the declaration readers (runtime/scripts/hfs/*.mjs) are plain objects whose shape those modules own; this entry only prints them
type Dynamic = any;

/** The flags a verb takes, by kind. */
interface FlagTable { boolean?: readonly string[]; value?: readonly string[]; list?: readonly string[] }
/** The parsed arguments of a verb: the operands and each flag by name. */
interface Opts { positional: string[]; [flag: string]: string | boolean | string[] | undefined }
/** A value flag as parse stores it: the string given, else undefined. */
const valueFlag = (opts: Opts, flag: string): string | undefined => { const given = opts[flag]; return typeof given === 'string' ? given : undefined; };
/** A boolean flag as parse stores it: true when given, else undefined. */
const booleanFlag = (opts: Opts, flag: string): boolean | undefined => { const given = opts[flag]; return typeof given === 'boolean' ? given : undefined; };
/** A list flag as parse stores it: every value given, else undefined. */
const listFlag = (opts: Opts, flag: string): string[] | undefined => { const given = opts[flag]; return Array.isArray(given) ? given : undefined; };
/** The app IO every verb receives: the working directory, writers, environment and the injectable seams. */
interface AppIo {
  cwd: string; harness?: { version?: string; role?: string; openTicket?: (ticket: unknown) => unknown } | undefined; edition?: string | undefined;
  stdout: (text: string) => unknown; stderr: (text: string) => unknown; presets?: Presets | undefined; prettier?: Prettier | undefined; lock?: ((root: string) => LockResult) | undefined;
  // stdin reaches ci (text or a function) and secret (a function or a stream): main passes the shape both take.
  run?: unknown; stackMain?: ((argv: string[], io: { cwd: string; out: unknown; err: unknown }) => unknown) | undefined; env: NodeJS.ProcessEnv; stdin?: (() => string) | undefined; prompt?: Prompt | undefined;
  hostIdentity?: AgeHost | null | undefined; sops?: SecretSops | null | undefined; tools?: ({ spawn?: GhSpawn | undefined } & SecretToolOverrides) | undefined; platform?: NodeJS.Platform | undefined; stackIo?: Record<string, unknown> | undefined; runLinter?: LinterRunner | undefined;
  checkApp?: ((args: Dynamic) => Dynamic) | undefined;
  /** --quiet: no progress on stderr (the diagnosis stays). */
  quiet?: boolean | undefined; stderrIsTty?: boolean | undefined;
}
/** The options of main: every seam of the app IO, each optional. */
type MainOptions = { [K in keyof AppIo]?: AppIo[K] | undefined };
/** A verb parsed here: its runner, the only flags it takes and the usage forms. */
interface ParsedVerb extends FlagTable {
  run: (opts: Opts, io: AppIo) => number | Promise<number>; edition?: boolean; forms: { operands?: string; flags?: string[]; only?: FlagTable; edition?: boolean }[];
}
type UsageForm = ParsedVerb['forms'][number];

export const VERBS = Object.freeze(['scaffold', 'add', 'lint', 'sync', 'check', 'upgrade', 'stack', 'world', 'release', 'slot', 'emit', 'secret', 'ci', 'db', 'coverage', 'codemod']);
const DATABASE_VERBS = new Map<string | undefined, (argv: string[], io: VerbIo) => Promise<number> | number>([['baseline', dbBaselineMain], ['restamp', dbRestampMain],['migrate', dbMigrateMain], ['post-cutover', dbPostCutoverMain], ['dump', dbDumpMain], ['new', dbNewMain], ['drift', dbDriftMain]]);

/**
 * The verbs parsed here, each with the only flags it takes ({ boolean, value, list }); a flag of another verb is refused, never ignored.
 * `forms` are its usage lines: the operands and, where a form takes fewer flags than the verb, its own. `edition` marks a verb that reads the
 * global --edition (editionOption).
 */
/** The flags of the add nouns that generate a file tree from a pattern (service, spec and image take none of them, and --inject is only theirs). */
const ADD_FLAGS: FlagTable = { value: ['--event', '--from', '--service', '--connection', '--owner', '--failed', '--done', '--shapes', '--read', '--app', '--kind', '--blocks', '--tabs'], boolean: ['--fe', '--form'] };
/** The family selectors of `app check`, one flag per family of the cache (contexts/project/check-cache.md). */
const FAMILY_FLAGS = FAMILIES.map((family) => `--${family}`);
const PARSED: Record<string, ParsedVerb> = {
  scaffold: { run: scaffoldMain, value: ['--registry-visibility'], edition: true, forms: [{ operands: '<name>' }] },
  add: {
    run: addMain, ...ADD_FLAGS, list: ['--inject'],
    forms: [
      { operands: '<api|webhook|realtime|saga|job|reactor|queue|projection|cli|table|app|block|composite|branch|leaf|page|overlay|layout> <name>', only: ADD_FLAGS },
      { operands: 'service <dir> <name>', only: { list: ['--inject'] } },
      { operands: 'spec <file>.service.ts', flags: [] },
      { operands: 'image', flags: [] },
    ],
  },
  check: { run: checkMain, value: ['--coverage-from', '--shard'], boolean: ['--json', '--staged', '--full', ...FAMILY_FLAGS], edition: true, forms: [{ only: { boolean: ['--json', '--full', ...FAMILY_FLAGS], value: ['--coverage-from', '--shard'] } }, { only: { boolean: ['--staged'] }, edition: false }] },
  slot: { run: slotMain, boolean: ['--json'], forms: [{ operands: '<path>' }] },
  emit: { run: emitMain, forms: [{}] },
};
const flagsOf = (spec: FlagTable): readonly string[] => [...(spec.boolean ?? []), ...(spec.value ?? []), ...(spec.list ?? [])];
const ADD_FLAGS_ALL = flagsOf(ADD_FLAGS);
/** Every flag some parsed verb takes, and the global --edition: naming one on a verb that does not take it says so. */
const PARSED_FLAGS = new Set([...Object.values(PARSED).flatMap(flagsOf), '--edition']);

/** The placeholder of a value flag in the usage; any other prints as <name>. */
const PLACEHOLDERS: Record<string, string> = {
  '--registry-visibility': 'public|private', '--edition': 'full|lite', '--base': '<ref>', '--coverage-from': '<lcov>', '--shard': '<i>/<n>', '--inject': '<binding>',
  '--event': '<event>', '--from': '<service>', '--service': '<Class>=<module>', '--owner': '<service>', '--failed': '<event>', '--done': '<event>',
  '--shapes': '<a,b,c>', '--blocks': '<a,b>', '--tabs': '<a,b>', '--kind': 'modal|drawer', '--image': '<service>=<ref>', '--sha': '<sha>',
  '--previous': '<release>', '--release': '<release>', '--out': '<path>', '--since': '<ISO>', '--timeout': '<seconds>', '--retry': '<seconds>',
  '--keep': '<release.json>', '--ssh-cmd': '<command>', '--extra-compose': '<file>', '--target-binding': '<json>', '--db-url-env': '<NAME>',
  '--backup-out': '<dir>', '--db-service': '<service>', '--reason': '<text>', '--remote': '<name>', '--tag-prefix': '<prefix>',
  '--backfill': '<tag>', '--green-at': '<ISO>', '--stamp': '<version>', '--map': '<restamp.yaml>', '--drop-extension': '<a,b>',
  '--drop-pgmq-queue': '<q,job_*>', '--seed-tables': '<t1,t2>', '--repo': '<owner/name>', '--jobs': '<id,...>', '--parallel': '<n>', '--logs': '<dir>',
};
const flagUsage = (flag: string, { value = false, repeat = false, placeholders = PLACEHOLDERS }: { value?: boolean; repeat?: boolean; placeholders?: Record<string, string> } = {}): string => `[${flag}${value ? ` ${placeholders[flag] ?? `<${flag.slice(2)}>`}` : ''}]${repeat ? '...' : ''}`;
const line = (...parts: unknown[]): string => parts.flat().filter(Boolean).join(' ');
/** The flags of a { boolean, value, list } spec as usage text. */
const specUsage = ({ boolean = [], value = [], list = [] }: FlagTable, placeholders: Record<string, string> = PLACEHOLDERS): string[] => [
  ...boolean.map((flag) => flagUsage(flag)),
  ...value.map((flag) => flagUsage(flag, { value: true, placeholders })),
  ...list.map((flag: string) => flagUsage(flag, { value: true, repeat: true, placeholders })),
];
/** A dbOptions list (bare names) as a spec; --cwd is the global flag. */
const dbSpec = (names: readonly string[]): FlagTable => ({ boolean: names.filter((name) => DB_BOOLEAN_OPTIONS.includes(name)).map((name) => `--${name}`), value: names.filter((name) => name !== 'cwd' && !DB_BOOLEAN_OPTIONS.includes(name)).map((name) => `--${name}`) });
const DATABASE_USAGE: [string, string, FlagTable][] = [['new', '<kebab-name>', DB_NEW_FLAGS], ['baseline', '', dbSpec(BASELINE_OPTIONS)], ['restamp', '', dbSpec(RESTAMP_OPTIONS)],['migrate', '', DB_MIGRATE_FLAGS], ['post-cutover', '', DB_POST_CUTOVER_FLAGS], ['dump', '', DB_DUMP_FLAGS], ['drift', '', DB_DRIFT_FLAGS]];

/** The usage of each verb, from the tables its parser refuses every other flag with (lint, codemod and upgrade keep hand-parsed arguments, held by main.spec.mjs). */
const VERB_USAGE: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(PARSED).map(([verb, spec]) => [verb, spec.forms.map((form: UsageForm) => line(`starci app ${verb}`, form.operands,
    specUsage(form.only ?? (form.flags === undefined ? spec : { value: form.flags })), spec.edition && form.edition !== false ? flagUsage('--edition', { value: true }) : ''))])),
  lint: ['starci app lint [--changed <file>...] [--workspace <dir>] [--side be|fe] [--fix] [--full] [--full] [--json] [--out <file>]'],
  codemod: ['starci app codemod button-intent [--execute] [--json] [--format json|markdown] [--out <file.json|file.md>]'],
  upgrade: ['starci app upgrade [--execute]'],
  sync: [SYNC_USAGE.sync],
  world: ['starci app world <up|down|status> [--stack <dir>] [--services <list>] [--k3d] [--force] [--json] [--edition full|lite]'],
  stack: [
    ...STACK_ACTIONS.map((action) => line(`starci app stack ${action}`, STACK_OPERANDS[action], STACK_READ_ONLY.includes(action) ? flagUsage('--env', { value: true }) : '--env <env>',
      STACK_FLAGS[action].map((flag: string) => flagUsage(flag, { value: STACK_VALUE.has(flag), repeat: STACK_REPEAT.has(flag) })), '[--json]')),
  ],
  release: Object.entries(RELEASE_FLAGS).map(([action, spec]) => line(`starci app release ${action}`, specUsage(spec))),
  secret: SECRET_VERBS.map((verb: string) => line(`starci app secret ${verb}`, secretUsage(verb))),
  ci: [
    ...Object.entries(CI_COMMANDS).map(([command, options]) => line(`starci app ci ${command}`, command.endsWith(' set') ? '<NAME>' : '',
      options.map((name) => flagUsage(`--${name}`, { value: !CI_BOOLEAN.has(name) })))),
    line('starci app ci local', specUsage(CI_LOCAL_FLAGS)),
  ],
  db: DATABASE_USAGE.map(([verb, operands, spec]) => line(`starci app db ${verb}`, operands, specUsage(spec, { ...PLACEHOLDERS, '--image': '<ref>', '--out': '<dir>' }))),
  coverage: COVERAGE_USAGE.replace(/^usage: /, '').split(' | ').map((text) => text.replace(' [--cwd <dir>]', '')),
};
export const USAGE = `${VERBS.flatMap((verb) => VERB_USAGE[verb]).join('\n')}
every verb: [--cwd <dir>] [--quiet] [--help]
`;
const PER_CODE_LIMIT = 25;

/** Splits the arguments of a parsed verb into { positional, <flag>: value }; a flag the verb does not take, a repeated single value or a missing value is refused. */
function parse(verb: string, argv: readonly string[]): Opts {
  const { boolean = [], value = [], list = [] } = PARSED[verb] as ParsedVerb;
  const opts: Opts = { positional: [] };
  const args = argv.values();
  for (const arg of args) {
    if (!arg.startsWith('--')) {
      opts.positional.push(arg);
      continue;
    }
    const [flag, inline] = arg.split(/=(.*)/s) as [string, string | undefined];
    const key = flag.slice(2);
    if (boolean.includes(flag) && inline === undefined) opts[key] = true;
    else if (value.includes(flag) || list.includes(flag)) {
      const given: string | undefined = inline ?? args.next().value;
      if (!given || given.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (list.includes(flag)) opts[key] = [...((opts[key] as string[] | undefined) ?? []), given];
      else if (opts[key] !== undefined) throw new Error(`${flag} may be given only once`);
      else opts[key] = given;
    } else if (boolean.includes(flag)) throw new Error(`${flag} takes no value`);
    else throw new Error(PARSED_FLAGS.has(flag) ? `starci app ${verb} takes no ${flag}` : `unknown flag ${flag}`);
  }
  return opts;
}

function machineDescription(machine: Dynamic): string {
  if (machine.status !== 'ran') return `skipped, ${machine.reason}`;
  const owners = machine.paths ? ` (owners ${machine.paths.join(', ')})` : '';
  return `ran over ${machine.files} source files${owners}`;
}

function contractDescription(contracts: Dynamic): string {
  if (contracts.status !== 'checked') return `skipped, ${contracts.reason}`;
  const apps = contracts.apps.map((app: Dynamic) => `${app.app}/${app.artifact} ${app.status}`).join(', ') || 'no api app';
  return `emitted and compared, ${apps}`;
}

function printCheckOverview(result: Dynamic, out: (text: string) => unknown): void {
  out(`starci app check ${result.repoRoot} (profile ${result.profile ?? 'unknown'}, manifest ${result.manifest}, ${result.tracked} tracked paths)
`);
  for (const report of (result.families ?? []) as FamilyReport[]) out(`  ${familyLine(report)}
`);
  for (const warning of (result.cacheWarnings ?? []) as string[]) out(`  cache: ${warning}
`);
  out(`  architecture machine: ${machineDescription(result.machine)}
`);
  if (result.contracts) out(`  contract snapshots: ${contractDescription(result.contracts)}
`);
  if (result.eslint) {
    const sides = (Object.entries(result.eslint.sides) as [string, Dynamic][]).map(([side, run]) => `${side}: ${run.files} files${run.skipped ? ` (${run.skipped})` : ''}`).join(', ');
    out(`  ESLint: ${sides}
`);
    for (const error of result.eslint.errors) out(`  ESLint tool error: ${error}
`);
  }
}

function printFindingGroup(code: string, list: Dynamic[], out: (text: string) => unknown): void {
  const first = list[0] as Dynamic;
  if (first.engine) out(`\n[${first.level.toUpperCase()}] ${code} x${list.length}\n`);
  else out(`\n[${first.level.toUpperCase()}] ${code} x${list.length}: ${first.titleVi}\n  ${first.whyVi}\n  -> ${first.nextStepVi}\n`);
  for (const finding of list.slice(0, PER_CODE_LIMIT)) out(`  - ${finding.message}\n`);
  if (list.length > PER_CODE_LIMIT) out(`  ... and ${list.length - PER_CODE_LIMIT} more (use --json for all)\n`);
}

function printCheck(result: Dynamic, out: (text: string) => unknown): void {
  const { counts } = result;
  printCheckOverview(result, out);
  const byCode = new Map<string, Dynamic[]>();
  for (const f of result.findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);
  for (const [code, list] of byCode) printFindingGroup(code, list, out);
  out(`\n${counts.error} error finding${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}, ${counts.info} report-only\n`);
}

function printNoSlot(e: Dynamic, out: (text: string) => unknown): void {
  out(`  no slot owns this path (${e.code}): ${e.titleVi}\n  ${e.whyVi}\n`);
  if (e.nearest) out(`  nearest slot ${e.nearest.slot}, pattern ${e.nearest.pattern}; matched ${e.nearest.matchedPrefix || '.'}, then expected ${e.nearest.expectedNext ?? 'nothing'}\n`);
}

function printExplain(e: Dynamic, out: (text: string) => unknown): void {
  out(`${e.path}\n`);
  if (e.status === 'no-slot') {
    printNoSlot(e, out);
    return;
  }
  if (e.status === 'ambiguous') { out(`  owned equally by ${e.candidates.join(', ')} (${e.code}): ${e.titleVi}\n`); return; }
  const owner = e.owner ? `  owner ${e.owner.root} (${e.owner.slot})` : '';
  const imports = e.allowedImports ? `may import ${e.allowedImports.join(', ')}; ${e.importRule}` : (e.importRule ?? 'not applicable');
  out(`  slot       ${e.slot}  (${e.pattern})\n  presence   ${e.presence}, ${e.tracking}\n  tier       ${e.tier}${owner}\n`);
  out(`  imports    ${imports}\n`);
  out(`  tests      ${e.tests}: ${e.testsMeaning}\n`);
  if (e.requiredFiles.length) out(`  requires   ${e.requiredFiles.join(', ')}\n`);
  if (e.goesTo) out(`  belongs at ${e.goesTo}\n`);
  if (e.rules) out(`  rules      ${e.rules.join(', ')}\n`);
  if (e.code) out(`  ${e.code}: ${e.titleVi}\n  ${e.whyVi}\n`);
}

/** The family selectors given, as families; none given selects `fallback`. */
function selectedFamilies(opts: Opts, fallback: readonly FamilyId[]): Set<FamilyId> {
  const given = FAMILIES.filter((family) => opts[family] === true);
  return new Set(given.length > 0 ? given : fallback);
}

/** How a verb uses the cache: `normal` reads and writes it, `read` reads and writes nothing, `bypass` neither reads nor writes. */
type CacheUse = 'normal' | 'read' | 'bypass';

/** Opens the session of a verb over the tracked files of the app: progress on stderr, `--quiet` silent, a terminal rewriting running lines in place. */
function openSession({ repoRoot, tracked, io, full, use, planned }: { repoRoot: string; tracked: string[]; io: AppIo; full?: Set<FamilyId> | undefined; use: CacheUse; planned: number }): DiskSession {
  const progress = io.quiet === true ? silentProgress : createProgress({ write: (text) => io.stderr(text), tty: io.stderrIsTty === true, planned });
  const env = use === 'bypass' ? { ...io.env, [CACHE_ENV]: 'full' } : use === 'read' ? { ...io.env, [CACHE_ENV]: io.env[CACHE_ENV] === 'full' ? 'full' : 'verify' } : io.env;
  return createDiskSession({ root: repoRoot, tracked, env, progress, cliVersion: io.harness?.version, full });
}

/**
 * The app pass of `starci app check` and `starci app lint`: the families the verb selects, against one cache session, merged into one result.
 * `only` limits the formatter to those (app-relative) files and bypasses the cache (`app lint --changed`).
 */
async function appPass({ repoRoot, harness, only, presets, prettier, io, selected, full, use = 'normal', session: given }: {
  repoRoot: string; harness?: AppIo['harness']; only?: string[] | undefined; presets?: Presets | undefined; prettier?: Prettier | undefined; io: AppIo;
  selected: Set<FamilyId>; full?: Set<FamilyId> | undefined; use?: CacheUse; session?: DiskSession | undefined;
}): Promise<Dynamic> {
  const tracked = trackedFiles(repoRoot);
  const session = given ?? openSession({ repoRoot, tracked, io, full, use: only === undefined ? use : 'bypass', planned: tracked.length * Math.max(1, selected.size) });
  const result = await runAppFamilies({ repoRoot, tracked, session, selected, harness, presets, prettier, only, edition: undefined });
  if (given !== undefined) return result;
  const flushed = session.flush();
  return { ...result, findings: [...result.findings, ...verdictFindings(session)], cacheWarnings: flushed.warnings };
}

/** The verdicts of the CI comparison (forged, stale, missing) as findings with their why. */
function verdictFindings(session: DiskSession): Dynamic[] {
  const verdicts = session.verdicts();
  if (verdicts.length === 0) return [];
  const why = readWhy(skillRoot, [...new Set(verdicts.map((verdict) => verdict.code))]);
  return withWhy(verdicts.map((verdict) => ({ code: verdict.code, level: verdict.level, path: verdict.path, message: verdict.message })), why);
}

/** The nearest folder at or above `dir` that holds hfs.json (the app root of a workspace), or `dir` itself when none does (the lint then refuses it). */
export function appRootAbove(dir: string): string {
  for (let at = dir; ; at = path.dirname(at)) {
    if (fs.existsSync(path.join(at, HFS_DECLARATION_FILE))) return at;
    if (path.dirname(at) === at) return dir;
  }
}

/** `starci app lint`: ESLint per side, the app checks and stylelint over the fe side as one report; see lint/run.mjs. */
async function lintMain(argv: string[], io: AppIo): Promise<number> {
  const { cwd, harness, stdout, presets, prettier, runLinter, checkApp = appPass } = io;
  const opts = parseLintArgs(argv);
  // --workspace names a folder from the working directory (`starci app lint --workspace .` is an fe workspace script); the app
  // root is then the nearest folder above it that holds hfs.json, and the workspace is passed on app-relative.
  const workspaceDir = opts.workspace === undefined ? null : path.resolve(cwd, opts.workspace);
  const repoRoot = path.resolve(workspaceDir ? appRootAbove(workspaceDir) : cwd);
  if (workspaceDir) opts.workspace = path.relative(repoRoot, workspaceDir).split(path.sep).join('/');
  // The lint shares the cache of `app check`: --workspace reads it and writes none, --changed and --fix neither read nor write, --full judges again.
  const use: CacheUse = opts.changed !== null || opts.fix ? 'bypass' : opts.workspace !== undefined ? 'read' : 'normal';
  const selected = new Set<FamilyId>(['hfs', 'secrets', 'db', 'format']);
  // One session for the app findings and the linters, so the two never hold two answers; checkApp is a spec seam that brings its own.
  const session = io.checkApp === undefined ? openSession({ repoRoot, tracked: trackedFiles(repoRoot), io, full: opts.full === true ? new Set<FamilyId>([...selected, 'lint']) : undefined, use, planned: 1 }) : undefined;
  const { report, sonar, exit } = await lintRepository({
    repoRoot, opts, trackedFiles, runLinter, ...(session === undefined ? {} : { cache: { session } }),
    hfsCheck: (root: string) => checkApp({ repoRoot: root, harness, only: opts.changed ?? undefined, presets, prettier, io, selected, use, session }),
  });
  const flushed = session?.flush();
  const verdicts = session === undefined ? [] : verdictFindings(session);
  if (opts.out !== undefined) writeReport(path.resolve(cwd, opts.out), sonar);
  if (opts.format === 'json') stdout(`${JSON.stringify(report, null, 2)}
`); else printLintText(report, stdout);
  for (const verdict of verdicts) stdout(`${verdict.level.toUpperCase()} ${verdict.code}: ${verdict.message}\n`);
  for (const warning of flushed?.warnings ?? []) stdout(`cache: ${warning}\n`);
  return Math.max(exit, verdicts.some((verdict) => verdict.level === 'error') ? 1 : 0);
}

/**
 * The jest preset a new app renders its Sonar exclusions from: the copy this @starci/hfs ships (bundledPresets), the same version the
 * scaffold pins, so `npx starci-harness app scaffold` works before any dependency of the app is installed.
 */
const scaffoldPresets = () => bundledPresets();

/** The value of `--flag <value>` or `--flag=<value>`; a missing value, or one that is a flag, is refused. */
function flagValue(flag: string, arg: string, args: IterableIterator<string>): string {
  const value = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : args.next().value;
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

/** The flags every verb takes (--cwd, --quiet, --help), taken out of argv before the verb parses the rest. */
function globalOptions(argv: readonly string[], baseCwd: string): { argv: string[]; cwd: string; quiet: boolean; help: boolean } {
  const options: { argv: string[]; cwd: string; quiet: boolean; help: boolean } = { argv: [], cwd: baseCwd, quiet: false, help: false };
  const args = argv.values();
  for (const arg of args) {
    if (arg === '--cwd' || arg.startsWith('--cwd=')) options.cwd = path.resolve(baseCwd, flagValue('--cwd', arg, args));
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help') options.help = true;
    else options.argv.push(arg);
  }
  return options;
}

/**
 * Takes --edition out of the arguments of a verb that reads it: scaffold chooses the edition, check judges only the declared one and
 * world refuses a lite app. Any other verb receives --edition as its own argument and refuses it (upgrade with
 * HFS_UPGRADE_USAGE: editions are fixed at scaffold).
 */
function editionOption(verb: string, argv: string[]): { edition: string | undefined; argv: string[] } {
  if (PARSED[verb]?.edition !== true && verb !== 'world') return { edition: undefined, argv };
  let edition: string | undefined;
  const rest: string[] = [];
  const args = argv.values();
  for (const arg of args) {
    if (arg !== '--edition' && !arg.startsWith('--edition=')) {
      rest.push(arg);
      continue;
    }
    edition = flagValue('--edition', arg, args);
    if (!['full', 'lite'].includes(edition)) throw new Error('--edition accepts full or lite');
  }
  return { edition, argv: rest };
}

async function installedStackMain(cwd: string): Promise<(argv: string[], io: { cwd: string; out: unknown; err: unknown }) => unknown> {
  const require = createRequire(path.join(cwd, 'package.json'));
  let entry: string;
  try { entry = require.resolve('@starci/test-world/cli'); } catch {
    throw new Error('starci app world needs @starci/test-world installed in the app; run npm install --save-dev @starci/test-world');
  }
  const loaded: Dynamic = await import(pathToFileURL(entry).href); // reason: the app's own @starci/test-world/cli, imported at run time
  const candidate = loaded.main ?? loaded.default?.main;
  if (typeof candidate !== 'function') throw new Error('@starci/test-world/cli does not export main');
  return candidate;
}

function databaseMain(argv: string[], io: VerbIo): Promise<number> | number {
  const [verb, ...rest] = argv;
  const dispatch = DATABASE_VERBS.get(verb);
  if (!dispatch) throw new Error('starci app db takes new, baseline, restamp, migrate, post-cutover, dump or drift');
  return dispatch(rest, io);
}

function printCheckProofs(result: Dynamic, out: (text: string) => unknown): void {
  if (result.wiring) out(`boot wiring: ${result.wiring.status}, ${result.wiring.apps.length} app(s), ${result.wiring.findings.length} failure(s)\n`);
  if (result.coverage) out(formatCoverageReport(result.coverage));
}

/** The flags `check --staged` refuses: it is the pre-commit guard alone, so none of the whole-app pass's options means anything with it. */
const STAGED_REFUSES = ['--json', '--full', '--coverage-from', '--shard', ...FAMILY_FLAGS] as const;

/** The family a finding belongs to, for naming it when a verified run disagrees with the cache. */
function familyOf(finding: { code?: string | null; engine?: string }): FamilyId {
  const code = finding.code ?? '';
  if (finding.engine === 'eslint' || finding.engine === 'stylelint') return 'lint';
  if (code === 'HFS_FORMAT') return 'format';
  if (/^(DB_|LITE_DB_)/.test(code)) return 'db';
  if (code === 'BE_APP_BOOT_PROOF_MISSING' || code === 'BOOT_PROOF_TIMEOUT') return 'wiring';
  return SECRET_CODE_LIST.has(code) ? 'secrets' : 'hfs';
}

/** One run of the selected families against the cache, then the coverage proof on top; returns the result and what it took. */
async function checkRun({ io, selected, full, use, coverageFrom }: { io: AppIo; selected: Set<FamilyId>; full: Set<FamilyId> | undefined; use: CacheUse; coverageFrom: string | undefined }): Promise<{ result: Dynamic; seconds: number }> {
  const { cwd: repoRoot, harness, edition, presets, prettier, checkApp = appPass, runLinter } = io;
  const started = Date.now();
  const tracked = io.checkApp === undefined ? trackedFiles(repoRoot) : [];
  const session = io.checkApp === undefined ? openSession({ repoRoot, tracked, io, full, use, planned: tracked.length * Math.max(1, selected.size) }) : undefined;
  const checked = await checkEdition({ repoRoot, edition, normal: () => checkApp({ repoRoot, harness, presets, prettier, io, selected, full, use, session }), presets, prettier });
  const proof = withCheckProofs(checked, { repoRoot, edition, wiring: false, coverageFrom });
  const extra: Dynamic[] = [];
  const lines: string[] = [];
  let eslint: Awaited<ReturnType<typeof eslintRepository>> | null = null;
  if (selected.has('lint')) {
    if (session !== undefined) {
      const app = readRepoDeclaration(loadSlotManifest(), repoRoot);
      eslint = (await cachedLinters({ repoRoot, app, opts: { changed: null, fix: false, format: 'text', out: undefined, workspace: undefined }, workspace: null, onFe: null, run: runLinter, cache: { session } })).eslint;
    } else eslint = await eslintRepository({ repoRoot, changed: null, existing: [], run: runLinter });
  }
  if (session !== undefined && selected.has('types')) extra.push(...runTypesForApp(session, { repoRoot, tracked, env: io.env }).findings);
  if (session !== undefined && selected.has('test')) {
    const tests = await runTestForApp(session, { repoRoot, tracked });
    extra.push(...tests.findings);
  }
  if (session !== undefined && selected.has('sonar')) lines.push(...(runSonarForApp(session, { repoRoot })?.lines ?? []));
  const flushed = session?.flush();
  const verdicts = session === undefined ? [] : verdictFindings(session);
  const reports: FamilyReport[] = session === undefined ? [...(checked.families ?? [])] : [...session.reports];
  const findings = [...proof.findings, ...extra, ...verdicts, ...(eslint?.findings ?? []).map(finding => ({ ...finding, code: finding.code ?? finding.rule, level: 'error' }))];
  // Green under the threshold (gate-threshold.mjs): every finding is still listed, only the verdict changes.
  const verdict = gateVerdict(findings.filter(finding => finding.level === 'error'));
  const toolErrors = eslint?.errors ?? [];
  const counts = { ...proof.counts, error: findings.filter(finding => finding.level === 'error').length, warning: findings.filter(finding => finding.level === 'warning').length };
  const result = { ...proof, findings, families: reports, predictions: lines, cacheWarnings: [...(checked.cacheWarnings ?? []), ...(flushed?.warnings ?? [])], counts, ...(eslint ? { eslint: { ...eslint.engine, errors: eslint.errors } } : {}), ok: verdict.pass && toolErrors.length === 0, gate: verdict };
  return { result, seconds: (Date.now() - started) / 1000 };
}

/** STARCI_APP_CHECK_CACHE=verify: the diff-only run, then the full run, compared finding by finding; any difference names family and file (exit 2). */
async function verifyCache(io: AppIo, selected: Set<FamilyId>, coverageFrom: string | undefined): Promise<number> {
  const diff = await checkRun({ io, selected, full: undefined, use: 'read', coverageFrom });
  const full = await checkRun({ io, selected, full: new Set(selected), use: 'bypass', coverageFrom });
  const keyed = (result: Dynamic): Map<string, string> => new Map((result.findings as Dynamic[]).map((finding) => [`${finding.code}|${finding.path ?? ''}|${finding.message}`, `${familyOf(finding)}: ${finding.path ?? finding.code}`]));
  const left = keyed(diff.result);
  const right = keyed(full.result);
  const differences = [...left].filter(([key]) => !right.has(key)).map(([, name]) => `diff-only only: ${name}`)
    .concat([...right].filter(([key]) => !left.has(key)).map(([, name]) => `full only: ${name}`)).sort();
  io.stdout(`${CACHE_ENV}=verify: diff-only ${diff.seconds.toFixed(1)}s, full ${full.seconds.toFixed(1)}s, ${right.size} finding(s) compared\n`);
  for (const report of diff.result.families as FamilyReport[]) io.stdout(`  diff-only ${familyLine(report)}\n`);
  if (differences.length === 0) { io.stdout('  identical\n'); return 0; }
  for (const difference of differences) io.stdout(`  DIFFERENCE ${difference}\n`);
  return 2;
}

async function checkMain(opts: Opts, io: AppIo): Promise<number> {
  const { cwd: repoRoot, edition, stdout: out } = io;
  if (opts.positional.length) throw new Error('starci app check takes no path');
  if (opts.staged === true) {
    const given = [...STAGED_REFUSES.filter((flag) => opts[flag.slice(2)] !== undefined), ...(edition === undefined ? [] : ['--edition'])];
    if (given.length) throw new Error(`starci app check --staged is the pre-commit guard alone and takes no ${given.join(', ')}`);
    return runWorkHygiene({ cwd: repoRoot, out: (text) => out(`${text}\n`) });
  }
  const coverageFrom = valueFlag(opts, 'coverage-from');
  const shard = valueFlag(opts, 'shard');
  if (shard !== undefined) {
    // The sharded full unit run of CI (--test --full --shard <i>/<n>): the shard's Jest run in the shape the shard merge reads; nothing is recorded.
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    if (match === null || opts.test !== true || opts.full !== true) throw new Error('--shard <i>/<n> belongs to `starci app check --test --full`');
    return runTestShard(repoRoot, Number(match[1]), Number(match[2]));
  }
  const explicit = selectedFamilies(opts, []);
  // A coverage report judged on its own (the merge job of a sharded run) runs no family; with selectors it comes on top of them.
  const selected = explicit.size > 0 ? explicit : coverageFrom === undefined ? new Set<FamilyId>(DEFAULT_FAMILIES) : new Set<FamilyId>();
  const full = opts.full === true ? new Set(selected) : undefined;
  if (io.env[CACHE_ENV] === 'verify') return verifyCache(io, selected, coverageFrom);
  const { result, seconds } = await checkRun({ io, selected, full, use: coverageFrom !== undefined && explicit.size === 0 ? 'bypass' : 'normal', coverageFrom });
  if (opts.json) out(`${JSON.stringify(result, null, 2)}\n`);
  else { printCheck(result, out); printCheckProofs(result, out); if (result.gate.line) out(`${result.gate.line}\n`); }
  const exit = result.eslint?.errors.length ? 2 : result.ok ? 0 : 1;
  writeRunLog(repoRoot, { command: `check${[...selected].map((family) => ` --${family}`).join('')}${opts.full === true ? ' --full' : ''}`, seconds, exit, families: (result.families as FamilyReport[]).map((report) => ({ ...report, seconds: 0 })) }, io.env);
  return exit;
}

function emitMain(opts: Opts, { cwd: repoRoot, stdout: out }: AppIo): number {
  if (opts.positional.length) throw new Error('starci app emit takes no path');
  const be = readRepoDeclaration(loadSlotManifest(), repoRoot).sides?.be;
  if (!be) throw new Error('starci app emit runs at the app root (the folder of hfs.json)');
  const { written, skipped, standIns } = emitContracts({ repoRoot: path.join(repoRoot, 'be'), declaration: be });
  for (const file of written) out(`wrote be/${file}\n`);
  const skipSummary = skipped.length ? `, ${skipped.join(', ')} serve no GraphQL` : '';
  out(`starci app emit: ${written.length} written${skipSummary}\n`);
  for (const [app, lines] of Object.entries(standIns) as [string, string[]][]) {
    out(`${app}: ${lines.length} dependenc${lines.length === 1 ? 'y' : 'ies'} of the resolvers could not load here and stood in (no GraphQL type is affected):\n`);
    for (const line of lines) out(`  ${line}\n`);
  }
  return 0;
}

/** The nouns of `add` that write into an existing app's files by their own generators (scaffold/service.mjs, scaffold/image.mjs) and take no pattern option. */
const ADD_FILE_NOUNS = ['service', 'spec', 'image'];

/** `add service <dir> <name> [--inject ...]`, `add spec <file>.service.ts` and `add image`: never overwrites; an option another noun takes is refused. */
function addFileNoun(noun: string, opts: Opts, repoRoot: string, out: (text: string) => unknown): number {
  const [, ...args] = opts.positional;
  const [first = '', second = ''] = args;
  const foreign = ADD_FLAGS_ALL.filter((flag) => opts[flag.slice(2)] !== undefined);
  if (foreign.length) throw new Error(`starci app add ${noun} takes no ${foreign.join(', ')}`);
  if (noun !== 'service' && opts.inject !== undefined) throw new Error(`starci app add ${noun} takes no --inject; only add service does`);
  let written: string[];
  if (noun === 'service' && args.length === 2) written = newService({ repoRoot, dir: first, name: second, inject: listFlag(opts, 'inject') ?? [] });
  else if (noun === 'spec' && args.length === 1) written = newSpec({ repoRoot, file: first });
  else if (noun === 'image' && args.length === 0) written = newImages({ repoRoot });
  else throw new Error('starci app add takes `service <dir> <name> [--inject ...]`, `spec <file>.service.ts` or `image`');
  for (const file of written) out(`created ${file}\n`);
  return 0;
}

function addMain(opts: Opts, { cwd: repoRoot, stdout: out }: AppIo): number {
  const [noun, name, ...extra] = opts.positional;
  if (noun !== undefined && ADD_FILE_NOUNS.includes(noun)) return addFileNoun(noun, opts, repoRoot, out);
  if (opts.inject !== undefined) throw new Error(`starci app add ${noun ?? '<noun>'} takes no --inject; only add service does`);
  if (!noun || !name || extra.length) throw new Error('starci app add takes `<noun> <name>` and the options of the noun');
  const { created, registered } = addKind({ repoRoot, noun, name, options: { event: opts.event, from: opts.from, service: opts.service, connection: opts.connection, owner: opts.owner, failed: opts.failed, done: opts.done, fe: booleanFlag(opts, 'fe'), shapes: valueFlag(opts, 'shapes'), read: valueFlag(opts, 'read'), app: valueFlag(opts, 'app'), kind: valueFlag(opts, 'kind'), form: booleanFlag(opts, 'form'), blocks: valueFlag(opts, 'blocks'), tabs: valueFlag(opts, 'tabs') } });
  for (const file of created) out(`created ${file}\n`);
  const kinds = registered.kinds.length ? `; kinds ${registered.kinds.join(', ')}` : '';
  // A noun that registers nothing in hfs.json (a table, an app, a front-end unit) ends with what it wrote.
  if (registered.patterns.length || registered.kinds.length) out(`starci app add ${noun}: registered patterns ${registered.patterns.join(', ')}${kinds}\n`);
  return 0;
}

async function scaffoldMain(opts: Opts, { cwd, harness, edition = 'full', presets, lock, stdout: out }: AppIo): Promise<number> {
  const [name, ...extra] = opts.positional;
  const registryVisibility = valueFlag(opts, 'registry-visibility');
  if (!name || extra.length) throw new Error(`starci app scaffold takes \`${((VERB_USAGE.scaffold as string[])[0] as string).slice('starci app scaffold '.length)}\``);
  const { root: created, files } = scaffoldApp({ name, into: path.resolve(cwd), harness, edition, presets: presets ?? scaffoldPresets(), ...(registryVisibility === undefined ? {} : { registryVisibility }), ...(lock ? { lock } : {}) });
  out(`starci app scaffold: created ${created} (${files.length} files); next: npm ci (the lockfile, then the git hooks through npm run prepare; after npm ci --ignore-scripts run npm run prepare), then starci app lint\n`);
  return 0;
}

function slotMain(opts: Opts, { cwd: repoRoot, stdout: out }: AppIo): number {
  if (opts.positional.length !== 1) throw new Error('starci app slot takes exactly one path');
  const [input = ''] = opts.positional;
  const explained = explainPath({ repoRoot, input });
  if (opts.json) out(`${JSON.stringify(explained, null, 2)}\n`); else printExplain(explained, out);
  return explained.status === 'no-slot' || explained.status === 'ambiguous' ? 1 : 0;
}

function upgradeAppMain(argv: string[], { cwd, stdout }: AppIo): Promise<number> {
  return upgradeMain(['--repo', cwd, ...argv], { stdout });
}

/** The edition `hfs.json` declares, or undefined when it cannot be read (the test-world verbs then decide on their own). */
function declaredEdition(cwd: string): string | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, HFS_DECLARATION_FILE), 'utf8')).edition; } catch { return undefined; }
}

/** `starci app stack`: the deploy actions (prepare, render, deploy, converge, verify, rollback, prune, backup, jobs, ...) are the Swarm tooling of stack/cli.mjs. */
async function stackAppMain(argv: string[], { cwd, stdout: out, stderr: err, env, sops, hostIdentity, stackIo, harness }: AppIo): Promise<number> {
  return deployStackMain(argv, { ...stackIo, cwd, stdout: out, stderr: err, env, hostIdentity, harness, ...(sops ? { sops } : {}) });
}

/** The actions of `starci app world`: the full edition's test-world infrastructure, run by the app's installed @starci/test-world cli. */
const WORLD_ACTIONS = ['up', 'down', 'status'];

/** `starci app world <up|down|status>`: the local test world. */
async function worldAppMain(argv: string[], { cwd, edition, stackMain, stdout: out, stderr: err }: AppIo): Promise<number> {
  if (!WORLD_ACTIONS.includes(argv[0] as string)) throw new Error(`starci app world takes ${WORLD_ACTIONS.join(', ')}`);
  if ((edition ?? declaredEdition(cwd)) === 'lite') throw new Error('starci app world up|down|status manage the local test world of the full edition; a lite app starts its local database with npm run db:start');
  const run = stackMain ?? await installedStackMain(cwd);
  return run(argv, { cwd, out, err }) as Promise<number>;
}

const DIRECT_VERBS = new Map<string, (argv: string[], io: AppIo) => Promise<number> | number>([['ci', async (argv: string[], io: AppIo) => (await import('../ci/cli.mjs')).ciMain(argv, io)], ['lint', lintMain], ['secret', secretMain], ['db', databaseMain], ['upgrade', upgradeAppMain], ['stack', stackAppMain], ['world', worldAppMain], ['release', releaseMain], ['coverage', async (argv: string[], io: AppIo) => (await import('../coverage/cli.mjs')).coverageMain(argv, io)], ['codemod', codemodMain]]);

function dispatchMain(verb: string, argv: string[], io: AppIo): Promise<number> | number {
  if (verb === 'sync') return syncMain([verb, ...argv], io);
  const direct = DIRECT_VERBS.get(verb);
  if (direct) return direct(argv, io);
  return (PARSED[verb] as ParsedVerb).run(parse(verb, argv), io);
}

function errorMessage(error: unknown): string {
  if (error instanceof EditionRefusal || error instanceof UpgradeError || error instanceof HfsSlotsError || error instanceof SyncError) return `${(error as Error).message}\n`;
  if (error instanceof ScaffoldError) return `${(error as { code: string }).code}: ${(error as Error).message}\n`;
  return `starci app: ${(error as Error).message}\n${USAGE}`;
}

/**
 * `harness` ({ version }) is the CLI that runs this package in-process: its version is the starci-harness an app is judged and
 * scaffolded at (runtime/scripts/hfs/canon-pins.mjs). `run` injects the database runner, `runLinter` the linter transport, `checkApp`
 * the HFS check and `stackIo` Swarm tools; production defaults execute every check. `hostIdentity` ({ label, read }) is the
 * harness CLI's own secret.env SOPS_AGE_KEY, which every verb that opens a sealed member (secret, stack, release, db) reads last for the age identity (decryptionIdentity); `prompt` replaces its masked prompt.
 */
export async function main(argv: string[], {
  cwd: baseCwd = process.cwd(), harness, stdout = (s: string): unknown => process.stdout.write(s), stderr = (s: string): unknown => process.stderr.write(s), presets, prettier, lock, run, stackMain,
  env = process.env, stdin, prompt, hostIdentity, sops, tools, platform, stackIo, runLinter, checkApp, stderrIsTty = process.stderr.isTTY === true,
}: MainOptions = {}): Promise<number> {
  try {
    const global = globalOptions(argv, path.resolve(baseCwd));
    const [verb, ...given] = global.argv;
    // --quiet silences stdout for every verb but check and lint, whose diagnosis it keeps (their progress on stderr is what it mutes).
    const out = global.quiet && !['check', 'lint'].includes(verb as string) ? () => {} : stdout;
    if (global.help) { out(USAGE); return 0; }
    if (!VERBS.includes(verb as string)) { stderr(USAGE); return 2; }
    const { edition, argv: rest } = editionOption(verb as string, given);
    return await dispatchMain(verb as string, rest, { cwd: global.cwd, harness, edition, quiet: global.quiet, stderrIsTty, stdout: out, stderr, presets, prettier, lock, run, stackMain, env, stdin, prompt, hostIdentity, sops, tools, platform, stackIo, runLinter, checkApp });
  } catch (error) {
    stderr(errorMessage(error));
    return 2;
  }
}

// Run when this file is the entry point, compared by real path. The package itself has no bin; this is useful for local diagnostics.
if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
