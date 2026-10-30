// The read-only database plan: compare migration-owned state (history, pg_cron jobs, pgmq queues) without fetching commands.
// planInventory is what the dry run of `db migrate` prints after its own plan; dbPlanMain is the clean-plan precondition of `db baseline`.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../engine/digest.mjs';
import pg from 'libpg-query';
import { invocationDir } from '../lib/roots.mjs';
import { sqlStringParts, walkSqlAst as walk, sqlParser, sqlCallArgument as argument, sqlStringLiteral as literal } from '../lib/sql-ast.mjs';
import { DbVerbError, dbOptions, dbAppRoot, dbSqlFiles, runDbPostgres, dbFailure, offendersError, type DbMainIo, type DbPorts } from './db-baseline-verb.mjs';

await pg.loadModule();

// reason: libpg-query AST nodes and PL/pgSQL trees are parsed input; the walkers below test them key by key.
type SqlNode = any;

/** One cron job as the repository declares it or the database reports it. */
interface CronJob { schedule: string; commandHash: string; active: boolean }

/** The inventories a plan compares. */
export type Kind = 'migrations' | 'cron' | 'queues';

/** What the active migrations declare: history versions, cron jobs (by name) and queues (by name). */
interface RepositoryState { migrations: Map<string, null>; cron: Map<string, CronJob>; queues: Map<string, null> }

/** One row of a database inventory, read back as JSON. */
export type Row = Record<string, unknown>;

/** How one inventory differs between the repository and the database. */
export interface Summary { expected: number; remote: number; missing: number; unexpected: number; changed: number }

// Each inventory is one read-only psql query whose rows come back as JSON (db-baseline-verb.mjs runDbPostgres).
const PRESENCE_SQL = `select
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as migrations,
  pg_catalog.to_regclass('cron.job') is not null as cron,
  pg_catalog.to_regclass('pgmq.meta') is not null as queues;`;
const INVENTORIES: Record<Kind, string> = {
  migrations: 'select version from supabase_migrations.schema_migrations order by version;',
  cron: 'select jobname as name, schedule, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(command, \'UTF8\')), \'hex\') as "commandHash", active from cron.job order by jobid;',
  queues: 'select queue_name as name from pgmq.meta order by queue_name;',
};
const names = (nodes: SqlNode): string => sqlStringParts(nodes).join('.');
const OWNERSHIP_CALLS = new Set(['pgmq.create', 'pgmq.drop_queue', 'cron.schedule', 'cron.unschedule', 'cron.schedule_in_database', 'cron.alter_job']);

const parseSql = sqlParser(pg, () => { throw new DbVerbError('migration SQL could not be inventoried safely'); });

function requiredLiteral(call: SqlNode, index: number, aliases: string[]): string {
  const value = literal(argument(call, index, aliases));
  if (value === null || value.length === 0) throw new DbVerbError('queue and cron ownership requires literal migration declarations');
  return value;
}

function inventoryCall(state: RepositoryState, call: SqlNode): void {
  const name = names(call.funcname);
  if (name === 'pgmq.create') {
    state.queues.set(requiredLiteral(call, 0, ['queue_name']), null);
  } else if (name === 'pgmq.drop_queue') {
    state.queues.delete(requiredLiteral(call, 0, ['queue_name']));
  } else if (name === 'cron.schedule') {
    const job = requiredLiteral(call, 0, ['job_name']);
    const schedule = requiredLiteral(call, 1, ['schedule']);
    const command = requiredLiteral(call, 2, ['command']);
    state.cron.set(job, { schedule, commandHash: sha256(command), active: true });
  } else if (name === 'cron.unschedule') {
    state.cron.delete(requiredLiteral(call, 0, ['job_name']));
  } else if (name === 'cron.schedule_in_database' || name === 'cron.alter_job') {
    throw new DbVerbError('database plan requires cron.schedule and named cron.unschedule ownership');
  }
}

function ownershipCalls(tree: SqlNode): SqlNode[] {
  const calls: SqlNode[] = [];
  walk(tree, (node: SqlNode) => { if (node.FuncCall && OWNERSHIP_CALLS.has(names(node.FuncCall.funcname))) calls.push(node.FuncCall); });
  return calls;
}

function flatDeclaration(tree: SqlNode, call: SqlNode): boolean {
  const node = tree.SelectStmt ?? (tree.stmts?.length === 1 && tree.stmts[0].stmt.SelectStmt);
  const constrained = ['fromClause', 'withClause', 'whereClause', 'intoClause', 'limitCount', 'limitOffset', 'groupClause', 'havingClause', 'distinctClause', 'windowClause'];
  return node && /^SETOP_NONE$/.test(node.op) && node.targetList?.length === 1
    && !constrained.some((key) => node[key]) && node.targetList[0].ResTarget?.val?.FuncCall === call;
}

function inventoryTree(state: RepositoryState, tree: SqlNode): void {
  const calls = ownershipCalls(tree);
  if (!calls.length) return;
  if (calls.length !== 1 || !flatDeclaration(tree, calls[0])) throw new DbVerbError('database ownership requires one unconditional migration SELECT per declaration');
  inventoryCall(state, calls[0]);
}

function conditionalBlock(item: SqlNode): boolean {
  if (item.PLpgSQL_stmt_block?.exceptions) return true;
  return Object.keys(item).some((key) => key.startsWith('PLpgSQL_stmt_')
    && !['PLpgSQL_stmt_block', 'PLpgSQL_stmt_perform', 'PLpgSQL_stmt_execsql'].includes(key)
    && !(key === 'PLpgSQL_stmt_return' && item[key].lineno === undefined));
}

/** Inventories one DO block; returns the body-relative line of each EXECUTE, whose SQL is built at run time and so never inventoried. */
function inventoryDo(state: RepositoryState, node: SqlNode): number[] {
  const option = (key: string): string | undefined => (node.args ?? []).find((item: SqlNode) => item.DefElem?.defname === key)?.DefElem?.arg?.String?.sval;
  if (option('language') && option('language') !== 'plpgsql') throw new DbVerbError('database plan requires statically readable migration blocks');
  const body = option('as') ?? '';
  let delimiter = '$starci_plan$';
  while (body.includes(delimiter)) delimiter = `${delimiter.slice(0, -1)}_$`;
  let tree: SqlNode;
  try { tree = pg.parsePlPgSQLSync(`create function starci_plan_probe() returns void language plpgsql as ${delimiter}${body}${delimiter};`); }
  catch { throw new DbVerbError('migration block could not be inventoried safely'); }
  const statements: SqlNode[] = [];
  const dynamic: number[] = [];
  let conditional = false;
  walk(tree, (item: SqlNode) => {
    conditional ||= conditionalBlock(item);
    if (item.PLpgSQL_stmt_dynexecute) dynamic.push(item.PLpgSQL_stmt_dynexecute.lineno);
    if (item.PLpgSQL_expr?.parseMode === 0) statements.push(parseSql(item.PLpgSQL_expr.query));
  });
  if (conditional && statements.some((statement: SqlNode) => ownershipCalls(statement).length)) throw new DbVerbError('conditional migration blocks cannot prove database inventory');
  for (const statement of statements) inventoryTree(state, statement);
  return dynamic;
}

/** The 1-based line of `text` at libpg_query's byte offset `location`. */
const lineAt = (text: string, location: number): number => Buffer.from(text).subarray(0, location).toString().split('\n').length;

function repositoryState(root: string): RepositoryState {
  const migrations = dbSqlFiles(root);
  const state: RepositoryState = { migrations: new Map(migrations.map((entry): [string, null] => [entry.stamp, null])), cron: new Map(), queues: new Map() };
  if (state.migrations.size !== migrations.length) throw new DbVerbError('active migrations must have unique versions');
  // Every EXECUTE of every active migration is named (file:line) before the refusal.
  const dynamic: string[] = [];
  for (const entry of migrations) {
    const text = fs.readFileSync(path.join(root, entry.file), 'utf8');
    const tree = parseSql(text);
    for (const statement of tree.stmts ?? []) {
      // Creating a function does not execute its body. Inert SQL strings never declare remote state.
      if (statement.stmt.CreateFunctionStmt) continue;
      if (!statement.stmt.DoStmt) { inventoryTree(state, statement.stmt); continue; }
      // The body opens on the line of its quote (the `as` DefElem), so a body line maps to that line plus its offset.
      const opening = lineAt(text, statement.stmt.DoStmt.args?.find((item: SqlNode) => item.DefElem?.defname === 'as')?.DefElem?.location ?? statement.stmt_location ?? 0);
      for (const line of inventoryDo(state, statement.stmt.DoStmt)) dynamic.push(`${entry.file}:${opening + line - 1}: EXECUTE builds its SQL at run time`);
    }
  }
  if (dynamic.length) throw offendersError('dynamic migration blocks cannot prove database inventory', dynamic);
  return state;
}

/** Reads one read-only inventory query as rows (the clean-plan check of baseline: psql through the ports; db migrate's dry run: the verb context's psql). */
export type InventoryQuery = (sql: string) => Row[];

function queryRows(root: string, sql: string, urlEnv: string, ports: DbPorts): Row[] {
  const output = runDbPostgres(root, { kind: 'query', sql }, ports, urlEnv);
  let rows: unknown;
  try { rows = JSON.parse(output); } catch { throw new DbVerbError('the database returned unreadable inventory; database output was withheld'); }
  return rows as Row[];
}

function remoteState(query: InventoryQuery): Record<Kind, Row[]> {
  const asRows = (sql: string): Row[] => {
    const rows: unknown = query(sql);
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new DbVerbError('the database returned an invalid inventory; database output was withheld');
    return rows as Row[];
  };
  const rows = asRows(PRESENCE_SQL);
  if (rows.length !== 1 || Object.keys(INVENTORIES).some((key) => typeof (rows[0] as Row)[key] !== 'boolean')) throw new DbVerbError('the database returned invalid inventory availability');
  // reason: every key of INVENTORIES is assigned by the loop below before the state is returned.
  const state = {} as Record<Kind, Row[]>;
  for (const [key, sql] of Object.entries(INVENTORIES) as Array<[Kind, string]>) state[key] = (rows[0] as Row)[key] ? asRows(sql) : [];
  return state;
}

function compare(expected: Map<string, CronJob | null>, actual: Row[], kind: Kind): Summary {
  const unmatched = new Set(expected.keys());
  let unexpected = 0;
  let changed = 0;
  for (const row of actual) {
    const key = kind === 'migrations' ? row.version : row.name;
    if (key !== null && (typeof key !== 'string' || key.length === 0)) throw new DbVerbError('the database returned an invalid inventory identifier');
    if (kind === 'cron' && (typeof row.schedule !== 'string' || !/^[a-f0-9]{64}$/.test((row.commandHash ?? '') as string) || typeof row.active !== 'boolean')) throw new DbVerbError('the database returned invalid cron metadata');
    if (!unmatched.delete(key as string)) unexpected += 1;
    else if (kind === 'cron') {
      const desired = expected.get(key as string) as CronJob;
      if (desired.schedule !== row.schedule || desired.commandHash !== row.commandHash || desired.active !== row.active) changed += 1;
    }
  }
  return { expected: expected.size, remote: actual.length, missing: unmatched.size, unexpected, changed };
}

/** The inventories of the active migrations against those of the database: the counts of each kind and whether any differs. */
export interface PlanInventory { summaries: Record<Kind, Summary>; drift: boolean }

/** The one line of a summary, as the clean-plan check of `db baseline` and the dry run of `db migrate` print it. */
export const summaryLine = (kind: Kind, item: Summary): string => `${kind}: repo ${item.expected}, remote ${item.remote}, missing ${item.missing}, unexpected ${item.unexpected}, changed ${item.changed}`;

/** True when a summary names a missing, unexpected or changed entry. */
export const summaryDrifts = (item: Summary): boolean => item.missing > 0 || item.unexpected > 0 || item.changed > 0;

/** Compares what the active migrations of `root` declare (history, cron jobs, queues) with what `query` reads from the database; read-only. A DbVerbError is a refusal. */
export function planInventory(root: string, query: InventoryQuery): PlanInventory {
  const expected = repositoryState(root);
  const actual = remoteState(query);
  const summaries = Object.fromEntries((Object.keys(INVENTORIES) as Kind[]).map((kind): [Kind, Summary] => [kind, compare(expected[kind], actual[kind], kind)])) as Record<Kind, Summary>;
  return { summaries, drift: Object.values(summaries).some(summaryDrifts) };
}

/**
 * The options of the read-only plan that `db baseline` demands to be clean before it dumps (the dry run of `db migrate` prints the
 * same inventory through planInventory).
 */
export const PLAN_OPTIONS = Object.freeze(['cwd', 'db-url-env', 'json']);

/** Numeric exit codes: 0 equal, 1 drift, 2 invalid/failed (an --execute too: a plan never mutates history, queues or jobs); all IO and CLI calls are injectable. */
export function dbPlanMain(argv: string[], { cwd = invocationDir(), stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text), ...ports }: DbMainIo = {}): number {
  try {
    const opts = dbOptions(argv, PLAN_OPTIONS);
    const root = dbAppRoot(cwd, opts);
    const urlEnv = opts['db-url-env'] ?? 'DATABASE_URL';
    const { summaries, drift } = planInventory(root, (sql) => queryRows(root, sql, urlEnv, ports));
    if (opts.json) stdout(`${JSON.stringify({ readOnly: true, drift, ...summaries })}\n`);
    else {
      stdout(`read-only database plan: ${drift ? 'drift detected' : 'repo and database agree'}\n`);
      for (const [kind, item] of Object.entries(summaries) as Array<[Kind, Summary]>) stdout(`${summaryLine(kind, item)}\n`);
    }
    return drift ? 1 : 0;
  } catch (error) { return dbFailure('migrate', error, stderr); }
}
