// sqlite-types.mts — the shapes of the node:sqlite handle and statement the engine's stores use (types only, no runtime).
// node:sqlite types its numbers as number | bigint and its rows as an open record; the stores read columns by name and
// never ask for bigints, so these narrower shapes state what the code relies on.

/** A bound SQL parameter: the engine passes strings, numbers, null and Buffers (booleans are mapped to 0/1 before binding). */
export type SqlParam = unknown;

// reason: a row from the sqlite driver; its columns are read by name and typed by the table's DDL, which TypeScript cannot see.
export type SqlRow = Record<string, any>;

/** What a write statement reports. */
export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number;
}

/** A prepared statement. */
export interface SqlStatement {
  run(...params: SqlParam[]): SqlRunResult;
  get(...params: SqlParam[]): SqlRow | undefined;
  all<Row = SqlRow>(...params: SqlParam[]): Row[];
  iterate(...params: SqlParam[]): IterableIterator<SqlRow>;
}

/** An open sqlite database handle (a raw `DatabaseSync` or the engine's resilient wrapper over one). */
export interface SqlDb {
  prepare(sql: string, ...rest: unknown[]): SqlStatement;
  exec(sql: string): void;
  close(): void;
  readonly isTransaction: boolean;
}

/** The part of a machine handle that its row writers use: the connection, the clock and the fenced transaction. */
export interface StoreHandle {
  db: SqlDb;
  now(): number;
  transaction<T>(fn: (db: SqlDb) => T): T;
}
