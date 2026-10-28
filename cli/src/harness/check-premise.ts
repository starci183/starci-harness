import type { DatabaseSync } from "node:sqlite"
import { resolveChecks } from "./contract.js"
import { loadOps } from "./ops.js"
import { getTask, latestAttempt, resultOf } from "./tasks.js"

/** The Kernel decision a red check's premise raises: the check, not the work, is what the Kernel amends. */
export const CHECK_PREMISE = "check-premise"

/** A contract's own command check (`check-<n>:command`), the Kernel's words, never a preset of ops/checks.yaml. */
const OWN_COMMAND = /^check-\d+:command$/

/** An output that states an expectation the run contradicted: an assertion, an expected value, a matcher, a `node -e` script's own throw. */
const EXPECTATION = /AssertionError|\bassert(?:ion)?\b|\bexpected\b|\bexpect\(|\bto(?:Be|Equal|Match|Contain)\b|\[eval\]:\d+/i

const OUTPUT_TAIL = 1500

/** One red check whose premise the evidence questions: its name, the command the contract wrote, and the tail of its output. */
export interface PremiseCheck {
    readonly name: string
    readonly run: string
    readonly output: string
}

/**
 * The checks of a failed task whose red is the check's premise and not the work: the worker filed done, every red check of its
 * newest attempt is a command check the contract itself wrote (never a preset) whose output states an expectation the run
 * contradicted, and every other check of that verify was green, so the work met the rest of its contract. Undefined for any
 * other failure, which stays a `red` decision. The Kernel answers the `check-premise` decision by amending the task's checks.
 */
export const premiseChecks = (db: DatabaseSync, taskId: string): readonly PremiseCheck[] | undefined => {
    const task = getTask(db, taskId)
    const attempt = latestAttempt(db, taskId)
    if (task.status !== "failed" || attempt?.verdict !== "red" || resultOf(db, attempt.id)?.status !== "done") return undefined
    const runs = db.prepare("SELECT name, status, detail FROM check_runs WHERE attempt_id = ? ORDER BY id").all(attempt.id)
    const red = runs.filter((row) => row.status === "red").map((row) => ({ name: String(row.name), detail: typeof row.detail === "string" ? row.detail : "" }))
    if (red.length === 0 || !red.every((row) => OWN_COMMAND.test(row.name) && EXPECTATION.test(row.detail))) return undefined
    let checks: ReturnType<typeof resolveChecks>
    try {
        checks = resolveChecks(task.contract, loadOps())
    } catch {
        return undefined
    }
    return red.map((row) => {
        const check = checks.find((candidate) => candidate.name === row.name)?.check
        const run = check?.kind === "command" ? (Array.isArray(check.run) ? check.run.join(" ") : check.run) : row.name
        return { name: row.name, run, output: row.detail.length <= OUTPUT_TAIL ? row.detail : `…${row.detail.slice(-OUTPUT_TAIL)}` }
    })
}
