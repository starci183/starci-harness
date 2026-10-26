import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

/** The ledger schema version this build writes. */
export const LEDGER_VERSION = 1

/**
 * The ten tables of the harness ledger. Status rules live in the code's one state machine, not in triggers;
 * the tables only keep facts (contracts and results are immutable once written).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY, goal_json TEXT NOT NULL, goal_version INTEGER NOT NULL DEFAULT 1,
  graph_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, workflow_id TEXT REFERENCES workflows(id), label TEXT NOT NULL,
  contract_json TEXT NOT NULL, contract_hash TEXT NOT NULL, try_no INTEGER NOT NULL DEFAULT 1,
  retry_of TEXT REFERENCES tasks(id), status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), seq INTEGER NOT NULL,
  pick_json TEXT, agent TEXT, model TEXT, outcome TEXT, verdict TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, UNIQUE (task_id, seq));
CREATE TABLE IF NOT EXISTS results (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), status TEXT NOT NULL,
  output_json TEXT NOT NULL, filed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, attempt_id TEXT, contract_hash TEXT NOT NULL,
  name TEXT NOT NULL, runner TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
  detail TEXT NOT NULL, ran_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leases (
  path TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id), token TEXT NOT NULL,
  expires_at TEXT NOT NULL, PRIMARY KEY (path, task_id));
CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, agent TEXT, handle TEXT, task_id TEXT,
  status TEXT NOT NULL, last_pong_at TEXT, started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, seat_id TEXT NOT NULL, command TEXT NOT NULL, correlation_id TEXT,
  deadline_at TEXT NOT NULL, sent_at TEXT NOT NULL, answered_at TEXT, answer_json TEXT);
CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY, status TEXT NOT NULL, strikes INTEGER NOT NULL DEFAULT 0,
  failure_kind TEXT, circuit_open_until TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL,
  subject TEXT, data_json TEXT NOT NULL);
`

/** The project's work folder, which holds its ledger. */
export const WORK_DIR = ".starciwork"

/** The ledger of a project: <root>/.starciwork/runtime.sqlite, one per project, never committed. */
export const ledgerPath = (root: string): string => join(root, WORK_DIR, "runtime.sqlite")

/** Opens (and creates or migrates) the ledger of a project, with WAL and a busy timeout for concurrent seats. */
export const openLedger = (root: string): DatabaseSync => {
    mkdirSync(join(root, WORK_DIR), { recursive: true })
    const db = new DatabaseSync(ledgerPath(root))
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;")
    db.exec(SCHEMA)
    db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(LEDGER_VERSION))
    return db
}

/** The current time as the ledger stores it. */
export const now = (): string => new Date().toISOString()
