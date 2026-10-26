import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { openLedger } from "../../harness/ledger.js"
import { assertLeasesHeld, inTransaction, releaseLeases } from "../../harness/leases.js"
import { preserveTaskPaths } from "../../harness/preserve.js"
import type { Preserved } from "../../harness/preserve.js"
import { fileResult, getTask, latestAttempt, openAttempt, resultOf, setStatus } from "../../harness/tasks.js"
import type { AttemptRow, ResultStatus, TaskRow, TaskStatus } from "../../harness/tasks.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

const RESULT_STATUSES: readonly ResultStatus[] = ["done", "blocked", "mismatch", "failed"]

/** The agent recorded on an attempt opened by the result itself: a lite run where the agent worked inline, without a seat. */
const INLINE_AGENT = "inline"

interface ResultData {
    readonly task: string
    readonly attempt: string
    readonly status: ResultStatus
    readonly taskStatus: TaskStatus
    readonly inline: boolean
    readonly preserved: Preserved | null
    readonly leasesReleased: number
}

const isResultStatus = (value: string): value is ResultStatus => (RESULT_STATUSES as readonly string[]).includes(value)

/** Parses --output: inline json, or `@file` read relative to the working directory. */
const parseOutput = (cwd: string, given: string): unknown => {
    const source = given.startsWith("@") ? resolve(cwd, given.slice(1)) : undefined
    let raw: string
    try {
        raw = source === undefined ? given : readFileSync(source, "utf8")
    } catch (error: unknown) {
        throw new Refusal("RESULT_OUTPUT_UNREADABLE", `${source ?? given} is not readable: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
        return JSON.parse(raw)
    } catch (error: unknown) {
        throw new Refusal("RESULT_OUTPUT_INVALID", `--output ${source === undefined ? "" : `(${source}) `}is not json: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/** Where a result would be filed: the task, its open attempt (undefined when the result opens an inline one) and whether it is inline. */
interface Filing {
    readonly task: TaskRow
    readonly attempt: AttemptRow | undefined
    readonly inline: boolean
}

/**
 * Refuses a result that cannot be filed now, before anything moves: the task must be running (or queued, worked inline), still
 * hold every lease of its allowPaths (fencing: LEASE_LOST), and its open attempt must have no result yet.
 */
const filingOf = (db: DatabaseSync, taskId: string): Filing => {
    const task = getTask(db, taskId)
    const latest = latestAttempt(db, task.id)
    if (task.status !== "running" && task.status !== "queued") {
        if (latest !== undefined && resultOf(db, latest.id) !== undefined) throw new Refusal("RESULT_ALREADY_FILED", `task ${task.id} already has a result on ${latest.id}; a result is immutable`)
        throw new Refusal("TASK_NOT_RUNNING", `task ${task.id} is ${task.status}; a result is filed only for a running task`)
    }
    assertLeasesHeld(db, task)
    if (task.status === "queued") {
        // A queued task reached by its result was worked inline (lite, no seat); an ended attempt (a launch rolled back) is not its own.
        const open = latest?.endedAt === null ? latest : undefined
        return { task, attempt: open, inline: open === undefined }
    }
    if (latest === undefined) throw new Refusal("TASK_NO_ATTEMPT", `task ${task.id} is running without an attempt; the ledger needs repair`)
    if (resultOf(db, latest.id) !== undefined) throw new Refusal("RESULT_ALREADY_FILED", `task ${task.id} already has a result on ${latest.id}; a result is immutable`)
    return { task, attempt: latest, inline: false }
}

/** `starci task result <task-id>`: files the one immutable result of the task's open attempt and hands the task back to the Kernel. */
export const taskResultVerb = defineVerb({
    path: ["task", "result"],
    summary: "file the one result of a task's open attempt (done, blocked, mismatch or failed) with its json output; failed preserves and resets its dirty allowPaths",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["worker", "op", "agent", "kernel", "supervisor"],
    schema: "starci/task-result@1",
    flags: {
        task: { kind: "string", summary: "the task id", required: true, positional: true },
        status: { kind: "string", summary: "done, blocked, mismatch or failed", required: true },
        output: { kind: "string", summary: "the output as json, or @file to read it from a file", required: true },
    },
    run: async (context, flags) => {
        const status = flags.status
        if (!isResultStatus(status)) throw new Refusal("RESULT_BAD_STATUS", `--status must be one of ${RESULT_STATUSES.join(", ")}, not "${status}"`, EXIT_USAGE)
        const output = parseOutput(context.cwd, flags.output)
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            // A failed task gives its paths back: its dirty work is saved and reset while it still holds its leases, so no
            // overlapping task can commit it in between. The checks run first, so a refused result resets nothing.
            const checked = filingOf(db, flags.task)
            const preserved = status === "failed" ? await preserveTaskPaths(root, checked.task, db) : null
            const data = inTransaction(db, (): ResultData => {
                const filing = filingOf(db, flags.task)
                let task = filing.task
                const attempt = filing.attempt ?? openAttempt(db, task.id, { agent: INLINE_AGENT })
                if (task.status === "queued") task = setStatus(db, task.id, "running")
                fileResult(db, attempt.id, status, output)
                // blocked and mismatch are reported too: the Kernel reads the result and decides.
                const next = setStatus(db, task.id, status === "failed" ? "failed" : "reported")
                const leasesReleased = next.status === "failed" ? releaseLeases(db, task.id) : 0
                return { task: task.id, attempt: attempt.id, status, taskStatus: next.status, inline: filing.inline, preserved, leasesReleased }
            })
            const dir = preserved?.dir ?? null
            const kept = dir === null ? "" : `; dirty work preserved in ${dir} and reset`
            const lease = data.leasesReleased > 0 ? `; released ${String(data.leasesReleased)} lease(s)` : ""
            return { data, message: `filed ${data.status} on ${data.attempt}${data.inline ? " (inline attempt)" : ""}; task ${data.task} is ${data.taskStatus}${kept}${lease}` }
        } finally {
            db.close()
        }
    },
})
