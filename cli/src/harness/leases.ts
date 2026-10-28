import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { budgetDue } from "./budget-ladder.js"
import { normaliseRepoPath } from "./contract.js"
import { now } from "./ledger.js"
import type { TaskRow, TaskStatus } from "./tasks.js"
import { recordEvent, TERMINAL_STATUSES } from "./tasks.js"

/**
 * One path lease: a task holds a repository path (and everything below it) until the task ends. `expiresAt` says when the
 * task was due (`overdue` once passed). Time alone never frees the path of a task that may still write (queued, running,
 * verifying, effect_unknown): a running attempt past its budget is fenced by the budget ladder (`sweepOpBudgets`), which
 * preserves its work and ends the task first; a task returned to the Kernel has no worker left to write, so its lease lapses
 * at `expiresAt` (`expireLeases`) and the next `workflow step`, `supervisor tick` or lease request frees it.
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

const TERMINAL_SQL = TERMINAL_STATUSES.map((status) => `'${status}'`).join(", ")

/** True for a status no transition leaves: the task has ended. */
export const isTerminal = (status: TaskStatus): boolean => TERMINAL_STATUSES.includes(status)

/**
 * Two leased paths overlap when one equals the other or is a directory prefix of it, compared segment by segment and without
 * case; `.` is the whole repository. `Src/A` and `src/a` are one path on every host: a product is checked out on Windows and
 * macOS too, where they are one file, so two tasks never hold them apart even where the filesystem would.
 */
export const pathsOverlap = (left: string, right: string): boolean => {
    const spell = (path: string): string[] => normaliseRepoPath(path).toLowerCase().split("/")
    const a = spell(left)
    const b = spell(right)
    if (a[0] === "." || b[0] === ".") return true
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

// A task that ended but still holds an intent (a reset left to repair) keeps its paths: its tree is not back to HEAD yet.
const toLease = (row: Record<string, unknown>, at: string): LeaseRow => {
    const taskStatus = text(row.status) as TaskStatus
    const expiresAt = text(row.expires_at)
    const held = row.intent !== null && row.intent !== undefined
    return { path: text(row.path), taskId: text(row.task_id), token: text(row.token), expiresAt, taskStatus, live: held || !isTerminal(taskStatus), overdue: expiresAt <= at }
}

/** Deletes the leases of tasks that ended and hold no intent, and only those: a lease of a live task is never expired by time. Returns how many it removed. */
export const sweepLeases = (db: DatabaseSync): number => {
    const swept = db.prepare(`DELETE FROM leases WHERE task_id IN (SELECT id FROM tasks WHERE status IN (${TERMINAL_SQL}) AND intent IS NULL)`).run()
    const count = Number(swept.changes)
    if (count > 0) recordEvent(db, "leases-swept", null, { count })
    return count
}

/** True for a task returned to the Kernel: awaiting the owner, or reported with a result that is not done (blocked or mismatch). Its worker has nothing left to do. */
const RETURNED_SQL =
    "(tasks.status = 'awaiting_owner' OR (tasks.status = 'reported' AND COALESCE((SELECT results.status FROM attempts JOIN results ON results.attempt_id = attempts.id WHERE attempts.task_id = tasks.id ORDER BY attempts.seq DESC LIMIT 1), 'done') <> 'done'))"

/** One task whose leases `expireLeases` dropped. */
export interface ExpiredLeases {
    readonly taskId: string
    readonly paths: readonly string[]
    readonly expiresAt: string
}

/**
 * Drops the leases of tasks returned to the Kernel once they are past their due time, and records `leases-expired` per task.
 * A live lease of a task that may still write (queued, running, verifying, effect_unknown, or reported done and awaiting its
 * verify) is never touched, nor is a task holding an intent; the Kernel's amend re-leases the paths when it retries the node.
 */
export const expireLeases = (db: DatabaseSync): ExpiredLeases[] =>
    inTransaction(db, () => {
        const at = now()
        const rows = db.prepare(`SELECT leases.path, leases.task_id, leases.expires_at FROM leases JOIN tasks ON tasks.id = leases.task_id WHERE tasks.intent IS NULL AND leases.expires_at <= ? AND ${RETURNED_SQL} ORDER BY leases.task_id, leases.path`).all(at)
        const byTask = new Map<string, { paths: string[]; expiresAt: string }>()
        for (const row of rows) {
            const entry = byTask.get(text(row.task_id)) ?? { paths: [], expiresAt: text(row.expires_at) }
            entry.paths.push(text(row.path))
            byTask.set(text(row.task_id), entry)
        }
        const expired: ExpiredLeases[] = []
        for (const [taskId, entry] of byTask) {
            for (const path of entry.paths) db.prepare("DELETE FROM leases WHERE task_id = ? AND path = ?").run(taskId, path)
            recordEvent(db, "leases-expired", taskId, { paths: entry.paths, expiresAt: entry.expiresAt })
            expired.push({ taskId, paths: entry.paths, expiresAt: entry.expiresAt })
        }
        return expired
    })

/** Every lease row, or those of one task, with whether it still holds; a pure read that sweeps nothing. */
export const listLeases = (db: DatabaseSync, taskId?: string): LeaseRow[] => {
    const at = now()
    const select = "SELECT leases.*, tasks.status, tasks.intent FROM leases JOIN tasks ON tasks.id = leases.task_id"
    const rows = taskId === undefined ? db.prepare(`${select} ORDER BY leases.path`).all() : db.prepare(`${select} WHERE leases.task_id = ? ORDER BY leases.path`).all(taskId)
    return rows.map((row) => toLease(row, at))
}

/** When a task's leases fall due: its budget plus the budget ladder's grace, the time its running attempt is fenced at the latest. */
const dueAt = (task: TaskRow): string => budgetDue(task.contract.budget.minutes)

/** The lease paths of a task: its allowPaths, normalised and without duplicates. */
export const leasePaths = (task: TaskRow): string[] => [...new Set(task.contract.context.allowPaths.map(normaliseRepoPath))]

/**
 * Takes one lease per allowPath of the task, all or nothing: a path that overlaps a lease of another live task
 * refuses the whole grant with LEASE_CONFLICT, however overdue that lease is, unless its task was returned to the Kernel. Leases of ended tasks are swept and overdue leases of returned tasks expire first.
 */
export const acquireLeases = (db: DatabaseSync, task: TaskRow): LeaseGrant =>
    inTransaction(db, () => {
        sweepLeases(db)
        expireLeases(db)
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

/**
 * Fencing: refuses with LEASE_LOST when the task no longer holds every lease of its allowPaths, so a fenced task cannot report
 * work on paths it lost. The fence is the lease row itself, read next to the task's status compare-and-swap; the grant's
 * `token` only names a grant in events and listings, and no command takes it as proof.
 */
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
    const row = db.prepare("SELECT status, intent FROM tasks WHERE id = ?").get(taskId)
    const status = row === undefined ? undefined : (text(row.status) as TaskStatus)
    if (status !== undefined && !isTerminal(status)) throw new Refusal("LEASE_TASK_LIVE", `task ${taskId} is ${status}; its leases are released only once it has ended`)
    if (row !== undefined && row.intent !== null) throw new Refusal("LEASE_TASK_LIVE", `task ${taskId} still holds intent ${text(row.intent)}; its leases are released once that finished`)
    const released = Number(db.prepare("DELETE FROM leases WHERE task_id = ?").run(taskId).changes)
    if (released > 0) recordEvent(db, "leases-released", taskId, { count: released })
    return released
}
