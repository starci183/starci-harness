// sqlite.mjs — the small better-sqlite3 probes the ledger and machine stores share. The handle is the
// caller's; these helpers prepare statements on it and return its own result shapes.

/** A prepared better-sqlite3 statement, as far as these helpers use it. */
export interface SqliteStatement<Run = unknown> {
  get(...params: unknown[]): unknown;
  all<Row = Record<string, unknown>>(...params: unknown[]): Row[];
  run(...params: unknown[]): Run;
}
/** A better-sqlite3 database handle, as far as these helpers use it; `Run` is what its statements' run() reports. */
export interface SqliteDb<Run = unknown> { prepare(sql: string): SqliteStatement<Run> }

/** Whether the database holds a table `name` (`views: true` also counts views). */
export const hasTable = (db: SqliteDb, name: string, { views = false }: { views?: boolean } = {}): boolean =>
  Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type${views ? " IN ('table','view')" : "='table'"} AND name=?`).get(name));

/**
 * INSERT the [column, value] `pairs` into `table` (`orIgnore` spells OR IGNORE); returns the statement's
 * run() result. Column naming and value encoding are the caller's — this is only the statement shape.
 */
const insertPairs = <Run,>(db: SqliteDb<Run>, table: string, pairs: readonly (readonly [string, unknown])[], { orIgnore = false }: { orIgnore?: boolean } = {}): Run =>
  db.prepare(`INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${table}(${pairs.map((p) => p[0]).join(',')}) VALUES(${pairs.map(() => '?').join(',')})`)
    .run(...pairs.map((p) => p[1]));

/**
 * The per-store `insertRow`: binds the caller's own [column, value] mapper (`cellsOf` — where the store's
 * column validation and value encoding live) to an insertPairs statement.
 */
export const insertRowWith = <Run, Db extends SqliteDb<Run>, Row>(cellsOf: (db: Db, table: string, row: Row) => readonly (readonly [string, unknown])[]) => (db: Db, table: string, row: Row, { orIgnore = false }: { orIgnore?: boolean } = {}): Run =>
  insertPairs<Run>(db, table, cellsOf(db, table, row), { orIgnore });
