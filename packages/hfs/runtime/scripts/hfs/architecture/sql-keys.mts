import path from 'node:path';
import { lsFiles } from '../../api/git/ls-files.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { MIGRATIONS_DIR } from '../rules/database-constants.mjs';
import { databaseSqlStatements, databaseSqlTokens, isMigrationName, migrationStamp } from '../rules/database-migrations.mjs';
import { readText } from '../rules/read.mjs';
import type { SqlToken } from './sql-token-forms.mjs';

/** A relation named in a migration statement: its schema (null when unproven), its table, and the token after it. */
interface Relation {
  schema: string | null;
  table: string;
  next: number;
}

/** What the ordered migrations have proven so far: per public table its unique key sets. */
interface KeyState {
  tables: Map<string, string[][]>;
  safe: Set<string>;
  schema: string | null;
  tainted: boolean;
}

const word = (token: SqlToken | undefined, value: string): boolean => token?.t === 'word' && token.v === value;
const identifier = (token: SqlToken | undefined): string | null => token !== undefined && ['word', 'ident'].includes(token.t) && token.v === token.v.toLowerCase() ? token.v : null;
const OPAQUE_STATEMENTS = new Set(['do', 'call', 'select', 'with', 'insert', 'update', 'delete', 'merge', 'truncate', 'execute', 'rollback', 'abort', 'prepare', 'discard', 'refresh', 'copy']);
const settingName = (token: SqlToken | undefined, value: string): boolean => token !== undefined && ['word', 'ident'].includes(token.t) && token.v.toLowerCase() === value;

/** A migration relation is public only when its qualification or the current search path proves it. */
function relationAt(tokens: SqlToken[], start: number, schema: string | null): Relation | null {
  const first = identifier(tokens[start]);
  if (first === null) return null;
  if (tokens[start + 1]?.v !== '.') return { schema, table: first, next: start + 1 };
  const table = identifier(tokens[start + 2]);
  if (table === null || tokens[start + 3]?.v === '.') return null;
  return { schema: first, table, next: start + 3 };
}

/** Split declarations at their own commas, keeping type arguments and constraint column lists together. */
function clausesOf(tokens: SqlToken[]): SqlToken[][] | null {
  let current: SqlToken[] = [];
  const clauses: SqlToken[][] = [current];
  let depth = 0;
  for (const token of tokens) {
    if (token.v === '(') depth += 1;
    if (token.v === ')') depth -= 1;
    if (depth < 0) return null;
    if (token.v === ',' && depth === 0) {
      current = [];
      clauses.push(current);
    } else current.push(token);
  }
  return depth === 0 ? clauses : null;
}

function parenthesized(tokens: SqlToken[], start: number): { body: SqlToken[]; next: number } | null {
  if (tokens[start]?.v !== '(') return null;
  let depth = 1;
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (tokens[index]?.v === '(') depth += 1;
    if (tokens[index]?.v === ')') depth -= 1;
    if (depth === 0) return { body: tokens.slice(start + 1, index), next: index + 1 };
  }
  return null;
}

const isDeferred = (tokens: SqlToken[]): boolean => tokens.some((token, index) => word(token, 'deferrable') && !word(tokens[index - 1], 'not'));

/** A declared key proves only its complete, plain column list; index expressions are never column names. */
function tableKey(tokens: SqlToken[]): string[] | null {
  if (isDeferred(tokens)) return null;
  let start = word(tokens[0], 'constraint') ? 2 : 0;
  if (word(tokens[start], 'primary') && word(tokens[start + 1], 'key')) start += 2;
  else if (word(tokens[start], 'unique')) start += 1;
  else return null;
  const enclosed = parenthesized(tokens, start);
  const clauses = enclosed && clausesOf(enclosed.body);
  if (!clauses?.length || clauses.some((clause) => clause.length !== 1 || identifier(clause[0]) === null)) return null;
  // Every clause was just proven to be one identifier, so no clause is dropped.
  return clauses.flatMap((clause) => { const column = identifier(clause[0]); return column === null ? [] : [column]; });
}

/** Inline key clauses are read at column depth, outside defaults, generated expressions and type parameters. */
function columnKey(tokens: SqlToken[]): string[] | null {
  const column = identifier(tokens[0]);
  if (column === null || isDeferred(tokens)) return null;
  let depth = 0;
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index]?.v === '(') depth += 1;
    if (tokens[index]?.v === ')') depth -= 1;
    if (depth === 0 && (word(tokens[index], 'unique') || (word(tokens[index], 'primary') && word(tokens[index + 1], 'key')))) return [column];
  }
  return null;
}

function declarationKey(tokens: SqlToken[]): string[] | null {
  const tableConstraint = ['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude'].some((value) => word(tokens[0], value));
  return tableConstraint ? tableKey(tokens) : columnKey(tokens);
}

function addKey(keys: string[][], columns: string[] | null): void {
  if (columns && !keys.some((key) => key.length === columns.length && key.every((column, index) => column === columns[index]))) keys.push(columns);
}

function clearKeys(state: KeyState, uncertain = false): void {
  for (const table of state.tables.keys()) state.tables.set(table, []);
  if (uncertain) state.safe.clear();
}

function opaqueExecution(state: KeyState): void {
  clearKeys(state, true);
  state.schema = null;
}

function forgetRelation(state: KeyState, relation: Relation | null): void {
  if (!relation || relation.schema === null) clearKeys(state, true);
  else if (relation.schema === 'public') {
    state.tables.set(relation.table, []);
    state.safe.delete(relation.table);
  }
}

/** Conditional table creation cannot establish what an unknown pre-existing table actually constrains. */
function createTable(state: KeyState, tokens: SqlToken[], start: number): void {
  const conditional = word(tokens[start], 'if') && word(tokens[start + 1], 'not') && word(tokens[start + 2], 'exists');
  if (conditional) start += 3;
  const relation = relationAt(tokens, start, state.schema);
  if (!relation || relation.schema !== 'public') return;
  if (conditional) {
    if (!state.tables.has(relation.table)) state.tables.set(relation.table, []);
    return;
  }
  const enclosed = parenthesized(tokens, relation.next);
  const clauses = enclosed && clausesOf(enclosed.body);
  const keys: string[][] = [];
  state.safe.delete(relation.table);
  state.tables.set(relation.table, keys);
  if (!clauses) return;
  state.safe.add(relation.table);
  for (const clause of clauses) addKey(keys, declarationKey(clause));
}

function safeAlter(tokens: SqlToken[]): boolean {
  if (word(tokens[0], 'owner') || word(tokens[0], 'cluster')) return true;
  const security = tokens.some((token) => word(token, 'security'));
  if (security && ['enable', 'disable', 'force', 'no'].some((value) => word(tokens[0], value))) return true;
  return (word(tokens[0], 'set') || word(tokens[0], 'reset')) && tokens[1]?.v === '(';
}

/** ADD can establish a new key; drops, renames and unreadable alterations discard the affected proof. */
function alterClause(state: KeyState, relation: Relation, tokens: SqlToken[]): void {
  if (tokens.some((token) => word(token, 'inherit') || word(token, 'partition'))) { clearKeys(state, true); return; }
  if (word(tokens[0], 'validate') || tokens.some((token) => word(token, 'default') || word(token, 'check') || word(token, 'generated') || word(token, 'using'))) {
    opaqueExecution(state);
    return;
  }
  if (safeAlter(tokens)) return;
  if (word(tokens[0], 'drop') && (word(tokens[1], 'column') || word(tokens[1], 'constraint'))) {
    if (relation.schema === 'public') state.tables.set(relation.table, []);
    return;
  }
  if (!word(tokens[0], 'add')) { forgetRelation(state, relation); return; }
  let start = word(tokens[1], 'column') ? 2 : 1;
  if (word(tokens[start], 'if')) return;
  if (relation.schema !== 'public' || !state.safe.has(relation.table)) return;
  const keys = state.tables.get(relation.table) ?? [];
  state.tables.set(relation.table, keys);
  addKey(keys, declarationKey(tokens.slice(start)));
}

function alterTable(state: KeyState, tokens: SqlToken[], start: number): void {
  if (word(tokens[start], 'if') && word(tokens[start + 1], 'exists')) start += 2;
  if (word(tokens[start], 'only')) start += 1;
  const relation = relationAt(tokens, start, state.schema);
  if (!relation || relation.schema === null) { clearKeys(state, true); return; }
  const clauses = clausesOf(tokens.slice(relation.next));
  if (!clauses) { forgetRelation(state, relation); return; }
  for (const clause of clauses) alterClause(state, relation, clause);
}

function dropTable(state: KeyState, tokens: SqlToken[], start: number): void {
  if (word(tokens[start], 'if') && word(tokens[start + 1], 'exists')) start += 2;
  for (const clause of clausesOf(tokens.slice(start)) ?? []) forgetRelation(state, relationAt(clause, 0, state.schema));
}

function searchPath(state: KeyState, tokens: SqlToken[]): void {
  const local = word(tokens[1], 'local');
  const start = local || word(tokens[1], 'session') ? 2 : 1;
  if (word(tokens[start], 'schema')) {
    const named = tokens[start + 1];
    state.schema = !local && named?.t === 'string' ? named.v : null;
    return;
  }
  if (!settingName(tokens[start], 'search_path')) {
    if (tokens.some((token) => settingName(token, 'search_path')) || word(tokens[start], 'all')) state.schema = null;
    return;
  }
  if (word(tokens[0], 'reset')) { state.schema = 'public'; return; }
  if (!word(tokens[start + 1], 'to') && tokens[start + 1]?.v !== '=') { state.schema = null; return; }
  const value = tokens[start + 2];
  const declared = identifier(value) ?? (value?.t === 'string' ? value.v : null);
  state.schema = local ? null : declared;
}

function createObject(tokens: SqlToken[]): { start: number; temporary: boolean } {
  let start = 1;
  if (word(tokens[start], 'or') && word(tokens[start + 1], 'replace')) start += 2;
  if (word(tokens[start], 'global') || word(tokens[start], 'local')) start += 1;
  const temporary = word(tokens[start], 'temp') || word(tokens[start], 'temporary');
  if (temporary || word(tokens[start], 'unlogged')) start += 1;
  if (word(tokens[start], 'unique')) start += 1;
  return { start, temporary };
}

/** CTAS, materialization and index building can call user code; event triggers also affect later DDL. */
function executingCreate(state: KeyState, tokens: SqlToken[], start: number): boolean {
  if (word(tokens[start], 'event') && word(tokens[start + 1], 'trigger')) {
    state.tainted = true;
    opaqueExecution(state);
    return true;
  }
  if (word(tokens[start], 'index') || (word(tokens[start], 'materialized') && word(tokens[start + 1], 'view'))) {
    opaqueExecution(state);
    return true;
  }
  if (!word(tokens[start], 'table')) return false;
  let depth = 0;
  for (const token of tokens.slice(start + 1)) {
    if (token.v === '(') depth += 1;
    if (token.v === ')') depth -= 1;
    if (depth === 0 && word(token, 'as')) { opaqueExecution(state); return true; }
  }
  return false;
}

function applyCreate(state: KeyState, tokens: SqlToken[]): void {
  // A private or temporary child also contributes rows to a public parent's ordinary SELECT.
  if (tokens.some((token) => word(token, 'inherits'))) { clearKeys(state, true); return; }
  const { start, temporary } = createObject(tokens);
  if (executingCreate(state, tokens, start)) return;
  if (temporary) { opaqueExecution(state); return; }
  if (word(tokens[start], 'table')) createTable(state, tokens, start + 1);
}

function applyTableCommand(state: KeyState, tokens: SqlToken[], command: (state: KeyState, tokens: SqlToken[], start: number) => void): void {
  if (word(tokens[1], 'table')) command(state, tokens, 2);
  else clearKeys(state, true);
}

/** Reduce only unconditional schema declarations; executable bodies may remove facts but never manufacture them. */
function applyStatement(state: KeyState, tokens: SqlToken[]): void {
  if (state.tainted) return;
  if (word(tokens[0], 'set') || word(tokens[0], 'reset')) { searchPath(state, tokens); return; }
  if (tokens[0]?.t === 'word' && OPAQUE_STATEMENTS.has(tokens[0].v)) { opaqueExecution(state); return; }
  if (word(tokens[0], 'commit') && word(tokens[1], 'prepared')) { opaqueExecution(state); return; }
  if (word(tokens[0], 'create')) { applyCreate(state, tokens); return; }
  if (word(tokens[0], 'alter')) { applyTableCommand(state, tokens, alterTable); return; }
  if (word(tokens[0], 'drop')) applyTableCommand(state, tokens, dropTable);
}

function activeMigrations(root: string): string[] | null {
  const listed = lsFiles(['-z', '--cached', '--exclude-standard', '--', MIGRATIONS_DIR], { dir: root, maxBuffer: 256 * 1024 * 1024 });
  if (listed.error || listed.status !== 0) return null;
  return listed.stdout.split('\0').filter((file: string) => path.posix.dirname(file) === MIGRATIONS_DIR
    && isMigrationName(path.posix.basename(file)) && migrationStamp(path.posix.basename(file).slice(0, 14)) !== null).sort(byCodeUnit);
}

/**
 * Public-table key sets proven by ordered, tracked active migrations. Direct event triggers taint later DDL proof.
 * Opaque bodies discard current facts; persistent schema machinery hidden inside them is outside static authority.
 */
export function sqlUniqueSetsOf(appRoot: string): Map<string, string[][]> {
  const root = path.resolve(appRoot);
  const files = activeMigrations(root);
  const state: KeyState = { tables: new Map(), safe: new Set(), schema: 'public', tainted: false };
  for (const file of files ?? []) {
    const text = readText(root, file);
    if (text === null) { clearKeys(state, true); state.schema = null; continue; }
    for (const statement of databaseSqlStatements(databaseSqlTokens(text))) applyStatement(state, statement);
  }
  return state.tainted ? new Map<string, string[][]>() : state.tables;
}
