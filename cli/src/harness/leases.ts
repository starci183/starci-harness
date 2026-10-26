import { randomUUID } from "node:crypto"
import { posix } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { now } from "./ledger.js"
import type { TaskRow, TaskStatus } from "./tasks.js"
import { recordEvent, TRANSITIONS } from "./tasks.js"

/** Minutes past its task's budget a lease is due; the due time is information for the Kernel, never a reason to drop the lease. */
export const LEASE_GRACE_MINUTES = 15

/**
 * One path lease: a task holds a repository path (and everything below it) until the task ends. `expiresAt` only says when
 * the task was due (`overdue` once passed); time alone never frees a path, because a task that is still running may still write.
 */
export interface LeaseRow {
    readonly path: string
    readonly taskId: string
    readonly token: string
    readonly expiresAt: string
    readonly taskStatus: TaskStatus
    readonly live: boolean
    readonly overdue: boolean
}

/** The leases one task took. */
export interface LeaseGrant {
    readonly taskId: string
    readonly token: string
    readonly expiresAt: string
    readonly paths: readonly string[]
}

/** Statuses with no way out: a task in one of them holds nothing. */
const TERMINAL: readonly TaskStatus[] = (Object.keys(TRANSITIONS) as TaskStatus[]).filter((status) => TRANSITIONS[status].length === 0)

const TERMINAL_SQL = TERMINAL.map((status) => `'${status}'`).join(", ")

/** True for a status no transition leaves: the task has ended. */
export const isTerminal = (status: TaskStatus): boolean => TERMINAL.includes(status)

/**
 * A repository path as leases compare it: posix separators, no `./` or `.` segments, no doubled or trailing slash.
 * Leases keep their own normaliser until contract.ts exports one for allowPaths; both must then be the same function.
 */
export const normaliseLeasePath = (path: string): string => posix.normalize(path.replace(/\\/g, "/")).replace(/\/+$/, "")

/** Two leased paths overlap when one equals the other or is a directory prefix of it, compared segment by segment. */
export const pathsOverlap = (left: string, right: string): boolean => {
    const a = normaliseLeasePath(left).split("/")
    const b = normaliseLeasePath(right).split("/")
    const shorter = a.length <= b.length ? a : b
    const longer = shorter === a ? b : a
    return shorter.every((segment, index) => segment === longer[index])
}

/**
 * Runs `work` atomically. Outside a transaction it takes the write lock up front (BEGIN IMMEDIATE), so a read
 * followed by a write cannot lose a race to another seat; inside one it nests as a savepoint.
 */
export const inTransaction = <T>(db: DatabaseSync, work: () => T): T => {
    const nested = db.isTransaction
    db.exec(nested ? "SAVEPOINT starci_tx" : "BEGIN IMMEDIATE")
    try {
        const value = work()
        db.exec(nested ? "RELEASE starci_tx" : "COMMIT")
        return value
    } catch (error: unknown) {
        db.exec(nested ? "ROLLBACK TO starci_tx; RELEASE starci_tx" : "ROLLBACK")
        throw error
    }
}

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const toLease = (row: Record<string, unknown>, at: string): LeaseRow => {
    const taskStatus = text(row.status) as TaskStatus
    const expiresAt = text(row.expires_at)
    return { path: text(row.path), taskId: text(row.task_id), token: text(row.token), expiresAt, taskStatus, live: !isTerminal(taskStatus), overdue: expiresAt <= at }
}

/** Deletes the leases of tasks that ended, and only those: a lease of a live task is never expired by time. Returns how many it removed. */
export const sweepLeases = (db: DatabaseSync): number => {
    const swept = db.prepare(`DELETE FROM leases WHERE task_id IN (SELECT id FROM tasks WHERE status IN (${TERMINAL_SQL}))`).run()
    const count = Number(swept.changes)
    if (count > 0) recordEvent(db, "leases-swept", null, { count })
    return count
}

/** Every lease row, or those of one task, with whether it still holds; a pure read that sweeps nothing. */
export const listLeases = (db: DatabaseSync, taskId?: string): LeaseRow[] => {
    const at = now()
    const select = "SELECT leases.*, tasks.status FROM leases JOIN tasks ON tasks.id = leases.task_id"
    const rows = taskId === undefined ? db.prepare(`${select} ORDER BY leases.path`).all() : db.prepare(`${select} WHERE leases.task_id = ? ORDER BY leases.path`).all(taskId)
    return rows.map((row) => toLease(row, at))
}

const dueAt = (task: TaskRow): string => new Date(Date.now() + (task.contract.budget.minutes + LEASE_GRACE_MINUTES) * 60_000).toISOString()

/** The lease paths of a task: its allowPaths, normalised and without duplicates. */
export const leasePaths = (task: TaskRow): string[] => [...new Set(task.contract.context.allowPaths.map(normaliseLeasePath))]

/**
 * Takes one lease per allowPath of the task, all or nothing: a path that overlaps a lease of another live task
 * refuses the whole grant with LEASE_CONFLICT, however overdue that lease is. Leases of ended tasks are swept first.
 */
export const acquireLeases = (db: DatabaseSync, task: TaskRow): LeaseGrant =>
    inTransaction(db, () => {
        sweepLeases(db)
        const paths = leasePaths(task)
        const held = listLeases(db).filter((lease) => lease.taskId !== task.id && lease.live)
        for (const path of paths) {
            const holder = held.find((lease) => pathsOverlap(lease.path, path))
            if (holder !== undefined) {
                throw new Refusal("LEASE_CONFLICT", `${path} overlaps ${holder.path}, leased by task ${holder.taskId} (${holder.taskStatus}, due ${holder.expiresAt}) until that task ends`)
            }
        }
        const token = randomUUID()
        const expiresAt = dueAt(task)
        const insert = db.prepare("INSERT INTO leases (path, task_id, token, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(path, task_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at")
        for (const path of paths) insert.run(path, task.id, token, expiresAt)
        recordEvent(db, "leases-acquired", task.id, { paths, expiresAt })
        return { taskId: task.id, token, expiresAt, paths }
    })

/** Moves the due time of a task's leases to its budget from now; called when the task moves (a seat starts on it). Returns how many it renewed. */
export const renewLeases = (db: DatabaseSync, task: TaskRow): number => {
    const expiresAt = dueAt(task)
    const renewed = Number(db.prepare("UPDATE leases SET expires_at = ? WHERE task_id = ?").run(expiresAt, task.id).changes)
    if (renewed > 0) recordEvent(db, "leases-renewed", task.id, { count: renewed, expiresAt })
    return renewed
}

/** The lease paths of a task it no longer holds; empty while the task still owns every path it was sent with. */
export const missingLeases = (db: DatabaseSync, task: TaskRow): string[] => {
    const held = new Set(listLeases(db, task.id).map((lease) => lease.path))
    return leasePaths(task).filter((path) => !held.has(path))
}

/** Fencing: refuses with LEASE_LOST when the task no longer holds every lease of its allowPaths, so a fenced task cannot report work on paths it lost. */
export const assertLeasesHeld = (db: DatabaseSync, task: TaskRow): void => {
    const missing = missingLeases(db, task)
    if (missing.length > 0) {
        throw new Refusal("LEASE_LOST", `task ${task.id} no longer holds its lease on ${missing.join(", ")}; its work there is fenced off and cannot be reported or settled`)
    }
}

/**
 * Drops every lease of a task; returns how many it held. This is the one place leases are released, and only for a task
 * that has ended (LEASE_TASK_LIVE otherwise): set the terminal status first, once its dirty paths were preserved or settled.
 */
export const releaseLeases = (db: DatabaseSync, taskId: string): number => {
    const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId)
    const status = row === undefined ? undefined : (text(row.status) as TaskStatus)
    if (status !== undefined && !isTerminal(status)) throw new Refusal("LEASE_TASK_LIVE", `task ${taskId} is ${status}; its leases are released only once it has ended`)
    const released = Number(db.prepare("DELETE FROM leases WHERE task_id = ?").run(taskId).changes)
    if (released > 0) recordEvent(db, "leases-released", taskId, { count: released })
    return released
}
