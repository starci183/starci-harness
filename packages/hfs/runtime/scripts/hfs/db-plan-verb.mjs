// app db plan: compare migration-owned state (history, pg_cron jobs, pgmq queues) without fetching commands.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../engine/digest.mjs';
import pg from 'libpg-query';
import { invocationDir } from '../lib/roots.mjs';
import { sqlStringParts, walkSqlAst as walk, sqlParser, sqlCallArgument as argument, sqlStringLiteral as literal } from '../lib/sql-ast.mjs';
import { DbVerbError, dbOptions, dbAppRoot, dbSqlFiles, runDbPostgres, dbFailure, offendersError } from './db-baseline-verb.mjs';

await pg.loadModule();

// Each inventory is one read-only psql query whose rows come back as JSON (db-baseline-verb.mjs runDbPostgres).
const PRESENCE_SQL = `select
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as migrations,
  pg_catalog.to_regclass('cron.job') is not null as cron,
  pg_catalog.to_regclass('pgmq.meta') is not null as queues;`;
const INVENTORIES = {
  migrations: 'select version from supabase_migrations.schema_migrations order by version;',
  cron: 'select jobname as name, schedule, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(command, \'UTF8\')), \'hex\') as "commandHash", active from cron.job order by jobid;',
  queues: 'select queue_name as name from pgmq.meta order by queue_name;',
};
const names = (nodes) => sqlStringParts(nodes).join('.');
const OWNERSHIP_CALLS = new Set(['pgmq.create', 'pgmq.drop_queue', 'cron.schedule', 'cron.unschedule', 'cron.schedule_in_database', 'cron.alter_job']);

const parseSql = sqlParser(pg, () => { throw new DbVerbError('migration SQL could not be inventoried safely'); });

function requiredLiteral(call, index, aliases) {
  const value = literal(argument(call, index, aliases));
  if (value === null || value.length === 0) throw new DbVerbError('queue and cron ownership requires literal migration declarations');
  return value;
}

function inventoryCall(state, call) {
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

function ownershipCalls(tree) {
  const calls = [];
  walk(tree, (node) => { if (node.FuncCall && OWNERSHIP_CALLS.has(names(node.FuncCall.funcname))) calls.push(node.FuncCall); });
  return calls;
}

function flatDeclaration(tree, call) {
  const node = tree.SelectStmt ?? (tree.stmts?.length === 1 && tree.stmts[0].stmt.SelectStmt);
  const constrained = ['fromClause', 'withClause', 'whereClause', 'intoClause', 'limitCount', 'limitOffset', 'groupClause', 'havingClause', 'distinctClause', 'windowClause'];
  return node && /^SETOP_NONE$/.test(node.op) && node.targetList?.length === 1
    && !constrained.some((key) => node[key]) && node.targetList[0].ResTarget?.val?.FuncCall === call;
}

function inventoryTree(state, tree) {
  const calls = ownershipCalls(tree);
  if (!calls.length) return;
  if (calls.length !== 1 || !flatDeclaration(tree, calls[0])) throw new DbVerbError('database ownership requires one unconditional migration SELECT per declaration');
  inventoryCall(state, calls[0]);
}

function conditionalBlock(item) {
  if (item.PLpgSQL_stmt_block?.exceptions) return true;
  return Object.keys(item).some((key) => key.startsWith('PLpgSQL_stmt_')
    && !['PLpgSQL_stmt_block', 'PLpgSQL_stmt_perform', 'PLpgSQL_stmt_execsql'].includes(key)
    && !(key === 'PLpgSQL_stmt_return' && item[key].lineno === undefined));
}

/** Inventories one DO block; returns the body-relative line of each EXECUTE, whose SQL is built at run time and so never inventoried. */
function inventoryDo(state, node) {
  const option = (key) => (node.args ?? []).find((item) => item.DefElem?.defname === key)?.DefElem?.arg?.String?.sval;
  if (option('language') && option('language') !== 'plpgsql') throw new DbVerbError('database plan requires statically readable migration blocks');
  const body = option('as') ?? '';
  let delimiter = '$starci_plan$';
  while (body.includes(delimiter)) delimiter = `${delimiter.slice(0, -1)}_$`;
  let tree;
  try { tree = pg.parsePlPgSQLSync(`create function starci_plan_probe() returns void language plpgsql as ${delimiter}${body}${delimiter};`); }
  catch { throw new DbVerbError('migration block could not be inventoried safely'); }
  const statements = [];
  const dynamic = [];
  let conditional = false;
  walk(tree, (item) => {
    conditional ||= conditionalBlock(item);
    if (item.PLpgSQL_stmt_dynexecute) dynamic.push(item.PLpgSQL_stmt_dynexecute.lineno);
    if (item.PLpgSQL_expr?.parseMode === 0) statements.push(parseSql(item.PLpgSQL_expr.query));
  });
  if (conditional && statements.some((statement) => ownershipCalls(statement).length)) throw new DbVerbError('conditional migration blocks cannot prove database inventory');
  for (const statement of statements) inventoryTree(state, statement);
  return dynamic;
}

/** The 1-based line of `text` at libpg_query's byte offset `location`. */
const lineAt = (text, location) => Buffer.from(text).subarray(0, location).toString().split('\n').length;

function repositoryState(root) {
  const migrations = dbSqlFiles(root);
  const state = { migrations: new Map(migrations.map((entry) => [entry.stamp, null])), cron: new Map(), queues: new Map() };
  if (state.migrations.size !== migrations.length) throw new DbVerbError('active migrations must have unique versions');
  // Every EXECUTE of every active migration is named (file:line) before the refusal.
  const dynamic = [];
  for (const entry of migrations) {
    const text = fs.readFileSync(path.join(root, entry.file), 'utf8');
    const tree = parseSql(text);
    for (const statement of tree.stmts ?? []) {
      // Creating a function does not execute its body. Inert SQL strings never declare remote state.
      if (statement.stmt.CreateFunctionStmt) continue;
      if (!statement.stmt.DoStmt) { inventoryTree(state, statement.stmt); continue; }
      // The body opens on the line of its quote (the `as` DefElem), so a body line maps to that line plus its offset.
      const opening = lineAt(text, statement.stmt.DoStmt.args?.find((item) => item.DefElem?.defname === 'as')?.DefElem?.location ?? statement.stmt_location ?? 0);
      for (const line of inventoryDo(state, statement.stmt.DoStmt)) dynamic.push(`${entry.file}:${opening + line - 1}: EXECUTE builds its SQL at run time`);
    }
  }
  if (dynamic.length) throw offendersError('dynamic migration blocks cannot prove database inventory', dynamic);
  return state;
}

function queryRows(root, sql, urlEnv, ports) {
  const output = runDbPostgres(root, { kind: 'query', sql }, ports, urlEnv);
  let rows;
  try { rows = JSON.parse(output); } catch { throw new DbVerbError('the database returned unreadable inventory; database output was withheld'); }
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new DbVerbError('the database returned an invalid inventory; database output was withheld');
  return rows;
}

function remoteState(root, urlEnv, ports) {
  const rows = queryRows(root, PRESENCE_SQL, urlEnv, ports);
  if (rows.length !== 1 || Object.keys(INVENTORIES).some((key) => typeof rows[0][key] !== 'boolean')) throw new DbVerbError('the database returned invalid inventory availability');
  const state = {};
  for (const [key, sql] of Object.entries(INVENTORIES)) state[key] = rows[0][key] ? queryRows(root, sql, urlEnv, ports) : [];
  return state;
}

function compare(expected, actual, kind) {
  const unmatched = new Set(expected.keys());
  let unexpected = 0;
  let changed = 0;
  for (const row of actual) {
    const key = kind === 'migrations' ? row.version : row.name;
    if (key !== null && (typeof key !== 'string' || key.length === 0)) throw new DbVerbError('the database returned an invalid inventory identifier');
    if (kind === 'cron' && (typeof row.schedule !== 'string' || !/^[a-f0-9]{64}$/.test(row.commandHash ?? '') || typeof row.active !== 'boolean')) throw new DbVerbError('the database returned invalid cron metadata');
    if (!unmatched.delete(key)) unexpected += 1;
    else if (kind === 'cron') {
      const desired = expected.get(key);
      if (desired.schedule !== row.schedule || desired.commandHash !== row.commandHash || desired.active !== row.active) changed += 1;
    }
  }
  return { expected: expected.size, remote: actual.length, missing: unmatched.size, unexpected, changed };
}

/** Numeric exit codes: 0 equal, 1 drift, 2 invalid/failed; all IO and CLI calls are injectable. */
export function dbPlanMain(argv, { cwd = invocationDir(), stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text), ...ports } = {}) {
  try {
    const opts = dbOptions(argv, ['cwd', 'url-env', 'json', 'apply']);
    const root = dbAppRoot(cwd, opts);
    const expected = repositoryState(root);
    const actual = remoteState(root, opts['url-env'] ?? 'DATABASE_URL', ports);
    const summaries = Object.fromEntries(Object.keys(INVENTORIES).map((kind) => [kind, compare(expected[kind], actual[kind], kind)]));
    const drift = Object.values(summaries).some((item) => item.missing || item.unexpected || item.changed);
    // --apply is accepted for shared verb ergonomics; a plan never mutates history, queues or jobs.
    if (opts.json) stdout(`${JSON.stringify({ readOnly: true, drift, ...summaries })}\n`);
    else {
      stdout(`read-only database plan: ${drift ? 'drift detected' : 'repo and database agree'}\n`);
      for (const [kind, item] of Object.entries(summaries)) stdout(`${kind}: repo ${item.expected}, remote ${item.remote}, missing ${item.missing}, unexpected ${item.unexpected}, changed ${item.changed}\n`);
    }
    return drift ? 1 : 0;
  } catch (error) { return dbFailure('plan', error, stderr); }
}
