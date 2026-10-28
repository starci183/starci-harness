import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { gitCommonDir, repositoryRoot, samePath } from "../shared/git.js"
import type { Contract } from "./contract.js"
import { contractHash, parseContract } from "./contract.js"
import { now } from "./ledger.js"
import { harnessCause } from "./revive.js"

/** The states of a task. Transitions are allowed only along TRANSITIONS; the ledger keeps facts, this module keeps the rules. */
export type TaskStatus = "queued" | "running" | "reported" | "verifying" | "done" | "failed" | "awaiting_owner" | "cancelled" | "effect_unknown"

/** The status a worker files with its result. */
export type ResultStatus = "done" | "blocked" | "mismatch" | "failed"

/** Allowed transitions of a task. */
export const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
    queued: ["running", "cancelled"],
    // running|effect_unknown -> queued: a launch that certainly failed (or launched the wrong model) is rolled back; no try is spent.
    running: ["reported", "failed", "cancelled", "effect_unknown", "queued"],
    reported: ["verifying", "cancelled"],
    // verifying -> reported: the verify reached no verdict (HEAD moved, the verifier died or broke); no try is spent.
    verifying: ["done", "failed", "awaiting_owner", "reported"],
    effect_unknown: ["running", "failed", "queued", "cancelled"],
    // done -> failed: the workflow's wave verify found the task's files red (harness/wave.ts); its lease was freed when it settled.
    done: ["failed"],
    failed: [],
    awaiting_owner: [],
    cancelled: [],
}

/** Statuses whose task holds nothing (no lease, no worker): every status with no way out of TRANSITIONS, and done, whose only way out is a red wave. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = (Object.keys(TRANSITIONS) as TaskStatus[]).filter((status) => TRANSITIONS[status].every((next) => status === "done" && next === "failed"))

/** True for a status no transition leaves: the task has ended. */
export const isTerminal = (status: TaskStatus): boolean => TERMINAL_STATUSES.includes(status)

/**
 * An intent a command claims on a task before its first git or Orca side effect, so a concurrent command refuses instead of
 * racing it and a crash leaves a trace recovery reads: `cancelling` while a cancel stops seats and preserves work, `fencing`
 * while the budget ladder does the same to a running attempt past its budget and grace (harness/fence.ts), `repair` while a
 * preserve saved the work but could not finish putting the paths back (`task verify --recover` finishes it).
 */
export type TaskIntent = "cancelling" | "fencing" | "repair"

/** What an intent records: who claimed it, from which status, and the preserve folder once one was written. */
export interface IntentData {
    readonly by: string
    readonly at: string
    readonly from: TaskStatus
    readonly dir: string | null
}

/** The transitions an intent still lets through: a cancel may end the task, a fence may fail it, a lost worker may still be observed. */
const INTENT_ALLOWS: Readonly<Record<TaskIntent, readonly TaskStatus[]>> = {
    cancelling: ["cancelled", "effect_unknown", "queued"],
    fencing: ["failed"],
    repair: [],
}

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
    /** The intent a command holds on the task, if any. */
    readonly intent: TaskIntent | null
    readonly intentData: IntentData | null
    /** The checkout the task's work lives in: its workflow's worktree, else the checkout it was sent from; null before version 7. */
    readonly worktree: string | null
    /** The commit its settle landed; null until it is done, and when its settle had nothing to commit. */
    readonly settleCommit: string | null
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
    intent: optStr(row, "intent") as TaskIntent | null,
    intentData: optStr(row, "intent_json") === null ? null : (JSON.parse(str(row, "intent_json")) as IntentData),
    worktree: optStr(row, "worktree"),
    settleCommit: optStr(row, "settle_commit"),
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

/** The worktree recorded on a workflow (one workflow, one worktree), when the ledger has that column and the workflow names one. */
export const workflowWorktree = (db: DatabaseSync, workflowId: string | undefined): string | undefined => {
    if (workflowId === undefined) return undefined
    const columns = db.prepare("PRAGMA table_info(workflows)").all().map((row) => String(row.name))
    if (!columns.includes("worktree")) return undefined
    const value = db.prepare("SELECT worktree FROM workflows WHERE id = ?").get(workflowId)?.worktree
    return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * The try number a retry of `previous` takes: the next one, unless the harness ended `previous` (revive.ts `harnessCause`: a wave
 * red not proven its own, a fenced or lost launch, a verify stopped by infrastructure or its deadline), which spends no try: the
 * retry keeps its number, even past the last try.
 */
export const tryAfter = (db: DatabaseSync, previous: TaskRow): number => previous.tryNo + (harnessCause(db, previous.id) === null ? 1 : 0)

/**
 * Registers a queued task for a fit contract; a retry names the task it retries and gets its try number (tryAfter). The task's
 * worktree is its workflow's, else the one of the task it retries (a retry continues on the code its previous attempt left),
 * else `worktree`, the checkout it was sent from.
 */
export const createTask = (
    db: DatabaseSync,
    contract: Contract,
    options: { readonly workflowId?: string; readonly retryOf?: string; readonly worktree?: string } = {},
): TaskRow => {
    const id = `t-${randomUUID().slice(0, 8)}`
    const at = now()
    const previous = options.retryOf === undefined ? undefined : getTask(db, options.retryOf)
    const worktree = workflowWorktree(db, options.workflowId) ?? previous?.worktree ?? options.worktree ?? null
    db.prepare(
        "INSERT INTO tasks (id, workflow_id, label, contract_json, contract_hash, try_no, retry_of, status, created_at, updated_at, worktree) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)",
    ).run(id, options.workflowId ?? null, contract.label, JSON.stringify(contract), contractHash(contract), previous === undefined ? 1 : tryAfter(db, previous), options.retryOf ?? null, at, at, worktree)
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

/**
 * Moves a task to `next` by compare-and-swap: the row changes only while it still holds the status read (or `expected`, when
 * the caller decided on one), so two processes can never both move it; the loser is refused with TASK_STATUS_RACE. Refuses a
 * transition TRANSITIONS does not allow, and one the task's intent holds back (TASK_INTENT_HELD).
 */
export const setStatus = (db: DatabaseSync, id: string, next: TaskStatus, expected?: TaskStatus): TaskRow => {
    const task = getTask(db, id)
    const from = expected ?? task.status
    if (task.status !== from) throw new Refusal("TASK_STATUS_RACE", `task ${id} is ${task.status}, not ${from}: another command moved it first; read it again`)
    if (!TRANSITIONS[from].includes(next)) throw new Refusal("TASK_BAD_TRANSITION", `task ${id} cannot go from ${from} to ${next}`)
    if (task.intent !== null && !INTENT_ALLOWS[task.intent].includes(next)) {
        throw new Refusal("TASK_INTENT_HELD", `task ${id} is ${task.intent} (claimed by ${task.intentData?.by ?? "?"} at ${task.intentData?.at ?? "?"}); it cannot go to ${next} now`)
    }
    const changed = Number(db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?").run(next, now(), id, from).changes)
    if (changed === 0) throw new Refusal("TASK_STATUS_RACE", `task ${id} left ${from} while this command moved it to ${next}; read it again`)
    recordEvent(db, "task-status", id, { from, to: next })
    return getTask(db, id)
}

/** Who claims an intent: this process. */
const claimant = (): string => `pid ${String(process.pid)}`

/**
 * Claims `intent` on a task by compare-and-swap, before any side effect: only while it holds no intent and is in one of `from`.
 * The same intent already held is resumed (a cancel run again after a crash or a refusal); anything else is refused.
 */
export const claimIntent = (db: DatabaseSync, id: string, intent: TaskIntent, from: readonly TaskStatus[]): { readonly task: TaskRow; readonly resumed: boolean } => {
    const before = getTask(db, id)
    if (before.intent === intent) return { task: before, resumed: true }
    if (before.intent !== null) throw new Refusal("TASK_INTENT_HELD", `task ${id} is ${before.intent}; finish that first`)
    if (!from.includes(before.status)) throw new Refusal("TASK_BAD_TRANSITION", `task ${id} is ${before.status}; it cannot be ${intent}`)
    const data: IntentData = { by: claimant(), at: now(), from: before.status, dir: null }
    const changed = Number(
        db.prepare("UPDATE tasks SET intent = ?, intent_json = ?, updated_at = ? WHERE id = ? AND intent IS NULL AND status = ?").run(intent, JSON.stringify(data), now(), id, before.status).changes,
    )
    if (changed === 0) throw new Refusal("TASK_STATUS_RACE", `task ${id} moved while ${intent} was claimed; read it again`)
    recordEvent(db, "task-intent", id, { intent, ...data })
    return { task: getTask(db, id), resumed: false }
}

/** Sets an intent on a task whatever it holds (a red verify whose reset broke turns `repair`), naming the preserve folder. */
export const markIntent = (db: DatabaseSync, id: string, intent: TaskIntent, dir: string | null): void => {
    const task = getTask(db, id)
    const data: IntentData = { by: claimant(), at: now(), from: task.status, dir }
    db.prepare("UPDATE tasks SET intent = ?, intent_json = ?, updated_at = ? WHERE id = ?").run(intent, JSON.stringify(data), now(), id)
    recordEvent(db, "task-intent", id, { intent, ...data })
}

/** Records the preserve folder an intent's side effect wrote, so a resumed run puts back from it instead of preserving again. */
export const noteIntentDir = (db: DatabaseSync, id: string, dir: string): void => {
    const task = getTask(db, id)
    if (task.intentData === null) return
    db.prepare("UPDATE tasks SET intent_json = ? WHERE id = ?").run(JSON.stringify({ ...task.intentData, dir }), id)
}

/** Drops the task's intent once its command finished. */
export const clearIntent = (db: DatabaseSync, id: string): void => {
    db.prepare("UPDATE tasks SET intent = NULL, intent_json = NULL, updated_at = ? WHERE id = ?").run(now(), id)
    recordEvent(db, "task-intent-cleared", id, {})
}

/**
 * Records the commit a task's settle landed; call it in the transaction that makes the task done, so a done task always
 * names its commit (or null: its settle had nothing to commit), and clears its result hash so the replan recomputes it.
 * Other modules read it as `TaskRow.settleCommit`.
 */
export const recordSettleCommit = (db: DatabaseSync, taskId: string, commit: string | null): void => {
    db.prepare("UPDATE tasks SET settle_commit = ?, result_hash = NULL WHERE id = ?").run(commit, taskId)
}

/** Records the checkout a task's worker really runs in, for a launch that learned it only from Orca (a worktree selector). */
export const recordTaskWorktree = (db: DatabaseSync, taskId: string, worktree: string): void => {
    db.prepare("UPDATE tasks SET worktree = ? WHERE id = ?").run(worktree, taskId)
    recordEvent(db, "task-worktree", taskId, { worktree })
}

/**
 * The checkout a task's work lives in, where verify, cancel, preserve and a failed result act: its recorded worktree (refused
 * when that folder is gone or belongs to another repository), else the caller's checkout for a task from before version 7.
 */
export const taskCheckout = async (task: TaskRow, callerRoot: string): Promise<string> => {
    if (task.worktree === null || samePath(task.worktree, callerRoot)) return callerRoot
    if (!existsSync(task.worktree)) throw new Refusal("TASK_WORKTREE_GONE", `task ${task.id} works in ${task.worktree}, which is gone; its work cannot be judged from ${callerRoot}`)
    const root = await repositoryRoot(task.worktree)
    if (!samePath(await gitCommonDir(root), await gitCommonDir(callerRoot))) {
        throw new Refusal("TASK_WORKTREE_FOREIGN", `task ${task.id} works in ${root}, which is not a checkout of the repository at ${callerRoot}`)
    }
    return root
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
