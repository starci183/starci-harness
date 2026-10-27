// R258: an app whose queue is BullMQ on a declared Redis may keep its own outbox beside the canon `ruleParams.db.queueOutbox` table. The
// app declares it in hfs.json `sides.be.queueOutbox` ({table, enqueue, queueParameter}), and a pg_cron tick enqueues through the declared
// `enqueue` function only while that function's active definition does nothing but write the declared table with its queue column bound
// to the declared parameter. The checker reads the declaration and the function body; it names no app table or function.
import pg from 'libpg-query';
import { sqlStringParts as strings, walkSqlAst as walk, sqlParser } from '../../lib/sql-ast.mjs';

await pg.loadModule();

const sqlTree = sqlParser(pg);
const STATEMENTS = new Set(['PLpgSQL_stmt_block', 'PLpgSQL_stmt_execsql', 'PLpgSQL_stmt_if', 'PLpgSQL_stmt_assign', 'PLpgSQL_stmt_return']);
const OTHER_DML = ['UpdateStmt', 'DeleteStmt', 'MergeStmt'];
const qualified = (name) => name.includes('.') ? name : `public.${name}`;

/** The outbox an app declares, or null: it counts only while the back end declares the redis backing the relay hands rows to. */
export function queueOutboxDeclaration(declaration) {
  const be = declaration?.sides?.be;
  const declared = be?.queueOutbox;
  if (!declared || !(be.backing ?? []).includes('redis')) return null;
  return { table: qualified(declared.table), enqueue: qualified(declared.enqueue), parameter: declared.queueParameter };
}

function plpgsqlStatements(fn, body) {
  const parameters = (fn.parameters ?? []).map((item) => item.FunctionParameter?.name).filter(Boolean).map((name) => `"${name.replaceAll('"', '""')}" text`).join(',');
  let tag = '$hfs_outbox$';
  while (body.includes(tag)) tag = `${tag.slice(0, -1)}_$`;
  let tree;
  try { tree = pg.parsePlPgSQLSync(`create function hfs_probe(${parameters}) returns text language plpgsql as ${tag}${body}${tag};`); } catch { return null; }
  const trees = [];
  let safe = true;
  walk(tree, (node) => {
    for (const key of Object.keys(node)) if (key.startsWith('PLpgSQL_stmt_') && !STATEMENTS.has(key)) safe = false;
    const expr = node.PLpgSQL_expr;
    if (expr) trees.push(sqlTree(expr.parseMode === 0 ? expr.query : `select ${expr.query}`));
  });
  return safe ? trees : null;
}

function bodyStatements(fn) {
  const option = (name) => (fn.options ?? []).find((item) => item.DefElem?.defname === name)?.DefElem?.arg;
  const language = option('language')?.String?.sval ?? 'sql';
  const body = strings(option('as')?.List?.items).join('');
  if (language === 'plpgsql') return plpgsqlStatements(fn, body);
  if (language !== 'sql') return null;
  if (fn.sql_body) return (fn.sql_body.List ? fn.sql_body.List.items : [fn.sql_body]).map((stmt) => ({ stmts: [{ stmt }] }));
  return sqlTree(body)?.stmts?.map((entry) => ({ stmts: [entry] })) ?? null;
}

/** True when the nodes hold no sub-select or other statement and call only functions `pureCall` admits. */
function pureNodes(nodes, pureCall) {
  let ok = true;
  walk(nodes, (node) => {
    if (node.SubLink || node.SelectStmt || node.InsertStmt || OTHER_DML.some((key) => node[key])) ok = false;
    if (node.FuncCall && !pureCall(node.FuncCall)) ok = false;
  });
  return ok;
}

/** `insert into <table> (..., queue, ...) values (..., <parameter>, ...) [on conflict .. do nothing] [returning ..]` with pure other values. */
function insertOk(declared, insert, pureCall) {
  if (insert.withClause || `${insert.relation?.schemaname || 'public'}.${insert.relation?.relname}` !== declared.table) return false;
  if (insert.onConflictClause && insert.onConflictClause.action !== 'ONCONFLICT_NOTHING') return false;
  const columns = (insert.cols ?? []).map((item) => item.ResTarget?.name);
  const rows = insert.selectStmt?.SelectStmt?.valuesLists ?? [];
  const values = rows.length === 1 ? rows[0].List?.items ?? [] : [];
  const at = columns.indexOf('queue');
  if (at < 0 || new Set(columns).size !== columns.length || values.length !== columns.length) return false;
  const bound = values[at].ColumnRef?.fields;
  if (!bound || strings(bound).join('.') !== declared.parameter || bound.length !== 1) return false;
  return pureNodes(values.filter((_, index) => index !== at), pureCall);
}

/** A read of the declared table with pure expressions, or an expression over variables alone. */
function readOk(declared, tree, pureCall) {
  let ok = true;
  walk(tree, (node) => {
    if (OTHER_DML.some((key) => node[key]) || node.InsertStmt || node.SelectStmt?.intoClause) ok = false;
    if (node.FuncCall && !pureCall(node.FuncCall)) ok = false;
    if (node.RangeVar && `${node.RangeVar.schemaname || 'public'}.${node.RangeVar.relname}` !== declared.table) ok = false;
  });
  return ok;
}

function statementOk(declared, tree, pureCall) {
  const stmt = tree?.stmts?.length === 1 ? tree.stmts[0].stmt : null;
  if (stmt?.InsertStmt) return insertOk(declared, stmt.InsertStmt, pureCall);
  return Boolean(stmt?.SelectStmt) && readOk(declared, tree, pureCall);
}

/**
 * The position of the queue parameter when the active definition of the declared enqueue function only writes the declared outbox
 * (inserts, reads of that table and pure expressions), or -1. `pureCall` admits a function call that does no work.
 */
export function outboxEnqueueQueueIndex(declared, entry, pureCall) {
  const fn = entry?.node;
  if (!fn) return -1;
  const index = (fn.parameters ?? []).findIndex((item) => item.FunctionParameter?.name === declared.parameter);
  const trees = bodyStatements(fn);
  if (index < 0 || !trees?.length || !trees.every((tree) => statementOk(declared, tree, pureCall))) return -1;
  const inserts = trees.filter((tree) => tree?.stmts?.[0]?.stmt?.InsertStmt).length;
  return inserts === 1 ? index : -1;
}
