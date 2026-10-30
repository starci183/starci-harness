import { installRefResolver } from './ref-value.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sleepSync as scaledSleepSync } from '../../scripts/lib/sleep-sync.mjs';
import type { SqlDb, SqlRow, SqlStatement } from './sqlite-types.mjs';

/** The fields a driver or machine error may carry. */
interface ErrorFields { code?: unknown; errcode?: unknown; message?: unknown }
const fieldsOf = (error: unknown): ErrorFields => (typeof error === 'object' && error !== null ? error : {});
/** A raw `DatabaseSync` as the resilient connection holds it. */
export interface RawConnection extends SqlDb { readonly isTransaction: boolean }
/** The resilient connection: the raw one behind retry-and-reopen, with `reopen` and `raw` as extras. */
export interface ResilientDb extends SqlDb { readonly isTransaction: boolean; reopen(): void; readonly raw: RawConnection }
/** A retry that recovered. */
export interface Recovery { where: string; retries: number; at: number }
/** The error persistent corruption raises, carrying the quick_check it observed. */
export type MachineCorruptError = Error & { code?: unknown; cause?: unknown; file?: string; retries?: number; where?: string; quickCheck?: string[] | null; deferred?: string };
/** Records a persistent corruption incident and returns the error to throw. */
export type IncidentReporter = (file: string, error: unknown, details: { retries: number; where: string }) => MachineCorruptError;

const require = createRequire(import.meta.url);
/** A statement or connection read by member name, for the proxies that forward whatever name is asked. */
type StatementMembers = Record<string | symbol, ((...args: unknown[]) => unknown) | undefined>;
/** The named member of a statement (a method the driver provides): called as written, so a missing one is the same TypeError it always was. */
const methodOf = (target: unknown, name: string | symbol): ((...args: unknown[]) => unknown) => (target as StatementMembers)[name] as (...args: unknown[]) => unknown;
export const MACHINE_BUSY_TIMEOUT_MS = 15000;
export const MACHINE_BUSY_CODE = 'STARCI_MACHINE_BUSY';
export const MACHINE_CORRUPT_CODE = 'STARCI_MACHINE_CORRUPT';
const OPEN_RETRY_DELAYS_MS = Object.freeze([0, 300, 900]);
const BUSY_RETRY_DELAYS_MS = Object.freeze([100, 300, 900, 2000]);
export const CORRUPT_RETRY_DELAYS_MS = Object.freeze([25, 150, 600]);
export const waitForRetry = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const isMachineBusy = (error: unknown): boolean => fieldsOf(error).code === MACHINE_BUSY_CODE;
export const isBusyError = (error: unknown): boolean => fieldsOf(error).errcode === 5 || fieldsOf(error).errcode === 6 || /SQLITE_BUSY|database is (?:locked|busy)/i.test(String(fieldsOf(error).message ?? error));
export const isCorruptError = (error: unknown): boolean => {
  if (!error) return false;
  if (fieldsOf(error).code === MACHINE_CORRUPT_CODE) return true;
  const code = Number(fieldsOf(error).errcode);
  if (Number.isInteger(code) && ((code & 0xff) === 11 || (code & 0xff) === 26)) return true;
  return /database disk image is malformed|file is not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(String(fieldsOf(error).message ?? error));
};
export const errText = (error: unknown): string => String(fieldsOf(error).message ?? error).slice(0, 500);
const busyError = (file: string, error: unknown, { retries, where }: { retries: number; where: string }) => Object.assign(new Error(`machine-db-busy: ${file} ${where}: database still locked after busy_timeout and ${retries} retries: ${String(fieldsOf(error).message ?? error).slice(0, 200)}`),
  { code: MACHINE_BUSY_CODE, cause: error, file, retries, where });

/** Persistent corruption diagnostics observe the store and stderr without recording an incident. */
export function corruptDiagnostic(file: string, error: unknown, { retries, where }: { retries: number; where: string }): MachineCorruptError {
  if (fieldsOf(error).code === MACHINE_CORRUPT_CODE) return error as MachineCorruptError; // it carries the corrupt code, so it is already this module's error
  const out: MachineCorruptError = Object.assign(new Error(`machine-db-corrupt: ${file} ${where}: SQLITE_CORRUPT persisted after ${retries} reopen(s): ${errText(error)}`),
    { code: MACHINE_CORRUPT_CODE, cause: error, file, retries, where });
  let check: string[] | null = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = installRefResolver(new DatabaseSync(file, { readOnly: true, timeout: MACHINE_BUSY_TIMEOUT_MS }));
    try { check = db.prepare('PRAGMA quick_check').all().map((r: SqlRow) => r.quick_check).slice(0, 20); } finally { db.close(); }
  } catch (e) { check = [`quick_check failed: ${errText(e)}`]; }
  out.quickCheck = check;
  process.stderr.write(`[machine-db] INCIDENT ${out.message} (quick_check: ${JSON.stringify(check)})\n`);
  return out;
}

/** Which open failure is retryable: a busy wait, an 'unable to open' reopen, or a first corrupt hit; null rethrows. */
const openFailureKind = (error: unknown): 'busy' | 'open' | 'corrupt' | null => {
  if (isBusyError(error) && !isCorruptError(error)) return 'busy';
  if (/unable to open/i.test(String(fieldsOf(error).message ?? ''))) return 'open';
  if (isCorruptError(error) && fieldsOf(error).code !== MACHINE_CORRUPT_CODE) return 'corrupt';
  return null;
};

const transientBusy = (error: unknown): boolean => isBusyError(error) && !isMachineBusy(error) && !isCorruptError(error);

function resilientConnection(openRaw: () => RawConnection, { file, inTransaction, onRecovered, onCorrupt }: { file: string; inTransaction: () => boolean; onRecovered: (r: { where: string; retries: number }) => void; onCorrupt: IncidentReporter }): ResilientDb {
  let raw = openRaw(), generation = 0;
  const reopen = () => { try { raw.close(); } catch { /* closed */ } raw = openRaw(); generation += 1; };
  const recoverCorrupt = (error: unknown, retries: number, where: string): void => {
    if (!isCorruptError(error) || fieldsOf(error).code === MACHINE_CORRUPT_CODE) throw error;
    if (inTransaction() || raw.isTransaction) throw error;
    if (retries >= CORRUPT_RETRY_DELAYS_MS.length) throw onCorrupt(file, error, { retries, where });
    waitForRetry(CORRUPT_RETRY_DELAYS_MS[retries] as number); // retries < the list length, by the check above
    try { reopen(); } catch (openError) { if (!isCorruptError(openError)) throw openError; }
  };
  const retrying = <T,>(where: string, op: () => T): T => {
    let busyRetries = 0;
    for (let retries = 0; ; retries += 1) {
      try {
        const out = op();
        if (retries) onRecovered({ where, retries });
        return out;
      } catch (error) {
        if (!transientBusy(error)) { recoverCorrupt(error, retries, where); continue; }
        if (inTransaction() || raw.isTransaction) throw error;
        if (busyRetries >= BUSY_RETRY_DELAYS_MS.length) throw busyError(file, error, { retries: busyRetries, where });
        scaledSleepSync(BUSY_RETRY_DELAYS_MS[busyRetries] as number); // busyRetries < the list length, by the check above
        busyRetries += 1;
        retries -= 1;
      }
    }
  };
  const prepare = (sql: string): SqlStatement => {
    let stmt: SqlStatement | null = null, gen = -1;
    const settings: Array<[string, unknown[]]> = [];
    const current = () => {
      if (gen !== generation) {
        stmt = raw.prepare(sql);
        for (const [k, a] of settings) methodOf(stmt, k).apply(stmt, a); // the driver's set* statement options, replayed on a reopened statement
        gen = generation;
      }
      return stmt as SqlStatement;
    };
    retrying(`prepare ${sql.slice(0, 80)}`, current);
    return new Proxy({} as SqlStatement, { // forwards to the current statement of the current connection generation
      get(_, prop) {
        if (prop === 'run' || prop === 'get' || prop === 'all' || prop === 'iterate') return (...args: unknown[]) => retrying(`${prop} ${sql.slice(0, 80)}`, () => (current()[prop] as (...a: unknown[]) => unknown)(...args));
        if (typeof prop === 'string' && /^set[A-Z]/.test(prop)) return (...args: unknown[]) => { settings.push([prop, args]); const target = current(); return methodOf(target, prop).apply(target, args); };
        const value = (current() as unknown as StatementMembers)[prop];
        return typeof value === 'function' ? value.bind(current()) : value;
      },
    });
  };
  return new Proxy({} as ResilientDb, { // forwards to the current raw connection
    get(_, prop) {
      if (prop === 'prepare') return prepare;
      if (prop === 'exec') return (sql: string) => retrying(`exec ${String(sql).slice(0, 80)}`, () => raw.exec(sql));
      if (prop === 'reopen') return reopen;
      if (prop === 'raw') return raw;
      const value = (raw as unknown as StatementMembers)[prop];
      return typeof value === 'function' ? value.bind(raw) : value;
    },
  });
}

/** Connection retries share one policy; the machine owner supplies operational incident persistence. */
export function machineConnectionMethods({ reportIncident }: { reportIncident: IncidentReporter }) {
  function openWithRetry<T>(openRaw: () => T, { file, onCorrupt = reportIncident }: { file: string; onCorrupt?: IncidentReporter }): T {
    let lastError: unknown, busyOpens = 0, failures = 0;
    const retryOpenFailure = (error: unknown): boolean => {
      lastError = error;
      const kind = openFailureKind(error);
      if (kind === null) throw error;
      if (kind === 'busy') {
        if (busyOpens >= BUSY_RETRY_DELAYS_MS.length) throw busyError(path.resolve(file), error, { retries: busyOpens, where: 'open' });
        scaledSleepSync(BUSY_RETRY_DELAYS_MS[busyOpens] as number); // busyOpens < the list length, by the check above
        busyOpens += 1;
        return true;
      }
      failures += 1;
      return failures < OPEN_RETRY_DELAYS_MS.length;
    };
    for (;;) {
      const delay = OPEN_RETRY_DELAYS_MS[failures];
      if (failures && delay) waitForRetry(delay);
      try { return openRaw(); }
      catch (error) { if (!retryOpenFailure(error)) break; }
    }
    if (isCorruptError(lastError)) throw onCorrupt(path.resolve(file), lastError, { retries: OPEN_RETRY_DELAYS_MS.length - 1, where: 'open' });
    throw lastError;
  }

  function connectionState(openRaw: () => RawConnection, { file, inTransaction = () => false, onCorrupt = reportIncident }: { file: string; inTransaction?: () => boolean; onCorrupt?: IncidentReporter }) {
    const recovered: Recovery[] = [];
    const noteRecovered = (r: { where: string; retries: number }): void => {
      recovered.push({ ...r, at: Date.now() });
      process.stderr.write(`[machine-db] transient SQLITE_CORRUPT recovered after ${r.retries} reopen(s) at ${r.where} (${file})\n`);
    };
    const db = resilientConnection(openRaw, { file, inTransaction, onRecovered: noteRecovered, onCorrupt });
    return { db, recovered, noteRecovered, close() { try { db.close(); } catch { /* closed */ } } };
  }

  return { openWithRetry, connectionState };
}
