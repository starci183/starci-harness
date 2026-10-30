// migrate.mjs - `starci app db migrate`: puts a self-hosted database's migration history in the state the app's repository declares,
// idempotently. The database is the connection URL in the environment variable `--db-url-env` names (default DATABASE_URL); psql
// applies each migration and records it in the history table in ONE transaction (db/postgres.mjs).
// The optional `database:` block of .starcistacks/application-stacks.yaml names the baseline migration, the optional second baseline (standard),
// the held-back migrations (applied later by `db post-cutover`), the restamp pairs and the archive directory. The plan, from the history:
//   repair    revert each restamped old version still recorded and mark its new version applied
//   baseline  revert the archived rows, mark the baseline applied (it is NOT run) when the history predates it
//   forward   apply every other migration in stamp order, EXCEPT the held-back ones
// With no `database:` block every active migration is forward. When the history already is baseline + forward it prints
// `nothing to do` and makes no mutating call.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { byCodeUnit } from '../runtime/engine/by-code-unit.mjs';
import { BOOTSTRAP_FILE, MIGRATIONS_DIR } from '../runtime/scripts/hfs/rules/database-constants.mjs';

export { BOOTSTRAP_FILE };
import { StackError, approvalMissing, failure, refusal } from '../stack/errors.mjs';
import { readDeclaration, runVerb } from '../release/index.mjs';
import { DbVerbError } from '../runtime/scripts/hfs/db-errors.mjs';
import { planInventory, summaryDrifts, summaryLine } from '../runtime/scripts/hfs/db-plan-verb.mjs';
import type { Kind, PlanInventory, Summary } from '../runtime/scripts/hfs/db-plan-verb.mjs';
import { DEFAULT_DB_URL_ENV, HISTORY_DDL, dbTarget, historyVersions, markApplied, markReverted, psqlTransaction, queryRows } from './postgres.mjs';
import type { DbTarget } from './postgres.mjs';
import type { FlagSpec, VerbContext, VerbIo, VerbResult } from '../release/index.mjs';

const DATABASE_CODE = 'DB_CONFIG_INVALID';

/** The function families `db post-cutover` checks (database.postCutover). */
export interface PostCutover { schema?: string; functionPrefixes?: string[]; functionNames?: string[]; functions?: string[]; minAgeHours?: number }
/** A restamped migration: the old stamp and the new one. */
export interface RestampPair { from: string; to: string }
/** The normalised `database:` block of .starcistacks/application-stacks.yaml. */
export interface DatabaseDecl {
  migrationsDir: string; archiveDir: string | null; baseline: string | null; standard: string | null;
  heldBack: string[]; restamp: RestampPair[]; postCutover: PostCutover | null;
  /** Where the database runs: `stack` is a service of the environment's own stack (the deploy reaches it inside its container), `external` is outside it (the deploy keeps `--db-url-env`). */
  target: DatabaseTarget;
  /** The stack service of a `stack` database. */
  service: string;
}
/** Where the database of an app runs (see DatabaseDecl.target). */
export type DatabaseTarget = 'stack' | 'external';
/** Which migrations a pass applies: all of them, the expand ones a deploy applies before the services update, or the contract ones it applies after accept. */
export type MigrationPhase = 'all' | 'expand' | 'contract';
/** An archived migration: its file name under the restamped version, and that version. */
interface ArchiveRow { name: string; version: string }
/** The migration files of the app classified: baseline pair, held-back, forward, restamp pairs and archive. */
export interface MigrationModel {
  root: string; decl: DatabaseDecl; files: string[]; baselineFile: string | undefined; standardFile: string | undefined;
  baseline: string | null; standard: string | null; held: string[]; push: string[]; heldVersions: string[]; pushPending: string[];
  archive: ArchiveRow[]; pushVersions: Set<string>; allowed: Set<string>;
}
/** What a database verb works with: the context, the model and the target (and, for post-cutover, the declaration). */
export interface MigrationSession { ctx: VerbContext; model: MigrationModel; target: DbTarget; decl?: DatabaseDecl }
/** What the plan decides, from the model and the recorded history. */
interface MigrationPlan {
  done: boolean; repairs: RestampPair[]; reverts: string[]; mark: boolean; push: string[]; bootstrap: boolean; missingFiles: string[]; unexpected: string[]; final: number;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/u;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const IDENT = /^[a-z][a-z0-9_]*$/u;
const STAMP = /^\d{14}$/u;
const SIGNATURE = /^[A-Za-z0-9_."(), ]+$/u;
const MIGRATION = /^(\d{14})_([A-Za-z0-9_-]+)\.sql$/u;

type Check = (value: unknown) => boolean;
// reason: the `database:` block is YAML parsed from disk; the checks below judge each field before anything reads it
type Block = Record<string, any>;

const matches = (pattern: RegExp): Check => (value) => typeof value === 'string' && pattern.test(value);
const listOf = (item: Check): Check => (value) => Array.isArray(value) && value.every((entry) => item(entry));
const dirOk: Check = (value) => typeof value === 'string' && value.split('/').every((part) => SEGMENT.test(part) && part !== '..');
const pairOk: Check = (value) => plain(value) && Object.keys(value as Block).length === 2 && matches(STAMP)((value as Block).from) && matches(STAMP)((value as Block).to);
const SERVICE = /^[a-z][a-z0-9_-]*$/u;
const POST_FIELDS = ['schema', 'functionPrefixes', 'functionNames', 'functions', 'minAgeHours'];
const POST_CHECKS: Record<string, Check> = {
  schema: matches(IDENT), functionPrefixes: listOf(matches(IDENT)), functionNames: listOf(matches(IDENT)),
  functions: listOf(matches(SIGNATURE)), minAgeHours: (value) => Number.isFinite(value) && (value as number) >= 0,
};
const postOk: Check = (value) => plain(value) && Object.keys(value as Block).every((key) => POST_FIELDS.includes(key) && (POST_CHECKS[key] as Check)((value as Block)[key]));

const CHECKS: Record<string, [Check, string]> = {
  migrationsDir: [dirOk, 'must be a relative directory inside the app'],
  archiveDir: [dirOk, 'must be a relative directory inside the app'],
  baseline: [matches(NAME), `must match ${NAME} (the name after the stamp)`],
  standard: [matches(NAME), `must match ${NAME} (the name after the stamp)`],
  heldBack: [listOf(matches(NAME)), 'must be a list of migration names'],
  restamp: [listOf(pairOk), 'must be a list of { from, to } fourteen-digit stamps'],
  postCutover: [postOk, `must use only ${POST_FIELDS.join(', ')} with valid values`],
  target: [(value) => value === 'stack' || value === 'external', 'must be stack (a service of the environment stack) or external'],
  service: [matches(SERVICE), `must match ${SERVICE} (the stack service that runs the database)`],
};

const DEFAULTS: Readonly<DatabaseDecl> = Object.freeze({ migrationsDir: MIGRATIONS_DIR, archiveDir: null, baseline: null, standard: null, heldBack: [], restamp: [], postCutover: null, target: 'stack', service: 'db' });

/** Judges the `database:` block. Returns { config } or { problems }; every field is optional (`standard` needs `baseline`). */
function normalizeDatabase(block: unknown): { config: DatabaseDecl; problems?: undefined } | { config?: undefined; problems: string[] } {
  if (!plain(block)) return { problems: ['database: must be a mapping'] };
  const fields = block as Block;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!Object.hasOwn(CHECKS, key)) problems.push(`database.${key}: is not a field of the database block`);
    else if (!(CHECKS[key] as [Check, string])[0](value)) problems.push(`database.${key}: ${(CHECKS[key] as [Check, string])[1]}`);
  }
  if (fields.standard !== undefined && fields.baseline === undefined) problems.push('database.standard: needs database.baseline');
  if (problems.length > 0) return { problems };
  return { config: { ...DEFAULTS, ...fields } };
}

/** The normalised `database:` block of the app at `root` (all defaults when absent); an invalid block is a refusal. */
export function loadDatabase(root: string): DatabaseDecl {
  const block = readDeclaration(root).database;
  if (block === undefined) return { ...DEFAULTS };
  const { config, problems } = normalizeDatabase(block);
  if (!config) throw refusal(DATABASE_CODE, `${problems.length} problem(s) in database: ${problems.slice(0, 6).join('; ')}`);
  return config;
}

/* ---- the repository model */

const sqlNames = (dir: string, what: string): string[] => {
  try { return fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort(byCodeUnit); } catch { throw refusal('DB_MIGRATIONS_MISSING', `${what} (${dir}) is not readable`); }
};

const stampOf = (file: string): string => file.split('_')[0] as string;
const nameOf = (file: string): string => file.slice(file.indexOf('_') + 1, -'.sql'.length);

function archiveOf(root: string, decl: DatabaseDecl): ArchiveRow[] {
  if (decl.archiveDir === null || !fs.existsSync(path.join(root, decl.archiveDir))) return [];
  const moved = new Map(decl.restamp.map((pair) => [pair.from, pair.to]));
  return sqlNames(path.join(root, decl.archiveDir), 'the archive directory').map((file) => {
    const version = moved.get(stampOf(file)) ?? stampOf(file);
    return { name: `${version}_${file.slice(file.indexOf('_') + 1)}`, version };
  });
}

function stampProblems(model: Omit<MigrationModel, 'pushVersions' | 'allowed'>, decl: DatabaseDecl): void {
  const { files, baselineFile, standardFile, baseline, standard } = model;
  for (const file of files) {
    const version = stampOf(file);
    if (baselineFile && file !== baselineFile && version <= (baseline as string)) throw refusal('DB_STAMP_ORDER', `${file} sorts at or before the baseline: it would run before the baseline on a fresh database`);
    if (standardFile && file !== baselineFile && file !== standardFile && version <= (standard as string)) throw refusal('DB_STAMP_ORDER', `${file} sorts before the second baseline`);
    if (decl.restamp.some((pair) => pair.to === version)) throw refusal('DB_STAMP_COLLISION', `${file} collides with a restamp target`);
  }
}

/** The migration files of the app and its baseline pair; refuses badly named, duplicate-stamped or missing files. */
function checkedFiles(root: string, decl: DatabaseDecl): { files: string[]; baselineFile: string | undefined; standardFile: string | undefined } {
  const files = sqlNames(path.join(root, decl.migrationsDir), 'the migrations directory');
  const bad = files.filter((file) => !MIGRATION.test(file));
  if (bad.length > 0) throw refusal('DB_MIGRATION_NAME', `migration files must be <14-digit stamp>_<name>.sql (got ${bad[0]})`);
  if (new Set(files.map(stampOf)).size !== files.length) throw refusal('DB_STAMP_DUPLICATE', 'two migrations share one stamp');
  const baselineFile = decl.baseline === null ? undefined : files.find((file) => file.endsWith(`_${decl.baseline}.sql`));
  const standardFile = decl.standard === null ? undefined : files.find((file) => file.endsWith(`_${decl.standard}.sql`));
  if (decl.baseline !== null && !baselineFile) throw refusal('DB_BASELINE_MISSING', `no migration named ${decl.baseline} in ${decl.migrationsDir}`);
  if (decl.standard !== null && !standardFile) throw refusal('DB_BASELINE_MISSING', `no migration named ${decl.standard} in ${decl.migrationsDir}`);
  return { files, baselineFile, standardFile };
}

/** Classifies the migration files of the app: baseline pair, held-back, forward, restamp pairs and archive. Refuses an inconsistent repository. */
export function buildModel(root: string, decl: DatabaseDecl): MigrationModel {
  const { files, baselineFile, standardFile } = checkedFiles(root, decl);
  const held = files.filter((file) => decl.heldBack.some((name) => file.endsWith(`_${name}.sql`)));
  const push = files.filter((file) => !held.includes(file));
  const baseline = baselineFile ? stampOf(baselineFile) : null;
  const model: Omit<MigrationModel, 'pushVersions' | 'allowed'> = {
    root, decl, files, baselineFile, standardFile, baseline, standard: standardFile ? stampOf(standardFile) : null, held, push,
    heldVersions: held.map(stampOf), pushPending: push.filter((file) => file !== baselineFile).map(stampOf), archive: archiveOf(root, decl),
  };
  stampProblems(model, decl);
  const base = baseline === null ? [] : [baseline];
  return { ...model, pushVersions: new Set([...base, ...model.pushPending]), allowed: new Set([...base, ...model.pushPending, ...model.heldVersions]) };
}

const fileOf = (model: MigrationModel, version: string): string => model.files.find((file) => file.startsWith(`${version}_`)) as string;

/* ---- phases: expand before the services update, contract after accept */

/** True for a contract migration, a file named `<stamp>_..contract_...sql` (BE-PERSISTENCE-19): destructive DDL that runs only after the release is accepted. */
export const isContractMigration = (file: string): boolean => /^\d{14}_(?:[A-Za-z0-9-]+_)?contract_[A-Za-z0-9_-]+\.sql$/u.test(file);

/**
 * The model one phase of a deploy works with. `expand` leaves the contract migrations out of the forward set (they are not pending yet, and a
 * history that already holds them is still explained); `contract` keeps only them. The baseline stays in both: it was applied before.
 */
export function phaseModel(model: MigrationModel, phase: MigrationPhase): MigrationModel {
  if (phase === 'all') return model;
  const keep = (version: string): boolean => isContractMigration(fileOf(model, version)) === (phase === 'contract');
  const pushPending = model.pushPending.filter(keep);
  return { ...model, pushPending, pushVersions: new Set([...(model.baseline === null ? [] : [model.baseline]), ...pushPending]) };
}

/* ---- the target */

/** The database of `--db-url-env` (default DATABASE_URL). */
export const resolveTarget = (ctx: VerbContext, options: { target?: DbTarget; urlEnv?: string | undefined } = {}): DbTarget => options.target ?? dbTarget(ctx, options.urlEnv ?? DEFAULT_DB_URL_ENV);

/** True for a database on this machine's loopback (the local db service): applying to it needs no arming. */
export const isLoopback = (url: string): boolean => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

/** Refuses a mutation unless the operator armed it with STARCI_DB_ARMED=1. */
export function requireArmed(ctx: VerbContext): void {
  if (ctx.env.STARCI_DB_ARMED !== '1') throw approvalMissing('DB_NOT_ARMED', 'set STARCI_DB_ARMED=1 to apply database changes');
}

/** The recorded history as a Set of versions. */
export const listRemote = (session: MigrationSession): Set<string> => historyVersions(session.ctx, session.target);

/* ---- the plan */

/** Pure: what to do given the recorded history. `done` means baseline + forward are present and nothing else is. */
export function planMigration(model: MigrationModel, remote: ReadonlySet<string>): MigrationPlan {
  const done = [...model.pushVersions].every((version) => remote.has(version)) && [...remote].every((version) => model.allowed.has(version));
  const sim = new Set(remote);
  const repairs = model.decl.restamp.filter((pair) => sim.has(pair.from));
  for (const pair of repairs) {
    sim.delete(pair.from);
    sim.add(pair.to);
  }
  const hasBaseline = model.baseline !== null;
  const baseline = model.baseline as string;
  const reverts = !hasBaseline || sim.has(baseline) ? [] : model.archive.map((item) => item.version).filter((version) => sim.has(version));
  for (const version of reverts) sim.delete(version);
  // A baseline is marked (never run) only on a database that already holds history; an empty database runs it as the first migration.
  const mark = hasBaseline && !sim.has(baseline) && remote.size > 0;
  if (mark) sim.add(baseline);
  const forward = hasBaseline && !sim.has(baseline) ? [baseline, ...model.pushPending] : model.pushPending;
  const push = forward.filter((version) => !sim.has(version));
  for (const version of push) sim.add(version);
  const archived = new Set(model.archive.map((item) => item.version));
  const missingFiles = repairs.map((pair) => pair.to).filter((version) => !archived.has(version));
  const bootstrap = remote.size === 0 && push.length > 0 && fs.existsSync(path.join(model.root, BOOTSTRAP_FILE));
  return { done, repairs, reverts, mark, push, bootstrap, missingFiles, unexpected: [...sim].filter((version) => !model.allowed.has(version)), final: sim.size };
}


function planLines(model: MigrationModel, session: MigrationSession, remote: ReadonlySet<string>, plan: MigrationPlan): string[] {
  return [
    `target         ${session.target.how}`,
    `history        ${remote.size} version(s)`,
    [`repairs        ${plan.repairs.length} restamped version(s) to move`, ...plan.repairs.map((pair) => `  ${pair.from} -> ${pair.to}`)].join('\n'),
    `archive revert ${plan.reverts.length} archived version(s) recorded`,
    `baseline       ${model.baseline === null ? 'none declared' : `${model.baseline} ${plan.mark ? 'will be marked applied (not run)' : 'applied or run in order'}`}`,
    `forward        ${plan.push.length} migration(s): ${plan.push.map((version) => fileOf(model, version)).join(', ') || 'none'}`,
    `held back      ${model.held.join(', ') || 'none'} (never applied here; starci app db post-cutover)`,
    `bootstrap      ${plan.bootstrap ? `${BOOTSTRAP_FILE} runs first (the history is empty)` : 'not needed'}`,
  ];
}

const dataOf = (model: MigrationModel, plan: MigrationPlan, remote: ReadonlySet<string>, extra: Record<string, unknown>): Record<string, unknown> => ({
  remoteCount: remote.size, repairs: plan.repairs.length, reverts: plan.reverts, baseline: model.baseline, markBaseline: plan.mark, push: plan.push,
  heldBack: model.heldVersions, done: plan.done, pushFiles: plan.push.map((version) => fileOf(model, version)), ...extra,
});

/* ---- applying */

/** Applies `versions` in order: each file and its history row in one transaction, so a failure leaves the history true. */
export function applyVersions(session: MigrationSession, versions: string[]): string[] {
  const { ctx, target, model } = session;
  for (const version of versions) {
    const file = fileOf(model, version);
    psqlTransaction(ctx, target, [{ sql: HISTORY_DDL }, { file: path.join(model.root, model.decl.migrationsDir, file) }, { sql: markApplied(version, nameOf(file)) }]);
  }
  return versions;
}

function applyPlan(session: MigrationSession, plan: MigrationPlan): string[] {
  const { ctx, target, model } = session;
  if (plan.bootstrap) psqlTransaction(ctx, target, [{ file: path.join(model.root, BOOTSTRAP_FILE) }]);
  const history = [
    ...plan.repairs.flatMap((pair) => [markReverted(pair.from), markApplied(pair.to, nameOf(model.archive.find((item) => item.version === pair.to)?.name ?? `${pair.to}_restamped.sql`))]),
    ...plan.reverts.map(markReverted),
    ...(plan.mark ? [markApplied(model.baseline as string, nameOf(model.baselineFile as string))] : []),
  ];
  if (history.length > 0) psqlTransaction(ctx, target, [{ sql: HISTORY_DDL }, ...history.map((sql) => ({ sql }))]);
  return applyVersions(session, plan.push);
}

/**
 * `starci app db migrate`. options: { execute, urlEnv, target }. Dry run reads the history once and prints the plan (the entry adds the
 * read-only inventory of cron jobs and queues, see withInventory; this function stays ok while work is pending, for the urgent floor); --execute applies it,
 * armed with STARCI_DB_ARMED=1 unless the database is on the loopback (the local db service of `npm run db:push`). Already baseline + forward: `nothing to do`, no mutating call, ok.
 */
export async function migrateDatabase(ctx: VerbContext, decl: DatabaseDecl, options: { execute?: boolean; urlEnv?: string | undefined; target?: DbTarget; phase?: MigrationPhase } = {}): Promise<VerbResult> {
  const model = phaseModel(buildModel(ctx.cwd, decl), options.phase ?? 'all');
  const session: MigrationSession = { ctx, model, target: resolveTarget(ctx, options) };
  const remote = listRemote(session);
  const plan = planMigration(model, remote);
  if (plan.done) return { ok: true, lines: [`target         ${session.target.how}`, 'the history already is the baseline plus the forward migrations (held-back ones may or may not be applied). Nothing to do.'], data: dataOf(model, plan, remote, { executed: false }) };
  const lines = planLines(model, session, remote, plan);
  const red = [
    ...plan.missingFiles.map((version) => `no archived migration file for the restamped version ${version}`),
    ...plan.unexpected.map((version) => `recorded version ${version} is outside baseline + forward + held-back and no restamp or archive row explains it`),
  ];
  if (red.length > 0) return { ok: false, lines: [...lines, ...red.map((item) => `RED: ${item}`), 'nothing applied.'], data: dataOf(model, plan, remote, { red, executed: false }) };
  if (options.execute !== true) return { ok: true, lines: [...lines, `dry run: read-only (one history read); the final history would be ${plan.final} version(s). Nothing applied.`], data: dataOf(model, plan, remote, { executed: false }) };
  if (!isLoopback(session.target.url)) requireArmed(ctx);
  const pushed = applyPlan(session, plan);
  const final = listRemote(session);
  if (!planMigration(model, final).done) throw failure('DB_FINAL_MISMATCH', `the history is not baseline + forward migrations (${[...final].join(', ')})`);
  return { ok: true, lines: [...lines, `applied: ${pushed.length} forward migration(s); the history now holds ${final.size} version(s). Held back: ${model.held.join(', ') || 'nothing'}.`], data: dataOf(model, plan, remote, { executed: true, pushed, remoteCountAfter: final.size }) };
}

/**
 * The dry run of the verb, after its own plan: the read-only inventory of the active migrations
 * against the database (migrations, pg_cron jobs, pgmq queues), counts only. The verdict keeps plan's exit codes: ok (exit 0) when the
 * repository and the database agree, not ok (exit 1) when a migration is still to apply or a cron job or queue differs, a refusal
 * (exit 2) when the migrations or the inventory cannot be read. A result that is already red stays as it is. The held-back migrations
 * are not drift for the history (migrate's `done` judges it), so only the cron and queue counts add to a finished history.
 */
function withInventory(ctx: VerbContext, target: DbTarget, result: VerbResult): VerbResult {
  if (!result.ok) return result;
  let inventory: PlanInventory;
  try { inventory = planInventory(ctx.cwd, (sql) => queryRows(ctx, target, sql, { withhold: true })); }
  catch (error) {
    // Plan's exit 2 covers every refusal and failure of the read: unreadable migrations, a psql failure, an inventory that cannot be read.
    if (error instanceof DbVerbError) throw refusal('DB_PLAN_REFUSED', error.message);
    if (error instanceof StackError) throw refusal(error.code, error.message.slice(error.code.length + 2));
    throw error;
  }
  const pending = result.data?.done !== true;
  const drift = pending || summaryDrifts(inventory.summaries.cron) || summaryDrifts(inventory.summaries.queues);
  const lines = [`read-only database plan: ${drift ? 'drift detected' : 'repo and database agree'}`, ...(Object.entries(inventory.summaries) as Array<[Kind, Summary]>).map(([kind, item]) => summaryLine(kind, item))];
  return { ok: !drift, lines: [...(result.lines ?? []), ...lines], data: { ...result.data, readOnly: true, drift, ...inventory.summaries } };
}

/** The flags of `starci app db migrate`; the parser refuses every other. */
export const SPEC: FlagSpec = { boolean: ['--execute', '--json'], value: ['--db-url-env'] };

/**
 * Entry of the verb: `starci app db migrate [--execute] [--db-url-env <NAME>] [--json]`. Execute requires database arming. Without
 * --execute it is the read-only plan: exit 0 when the repository and the database agree, 1 on drift, 2 when refused.
 */
export function dbMigrateMain(argv: string[], io: VerbIo = {}): Promise<number> {
  return runVerb({
    label: 'starci app db migrate', name: 'db migrate', code: 'DB_USAGE', io, argv, spec: SPEC,
    run: async (ctx, flags, positional) => {
      if (positional.length) throw refusal('DB_USAGE', 'migrate takes flags only');
      const execute = flags.execute === true;
      const target = resolveTarget(ctx, { urlEnv: flags['db-url-env'] as string | undefined });
      const result = await migrateDatabase(ctx, loadDatabase(ctx.cwd), { execute, target });
      return execute ? result : withInventory(ctx, target, result);
    },
  });
}
