// R255-R256 inspect the final database access state: the application role (its attributes and every grant on schema auth), forced RLS, policies, views and storage prefixes.
import { found } from './read.mjs';
import { parseSql } from '../sql/pg-parse.mjs';
import { eachInOrder } from '../../lib/in-order.mjs';
import type { Parsed } from './rule-types.mjs';

export const DB_APP_ROLE = 'DB_APP_ROLE';
export const DB_FORCE_RLS_DEFAULT = 'DB_FORCE_RLS_DEFAULT';
export const DB_POLICY_TAUTOLOGY = 'DB_POLICY_TAUTOLOGY';
export const DB_VIEW_UNSAFE = 'DB_VIEW_UNSAFE';
export const DB_STORAGE_PREFIX = 'DB_STORAGE_PREFIX';

const sval = (value: Parsed) => value?.String?.sval;
const names = (values: Parsed) => (values ?? []).map(sval).filter(Boolean).join('.');
const qualify = (name: string) => name.includes('.') ? name : `public.${name}`;
const relationName = (relation: Parsed, schema = 'public') => `${relation.schemaname ?? schema}.${relation.relname}`;
const roleName = (role: Parsed) => role?.rolename ?? (role?.roletype === 'ROLESPEC_PUBLIC' ? 'public' : null);
const unwrap = (node: Parsed): Parsed => node?.TypeCast ? unwrap(node.TypeCast.arg) : node;
const stringValue = (node: Parsed) => unwrap(node)?.A_Const?.sval?.sval;
const operator = (node: Parsed) => names(node.name);
const publicRead = (policy: Parsed) => policy.cmd === 'select' && policy.name.endsWith('_public_read');
const AND = ['AND', 'EXPR'].join('_');
const OR = ['OR', 'EXPR'].join('_');
const NOT = ['NOT', 'EXPR'].join('_');
const SEQUENCE = ['OBJECT', 'SEQUENCE'].join('_');
const SCHEMA = ['OBJECT', 'SCHEMA'].join('_');
const TABLE = ['OBJECT', 'TABLE'].join('_');
const ALL_IN_SCHEMA = ['ACL', 'TARGET', 'ALL', 'IN', 'SCHEMA'].join('_');
const ACCOUNT_SCHEMA = 'auth';
const MATVIEW = ['OBJECT', 'MATVIEW'].join('_');
const note = (code: string, source: Parsed, message: string, extra = {}) => found(code, source.file, `${source.file}:${source.line} ${message}`, { line: source.line, ...extra });

function someNode(node: Parsed, predicate: Parsed): Parsed {
  if (!node || typeof node !== 'object') return false;
  if (predicate(node)) return true;
  return Object.values(node).some((child): Parsed => someNode(child, predicate));
}

function structural(node: Parsed): Parsed {
  if (Array.isArray(node)) return node.map(structural);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'location').map(([key, value]): Parsed => [key, structural(value)]));
}

/** A principal any policy may read: auth.uid(), auth.jwt(), the request JWT claims, or a helper whose body reads one. A declared scope setting is no such principal: only a policy of declared scope roles may read it (scopeCall). */
function principalCall(call: Parsed, helpers: Parsed) {
  const name = names(call.funcname);
  if (['auth.uid', 'auth.jwt'].includes(name) || helpers.functions.has(name) || helpers.functions.has(qualify(name))) return true;
  if (!['current_setting', 'pg_catalog.current_setting'].includes(name)) return false;
  return ['request.jwt.claims', 'request.jwt.claim.sub'].includes(stringValue(call.args?.[0]));
}

/** A call that reads a declared scope setting, directly or through a helper whose body does. */
function scopeCall(call: Parsed, helpers: Parsed) {
  const name = names(call.funcname);
  if (helpers.scoped.has(name) || helpers.scoped.has(qualify(name))) return true;
  return ['current_setting', 'pg_catalog.current_setting'].includes(name) && helpers.settings.has(stringValue(call.args?.[0]));
}

const hasScope = (node: Parsed, helpers: Parsed) => someNode(node, (item: Parsed) => Boolean(item.FuncCall && scopeCall(item.FuncCall, helpers)));
const hasColumn = (node: Parsed) => someNode(node, (item: Parsed) => Boolean(item.ColumnRef));
const columnName = (node: Parsed): string | undefined => {
  const fields = unwrap(node)?.ColumnRef?.fields;
  return fields?.length ? sval(fields[fields.length - 1]) : undefined;
};

/** A declared scope principal filters rows only as `<owning column> = <principal>`, either side; the principal side holds no column. */
function scopeComparison(expr: Parsed, helpers: Parsed) {
  if (!expr || expr.kind !== 'AEXPR_OP' || operator(expr) !== '=') return false;
  const sides = [[expr.lexpr, expr.rexpr], [expr.rexpr, expr.lexpr]];
  return sides.some(([column, principal]) => helpers.columns.has(columnName(column) ?? '') && hasScope(principal, helpers) && !hasColumn(principal));
}

const hasPrincipal = (node: Parsed, helpers: Parsed) => someNode(node, (item: Parsed) => Boolean(item.FuncCall && principalCall(item.FuncCall, helpers)));
const literalFalse = (node: Parsed) => unwrap(node)?.A_Const?.boolval?.boolval === false;

function principalPredicate(expression: Parsed, helpers: Parsed) {
  const node = unwrap(expression);
  if (!node) return false;
  if (literalFalse(node)) return true;
  if (node.NullTest || node.BooleanTest) return false;
  const bool = node.BoolExpr;
  if (bool?.boolop === AND) return bool.args.some((arg: Parsed) => principalPredicate(arg, helpers));
  if (bool?.boolop === OR) return bool.args.every((arg: Parsed) => principalPredicate(arg, helpers));
  if (bool?.boolop === NOT) return false;
  const expr = node.A_Expr;
  if (expr && JSON.stringify(structural(expr.lexpr)) === JSON.stringify(structural(expr.rexpr))) return false;
  if (hasScope(node, helpers)) return helpers.scopeAllowed === true && scopeComparison(expr, helpers);
  return hasPrincipal(node, helpers);
}

async function principalHelpers(analyses: Parsed, scopeSettings: string[], scopeColumns: string[]) {
  const functions = analyses.flatMap(({ facts }: { facts: Parsed }) => facts.functions);
  const bodies: Parsed[] = [];
  await eachInOrder(functions, async (fn: Parsed) => {
    const body = (fn.node.options ?? []).find((option: Parsed) => option.DefElem?.defname === 'as')?.DefElem?.arg?.List?.items?.[0]?.String?.sval;
    if (!body) return;
    try { bodies.push({ name: fn.name, ast: await parseSql(body) }); } catch { /* PL/pgSQL safety is checked separately. */ }
  });
  const helpers = { functions: new Set<string>(), settings: new Set<string>(scopeSettings), scoped: new Set<string>(), columns: new Set<string>(scopeColumns), scopeAllowed: false };
  for (let remaining = bodies.length; remaining > 0; remaining -= 1) {
    for (const body of bodies) {
      if (hasPrincipal(body.ast, helpers)) helpers.functions.add(body.name);
      if (hasScope(body.ast, helpers)) helpers.scoped.add(body.name);
    }
  }
  return helpers;
}

function applyPolicies(policies: Parsed, events: Parsed, file: string) {
  for (const event of events) {
    const item = event.kind === 'create' ? event.policy : event;
    const key = `${item.schema}.${item.table}/${item.name}`;
    if (event.kind === 'drop') policies.delete(key);
    else if (event.kind === 'create') policies.set(key, { ...item, file });
    else policies.set(key, { ...policies.get(key), ...item, file, cmd: policies.get(key)?.cmd ?? 'all' });
  }
}

function grantTargets(grant: Parsed) {
  if (!['OBJECT_TABLE', SEQUENCE].includes(grant.objtype)) return [];
  if (grant.targtype === 'ACL_TARGET_ALL_IN_SCHEMA') return grant.objects.map((object: Parsed) => `${sval(object)}.*`);
  return grant.objects.filter((object: Parsed) => object.RangeVar).map((object: Parsed) => relationName(object.RangeVar, grant.defaultSchema));
}

function applyGrant(grants: Parsed, grant: Parsed, file: string) {
  for (const target of grantTargets(grant)) {
    for (const role of grant.grantees) {
      const key = `${target}/${role}`;
      const state = grants.get(key) ?? { target, role, privileges: new Set(), revokedRead: false, objtype: grant.objtype };
      const privileges = grant.all || !grant.privileges.length ? ['all'] : grant.privileges;
      updatePrivileges(state, grant.grant, privileges);
      grants.set(key, { ...state, file, line: grant.line });
    }
  }
}

function updatePrivileges(state: Parsed, granting: Parsed, privileges: Parsed) {
  if (granting) {
    for (const privilege of privileges) state.privileges.add(privilege);
    if (privileges.some((privilege: Parsed) => ['select', 'all'].includes(privilege))) state.revokedRead = false;
    return;
  }
  if (privileges.includes('all')) state.privileges.clear();
  else for (const privilege of privileges) state.privileges.delete(privilege);
  if (privileges.some((privilege: Parsed) => ['select', 'all'].includes(privilege))) state.revokedRead = true;
}

function policyFindings(policies: Parsed, appRole: Parsed, helpers: Parsed, scopeRoles: Set<string>) {
  const findings = [];
  for (const policy of policies) {
    const table = `${policy.schema}.${policy.table}`;
    if (policy.roles.every((role: Parsed) => role === appRole) || publicRead(policy)) continue;
    const scoped = { ...helpers, scopeAllowed: policy.roles.length > 0 && policy.roles.every((role: Parsed) => scopeRoles.has(role)) };
    const predicates = [policy.qual, policy.withCheck].filter((expression) => expression !== undefined);
    if (!predicates.length || predicates.some((expression) => !principalPredicate(expression, scoped))) {
      findings.push(note(DB_POLICY_TAUTOLOGY, policy, `policy ${policy.name} must constrain a principal; constants, IS NOT NULL, self comparisons and a scope setting outside policies of declared scope roles (hfs.json db.scopeRoles) grant no ownership boundary`, { table, policy: policy.name }));
    }
  }
  return findings;
}

function roleFindings(analyses: Parsed, appRole: Parsed) {
  const findings = [];
  for (const { file, facts } of analyses) {
    for (const statement of facts.statements) findings.push(...roleStatementFindings({ ...statement, file }, appRole));
    for (const grant of facts.grants) {
      if (grant.grant && grant.grantees.includes(appRole) && (grant.all || !grant.privileges.length)) {
        findings.push(note(DB_APP_ROLE, { ...grant, file }, `${appRole} receives ALL privileges; grant the capabilities it uses explicitly`));
      }
    }
  }
  return findings;
}

/** What one grant statement names inside schema auth: the schema, a table or sequence of it, every table or sequence in it. */
function authTargets(grant: Parsed): string[] {
  if (grant.objtype === SCHEMA) return grant.objects.filter((object: Parsed) => sval(object) === ACCOUNT_SCHEMA).map(() => `schema ${ACCOUNT_SCHEMA}`);
  if (![TABLE, SEQUENCE].includes(grant.objtype)) return [];
  if (grant.targtype === ALL_IN_SCHEMA) return grant.objects.filter((object: Parsed) => sval(object) === ACCOUNT_SCHEMA).map(() => `all ${grant.objtype === TABLE ? 'tables' : 'sequences'} in schema ${ACCOUNT_SCHEMA}`);
  return grant.objects.filter((object: Parsed) => object.RangeVar?.schemaname === ACCOUNT_SCHEMA).map((object: Parsed) => relationName(object.RangeVar));
}

/**
 * R255: the application role holds no privilege on schema auth, on a table or sequence in it, or by default privilege for the
 * schema. The migrations are applied in order, so a grant that a later migration revokes (the contract step of an app that moved
 * to the identity account doors) is not held; what remains at the end is reported at the grant that left it.
 */
function authSchemaFindings(analyses: Parsed, appRole: Parsed) {
  const held = new Map();
  for (const { file, facts } of analyses) {
    const statements = [
      ...facts.grants.map((grant: Parsed) => ({ grant, targets: authTargets(grant) })),
      ...facts.defaultPrivileges.map((grant: Parsed) => ({ grant, targets: grant.schemas.includes(ACCOUNT_SCHEMA) ? [`default privileges in schema ${ACCOUNT_SCHEMA}`] : [] })),
    ].filter(({ grant }) => grant.grantees.includes(appRole));
    for (const { grant, targets } of statements) {
      for (const target of targets) {
        const state = held.get(target) ?? { target, privileges: new Set() };
        updatePrivileges(state, grant.grant, grant.all ? ['all'] : grant.privileges);
        held.set(target, { ...state, file, line: grant.line });
      }
    }
  }
  return [...held.values()].filter((state) => state.privileges.size > 0)
    .map((state) => note(DB_APP_ROLE, state, `${appRole} holds a grant on ${state.target}; reach accounts through the identity account doors (SECURITY DEFINER functions), never through a grant on schema ${ACCOUNT_SCHEMA}; an app on the old sign-in glue runs "starci app codemod account-doors", "starci app sync --execute" and "starci app codemod account-doors --contract" in one release`, { target: state.target }));
}

/** R255: a declared scope role is created NOLOGIN NOINHERIT NOBYPASSRLS without administrative attributes and is never altered to gain them; one never created in the migrations is refused. */
function scopeRoleFindings(analyses: Parsed, scopeRoles: Set<string>) {
  const findings = [];
  const created = new Set<string>();
  for (const { file, facts } of analyses) {
    for (const statement of facts.statements) {
      const { type, node } = statement;
      if (!['CreateRoleStmt', 'AlterRoleStmt'].includes(type)) continue;
      const role = type === 'CreateRoleStmt' ? node.role : roleName(node.role);
      if (!scopeRoles.has(role)) continue;
      const options = new Map((node.options ?? []).map(({ DefElem: option }: { DefElem: Parsed }) => [option.defname, option.arg?.Boolean?.boolval]));
      const unsafe = ['superuser', 'bypassrls', 'createdb', 'createrole', 'replication', 'inherit', 'canlogin'].some((option) => options.get(option) === true);
      const incomplete = type === 'CreateRoleStmt' && ['canlogin', 'inherit', 'bypassrls'].some((option) => options.get(option) !== false);
      if (type === 'CreateRoleStmt') created.add(role);
      if (unsafe || incomplete) findings.push(note(DB_APP_ROLE, { ...statement, file }, `scope role ${role} must be created NOLOGIN NOINHERIT NOBYPASSRLS without SUPERUSER or administrative role attributes`));
    }
  }
  const last = analyses[analyses.length - 1]?.file;
  for (const role of scopeRoles) if (last && !created.has(role)) findings.push(found(DB_APP_ROLE, last, `${last} ends without a migration that creates scope role ${role} (hfs.json db.scopeRoles) NOLOGIN NOINHERIT NOBYPASSRLS`));
  return findings;
}

function roleStatementFindings(statement: Parsed, appRole: Parsed) {
  const { type, node } = statement;
  if (!['CreateRoleStmt', 'AlterRoleStmt'].includes(type)) return [];
  const role = type === 'CreateRoleStmt' ? node.role : roleName(node.role);
  if (role !== appRole) return [];
  const options = new Map((node.options ?? []).map(({ DefElem: option }: { DefElem: Parsed }) => [option.defname, option.arg?.Boolean?.boolval]));
  const unsafe = ['superuser', 'bypassrls', 'createdb', 'createrole', 'replication', 'inherit'].some((option) => options.get(option) === true);
  const creationInvalid = type === 'CreateRoleStmt' && (options.get('canlogin') !== true || options.get('inherit') !== false);
  if (!unsafe && !creationInvalid) return [];
  return [note(DB_APP_ROLE, statement, `${appRole} must LOGIN NOINHERIT without SUPERUSER, BYPASSRLS or administrative role attributes`)];
}

function tableStates(analyses: Parsed) {
  const tables = new Map();
  let owner = null;
  for (const { file, facts } of analyses) {
    owner = null;
    for (const statement of facts.statements) {
      const { type, node, defaultSchema } = statement;
      if (type === 'VariableSetStmt' && ['role', 'session_authorization'].includes(node.name)) owner = stringValue(node.args?.[0]) ?? null;
      const relation = type === 'CreateTableAsStmt' ? node.into?.rel : node.relation;
      if (['CreateStmt', 'CreateTableAsStmt'].includes(type) && relation && node.objtype !== MATVIEW && relation.relpersistence !== 't') {
        tables.set(relationName(relation, defaultSchema), { owner, forced: false, ...statement, file });
      }
      applyTableAlter(tables, { ...statement, file });
    }
  }
  return tables;
}

function applyTableAlter(tables: Parsed, statement: Parsed) {
  const { type, node, defaultSchema } = statement;
  if (!node.relation) return;
  const key = relationName(node.relation, defaultSchema);
  const table = tables.get(key) ?? { forced: false };
  if (type === 'AlterObjectSchemaStmt' && node.objectType === 'OBJECT_TABLE') {
    tables.delete(key);
    tables.set(`${node.newschema}.${node.relation.relname}`, { ...table, ...statement });
  }
  if (type !== 'AlterTableStmt' || node.objtype !== 'OBJECT_TABLE') return;
  for (const { AlterTableCmd: cmd } of node.cmds ?? []) {
    if (cmd.subtype === 'AT_ChangeOwner') Object.assign(table, statement, { owner: roleName(cmd.newowner) });
    if (cmd.subtype === 'AT_ForceRowSecurity') table.forced = true;
    if (cmd.subtype === 'AT_NoForceRowSecurity') Object.assign(table, statement, { forced: false });
  }
  tables.set(key, table);
}

function forceFindings(analyses: Parsed, db: Parsed, appRole: Parsed) {
  const exemptions = new Set((db.forceRlsExemptions ?? []).filter((item: Parsed) => typeof item?.table === 'string' && typeof item.reason === 'string' && item.reason.trim()).map((item: Parsed) => qualify(item.table)));
  return [...tableStates(analyses)].filter(([name, table]) => table.owner === appRole && !table.forced && !exemptions.has(name))
    .map(([table, source]) => note(DB_FORCE_RLS_DEFAULT, source, `${appRole} owns ${table} without FORCE ROW LEVEL SECURITY; an exemption needs hfs.json db.forceRlsExemptions with a table and reason`, { table }));
}

function viewFindings(analyses: Parsed, grants: Parsed, exposed: Parsed) {
  const views = new Map();
  for (const { file, facts } of analyses) for (const view of facts.views) views.set(`${view.schema}.${view.name}`, { ...view, file });
  const findings = [];
  for (const [table, view] of views) {
    if (!exposed.has(view.schema) || view.securityInvoker) continue;
    if (['anon', 'authenticated'].every((role) => grants.get(`${table}/${role}`)?.revokedRead)) continue;
    findings.push(note(DB_VIEW_UNSAFE, view, `exposed ${view.kind} ${table} needs security_invoker = true (ordinary views), or SELECT revoked from anon and authenticated`, { table }));
  }
  return findings;
}

function folderPrefix(node: Parsed) {
  const value = unwrap(node);
  const subscript = value?.A_Indirection;
  const call = subscript?.arg?.FuncCall;
  return names(call?.funcname) === 'storage.foldername'
    && names(unwrap(call?.args?.[0])?.ColumnRef?.fields) === 'name'
    && subscript.indirection?.[0]?.A_Indices?.uidx?.A_Const?.ival?.ival === 1;
}

function ownershipExpression(expression: Parsed, helpers: Parsed) {
  const node = unwrap(expression);
  if (!node) return false;
  const op = node.A_Expr;
  if (!op || operator(op) !== '=') return false;
  return (folderPrefix(op.lexpr) && hasPrincipal(op.rexpr, helpers)) || (folderPrefix(op.rexpr) && hasPrincipal(op.lexpr, helpers));
}

function publicBucketExpression(expression: Parsed) {
  const node = unwrap(expression);
  if (!node) return false;
  const op = node.A_Expr;
  if (!op || operator(op) !== '=') return false;
  const leftColumn = names(unwrap(op.lexpr)?.ColumnRef?.fields);
  const rightColumn = names(unwrap(op.rexpr)?.ColumnRef?.fields);
  return (leftColumn === 'bucket_id' && stringValue(op.rexpr)?.endsWith('_public'))
    || (rightColumn === 'bucket_id' && stringValue(op.lexpr)?.endsWith('_public'));
}

function storageBoundaryExpression(expression: Parsed, helpers: Parsed) {
  const node = unwrap(expression);
  if (!node) return false;
  const bool = node.BoolExpr;
  if (bool?.boolop === AND) return bool.args.some((arg: Parsed) => storageBoundaryExpression(arg, helpers));
  if (bool?.boolop === OR) return bool.args.every((arg: Parsed) => storageBoundaryExpression(arg, helpers));
  return publicBucketExpression(node) || ownershipExpression(node, helpers);
}

function storagePrefixFindings(policies: Parsed, helpers: Parsed) {
  const findings = [];
  for (const policy of policies) {
    if (policy.schema !== 'storage' || policy.table !== 'objects') continue;
    const expressions = [policy.qual, policy.withCheck].filter((expression) => expression !== undefined);
    if (expressions.length && expressions.every((expression) => storageBoundaryExpression(expression, helpers))) continue;
    findings.push(note(DB_STORAGE_PREFIX, policy, `storage.objects policy ${policy.name} must compare storage.foldername(name)[1] with the principal, unless scoped to an *_public bucket`, { policy: policy.name }));
  }
  return findings;
}

/** All new access checks run on the ordered active migrations in either edition, through checkDatabase. */
export async function databaseAccessFindings({ analyses, exposed, db = {} }: { analyses: Parsed; exposed: Parsed; db?: Parsed }) {
  const declared = db ?? {};
  const appRole = declared.appRole ?? 'app_be';
  const policyMap = new Map();
  const grants = new Map();
  for (const { file, facts } of analyses) {
    applyPolicies(policyMap, facts.policyEvents, file);
    for (const grant of facts.grants) applyGrant(grants, grant, file);
  }
  const policies = [...policyMap.values()];
  const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((entry: unknown): entry is string => typeof entry === 'string') : []);
  const scopeRoles = new Set<string>((Array.isArray(declared.scopeRoles) ? declared.scopeRoles : []).map((entry: Parsed) => entry?.role).filter((role: unknown): role is string => typeof role === 'string'));
  const helpers = await principalHelpers(analyses, strings(declared.scopeSettings), declared.scopeColumns === undefined ? ['workspace_id'] : strings(declared.scopeColumns));
  return [
    ...policyFindings(policies, appRole, helpers, scopeRoles),
    ...scopeRoleFindings(analyses, scopeRoles),
    ...roleFindings(analyses, appRole),
    ...authSchemaFindings(analyses, appRole),
    ...forceFindings(analyses, declared, appRole),
    ...viewFindings(analyses, grants, exposed),
    ...storagePrefixFindings(policies, helpers),
  ];
}
