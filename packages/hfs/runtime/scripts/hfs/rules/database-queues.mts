// R258: pgmq is the event bus (ruling:lite-pgmq-bus-bullmq-jobs) and jobs run on BullMQ, so the active migrations leave no pgmq queue
// for a queue constant, and every pgmq queue they leave is an event-bus topic queue named by a literal *_TOPIC_QUEUE constant under
// platform/event-bus, beside its dead-letter queue `<queue>__dead`. A topic binding names a declared queue and a literal pattern,
// and pgmq grants reach only the q_ and a_ tables of declared queues, for the application role alone.
// Initialize PostgreSQL's WASM parser at module load; the exported finder itself is synchronous.
// SQL and TypeScript ASTs keep comments, quoted identifiers and inert string literals out of the inventory.
import pg from 'libpg-query';
import { sqlStringParts as strings, walkSqlAst as walk, sqlParser, sqlCallArgument as argument, sqlStringLiteral as sqlLiteral } from '../../lib/sql-ast.mjs';
import { queueSourceFacts, queueProblem as problem } from './database-queue-sources.mjs';
import { readJson, readText } from './read.mjs';
import { DB_PGMQ_DECLARED, isActiveMigration } from './database-constants.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

await pg.loadModule();

/** The suffix of a consumer queue's dead-letter queue (templates/be/inbox/platform/event-bus DEAD_QUEUE_SUFFIX). */
const DEAD_SUFFIX = '__dead';
const TABLE_PRIVILEGES = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain'];
const sqlName = (nodes: Parsed) => strings(nodes).join('.');
const callName = (call: Parsed) => sqlName(call.funcname);

const sqlTree = sqlParser(pg);
const walkExecutable = (tree: Parsed, visit: Parsed) => walk(tree, visit, true);

function callsOf(tree: Parsed) {
  const calls: Parsed[] = [];
  walkExecutable(tree, (node: Parsed) => { if (node.FuncCall) calls.push(node.FuncCall); });
  return calls;
}

function inspectCalls(state: Parsed, tree: Parsed, file: string, migration: Parsed) {
  walkExecutable(tree, (node: Parsed) => {
    if (node.GrantStmt || node.AlterDefaultPrivilegesStmt) recordGrant(state, node, file, migration);
  });
  for (const call of callsOf(tree)) {
    inspectQueueCall(state, call, file, migration);
    inspectBindingCall(state, call, file, migration);
    recordSchedule(state, call, migration);
  }
}

function inspectQueueCall(state: Parsed, call: Parsed, file: string, migration: Parsed) {
  const name = callName(call);
  if (name !== 'pgmq.create' && name !== 'pgmq.drop_queue') return;
  const queue = sqlLiteral(argument(call, 0, ['queue_name']));
  if (name === 'pgmq.create') {
    if (!migration || queue === null) problem(state, DB_PGMQ_DECLARED, file, 'pgmq.create must declare a literal queue in an active migration');
    else state.created.set(queue, file);
  } else if (migration && queue !== null) {
    state.created.delete(queue);
    state.queueAcls.delete(`pgmq.q_${queue}`);
    state.queueAcls.delete(`pgmq.a_${queue}`);
  }
}

/** A topic binding routes the events of a name to a consumer group's queue: both literal, in an active migration, the queue declared. */
function inspectBindingCall(state: Parsed, call: Parsed, file: string, migration: Parsed) {
  const name = callName(call);
  if (name !== 'pgmq.bind_topic' && name !== 'pgmq.unbind_topic') return;
  const pattern = sqlLiteral(argument(call, 0, ['pattern']));
  const queue = sqlLiteral(argument(call, 1, ['queue_name']));
  if (!migration || pattern === null || queue === null) problem(state, DB_PGMQ_DECLARED, file, `${name} must name a literal pattern and queue in an active migration`);
  else if (name === 'pgmq.bind_topic' && !state.created.has(queue)) problem(state, DB_PGMQ_DECLARED, file, `pgmq.bind_topic binds ${queue}, which no earlier pgmq.create declares`);
}

/**
 * The pg_cron jobs an archived chain still schedules, which `starci app db baseline` carries over. pg_cron is not an allowed extension
 * (R259), so no rule judges them here.
 */
function recordSchedule(state: Parsed, call: Parsed, migration: Parsed) {
  if (!migration) return;
  const name = callName(call);
  const job = sqlLiteral(argument(call, 0, ['job_name']));
  if (job === null) return;
  if (name === 'cron.unschedule') state.activeCron.delete(job);
  if (name !== 'cron.schedule') return;
  const schedule = sqlLiteral(argument(call, 1, ['schedule']));
  const command = sqlLiteral(argument(call, 2, ['command']));
  if (schedule !== null && command !== null) state.activeCron.set(job, { name: job, schedule, command });
}

function plpgsqlTree(body: Parsed, parameters: Parsed[] = []) {
  let tag = '$hfs_queue$';
  while (body.includes(tag)) tag = `${tag.slice(0, -1)}_$`;
  const args = parameters.map((item) => item.FunctionParameter?.name).filter(Boolean).map((name) => `"${name.replaceAll('"', '""')}" text`).join(',');
  try { return pg.parsePlPgSQLSync(`create function hfs_probe(${args}) returns void language plpgsql as ${tag}${body}${tag};`); } catch { return null; }
}

function dynamicOwnership(state: Parsed, expression: Parsed, file: string, migration: Parsed) {
  const fragments: Parsed[] = [];
  walk(expression, (node: Parsed) => {
    const literal = node.A_Const?.sval?.sval ?? null;
    if (literal !== null) fragments.push(literal);
  });
  for (const sql of [...fragments, fragments.join('')]) {
    const tree = sqlTree(sql.replace(/%[ILs]/g, 'NULL'));
    walkExecutable(tree, (node: Parsed) => { if (node.GrantStmt || node.AlterDefaultPrivilegesStmt) recordGrant(state, node, file, migration); });
    for (const call of callsOf(tree)) {
      if (['pgmq.create', 'pgmq.bind_topic'].includes(callName(call))) problem(state, DB_PGMQ_DECLARED, file, 'dynamic SQL cannot own a queue declaration or binding; write the call as static migration SQL');
    }
  }
}

function inspectDo(state: Parsed, node: Parsed, file: string) {
  const option = (key: string) => (node.args ?? []).find((item: Parsed) => item.DefElem?.defname === key)?.DefElem?.arg?.String?.sval;
  const tree = plpgsqlTree(option('as') ?? '');
  walk(tree, (item: Parsed) => {
    if (item.PLpgSQL_expr?.parseMode === 0) inspectCalls(state, sqlTree(item.PLpgSQL_expr.query), file, true);
    if (item.PLpgSQL_stmt_dynexecute) {
      const expression = sqlTree(`select ${item.PLpgSQL_stmt_dynexecute.query?.PLpgSQL_expr?.query ?? ''}`);
      dynamicOwnership(state, expression, file, true);
    }
  });
}

function grantCheck(state: Parsed, node: Parsed, file: string) {
  const defaults = node.AlterDefaultPrivilegesStmt;
  const grant = node.GrantStmt ?? defaults?.action;
  if (!grant?.is_grant) return;
  const schemaNames = defaults?.options?.flatMap((item: Parsed) => item.DefElem?.defname === 'schemas' ? strings(item.DefElem.arg?.List?.items) : []) ?? [];
  const objects = (grant.objects ?? []).map((item: Parsed) => item.RangeVar ? `${item.RangeVar.schemaname}.${item.RangeVar.relname}` : sqlName(item.ObjectWithArgs?.objname ?? item.List?.items ?? [item]));
  if (![...schemaNames, ...objects].some((name) => /^(?:pgmq|pgmq_public)(?:\.|$)/.test(name))) return;
  const roles = (grant.grantees ?? []).map((item: Parsed) => item.RoleSpec?.roletype === 'ROLESPEC_PUBLIC' ? 'public' : item.RoleSpec?.rolename);
  const ownedTables = !defaults && grant.targtype === 'ACL_TARGET_OBJECT' && grant.objtype === 'OBJECT_TABLE'
    && objects.every((name: string) => /^pgmq\.[qa]_/.test(name) && state.created.has(name.slice(7)));
  if (!ownedTables || roles.length === 0 || roles.some((role: Parsed) => role !== state.appRole)) problem(state, DB_PGMQ_DECLARED, file, `pgmq grants name only q_<queue> and a_<queue> tables of declared queues, and only the ${state.appRole} role`);
}

function recordGrant(state: Parsed, node: Parsed, file: string, executed: Parsed) {
  state.grants.push({ node, file, created: new Map(state.created), executed });
  const grant = node.GrantStmt;
  if (!executed || grant?.objtype !== 'OBJECT_TABLE' || grant.targtype !== 'ACL_TARGET_OBJECT') return;
  if (!(grant.grantees ?? []).some((item: Parsed) => item.RoleSpec?.rolename === state.appRole)) return;
  const privileges = grant.privileges?.map((item: Parsed) => item.AccessPriv?.priv_name).filter(Boolean) ?? TABLE_PRIVILEGES;
  for (const object of grant.objects ?? []) {
    const table = object.RangeVar && `${object.RangeVar.schemaname}.${object.RangeVar.relname}`;
    if (!table || !/^pgmq\.[qa]_/.test(table)) continue;
    const acl = state.queueAcls.get(table) ?? new Map();
    for (const privilege of privileges) updateQueuePrivilege(acl, grant, privilege);
    state.queueAcls.set(table, acl);
  }
}

function updateQueuePrivilege(acl: Parsed, grant: Parsed, privilege: Parsed) {
  if (grant.is_grant) acl.set(privilege, Boolean(grant.grant_option || acl.get(privilege)));
  else if (!grant.grant_option) acl.delete(privilege);
  else if (acl.has(privilege)) acl.set(privilege, false);
}

function functionBody(fn: Parsed) {
  const option = (name: string) => (fn.options ?? []).find((item: Parsed) => item.DefElem?.defname === name)?.DefElem?.arg;
  return { body: strings(option('as')?.List?.items).join(''), language: option('language')?.String?.sval ?? 'sql' };
}

function inspectFunctionDeclarations(state: Parsed, fn: Parsed, file: string) {
  const { body, language } = functionBody(fn);
  if (language === 'sql') {
    inspectCalls(state, sqlTree(body), file, false);
    inspectCalls(state, fn.sql_body, file, false);
  }
  if (language === 'plpgsql') {
    walk(plpgsqlTree(body, fn.parameters), (node: Parsed) => {
      if (node.PLpgSQL_expr?.parseMode === 0) inspectCalls(state, sqlTree(node.PLpgSQL_expr.query), file, false);
      if (node.PLpgSQL_stmt_dynexecute) dynamicOwnership(state, sqlTree(`select ${node.PLpgSQL_stmt_dynexecute.query?.PLpgSQL_expr?.query ?? ''}`), file, false);
    });
  }
}

function migrationStatement(state: Parsed, node: Parsed, file: string) {
  if (node.CreateFunctionStmt) inspectFunctionDeclarations(state, node.CreateFunctionStmt, file);
  if (node.DoStmt) inspectDo(state, node.DoStmt, file);
}

function migrationFacts(state: Parsed, files: string[]) {
  for (const file of files.filter((item: Parsed) => item.endsWith('.sql') && !item.startsWith('db/migrations/archive/')).sort((left: Parsed, right: Parsed) => left.localeCompare(right))) {
    const text = readText(state.repoRoot, file);
    if (text === null) continue;
    const tree = sqlTree(text);
    const active = isActiveMigration(file);
    for (const entry of tree?.stmts ?? []) {
      inspectCalls(state, { stmts: [entry] }, file, active);
      if (active) migrationStatement(state, entry.stmt, file);
    }
  }
}

function queueState({ repoRoot, files = [], all = files, repo = {} }: { repoRoot: string; files?: string[]; all?: string[]; repo?: Repo }) {
  const paths = [...new Set(all)];
  const declaration = readJson(repoRoot, 'hfs.json') ?? repo;
  if (repo.edition !== 'lite' && declaration.edition !== 'lite' && !paths.some((file) => file.startsWith('db/'))) return null;
  const state = { repoRoot, appRole: declaration.db?.appRole ?? 'app_be', findings: [], constants: new Map(), topics: new Map(), created: new Map(), activeCron: new Map(), grants: [], queueAcls: new Map() };
  queueSourceFacts(state, paths, inspectCalls);
  migrationFacts(state, paths);
  return state;
}

function validateQueues(state: Parsed, inScope: (file: string) => boolean) {
  for (const [queue, file] of state.created) {
    if (queue.endsWith(DEAD_SUFFIX) && state.topics.has(queue.slice(0, -DEAD_SUFFIX.length))) continue;
    if (state.constants.has(queue)) problem(state, DB_PGMQ_DECLARED, file, `pgmq queue ${queue} is the queue constant of ${state.constants.get(queue)}, and jobs run on BullMQ (ruling:lite-pgmq-bus-bullmq-jobs): drop it with pgmq.drop_queue in a later migration`);
    else if (!state.topics.has(queue)) problem(state, DB_PGMQ_DECLARED, file, `pgmq queue ${queue} has no event-bus owner: name it in a literal *_TOPIC_QUEUE constant under platform/event-bus, or drop it with pgmq.drop_queue in a later migration`);
  }
  for (const [topic, file] of state.topics) {
    if (!state.created.has(topic)) problem(state, DB_PGMQ_DECLARED, file, `event-bus topic queue ${topic} has no pgmq.create in an active migration`);
    else if (!state.created.has(`${topic}${DEAD_SUFFIX}`)) problem(state, DB_PGMQ_DECLARED, file, `event-bus topic queue ${topic} has no dead-letter queue: pgmq.create('${topic}${DEAD_SUFFIX}') in an active migration`);
  }
  for (const { node, file, created, executed } of state.grants) grantCheck({ ...state, created: executed ? created : state.created }, node, file);
  return state.findings.filter((finding: Parsed) => inScope(finding.path));
}

/** Cross-file R258 findings. A full app participates when it contains a db/ tree. */
export function databaseQueuesFindings(context: Parsed) {
  // The app-root pass owns the cross-file inventory; a side pass cannot see its migrations.
  if (context.appSide === true) return [];
  const state = queueState(context);
  return state ? validateQueues(state, context.inScope ?? (() => true)) : [];
}

/** Migration-owned operational metadata for a baseline; callers refuse a cutover when findings are present. */
export function databaseQueueDeclarations(context: Parsed) {
  const state = queueState(context);
  if (!state) return { queues: [], cron: [], grants: [], findings: [] };
  return {
    queues: [...state.created.keys()].sort((left, right) => left.localeCompare(right)),
    cron: [...state.activeCron.values()].sort((left, right) => left.name.localeCompare(right.name)),
    grants: queueGrantDeclarations(state),
    findings: validateQueues(state, () => true),
  };
}

function queueGrantDeclarations(state: Parsed) {
  const grants = [];
  for (const [table, acl] of state.queueAcls) {
    if (!state.created.has(table.slice(7))) continue;
    for (const grantOption of [false, true]) {
      let privileges = [...acl].filter(([, option]) => option === grantOption).map(([privilege]) => privilege);
      if (!privileges.length) continue;
      if (TABLE_PRIVILEGES.every((privilege) => privileges.includes(privilege))) privileges = ['all'];
      grants.push({ privileges, tables: [table], roles: [state.appRole], grantOption });
    }
  }
  return grants;
}
