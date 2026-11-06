// database-role-blocks.mts - a role created inside an idempotent DO block is a role creation like any other.
// A baseline creates its roles as `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'x') THEN CREATE ROLE x ...; END IF; END $$`
// so the migration can run on a cluster where the role exists. The role rules (DB_APP_ROLE) read that CREATE ROLE with the same
// attribute checks as a top-level one. Only this exact guarded shape is read; any other DO block stays judged by the dynamic-DDL rule.
import { parsePlpgsqlBody, parseSql } from '../sql/pg-parse.mjs';
import type { Parsed } from './rule-types.mjs';

const stringOf = (node: Parsed): string | undefined => node?.A_Const?.sval?.sval;

/** The role name a guard `NOT EXISTS (SELECT ... FROM pg_roles WHERE rolname = '<name>')` tests, or null for any other condition. */
async function guardedRole(query: string): Promise<string | null> {
  const expression = (await parseSql(`select ${query}`)).stmts?.[0]?.stmt?.SelectStmt?.targetList?.[0]?.ResTarget?.val;
  const negated = expression?.BoolExpr?.boolop === 'NOT_EXPR' && expression.BoolExpr.args?.length === 1 ? expression.BoolExpr.args[0] : null;
  const select = negated?.SubLink?.subLinkType === 'EXISTS_SUBLINK' ? negated.SubLink.subselect?.SelectStmt : null;
  const from = select?.fromClause ?? [];
  if (from.length !== 1 || from[0].RangeVar?.relname !== 'pg_roles') return null;
  const test = select.whereClause?.A_Expr;
  const column = test?.lexpr?.ColumnRef?.fields?.map((field: Parsed) => field?.String?.sval).join('.');
  const operator = (test?.name ?? []).map((part: Parsed) => part?.String?.sval).join('');
  return operator === '=' && column === 'rolname' ? stringOf(test.rexpr) ?? null : null;
}

/** The CREATE ROLE statement of one `if` of the guarded shape (no else branch, one statement that creates the guarded role), or null. */
async function guardedCreate(statement: Parsed): Promise<Parsed | null> {
  const branch = statement?.PLpgSQL_stmt_if;
  const then = branch?.then_body ?? [];
  if (!branch || branch.elsif_list || branch.else_body || then.length !== 1) return null;
  const role = await guardedRole(branch.cond?.PLpgSQL_expr?.query ?? '');
  const query = then[0].PLpgSQL_stmt_execsql?.sqlstmt?.PLpgSQL_expr?.query;
  if (role === null || typeof query !== 'string') return null;
  const created = (await parseSql(query)).stmts?.[0]?.stmt?.CreateRoleStmt;
  return created && created.role === role ? created : null;
}

/** The CREATE ROLE nodes a DO block creates, when the whole block is `IF NOT EXISTS (role) THEN CREATE ROLE ...; END IF;` repeated; [] for any other block. */
export async function guardedRoleCreates(block: Parsed): Promise<Parsed[]> {
  if (typeof block?.body !== 'string' || block.language !== 'plpgsql') return [];
  try {
    const body: Parsed[] = (await parsePlpgsqlBody(block.body))?.action?.PLpgSQL_stmt_block?.body ?? [];
    const steps = body.filter((statement) => !statement.PLpgSQL_stmt_return);
    const created = await Promise.all(steps.map(guardedCreate));
    return steps.length > 0 && created.every((node) => node !== null) ? created.filter((node): node is Parsed => node !== null) : [];
  } catch {
    return [];
  }
}

const ROLE_DDL = /\b(?:create|alter)\s+(?:role|user)\b/i;

function someDynamicRoleExec(node: Parsed): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(someDynamicRoleExec);
  const query = node.PLpgSQL_stmt_dynexecute?.query?.PLpgSQL_expr?.query;
  if (typeof query === 'string' && ROLE_DDL.test(query)) return true;
  return Object.values(node).some(someDynamicRoleExec);
}

/** True when a DO block creates or alters a role through a dynamic EXECUTE: the role rules cannot read its attributes, so it is refused. */
export async function dynamicRoleExecute(block: Parsed): Promise<boolean> {
  if (typeof block?.body !== 'string' || block.language !== 'plpgsql') return false;
  try {
    return someDynamicRoleExec((await parsePlpgsqlBody(block.body))?.action);
  } catch {
    return false;
  }
}
