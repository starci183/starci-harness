import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import type { Contract } from "./contract.js"
import { contractHash, parseContract } from "./contract.js"
import { now } from "./ledger.js"

/** The states of a task. Transitions are allowed only along TRANSITIONS; the ledger keeps facts, this module keeps the rules. */
export type TaskStatus = "queued" | "running" | "reported" | "verifying" | "done" | "failed" | "awaiting_owner" | "cancelled" | "effect_unknown"

/** The status a worker files with its result. */
export type ResultStatus = "done" | "blocked" | "mismatch" | "failed"

/** Allowed transitions of a task. */
export const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
    queued: ["running", "cancelled"],
    running: ["reported", "failed", "cancelled", "effect_unknown"],
    reported: ["verifying", "cancelled"],
    // verifying -> reported: the verify reached no verdict (HEAD moved, the verifier died or broke); no try is spent.
    verifying: ["done", "failed", "awaiting_owner", "reported"],
    effect_unknown: ["running", "failed"],
    done: [],
    failed: [],
    awaiting_owner: [],
    cancelled: [],
}

/** Statuses with no way out of TRANSITIONS: a task in one of them holds nothing. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = (Object.keys(TRANSITIONS) as TaskStatus[]).filter((status) => TRANSITIONS[status].length === 0)

/** A task as the ledger stores it, with its contract parsed. */
export interface TaskRow {
    readonly id: string
    readonly workflowId: string | null
    readonly label: string
    readonly contract: Contract
    readonly contractHash: string
    readonly tryNo: number
    readonly retryOf: string | null
    readonly status: TaskStatus
    readonly createdAt: string
    readonly updatedAt: string
}

/** One dispatch of a task. */
export interface AttemptRow {
    readonly id: string
    readonly taskId: string
    readonly seq: number
    readonly agent: string | null
    readonly model: string | null
    readonly outcome: string | null
    readonly verdict: string | null
    readonly startedAt: string
    readonly endedAt: string | null
}

/** The immutable result a worker filed for one attempt. */
export interface ResultRow {
    readonly attemptId: string
    readonly status: ResultStatus
    readonly output: unknown
    readonly filedAt: string
}

// The ledger's TEXT columns come back as strings; anything else is a schema drift worth seeing, not hiding.
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const str = (row: Record<string, unknown>, key: string): string => text(row[key])

const optStr = (row: Record<string, unknown>, key: string): string | null => {
    const value = row[key]
    return value === null || value === undefined ? null : text(value)
}

const toTask = (row: Record<string, unknown>): TaskRow => ({
    id: str(row, "id"),
    workflowId: optStr(row, "workflow_id"),
    label: str(row, "label"),
    // Through the schema, so a contract stored before path normalisation is read in today's spelling.
    contract: parseContract(JSON.parse(str(row, "contract_json"))),
    contractHash: str(row, "contract_hash"),
    tryNo: Number(row.try_no),
    retryOf: optStr(row, "retry_of"),
    status: str(row, "status") as TaskStatus,
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
})

const toAttempt = (row: Record<string, unknown>): AttemptRow => ({
    id: str(row, "id"),
    taskId: str(row, "task_id"),
    seq: Number(row.seq),
    agent: optStr(row, "agent"),
    model: optStr(row, "model"),
    outcome: optStr(row, "outcome"),
    verdict: optStr(row, "verdict"),
    startedAt: str(row, "started_at"),
    endedAt: optStr(row, "ended_at"),
})

/** Appends one event to the ledger. */
export const recordEvent = (db: DatabaseSync, kind: string, subject: string | null, data: unknown): void => {
    db.prepare("INSERT INTO events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), kind, subject, JSON.stringify(data))
}

/** The data of the newest event of one kind about one subject, if any. */
export const lastEvent = (db: DatabaseSync, kind: string, subject: string): unknown => {
    const row = db.prepare("SELECT data_json FROM events WHERE kind = ? AND subject = ? ORDER BY id DESC LIMIT 1").get(kind, subject)
    return row === undefined ? undefined : JSON.parse(str(row, "data_json"))
}

/** Frees every path lease of a task that ended; returns how many it held. Path leases themselves are leases.ts's. */
export const releaseTaskLeases = (db: DatabaseSync, taskId: string): number => {
    const released = Number(db.prepare("DELETE FROM leases WHERE task_id = ?").run(taskId).changes)
    if (released > 0) recordEvent(db, "leases-released", taskId, { count: released })
    return released
}

/** Registers a queued task for a fit contract; a retry names the task it retries and gets the next try number. */
export const createTask = (db: DatabaseSync, contract: Contract, options: { readonly workflowId?: string; readonly retryOf?: string } = {}): TaskRow => {
    const id = `t-${randomUUID().slice(0, 8)}`
    const at = now()
    const previous = options.retryOf === undefined ? undefined : getTask(db, options.retryOf)
    db.prepare(
        "INSERT INTO tasks (id, workflow_id, label, contract_json, contract_hash, try_no, retry_of, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
    ).run(id, options.workflowId ?? null, contract.label, JSON.stringify(contract), contractHash(contract), (previous?.tryNo ?? 0) + 1, options.retryOf ?? null, at, at)
    recordEvent(db, "task-created", id, { label: contract.label, retryOf: options.retryOf ?? null })
    return getTask(db, id)
}

/** One task by id; refuses an unknown id. */
export const getTask = (db: DatabaseSync, id: string): TaskRow => {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id)
    if (row === undefined) throw new Refusal("TASK_UNKNOWN", `no task ${id} in this project's ledger`)
    return toTask(row)
}

/** Every task, newest first, optionally of one workflow. */
export const listTasks = (db: DatabaseSync, workflowId?: string): TaskRow[] =>
    (workflowId === undefined ? db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() : db.prepare("SELECT * FROM tasks WHERE workflow_id = ? ORDER BY created_at DESC").all(workflowId)).map(toTask)

/** Moves a task to `next`, refusing a transition TRANSITIONS does not allow. */
export const setStatus = (db: DatabaseSync, id: string, next: TaskStatus): TaskRow => {
    const task = getTask(db, id)
    if (!TRANSITIONS[task.status].includes(next)) throw new Refusal("TASK_BAD_TRANSITION", `task ${id} cannot go from ${task.status} to ${next}`)
    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(next, now(), id)
    recordEvent(db, "task-status", id, { from: task.status, to: next })
    return getTask(db, id)
}

/** Opens the next attempt of a task (one per dispatch). */
export const openAttempt = (db: DatabaseSync, taskId: string, launch: { readonly agent?: string; readonly model?: string; readonly pick?: unknown } = {}): AttemptRow => {
    const seq = Number(db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM attempts WHERE task_id = ?").get(taskId)?.next ?? 1)
    const id = `${taskId}.a${String(seq)}`
    db.prepare("INSERT INTO attempts (id, task_id, seq, pick_json, agent, model, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        taskId,
        seq,
        launch.pick === undefined ? null : JSON.stringify(launch.pick),
        launch.agent ?? null,
        launch.model ?? null,
        now(),
    )
    return latestAttempt(db, taskId) ?? toAttempt({ id, task_id: taskId, seq, started_at: now() })
}

/** The newest attempt of a task, if any. */
export const latestAttempt = (db: DatabaseSync, taskId: string): AttemptRow | undefined => {
    const row = db.prepare("SELECT * FROM attempts WHERE task_id = ? ORDER BY seq DESC LIMIT 1").get(taskId)
    return row === undefined ? undefined : toAttempt(row)
}

/** Files the worker's result for an attempt; a result is immutable, so a second filing is refused. */
export const fileResult = (db: DatabaseSync, attemptId: string, status: ResultStatus, output: unknown): void => {
    const existing = db.prepare("SELECT attempt_id FROM results WHERE attempt_id = ?").get(attemptId)
    if (existing !== undefined) throw new Refusal("RESULT_ALREADY_FILED", `attempt ${attemptId} already has a result`)
    db.prepare("INSERT INTO results (attempt_id, status, output_json, filed_at) VALUES (?, ?, ?, ?)").run(attemptId, status, JSON.stringify(output), now())
    db.prepare("UPDATE attempts SET outcome = ?, ended_at = ? WHERE id = ?").run(status, now(), attemptId)
}

/** The result filed for an attempt, if any. */
export const resultOf = (db: DatabaseSync, attemptId: string): ResultRow | undefined => {
    const row = db.prepare("SELECT * FROM results WHERE attempt_id = ?").get(attemptId)
    if (row === undefined) return undefined
    return { attemptId: str(row, "attempt_id"), status: str(row, "status") as ResultStatus, output: JSON.parse(str(row, "output_json")), filedAt: str(row, "filed_at") }
}

/** Records the harness verdict on an attempt. */
export const setVerdict = (db: DatabaseSync, attemptId: string, verdict: "green" | "red"): void => {
    db.prepare("UPDATE attempts SET verdict = ? WHERE id = ?").run(verdict, attemptId)
}
