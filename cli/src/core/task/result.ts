import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { inTransaction, openLedger } from "../../harness/ledger.js"
import { PreserveIncomplete, preserveTaskPaths } from "../../harness/preserve.js"
import type { Preserved } from "../../harness/preserve.js"
import { removeOpWorktree } from "../../harness/land.js"
import { fileResult, getTask, latestAttempt, markIntent, openAttempt, resultOf, setStatus, taskCheckout } from "../../harness/tasks.js"
import type { AttemptRow, ResultStatus, TaskRow, TaskStatus } from "../../harness/tasks.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { parseNeeds, reportNeeds } from "../../harness/needs.js"
import type { NeedReport } from "../../harness/needs.js"
import { projectOf } from "../../harness/work.js"
import { mainCheckout } from "../../shared/git.js"

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
    /** The preserve folder whose reset broke half-way: the task keeps its worktree until `task verify --recover` finishes it. */
    readonly repair: string | null
    /** The shared needs a blocked result reported, by canonical key (harness/needs.ts). */
    readonly needs: readonly NeedReport[]
}

/**
 * Records a blocked task's needs in the host store as waiters (harness/needs.ts attachWaiter), after its result is filed; the next
 * step of its workflow parks it and routes the needs (core/needs/tend.ts), and records them again from the result if this fails.
 */
const recordNeeds = async (db: DatabaseSync, root: string, taskId: string, needs: readonly NeedReport[]): Promise<string> => {
    try {
        const project = await projectOf(root)
        const task = getTask(db, taskId)
        const taskKey = db.prepare("SELECT plan_key FROM tasks WHERE id = ?").get(taskId)?.plan_key
        const repo = await mainCheckout(root)
        const attached = reportNeeds(needs, { project: project.key, repo, workflow: task.workflowId, task: taskId, taskKey: typeof taskKey === "string" ? taskKey : null })
        return `; waits on ${attached.map((one) => `${one.need.key} (${one.opened ? "opened" : `${one.need.state}, ${one.attached ? "joined" : "already waiting"}`})`).join(", ")}`
    } catch (error: unknown) {
        return `; needs ${needs.map((need) => need.key).join(", ")} kept in the result, not yet in the host store (${error instanceof Error ? error.message : String(error)}); the next step records them`
    }
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
        const from = source === undefined ? "" : `(${source}) `
        throw new Refusal("RESULT_OUTPUT_INVALID", `--output ${from}is not json: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/** Where a result would be filed: the task, its open attempt (undefined when the result opens an inline one) and whether it is inline. */
interface Filing {
    readonly task: TaskRow
    readonly attempt: AttemptRow | undefined
    readonly inline: boolean
}

/**
 * Refuses a result that cannot be filed now, before anything moves: the task must be running (or queued, worked inline) and
 * its open attempt must have no result yet.
 */
const filingOf = (db: DatabaseSync, taskId: string): Filing => {
    const task = getTask(db, taskId)
    if (task.intent !== null) throw new Refusal("TASK_INTENT_HELD", `task ${task.id} is ${task.intent}; no result is filed while that runs`)
    const latest = latestAttempt(db, task.id)
    if (task.status !== "running" && task.status !== "queued") {
        if (latest !== undefined && resultOf(db, latest.id) !== undefined) throw new Refusal("RESULT_ALREADY_FILED", `task ${task.id} already has a result on ${latest.id}; a result is immutable`)
        throw new Refusal("TASK_NOT_RUNNING", `task ${task.id} is ${task.status}; a result is filed only for a running task`)
    }
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
    summary: "file the one result of a task's open attempt (done, blocked, mismatch or failed) with its json output; blocked --needs <key> reports a missing shared thing; failed preserves and resets its dirty allowPaths",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["worker", "op", "agent", "kernel", "supervisor"],
    schema: "starci/task-result@1",
    flags: {
        task: { kind: "string", summary: "the task id", required: true, positional: true },
        status: { kind: "string", summary: "done, blocked, mismatch or failed", required: true },
        output: { kind: "string", summary: "the output as json, or @file to read it from a file", required: true },
        needs: { kind: "list", summary: "blocked on a missing shared thing, never built here: its key, capability:<name>, package:<npm name> or config:<name> (repeatable)" },
        rule: { kind: "string", summary: "with --needs: the rule id that asks for the missing thing" },
        paths: { kind: "list", summary: "with --needs: the shared paths it would touch, which name its canonical key (repeatable)" },
        note: { kind: "string", summary: "with --needs: one line on what is missing" },
    },
    run: async (context, flags) => {
        const status = flags.status
        if (!isResultStatus(status)) throw new Refusal("RESULT_BAD_STATUS", `--status must be one of ${RESULT_STATUSES.join(", ")}, not "${status}"`, EXIT_USAGE)
        const given = parseOutput(context.cwd, flags.output)
        // A shared need is kept normalized and canonical in the output the ledger holds, so every later step reads one key.
        const needs = parseNeeds({ needs: flags.needs, rule: flags.rule, paths: flags.paths, note: flags.note }, given)
        if (needs.length > 0 && status !== "blocked") throw new Refusal("RESULT_NEEDS_NOT_BLOCKED", `a shared need is reported with --status blocked, not ${status}`, EXIT_USAGE)
        if (needs.length === 0 && (flags.rule !== undefined || flags.paths.length > 0 || flags.note !== undefined)) throw new Refusal("RESULT_NEEDS_MISSING", "--rule, --paths and --note describe a --needs key; name the key", EXIT_USAGE)
        const output = needs.length === 0 ? given : { ...(typeof given === "object" && given !== null ? given : { value: given }), needs }
        const callerRoot = await repositoryRoot(context.cwd)
        const db = openLedger(callerRoot)
        try {
            // A failed task's dirty work is saved and reset in the task's own checkout before its worktree goes. The checks run
            // first, so a refused result resets nothing.
            const checked = filingOf(db, flags.task)
            let preserved: Preserved | null = null
            let repair: string | null = null
            if (status === "failed") {
                const root = await taskCheckout(checked.task, callerRoot)
                try {
                    preserved = await preserveTaskPaths(root, checked.task, db)
                } catch (error: unknown) {
                    if (!(error instanceof PreserveIncomplete)) throw error
                    repair = error.dir
                    preserved = { dir: error.dir, patch: null, tracked: [], untracked: [] }
                }
            }
            const data = inTransaction(db, (): ResultData => {
                const filing = filingOf(db, flags.task)
                let task = filing.task
                const attempt = filing.attempt ?? openAttempt(db, task.id, { agent: INLINE_AGENT })
                if (task.status === "queued") task = setStatus(db, task.id, "running")
                fileResult(db, attempt.id, status, output)
                // blocked and mismatch are reported too: the Kernel reads the result and decides.
                const next = setStatus(db, task.id, status === "failed" ? "failed" : "reported")
                // A reset that broke keeps a repair intent, and the worktree with it, until --recover finishes it.
                if (repair !== null) markIntent(db, task.id, "repair", repair)
                return { task: task.id, attempt: attempt.id, status, taskStatus: next.status, inline: filing.inline, preserved, repair, needs }
            })
            const waiting = needs.length === 0 ? "" : await recordNeeds(db, callerRoot, data.task, needs)
            const worktree = data.taskStatus === "failed" && repair === null ? ((await removeOpWorktree(callerRoot, data.task).catch(() => undefined)) ?? null) : null
            const dir = preserved?.dir ?? null
            const kept = dir === null || repair !== null ? "" : `; dirty work preserved in ${dir} and reset`
            const broken = repair === null ? "" : `; its work is saved in ${repair} but not every path was put back: starci task verify ${data.task} --recover finishes the reset`
            const removed = worktree === null ? "" : `; worktree ${worktree.path} ${worktree.removed ? "removed" : "left"}`
            const message = `filed ${data.status} on ${data.attempt}${data.inline ? " (inline attempt)" : ""}; task ${data.task} is ${data.taskStatus}${kept}${broken}${removed}${waiting}`
            return { data, message, ...(repair === null ? {} : { exitCode: 1 }) }
        } finally {
            db.close()
        }
    },
})
