import type { DatabaseSync } from "node:sqlite"
import { CONSUMER_FENCED_OUTCOME } from "./budget.js"
import { loadLiveness } from "./liveness.js"
import { loadStallRules } from "./stall.js"

/**
 * Why the harness, not the task, ended a task: a wave red no file of it was proven to own (`wave-foreign`), a launch Orca fenced
 * (`consumer-fenced`), a launch that never started its worker's turn (`launch-lost`), a verify the harness stopped (`verify-infra`,
 * clean-verify.ts `assertNoInfraFailure`) or its lock's deadline stopped (`verify-deadline`), a done task whose work never landed, returned
 * with that work preserved by `task verify --recover` (`land-orphaned`, core/task/verify.ts), or an attempt whose walk met no app,
 * every page it opened answering 5xx (`walk-unserved`, core/task/result.ts).
 */
export type HarnessCause = "wave-foreign" | "consumer-fenced" | "launch-lost" | "verify-infra" | "verify-deadline" | "land-orphaned" | "walk-unserved"

/** The event `task verify --recover` records when it returns a done task whose work never landed. */
export const LAND_ORPHANED = "land-orphaned"

/** The event `task result` records on an attempt whose walk met no app (harness/uat.ts unservedWalk): the task failed as the harness's. */
export const WALK_UNSERVED = "walk-unserved"

/** The event a dispatch records when it brings a harness-killed task back at the same try. */
export const TASK_REVIVED = "task-revived"

// The seat states of a launch whose worker never started its turn, and the states a closed seat ends in; any other state a seat
// of the attempt reached (an Orca running state, worker-lost) proves its worker ran.
const NOT_STARTED: readonly string[] = ["starting", "launch-unknown", "launch-failed", "launch-unsettled", "released", "stopped"]

// The no-verdict events of core/task/verify.ts `noVerdict`; only the two the harness causes make a task harness-killed.
const NO_VERDICT_EVENTS: readonly string[] = ["verify-infra", "verify-deadline", "verify-error", "preserve-failed", "settle-refused"]

const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

/** True when a seat of the attempt reached a state that proves its worker started its turn. */
const workerStarted = (db: DatabaseSync, attemptId: string): boolean => {
    const unknownStart = loadStallRules().startUnknownStates
    const reached = db
        .prepare("SELECT json_extract(e.data_json, '$.to') AS state FROM events e JOIN seats s ON s.id = e.subject WHERE e.kind = 'seat-status' AND s.attempt_id = ?")
        .all(attemptId)
        .map((row) => text(row.state) ?? "")
    return reached.some((state) => state !== "" && !NOT_STARTED.includes(state) && !unknownStart.includes(state))
}

/**
 * The harness cause that ended a failed or cancelled task, read from the ledger's facts alone; null for a task that ended by its
 * own red (a red verdict, a wave red its files own) or its worker's own words (a result other than done, filed on an attempt
 * whose walk met an app or that walked nothing), for one cancelled with
 * nothing that names the harness, and for every other status. Such a task returns to ready and its retry spends no try
 * (tasks.ts `tryAfter`, workflow.ts `nodeTasks`).
 */
export const harnessCause = (db: DatabaseSync, taskId: string): HarnessCause | null => {
    const status = text(db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId)?.status)
    if (status !== "failed" && status !== "cancelled") return null
    if (status === "failed" && db.prepare("SELECT 1 FROM events WHERE kind = ? AND subject = ?").get(LAND_ORPHANED, taskId) !== undefined) return LAND_ORPHANED
    const attempt = db.prepare("SELECT id, outcome, verdict FROM attempts WHERE task_id = ? ORDER BY seq DESC LIMIT 1").get(taskId)
    if (attempt === undefined || text(attempt.verdict) === "red") return null
    const attemptId = text(attempt.id) ?? ""
    // A walk that met no app ends its attempt whatever the worker filed: the result is the harness's environment, not the task's words.
    if (status === "failed" && db.prepare("SELECT 1 FROM events WHERE kind = ? AND subject = ? AND json_extract(data_json, '$.attempt') = ?").get(WALK_UNSERVED, taskId, attemptId) !== undefined) return WALK_UNSERVED
    const result = db.prepare("SELECT status, filed_at FROM results WHERE attempt_id = ?").get(attemptId)
    if (result !== undefined && text(result.status) !== "done") return null
    const wave = db.prepare("SELECT data_json FROM events WHERE kind = 'wave-returned' AND subject = ? ORDER BY id DESC LIMIT 1").get(taskId)
    if (wave !== undefined) return status === "failed" && (JSON.parse(text(wave.data_json) ?? "{}") as { readonly own?: boolean }).own === false ? "wave-foreign" : null
    const outcome = text(attempt.outcome)
    if (outcome === CONSUMER_FENCED_OUTCOME) return "consumer-fenced"
    if (outcome === "launch-failed") return "launch-lost"
    if (result === undefined) return status === "cancelled" && !workerStarted(db, attemptId) ? "launch-lost" : null
    const marks = NO_VERDICT_EVENTS.map(() => "?").join(", ")
    const last = text(db.prepare(`SELECT kind FROM events WHERE subject = ? AND kind IN (${marks}) AND at >= ? ORDER BY id DESC LIMIT 1`).get(taskId, ...NO_VERDICT_EVENTS, text(result.filed_at) ?? "")?.kind)
    return last === "verify-infra" || last === "verify-deadline" ? last : null
}

/** The event a hold's release records on a task the harness ended: it comes back to ready at the same try, past `reviveMax` too (holds.ts). */
export const HOLD_REVIVED = "hold-revived"

/**
 * The harness-killed tasks of each node (plan key and hash) that come back to ready: each one whose cause `harnessCause` names,
 * up to `reviveMax` of ops/liveness.yaml per node, and any such one a released hold revived (`hold-revived`); one past it stays
 * ended, its node red for the Kernel with the cause in evidence.
 */
export const revivableTasks = (db: DatabaseSync, tasks: readonly { readonly id: string; readonly key: string | null; readonly hash: string | null; readonly status: string }[]): Map<string, HarnessCause> => {
    const max = loadLiveness().reviveMax
    const seen = new Map<string, number>()
    const revivable = new Map<string, HarnessCause>()
    for (const task of tasks) {
        if (task.key === null || (task.status !== "failed" && task.status !== "cancelled")) continue
        const cause = harnessCause(db, task.id)
        if (cause === null) continue
        const node = `${task.key}\0${task.hash ?? ""}`
        const count = (seen.get(node) ?? 0) + 1
        seen.set(node, count)
        if (count <= max || db.prepare("SELECT 1 FROM events WHERE kind = ? AND subject = ?").get(HOLD_REVIVED, task.id) !== undefined) revivable.set(task.id, cause)
    }
    return revivable
}
