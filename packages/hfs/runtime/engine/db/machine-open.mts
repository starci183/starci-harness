import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { installRefResolver, openReadOnlyDb } from './ref-value.mjs';
import { MACHINE_BUSY_TIMEOUT_MS, isBusyError } from './machine-connection.mjs';
import type { IncidentReporter } from './machine-connection.mjs';
import type { SqlDb } from './sqlite-types.mjs';

// engine/db/machine-open.mjs — how machine.sqlite is opened: the connection policy of the machine.mjs header, a reference-resolving handle.
const require = createRequire(import.meta.url);
function need(ok: unknown, message: string, code = 'STARCI_MACHINE_DB'): asserts ok { if (!ok) throw Object.assign(new Error(message), { code }); }
const busyTimeoutOf = (env: NodeJS.ProcessEnv = process.env): number => { const n = Number(env?.STARCI_MACHINE_BUSY_TIMEOUT_MS); return Number.isInteger(n) && n > 0 ? n : MACHINE_BUSY_TIMEOUT_MS; };
const writerPragmas = (env: NodeJS.ProcessEnv): Record<string, string | number> => ({ synchronous: 'NORMAL', busy_timeout: busyTimeoutOf(env), temp_store: 'MEMORY', cache_size: -16000,
  journal_size_limit: 67108864, trusted_schema: 'OFF' });
export const pragma = (db: SqlDb, name: string): unknown => { const row = db.prepare(`PRAGMA ${name}`).get(); return row ? Object.values(row)[0] : null; };

function recordFacts(db: SqlDb): void {
  const facts: Record<string, string> = { sqlite_version: db.prepare('select sqlite_version() v').get()?.v, node_version: process.version, journal_mode: String(pragma(db, 'journal_mode')).toLowerCase() };
  const stale = Object.entries(facts).filter(([k, v]) => db.prepare('SELECT value FROM machine_meta WHERE key=?').get(k)?.value !== v);
  if (!stale.length) return;
  const put = db.prepare('INSERT INTO machine_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  try { for (const [k, v] of stale) put.run(k, v); } catch (error) { if (!isBusyError(error)) throw error; /* another writer records them */ }
}

/** What the connection opener is bound to: the schema methods, the retrying opener and the corruption reporter of machine.mjs. */
export interface MachineOpenDeps {
  checkSchema(db: SqlDb, file: string): void;
  createSchema(db: SqlDb, context: { file: string; env: NodeJS.ProcessEnv; now: () => number }): void;
  openWithRetry<T>(openRaw: () => T, options: { file: string; onCorrupt?: IncidentReporter }): T;
  corruptIncident: IncidentReporter;
}

/** The connection opener bound to the schema methods and the corruption reporter of machine.mjs. */
export function machineOpenMethods({ checkSchema, createSchema, openWithRetry, corruptIncident }: MachineOpenDeps) {
  function openConnection(file: string, { readOnly = false, env = process.env, now = Date.now, onCorrupt = corruptIncident }: { readOnly?: boolean; env?: NodeJS.ProcessEnv; now?: () => number; onCorrupt?: IncidentReporter } = {}): SqlDb {
    const { DatabaseSync } = require('node:sqlite');
    need(typeof file === 'string' && file.trim(), 'openMachine needs a file');
    if (!readOnly) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    return openWithRetry((): SqlDb => {
      let db: SqlDb | undefined;
      try {
        if (readOnly) {
          db = openReadOnlyDb(file, MACHINE_BUSY_TIMEOUT_MS);
          db.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-16000;');
          checkSchema(db, file);
          return db;
        }
        db = installRefResolver<SqlDb>(new DatabaseSync(file, { timeout: busyTimeoutOf(env) }));
        const empty = Number(pragma(db, 'user_version')) === 0 && !db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' LIMIT 1").get();
        if (!empty) checkSchema(db, file); // Refuse a store that is not exactly the current schema before persistent WAL/facts changes.
        if (empty) db.exec('PRAGMA page_size=4096; PRAGMA auto_vacuum=INCREMENTAL;');
        const mode = String(pragma(db, 'journal_mode=WAL')).toLowerCase();
        need(mode === 'wal', `machine.sqlite journal_mode is '${mode}', not wal (${file})`, 'STARCI_MACHINE_NOT_WAL');
        db.exec('PRAGMA foreign_keys=ON;');
        for (const [k, v] of Object.entries(writerPragmas(env))) db.exec(`PRAGMA ${k}=${v};`);
        // Never an automatic checkpoint: the engine leader's fenced checkpoint() is the only one (header, G17).
        db.exec('PRAGMA wal_autocheckpoint=0;');
        if (empty) createSchema(db, { file, env, now });
        checkSchema(db, file);
        recordFacts(db);
        return db;
      } catch (error) {
        try { db?.close(); } catch { /* closed */ }
        throw error;
      }
    }, { file, onCorrupt });
  }

  return { openConnection };
}
