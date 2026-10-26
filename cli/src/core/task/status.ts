import type { DatabaseSync } from "node:sqlite"
import { ledgerPath, openLedger } from "../../harness/ledger.js"
import { listLeases } from "../../harness/leases.js"
import type { LeaseRow } from "../../harness/leases.js"
import { seatsOfTask } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { getTask, listTasks, resultOf } from "../../harness/tasks.js"
import type { AttemptRow, ResultRow, TaskRow } from "../../harness/tasks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** How many of a task's newest check runs status shows. */
const CHECK_RUNS_SHOWN = 20

interface CheckRunRow {
    readonly name: string
    readonly runner: string
    readonly status: string
    readonly exitCode: number | null
    readonly attemptId: string | null
    readonly contractHash: string
    readonly ranAt: string
}

interface TaskDetail {
    readonly task: TaskRow
    readonly attempts: readonly AttemptRow[]
    readonly result: ResultRow | null
    readonly leases: readonly LeaseRow[]
    readonly checkRuns: readonly CheckRunRow[]
    readonly seats: readonly SeatRow[]
    readonly preserved: readonly string[]
}

interface TaskSummary {
    readonly id: string
    readonly workflowId: string | null
    readonly label: string
    readonly status: TaskRow["status"]
    readonly tryNo: number
    readonly retryOf: string | null
    readonly summary: string
    readonly contractHash: string
    readonly updatedAt: string
}

interface TaskList {
    readonly workflow: string | null
    readonly tasks: readonly TaskSummary[]
}

// The ledger's TEXT columns come back as strings; anything else is shown as json rather than hidden.
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const optText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value))

/** Every attempt of a task, oldest first. */
const attemptsOf = (db: DatabaseSync, taskId: string): AttemptRow[] =>
    db
        .prepare("SELECT id, task_id, seq, agent, model, outcome, verdict, started_at, ended_at FROM attempts WHERE task_id = ? ORDER BY seq")
        .all(taskId)
        .map((row) => ({
            id: text(row.id),
            taskId: text(row.task_id),
            seq: Number(row.seq),
            agent: optText(row.agent),
            model: optText(row.model),
            outcome: optText(row.outcome),
            verdict: optText(row.verdict),
            startedAt: text(row.started_at),
            endedAt: optText(row.ended_at),
        }))

const checkRunsOf = (db: DatabaseSync, taskId: string): CheckRunRow[] =>
    db
        .prepare("SELECT name, runner, status, exit_code, attempt_id, contract_hash, ran_at FROM check_runs WHERE task_id = ? ORDER BY id DESC LIMIT ?")
        .all(taskId, CHECK_RUNS_SHOWN)
        .map((row) => ({
            name: text(row.name),
            runner: text(row.runner),
            status: text(row.status),
            exitCode: row.exit_code === null ? null : Number(row.exit_code),
            attemptId: optText(row.attempt_id),
            contractHash: text(row.contract_hash),
            ranAt: text(row.ran_at),
        }))

/** The folders a task's dirty work was preserved into, oldest first. */
const preservedOf = (db: DatabaseSync, taskId: string): string[] =>
    db
        .prepare("SELECT data_json FROM events WHERE kind = 'task-preserved' AND subject = ? ORDER BY id")
        .all(taskId)
        .map((row) => {
            const data: unknown = JSON.parse(text(row.data_json))
            return typeof data === "object" && data !== null && "dir" in data ? text(data.dir) : ""
        })
        .filter((dir) => dir !== "")

const detailOf =(db: DatabaseSync, id: string): TaskDetail => {
    const task = getTask(db, id)
    const attempts = attemptsOf(db, id)
    const filed = attempts.map((attempt) => resultOf(db, attempt.id)).filter((result): result is ResultRow => result !== undefined)
    return { task, attempts, result: filed.at(-1) ?? null, leases: listLeases(db, id), checkRuns: checkRunsOf(db, id), seats: seatsOfTask(db, id), preserved: preservedOf(db, id) }
}

const describe = (detail: TaskDetail): string => {
    const { task, attempts, result, leases, checkRuns, seats, preserved } = detail
    const retryNote = task.retryOf === null ? "" : ` (retry of ${task.retryOf})`
    const workflowNote = task.workflowId === null ? "" : `  workflow ${task.workflowId}`
    const lines = [
        `${task.id}  ${task.label}  ${task.status}  try ${String(task.tryNo)}${retryNote}${workflowNote}`,
        `input: ${task.contract.input.summary}`,
        `allowPaths: ${task.contract.context.allowPaths.join(", ")}`,
        `budget: ${String(task.contract.budget.minutes)} min, ${String(task.contract.budget.tries)} tries; contract ${task.contractHash.slice(0, 12)}`,
    ]
    if (attempts.length > 0) lines.push("", formatTable([["ATTEMPT", "AGENT", "OUTCOME", "VERDICT", "STARTED"], ...attempts.map((attempt) => [attempt.id, attempt.agent ?? "-", attempt.outcome ?? "-", attempt.verdict ?? "-", attempt.startedAt])]))
    if (result !== null) lines.push("", `result: ${result.status} on ${result.attemptId} at ${result.filedAt}`)
    if (seats.length > 0) lines.push("", formatTable([["SEAT", "AGENT", "MODEL", "STATUS", "DISPATCH", "STARTED", "ENDED"], ...seats.map((seat) => [seat.id, seat.agent ?? "-", seat.model ?? "-", seat.status, seat.handle ?? "-", seat.startedAt, seat.endedAt ?? "-"])]))
    if (leases.length > 0) lines.push("", formatTable([["LEASE", "DUE", "HELD"], ...leases.map((lease) => [lease.path, `${lease.expiresAt}${lease.overdue ? " (overdue)" : ""}`, lease.live ? "yes" : "no"])]))
    for (const dir of preserved) lines.push(`preserved: ${dir}`)
    if (checkRuns.length > 0) lines.push("", formatTable([["CHECK", "RUNNER", "STATUS", "RAN"], ...checkRuns.map((run) => [run.name, run.runner, run.status, run.ranAt])]))
    return lines.join("\n")
}

const summaryOf = (task: TaskRow): TaskSummary => ({
    id: task.id,
    workflowId: task.workflowId,
    label: task.label,
    status: task.status,
    tryNo: task.tryNo,
    retryOf: task.retryOf,
    summary: task.contract.input.summary,
    contractHash: task.contractHash,
    updatedAt: task.updatedAt,
})

/** `starci task status [task-id]`: one task with its full contract, attempts, result, leases and checks; or the table of tasks. */
export const taskStatusVerb = defineVerb({
    path: ["task", "status"],
    summary: "one task with its contract, attempts, latest result, leases and check runs; without an id, the table of tasks",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/task-status@1",
    flags: {
        task: { kind: "string", summary: "the task id; omit it to list the tasks", positional: true },
        workflow: { kind: "string", summary: "list only the tasks of this workflow" },
    },
    run: async (context, flags): Promise<{ data: TaskDetail | TaskList; message: string }> => {
        const root = await repositoryRoot(context.cwd)
        // A read never creates the ledger: no ledger means no task yet.
        if (ledgerPath(root) === undefined) {
            if (flags.task !== undefined) throw new Refusal("TASK_UNKNOWN", `no task ${flags.task}: this project has no ledger yet`)
            return { data: { workflow: flags.workflow ?? null, tasks: [] }, message: "no tasks" }
        }
        const db = openLedger(root)
        try {
            if (flags.task !== undefined) {
                const detail = detailOf(db, flags.task)
                return { data: detail, message: describe(detail) }
            }
            const tasks = listTasks(db, flags.workflow).map(summaryOf)
            const message =
                tasks.length === 0
                    ? "no tasks"
                    : formatTable([["TASK", "LABEL", "STATUS", "TRY", "WORKFLOW", "UPDATED", "INPUT"], ...tasks.map((task) => [task.id, task.label, task.status, String(task.tryNo), task.workflowId ?? "-", task.updatedAt, task.summary])])
            return { data: { workflow: flags.workflow ?? null, tasks }, message }
        } finally {
            db.close()
        }
    },
})
