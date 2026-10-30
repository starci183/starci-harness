// PL/pgSQL inspection for DB_DYNAMIC_DDL and DB_DEFINER_SAFE. Function and DO bodies are parsed by libpg-query;
// dynamic query expressions are then parsed as PostgreSQL expressions instead of matched as raw migration text.
import { found } from './read.mjs';
import { eachInOrder } from '../../lib/in-order.mjs';
import { parsePlpgsqlBody, parseSql } from '../sql/pg-parse.mjs';
import { DB_DEFINER_SAFE, DB_DYNAMIC_DDL } from './database-constants.mjs';
import type { Finding, Parsed } from './rule-types.mjs';

const DB_DEFINER_REVOKE = 'DB_DEFINER_REVOKE';
const sval = (node: Parsed) => node?.String?.sval;
const nameOf = (list: Parsed, defaultSchema: Parsed) => {
  const parts = (list ?? []).map(sval).filter((part: Parsed) => part !== undefined);
  return parts.length === 1 && defaultSchema ? `${defaultSchema}.${parts[0]}` : parts.join('.');
};

const functionOption = (node: Parsed, key: string) => (node.options ?? []).filter((option: Parsed) => option?.DefElem?.defname === key).map((option: Parsed) => option.DefElem);
const securityDefiner = (node: Parsed) => functionOption(node, 'security').some((option: Parsed) => option.arg?.Boolean?.boolval === true || option.arg?.Integer?.ival === 1);
const functionLanguage = (node: Parsed) => functionOption(node, 'language').map((option: Parsed) => option.arg?.String?.sval).findLast(Boolean) ?? 'sql';
const functionBody = (node: Parsed) => functionOption(node, 'as').flatMap((option: Parsed) => (option.arg?.List?.items ?? []).map((item: Parsed) => item?.String?.sval ?? '')).join('') || null;
const functionReturnKind = (node: Parsed) => {
  const name = node.returnType?.names?.map(sval).findLast(Boolean);
  if (name === 'void') return 'void';
  if (name === 'trigger' || name === 'event_trigger') return 'trigger';
  return node.returnType?.setof ? 'setof' : 'scalar';
};

/** The statement kinds that run a dynamic query, with the field holding its query expression. */
const DYNAMIC_QUERY_FIELDS = new Map([['PLpgSQL_stmt_dynexecute', 'query'], ['PLpgSQL_stmt_dynfors', 'query'], ['PLpgSQL_stmt_open', 'dynquery']]);

function collectDynamicQueries(value: Parsed, out: Parsed) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectDynamicQueries(item, out);
    return;
  }
  for (const [key, child] of Object.entries<Parsed>(value)) {
    const field = DYNAMIC_QUERY_FIELDS.get(key);
    const text = field === undefined ? undefined : child?.[field]?.PLpgSQL_expr?.query;
    if (text !== undefined) out.push({ text, lineno: child.lineno });
    collectDynamicQueries(child, out);
  }
}

/** Every dynamic query expression in one parsed PL/pgSQL function. */
function dynamicQueries(root: string) {
  const out: Parsed[] = [];
  collectDynamicQueries(root, out);
  return out;
}

async function plpgsqlOf(body: Parsed, parameters?: Parsed, returnKind?: Parsed) {
  try {
    return await parsePlpgsqlBody(body, parameters, returnKind);
  } catch {
    return null;
  }
}

/** Parse a PL/pgSQL dynamic-query source as one PostgreSQL expression. */
async function expressionOf(text: string) {
  try {
    const parsed = await parseSql(`select ${text}`);
    return parsed.stmts?.[0]?.stmt?.SelectStmt?.targetList?.[0]?.ResTarget?.val ?? null;
  } catch {
    return null;
  }
}

const stringValue = (node: Parsed) => node?.A_Const?.sval?.sval;
const formatName = (node: Parsed) => node?.FuncCall?.funcname?.map(sval).filter(Boolean).join('.').toLowerCase() === 'format';
const operatorName = (node: Parsed) => node?.A_Expr?.name?.map(sval).filter(Boolean).join('');
const FORMAT_SPECIFIER = /%(?:(\d+)\$)?-?(?:\d+|\*(?:\d+\$)?)?([sIL%])/g;

/** Every format() conversion, or null when the template contains an invalid/unreadable percent sequence. */
function formatSpecifiers(template: Parsed) {
  const specs = [];
  let cursor = 0;
  for (const match of template.matchAll(FORMAT_SPECIFIER)) {
    if (template.slice(cursor, match.index).includes('%')) return null;
    specs.push({ position: match[1] ? Number(match[1]) - 1 : null, type: match[2] });
    cursor = match.index + match[0].length;
  }
  return template.slice(cursor).includes('%') ? null : specs;
}

/** The text one format() conversion renders to; an argument that is no string literal marks the render incomplete. */
function substituteSpecifier(spec: Parsed, args: Parsed, state: Parsed) {
  if (spec.type === '%') return '%';
  const argumentIndex = spec.position ?? state.sequential;
  if (spec.position === null) state.sequential += 1;
  if (spec.type === 'I') return 'hfs_identifier';
  if (spec.type === 'L') return "'hfs_literal'";
  const value = stringValue(args[argumentIndex + 1]);
  if (value !== undefined) return value;
  state.complete = false;
  return 'hfs_dynamic';
}

function renderFormat(args: Parsed) {
  const template = stringValue(args[0]);
  if (template === undefined) return { text: 'hfs_dynamic', complete: false };
  const specs = formatSpecifiers(template);
  if (specs === null) return { text: template, complete: false };
  const state = { sequential: 0, specIndex: 0, complete: true };
  const text = template.replace(FORMAT_SPECIFIER, () => {
    const spec = specs[state.specIndex];
    state.specIndex += 1;
    return substituteSpecifier(spec, args, state);
  });
  return { text, complete: state.complete };
}

/** Render enough of a dynamic expression to let the PostgreSQL parser identify its generated statement kind. */
function renderExpression(node: Parsed): Parsed {
  const literal = stringValue(node);
  if (literal !== undefined) return { text: literal, complete: true };
  if (node?.TypeCast) return renderExpression(node.TypeCast.arg);
  if (operatorName(node) === '||') {
    const left: Parsed = renderExpression(node.A_Expr.lexpr);
    const right: Parsed = renderExpression(node.A_Expr.rexpr);
    return { text: `${left.text}${right.text}`, complete: left.complete && right.complete };
  }
  if (formatName(node)) return renderFormat(node.FuncCall.args ?? []);
  return { text: 'hfs_dynamic', complete: false };
}

/** DDL statement kinds forbidden behind dynamic execution. */
function containsDynamicDdl(parsed: Parsed) {
  for (const entry of parsed.stmts ?? []) {
    const type = Object.keys(entry.stmt ?? {})[0];
    if (['CreateStmt', 'CreateTableAsStmt', 'CreatePolicyStmt', 'CreateFunctionStmt', 'AlterTableStmt', 'AlterFunctionStmt', 'AlterPolicyStmt', 'AlterDefaultPrivilegesStmt', 'GrantStmt', 'GrantRoleStmt', 'RenameStmt'].includes(type!)) return true;
    if (type === 'DropStmt' && ['OBJECT_TABLE', 'OBJECT_POLICY', 'OBJECT_FUNCTION'].includes(entry.stmt.DropStmt?.removeType)) return true;
  }
  return false;
}

async function dynamicQueryAnalysis(text: string) {
  const expression = await expressionOf(text);
  if (expression === null) return { buildsDdl: false, opaque: true };
  const rendered = renderExpression(expression);
  try {
    const parsed = await parseSql(rendered.text);
    return { buildsDdl: containsDynamicDdl(parsed), opaque: false };
  } catch {
    return { buildsDdl: false, opaque: !rendered.complete };
  }
}

async function dynamicDdlFindings(file: string, queries: Parsed, where: Parsed, baseLine: Parsed) {
  const findings: Finding[] = [];
  await eachInOrder(queries, async ({ text, lineno }: { text: string; lineno: number }) => {
    const line = lineno ? baseLine + lineno - 1 : undefined;
    const lineNote = line ? `${file}:${line}` : file;
    const analysis = await dynamicQueryAnalysis(text);
    if (analysis.buildsDdl) {
      findings.push(found(DB_DYNAMIC_DDL, file, `${lineNote} ${where} builds DDL dynamically (\`${String(text).slice(0, 120)}\`); write the create/alter/drop or grant/revoke out as statements so the parser sees every one`, { ...(line ? { line } : {}), query: text }));
    } else if (analysis.opaque) {
      findings.push(found(DB_DYNAMIC_DDL, file, `${lineNote} ${where} runs dynamic SQL the pass cannot read (\`${String(text).slice(0, 120)}\`); dynamic DDL is refused and a query built from an opaque value cannot be judged`, { ...(line ? { line } : {}), query: text }));
    }
  });
  return findings;
}

/** A definer expression is safe when it consists only of literals and format() calls whose conversions quote. */
function safeDefinerExpression(node: Parsed): Parsed {
  if (stringValue(node) !== undefined) return true;
  if (node?.TypeCast) return safeDefinerExpression(node.TypeCast.arg);
  if (operatorName(node) === '||') return safeDefinerExpression(node.A_Expr.lexpr) && safeDefinerExpression(node.A_Expr.rexpr);
  if (!formatName(node)) return false;
  const template = stringValue(node.FuncCall.args?.[0]);
  if (template === undefined) return false;
  const specs = formatSpecifiers(template);
  return specs?.every((spec) => ['I', 'L', '%'].includes(spec.type)) ?? false;
}

async function definerDynamicFindings(file: string, fn: Parsed, queries: Parsed, baseLine: Parsed) {
  const findings: Finding[] = [];
  await eachInOrder(queries, async ({ text, lineno }: { text: string; lineno: number }) => {
    const line = lineno ? baseLine + lineno - 1 : undefined;
    const lineNote = line ? `${file}:${line}` : file;
    const expression = await expressionOf(text);
    if (expression !== null && safeDefinerExpression(expression)) return;
    findings.push(found(DB_DEFINER_SAFE, file, `${lineNote} security definer function ${fn.name} builds dynamic SQL without quoting every parameter through format() %I or %L (\`${String(text).slice(0, 120)}\`)`, { ...(line ? { line } : {}), function: fn.name, query: text }));
  });
  return findings;
}

const OUTPUT_PARAMETER_MODES = new Set(['OUT', 'TABLE'].map((mode) => ['FUNC', 'PARAM', mode].join('_')));
const RESET_ALL_KIND = ['VAR', 'RESET', 'ALL'].join('_');
const inputParameters = (node: Parsed) => (node.parameters ?? []).map((item: Parsed) => item.FunctionParameter)
  .filter((parameter: Parsed) => !OUTPUT_PARAMETER_MODES.has(parameter?.mode));

function typeIdentity(type: Parsed) {
  const node = type?.TypeName ?? type;
  const parts = (node?.names ?? []).map(sval).filter(Boolean);
  if (parts[0] === 'pg_catalog') parts.shift();
  return `${parts.join('.')}${node?.arrayBounds?.length ? '[]' : ''}`;
}

const functionArguments = (fn: Parsed) => fn.node.func?.objargs ?? inputParameters(fn.node).map((parameter: Parsed) => parameter.argType);
const argumentIdentity = (args: Parsed) => args.map(typeIdentity).join(',');

function matchesFunction(fn: Parsed, object: Parsed, defaultSchema: Parsed) {
  if (nameOf(object?.objname, defaultSchema) !== fn.name) return false;
  return object?.args_unspecified === true || argumentIdentity(object?.objargs ?? []) === argumentIdentity(functionArguments(fn));
}

const matchesAlter = (fn: Parsed, alter: Parsed) => matchesFunction(fn, alter.node.func, alter.schema);

function grantMatchesFunction(fn: Parsed, grant: Parsed) {
  if (grant.objtype !== 'OBJECT_FUNCTION') return false;
  if (grant.privileges.length && !grant.privileges.includes('execute') && !grant.privileges.includes('all')) return false;
  if (grant.targtype === 'ACL_TARGET_ALL_IN_SCHEMA') return grant.objects.some((object: Parsed) => sval(object) === fn.schema);
  return grant.objects.some((object: Parsed) => matchesFunction(fn, object?.ObjectWithArgs, grant.defaultSchema));
}

function revokedRolesFor(fn: Parsed, grants: Parsed) {
  const roles = new Set();
  for (const grant of grants) {
    if (grant.index <= (fn.originIndex ?? fn.index)) continue;
    if (!grantMatchesFunction(fn, grant)) continue;
    for (const role of grant.grantees) {
      if (grant.grant) roles.delete(role);
      else roles.add(role);
    }
  }
  return roles;
}

function pathSetting(options: Parsed, pinned: Parsed, facts: Parsed) {
  for (const option of options) {
    const setting = option?.DefElem?.arg?.VariableSetStmt;
    if (setting?.name === 'search_path' || setting?.kind === RESET_ALL_KIND) pinned = facts.isSearchPathSet(option.DefElem);
  }
  return pinned;
}

function hasPinnedSearchPath(fn: Parsed, facts: Parsed) {
  let pinned = pathSetting(fn.node.options ?? [], false, facts);
  const originIndex = fn.originIndex ?? fn.index;
  for (const alter of facts.alterFunctions) {
    if (alter.index <= originIndex || !matchesAlter(fn, alter)) continue;
    pinned = pathSetting(alter.node.actions ?? [], pinned, facts);
  }
  return pinned;
}

async function doBlockFindings(file: string, block: Parsed) {
  if (block.body === undefined || block.language !== 'plpgsql') {
    return [found(DB_DYNAMIC_DDL, file, `${file}:${block.line} DO block in ${block.language} cannot be inspected; a DO block is plpgsql so a static pass sees its statements`, { line: block.line })];
  }
  const ast = await plpgsqlOf(block.body);
  if (ast === null) return [found(DB_DYNAMIC_DDL, file, `${file}:${block.line} DO block body is not valid plpgsql; the pass must see every statement a migration runs`, { line: block.line })];
  return dynamicDdlFindings(file, dynamicQueries(ast), 'DO block', block.line);
}

function definerDeclarationFindings(file: string, fn: Parsed, facts: Parsed, exposed: Parsed, definer: Parsed) {
  if (!definer) return [];
  const findings = [];
  if (!hasPinnedSearchPath(fn, facts)) findings.push(found(DB_DEFINER_SAFE, file, `${file}:${fn.line} security definer function ${fn.name} sets no search_path; add \`set search_path = ''\` (or a pinned schema list) on the create, or an alter function in the same migration`, { line: fn.line, function: fn.name }));
  if (exposed.has(fn.schema)) {
    const revoked = revokedRolesFor(fn, facts.grants);
    if (!revoked.has('public') || !revoked.has('anon')) findings.push(found(DB_DEFINER_SAFE, file, `${file}:${fn.line} security definer function ${fn.name} lives in the exposed schema ${fn.schema}; keep it in a non-exposed schema or revoke execute from public and anon in the same migration`, { line: fn.line, function: fn.name }));
  }
  if (!fn.altered && !fn.node.is_procedure && !fn.node.returnType) findings.push(found(DB_DEFINER_SAFE, file, `${file}:${fn.line} security definer function ${fn.name} declares no return type`, { line: fn.line, function: fn.name }));
  return findings;
}

async function functionBodyFindings(file: string, fn: Parsed, definer: Parsed) {
  if (functionLanguage(fn.node) !== 'plpgsql') return [];
  const body = functionBody(fn.node);
  if (body === null) return [];
  const ast = await plpgsqlOf(body, fn.node.parameters, functionReturnKind(fn.node));
  if (ast === null) {
    if (definer) return [found(DB_DEFINER_SAFE, file, `${file}:${fn.line} security definer function ${fn.name} has a body the pass cannot read; a definer body must be plain plpgsql`, { line: fn.line, function: fn.name })];
    return [];
  }
  const queries = dynamicQueries(ast);
  const findings = await dynamicDdlFindings(file, queries, `function ${fn.name}`, fn.line);
  if (definer) findings.push(...await definerDynamicFindings(file, fn, queries, fn.line));
  return findings;
}

async function functionFindings(file: string, fn: Parsed, facts: Parsed, exposed: Parsed) {
  const definer = securityDefiner(fn.node);
  const findings = definerDeclarationFindings(file, fn, facts, exposed, definer);
  const becomesDefiner = facts.alterFunctions.some((alter: Parsed) => alter.securityDefiner && alter.index > fn.index && matchesAlter(fn, alter));
  findings.push(...await functionBodyFindings(file, fn, definer || becomesDefiner));
  return findings;
}

function alteredDefinerFindings(file: string, alter: Parsed, facts: Parsed, exposed: Parsed) {
  if (!alter.securityDefiner) return [];
  const created = facts.functions.findLast((fn: Parsed) => fn.index < alter.index && matchesAlter(fn, alter));
  const node = created?.node ?? { func: alter.node.func };
  const fn = { ...alter, node, altered: true, originIndex: created?.index ?? -1 };
  return definerDeclarationFindings(file, fn, facts, exposed, true);
}

/** All PL/pgSQL-backed L04/L06 findings for one migration's extracted facts. */
export async function plpgsqlFindings(file: string, facts: Parsed, exposed: Parsed) {
  const findings = [];
  await eachInOrder(facts.doBlocks, async (block: Parsed) => { findings.push(...await doBlockFindings(file, block)); });
  await eachInOrder(facts.functions, async (fn: Parsed) => { findings.push(...await functionFindings(file, fn, facts, exposed)); });
  for (const alter of facts.alterFunctions) findings.push(...alteredDefinerFindings(file, alter, facts, exposed));
  return findings;
}

const functionKey = (fn: Parsed) => `${fn.name}/${argumentIdentity(functionArguments(fn))}`;

function applyFunctionAlter(functions: Parsed, alter: Parsed) {
  if (!functionOption({ options: alter.node.actions }, 'security').length) return;
  const matching = [...functions.values()].filter((fn) => matchesAlter(fn, alter));
  if (!matching.length) matching.push({ ...alter, node: { func: alter.node.func }, originIndex: -1 });
  for (const fn of matching) {
    functions.set(functionKey(fn), { ...fn, file: alter.file, line: alter.line, definer: alter.securityDefiner });
  }
}

function applyFunctionDrop(functions: Parsed, statement: Parsed) {
  if (statement.node.removeType !== 'OBJECT_FUNCTION') return;
  for (const fn of functions.values()) {
    if (statement.node.objects?.some((object: Parsed) => matchesFunction(fn, object.ObjectWithArgs, statement.defaultSchema))) {
      functions.delete(functionKey(fn));
    }
  }
}

function finalFunctionAccess(analyses: Parsed) {
  const functions = new Map<string, Parsed>();
  const grants = [];
  let offset = 0;
  for (const { file, facts } of analyses) {
    const ordered = (items: Parsed): Parsed[] => items.map((item: Parsed) => ({ ...item, file, index: offset + item.index }));
    const created = new Map(ordered(facts.functions).map((fn: Parsed): [number, Parsed] => [fn.index, fn]));
    const altered = new Map(ordered(facts.alterFunctions).map((fn: Parsed): [number, Parsed] => [fn.index, fn]));
    grants.push(...ordered(facts.grants));
    for (const statement of ordered(facts.statements)) {
      const fn = created.get(statement.index);
      if (fn) {
        const key = functionKey(fn);
        const originIndex = functions.get(key)?.originIndex ?? fn.index;
        functions.set(key, { ...fn, originIndex, definer: securityDefiner(fn.node) });
      }
      const alter = altered.get(statement.index);
      if (alter) applyFunctionAlter(functions, alter);
      if (statement.type === 'DropStmt') applyFunctionDrop(functions, statement);
    }
    offset += facts.statements.length;
  }
  return { functions: [...functions.values()], grants };
}

/** Authenticated execution is judged after all active migrations, including later revokes and grants. */
export function migrationSetDefinerFindings(analyses: Parsed, exposed: Parsed) {
  const { functions, grants } = finalFunctionAccess(analyses);
  return functions.filter((fn) => fn.definer && exposed.has(fn.schema) && !revokedRolesFor(fn, grants).has('authenticated'))
    .map((fn) => found(DB_DEFINER_REVOKE, fn.file, `${fn.file}:${fn.line} security definer function ${fn.name} lives in the exposed schema ${fn.schema}; the migration set ends without revoking execute from authenticated; revoke execute from public, anon and authenticated`, { line: fn.line, function: fn.name }));
}
