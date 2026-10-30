// PostgreSQL AST extraction and the migration-local checks DB_RLS_REQUIRED, DB_POLICY_SHAPE and
// DB_STORAGE_POLICY. PL/pgSQL inspection lives in database-plpgsql.mjs to keep every rule module bounded.
import { found } from './read.mjs';
import { parseSql } from '../sql/pg-parse.mjs';
import { plpgsqlFindings } from './database-plpgsql.mjs';
import { transactionControlFindings } from './database-transaction.mjs';
import { DB_MIGRATION_SHAPE, DB_POLICY_SHAPE, DB_RLS_REQUIRED, DB_STORAGE_POLICY } from './database-constants.mjs';
import type { Finding, Parsed } from './rule-types.mjs';
const POLICY_ACTIONS = ['select', 'insert', 'update', 'delete', 'all'];
const WRITE_COMMANDS = new Set(['all', 'insert', 'update', 'delete']);
const PUBLIC_READ_SUFFIX = '_public_read';

const sval = (node: Parsed) => node?.String?.sval;
const nameOf = (list: Parsed) => (list ?? []).map(sval).filter((part: Parsed) => part !== undefined).join('.');
const schemaOf = (relation: Parsed, defaultSchema = 'public') => relation?.schemaname ?? defaultSchema;
const roleOf = (roleSpec: Parsed) => (roleSpec?.RoleSpec?.roletype === 'ROLESPEC_PUBLIC' ? 'public' : roleSpec?.RoleSpec?.rolename ?? null);
const isTrue = (expression: Parsed) => expression?.A_Const?.boolval?.boolval === true;
const asBool = (expression: Parsed) => (expression?.A_Const?.boolval === undefined ? null : expression.A_Const.boolval.boolval === true);
const asString = (expression: Parsed) => expression?.A_Const?.sval?.sval;
const isNull = (expression: Parsed) => expression?.A_Const?.isnull === true;

function lineIndexOf(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  const starts = [0];
  for (let index = 0; index < bytes.length; index += 1) if (bytes[index] === 0x0a) starts.push(index + 1);
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

function statementList(stmts: Parsed, lineAt: Parsed) {
  return (stmts ?? []).map((entry: Parsed, index: number) => {
    const type = Object.keys(entry.stmt ?? {})[0] ?? '';
    const node = entry.stmt?.[type] ?? {};
    const nodeOffset = Math.max(node.location ?? 0, 0);
    const offset = entry.stmt_location >= 0 ? entry.stmt_location : nodeOffset;
    return { type, node, index, line: lineAt(offset) };
  });
}

/** Whether a function SET option pins search_path to literal values rather than FROM CURRENT. */
function isSearchPathSet(element: Parsed) {
  const value = element?.arg?.VariableSetStmt;
  return element?.defname === 'set' && value?.name === 'search_path' && value?.kind === 'VAR_SET_VALUE'
    && (value.args ?? []).length > 0
    && value.args.every((argument: Parsed) => argument?.A_Const?.sval !== undefined || argument?.A_Const?.isnull === true);
}

function searchPathSchema(node: Parsed, current: Parsed) {
  if (node.name !== 'search_path') return current;
  if (node.kind === 'VAR_RESET') return 'public';
  if (node.kind !== 'VAR_SET_VALUE') return current;
  const schemas = (node.args ?? []).map((argument: Parsed) => argument?.A_Const?.sval?.sval).filter((value: Parsed) => typeof value === 'string');
  return schemas.find((schema: Parsed) => schema && schema !== '$user') ?? 'public';
}

function addTableFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const relation = statement.type === 'CreateStmt' ? node.relation : node.into?.rel;
  if (!relation || node.partbound || relation.relpersistence === 't') return;
  if (node.objtype === ['OBJECT', 'MATVIEW'].join('_')) {
    facts.views.push({ ...relationFact(statement, relation, defaultSchema), kind: 'materialized', securityInvoker: false, node });
    return;
  }
  facts.tables.push({ schema: schemaOf(relation, defaultSchema), name: relation.relname, index: statement.index, line: statement.line });
}

const relationFact = (statement: Parsed, relation: Parsed, defaultSchema: Parsed) => ({
  schema: schemaOf(relation, defaultSchema), name: relation?.relname, index: statement.index, line: statement.line,
});

const rlsCommands = new Map([
  ['AT_EnableRowSecurity', { enabled: true }], ['AT_DisableRowSecurity', { enabled: false }],
  ['AT_ForceRowSecurity', { forced: true }], ['AT_NoForceRowSecurity', { forced: false }],
]);

function addAlterTableFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  for (const command of node.cmds ?? []) {
    const alteration = command?.AlterTableCmd;
    const subtype = alteration?.subtype;
    const item = relationFact(statement, node.relation, defaultSchema);
    if (subtype === 'AT_EnableRowSecurity') facts.enables.push(item);
    else if (subtype === 'AT_ForceRowSecurity') facts.forces.push(item);
    const event = rlsCommands.get(subtype);
    if (event) facts.rlsEvents.push({ ...item, ...event });
    if (subtype === 'AT_ChangeOwner') facts.owners.push({ ...item, role: alteration.newowner?.rolename });
  }
}

function addViewFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const security = (node.options ?? []).find((option: Parsed) => option?.DefElem?.defname === 'security_invoker')?.DefElem?.arg;
  const securityInvoker = security?.Boolean?.boolval === true || security?.String?.sval === 'true';
  facts.views.push({ ...relationFact(statement, node.view, defaultSchema), kind: 'view', securityInvoker, node });
}

function addSchemaMoveFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  if (!node.relation) return;
  const item = relationFact(statement, node.relation, defaultSchema);
  facts.schemaMoves.push({ ...item, fromSchema: item.schema, schema: node.newschema, objtype: node.objectType });
}

function addRoleFacts(statement: Parsed, node: Parsed, facts: Parsed) {
  const kind = statement.type === 'CreateRoleStmt' ? 'create' : 'alter';
  const name = typeof node.role === 'string' ? node.role : node.role?.rolename;
  facts.roles.push({ kind, name, options: node.options ?? [], node, index: statement.index, line: statement.line });
}

function addDropRoleFacts(statement: Parsed, node: Parsed, facts: Parsed) {
  for (const role of node.roles ?? []) facts.roles.push({ kind: 'drop', name: roleOf(role), options: [], node, index: statement.index, line: statement.line });
}

function addRoleGrantFacts(statement: Parsed, node: Parsed, facts: Parsed) {
  facts.roleGrants.push({ node, index: statement.index, line: statement.line });
}

function addPublicationFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const tables = (node.pubobjects ?? []).flatMap((object: Parsed) => {
    const relation = object?.PublicationObjSpec?.pubtable?.relation;
    return relation ? [{ schema: schemaOf(relation, defaultSchema), name: relation.relname }] : [];
  });
  facts.publications.push({ name: node.pubname, action: node.action, allTables: node.for_all_tables === true, tables, node, index: statement.index, line: statement.line });
}

function addCreatePolicyFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const policy = {
    name: node.policy_name,
    schema: schemaOf(node.table, defaultSchema),
    table: node.table?.relname,
    cmd: String(node.cmd_name ?? 'all').toLowerCase(),
    roles: node.roles?.length ? node.roles.map(roleOf) : ['public'],
    implicitPublic: (node.roles ?? []).some((role: Parsed) => role?.RoleSpec?.roletype === 'ROLESPEC_PUBLIC' && role.RoleSpec.location === -1),
    qual: node.qual,
    withCheck: node.with_check,
    index: statement.index,
    line: statement.line,
  };
  facts.policies.push(policy);
  facts.policyEvents.push({ kind: 'create', policy, index: statement.index });
}

function addAlterPolicyFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  facts.policyEvents.push({
    kind: 'alter',
    schema: schemaOf(node.table, defaultSchema),
    table: node.table?.relname,
    name: node.policy_name,
    ...(node.roles !== undefined ? {
      roles: node.roles.map(roleOf),
      implicitPublic: node.roles.some((role: Parsed) => role?.RoleSpec?.roletype === 'ROLESPEC_PUBLIC' && role.RoleSpec.location === -1),
    } : {}),
    ...(node.qual !== undefined ? { qual: node.qual } : {}),
    ...(node.with_check !== undefined ? { withCheck: node.with_check } : {}),
    index: statement.index,
    line: statement.line,
  });
}

function addDropPolicyFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  if (node.removeType !== 'OBJECT_POLICY') return;
  for (const object of node.objects ?? []) {
    const parts = object?.List?.items?.map(sval).filter(Boolean) ?? [];
    const [schema, table, name] = parts.length === 3 ? parts : [defaultSchema, ...parts];
    facts.policyEvents.push({ kind: 'drop', schema, table, name, index: statement.index });
  }
}

function addGrantFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  facts.grants.push({
    grant: node.is_grant === true,
    targtype: node.targtype,
    objtype: node.objtype,
    objects: node.objects ?? [],
    privileges: (node.privileges ?? []).map((privilege: Parsed) => String(privilege?.AccessPriv?.priv_name ?? '').toLowerCase()),
    all: (node.privileges ?? []).length === 0,
    grantees: (node.grantees ?? []).map(roleOf),
    defaultSchema,
    index: statement.index,
    line: statement.line,
  });
}

function addDefaultPrivilegeFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const action = node.action ?? {};
  const schemas = (node.options ?? []).find((option: Parsed) => option?.DefElem?.defname === 'schemas')?.DefElem?.arg?.List?.items;
  facts.defaultPrivileges.push({
    grant: action.is_grant === true,
    objtype: action.objtype,
    privileges: (action.privileges ?? []).map((privilege: Parsed) => String(privilege?.AccessPriv?.priv_name ?? '').toLowerCase()),
    all: (action.privileges ?? []).length === 0,
    grantees: (action.grantees ?? []).map(roleOf),
    schemas: (schemas ?? []).map(sval).filter(Boolean),
    defaultSchema,
    index: statement.index,
    line: statement.line,
  });
}

function addCreateFunctionFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const parts = (node.funcname ?? []).map(sval).filter(Boolean);
  const schema = parts.length > 1 ? parts[0] : defaultSchema;
  facts.functions.push({ node, name: parts.length > 1 ? parts.join('.') : `${schema}.${parts[0]}`, schema, index: statement.index, line: statement.line });
}

function addAlterFunctionFacts(statement: Parsed, node: Parsed, facts: Parsed, defaultSchema: Parsed) {
  const rawName = nameOf(node.func?.objname);
  const name = rawName.includes('.') ? rawName : `${defaultSchema}.${rawName}`;
  const securityDefiner = (node.actions ?? []).some((action: Parsed) => action?.DefElem?.defname === 'security' && action?.DefElem?.arg?.Boolean?.boolval === true);
  facts.alterFunctions.push({ name, schema: name.split('.')[0], node, securityDefiner, setsPath: (node.actions ?? []).some((action: Parsed) => isSearchPathSet(action?.DefElem)), index: statement.index, line: statement.line });
}

function addDoBlockFacts(statement: Parsed, node: Parsed, facts: Parsed) {
  const option = (key: string) => (node.args ?? []).find((argument: Parsed) => argument?.DefElem?.defname === key)?.DefElem?.arg;
  facts.doBlocks.push({ body: option('as')?.String?.sval, language: option('language')?.String?.sval ?? 'plpgsql', index: statement.index, line: statement.line });
}

function addBucketInsertFacts(statement: Parsed, node: Parsed, facts: Parsed) {
  if (node.relation?.schemaname === 'storage' && node.relation?.relname === 'buckets') facts.buckets.push({ node, index: statement.index, line: statement.line });
}

function addBucketCallFacts(statement: Parsed, node: Parsed, facts: Parsed) {
  for (const target of node.targetList ?? []) {
    const call = target?.ResTarget?.val?.FuncCall;
    if (call && nameOf(call.funcname).toLowerCase() === 'storage.create_bucket') facts.bucketCalls.push({ node: call, index: statement.index, line: statement.line });
  }
}

const statementFactHandlers = new Map([
  ['VariableSetStmt', (_statement: Parsed, node: Parsed, _facts: Parsed, defaultSchema: Parsed) => searchPathSchema(node, defaultSchema)],
  ['CreateStmt', addTableFacts], ['CreateTableAsStmt', addTableFacts], ['AlterTableStmt', addAlterTableFacts],
  ['ViewStmt', addViewFacts], ['AlterObjectSchemaStmt', addSchemaMoveFacts],
  ['CreateRoleStmt', addRoleFacts], ['AlterRoleStmt', addRoleFacts], ['DropRoleStmt', addDropRoleFacts],
  ['GrantRoleStmt', addRoleGrantFacts], ['CreatePublicationStmt', addPublicationFacts], ['AlterPublicationStmt', addPublicationFacts],
  ['CreatePolicyStmt', addCreatePolicyFacts], ['AlterPolicyStmt', addAlterPolicyFacts], ['DropStmt', addDropPolicyFacts],
  ['GrantStmt', addGrantFacts], ['AlterDefaultPrivilegesStmt', addDefaultPrivilegeFacts], ['CreateFunctionStmt', addCreateFunctionFacts],
  ['AlterFunctionStmt', addAlterFunctionFacts], ['DoStmt', addDoBlockFacts], ['InsertStmt', addBucketInsertFacts], ['SelectStmt', addBucketCallFacts],
]);

/** Fold each statement to the facts consumed by the rule checks. */
function factsOf(statements: Parsed) {
  const facts: Record<string, Parsed> = {
    tables: [], enables: [], forces: [], policies: [], policyEvents: [], grants: [], defaultPrivileges: [],
    functions: [], alterFunctions: [], doBlocks: [], buckets: [], bucketCalls: [], isSearchPathSet,
    statements: [], views: [], rlsEvents: [], owners: [], schemaMoves: [], roles: [], roleGrants: [], publications: [],
  };
  let defaultSchema = 'public';
  for (const statement of statements) {
    facts.statements.push({ ...statement, defaultSchema });
    const { node } = statement;
    const handler = statementFactHandlers.get(statement.type);
    if (handler) defaultSchema = handler(statement, node, facts, defaultSchema) ?? defaultSchema;
  }
  return facts;
}

function relationHasLaterEvent(events: Parsed, table: Parsed) {
  return events.some((event: Parsed) => event.schema === table.schema && event.name === table.name && event.index > table.index);
}

function rlsWeakeningFindings(file: string, events: Parsed, exposed: Parsed) {
  const findings = [];
  for (const event of events) {
    if (!exposed.has(event.schema) || (event.enabled !== false && event.forced !== false)) continue;
    const qualified = `${event.schema}.${event.name}`;
    const operation = event.enabled === false ? 'disables row level security' : 'removes forced row level security';
    findings.push(found(DB_RLS_REQUIRED, file, `${file}:${event.line} ${operation} on ${qualified} in the exposed schema ${event.schema}`, { line: event.line, table: qualified }));
  }
  return findings;
}

function rlsFindings(file: string, facts: Parsed, exposed: Parsed, forceRls: Parsed) {
  const movedTables = facts.schemaMoves.filter((move: Parsed) => move.objtype === 'OBJECT_TABLE').map((move: Parsed) => ({ ...move, moved: true }));
  const targets = [...facts.tables, ...movedTables];
  const findings = [];
  for (const table of targets) {
    if (!exposed.has(table.schema)) continue;
    const qualified = `${table.schema}.${table.name}`;
    const operation = table.moved ? 'moves' : 'creates';
    if (!relationHasLaterEvent(facts.enables, table)) {
      findings.push(found(DB_RLS_REQUIRED, file, `${file}:${table.line} ${operation} ${qualified} into the exposed schema ${table.schema} without a later \`alter table ${qualified} enable row level security\` in the same migration`, { line: table.line, table: qualified }));
    }
    if (forceRls.has(qualified) && !relationHasLaterEvent(facts.forces, table)) {
      findings.push(found(DB_RLS_REQUIRED, file, `${file}:${table.line} ${operation} ${qualified}, which hfs.json db.forceRls declares definer-owned, without \`alter table ${qualified} force row level security\` in the same migration`, { line: table.line, table: qualified }));
    }
  }
  findings.push(...rlsWeakeningFindings(file, facts.rlsEvents, exposed));
  return findings;
}

function policyNameFindings(file: string, policy: Parsed, qualified: Parsed) {
  const findings = [];
  if (policy.name === undefined || !policy.name.startsWith(`${policy.table}_`)) {
    findings.push(found(DB_POLICY_SHAPE, file, `${file}:${policy.line} policy ${JSON.stringify(policy.name)} on ${qualified} is not named <table>_<role>_<action>`, { line: policy.line, policy: policy.name }));
  } else {
    const tail = policy.name.slice(policy.table.length + 1);
    if (tail !== 'public_read' && !new RegExp(`^[a-z][a-z0-9_]*_(${POLICY_ACTIONS.join('|')})$`).test(tail)) {
      findings.push(found(DB_POLICY_SHAPE, file, `${file}:${policy.line} policy ${policy.name} on ${qualified} is not named <table>_<role>_<action>`, { line: policy.line, policy: policy.name }));
    }
  }
  return findings;
}

function policyAccessFindings(file: string, policy: Parsed, qualified: Parsed) {
  const findings = [];
  const publicRead = typeof policy.name === 'string' && policy.name.endsWith(PUBLIC_READ_SUFFIX);
  if (WRITE_COMMANDS.has(policy.cmd) && isTrue(policy.qual)) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${policy.line} policy ${policy.name} on ${qualified} is FOR ${policy.cmd.toUpperCase()} with USING (true)`, { line: policy.line, policy: policy.name }));
  if (WRITE_COMMANDS.has(policy.cmd) && isTrue(policy.withCheck)) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${policy.line} policy ${policy.name} on ${qualified} is FOR ${policy.cmd.toUpperCase()} with WITH CHECK (true)`, { line: policy.line, policy: policy.name }));
  if (policy.cmd === 'select' && isTrue(policy.qual) && !publicRead) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${policy.line} policy ${policy.name} on ${qualified} is FOR SELECT with USING (true); a world-readable table declares it with *_public_read`, { line: policy.line, policy: policy.name }));
  if ((policy.roles.includes('anon') || policy.roles.includes('public')) && !(policy.cmd === 'select' && publicRead)) {
    const roleName = policy.roles.includes('anon') ? 'anon' : 'public';
    const role = policy.implicitPublic ? 'the implicit TO public default' : `TO ${roleName}`;
    findings.push(found(DB_POLICY_SHAPE, file, `${file}:${policy.line} policy ${policy.name} on ${qualified} reaches ${role}; anonymous access is only FOR SELECT with *_public_read`, { line: policy.line, policy: policy.name }));
  }
  return findings;
}

function grantPolicyFindings(file: string, grant: Parsed) {
  const findings: Finding[] = [];
  if (!grant.grant) return findings;
  if (grant.grantees.includes('service_role')) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${grant.line} grants to service_role; the service role bypasses RLS and is never granted`, { line: grant.line }));
  const broadRole = grant.grantees.find((role: Parsed) => ['anon', 'authenticated', 'public'].includes(role));
  if (grant.targtype === 'ACL_TARGET_ALL_IN_SCHEMA' && grant.objtype === 'OBJECT_TABLE' && broadRole) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${grant.line} grants on all tables in a schema to ${broadRole}; table privileges are declared per table beside the matching policies`, { line: grant.line, role: broadRole }));
  return findings;
}

function defaultPrivilegeFindings(file: string, defaults: Parsed) {
  const findings: Finding[] = [];
  if (!defaults.grant) return findings;
  if (defaults.grantees.includes('service_role')) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${defaults.line} grants default privileges to service_role; the service role bypasses RLS and is never granted`, { line: defaults.line }));
  const broadRole = defaults.grantees.find((role: Parsed) => ['anon', 'public'].includes(role));
  if (defaults.objtype === 'OBJECT_TABLE' && broadRole) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${defaults.line} alters default table privileges for ${broadRole}; anonymous grants are explicit per table beside *_public_read policies`, { line: defaults.line, role: broadRole }));
  return findings;
}

function localPolicyFindings(file: string, facts: Parsed) {
  const findings = [];
  for (const policy of facts.policies) {
    const qualified = `${policy.schema}.${policy.table}`;
    findings.push(...policyNameFindings(file, policy, qualified), ...policyAccessFindings(file, policy, qualified));
  }
  for (const grant of facts.grants) {
    findings.push(...grantPolicyFindings(file, grant));
  }
  for (const defaults of facts.defaultPrivileges) findings.push(...defaultPrivilegeFindings(file, defaults));
  return findings;
}

const policyKey = (policy: Parsed) => `${policy.schema}\0${policy.table}\0${policy.name}`;

function applyPolicyEvent(policies: Parsed, event: Parsed) {
  const key = policyKey(event.kind === 'create' ? event.policy : event);
  if (event.kind === 'create') policies.set(key, event.policy);
  else if (event.kind === 'drop') policies.delete(key);
  else if (policies.has(key)) policies.set(key, { ...policies.get(key), ...event });
}

function policiesAfterMigrations(analyses: Parsed) {
  const policies = new Map();
  for (const { facts } of analyses) {
    for (const event of [...facts.policyEvents].sort((left, right) => left.index - right.index)) applyPolicyEvent(policies, event);
  }
  return [...policies.values()];
}

function anonymousTableGrant(grant: Parsed) {
  if (!grant.grant || grant.targtype !== 'ACL_TARGET_OBJECT' || grant.objtype !== 'OBJECT_TABLE') return false;
  return grant.grantees.includes('anon') || grant.grantees.includes('public');
}

function publicReadPolicyCovers(finalPolicies: Parsed, schema: Parsed, table: Parsed) {
  return finalPolicies.some((policy: Parsed) => policy.schema === schema && policy.table === table && policy.cmd === 'select'
    && typeof policy.name === 'string' && policy.name.endsWith(PUBLIC_READ_SUFFIX)
    && (policy.roles.includes('anon') || policy.roles.includes('public')));
}

function anonymousGrantFindings(file: string, grant: Parsed, finalPolicies: Parsed) {
  if (!anonymousTableGrant(grant)) return [];
  const findings = [];
  for (const object of grant.objects) {
    const relation = object?.RangeVar;
    if (!relation) continue;
    const schema = schemaOf(relation, grant.defaultSchema);
    const table = relation.relname;
    if (!publicReadPolicyCovers(finalPolicies, schema, table)) findings.push(found(DB_POLICY_SHAPE, file, `${file}:${grant.line} grants an anonymous role on ${schema}.${table} but the migration set ends without a *_public_read FOR SELECT policy`, { line: grant.line, table: `${schema}.${table}` }));
  }
  return findings;
}

/** Anonymous table grants are covered by the final policy state across the ordered migration set. */
export function migrationSetPolicyFindings(analyses: Parsed) {
  const finalPolicies = policiesAfterMigrations(analyses);
  const findings = [];
  for (const { file, facts } of analyses) {
    for (const grant of facts.grants) findings.push(...anonymousGrantFindings(file, grant, finalPolicies));
  }
  return findings;
}

const valueRows = (node: Parsed) => (node.selectStmt?.SelectStmt?.valuesLists ?? []).map((list: Parsed) => list?.List?.items ?? []);
const unwrap = (expression: Parsed): Parsed => expression?.TypeCast ? unwrap(expression.TypeCast.arg) : expression;
const columnName = (expression: Parsed) => unwrap(expression)?.ColumnRef?.fields?.map(sval).findLast(Boolean);
const literalString = (expression: Parsed) => asString(unwrap(expression));

function operationScopesBucket(operation: Parsed, bucket: Parsed) {
  const operator = operation.name?.map(sval).filter(Boolean).join('');
  if (operator === '=' && ((columnName(operation.lexpr) === 'bucket_id' && literalString(operation.rexpr) === bucket)
    || (columnName(operation.rexpr) === 'bucket_id' && literalString(operation.lexpr) === bucket))) return true;
  return operation.kind === 'AEXPR_IN' && columnName(operation.lexpr) === 'bucket_id'
    && (operation.rexpr ?? []).some((item: Parsed) => literalString(item) === bucket);
}

function expressionScopesBucket(expression: Parsed, bucket: Parsed): Parsed {
  if (!expression || typeof expression !== 'object') return false;
  if (Array.isArray(expression)) return expression.some((item): Parsed => expressionScopesBucket(item, bucket));
  const operation = expression.A_Expr;
  if (operation && operationScopesBucket(operation, bucket)) return true;
  return Object.values(expression).some((child): Parsed => expressionScopesBucket(child, bucket));
}

function insertedBucketDeclarations(file: string, buckets: Parsed, findings: Finding[]) {
  const declarations = [];
  for (const { node, line } of buckets) {
    const columns = (node.cols ?? []).map((column: Parsed) => column?.ResTarget?.name);
    const rows = valueRows(node);
    if (!columns.length || !rows.length) {
      findings.push(found(DB_STORAGE_POLICY, file, `${file}:${line} inserts into storage.buckets without a literal column list and VALUES`, { line }));
      continue;
    }
    for (const row of rows) {
      const cell = (name: string) => row[columns.indexOf(name)];
      declarations.push({ id: asString(cell('id')), publicValue: asBool(cell('public')), fileSize: cell('file_size_limit'), mimeTypes: cell('allowed_mime_types'), line });
    }
  }
  return declarations;
}

function calledBucketDeclarations(bucketCalls: Parsed) {
  const declarations = [];
  for (const { node, line } of bucketCalls) {
    const positional = (node.args ?? []).filter((argument: Parsed) => !argument?.NamedArgExpr);
    const named = new Map((node.args ?? []).filter((argument: Parsed) => argument?.NamedArgExpr).map((argument: Parsed) => [argument.NamedArgExpr.name, argument.NamedArgExpr.arg]));
    declarations.push({
      id: asString(positional[0]),
      publicValue: asBool(named.get('public') ?? positional[2]),
      fileSize: named.get('file_size_limit') ?? positional[3],
      mimeTypes: named.get('allowed_mime_types') ?? positional[4],
      line,
    });
  }
  return declarations;
}

function bucketDeclarationFindings(file: string, declaration: Parsed, policies: Parsed) {
  const { id, publicValue, fileSize, mimeTypes, line } = declaration;
  const findings = [];
  if (id === undefined) return [found(DB_STORAGE_POLICY, file, `${file}:${line} storage.buckets row has no literal id`, { line })];
  if (publicValue === null || (publicValue && !id.endsWith('_public'))) {
    findings.push(found(DB_STORAGE_POLICY, file, `${file}:${line} bucket ${JSON.stringify(id)} declares public = ${publicValue === null ? 'absent' : publicValue}; public must be explicit and only an *_public id may be public`, { line, bucket: id }));
  }
  for (const [column, value] of [['file_size_limit', fileSize], ['allowed_mime_types', mimeTypes]]) {
    if (value === undefined || isNull(value)) findings.push(found(DB_STORAGE_POLICY, file, `${file}:${line} bucket ${JSON.stringify(id)} declares no ${column}`, { line, bucket: id, column }));
  }
  const covered = policies.some((policy: Parsed) => policy.schema === 'storage' && policy.table === 'objects'
    && (expressionScopesBucket(policy.qual, id) || expressionScopesBucket(policy.withCheck, id)));
  if (!covered) findings.push(found(DB_STORAGE_POLICY, file, `${file}:${line} bucket ${JSON.stringify(id)} has no storage.objects policy whose bucket_id predicate names it in this migration`, { line, bucket: id }));
  return findings;
}

function storageFindings(file: string, facts: Parsed) {
  const findings: Finding[] = [];
  const declarations = insertedBucketDeclarations(file, facts.buckets, findings);
  declarations.push(...calledBucketDeclarations(facts.bucketCalls));
  for (const declaration of declarations) findings.push(...bucketDeclarationFindings(file, declaration, facts.policies));
  return findings;
}

/** Parse and judge one migration file. */
export async function sqlAnalysis({ file, text, exposed, forceRls }: { file: string; text: string; exposed: Parsed; forceRls: Parsed }) {
  const lineAt = lineIndexOf(text);
  let parsed;
  try {
    parsed = await parseSql(text);
  } catch (caught) {
    const error: Parsed = caught;
    const position = error?.sqlDetails?.cursorPosition;
    const line = position ? lineAt(position - 1) : undefined;
    const lineNote = line ? `:${line}` : '';
    return { findings: [found(DB_MIGRATION_SHAPE, file, `${file}${lineNote} is not valid PostgreSQL (${String(error?.message ?? error).split('\n')[0]})`, { ...(line ? { line } : {}) })], facts: null };
  }
  const facts = factsOf(statementList(parsed.stmts, lineAt));
  return { facts, findings: [
    ...transactionControlFindings(file, text, parsed.stmts, lineAt),
    ...rlsFindings(file, facts, exposed, forceRls),
    ...await plpgsqlFindings(file, facts, exposed),
    ...localPolicyFindings(file, facts),
    ...storageFindings(file, facts),
  ] };
}
