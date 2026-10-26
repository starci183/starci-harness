import type { DatabaseSync } from "node:sqlite"
import { join, resolve } from "node:path"
import { cleanVerify } from "../../harness/clean-verify.js"
import type { CleanVerify } from "../../harness/clean-verify.js"
import { contractHash, contractProblems, readContract, resolveChecks } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { now, openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import type { Ops } from "../../harness/ops.js"
import { runCheck } from "../../harness/run-checks.js"
import type { CheckOutcome } from "../../harness/run-checks.js"
import { settle, settleBranch, settleMessage } from "../../harness/settle.js"
import type { Settlement } from "../../harness/settle.js"
import { getTask, latestAttempt, recordEvent, resultOf, setStatus, setVerdict } from "../../harness/tasks.js"
import type { AttemptRow, TaskRow, TaskStatus } from "../../harness/tasks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"

/** A dry replay of a contract file in the working tree. */
interface ContractVerifyData {
    readonly mode: "contract"
    readonly contract: string
    readonly hash: string
    readonly verdict: "green" | "red"
    readonly checks: readonly CheckOutcome[]
    readonly recorded: boolean
}

/** A ledger task verified on a clean checkout of its candidate commit. */
interface TaskVerifyData {
    readonly mode: "task"
    readonly task: string
    readonly attempt: string
    readonly hash: string
    readonly base: string
    readonly candidate: string
    readonly tree: string
    readonly changed: readonly string[]
    readonly verdict: "green" | "red"
    readonly checks: readonly CheckOutcome[]
    readonly settlement: Settlement | null
    readonly status: TaskStatus
}

type VerifyData = ContractVerifyData | TaskVerifyData

const unfit = (contract: Contract, ops: Ops): void => {
    const problems = contractProblems(contract, ops)
    if (problems.length > 0) throw new Refusal("CONTRACT_UNFIT", `the contract is not fit to verify:\n${problems.join("\n")}`)
}

const report = (checks: readonly CheckOutcome[], verdict: "green" | "red", extra: readonly string[]): string => {
    const table = formatTable([["CHECK", "KIND", "STATUS"], ...checks.map((check) => [check.name, check.kind, check.status])])
    const reds = checks.filter((check) => check.status === "red").map((check) => `--- ${check.name}\n${check.detail}`)
    return [table, `verdict: ${verdict}`, ...extra, ...reds].join("\n")
}

const recordRuns = (db: DatabaseSync, taskId: string | null, attemptId: string | null, hash: string, checks: readonly CheckOutcome[]): void => {
    const insert = db.prepare("INSERT INTO check_runs (task_id, attempt_id, contract_hash, name, runner, status, exit_code, detail, ran_at) VALUES (?, ?, ?, ?, 'harness', ?, ?, ?, ?)")
    const at = now()
    for (const check of checks) insert.run(taskId, attemptId, hash, check.name, check.status, check.exitCode, check.detail, at)
}

// leases.ts belongs to another lane; a settled task frees its paths with this one statement.
const releaseLeases = (db: DatabaseSync, taskId: string): void => {
    db.prepare("DELETE FROM leases WHERE task_id = ?").run(taskId)
}

/** The dry replay of `--contract`: the checks run in the working tree as it is, and the ledger only hears of it with --record. */
const verifyContract = async (cwd: string, file: string, taskId: string | undefined, record: boolean): Promise<VerbResult<VerifyData>> => {
    const ops = loadOps()
    const contract = readContract(file)
    unfit(contract, ops)
    const root = await repositoryRoot(cwd)
    const place = { root, cwd: join(root, contract.context.cwd ?? ".") }
    const checks: CheckOutcome[] = []
    for (const check of resolveChecks(contract, ops)) checks.push(await runCheck(check, contract, place))
    const verdict = checks.every((check) => check.status === "green") ? "green" : "red"
    const hash = contractHash(contract)
    if (record) {
        const db = openLedger(root)
        try {
            recordRuns(db, taskId ?? null, null, hash, checks)
            recordEvent(db, "task-verified", hash, { verdict, contract: file })
        } finally {
            db.close()
        }
    }
    const data: ContractVerifyData = { mode: "contract", contract: file, hash, verdict, checks, recorded: record }
    return { data, message: report(checks, verdict, []), exitCode: verdict === "green" ? 0 : 1 }
}

/** Refuses a task that cannot be verified now; returns the attempt whose result is judged. */
const verifiable = (db: DatabaseSync, task: TaskRow, commit: boolean): AttemptRow => {
    const attempt = latestAttempt(db, task.id)
    if (attempt === undefined) throw new Refusal("TASK_NOT_SENT", `task ${task.id} has no attempt yet; send it first`)
    if (!commit) {
        if (task.status !== "running" && task.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is ${task.status}; only a running or reported task can be checked`)
        return attempt
    }
    if (task.status === "running") {
        throw new Refusal(
            "RESULT_NOT_FILED",
            `task ${task.id} is running and has filed no result; file the result first (starci task result ${task.id} --status done --output <file>), or check without settling: starci task verify ${task.id} --no-commit`,
        )
    }
    if (task.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is ${task.status}; only a reported task is verified and settled`)
    const result = resultOf(db, attempt.id)
    if (result?.status !== "done") {
        throw new Refusal("RESULT_NOT_DONE", `attempt ${attempt.id} reported ${result?.status ?? "nothing"}; only a done result is verified, a ${result?.status ?? "missing"} result goes back to the sender`)
    }
    return attempt
}

/** Moves a task that broke mid-verify to failed, so no task is left in verifying; the error itself is rethrown by the caller. */
const failMidway = (db: DatabaseSync, taskId: string, kind: string, error: unknown): void => {
    recordEvent(db, kind, taskId, { error: error instanceof Error ? error.message : String(error), code: error instanceof Refusal ? error.code : null })
    setStatus(db, taskId, "failed")
}

/** The ledger task path: clean verify, record, verdict, then settle on green or fail on red; --no-commit only checks. */
const verifyTask = async (cwd: string, taskId: string, commit: boolean): Promise<VerbResult<VerifyData>> => {
    const root = await repositoryRoot(cwd)
    const ops = loadOps()
    const db = openLedger(root)
    try {
        const task = getTask(db, taskId)
        const attempt = verifiable(db, task, commit)
        unfit(task.contract, ops)
        const checks = resolveChecks(task.contract, ops)
        if (commit) {
            await settleBranch(root)
            setStatus(db, taskId, "verifying")
        }
        let built: CleanVerify
        try {
            built = await cleanVerify({ root, contract: task.contract, checks, name: taskId, message: settleMessage(task.contract, taskId) })
        } catch (error: unknown) {
            if (commit) failMidway(db, taskId, "verify-error", error)
            throw error
        }
        recordRuns(db, taskId, attempt.id, task.contractHash, built.checks)
        recordEvent(db, "task-verified", taskId, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, settle: commit })
        let settlement: Settlement | null = null
        if (commit) {
            setVerdict(db, attempt.id, built.verdict)
            if (built.verdict === "green") {
                try {
                    settlement = await settle(root, built)
                } catch (error: unknown) {
                    failMidway(db, taskId, "settle-refused", error)
                    throw error
                }
                recordEvent(db, "task-settled", taskId, settlement)
                setStatus(db, taskId, "done")
                releaseLeases(db, taskId)
            } else {
                setStatus(db, taskId, "failed")
            }
        }
        const status = getTask(db, taskId).status
        const data: TaskVerifyData = {
            mode: "task",
            task: taskId,
            attempt: attempt.id,
            hash: task.contractHash,
            base: built.base,
            candidate: built.candidate,
            tree: built.tree,
            changed: built.changed,
            verdict: built.verdict,
            checks: built.checks,
            settlement,
            status,
        }
        const landed =
            settlement === null
                ? commit
                    ? "not settled: the work tree is untouched"
                    : "checked only (--no-commit): nothing settled"
                : settlement.committed
                  ? `settled: ${settlement.branch} -> ${settlement.commit.slice(0, 12)}`
                  : "settled: the task changed nothing, no commit"
        return { data, message: report(built.checks, built.verdict, [`task ${taskId}: ${status}; ${landed}`]), exitCode: built.verdict === "green" ? 0 : 1 }
    } finally {
        db.close()
    }
}

/** `starci task verify`: verifies a ledger task on a clean checkout and settles it on green, or dry-replays a contract file. */
export const taskVerifyVerb = defineVerb({
    path: ["task", "verify"],
    summary: "verify a task on a clean checkout of HEAD plus its allowPaths and commit it on green; --contract dry-replays a contract file",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/task-verify@1",
    flags: {
        task: { kind: "string", summary: "the ledger task to verify and settle", positional: true },
        contract: { kind: "string", summary: "dry-replay this contract json file in the working tree instead (no task status change)" },
        record: { kind: "boolean", summary: "with --contract: file every check run in the ledger (.starciwork/runtime.sqlite)" },
        "no-commit": { kind: "boolean", summary: "verify the task on a clean checkout without settling it or changing its status" },
    },
    run: async (context, flags): Promise<VerbResult<VerifyData>> => {
        if (flags.contract !== undefined) return verifyContract(context.cwd, resolve(context.cwd, flags.contract), flags.task, flags.record)
        if (flags.task === undefined) throw new Refusal("TASK_NOT_NAMED", "name the task: starci task verify <task-id>, or dry-replay a contract: starci task verify --contract <file>")
        return verifyTask(context.cwd, flags.task, !flags["no-commit"])
    },
})
