import type { DatabaseSync } from "node:sqlite"
import { now } from "./ledger.js"
import { withMachine } from "./machine.js"

/**
 * The slot tables of the host store (machine.sqlite, ledger.ts `machinePath`: one file per host, whatever checkout, installed CLI or working folder
 * asks), one table per concept:
 * - lane_slots: a lane slot held (ops/slots.yaml kinds: npm, gate, shoot, stack), one row per (kind, n). The row names the lane and the ONE process
 *   it lives as long as (`pid`, with its OS start so a reused pid is told apart), the command it runs and, once spawned, the child that does the work
 *   (`child_pid`, `child_start`). It is deleted when that process lets the slot go (normal end, error or signal) and reclaimed once the process is
 *   proven gone.
 * - slot_events: what happened to a slot (taken, released, reclaimed, killed), with who did it and the evidence, append-only.
 * The heavy-command governor's rows (`heavy_slots`) live in the same store (harness/heavy.ts) and log into slot_events too.
 */
const TABLES = `
CREATE TABLE IF NOT EXISTS lane_slots (
  kind TEXT NOT NULL, n INTEGER NOT NULL, lane TEXT NOT NULL, pid INTEGER NOT NULL, pid_start TEXT NOT NULL,
  child_pid INTEGER, child_start TEXT, command TEXT NOT NULL, cwd TEXT NOT NULL, boot TEXT NOT NULL, host TEXT NOT NULL,
  taken_at TEXT NOT NULL, PRIMARY KEY (kind, n));
CREATE INDEX IF NOT EXISTS lane_slots_by_lane ON lane_slots (lane, kind);
CREATE TABLE IF NOT EXISTS slot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, slot TEXT NOT NULL, holder TEXT,
  pid INTEGER, child_pid INTEGER, command TEXT, by TEXT NOT NULL, evidence TEXT NOT NULL);
`

/** Runs `work` on the host store with the slot tables in place, atomically (BEGIN IMMEDIATE). */
export const withSlotStore = <T>(work: (db: DatabaseSync) => T): T =>
    withMachine((db) => {
        db.exec(TABLES)
        return work(db)
    })

/** One lane slot row. */
export interface SlotRow {
    readonly kind: string
    readonly n: number
    readonly lane: string
    readonly pid: number
    readonly pidStart: string
    readonly childPid: number | null
    readonly childStart: string | null
    readonly command: string
    readonly cwd: string
    readonly boot: string
    readonly host: string
    readonly takenAt: string
}

const textOr = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback)

/** A row as read from SQLite. */
export const rowOf = (row: Record<string, unknown>): SlotRow => ({
    kind: textOr(row.kind, ""),
    n: Number(row.n),
    lane: textOr(row.lane, ""),
    pid: Number(row.pid),
    pidStart: textOr(row.pid_start, ""),
    childPid: row.child_pid === null || row.child_pid === undefined ? null : Number(row.child_pid),
    childStart: typeof row.child_start === "string" ? row.child_start : null,
    command: textOr(row.command, ""),
    cwd: textOr(row.cwd, ""),
    boot: textOr(row.boot, ""),
    host: textOr(row.host, ""),
    takenAt: textOr(row.taken_at, ""),
})

/** Every lane slot row of the given kinds (all when none), by kind and number. */
export const slotRows = (db: DatabaseSync, kinds: readonly string[] = []): SlotRow[] =>
    db
        .prepare("SELECT * FROM lane_slots ORDER BY kind, n")
        .all()
        .map((row) => rowOf(row))
        .filter((row) => kinds.length === 0 || kinds.includes(row.kind))

/** Inserts a row; false when the (kind, n) is taken already. */
export const insertRow = (db: DatabaseSync, row: SlotRow): boolean =>
    Number(
        db
            .prepare("INSERT INTO lane_slots (kind, n, lane, pid, pid_start, child_pid, child_start, command, cwd, boot, host, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (kind, n) DO NOTHING")
            .run(row.kind, row.n, row.lane, row.pid, row.pidStart, row.childPid, row.childStart, row.command, row.cwd, row.boot, row.host, row.takenAt).changes,
    ) === 1

/** Deletes the row exactly as it was read (its lane, pid and time), so a slot taken again in between stays; true when it went. */
export const deleteRow = (db: DatabaseSync, row: Pick<SlotRow, "kind" | "n" | "lane" | "pid" | "takenAt">): boolean =>
    Number(db.prepare("DELETE FROM lane_slots WHERE kind = ? AND n = ? AND lane = ? AND pid = ? AND taken_at = ?").run(row.kind, row.n, row.lane, row.pid, row.takenAt).changes) === 1

/** One event of a slot. */
export interface SlotEvent {
    readonly action: "taken" | "released" | "reclaimed" | "killed"
    /** The slot: `<kind> <n>` of a lane slot, `heavy <id>` of a heavy one, or a foreign lock file's path. */
    readonly slot: string
    readonly holder?: string | null
    readonly pid?: number | null
    readonly childPid?: number | null
    readonly command?: string | null
    readonly by: string
    readonly evidence: string
}

/** Appends one event inside an open store. */
export const logEvent = (db: DatabaseSync, event: SlotEvent): void => {
    db.exec(TABLES)
    db.prepare("INSERT INTO slot_events (at, action, slot, holder, pid, child_pid, command, by, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        now(),
        event.action,
        event.slot,
        event.holder ?? null,
        event.pid ?? null,
        event.childPid ?? null,
        event.command ?? null,
        event.by,
        event.evidence,
    )
}

/** Appends one event on its own; never fails the caller (the log is a record, the slot change already stands). */
export const recordEvent = (event: SlotEvent): void => {
    try {
        withSlotStore((db) => {
            logEvent(db, event)
        })
    } catch {
        // a busy or unreadable store loses one log line, never a release
    }
}

/** The newest `limit` events, newest last. */
export const recentEvents = (limit: number): (SlotEvent & { readonly at: string })[] =>
    withSlotStore((db) =>
        db
            .prepare("SELECT * FROM slot_events ORDER BY id DESC LIMIT ?")
            .all(limit)
            .reverse()
            .map((row) => ({
                at: String(row.at),
                action: String(row.action) as SlotEvent["action"],
                slot: String(row.slot),
                holder: typeof row.holder === "string" ? row.holder : null,
                pid: row.pid === null ? null : Number(row.pid),
                childPid: row.child_pid === null ? null : Number(row.child_pid),
                command: typeof row.command === "string" ? row.command : null,
                by: String(row.by),
                evidence: String(row.evidence),
            })),
    )

/** When this process started, as the OS would report it (epoch ms): now less its uptime. Free, unlike asking the OS for another pid's start. */
export const selfStartMs = (): number => Math.round(Date.now() - process.uptime() * 1000)
