// The @starci/hfs implementation behind `starci app`: one repository, `<app>/`, with one package.json, lockfile and node_modules
// at its root and two sides, be/ and fe/, declared by the one hfs.json of kind app. Every verb runs at the app root.
//   starci app check [--cwd <dir>] [--json] [--gate <hfs|format|db|secrets|wiring|types|lint|test|sonar|build|audit|codecov>]... [--side be|fe|packages] [--fix] [--out <sonar file>] [--env local|prod] [--fresh] [--coverage-from <lcov>] [--shard <i>/<n>] | check --staged | check --ratchet | check --profile [--gate <gate>] [--json]
//                                            every tracked path has a slot; required files exist; nothing forbidden or
//                                            tracked-that-must-be-ignored; pins match; every managed file equals its render
//                                            (sync/managed.mts, the .gitignore block and sonar-project.properties included); no empty or ghost
//                                            directory, no untracked entry outside an ignored slot; plaintext secrets, the .starcistacks shape, CI
//                                            and pre-push canon steps, dependency version skew, the contract snapshot and the test, wire and i18n
//                                            trees; prettier over every tracked file through the repository's own install (sync/format.mts; a repository
//                                            without prettier is a refusal); soft-size backlog (report only); then the whole
//                                            architecture machine (tiers, owners, clones, dead exports, module registration, the
//                                            front-end and back-end source rules), each violation a finding with its why.
//                                            ESLint executes once per side through the installed managed config; the FE config composes
//                                            the universal canon and the explicitly selected Grammar-family canon.
//                                            The results are committed in .starcistacks/cache/ (cache/, contexts/project/check-cache.md): a run with no selector
//                                            runs every family diff-only against the cache (reusing every valid record and recomputing what a change or a moved pin
//                                            invalidated), the CI-parity families (build, audit) and CI's coverage step, writes what it judged back, and refuses a
//                                            tree whose committed cache that run changed or that holds uncommitted cache files (HFS_CHECK_CACHE_UNWARMED), a host
//                                            that cannot write a portable cache (HFS_CHECK_CACHE_UNPORTABLE) or a cache file too large to push: every push carries warm
//                                            records. A missing cache or a fingerprint change selects full automatically. Repeat --gate to select gates (a selector runs
//                                            those gates alone, with no parity and no cache verdict); sonar and codecov select the same combined baseline predictions, not
//                                            server verdicts. --fresh is the escape hatch for a broken or suspect cache: it ignores the records, recomputes the selected
//                                            families from scratch and writes the refreshed records (commit them, then run app check again). Never for routine use.
//                                            --env local|prod (default local) says what the run is judged fit for: both judge the same code checks; local lists the findings only a
//                                            local-registry loop causes (failure-codes.yaml `localOnly`) as report-only, prod (the hook, CI, the release gate) blocks on them.
//                                            Each family prints one diagnosis line (full or diff and why, checked, reused, findings new, known, fixed);
//                                            progress goes to stderr (--quiet silences it).
//                                            --coverage-from <lcov> judges a coverage report produced elsewhere (the merge of a sharded unit run) and records nothing.
//                                            --side be|fe|packages limits the lint gate to one side or to the root packages (a CI matrix runs one per scope). --out <file> writes every finding of the run as ONE
//                                            Sonar Generic Issue Import document (engine ids starci-hfs, eslint, stylelint). --fix runs ESLint and stylelint with --fix before the
//                                            check and is refused unless --gate lint is selected.
//                                            --staged: the pre-commit guard alone (sync/hygiene.mts: staged .starciwork and .starcistacks paths, the secrets
//                                            guard and the bypass guard over every staged file read from the index, a new back-end logic file staged
//                                            without its unit spec); it takes no other flag.
//                                            Every run is under the branch profile of the branch it judges (runtime/scripts/hfs/branch-profile.mts, `branches` of
//                                            .starcistacks/application-stacks.yaml; contexts/project/lint.md PROJECT-LINT-2): a gate the profile reports runs and records,
//                                            its findings marked `report` and outside the verdict; an off gate does not run; each prints one notice. Where lint
//                                            reports, the lint ratchet (lint/ratchet.mts) refuses the commits since the base that add lint findings to a file they touch.
//                                            --profile prints the profile (with one --gate, only that gate's mode: the word the pre-commit hook reads);
//                                            --ratchet is the pre-commit lint ratchet over the staged files against HEAD. Both take no other flag.
//                                            Exit 1 with any error finding that is not report-only (gate-verdict.mts). The root checks run once and
//                                            the side checks and the machine once per side, the side folder as their root; every path is app-relative.
//   starci app scaffold <name> [--cwd <dir>]  a new app <dir>/<name>/ (<dir> is the global --cwd): the root (hfs.json, package.json, managed files, .starciwork) and the
//                                            be/ and fe/ skeletons (scaffold/app.mts). Accepts an empty unborn main Git root.
//   starci app slot <path> [--cwd <dir>] [--json]   which slot owns the path, its tier, allowed imports, required tests.
//   starci app emit [--cwd <dir>]      write be/contracts/<app>/schema.graphql of every api app that serves GraphQL (emit/contracts.mts):
//                                            printSchema(lexicographicSortSchema) of the resolvers the app root composes; no env, no database, no network.
//   starci app sync [--execute] [--cwd <dir>]  the managed files of the root (scripts, husky, CI, .gitignore block, sonar, prettier) and
//                                            of each side (tsconfig, eslint, jest, stylelint); sync/cli.mts. Dry run unless --execute: it reports drift and exits 1 on it.
//   starci app coverage merge --out <lcov> <lcov-or-dir>...  the lcov reports of the sharded unit run merged into one (coverage/cli.mts; the managed CI coverage job)
//   starci app add service <dir> <name> [--inject <Decorator>=<module>:<Type> | <Class>=<module>]... [--cwd <dir>]
//                                            a back-end `<name>.service.ts` and its `<name>.service.spec.ts` skeleton (scaffold/service.mts; <dir> is
//                                            relative to be/): the spec is built
//                                            with Test.createTestingModule, one provider per constructor dependency (kit doubles from @starci/jest-preset),
//                                            one placeholder it per public method. Never overwrites a file. Both editions: a lite back end keeps full's unit specs (R212).
//   starci app add image [--cwd <dir>]                  the Dockerfile of every declared app that has none, from the image canon (scaffold/image.mts); never overwrites
//   starci app add inbox [--cwd <dir>]                  the delivery inbox of a FULL app that has its webhooks already (platform/inbox and platform/idempotency, their
//                                            migrations and catalogs in each compose/platform.ts, InboxModule in the webhooks group; scaffold/add-inbox-full.mts): the same
//                                            `add webhook <name>` lays down for a new webhook. All or nothing, a no-op when it is there; a lite app gets its inbox from `add webhook`
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
//   starci app ci secret set <NAME> [--from-custody] [--env E | --dependabot] [--repo owner/name] [--execute]  stdin or the explicit service custody binding; dry until --execute.
//   starci app ci var set <NAME> [--env E] [--value v] [--execute] | var sync [--execute] | verify [--json] | local [--execute]
//                                            declared GitHub CI custody; verify compares names, scopes and public values; local prints the CI plan, --execute runs it.
//   starci app db new <name> | baseline | restamp --map <restamp.yaml> | migrate | post-cutover | dump | drift   [--db-url-env <NAME>]
//                                            baseline and restamp preview and mutate only with --execute; migrate without --execute prints the plan and compares
//                                            the database with the repo (exit 0 agree, 1 drift, 2 refused).
//   starci app add <api|webhook|realtime|saga|job|reactor|queue|projection> <name> [--event <event> --from <service> --service <Class>=<module>] [--owner <service> --failed <event> --done <event>] [--connection <name>] [--cwd <dir>]
//                                            exactly that kind's file tree, generated FROM the files: tree of its pattern topic (knowledge/patterns/be) with the
//                                            one template body of each entry (templates/be/patterns), plus the platform capabilities it needs when they are missing;
//                                            it registers the patterns and the trigger kind in hfs.json (sides.be.patterns, sides.be.kinds). Never overwrites a file (scaffold/add.mts). In a lite app a noun whose slots lite does not have refuses: `add <noun>: full edition only`.
//   starci app add connection <name> --owner <api|worker app> [--isolation database|schema] [--env-prefix <PREFIX>] [--cwd <dir>]
//                                            one more database connection of a full app: the hfs.json entry, its platform/database files, the rosters, the dev database and the production secret (scaffold/add-connection.mts)
//   starci app add <block|frame|composite|branch|leaf> <name> [--shapes a,b,c] [--read <read>] [--app <fe app>] [--cwd <dir>]
//   starci app add <page|layout> <route> [--blocks a,b] [--tabs a,b (page)] | overlay <name> --kind modal|drawer [--form]   a route page, segment layout
//                                            or overlay owner (scaffold/add-fe-page.mts, add-fe-layout.mts, add-fe-overlay.mts).
//                                            one front-end unit in the shape-slot pattern from templates/fe/units (scaffold/add-fe-unit.mts); the
//                                            first block writes the app's one copy of the status owners. Never overwrites a unit.
// The flags of every verb are those of USAGE below, generated from the parser tables that refuse every other flag.
// Every finding names a why code and carries its Vietnamese text. check and slot read the app, never write to it. Exit codes:
// 0 clean, 1 error findings, 2 a refusal or bad usage.
import fs from 'node:fs';
import { availableParallelism } from 'node:os';
import { isHostHeld, type HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isMain } from '../runtime/scripts/lib/is-main.mjs';
import { explainPath, readWhy, trackedFiles, withCheckProofs } from '../runtime/scripts/hfs/check.mjs';
import { withWhy } from '../runtime/scripts/hfs/check-results.mjs';
import { LegacyStateHeld, adoptLegacyState, skillRoot } from '../runtime/engine/runtime-root.mjs';
import type { StateAdoption } from '../runtime/engine/runtime-root.mjs';
import { secretMain } from '../runtime/scripts/hfs/secret.mjs';
import { dbBaselineMain } from '../runtime/scripts/hfs/db-baseline-verb.mjs';
import { dbRestampMain } from '../runtime/scripts/hfs/db-restamp-verb.mjs';
import { formatCoverageReport } from '../runtime/scripts/hfs/coverage-from.mjs';
import { gateVerdict } from '../runtime/scripts/hfs/gate-verdict.mjs';
import { activeProfile, familyModes, profileLabel, profileNotices, type ActiveProfile } from '../runtime/scripts/hfs/branch-profile.mjs';
import { PROFILE_GATES } from '../runtime/scripts/lib/stack-declaration.mjs';
import { HFS_DECLARATION_FILE, HfsSlotsError, SIDES, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { main as syncMain } from '../sync/cli.mjs';
import { runWorkHygiene } from '../sync/hygiene.mjs';
import { STYLE_GLOB, SyncError, bundledPresets } from '../sync/index.mjs';
import { emitContractsAsync } from '../emit/contracts.mjs';
import { ScaffoldError, newService, newSpec } from '../scaffold/service.mjs';
import { EditionRefusal } from '../scaffold/edition-gate.mjs';
import { addKind } from '../scaffold/add.mjs';
import { removeModule } from '../scaffold/add-module.mjs';
import { scaffoldApp, type LockResult } from '../scaffold/app.mjs';
import { newImages } from '../scaffold/image.mjs';
import { ESLINT_HEAP_ENV, PACKAGES, cachedLinters, eslintRepository, runLinter as nativeLinter, type CachedLinters } from '../lint/run.mjs';
import { devBranchFinding } from '../runtime/scripts/hfs/dev-branch.mjs';
import { COVERAGE_NEW_CODE, LINT_NEW_CODE, newCodeCoverageFindings, newCodeLintFinding, onChangedLine } from '../cache/new-code.mjs';
import { committedLintCounts, rangeTouched, ratchetBase, ratchetFindings, sessionLintCounts, stagedTouched } from '../lint/ratchet.mjs';
import { newCodeSince, runSonarForApp, runTestForApp, runTestShard, runTypesForApp } from '../cache/app-families.mjs';
import { TSC_HEAP_ENV } from '../cache/types-family.mjs';
import { createDiskSession, type DiskSession } from '../cache/session.mjs';
import { freshnessFindings } from '../cache/freshness.mjs';
import { CHECK_ENVS, checkEnvOf, judgedForEnv, localOnlyCodes, localReported, localVerdictLine, type CheckEnv } from '../runtime/scripts/hfs/check-env.mjs';
import { DEFAULT_FAMILIES, mergeAppPass, runDbStep, runFormatStep, runStructureStep, runWiringStep, type AppPassParts, type AppRunInput } from '../cache/run.mjs';
import { CHECK_GRAPH, createLanes, formatStepRows, runGraph, stepRow, type StepBody, type StepId } from '../cache/schedule.mjs';
import { runParityFamilies, type ParityRun } from '../cache/parity-family.mjs';
import { LINT_REPORT, runSonarScan } from '../cache/sonar-scan-family.mjs';
import { createProgress, elapsedText, silentProgress } from '../cache/progress.mjs';
import { familyLine } from '../cache/report.mjs';
import { writeRunLog } from '../cache/run-log.mjs';
import { FAMILIES, type FamilyId, type FamilyReport } from '../cache/types.mjs';
import { SECRET_CODES as SECRET_CODE_LIST } from '../cache/hfs-family.mjs';
import { linterReport, mergeReports, sonarReport, sourceRootsOf, writeReport } from '../report/sonar.mjs';
import { stylelintFindings } from '../report/stylelint-findings.mjs';
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
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
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
  runHeavyNode?: HeavyNodeRun | undefined;
  /** The room the CLI's governor would give the next heavy child now, MB (free RAM less the reserve and what recent admissions planned); a step sizes its parallel children by it. */
  heavyRoom?: (() => number) | undefined;
  /** The runtime root whose host state main moves out of an installed copy before a verb (adoptLegacyState); this package's by default. */
  stateRoot?: string | undefined;
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

/** An argument the parser refuses (an unknown flag, a missing value, a form a verb does not take): the one error `main` follows with the usage. */
export class UsageError extends Error {}

export const VERBS = Object.freeze(['scaffold', 'add', 'remove', 'sync', 'check', 'upgrade', 'stack', 'world', 'release', 'slot', 'emit', 'secret', 'ci', 'db', 'coverage', 'codemod']);
const DATABASE_VERBS = new Map<string | undefined, (argv: string[], io: VerbIo) => Promise<number> | number>([['baseline', dbBaselineMain], ['restamp', dbRestampMain],['migrate', dbMigrateMain], ['post-cutover', dbPostCutoverMain], ['dump', dbDumpMain], ['new', dbNewMain], ['drift', dbDriftMain]]);

/**
 * The verbs parsed here, each with the only flags it takes ({ boolean, value, list }); a flag of another verb is refused, never ignored.
 * `forms` are its usage lines: the operands and, where a form takes fewer flags than the verb, its own. `edition` marks a verb that reads the
 * global --edition (editionOption).
 */
/** The flags of the add nouns that generate a file tree from a pattern (service, spec and image take none of them, and --inject is only theirs). */
const ADD_FLAGS: FlagTable = { value: ['--event', '--from', '--service', '--connection', '--owner', '--failed', '--done', '--shapes', '--read', '--app', '--kind', '--blocks', '--tabs', '--isolation', '--env-prefix'], boolean: ['--fe', '--form'] };
/** The repeatable selector of `app check`; its values are the canonical family vocabulary. */
const GATE_FLAGS = ['--gate'] as const;
/** Both quality selectors dispatch to the existing combined Sonar/Codecov baseline family. */
const CHECK_GATES = [...FAMILIES, 'codecov'] as const;
const PARSED: Record<string, ParsedVerb> = {
  scaffold: { run: scaffoldMain, value: ['--registry-visibility'], edition: true, forms: [{ operands: '<name>' }] },
  add: {
    run: addMain, ...ADD_FLAGS, list: ['--inject'],
    forms: [
      { operands: '<api|webhook|realtime|saga|job|reactor|queue|projection|cli|table|app|connection|module|block|frame|composite|branch|leaf|page|overlay|layout> <name>', only: ADD_FLAGS },
      { operands: 'service <dir> <name>', only: { list: ['--inject'] } },
      { operands: 'spec <file>.service.ts', flags: [] },
      { operands: 'image', flags: [] },
      { operands: 'inbox', flags: [] },
    ],
  },
  remove: { run: removeMain, forms: [{ operands: 'module <name>', flags: [] }] },
  check: { run: checkMain, value: ['--coverage-from', '--shard', '--side', '--out', '--env'], list: GATE_FLAGS, boolean: ['--json', '--staged', '--fix', '--fresh', '--profile', '--ratchet'], edition: true, forms: [{ only: { boolean: ['--json', '--fix', '--fresh'], list: GATE_FLAGS, value: ['--coverage-from', '--shard', '--side', '--out', '--env'] } }, { only: { boolean: ['--staged'] }, edition: false }, { only: { boolean: ['--ratchet'] }, edition: false }, { only: { boolean: ['--profile', '--json'], list: GATE_FLAGS }, edition: false }] },
  slot: { run: slotMain, boolean: ['--json'], forms: [{ operands: '<path>' }] },
  emit: { run: emitMain, forms: [{}] },
};
const flagsOf = (spec: FlagTable): readonly string[] => [...(spec.boolean ?? []), ...(spec.value ?? []), ...(spec.list ?? [])];
const ADD_FLAGS_ALL = flagsOf(ADD_FLAGS);
/** Every flag some parsed verb takes, and the global --edition: naming one on a verb that does not take it says so. */
const PARSED_FLAGS = new Set([...Object.values(PARSED).flatMap(flagsOf), '--edition']);

/** The placeholder of a value flag in the usage; any other prints as <name>. */
const PLACEHOLDERS: Record<string, string> = {
  '--gate': `<${CHECK_GATES.join('|')}>`,
  '--registry-visibility': 'public|private', '--side': 'be|fe|packages', '--env': CHECK_ENVS.join('|'), '--edition': 'full|lite', '--base': '<ref>', '--coverage-from': '<lcov>', '--shard': '<i>/<n>', '--inject': '<binding>',
  '--event': '<event>', '--from': '<service>', '--service': '<Class>=<module>', '--owner': '<service>', '--failed': '<event>', '--done': '<event>',
  '--shapes': '<a,b,c>', '--blocks': '<a,b>', '--tabs': '<a,b>', '--kind': 'modal|drawer', '--isolation': 'database|schema', '--env-prefix': '<PREFIX>', '--image': '<service>=<ref>', '--sha': '<sha>',
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

/** The usage of each verb, from the tables its parser refuses every other flag with (codemod and upgrade keep hand-parsed arguments, held by main.spec.mjs). */
const VERB_USAGE: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(PARSED).map(([verb, spec]) => [verb, spec.forms.map((form: UsageForm) => line(`starci app ${verb}`, form.operands,
    specUsage(form.only ?? (form.flags === undefined ? spec : { value: form.flags })), spec.edition && form.edition !== false ? flagUsage('--edition', { value: true }) : ''))])),
  codemod: CODEMODS.map((name: string) => `starci app codemod ${name} [--execute] [--json] [--format json|markdown] [--out <file.json|file.md>]`),
  upgrade: ['starci app upgrade [--execute]'],
  sync: [SYNC_USAGE.sync],
  world: ['starci app world <up|down|status> [--stack <dir>] [--services <list>] [--k3d] [--force] [--json] [--edition full|lite]'],
  stack: [
    ...STACK_ACTIONS.map((action) => line(`starci app stack ${action}`, STACK_OPERANDS[action], STACK_READ_ONLY.includes(action) ? flagUsage('--env', { value: true }) : '--env <env>',
      STACK_FLAGS[action].map((flag: string) => flagUsage(flag, { value: STACK_VALUE.has(flag), repeat: STACK_REPEAT.has(flag) })), '[--json]')),
    // The dev actions of a docker-compose environment (stack/local-cli.mts); prepare, status and verify above answer them too.
    'starci app stack doctor --env <env> [--json]',
    'starci app stack up --env <env> [--execute] [--timeout <seconds>] [--json]',
    'starci app stack down --env <env> [--execute] [--json]',
    'starci app stack logs --env <env> --service <name> [--lines <n>] [--json]',
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
      if (!given || given.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      if (list.includes(flag)) opts[key] = [...((opts[key] as string[] | undefined) ?? []), given];
      else if (opts[key] !== undefined) throw new UsageError(`${flag} may be given only once`);
      else opts[key] = given;
    } else if (boolean.includes(flag)) throw new UsageError(`${flag} takes no value`);
    else throw new UsageError(PARSED_FLAGS.has(flag) ? `starci app ${verb} takes no ${flag}` : `unknown flag ${flag}`);
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
  for (const line of formatStepRows(result.steps ?? [], elapsedText)) out(`${line}
`);
  for (const warning of (result.cacheWarnings ?? []) as string[]) out(`  cache: ${warning}
`);
  for (const notice of (result.branchProfile?.notices ?? []) as string[]) out(`  ${notice}
`);
  for (const line of (result.predictions ?? []) as string[]) out(`  ${line.trim()}
`);
  out(`  architecture machine: ${machineDescription(result.machine)}
`);
  if (result.contracts) out(`  contract snapshots: ${contractDescription(result.contracts)}
`);
  if (result.eslint) {
    const sides = (Object.entries(result.eslint.sides) as [string, Dynamic][]).map(([side, run]) => `${side}: ${run.files} files${run.skipped ? ` (${run.skipped})` : ''}`).join(', ');
    out(`  ESLint: ${sides}
`);
    for (const error of result.eslint.errors) out(`  ${error.startsWith('stylelint ') ? 'stylelint' : 'ESLint'} tool error: ${error}
`);
  }
}

function printFindingGroup(code: string, list: Dynamic[], out: (text: string) => unknown): void {
  const first = list[0] as Dynamic;
  const label = `${String(first.level).toUpperCase()}${first.local === true && first.report === true ? ', LOCAL, REPORT ONLY' : first.report === true ? ', REPORT ONLY' : ''}`;
  if (first.engine) out(`\n[${label}] ${code} x${list.length}\n`);
  else out(`\n[${label}] ${code} x${list.length}: ${first.titleVi}\n  ${first.whyVi}\n  -> ${first.nextStepVi}\n`);
  for (const finding of list.slice(0, PER_CODE_LIMIT)) out(`  - ${finding.message}\n`);
  if (list.length > PER_CODE_LIMIT) out(`  ... and ${list.length - PER_CODE_LIMIT} more (use --json for all)\n`);
}

function printCheck(result: Dynamic, out: (text: string) => unknown): void {
  const { counts } = result;
  printCheckOverview(result, out);
  const byCode = new Map<string, Dynamic[]>();
  for (const f of result.findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);
  for (const [code, list] of byCode) printFindingGroup(code, list, out);
  out(`\n${counts.error} error finding${counts.error === 1 ? '' : 's'}${counts.reported ? ` (${counts.reported} of them report only, outside the verdict on branch ${result.branchProfile?.profile})` : ''}${counts.local ? ` (${counts.local} of them local, report only until the restore)` : ''}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}, ${counts.info} report-only\n`);
  const counting = Object.entries((result.counting ?? {}) as Record<string, number>).sort(([a], [b]) => a.localeCompare(b));
  if (counting.length) out(`counting (warn, not in the verdict): ${counting.map(([rule, count]) => `${rule} ${count}`).join(', ')}\n`);
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
  const given = (listFlag(opts, 'gate') ?? []).map((value) => {
    if (value === 'codecov') return 'sonar';
    const family = FAMILIES.find((candidate) => candidate === value);
    if (family === undefined) throw new UsageError(`--gate accepts ${CHECK_GATES.join('|')}; got ${JSON.stringify(value)}`);
    return family;
  });
  return new Set(given.length > 0 ? given : fallback);
}

/** How a verb uses the cache: `normal` reads and writes it, `bypass` neither reads nor writes. */
type CacheUse = 'normal' | 'bypass';

/** Opens the session of a verb over the tracked files of the app: progress on stderr, `--quiet` silent, a terminal rewriting running lines in place. */
function openSession({ repoRoot, tracked, io, full, use, planned }: { repoRoot: string; tracked: string[]; io: AppIo; full?: Set<FamilyId> | undefined; use: CacheUse; planned: number }): DiskSession {
  const progress = io.quiet === true ? silentProgress : createProgress({ write: (text) => io.stderr(text), tty: io.stderrIsTty === true, planned });
  return createDiskSession({ root: repoRoot, tracked, env: io.env, progress, full, bypass: use === 'bypass' });
}

/** The verdicts of the CI comparison (forged, stale, missing) as findings with their why. */
function verdictFindings(session: DiskSession): Dynamic[] {
  const verdicts = session.verdicts();
  if (verdicts.length === 0) return [];
  const why = readWhy(skillRoot, [...new Set(verdicts.map((verdict) => verdict.code))]);
  return withWhy(verdicts.map((verdict) => ({ code: verdict.code, level: verdict.level, path: verdict.path, message: verdict.message })), why);
}

/**
 * The jest preset a new app renders its Sonar exclusions from: the copy this @starci/hfs ships (bundledPresets), the same version the
 * scaffold pins, so `npx starci-harness app scaffold` works before any dependency of the app is installed.
 */
const scaffoldPresets = () => bundledPresets();

/** The value of `--flag <value>` or `--flag=<value>`; a missing value, or one that is a flag, is refused. */
function flagValue(flag: string, arg: string, args: IterableIterator<string>): string {
  const value = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : args.next().value;
  if (!value || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
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
    if (!['full', 'lite'].includes(edition)) throw new UsageError('--edition accepts full or lite');
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
  if (!dispatch) throw new UsageError('starci app db takes new, baseline, restamp, migrate, post-cutover, dump or drift');
  return dispatch(rest, io);
}

function printCheckProofs(result: Dynamic, out: (text: string) => unknown): void {
  if (result.wiring) out(`boot wiring: ${result.wiring.status}, ${result.wiring.apps.length} app(s), ${result.wiring.findings.length} failure(s)\n`);
  if (result.coverage) out(formatCoverageReport(result.coverage));
}

/** The families only a whole run (no selector) and an explicit `--gate` run: the CI commands no other family runs (cache/parity-family.mts). */
const PARITY_FAMILIES: readonly FamilyId[] = ['build', 'audit'];

/** The heavy command port of the CLI (`stackIo.heavy`) for the parity families, else a plain child of this process. */
function parityRunner(io: AppIo): ParityRun {
  const heavy = (io.stackIo as { heavy?: ParityRun } | undefined)?.heavy;
  if (heavy !== undefined) return heavy;
  return async ({ cwd, argv, env }) => {
    const [command = '', ...args] = argv;
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', ...(result.error === undefined ? {} : { error: result.error }) };
  };
}

/** CI's coverage step on the lcov the test family merged from its records: a refusal it reports while the family judged green is a parity break. */
async function coverageParity(repoRoot: string, lcov: string): Promise<Dynamic[]> {
  const { coverageMain } = await import('../coverage/cli.mjs');
  let output = '';
  const report = path.relative(repoRoot, lcov).replaceAll('\\', '/');
  const code = await coverageMain(['verify', report], { cwd: repoRoot, stdout: (text) => { output += text; }, stderr: (text) => { output += text; } });
  if (code === 0) return [];
  const tail = output.trim().split('\n').slice(-3).join(' | ');
  return withWhy([{ code: 'CI_PARITY_STEP_FAILED', level: 'error', engine: 'test', path: report, message: `starci app coverage verify (the coverage job of the managed CI) refused the lcov the test family merged and judged green (exit ${String(code)}): ${tail}` }], readWhy(skillRoot, ['CI_PARITY_STEP_FAILED']));
}

/** The flags `check --staged` refuses: it is the pre-commit guard alone, so none of the whole-app pass's options means anything with it. */
const STAGED_REFUSES = ['--json', '--fix', '--fresh', '--coverage-from', '--shard', '--side', '--out', '--env', ...GATE_FLAGS] as const;

/** The family a finding belongs to, for naming it when a verified run disagrees with the cache. */
function familyOf(finding: { code?: string | null; engine?: string }): FamilyId {
  const code = finding.code ?? '';
  if (finding.engine === 'build' || finding.engine === 'audit' || finding.engine === 'sonar') return finding.engine;
  if (finding.engine === 'eslint' || finding.engine === 'stylelint') return 'lint';
  if (code === 'HFS_FORMAT') return 'format';
  if (/^(DB_|LITE_DB_)/.test(code)) return 'db';
  if (code === 'BE_APP_BOOT_PROOF_MISSING' || code === 'BOOT_PROOF_TIMEOUT') return 'wiring';
  return SECRET_CODE_LIST.has(code) ? 'secrets' : 'hfs';
}

/** What a lint-gate run keeps besides its findings: the raw linter results, which the Sonar document of `--out` is built from. */
interface LinterRaw { eslint: Dynamic[]; stylelint: Dynamic[] }

/** The linters with --fix before the check judges the tree: ESLint through the shared execution, stylelint over the fe stylesheets. What they still find is the check's to report. */
async function fixLint({ repoRoot, side, run }: { repoRoot: string; side: string | undefined; run: LinterRunner | undefined }): Promise<void> {
  const app = readRepoDeclaration(loadSlotManifest(), repoRoot);
  await eslintRepository({ repoRoot, app, opts: { ...(side === undefined ? {} : { side }), fix: true }, run });
  if (side === undefined || side === 'fe') await (run ?? nativeLinter)({ cwd: path.join(repoRoot, 'fe'), pkg: 'stylelint', bin: 'stylelint', args: [STYLE_GLOB, '--formatter', 'json', '--fix'] });
}

/** The linter transport of a step: the seam a spec gives, else the app's own linters through the step's governed node runner. */
const linterOf = (io: AppIo, execute: HeavyNodeRun | undefined): LinterRunner => io.runLinter ?? ((spec) => nativeLinter(spec, execute));

/** The family whose report a step's reused and checked counts are, for the steps table; none for a step that reads the results of others. */
const FAMILY_OF_STEP: Partial<Record<StepId, FamilyId>> = { test: 'test', types: 'types', lint: 'lint', wiring: 'wiring', hfs: 'hfs', format: 'format', db: 'db', audit: 'audit', build: 'build', sonar: 'sonar' };

/** The refusals of a host that held a step's child: the run they end has no verdict, so they end it before any other failure. */
const NO_VERDICT = new Set(['HOST_HELD', 'HEAVY_DEFERRED']);

/**
 * One run of the selected families against the cache, then the coverage proof on top; returns the result, what it took and the raw linter results.
 * The families are the steps of the check graph (cache/schedule.mts): they run one after another in priority order, each once the steps it needs have ended, each heavy
 * child admitted by the CLI's governor when its step starts it, sized on the RAM free then. A red family never stops another; a step that throws ends the run with its error once the others
 * have ended. The session's fingerprint was taken when it opened and its flush runs once, after every step.
 */
async function checkRun({ io, selected: requested, full, use, coverageFrom, side, fix = false, whole = false, env = 'local' }: { io: AppIo; selected: Set<FamilyId>; full: Set<FamilyId> | undefined; use: CacheUse; coverageFrom: string | undefined; side?: string | undefined; fix?: boolean; whole?: boolean; env?: CheckEnv }): Promise<{ result: Dynamic; seconds: number; raw: LinterRaw }> {
  const { cwd: repoRoot, harness, edition, presets, prettier } = io;
  const started = Date.now();
  // The branch profile (branch-profile.mts): a gate it turns off does not run, a gate it reports runs and records but its findings never count.
  const profile = activeProfile(repoRoot, io.env);
  const modes = familyModes(profile);
  const selected = new Set([...requested].filter((family) => modes[family] !== 'off'));
  // New code is never loosened (cache/new-code.mts): where a profile reports lint or sonar, the lines changed since the merge-base with main are judged as main judges them.
  const profiled = profile.profile !== null && (modes.lint === 'report' || modes.sonar === 'report');
  const since = profiled ? newCodeSince(repoRoot) : undefined;
  const branchName = profile.branch ?? profile.profile ?? 'this branch';
  if (fix) await fixLint({ repoRoot, side, run: linterOf(io, io.runHeavyNode) });
  await checkEdition({ repoRoot, edition, normal: () => undefined });
  const tracked = io.checkApp === undefined ? trackedFiles(repoRoot) : [];
  const session = io.checkApp === undefined ? openSession({ repoRoot, tracked, io, full, use, planned: tracked.length * Math.max(1, selected.size) }) : undefined;
  const raw: LinterRaw = { eslint: [], stylelint: [] };
  let eslint: CachedLinters['eslint'] | null = null;
  let style: { results: Dynamic[]; errors: string[] } = { results: [], errors: [] };
  // What each step found, folded in graph order after every step ended, whatever order they ended in.
  const found = new Map<StepId, Dynamic[]>();
  const said = new Map<StepId, string[]>();
  const ratchetErrors: string[] = [];
  const parts: AppPassParts = {};
  let seamResult: Dynamic;
  let tests: Awaited<ReturnType<typeof runTestForApp>> | undefined;
  const bodies = new Map<StepId, StepBody>();
  const appInput = (session_: DiskSession, execute: HeavyNodeRun | undefined): AppRunInput => ({ repoRoot, tracked, session: session_, selected, harness, presets, prettier, edition: undefined, execute });
  if (io.checkApp !== undefined) {
    const seam = io.checkApp;
    bodies.set('hfs', async () => { seamResult = await seam({ repoRoot, harness, presets, prettier, io, selected, full, use, session: undefined }); });
  } else if (session !== undefined) {
    if (selected.has('hfs') || selected.has('secrets')) bodies.set('hfs', (step) => runStructureStep(appInput(session, step.execute), parts));
    if (selected.has('format')) bodies.set('format', (step) => runFormatStep(appInput(session, step.execute), parts));
    if (selected.has('db')) bodies.set('db', (step) => runDbStep(appInput(session, step.execute), parts));
    if (selected.has('wiring')) bodies.set('wiring', (step) => runWiringStep(appInput(session, step.execute), parts));
  }
  let proved: Dynamic;
  /** The app pass merged with the coverage proof on top, once its steps have ended. */
  const proof = (): Dynamic => {
    proved ??= withCheckProofs(seamResult ?? mergeAppPass({ repoRoot, tracked, edition: undefined }, parts, session?.reports ?? []), { repoRoot, edition, wiring: false, coverageFrom });
    return proved;
  };
  if (selected.has('lint')) {
    bodies.set('lint', async (step) => {
      const run = linterOf(io, step.execute);
      if (session !== undefined) {
        const app = readRepoDeclaration(loadSlotManifest(), repoRoot);
        // An ESLint child takes the eslint cap of ops/liveness.yaml, which the CLI hands over as the child's heap: a side runs as many chunks at once as the
        // room at the lint step's start holds of them and the lanes have free (the step runs alone, so every lane is free).
        const cap = Number(io.env[ESLINT_HEAP_ENV]);
        const parallel = (chunks: number): number => Math.min(chunks, Math.max(1, step.lanes.free()), io.heavyRoom === undefined || !(cap > 0) ? 1 : Math.max(1, Math.floor(io.heavyRoom() / cap)));
        const linted = await cachedLinters({ repoRoot, app, side, run, session, parallel });
        eslint = linted.eslint;
        style = linted.stylelint;
      } else eslint = await eslintRepository({ repoRoot, opts: side === undefined ? {} : { side }, changed: null, existing: [], run });
      raw.eslint = eslint.raw;
      raw.stylelint = style.results;
    });
  }
  if (session !== undefined && selected.has('types')) bodies.set('types', async (step) => {
    // The programs run together as far as the room at this step's start holds the tsc cap and the lanes are free (the step runs alone, so it sizes itself on the whole room).
    const cap = Number(io.env[TSC_HEAP_ENV]);
    const concurrency = (programs: number): number => Math.min(programs, Math.max(1, step.lanes.free()), io.heavyRoom === undefined || !(cap > 0) ? programs : Math.max(1, Math.floor(io.heavyRoom() / cap)));
    found.set('types', (await runTypesForApp(session, { repoRoot, tracked, env: io.env, execute: step.execute, concurrency })).findings);
  });
  if (session !== undefined && selected.has('test')) {
    bodies.set('test', async (step) => {
      tests = await runTestForApp(session, { repoRoot, tracked, execute: step.execute });
      found.set('test', tests.findings);
    });
    // A whole run also runs CI's own coverage step on the merged lcov (`app coverage verify`): the local merge proof.
    if (whole) bodies.set('coverage', async () => { if (tests?.result?.lcov !== undefined && tests.findings.length === 0) found.set('coverage', await coverageParity(repoRoot, tests.result.lcov)); });
  }
  for (const family of ['audit', 'build'] as const) {
    if (session === undefined || !selected.has(family)) continue;
    bodies.set(family, async (step) => {
      const parity = await runParityFamilies(session, { repoRoot, families: new Set([family]), env: io.env, run: step.parity });
      found.set(family, withWhy(parity.findings, readWhy(skillRoot, parity.findings.length > 0 ? ['CI_PARITY_STEP_FAILED'] : [])));
    });
  }
  if (session !== undefined && selected.has('sonar')) {
    bodies.set('sonar', async () => {
      const quality = runSonarForApp(session, { repoRoot, ...(since === undefined ? {} : { since }) });
      said.set('sonar', [...(quality?.lines ?? [])]);
      if (quality !== null && profile.profile !== null && modes.sonar === 'report') found.set('sonar', withWhy(newCodeCoverageFindings(quality.predictions, branchName) as Dynamic[], readWhy(skillRoot, [COVERAGE_NEW_CODE])));
    });
  }
  /** What the steps before the scan found, in graph order: what the Sonar scan uploads and what holds it back. */
  const scanned = (): Dynamic[] => [...proof().findings, ...SCAN_INPUTS.flatMap((id) => found.get(id) ?? [])];
  // A whole run also runs the app's CI sonar job against the server (cache/sonar-scan-family.mts), when everything before it is green, as CI's sonar job needs lint and coverage.
  // Whenever it does not run, the run says why in one line.
  if (!whole) said.set('sonar-scan', ['  sonar scan: not run, only a run with no selector, flag or --gate (a whole run) runs it']);
  else if (session === undefined) said.set('sonar-scan', ['  sonar scan: not run, this run keeps no check cache session']);
  else if (profile.modes.sonar === 'off') said.set('sonar-scan', [`  sonar scan: not run, the branch profile ${profile.profile ?? profile.branch ?? 'in force'} turns the sonar gate off`]);
  else {
    bodies.set('sonar-scan', async (step) => {
      // A finding of a family the profile reports (old lint debt on dev) never makes the run red: the scan runs and reports; new-code findings still do.
      const blocks = (finding: { level?: string; code?: string | null; engine?: string }): boolean => finding.level === 'error' && modes[familyOf(finding)] !== 'report';
      const red = scanned().some((finding) => blocks(finding)) || (eslint?.findings ?? []).some((finding) => finding.severity !== 'warning' && (modes.lint !== 'report' || onChangedLine({ ...finding, level: 'error' }, since?.changed))) || (eslint?.errors.length ?? 0) > 0 || style.errors.length > 0 || stylelintFindings(style.results, repoRoot).some((finding) => finding.level === 'error' && modes.lint !== 'report');
      if (red) { said.set('sonar-scan', ['  sonar scan: not run, other families are red (CI runs the sonar job after lint and coverage are green)']); return; }
      const progress = session.progress.step('sonar', 'Sonar scan against the server', 1);
      const scan = await runSonarScan({ repoRoot, env: io.env, io: { cwd: repoRoot, stdout: io.stdout, stderr: io.stderr, env: io.env, sops: io.sops, hostIdentity: io.hostIdentity, stackIo: io.stackIo }, run: step.parity, index: session.index, fresh: full?.has('sonar') === true,
        writeLintReport: () => writeSonarImport({ repoRoot, file: path.join(repoRoot, LINT_REPORT), findings: scanned(), raw, side: undefined }) });
      progress.tick(1, 0, 1);
      progress.end();
      said.set('sonar-scan', [...scan.lines]);
      found.set('sonar-scan', withWhy(scan.findings, readWhy(skillRoot, [...new Set(scan.findings.map((finding) => finding.code))])));
    });
  }
  // The lint ratchet of a branch whose profile reports lint: the commits since the base never add lint findings to a file they touch (blocking).
  if (selected.has('lint') && modes.lint === 'report' && profile.profile !== null) {
    bodies.set('ratchet', async (step) => {
      const { base, source: baseSource } = ratchetBase(repoRoot, io.env, profile.branch);
      // The committed cache at the base and this run's lint records settle every touched file whose findings rose by no rule (warm-cache-push trusts
      // them as every family does); only the rest is linted, in bounded chunks.
      const ratchet = await ratchetFindings({ repoRoot, touched: rangeTouched(repoRoot, base), side, branch: branchName, run: linterOf(io, step.execute),
        base: committedLintCounts(repoRoot, base), now: session === undefined ? undefined : sessionLintCounts((folder) => session.records(folder)) });
      said.set('ratchet', [`  lint ratchet: ${String(ratchet.compared)} touched file(s) against ${baseSource}; ${String(ratchet.fromCache)} settled by the lint records, ${String(ratchet.linted)} linted`]);
      found.set('ratchet', withWhy(ratchet.findings, readWhy(skillRoot, ratchet.findings.length > 0 ? ['LINT_RATCHET_RAISED'] : [])));
      ratchetErrors.push(...ratchet.errors);
    });
  }
  const runs = await runGraph({ bodies, execute: io.runHeavyNode, parity: parityRunner(io), lanes: createLanes(availableParallelism() - 1) });
  // A step that threw (a child the host held, a refused or incomplete execution, a crash) reached no measurement: once every other step has ended, the run
  // ends with the error of the first that threw (a hold of the host before any other), as a run of that step alone would.
  const failed = runs.filter((run) => run.status === 'failed').sort((a, b) => a.order - b.order);
  const ending = failed.find((run) => NO_VERDICT.has(String((run.error as { code?: unknown } | undefined)?.code))) ?? failed[0];
  if (ending !== undefined) throw ending.error;
  const linted = eslint as CachedLinters['eslint'] | null;
  const extra: Dynamic[] = CHECK_GRAPH.flatMap((spec) => found.get(spec.id) ?? []);
  const lines: string[] = ['sonar', 'sonar-scan', 'ratchet'].flatMap((id) => said.get(id as StepId) ?? []);
  // An app keeps main and dev (PROJECT-BRANCH-1): a whole run warns when it has no dev branch.
  const noDev = whole && session !== undefined ? devBranchFinding(repoRoot) : null;
  if (noDev !== null) extra.push(...withWhy([noDev] as Dynamic[], readWhy(skillRoot, [noDev.code])));
  const flushed = session?.flush();
  const verdicts = session === undefined ? [] : verdictFindings(session);
  // The cache verdict of a whole run: the committed cache is what this run on the tree writes, or the run is red (a push would carry stale records).
  if (whole && session !== undefined && flushed !== undefined) {
    const refusals = freshnessFindings({ root: repoRoot, portable: session.fingerprint.portable, localReasons: session.fingerprint.localReasons, localRegistry: session.fingerprint.localRegistry, written: flushed.written, removed: flushed.removed });
    verdicts.push(...withWhy(refusals.map((refusal) => ({ code: refusal.code, level: refusal.level, path: refusal.path, message: refusal.message, ...(refusal.local === true ? { local: true } : {}) })), readWhy(skillRoot, refusals.map((refusal) => refusal.code))));
  }
  const checked = proof();
  // The families report as their steps end; they are listed in family order.
  const reports: FamilyReport[] = session === undefined ? [...(checked.families ?? [])] : [...session.reports].sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family));
  const countsOf = (id: StepId): { reused: number; checked: number } | undefined => {
    const families = id === 'hfs' ? ['hfs', 'secrets'] : FAMILY_OF_STEP[id] === undefined ? [] : [FAMILY_OF_STEP[id]];
    const mine = reports.filter((report) => families.includes(report.family));
    return mine.length === 0 ? undefined : { reused: mine.reduce((sum, report) => sum + report.reused, 0), checked: mine.reduce((sum, report) => sum + report.checked, 0) };
  };
  const steps = runs.map((run) => stepRow(run, countsOf(run.id)));
  // A rule of the canon's counting cohort is a warning: listed and counted, never part of the verdict.
  const lintedFindings = [...(linted?.findings ?? []).map(finding => ({ ...finding, code: finding.code ?? finding.rule, level: finding.severity === 'warning' ? 'warning' : 'error' })), ...stylelintFindings(style.results, repoRoot)];
  // Where lint reports, a finding on a line this branch changed is new code: it becomes a blocking LINT_NEW_CODE_FINDING in place of its report-only listing.
  const newCode = since !== undefined && modes.lint === 'report' ? lintedFindings.filter((finding) => onChangedLine(finding, since.changed)) : [];
  const linterFindings = newCode.length === 0 ? lintedFindings : lintedFindings.filter((finding) => !newCode.includes(finding));
  if (newCode.length > 0) extra.push(...withWhy(newCode.map((finding) => newCodeLintFinding(finding as typeof finding & { path: string }, branchName)) as Dynamic[], readWhy(skillRoot, [LINT_NEW_CODE])));
  // A finding of a family the profile reports is marked `report`: listed and recorded, never part of the verdict.
  const branchJudged = [...checked.findings, ...extra, ...verdicts, ...linterFindings].map((finding) => (modes[familyOf(finding)] === 'report' ? { ...finding, report: true } : finding));
  // `--env local` lists the findings only a local-registry loop causes as report-only (check-env.mts); `--env prod` judges them as every other finding.
  const localCodes = localOnlyCodes();
  const findings = judgedForEnv(branchJudged, env, localCodes);
  const localListed = env === 'local' ? localReported(findings, localCodes) : [];
  // Green only with no error finding outside a report profile (gate-verdict.mts); every finding is still listed.
  const judged = gateVerdict(findings.filter(finding => finding.level === 'error' && finding.report !== true));
  const verdict = judged.pass ? { ...judged, line: localVerdictLine(localListed) } : judged;
  const toolErrors = [...(linted?.errors ?? []), ...style.errors, ...ratchetErrors];
  const counts = { ...checked.counts, error: findings.filter(finding => finding.level === 'error').length, warning: findings.filter(finding => finding.level === 'warning').length };
  const reported = findings.filter(finding => finding.report === true && finding.level === 'error' && !localListed.includes(finding)).length;
  if (reported > 0) Object.assign(counts, { reported });
  if (localListed.length > 0) Object.assign(counts, { local: localListed.length });
  const counting: Record<string, number> = {};
  for (const finding of linterFindings) if (finding.level === 'warning') counting[finding.rule] = (counting[finding.rule] ?? 0) + 1;
  const branchProfile = { branch: profile.branch, source: profile.source, profile: profile.profile, modes: profile.modes, notices: profileNotices(profile).filter((notice) => [...requested].some((family) => notice.startsWith(`${family}:`) || (family === 'sonar' && notice.startsWith('codecov:')))) };
  const result = { ...checked, findings, families: reports, steps, predictions: lines, counting, branchProfile, cacheWarnings: [...(checked.cacheWarnings ?? []), ...(flushed?.warnings ?? [])], counts, ...(linted ? { eslint: { ...linted.engine, errors: toolErrors } } : {}), ok: verdict.pass && toolErrors.length === 0, gate: verdict };
  return { result, seconds: (Date.now() - started) / 1000, raw };
}

/** The steps whose findings the Sonar scan uploads with the app pass and that hold it back when red: every step before it but the lint ratchet. */
const SCAN_INPUTS: readonly StepId[] = CHECK_GRAPH.filter((spec) => spec.id !== 'sonar-scan' && spec.id !== 'ratchet').map((spec) => spec.id);

/** `--out`: every finding the run produced as ONE Sonar Generic Issue Import document (the check findings under starci-hfs, then eslint and stylelint), placed on the `sonar.sources` roots of the side. */
function writeSonarImport({ repoRoot, file, findings, raw, side }: { repoRoot: string; file: string; findings: readonly Dynamic[]; raw: LinterRaw; side: string | undefined }): void {
  let properties = '';
  try { properties = fs.readFileSync(path.join(repoRoot, 'sonar-project.properties'), 'utf8'); } catch { /* no properties: every finding keeps its own path */ }
  const onSide = (candidate: string): boolean => {
    if (side === undefined) return true;
    const owner = [...SIDES, PACKAGES].find((each: string) => candidate === each || candidate.startsWith(`${each}/`));
    return (owner ?? 'be') === side;
  };
  const sourceRoots = sourceRootsOf(properties).filter(onSide);
  const tracked = sourceRoots.length ? trackedFiles(repoRoot) : [];
  const own = findings.filter(finding => finding.engine === undefined && finding.level === 'error' && onSide(String(finding.path ?? '').replace(/\\/g, '/')));
  writeReport(file, mergeReports([
    sonarReport(own, { sourceRoots, tracked }),
    linterReport('eslint', raw.eslint, { root: repoRoot, sourceRoots, tracked }),
    linterReport('stylelint', raw.stylelint, { root: repoRoot, sourceRoots, tracked }),
  ]));
}

/** `--profile`: the branch profile this run is under; with one --gate only that gate's mode (blocking, report or off), the word the managed pre-commit hook reads. */
function printProfile(opts: Opts, io: AppIo): number {
  const profile = activeProfile(io.cwd, io.env);
  const named = (listFlag(opts, 'gate') ?? []).map((gate) => {
    const known = PROFILE_GATES.find((candidate) => candidate === gate);
    if (known === undefined) throw new UsageError(`--gate accepts ${PROFILE_GATES.join('|')}; got ${JSON.stringify(gate)}`);
    return known;
  });
  if (named.length > 1) throw new UsageError('--profile takes at most one --gate');
  const [one] = named;
  if (opts.json === true) io.stdout(`${JSON.stringify(one === undefined ? profile : { gate: one, mode: profile.modes[one], branch: profile.branch, profile: profile.profile }, null, 2)}\n`);
  else if (one !== undefined) io.stdout(`${profile.modes[one]}\n`);
  else {
    io.stdout(`branch ${profile.branch ?? '(none)'} (${profile.source}): ${profile.profile === null ? 'no branch profile, the full gate' : profileLabel(profile)}\n`);
    for (const gate of PROFILE_GATES) io.stdout(`  ${gate} ${profile.modes[gate]}\n`);
  }
  return 0;
}

/** `--ratchet`: the lint ratchet of the managed pre-commit hook over the staged files against HEAD, on a branch whose profile reports lint (lint/ratchet.mjs). */
async function stagedRatchet(io: AppIo): Promise<number> {
  const profile: ActiveProfile = activeProfile(io.cwd, io.env);
  if (profile.profile === null || profile.modes.lint !== 'report') {
    io.stdout(`lint is ${profile.modes.lint} on ${profile.branch === null ? 'this checkout' : `branch ${profile.branch}`}: the lint ratchet applies only where a branch profile reports lint\n`);
    return 0;
  }
  const ratchet = await ratchetFindings({ repoRoot: io.cwd, touched: stagedTouched(io.cwd), branch: profile.branch ?? profile.profile, run: linterOf(io, io.runHeavyNode) });
  for (const error of ratchet.errors) io.stdout(`lint ratchet tool error: ${error}\n`);
  for (const finding of ratchet.findings) io.stdout(`[ERROR] LINT_RATCHET_RAISED ${finding.message}\n`);
  io.stdout(`lint ratchet on branch ${profile.branch ?? profile.profile} (${profileLabel(profile)}): ${String(ratchet.compared)} staged file(s) compared with HEAD, ${String(ratchet.findings.length)} raised\n`);
  return ratchet.errors.length > 0 ? 2 : ratchet.findings.length > 0 ? 1 : 0;
}

async function checkMain(opts: Opts, io: AppIo): Promise<number> {
  const { cwd: repoRoot, edition, stdout: out } = io;
  if (opts.positional.length) throw new UsageError('starci app check takes no path');
  if (opts.staged === true) {
    const given = [...STAGED_REFUSES.filter((flag) => opts[flag.slice(2)] !== undefined), ...(edition === undefined ? [] : ['--edition'])];
    if (given.length) throw new UsageError(`starci app check --staged is the pre-commit guard alone and takes no ${given.join(', ')}`);
    return runWorkHygiene({ cwd: repoRoot, out: (text) => out(`${text}\n`) });
  }
  if (opts.profile === true || opts.ratchet === true) {
    const other = Object.keys(opts).filter((key) => key !== 'positional' && key !== 'profile' && key !== 'ratchet' && !(opts.profile === true && (key === 'gate' || key === 'json')));
    if (opts.profile === true && opts.ratchet === true) throw new UsageError('--profile and --ratchet are two verbs of their own; give one');
    if (other.length > 0 || edition !== undefined) throw new UsageError(`starci app check --${opts.profile === true ? 'profile takes only --gate <gate> and --json' : 'ratchet (the pre-commit lint ratchet) takes no other flag'}; got ${[...other.map((key) => `--${key}`), ...(edition === undefined ? [] : ['--edition'])].join(', ')}`);
    return opts.profile === true ? printProfile(opts, io) : stagedRatchet(io);
  }
  const coverageFrom = valueFlag(opts, 'coverage-from');
  const shard = valueFlag(opts, 'shard');
  const side = valueFlag(opts, 'side');
  const sonarOut = valueFlag(opts, 'out');
  const fix = booleanFlag(opts, 'fix') === true;
  const fresh = booleanFlag(opts, 'fresh') === true;
  const env = checkEnvOf(valueFlag(opts, 'env'));
  if (env === undefined) throw new UsageError(`--env accepts ${CHECK_ENVS.join('|')}; got ${JSON.stringify(valueFlag(opts, 'env'))}`);
  const explicit = selectedFamilies(opts, []);
  if (side !== undefined && !['be', 'fe', PACKAGES].includes(side)) throw new UsageError('LINT_SIDE_INVALID: --side is be, fe or packages');
  if (fix && !explicit.has('lint')) throw new UsageError('--fix runs the linters and needs --gate lint');
  if (shard !== undefined) {
    if (side !== undefined || sonarOut !== undefined) throw new UsageError('--shard <i>/<n> takes no --side or --out');
    // A selected test shard is always a whole-unit shard, in the shape the coverage merge reads; nothing is recorded.
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    if (explicit.size !== 1 || !explicit.has('test') || coverageFrom !== undefined) throw new UsageError('--shard <i>/<n> requires --gate test alone and takes no --coverage-from');
    const index = Number(match?.[1]);
    const total = Number(match?.[2]);
    if (match === null || !Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 1 || total < index) throw new UsageError('--shard needs <i>/<n> with 1 <= i <= n');
    return runTestShard(repoRoot, index, total, io.runHeavyNode);
  }
  // A coverage report judged on its own (the merge job of a sharded run) runs no family; with selectors it comes on top of them.
  // A run with no selector is whole: every default family and the CI-parity families (so a green run is not followed by a red CI build or audit), CI's coverage step and the cache verdict.
  const whole = explicit.size === 0 && side === undefined && coverageFrom === undefined && !fix;
  const selected = explicit.size > 0 ? explicit : coverageFrom === undefined ? new Set<FamilyId>(whole ? [...DEFAULT_FAMILIES, ...PARITY_FAMILIES] : DEFAULT_FAMILIES) : new Set<FamilyId>();
  // --fresh: the selected families ignore their records and are recomputed from scratch (and written back).
  const full = fresh ? new Set(selected) : undefined;
  const { result, seconds, raw } = await checkRun({ io, selected, full, use: coverageFrom !== undefined && explicit.size === 0 ? 'bypass' : 'normal', coverageFrom, side, fix, whole, env });
  if (sonarOut !== undefined) writeSonarImport({ repoRoot, file: path.resolve(repoRoot, sonarOut), findings: result.findings, raw, side });
  if (opts.json) out(`${JSON.stringify(result, null, 2)}\n`);
  else { printCheck(result, out); printCheckProofs(result, out); if (result.gate.line) out(`${result.gate.line}\n`); }
  const exit = result.eslint?.errors.length ? 2 : result.ok ? 0 : 1;
  writeRunLog(repoRoot, { command: `check${[...new Set(listFlag(opts, 'gate') ?? [])].map((gate) => ` --gate ${gate}`).join('')}${side === undefined ? '' : ` --side ${side}`}${fix ? ' --fix' : ''}${fresh ? ' --fresh' : ''}${coverageFrom === undefined ? '' : ` --coverage-from ${JSON.stringify(coverageFrom)}`}`, seconds, exit, families: (result.families as FamilyReport[]).map((report) => ({ ...report, seconds: (result.steps as Dynamic[] | undefined)?.find((row) => row.step === report.family || (row.step === 'hfs' && report.family === 'secrets'))?.seconds ?? 0 })) }, io.env);
  return exit;
}

async function emitMain(opts: Opts, { cwd: repoRoot, stdout: out, runHeavyNode }: AppIo): Promise<number> {
  if (opts.positional.length) throw new UsageError('starci app emit takes no path');
  const be = readRepoDeclaration(loadSlotManifest(), repoRoot).sides?.be;
  if (!be) throw new Error('starci app emit runs at the app root (the folder of hfs.json)');
  const { written, skipped, standIns } = await emitContractsAsync({ repoRoot: path.join(repoRoot, 'be'), declaration: be, execute: runHeavyNode });
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
const ADD_FILE_NOUNS = ['service', 'spec', 'image', 'inbox'];

/** `add service <dir> <name> [--inject ...]`, `add spec <file>.service.ts`, `add image` and `add inbox`: never overwrites; an option another noun takes is refused. */
function addFileNoun(noun: string, opts: Opts, repoRoot: string, out: (text: string) => unknown): number {
  const [, ...args] = opts.positional;
  const [first = '', second = ''] = args;
  const foreign = ADD_FLAGS_ALL.filter((flag) => opts[flag.slice(2)] !== undefined);
  if (foreign.length) throw new UsageError(`starci app add ${noun} takes no ${foreign.join(', ')}`);
  if (noun !== 'service' && opts.inject !== undefined) throw new UsageError(`starci app add ${noun} takes no --inject; only add service does`);
  let written: string[];
  if (noun === 'service' && args.length === 2) written = newService({ repoRoot, dir: first, name: second, inject: listFlag(opts, 'inject') ?? [] });
  else if (noun === 'spec' && args.length === 1) written = newSpec({ repoRoot, file: first });
  else if (noun === 'image' && args.length === 0) written = newImages({ repoRoot });
  else if (noun === 'inbox' && args.length === 0) written = addKind({ repoRoot, noun, name: '' }).created;
  else throw new UsageError('starci app add takes `service <dir> <name> [--inject ...]`, `spec <file>.service.ts`, `image` or `inbox`');
  for (const file of written) out(`created ${file}\n`);
  return 0;
}

function addMain(opts: Opts, { cwd: repoRoot, stdout: out }: AppIo): number {
  const [noun, name, ...extra] = opts.positional;
  if (noun !== undefined && ADD_FILE_NOUNS.includes(noun)) return addFileNoun(noun, opts, repoRoot, out);
  if (opts.inject !== undefined) throw new UsageError(`starci app add ${noun ?? '<noun>'} takes no --inject; only add service does`);
  if (!noun || !name || extra.length) throw new UsageError('starci app add takes `<noun> <name>` and the options of the noun');
  const { created, registered, updated, notes } = addKind({ repoRoot, noun, name, options: { event: opts.event, from: opts.from, service: opts.service, connection: opts.connection, owner: opts.owner, failed: opts.failed, done: opts.done, fe: booleanFlag(opts, 'fe'), shapes: valueFlag(opts, 'shapes'), read: valueFlag(opts, 'read'), app: valueFlag(opts, 'app'), kind: valueFlag(opts, 'kind'), form: booleanFlag(opts, 'form'), blocks: valueFlag(opts, 'blocks'), tabs: valueFlag(opts, 'tabs'), isolation: valueFlag(opts, 'isolation'), envPrefix: valueFlag(opts, 'env-prefix') } });
  for (const file of created) out(`created ${file}\n`);
  for (const file of updated ?? []) out(`updated ${file}\n`);
  for (const note of notes ?? []) out(`owner step: ${note}\n`);
  const kinds = registered.kinds.length ? `; kinds ${registered.kinds.join(', ')}` : '';
  // A noun that registers nothing in hfs.json (a table, an app, a front-end unit) ends with what it wrote.
  if (registered.patterns.length || registered.kinds.length) out(`starci app add ${noun}: registered patterns ${registered.patterns.join(', ')}${kinds}\n`);
  return 0;
}

/** `remove module <name>`: deletes the module package and its registrations and re-renders the registry. */
function removeMain(opts: Opts, { cwd: repoRoot, stdout: out }: AppIo): number {
  const [noun, name, ...extra] = opts.positional;
  if (noun !== 'module' || !name || extra.length) throw new UsageError('starci app remove takes `module <name>`');
  const { removed, updated, created } = removeModule({ root: repoRoot, name });
  for (const file of removed) out(`removed ${file}
`);
  for (const file of [...updated, ...created]) out(`updated ${file}
`);
  return 0;
}

async function scaffoldMain(opts: Opts, { cwd, harness, edition = 'full', presets, lock, stdout: out }: AppIo): Promise<number> {
  const [name, ...extra] = opts.positional;
  const registryVisibility = valueFlag(opts, 'registry-visibility');
  if (!name || extra.length) throw new UsageError(`starci app scaffold takes \`${((VERB_USAGE.scaffold as string[])[0] as string).slice('starci app scaffold '.length)}\``);
  const { root: created, files } = scaffoldApp({ name, into: path.resolve(cwd), harness, edition, presets: presets ?? scaffoldPresets(), ...(registryVisibility === undefined ? {} : { registryVisibility }), ...(lock ? { lock } : {}) });
  out(`starci app scaffold: created ${created} (${files.length} files); next: npm ci (the lockfile, then the git hooks through npm run prepare; after npm ci --ignore-scripts run npm run prepare), then npm run lint, which is starci app check --gate lint\n`);
  return 0;
}

function slotMain(opts: Opts, { cwd: repoRoot, stdout: out }: AppIo): number {
  if (opts.positional.length !== 1) throw new UsageError('starci app slot takes exactly one path');
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
  if (!WORLD_ACTIONS.includes(argv[0] as string)) throw new UsageError(`starci app world takes ${WORLD_ACTIONS.join(', ')}`);
  if ((edition ?? declaredEdition(cwd)) === 'lite') throw new Error('starci app world up|down|status manage the local test world of the full edition; a lite app starts its local database with npm run db:start');
  const run = stackMain ?? await installedStackMain(cwd);
  return run(argv, { cwd, out, err }) as Promise<number>;
}

const DIRECT_VERBS = new Map<string, (argv: string[], io: AppIo) => Promise<number> | number>([['ci', async (argv: string[], io: AppIo) => (await import('../ci/cli.mjs')).ciMain(argv, io)], ['secret', secretMain], ['db', databaseMain], ['upgrade', upgradeAppMain], ['stack', stackAppMain], ['world', worldAppMain], ['release', releaseMain], ['coverage', async (argv: string[], io: AppIo) => (await import('../coverage/cli.mjs')).coverageMain(argv, io)], ['codemod', codemodMain]]);

function dispatchMain(verb: string, argv: string[], io: AppIo): Promise<number> | number {
  if (verb === 'sync') return syncMain([verb, ...argv], io);
  const direct = DIRECT_VERBS.get(verb);
  if (direct) return direct(argv, io);
  return (PARSED[verb] as ParsedVerb).run(parse(verb, argv), io);
}

/** The line `main` prints once the state an installed copy kept inside itself moved to the state base. */
function adoptionNotice({ from, to, kept }: StateAdoption): string {
  const aside = kept.length ? ` (${kept.join(', ')} already there; the older copy is kept under legacy-*)` : '';
  return `starci app: moved the state this installed copy kept in ${from} to ${to}${aside}\n`;
}

/** What `main` prints for a thrown error: the usage only after a usage error; a refusal or a tool failure prints its code and message alone. */
function errorMessage(error: unknown): string {
  if (error instanceof EditionRefusal || error instanceof UpgradeError || error instanceof HfsSlotsError || error instanceof SyncError) return `${(error as Error).message}\n`;
  if (error instanceof ScaffoldError || error instanceof LegacyStateHeld) return `${(error as { code: string }).code}: ${(error as Error).message}\n`;
  if (error instanceof UsageError) return `starci app: ${error.message}\n${USAGE}`;
  return `starci app: ${(error as Error).message}\n`;
}

/**
 * `harness` ({ version }) is the CLI that runs this package in-process: its version is the starci-harness an app is judged and
 * scaffolded at (runtime/scripts/hfs/canon-pins.mjs). `run` injects the database runner, `runLinter` the linter transport, `checkApp`
 * the HFS check and `stackIo` Swarm tools; production defaults execute every check. `hostIdentity` ({ label, read }) is the
 * harness CLI's own secret.env SOPS_AGE_KEY, which every verb that opens a sealed member (secret, stack, release, db) reads last for the age identity (decryptionIdentity); `prompt` replaces its masked prompt.
 */
export async function main(argv: string[], {
  cwd: baseCwd = process.cwd(), harness, stdout = (s: string): unknown => process.stdout.write(s), stderr = (s: string): unknown => process.stderr.write(s), presets, prettier, lock, run, stackMain,
  env = process.env, stdin, prompt, hostIdentity, sops, tools, platform, stackIo, runLinter, runHeavyNode, heavyRoom, checkApp, stderrIsTty = process.stderr.isTTY === true, stateRoot = skillRoot,
}: MainOptions = {}): Promise<number> {
  try {
    const global = globalOptions(argv, path.resolve(baseCwd));
    const [verb, ...given] = global.argv;
    // --quiet silences stdout for every verb but check, whose diagnosis it keeps (its progress on stderr is what it mutes).
    const out = global.quiet && verb !== 'check' ? () => {} : stdout;
    if (global.help) { out(USAGE); return 0; }
    if (!VERBS.includes(verb as string)) { stderr(USAGE); return 2; }
    const { edition, argv: rest } = editionOption(verb as string, given);
    const adopted = adoptLegacyState(env, stateRoot);
    if (adopted) stderr(adoptionNotice(adopted));
    return await dispatchMain(verb as string, rest, { cwd: global.cwd, harness, edition, quiet: global.quiet, stderrIsTty, stdout: out, stderr, presets, prettier, lock, run, stackMain, env, stdin, prompt, hostIdentity, sops, tools, platform, stackIo, runHeavyNode, heavyRoom, runLinter, checkApp });
  } catch (error) {
    stderr(errorMessage(error));
    if (isHostHeld(error)) return 75;
    return 2;
  }
}

// Run when this file is the entry point, compared by real path. The package itself has no bin; this is useful for local diagnostics.
if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
