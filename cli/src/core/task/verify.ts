import { existsSync, readFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import { join, resolve } from "node:path"
import { briefFiles } from "../../harness/brief.js"
import { cleanVerify, pruneVerifyWorktrees } from "../../harness/clean-verify.js"
import type { CleanVerify, CleanVerifyInput } from "../../harness/clean-verify.js"
import { contractHash, contractProblems, readContract, resolveChecks } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { now, openExistingLedger, openLedger, projectRoot } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import type { Ops } from "../../harness/ops.js"
import { runCheck } from "../../harness/run-checks.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "../../harness/run-checks.js"
import { asVerifier, settle, settleBranch, settleMessage, thisVerifier, verifierAlive, withSettleLock } from "../../harness/settle.js"
import type { Settlement, Verifier } from "../../harness/settle.js"
import { getTask, lastEvent, latestAttempt, recordEvent, releaseTaskLeases, resultOf, setStatus, setVerdict } from "../../harness/tasks.js"
import type { AttemptRow, TaskRow, TaskStatus } from "../../harness/tasks.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
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
    readonly notes: readonly string[]
    readonly verdict: "green" | "red"
    readonly checks: readonly CheckOutcome[]
    readonly settlement: Settlement | null
    readonly status: TaskStatus
    readonly pruned: readonly string[]
}

/** A task stuck in verifying with no live verifier, put back to reported. */
interface RecoverData {
    readonly mode: "recover"
    readonly task: string
    readonly status: TaskStatus
    readonly verifier: Verifier | null
    readonly pruned: readonly string[]
}

type VerifyData = ContractVerifyData | TaskVerifyData | RecoverData

const MINUTE_MS = 60_000

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

/** What `@result` json checks read for a task: its filed result, else (before filing, in the worker's dry replay) its output file. */
const resultSource = (db: DatabaseSync, root: string, task: TaskRow, attempt: AttemptRow | undefined, fileFallback: boolean): ResultSource => {
    const filed = attempt === undefined ? undefined : resultOf(db, attempt.id)
    if (filed !== undefined) return { output: filed.output, from: `the result filed on ${filed.attemptId}` }
    if (fileFallback) {
        const file = [projectRoot(root), root].map((dir) => briefFiles(dir, task.id).output).find((candidate) => existsSync(candidate))
        if (file !== undefined) {
            try {
                return { output: JSON.parse(readFileSync(file, "utf8")), from: file }
            } catch (error: unknown) {
                return { missing: `${file} is not json: ${error instanceof Error ? error.message : String(error)}` }
            }
        }
    }
    return { missing: `task ${task.id} has filed no result yet (starci task result ${task.id} --status done --output @<file>)` }
}

/**
 * The dry replay of `--contract`: the checks run in the working tree as it is, and the ledger only hears of it with --record.
 * Naming the task scopes the files check to what that task may have written and lets `@result` read its output file.
 */
const verifyContract = async (cwd: string, file: string, taskId: string | undefined, record: boolean): Promise<VerbResult<VerifyData>> => {
    const ops = loadOps()
    const contract = readContract(file)
    unfit(contract, ops)
    const root = await repositoryRoot(cwd)
    let place: CheckPlace = { root, cwd: join(root, contract.context.cwd ?? ".") }
    if (taskId !== undefined) {
        const db = openExistingLedger(root)
        if (db === undefined) throw new Refusal("TASK_UNKNOWN", `no task ${taskId}: this project has no ledger yet`)
        try {
            const task = getTask(db, taskId)
            place = { ...place, taskId, since: task.createdAt, result: resultSource(db, root, task, latestAttempt(db, taskId), true) }
        } finally {
            db.close()
        }
    }
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
            `task ${task.id} is running and has filed no result; file the result first (starci task result ${task.id} --status done --output @<file>), or check without settling: starci task verify ${task.id} --no-commit`,
        )
    }
    if (task.status === "verifying") {
        throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is verifying already; if no verifier is alive any more, put it back with: starci task verify ${task.id} --recover`)
    }
    if (task.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is ${task.status}; only a reported task is verified and settled`)
    const result = resultOf(db, attempt.id)
    if (result?.status !== "done") {
        throw new Refusal("RESULT_NOT_DONE", `attempt ${attempt.id} reported ${result?.status ?? "nothing"}; only a done result is verified, a ${result?.status ?? "missing"} result goes back to the sender`)
    }
    return attempt
}

/** A verify that reached no verdict (it broke, or HEAD moved under the settle) puts the task back to reported; no try is spent. */
const noVerdict = (db: DatabaseSync, taskId: string, kind: string, error: unknown): Refusal => {
    const refusal = asRefusal(error)
    recordEvent(db, kind, taskId, { error: refusal.message, code: refusal.code })
    setStatus(db, taskId, "reported")
    return new Refusal(refusal.code, `${refusal.message}\ntask ${taskId} is reported again (no verdict, no try spent); run starci task verify ${taskId} again`)
}

const reply = (taskId: string, attempt: AttemptRow, task: TaskRow, built: CleanVerify, settlement: Settlement | null, status: TaskStatus, commit: boolean, pruned: readonly string[]): VerbResult<VerifyData> => {
    const data: TaskVerifyData = {
        mode: "task",
        task: taskId,
        attempt: attempt.id,
        hash: task.contractHash,
        base: built.base,
        candidate: built.candidate,
        tree: built.tree,
        changed: built.changed,
        notes: built.notes,
        verdict: built.verdict,
        checks: built.checks,
        settlement,
        status,
        pruned,
    }
    const landed =
        settlement === null
            ? commit
                ? "not settled: the work tree is untouched"
                : "checked only (--no-commit): nothing settled"
            : settlement.committed
              ? `settled: ${settlement.branch} -> ${settlement.commit.slice(0, 12)}`
              : "settled: the task changed nothing, no commit"
    const extra = [
        `task ${taskId}: ${status}; ${landed}`,
        ...(settlement?.warnings ?? []).map((warning) => `warning: ${warning}`),
        ...built.notes.map((note) => `note: ${note}`),
        ...(pruned.length === 0 ? [] : [`pruned ${String(pruned.length)} leftover verify checkout(s)`]),
    ]
    return { data, message: report(built.checks, built.verdict, extra), exitCode: built.verdict === "green" ? 0 : 1 }
}

/**
 * The ledger task path: clean verify, record, verdict, then settle on green or fail on red; --no-commit only checks. A settling
 * verify holds the project's settle lock from the candidate build to the settle, so parallel verifies land one after another.
 */
const verifyTask = async (cwd: string, taskId: string, commit: boolean): Promise<VerbResult<VerifyData>> => {
    const root = await repositoryRoot(cwd)
    const ops = loadOps()
    const pruned = await pruneVerifyWorktrees(root)
    const db = openLedger(root)
    try {
        const task = getTask(db, taskId)
        const attempt = verifiable(db, task, commit)
        unfit(task.contract, ops)
        const input: CleanVerifyInput = {
            root,
            contract: task.contract,
            checks: resolveChecks(task.contract, ops),
            name: taskId,
            message: settleMessage(task.contract, taskId),
            taskId,
            since: task.createdAt,
            result: resultSource(db, root, task, attempt, false),
            timeoutMs: task.contract.budget.minutes * MINUTE_MS,
        }
        if (!commit) {
            const built = await cleanVerify(input)
            recordRuns(db, taskId, attempt.id, task.contractHash, built.checks)
            recordEvent(db, "task-verified", taskId, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, settle: false })
            return reply(taskId, attempt, task, built, null, getTask(db, taskId).status, false, pruned)
        }
        await settleBranch(root)
        const me = thisVerifier(taskId)
        return await withSettleLock(db, me, input.timeoutMs ?? MINUTE_MS, async () => {
            const fresh = getTask(db, taskId)
            if (fresh.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${taskId} is ${fresh.status} now; another verify took it while this one waited`)
            setStatus(db, taskId, "verifying")
            recordEvent(db, "verify-started", taskId, me)
            let built: CleanVerify
            try {
                built = await cleanVerify(input)
            } catch (error: unknown) {
                throw noVerdict(db, taskId, "verify-error", error)
            }
            recordRuns(db, taskId, attempt.id, task.contractHash, built.checks)
            recordEvent(db, "task-verified", taskId, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, settle: true })
            setVerdict(db, attempt.id, built.verdict)
            if (built.verdict === "red") {
                setStatus(db, taskId, "failed")
                releaseTaskLeases(db, taskId)
                return reply(taskId, attempt, task, built, null, "failed", true, pruned)
            }
            let settlement: Settlement
            try {
                settlement = await settle(root, built)
            } catch (error: unknown) {
                throw noVerdict(db, taskId, "settle-refused", error)
            }
            // The branch moved: from here the task is done whatever else happens.
            recordEvent(db, "task-settled", taskId, settlement)
            setStatus(db, taskId, "done")
            releaseTaskLeases(db, taskId)
            return reply(taskId, attempt, task, built, settlement, "done", true, pruned)
        })
    } finally {
        db.close()
    }
}

/** `--recover`: a task left in verifying by a verifier that died goes back to reported, and that verifier's checkout is pruned. */
const recoverTask = async (cwd: string, taskId: string): Promise<VerbResult<VerifyData>> => {
    const root = await repositoryRoot(cwd)
    const db = openLedger(root)
    try {
        const task = getTask(db, taskId)
        if (task.status !== "verifying") throw new Refusal("TASK_NOT_VERIFYING", `task ${taskId} is ${task.status}; --recover only frees a task stuck in verifying`)
        const verifier = asVerifier(lastEvent(db, "verify-started", taskId)) ?? null
        if (verifier !== null && verifierAlive(verifier)) {
            throw new Refusal("VERIFY_LIVE", `task ${taskId} is being verified by pid ${String(verifier.pid)} on ${verifier.host} since ${verifier.at}; wait for it, or stop that process first`)
        }
        setStatus(db, taskId, "reported")
        recordEvent(db, "verify-recovered", taskId, { verifier })
        const pruned = await pruneVerifyWorktrees(root)
        const data: RecoverData = { mode: "recover", task: taskId, status: "reported", verifier, pruned }
        const who = verifier === null ? "no verifier was recorded" : `verifier pid ${String(verifier.pid)} is gone`
        return { data, message: `task ${taskId}: verifying -> reported (${who}); pruned ${String(pruned.length)} verify checkout(s); verify it again` }
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
    roles: EVERYONE,
    schema: "starci/task-verify@1",
    flags: {
        task: { kind: "string", summary: "the ledger task to verify and settle (with --contract: the task whose files and @result the replay judges)", positional: true },
        contract: { kind: "string", summary: "dry-replay this contract json file in the working tree instead (no task status change)" },
        record: { kind: "boolean", summary: "with --contract: file every check run in the ledger (.starciwork/runtime.sqlite)" },
        "no-commit": { kind: "boolean", summary: "verify the task on a clean checkout without settling it or changing its status" },
        recover: { kind: "boolean", summary: "put a task stuck in verifying (its verifier died) back to reported; refused while the verifier lives" },
    },
    run: async (context, flags): Promise<VerbResult<VerifyData>> => {
        if (flags.contract !== undefined) return verifyContract(context.cwd, resolve(context.cwd, flags.contract), flags.task, flags.record)
        if (flags.task === undefined) throw new Refusal("TASK_NOT_NAMED", "name the task: starci task verify <task-id>, or dry-replay a contract: starci task verify --contract <file>")
        if (flags.recover) return recoverTask(context.cwd, flags.task)
        return verifyTask(context.cwd, flags.task, !flags["no-commit"])
    },
})
