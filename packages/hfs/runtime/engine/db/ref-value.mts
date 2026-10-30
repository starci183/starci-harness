// ref-value.mjs — the one accessor of a column that holds content or a reference to it (the storage convention: content is a file in the blob store under the runtime state
// dir, a row holds the reference).
//
// A column that may hold content holds either the content inline (the legacy shape, every row written before the convention) or a REFERENCE: the JSON stub machine.sqlite already
// writes for a value it keeps in the blob store, {"truncated":true,"bytes":<n>,"sha256":"<sha>"} (valid JSON, so it also passes a column's json_valid check). Every handle either
// store opens installs the resolver below, so a reader that selects such a column gets the content whichever shape the row has; a writer stores content with putContent, which
// keeps a short value inline and puts a long one in the blob store. A value is resolved byte for byte: the blob holds exactly the text the writer was given.
import { createRequire } from 'node:module';
import { getBlob } from './blob.mjs';
import type { SqlDb, SqlStatement } from './sqlite-types.mjs';

const REF = /^\{"truncated":true,"bytes":(\d+),"sha256":"([0-9a-f]{64})"\}$/;

/** Whether a stored value is a reference. */
export const isRef = (value: unknown): value is string => typeof value === 'string' && value.codePointAt(0) === 123 && REF.test(value);

/** The reference string of a blob. */
export const refOf = (sha: string, bytes: number): string => JSON.stringify({ truncated: true, bytes, sha256: sha });

/** The {sha, bytes} a reference names, or null. */
export function parseRef(value: unknown): { sha: string; bytes: number } | null {
  const match = typeof value === 'string' && value.codePointAt(0) === 123 ? REF.exec(value) : null;
  return match ? { sha: match[2] as string, bytes: Number(match[1]) } : null;
}

/** The content behind a stored value: a reference is read from the blob store (utf8), anything else is the content itself. */
function resolveValue(value: unknown): unknown {
  const ref = parseRef(value);
  if (!ref) return value;
  return getBlob(ref.sha).toString('utf8');
}


const resolveRow = <R,>(row: R): R => {
  if (row === null || row === undefined || typeof row !== 'object') return row;
  const cells = row as Record<string, unknown>; // an object row, by the check above
  for (const key of Object.keys(cells)) if (isRef(cells[key])) cells[key] = resolveValue(cells[key]);
  return row;
};

/**
 * Makes every row a statement of `db` returns resolve its reference values: get, all and iterate. The handle is changed in place and returned; a handle that was already
 * installed is left alone. Other statement methods (run, columns, ...) are the statement's own.
 */
/** A SQLite file opened read-only with the given busy timeout, its references resolving. */
export const openReadOnlyDb = (file: string, timeoutMs: number): SqlDb => installRefResolver(new (createRequire(import.meta.url)('node:sqlite').DatabaseSync)(file, { readOnly: true, timeout: timeoutMs }));

/** A statement over exact stored cells, for self-contained archives that retain references and their original bytes. */
export const prepareStored = (db: SqlDb, sql: string, ...rest: unknown[]): SqlStatement => Object.getPrototypeOf(db).prepare.call(db, sql, ...rest);

export function installRefResolver<D extends SqlDb>(db: D): D {
  if ((db as D & { __refResolver?: boolean }).__refResolver) return db;
  // The prototype's prepare is looked up at each call, so a later change of the driver's own method (a spec's mock, a corruption injection) still applies.
  db.prepare = (sql: string, ...rest: unknown[]) => {
    const statement = prepareStored(db, sql, ...rest);
    return new Proxy(statement, {
      get(target, name) {
        const member: unknown = Reflect.get(target, name);
        if (typeof member !== 'function') return member;
        if (name === 'get') return (...args: unknown[]) => resolveRow(member.apply(target, args));
        if (name === 'all') return (...args: unknown[]) => member.apply(target, args).map(resolveRow);
        if (name === 'iterate') return (...args: unknown[]) => (function* resolved(iterator: Iterable<unknown>) { for (const row of iterator) yield resolveRow(row); })(member.apply(target, args));
        return member.bind(target);
      },
    });
  };
  Object.defineProperty(db, '__refResolver', { value: true });
  return db;
}
