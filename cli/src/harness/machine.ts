import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { inTransaction } from "./leases.js"
import { machinePath, openMachine } from "./ledger.js"
import { CLOSED_SEAT_STATUSES, SEAT_STOPPED, SEAT_WORKER_LOST } from "./seats.js"

/**
 * The host-wide tables P2 adds to machine.sqlite, beside ledger.ts's `ledgers` and `provider_health` (the circuit row of a
 * provider). Additive only: a table is created when missing and never altered or dropped.
 * - provider_events: every outcome, open, recover and quota reading of a provider, append-only; reopens are counted from it.
 * - pool_quota: the newest quota reading of a pool's window, in percent; no row means unknown.
 * - pool_concurrency: a pool's AIMD cap below its maxParallel; no row means the pool runs at its max.
 * - pool_windows: every usage window of a pool as its provider last reported it (percent used, length, reset), for the pace.
 * - route_picks: the router's recent picks per tier, for the balance step's streak and the exploration share.
 * - member_outcomes: every ended attempt of every registered ledger, per member and label, for qualification and scoring.
 * - budgets / budget_raises: a workflow's raised ceilings (keyed by ledger and workflow) and who raised them and why.
 * - host_events: what the host driver (`supervisor tick`) did to the Supervisor seats (nudges, give-ups), append-only.
 * - owner_requests: each project's mailbox of owner requests (`supervisor ask`), closed by the Supervisor command answering one
 *   (harness/owner-requests.ts).
 */
const TABLES = `
CREATE TABLE IF NOT EXISTS provider_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, data_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS provider_events_by_provider ON provider_events (provider, kind, at);
CREATE TABLE IF NOT EXISTS pool_quota (
  pool TEXT PRIMARY KEY, used_percent REAL NOT NULL, resets_at TEXT, observed_at TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pool_concurrency (
  pool TEXT PRIMARY KEY, cap INTEGER NOT NULL, max INTEGER NOT NULL, halvings INTEGER NOT NULL DEFAULT 0,
  last_throttle_at TEXT, last_decrease_at TEXT, last_increase_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pool_windows (
  pool TEXT NOT NULL, window TEXT NOT NULL, used_percent REAL NOT NULL, window_minutes REAL, resets_at TEXT, observed_at TEXT NOT NULL,
  source TEXT NOT NULL, PRIMARY KEY (pool, window));
CREATE TABLE IF NOT EXISTS member_outcomes (
  ledger TEXT NOT NULL, attempt_id TEXT NOT NULL, member TEXT NOT NULL, pool TEXT NOT NULL, label TEXT NOT NULL, class TEXT NOT NULL,
  minutes REAL, ended_at TEXT NOT NULL, PRIMARY KEY (ledger, attempt_id));
CREATE INDEX IF NOT EXISTS member_outcomes_by_member ON member_outcomes (member, label, ended_at);
CREATE TABLE IF NOT EXISTS route_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, tier TEXT NOT NULL, member TEXT NOT NULL, pool TEXT NOT NULL,
  label TEXT NOT NULL, chosen_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS budgets (
  ledger_id TEXT NOT NULL, workflow_id TEXT NOT NULL, minutes INTEGER NOT NULL, tries INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (ledger_id, workflow_id));
CREATE TABLE IF NOT EXISTS host_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner_requests (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, project_root TEXT NOT NULL, by TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
  closed_by TEXT, closed_at TEXT, workflow_id TEXT, repository TEXT);
CREATE INDEX IF NOT EXISTS open_owner_requests ON owner_requests (project, closed_at, at);
CREATE TABLE IF NOT EXISTS budget_raises (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id TEXT NOT NULL, workflow_id TEXT NOT NULL, by TEXT NOT NULL, reason TEXT NOT NULL,
  minutes_by INTEGER NOT NULL, tries_by INTEGER NOT NULL, at TEXT NOT NULL);
`

/** Runs `work` on the host store with the P2 tables in place, atomically (BEGIN IMMEDIATE), and closes it. */
export const withMachine = <T>(work: (db: DatabaseSync) => T): T => {
    const db = openMachine()
    try {
        db.exec(TABLES)
        return inTransaction(db, () => work(db))
    } finally {
        db.close()
    }
}

/** Reads the host store; with no machine.sqlite yet nothing is created and `empty` is the answer. */
export const readMachine = <T>(work: (db: DatabaseSync) => T, empty: T): T => (existsSync(machinePath()) ? withMachine(work) : empty)

/** A TEXT column as a string, null kept. */
export const textOf = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    return typeof value === "string" ? value : JSON.stringify(value)
}

/** Appends one provider event. */
export const recordProviderEvent = (db: DatabaseSync, provider: string, kind: string, data: unknown, at: string): void => {
    db.prepare("INSERT INTO provider_events (provider, at, kind, data_json) VALUES (?, ?, ?, ?)").run(provider, at, kind, JSON.stringify(data))
}

/** The worker and coordinator seats running now on this host, per member `agent/model` and per agent, across every registered project ledger. */
export interface RunningWorkers {
    readonly byMember: ReadonlyMap<string, number>
    readonly byAgent: ReadonlyMap<string, number>
}

// A seat that is stopped, lost or closed runs no worker; anything else (starting, ready, launch-unknown, ...) may hold a slot.
const NOT_RUNNING: ReadonlySet<string> = new Set([...CLOSED_SEAT_STATUSES, SEAT_STOPPED, SEAT_WORKER_LOST])

/**
 * Counts the open worker seats of every ledger the host registry lists, read-only: a pool's slots are host-wide, so the
 * capacity and balance steps must see every project. A ledger that cannot be read is skipped, never created.
 */
export const runningWorkers = (): RunningWorkers => {
    const byMember = new Map<string, number>()
    const byAgent = new Map<string, number>()
    const count = (agent: string, model: string | null): void => {
        const member = `${agent}/${model ?? "?"}`
        byMember.set(member, (byMember.get(member) ?? 0) + 1)
        byAgent.set(agent, (byAgent.get(agent) ?? 0) + 1)
    }
    // Every project's live Supervisor, and the host Supervisor a version-2 store may still run until it is retired.
    const supervisors = readMachine((db) => {
        const host = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supervisors'").get() === undefined ? "" : " UNION ALL SELECT agent, model FROM supervisors WHERE ended_at IS NULL"
        return db.prepare(`SELECT agent, model FROM project_supervisors WHERE ended_at IS NULL${host}`).all()
    }, [])
    for (const seat of supervisors) {
        const agent = textOf(seat.agent)
        if (agent !== null) count(agent, textOf(seat.model))
    }
    const files = readMachine((db) => db.prepare("SELECT file FROM ledgers WHERE state != 'retired'").all().map((row) => textOf(row.file) ?? ""), [])
    for (const file of files) {
        if (file === "" || !existsSync(file)) continue
        let ledger: DatabaseSync | undefined
        try {
            ledger = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
            for (const row of ledger.prepare("SELECT * FROM seats WHERE role IN ('worker', 'kernel')").all()) {
                const status = textOf(row.status) ?? ""
                const agent = textOf(row.agent)
                if (NOT_RUNNING.has(status) || agent === null || textOf(row.ended_at) !== null) continue
                count(agent, textOf(row.model))
            }
        } catch {
            // A ledger that cannot be opened or read now (locked, damaged) is not counted; the next pick reads it again.
        } finally {
            ledger?.close()
        }
    }
    return { byMember, byAgent }
}
