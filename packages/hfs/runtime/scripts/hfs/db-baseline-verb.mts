// app db baseline: schema-only dump, explicit cutover and repair commands; preview writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'libpg-query';
import { invocationDir } from '../lib/roots.mjs';
import { sqlStringParts as names, walkSqlAst as walk, sqlParser } from '../lib/sql-ast.mjs';
import { spawnSync } from 'node:child_process';
import { migrationStamp, isMigrationName, databaseSqlTokens, databaseExecutableTokens } from './rules/database-migrations.mjs';
import { baselineMarkers, baselineSourceFindings } from './rules/database-baseline.mjs';
import { databaseQueueDeclarations } from './rules/database-queues.mjs';
import { MIGRATIONS_DIR, MIGRATIONS_ARCHIVE_DIR } from './rules/database-constants.mjs';
import { dbPlanMain } from './db-plan-verb.mjs';
import { DbVerbError } from './db-errors.mjs';
import { squashBaseline, type RunPostgres } from './db-squash.mjs';

await pg.loadModule();

export { DbVerbError };

// reason: libpg-query AST nodes and PL/pgSQL trees are parsed input; the walkers below test them key by key.
type SqlNode = any;

/** A history change: `stamp` recorded as applied (named `name`) or reverted. */
export interface RepairOp { kind: 'repair'; stamp: string; status: string; name?: string }

/** One database operation: a JSON rows query, a schema-only dump, or a history change. */
export type DbOperation = { kind: 'query'; sql: string } | { kind: 'dump' } | RepairOp;

/** What a database port (or spawnSync) answers with. */
export interface DbResult { ok?: boolean; status?: number | null; stdout?: unknown; error?: unknown }

/** The injectable ports of the db verbs: the environment, the psql runner and the git seam. */
export interface DbPorts {
  env?: NodeJS.ProcessEnv | undefined;
  runPostgres?: ((root: string, op: DbOperation) => DbResult | null | undefined) | undefined;
  git?: unknown;
}

/** The parsed options of a db verb (dbOptions refuses every flag outside the verb's list). */
export interface DbOptions {
  cwd?: string; stamp?: string; apply?: boolean; 'url-env'?: string; squash?: boolean; 'drop-extension'?: string;
  'drop-pgmq-queue'?: string; 'seed-tables'?: string; image?: string; map?: string; json?: boolean;
}

/** One active or archived migration file. */
export interface SqlFile { file: string; name: string; stamp: string }

/** The injectable IO of a db verb. */
export interface DbMainIo extends DbPorts {
  cwd?: string | undefined;
  stdout?: ((text: string) => unknown) | undefined;
  stderr?: ((text: string) => unknown) | undefined;
  now?: (() => Date) | undefined;
}

/** The baseline plan: the active chain, the last valid stamp, the new version and its file. */
interface BaselinePlan { active: SqlFile[]; last: string; stamp: string; file: string }

/** The queue, grant and cron declarations of the migrations (rules/database-queues.mjs). */
interface QueueDeclarations {
  findings: unknown[]; queues: string[]; cron: Array<{ name: string; schedule: string; command: string }>;
  grants?: Array<{ privileges: string[]; tables: string[]; roles: string[]; grantOption?: boolean }>;
}

/** The roles and extensions a baseline reconstructs from the migrations. */
/** One inventory of a plan summary: how many of its entries differ. */
interface DriftItem { missing: number; unexpected: number; changed: number }

interface BaselineState { roles: Map<string, string[]>; extensions: Map<string, string> }

/** Strict shared options; unknown flags never reach the database CLI. */
/** The options of `starci app db baseline` (dbOptions refuses every other). */
export const BASELINE_OPTIONS = Object.freeze(['cwd', 'stamp', 'apply', 'url-env', 'squash', 'drop-extension', 'drop-pgmq-queue', 'seed-tables', 'image']);
/** The boolean options of the dbOptions verbs; every other option takes a value. */
export const DB_BOOLEAN_OPTIONS = Object.freeze(['apply', 'json', 'squash']);

export function dbOptions(argv: string[], allowed: readonly string[]): DbOptions {
  const opts: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] as string).split(/=(.*)/s);
    const name = flag.slice(2);
    if (!flag.startsWith('--') || !allowed.includes(name) || Object.hasOwn(opts, name)) throw new DbVerbError(`unknown or duplicate database option ${flag}`);
    if (DB_BOOLEAN_OPTIONS.includes(name)) {
      if (inline !== undefined && !['true', 'false'].includes(inline)) throw new DbVerbError(`${flag} expects true or false`);
      opts[name] = inline !== 'false';
    } else {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new DbVerbError(`${flag} requires a value`);
      opts[name] = value;
    }
  }
  // reason: every key was checked against `allowed`, and each takes the value kind its option list declares.
  return opts as DbOptions;
}

export function dbAppRoot(cwd: string, opts: DbOptions): string {
  const root = path.resolve(cwd, opts.cwd ?? '.');
  let declaration: { kind?: unknown; edition?: string };
  try { declaration = JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')); } catch { throw new DbVerbError('run at an app root containing hfs.json'); }
  if (declaration.kind !== 'app' || !['lite', 'full'].includes(declaration.edition ?? 'full')) throw new DbVerbError('database verbs require a lite or full app');
  return root;
}

/** A refusal that lists every offending file with the rule it broke, one distinct `<file>: <reason>` line each. */
export const offendersError = (heading: string, offenders: string[]): DbVerbError => new DbVerbError(`${heading}:\n${[...new Set(offenders)].map((line) => `  ${line}`).join('\n')}`);

/** One rule finding as an offender line: its file, its message and its code. */
const findingLine = (item: { message: string; path: string; code: string }): string => `${item.message.startsWith(item.path) ? item.message : `${item.path}: ${item.message}`} (${item.code})`;

/**
 * Why one SQL filename cannot join its chain, or null. The active chain holds R213 (`<ts14>_<kebab>.sql`, a valid UTC
 * stamp; a stamp after now is no breach). The archive is frozen history (R257): it needs only the leading stamp that
 * orders it, so snake_case names, impossible times and shared stamps of a retired chain stay as they were committed.
 */
function chainProblem(directory: string, name: string): string | null {
  const match = /^(\d{14})_/.exec(name);
  if (directory === MIGRATIONS_ARCHIVE_DIR) return match ? null : 'an archived name starts with its 14-digit stamp and an underscore (R257)';
  if (!isMigrationName(name)) return 'name is not <ts14>_<kebab>.sql (R213)';
  if (migrationStamp((match as RegExpExecArray)[1] as string) === null) return `stamp ${(match as RegExpExecArray)[1]} is no valid UTC time (R213)`;
  return null;
}

/** Immediate SQL files only, never secrets or credential files, sorted by full name; every offender is named before the refusal. */
export function dbSqlFiles(root: string, directory: string = MIGRATIONS_DIR): SqlFile[] {
  const dir = path.join(root, directory);
  if (!fs.existsSync(dir)) return [];
  const sqlNames = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.sql')).map((entry) => entry.name);
  const offenders = sqlNames.flatMap((name) => { const problem = chainProblem(directory, name); return problem ? [`${directory}/${name}: ${problem}`] : []; });
  if (offenders.length) throw offendersError('migration filenames break their chain rules', offenders.sort());
  return sqlNames.map((name) => ({ file: `${directory}/${name}`, name, stamp: name.slice(0, 14) }))
    .sort((left, right) => left.name < right.name ? -1 : Number(left.name > right.name));
}

/** The database of `--url-env` (default DATABASE_URL): the URL without its password and the password for PGPASSWORD. */
export function connectionOf(env: NodeJS.ProcessEnv, urlEnv: string): { url: string; env: NodeJS.ProcessEnv } {
  if (!/^[A-Z][A-Z0-9_]*$/.test(urlEnv)) throw new DbVerbError('--url-env must name an UPPER_CASE environment variable');
  let url: URL;
  try { url = new URL(String(env[urlEnv] ?? '')); } catch { throw new DbVerbError(`${urlEnv} must hold a postgres connection URL`); }
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw new DbVerbError(`${urlEnv} must hold a postgres connection URL`);
  const password = decodeURIComponent(url.password);
  url.password = '';
  return { url: url.toString(), env: { ...env, ...(password ? { PGPASSWORD: password } : {}) } };
}

const HISTORY = 'supabase_migrations.schema_migrations';
const sqlLiteral = (value: unknown): string => `'${String(value).replaceAll("'", "''")}'`;

/** The psql and pg_dump invocation of one operation: a JSON rows query, a schema-only dump, or one history row applied or reverted. */
export function commandOf(op: DbOperation, url: string): [string, string[]] {
  const psql = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', url];
  if (op.kind === 'query') return ['psql', [...psql, '-A', '-t', '-c', `select coalesce(json_agg(row_to_json(q)), '[]'::json) from (${op.sql.replace(/;\s*$/, '')}) q`]];
  if (op.kind === 'dump') return ['pg_dump', ['--schema-only', '--schema', 'public', '--dbname', url]];
  if (op.kind === 'repair') {
    const change = op.status === 'applied'
      ? `insert into ${HISTORY} (version, name) values (${sqlLiteral(op.stamp)}, ${sqlLiteral(op.name ?? 'baseline')}) on conflict (version) do nothing`
      : `delete from ${HISTORY} where version = ${sqlLiteral(op.stamp)}`;
    return ['psql', [...psql, '-1', '-c', `create schema if not exists supabase_migrations; create table if not exists ${HISTORY} (version text primary key, statements text[], name text)`, '-c', change]];
  }
  throw new DbVerbError('unsupported database command');
}

/** Runs one database operation through psql or pg_dump (ports.runPostgres in specs); raw failures and output are private. */
export function runDbPostgres(root: string, op: DbOperation, ports: DbPorts = {}, urlEnv = 'DATABASE_URL'): string {
  const env = ports.env ?? process.env;
  const result: DbResult | null | undefined = ports.runPostgres ? ports.runPostgres(root, op) : (() => {
    const connection = connectionOf(env, urlEnv);
    const [command, args] = commandOf(op, connection.url);
    return spawnSync(command, args, { cwd: root, encoding: 'utf8', env: connection.env, timeout: 120_000, windowsHide: true });
  })();
  if (result?.error || !(result?.ok === true || result?.status === 0)) throw new DbVerbError('database command failed; inspect psql privately');
  return String(result.stdout ?? '');
}

/** A history change: `stamp` recorded as applied (named `name`) or reverted. */
export const repairOp = (stamp: string, status: string, name?: string): RepairOp => ({ kind: 'repair', stamp, status, ...(name ? { name } : {}) });
/** The printed form of a history change. */
export const repairLine = (op: RepairOp): string => `history ${op.status} ${op.stamp}${op.name ? ` ${op.name}` : ''}`;
export const dbFailure = (verb: string, error: unknown, stderr: (text: string) => unknown): number => { stderr(`starci app db ${verb}: ${error instanceof DbVerbError ? error.message : 'operation failed; database output was withheld'}\n`); return 2; };

function baselinePlan(root: string, opts: DbOptions, now: () => Date): BaselinePlan {
  const active = dbSqlFiles(root);
  if (!active.length) throw new DbVerbError('baseline requires an existing active migration chain');
  const archived = dbSqlFiles(root, MIGRATIONS_ARCHIVE_DIR);
  const archivedNames = new Set(archived.map((entry) => entry.name));
  const twice = active.filter((entry) => archivedNames.has(entry.name)).map((entry) => `${entry.file}: also archived as ${MIGRATIONS_ARCHIVE_DIR}/${entry.name}; a migration is active or archived, never both (R257)`);
  if (twice.length) throw offendersError('baseline would overwrite an existing migration', twice);
  const chain = [...active, ...archived].sort((left, right) => left.stamp < right.stamp ? -1 : Number(left.stamp > right.stamp) || (left.name < right.name ? -1 : Number(left.name > right.name)));
  // The new version sorts after every file; the header names the last valid stamp, the boundary R257 judges.
  const boundary = chain.at(-1) as SqlFile;
  const last = chain.filter((entry) => migrationStamp(entry.stamp) !== null).at(-1)?.stamp ?? boundary.stamp;
  const stamp = opts.stamp ?? now().toISOString().replace(/\D/g, '').slice(0, 14);
  if (!/^\d{14}$/.test(stamp) || migrationStamp(stamp) === null || stamp <= boundary.stamp) throw new DbVerbError(`--stamp must be a valid UTC version after the archive boundary ${boundary.stamp} (${boundary.file})`);
  const file = `${MIGRATIONS_DIR}/${stamp}_baseline.sql`;
  if (fs.existsSync(path.join(root, file))) throw new DbVerbError(`baseline would overwrite an existing migration: ${file}`);
  return { active, last, stamp, file };
}

const EXCLUDED_SCHEMAS = new Set<string | undefined>(['information_schema', '_analytics', '_realtime', '_supavisor', 'auth', 'etl', 'extensions', 'pgbouncer', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'cron', 'dbdev', 'graphql', 'graphql_public', 'net', 'pgmq', 'pgmq_public', 'pgsodium', 'pgsodium_masks', 'pgtle', 'repack', 'tiger', 'tiger_data', 'topology', 'vault']);
const ROLE_OPTIONS = new Set(['canlogin', 'inherit', 'superuser', 'createdb', 'createrole', 'isreplication', 'bypassrls', 'connectionlimit']);
const identifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
export const excludedSchema = (name: string | undefined): boolean => EXCLUDED_SCHEMAS.has(name) || /^(?:pg_|timescaledb_|_timescaledb_)/.test(name ?? '');

/** Inventory source paths only; no credential, generated or vendor tree is traversed. */
function baselineFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    const full = path.join(root, directory);
    if (!fs.existsSync(full)) return;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:sql|[cm]?[jt]sx?)$/.test(entry.name)) files.push(file);
    }
  };
  for (const directory of ['db', 'be/src', 'be/apps', 'src', 'apps']) visit(directory);
  return files;
}

const parsed = sqlParser(pg, () => { throw new DbVerbError('migration SQL could not be prepared safely for a baseline'); });

function statementSql(text: string, entry: SqlNode): string {
  const bytes = Buffer.from(text);
  const start = entry.stmt_location ?? 0;
  const statement = bytes.subarray(start, entry.stmt_len ? start + entry.stmt_len : bytes.length).toString('utf8');
  return `${statement.slice(databaseSqlTokens(statement)[0]?.index ?? 0).trim().replace(/;\s*$/, '')};\n`;
}

function ownedSchemas(node: SqlNode): SqlNode[] {
  const schemas = [node.relation?.schemaname, node.table?.schemaname, node.schemaname, node.newschema];
  for (const field of ['funcname', 'typeName', 'typename', 'type', 'object', 'domainname', 'collname', 'opfamilyname', 'opclassname']) {
    const parts = names(Array.isArray(node[field]) ? node[field] : node[field]?.names ?? node[field]?.List?.items);
    if (parts.length > 1) schemas.push(parts[0]);
  }
  for (const object of node.objects ?? []) {
    const parts = names(object.List?.items ?? object.ObjectWithArgs?.objname);
    schemas.push(object.RangeVar?.schemaname);
    if (parts.length > 1 || /^OBJECT_SCHEMA$/.test(node.objtype ?? node.removeType ?? '')) schemas.push(parts[0]);
  }
  return schemas;
}

function excludedOwnership(stmt: SqlNode): boolean {
  if (ownedSchemas(stmt).some(excludedSchema)) return true;
  let unsupported = false;
  walk(stmt, (node: SqlNode) => {
    if (node.DefElem?.defname === 'schemas' && names(node.DefElem.arg?.List?.items).some(excludedSchema)) unsupported = true;
    if (node.FuncCall && names(node.FuncCall.funcname)[0] === 'vault') unsupported = true;
  });
  if (stmt.name === 'search_path') unsupported ||= (stmt.args ?? []).some((node: SqlNode) => excludedSchema(node.A_Const?.sval?.sval));
  return unsupported;
}

function dataMutation(stmt: SqlNode): boolean {
  if (stmt.CreateFunctionStmt || stmt.CreateTrigStmt || stmt.CreatePolicyStmt || stmt.AlterPolicyStmt || stmt.CreateStmt || stmt.ViewStmt) return false;
  let mutation = false;
  walk(stmt, (node: SqlNode) => { if (['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt', 'CopyStmt', 'TruncateStmt', 'IntoClause'].some((key) => node[key])) mutation = true; });
  return mutation;
}

function unsupportedCall(call: SqlNode): boolean {
  const name = names(call.funcname).join('.');
  const args = (call.args ?? []).map((arg: SqlNode) => arg.NamedArgExpr?.arg ?? arg);
  if (name === 'pgmq.create' || name === 'pgmq.drop_queue') return args.length !== 1 || !args[0]?.A_Const?.sval;
  if (name === 'cron.schedule' || name === 'cron.unschedule') return false;
  if (name === 'pg_catalog.set_config') return args[0]?.A_Const?.sval?.sval !== 'search_path' || args[1]?.A_Const?.sval?.sval !== '';
  return true;
}

function sourceExecution(stmt: SqlNode): boolean {
  if (stmt.CallStmt) return true;
  if (!stmt.SelectStmt) return false;
  let unsupported = false;
  walk(stmt, (node: SqlNode) => { if (node.FuncCall && unsupportedCall(node.FuncCall)) unsupported = true; });
  return unsupported;
}

function unsupportedDo(node: SqlNode): boolean {
  const body = (node.args ?? []).find((item: SqlNode) => item.DefElem?.defname === 'as')?.DefElem?.arg?.String?.sval ?? '';
  const tokens = databaseExecutableTokens(body);
  const unsupported = tokens.some((token: SqlNode, index: number) => {
    const next = tokens[index + 1]?.v;
    return (token.t === 'word' && ['execute', 'role', 'user', 'extension', 'insert', 'update', 'delete', 'merge', 'copy', 'truncate'].includes(token.v))
      || (excludedSchema(token.v) && next === '.' && !['pgmq', 'cron'].includes(token.v));
  });
  if (unsupported) return true;
  let tree;
  try { tree = pg.parsePlPgSQLSync(`do ${literal(body)};`); } catch { return true; }
  let effects = false;
  walk(tree, (item: SqlNode) => {
    if (item.PLpgSQL_expr?.parseMode !== 0) return;
    const sql = parsed(item.PLpgSQL_expr.query);
    if ((sql.stmts ?? []).some((entry: SqlNode) => dataMutation(entry.stmt) || sourceExecution(entry.stmt))) effects = true;
  });
  return effects;
}

function roleDeclaration(stmt: SqlNode, sql: string, roles: Map<string, string[]>): boolean {
  const create = stmt.CreateRoleStmt;
  const alter = stmt.AlterRoleStmt;
  const setting = stmt.AlterRoleSetStmt;
  const declaration = create ?? alter ?? setting;
  if (!declaration) return false;
  const name = create?.role ?? declaration.role?.rolename;
  if (!name || name.startsWith('pg_') || (declaration.options ?? []).some((option: SqlNode) => !ROLE_OPTIONS.has(option.DefElem?.defname))) throw new DbVerbError('baseline role declarations require static non-secret role attributes');
  if (setting && setting.setstmt?.name !== 'search_path') throw new DbVerbError('baseline supports only non-secret search_path role settings');
  if (create) roles.set(name, [sql]);
  else {
    if (!roles.has(name)) throw new DbVerbError('baseline cannot reconstruct alterations to a role it does not declare');
    (roles.get(name) as string[]).push(sql);
  }
  return true;
}

function extensionDeclaration(stmt: SqlNode, sql: string, extensions: Map<string, string>): boolean {
  if (stmt.CreateExtensionStmt) {
    extensions.set(stmt.CreateExtensionStmt.extname, sql.replace(/\bcreate\s+extension\s+(?!if\s+not\s+exists\b)/i, 'create extension if not exists '));
    return true;
  }
  if (!/^OBJECT_EXTENSION$/.test(stmt.DropStmt?.removeType ?? '')) return false;
  for (const object of stmt.DropStmt.objects ?? []) extensions.delete(names(object.List?.items)[0] as string);
  return true;
}

function baselineStatement(state: BaselineState, stmt: SqlNode, sql: string): void {
  if (roleDeclaration(stmt, sql, state.roles) || extensionDeclaration(stmt, sql, state.extensions)) return;
  if (stmt.DropRoleStmt) {
    for (const role of stmt.DropRoleStmt.roles ?? []) state.roles.delete(role.RoleSpec?.rolename);
    return;
  }
  if (stmt.GrantRoleStmt || stmt.AlterExtensionStmt || stmt.AlterExtensionContentsStmt || /^OBJECT_ROLE$/.test(stmt.RenameStmt?.renameType ?? '')) throw new DbVerbError('baseline cannot reconstruct role membership, role renames or extension alterations');
  if (dataMutation(stmt) || sourceExecution(stmt)) throw new DbVerbError('baseline cannot reconstruct migration-owned data changes or custom execution from a schema-only dump');
  const node = Object.values(stmt)[0] as SqlNode;
  const queueGrant = stmt.GrantStmt && (node.objects ?? []).every((object: SqlNode) => object.RangeVar?.schemaname === 'pgmq');
  if ((excludedOwnership(node) && !queueGrant) || (stmt.DoStmt && unsupportedDo(node))) throw new DbVerbError('baseline cannot reconstruct application changes to excluded managed schemas or dynamic operational declarations');
}

function baselineMetadata(root: string, plan: BaselinePlan, files: string[]): QueueDeclarations & { roles: string; extensions: string } {
  const queues: QueueDeclarations = databaseQueueDeclarations({ repoRoot: root, files, all: files });
  if (queues.findings.length) throw offendersError('baseline requires valid migration-owned queues, grants and cron declarations', queues.findings.map(findingLine as (item: unknown) => string));
  const state: BaselineState = { roles: new Map(), extensions: new Map() };
  const offenders: string[] = [];
  for (const migration of plan.active) {
    const text = fs.readFileSync(path.join(root, migration.file), 'utf8');
    try {
      for (const entry of parsed(text).stmts ?? []) baselineStatement(state, entry.stmt, statementSql(text, entry));
    } catch (error) {
      if (!(error instanceof DbVerbError)) throw error;
      offenders.push(`${migration.file}: ${(error as DbVerbError).message}`);
    }
  }
  if (offenders.length) throw offendersError('baseline cannot rebuild the active chain from a schema-only dump', offenders);
  return { ...queues, roles: [...state.roles.values()].flat().join(''), extensions: [...state.extensions.values()].join('') };
}

function metadataSql(metadata: QueueDeclarations): string {
  const queueSql = metadata.queues.map((queue) => `select pgmq.create(${literal(queue)});\n`).join('');
  const grants = (metadata.grants ?? []).map((grant) => `grant ${grant.privileges.join(', ')} on table ${grant.tables.map((table) => table.split('.').map(identifier).join('.')).join(', ')} to ${grant.roles.map(identifier).join(', ')}${grant.grantOption ? ' with grant option' : ''};\n`).join('');
  const cron = metadata.cron.map((job) => `select cron.schedule(${literal(job.name)}, ${literal(job.schedule)}, ${literal(job.command)});\n`).join('');
  return `${queueSql}${grants}${cron}`;
}

/**
 * The squash source holds the whole active chain: its history records every active stamp and nothing else. Only the history is read; the
 * queues and cron jobs a plan also compares are what the squash itself drops or carries from the database.
 */
function sourceHistory(root: string, plan: BaselinePlan, ports: DbPorts, urlEnv: string): void {
  const rows = (sql: string): Array<{ present?: boolean; version?: unknown }> => JSON.parse(runDbPostgres(root, { kind: 'query', sql }, ports, urlEnv));
  if (!rows("select pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as present")[0]?.present) throw new DbVerbError(`the source records no migration history (${HISTORY}); apply its chain with starci app db migrate`);
  const recorded = new Set(rows(`select version from ${HISTORY}`).map((row) => String(row.version)));
  const active = new Set(plan.active.map((entry) => entry.stamp));
  const offenders = [...[...active].filter((stamp) => !recorded.has(stamp)).map((stamp) => `${stamp}: active, not applied to the source`), ...[...recorded].filter((stamp) => !active.has(stamp)).map((stamp) => `${stamp}: applied to the source, not in the active chain`)];
  if (offenders.length) throw offendersError('baseline --squash reads a source with exactly the active chain applied', offenders.sort());
}

/**
 * A baseline reads a database whose history, queues and cron jobs equal the repository's. The plan's own refusal (already free of
 * database output) is passed through as the reason; a drift names each inventory that differs, by its counts.
 */
function cleanPlan(root: string, urlEnv: string, ports: DbPorts): void {
  let out = '';
  let err = '';
  const code = dbPlanMain(['--json', '--url-env', urlEnv], { ...ports, cwd: root, stdout: (text) => { out += text; }, stderr: (text) => { err += text; } });
  if (code === 0) return;
  const heading = 'baseline requires a clean database plan with every migration already applied';
  if (code !== 1) throw new DbVerbError(`${heading}; the plan refused: ${err.trim().replace(/^starci app db plan: /, '')}`);
  const drift = Object.entries(JSON.parse(out) as Record<string, DriftItem | boolean>).filter(([, item]) => item && typeof item === 'object' && (item.missing || item.unexpected || item.changed))
    .map(([kind, item]) => `${kind}: missing ${(item as DriftItem).missing}, unexpected ${(item as DriftItem).unexpected}, changed ${(item as DriftItem).changed}`);
  throw offendersError(`${heading}; the plan found drift`, drift);
}

/** Numeric CLI exit code, injectable IO/clock/CLI; neither files nor history change without --apply. */
export function dbBaselineMain(argv: string[], { cwd = invocationDir(), stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text), now = () => new Date(), ...ports }: DbMainIo = {}): number {
  try {
    const opts = dbOptions(argv, BASELINE_OPTIONS);
    if (!opts.squash && ['drop-extension', 'drop-pgmq-queue', 'seed-tables', 'image'].some((name) => Object.hasOwn(opts, name))) throw new DbVerbError('--drop-extension, --drop-pgmq-queue, --seed-tables and --image belong to --squash');
    if (opts.squash && !opts['url-env']) throw new DbVerbError('baseline --squash reads a database the whole active chain is applied to: pass --url-env NAME');
    const urlEnv = opts['url-env'] ?? 'DATABASE_URL';
    const root = dbAppRoot(cwd, opts);
    const plan = baselinePlan(root, opts, now);
    const files = baselineFiles(root);
    const sourceFindings = baselineSourceFindings({ repoRoot: root, files, all: files, git: ports.git, base: undefined });
    if (sourceFindings.length) throw offendersError('baseline sources and archives must match committed migration history', sourceFindings.map(findingLine));
    const archive = () => {
      fs.mkdirSync(path.join(root, MIGRATIONS_ARCHIVE_DIR), { recursive: true });
      for (const entry of plan.active) fs.renameSync(path.join(root, entry.file), path.join(root, MIGRATIONS_ARCHIVE_DIR, entry.name));
    };
    if (opts.squash) {
      const precondition = (runPostgres: RunPostgres): void => sourceHistory(root, plan, { ...ports, runPostgres }, urlEnv);
      return squashBaseline({ root, opts, plan, urlEnv, connection: connectionOf(ports.env ?? process.env, urlEnv), commandOf, precondition, managedSchema: excludedSchema, archive, stdout });
    }
    const metadata = baselineMetadata(root, plan, files);
    cleanPlan(root, urlEnv, ports);
    const schema = runDbPostgres(root, { kind: 'dump' }, ports, urlEnv);
    if (!schema.trim() || baselineMarkers(schema).length || /\bvault\.(?:create_secret|update_secret)\s*\(|\bpassword\s+'[^']+'/i.test(schema)) throw new DbVerbError('schema dump is empty or contains unsupported secret/baseline statements');
    const repairs = [...plan.active.map((entry) => repairOp(entry.stamp, 'reverted')), repairOp(plan.stamp, 'applied', 'baseline')];
    stdout(`${opts.apply ? 'apply' : 'preview'} baseline ${plan.file}; archive ${plan.active.length} migrations\n`);
    for (const op of repairs) stdout(`${repairLine(op)}\n`);
    if (!opts.apply) return 0;
    for (const op of repairs) runDbPostgres(root, op, ports, urlEnv);
    fs.writeFileSync(path.join(root, plan.file), `-- starci:baseline ${plan.last}\n${metadata.extensions}${metadata.roles}${schema.replace(/^\s+/, '')}\n${metadataSql(metadata)}`, { flag: 'wx' });
    archive();
    return 0;
  } catch (error) { return dbFailure('baseline', error, stderr); }
}
