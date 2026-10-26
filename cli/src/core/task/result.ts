import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { openLedger } from "../../harness/ledger.js"
import { inTransaction, releaseLeases } from "../../harness/leases.js"
import { fileResult, getTask, latestAttempt, openAttempt, resultOf, setStatus } from "../../harness/tasks.js"
import type { AttemptRow, ResultStatus, TaskStatus } from "../../harness/tasks.js"
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

/** `starci task result <task-id>`: files the one immutable result of the task's open attempt and hands the task back to the Kernel. */
export const taskResultVerb = defineVerb({
    path: ["task", "result"],
    summary: "file the one result of a task's open attempt (done, blocked, mismatch or failed) with its json output",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["worker", "op", "kernel"],
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
            const data = inTransaction(db, (): ResultData => {
                let task = getTask(db, flags.task)
                let attempt: AttemptRow | undefined = latestAttempt(db, task.id)
                let inline = false
                if (task.status === "queued") {
                    // A queued task reached by its result was worked inline (lite, no seat): it gets its own attempt now.
                    if (attempt === undefined) {
                        attempt = openAttempt(db, task.id, { agent: INLINE_AGENT })
                        inline = true
                    }
                    task = setStatus(db, task.id, "running")
                }
                if (task.status !== "running") {
                    if (attempt !== undefined && resultOf(db, attempt.id) !== undefined) throw new Refusal("RESULT_ALREADY_FILED", `task ${task.id} already has a result on ${attempt.id}; a result is immutable`)
                    throw new Refusal("TASK_NOT_RUNNING", `task ${task.id} is ${task.status}; a result is filed only for a running task`)
                }
                if (attempt === undefined) throw new Refusal("TASK_NO_ATTEMPT", `task ${task.id} is running without an attempt; the ledger needs repair`)
                fileResult(db, attempt.id, status, output)
                // blocked and mismatch are reported too: the Kernel reads the result and decides.
                const next = setStatus(db, task.id, status === "failed" ? "failed" : "reported")
                const leasesReleased = next.status === "failed" ? releaseLeases(db, task.id) : 0
                return { task: task.id, attempt: attempt.id, status, taskStatus: next.status, inline, leasesReleased }
            })
            const lease = data.leasesReleased > 0 ? `; released ${String(data.leasesReleased)} lease(s)` : ""
            return { data, message: `filed ${data.status} on ${data.attempt}${data.inline ? " (inline attempt)" : ""}; task ${data.task} is ${data.taskStatus}${lease}` }
        } finally {
            db.close()
        }
    },
})
