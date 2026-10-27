import { existsSync, readFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import { join, resolve } from "node:path"
import { briefFiles } from "../../harness/brief.js"
import { cleanVerify, pruneVerifyWorktrees } from "../../harness/clean-verify.js"
import type { CleanVerify, CleanVerifyInput } from "../../harness/clean-verify.js"
import { contractHash, contractProblems, readContract, resolveChecks } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { now, openExistingLedger, openLedger } from "../../harness/ledger.js"
import { loadLiveness } from "../../harness/liveness.js"
import { assertLeasesHeld, inTransaction, releaseLeases } from "../../harness/leases.js"
import { loadOps } from "../../harness/ops.js"
import type { Ops } from "../../harness/ops.js"
import { PreserveIncomplete, preserveTaskPaths, resetPreserved } from "../../harness/preserve.js"
import type { Preserved } from "../../harness/preserve.js"
import { runCheck } from "../../harness/run-checks.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "../../harness/run-checks.js"
import { closeSeatsOfTask } from "../../harness/seats.js"
import type { SeatClosing } from "../../harness/seats.js"
import { blockWork, settle, settleBranch, settleLockHolder, settleMessage, thisVerifier, withSettleLock, workLine } from "../../harness/settle.js"
import type { Settlement, Verifier, WorkWrite } from "../../harness/settle.js"
import { clearIntent, getTask, lastEvent, latestAttempt, markIntent, recordEvent, recordSettleCommit, resultOf, setStatus, setVerdict, taskCheckout } from "../../harness/tasks.js"
import type { AttemptRow, TaskRow, TaskStatus } from "../../harness/tasks.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { commitWithMessage, repositoryRoot, resolveSha } from "../../shared/git.js"
import { isTerminal } from "../../harness/leases.js"
import { inOrder } from "../../harness/sequential.js"
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
    readonly notes: readonly string[]
    readonly verdict: "green" | "red"
    readonly checks: readonly CheckOutcome[]
    readonly settlement: Settlement | null
    readonly work: WorkWrite | null
    readonly status: TaskStatus
    readonly preserved: Preserved | null
    readonly leasesReleased: number
    readonly seats: readonly SeatClosing[]
    readonly pruned: readonly string[]
}

/**
 * What `--recover` did: a task stuck in verifying with no live verifier is reconciled from git (its settle commit landed: done,
 * with `landed`) or put back to reported; a task holding a repair intent has its preserve reset finished (`repaired`).
 */
interface RecoverData {
    readonly mode: "recover"
    readonly task: string
    readonly status: TaskStatus
    readonly verifier: Verifier | null
    readonly landed: string | null
    readonly repaired: string | null
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
        const file = briefFiles(root, task.id).output
        if (existsSync(file)) {
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
    const checks = await inOrder(resolveChecks(contract, ops), (check) => runCheck(check, contract, place))
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
    if (task.intent === "repair") throw new Refusal("TASK_INTENT_HELD", `task ${task.id} has a preserve reset to finish; run starci task verify ${task.id} --recover`)
    if (task.intent !== null) throw new Refusal("TASK_INTENT_HELD", `task ${task.id} is ${task.intent}; it is not verified while that runs`)
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
        throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is verifying already; once no verifier holds the settle lock the next workflow step recovers it (by hand: starci task verify ${task.id} --recover)`)
    }
    if (task.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is ${task.status}; only a reported task is verified and settled`)
    const result = resultOf(db, attempt.id)
    if (result?.status !== "done") {
        throw new Refusal("RESULT_NOT_DONE", `attempt ${attempt.id} reported ${result?.status ?? "nothing"}; only a done result is verified, a ${result?.status ?? "missing"} result goes back to the sender`)
    }
    return attempt
}

/** The events of a verify that reached no verdict. */
const NO_VERDICT_KINDS = ["verify-error", "preserve-failed", "settle-refused"] as const

/**
 * A verify that reached no verdict (it broke, or HEAD moved under the settle) puts the task back to reported; no try is spent.
 * Once the attempt's result has reached no verdict `settleNoVerdictMax` times (ops/liveness.yaml), the failure is persistent
 * (a path git cannot write, a broken checkout): the task ends awaiting_owner with the last reason, its leases released and its
 * work left in the work tree, instead of returning to reported for a step to retry forever.
 */
const noVerdict = (db: DatabaseSync, taskId: string, attemptId: string, kind: string, error: unknown): Refusal => {
    const refusal = asRefusal(error)
    recordEvent(db, kind, taskId, { error: refusal.message, code: refusal.code })
    const since = resultOf(db, attemptId)?.filedAt ?? ""
    const marks = NO_VERDICT_KINDS.map(() => "?").join(", ")
    const ends = Number(db.prepare(`SELECT COUNT(*) AS n FROM events WHERE subject = ? AND kind IN (${marks}) AND at >= ?`).get(taskId, ...NO_VERDICT_KINDS, since)?.n ?? 0)
    const max = loadLiveness().settleNoVerdictMax
    if (ends < max) {
        setStatus(db, taskId, "reported")
        return new Refusal(refusal.code, `${refusal.message}\ntask ${taskId} is reported again (no verdict ${String(ends)} of ${String(max)}, no try spent); run starci task verify ${taskId} again`)
    }
    inTransaction(db, () => {
        setStatus(db, taskId, "awaiting_owner", "verifying")
        recordEvent(db, "verify-stuck", taskId, { ends, code: refusal.code, reason: refusal.message })
        releaseLeases(db, taskId)
    })
    return new Refusal(
        refusal.code,
        `${refusal.message}\ntask ${taskId} reached no verdict ${String(ends)} times in a row: it is awaiting_owner, its work left in the work tree; fix the cause and send a retry (starci task send <contract> --retry-of ${taskId})`,
    )
}

/** How a settling verify ended the task: what it settled, preserved and released, and which seats it closed. */
interface Ending {
    readonly status: TaskStatus
    readonly settlement: Settlement | null
    readonly work: WorkWrite | null
    readonly preserved: Preserved | null
    readonly leasesReleased: number
    readonly seats: readonly SeatClosing[]
    readonly seatProblem?: string
    readonly repair?: string
}

const seatLine = (ending: Ending): string[] => [
    ...(ending.seats.length === 0 ? [] : ["seats: " + ending.seats.map((seat) => seat.seat + " " + seat.outcome).join(", ")]),
    ...(ending.seatProblem === undefined ? [] : [`warning: the task's seats were not closed (${ending.seatProblem}); close them with starci seat stop <seat>`]),
    ...(ending.repair === undefined ? [] : [`warning: the red work is saved in ${ending.repair} but not every path was put back; the task keeps its leases until starci task verify <task> --recover finishes the reset`]),
]

/** How the verdict landed: settled with a commit, settled with nothing to commit, left unsettled, or checked only. */
const landedNote = (settlement: Settlement | null, commit: boolean, preserved: Preserved | null): string => {
    if (settlement !== null) return settlement.committed ? `settled: ${settlement.branch} -> ${settlement.commit.slice(0, 12)}` : "settled: the task changed nothing, no commit"
    if (!commit) return "checked only (--no-commit): nothing settled"
    const work = preserved?.dir == null ? "nothing of the task was dirty" : `its work was preserved in ${preserved.dir} and its paths reset`
    return `not settled: ${work}`
}

const reply = (taskId: string, attempt: AttemptRow, task: TaskRow, built: CleanVerify, ending: Ending, commit: boolean, pruned: readonly string[]): VerbResult<VerifyData> => {
    const { status, settlement, preserved, leasesReleased, seats } = ending
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
        work: ending.work,
        status,
        preserved,
        leasesReleased,
        seats,
        pruned,
    }
    const landed = landedNote(settlement, commit, preserved)
    const released = commit ? `; released ${String(leasesReleased)} lease(s)` : ""
    const extra = [
        `task ${taskId}: ${status}; ${landed}${released}`,
        ...(ending.work === null ? [] : [workLine(ending.work)]),
        ...seatLine(ending),
        ...(settlement?.warnings ?? []).map((warning) => `warning: ${warning}`),
        ...built.notes.map((note) => `note: ${note}`),
        ...(pruned.length === 0 ? [] : [`pruned ${String(pruned.length)} leftover verify checkout(s)`]),
    ]
    return { data, message: report(built.checks, built.verdict, extra), exitCode: built.verdict === "green" ? 0 : 1 }
}

/**
 * Freezes the task's worker before a settling verify: its open seats are stopped through Orca, so nothing writes under the
 * allowPaths while the candidate is built or a red verdict resets them. Refuses VERIFY_WORKER_LIVE, with nothing changed, when
 * a worker may still run (Orca unreachable, a stop it did not confirm, a launch that named no dispatch).
 */
const freezeWorker = async (root: string, taskId: string): Promise<readonly SeatClosing[]> => {
    let seats: SeatClosing[]
    try {
        seats = await closeSeatsOfTask(root, taskId)
    } catch (error: unknown) {
        throw new Refusal("VERIFY_WORKER_LIVE", `task ${taskId} keeps its worker seat open and Orca could not stop it (${asRefusal(error).message}); nothing was verified, stop the seat (starci seat stop <seat>) and verify again`)
    }
    const live = seats.filter((seat) => seat.outcome === "not-stopped" || seat.outcome === "launch-unknown")
    if (live.length > 0) {
        throw new Refusal("VERIFY_WORKER_LIVE", `task ${taskId}: the worker of seat ${live.map((seat) => `${seat.seat} (${seat.outcome})`).join(", ")} may still write; nothing was verified, stop it and verify again`)
    }
    return seats
}

/** The red ending under the settle lock: the verdict, the failed status and the lease release land in one transaction. */
const failTask = (db: DatabaseSync, taskId: string, attemptId: string, repair: string | null): number =>
    inTransaction(db, () => {
        setVerdict(db, attemptId, "red")
        setStatus(db, taskId, "failed", "verifying")
        if (repair !== null) markIntent(db, taskId, "repair", repair)
        return repair === null ? releaseLeases(db, taskId) : 0
    })

/** The green ending: verdict, settle record, the commit (recordSettleCommit), done and the lease release in one transaction. */
const finishTask = (db: DatabaseSync, taskId: string, attemptId: string, settlement: { readonly commit: string; readonly committed: boolean }, event: string, data: unknown): number =>
    inTransaction(db, () => {
        setVerdict(db, attemptId, "green")
        recordEvent(db, event, taskId, data)
        recordSettleCommit(db, taskId, settlement.committed ? settlement.commit : null)
        setStatus(db, taskId, "done", "verifying")
        return releaseLeases(db, taskId)
    })

/**
 * The ledger task path: clean verify, record, verdict, then settle on green or fail on red; --no-commit only checks. A settling
 * verify holds the project's settle lock from the candidate build to the settle, so parallel verifies land one after another.
 * A red verdict preserves the task's dirty allowPaths and resets them while it still holds its leases, so an overlapping task
 * can never commit them; only then does it fail the task and release the leases. Once the task ended its seats are closed.
 */
const verifyTask = async (cwd: string, taskId: string, commit: boolean): Promise<VerbResult<VerifyData>> => {
    const callerRoot = await repositoryRoot(cwd)
    const ops = loadOps()
    const db = openLedger(callerRoot)
    try {
        const task = getTask(db, taskId)
        const attempt = verifiable(db, task, commit)
        // The task's work lives in its own checkout, which may not be the caller's: it is judged and settled there.
        const root = await taskCheckout(task, callerRoot)
        const pruned = await pruneVerifyWorktrees(root)
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
        const unsettled: Ending = { status: task.status, settlement: null, work: null, preserved: null, leasesReleased: 0, seats: [] }
        if (!commit) {
            const built = await cleanVerify(input)
            recordRuns(db, taskId, attempt.id, task.contractHash, built.checks)
            recordEvent(db, "task-verified", taskId, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, foreign: built.foreign, settle: false })
            return reply(taskId, attempt, task, built, { ...unsettled, status: getTask(db, taskId).status }, false, pruned)
        }
        await settleBranch(root)
        const frozen = await freezeWorker(root, taskId)
        const me = thisVerifier(taskId)
        const settled = await withSettleLock(db, me, input.timeoutMs ?? MINUTE_MS, async (): Promise<{ readonly built: CleanVerify; readonly ending: Ending }> => {
            const fresh = getTask(db, taskId)
            if (fresh.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${taskId} is ${fresh.status} now; another verify took it while this one waited`)
            // Fencing: a task that lost a lease cannot land (or reset) work on a path another task may own now.
            assertLeasesHeld(db, fresh)
            // The claim, by compare-and-swap, before any git side effect; the parent lets --recover find a settle that landed.
            setStatus(db, taskId, "verifying", "reported")
            recordEvent(db, "verify-started", taskId, { ...me, parent: await resolveSha(root, "HEAD"), checkout: root })
            let built: CleanVerify
            try {
                built = await cleanVerify(input)
            } catch (error: unknown) {
                throw noVerdict(db, taskId, attempt.id, "verify-error", error)
            }
            recordRuns(db, taskId, attempt.id, task.contractHash, built.checks)
            recordEvent(db, "task-verified", taskId, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, foreign: built.foreign, settle: true })
            if (built.verdict === "red") {
                let preserved: Preserved
                let repair: string | null = null
                try {
                    preserved = await preserveTaskPaths(root, fresh, db)
                } catch (error: unknown) {
                    // Saved but not all put back: the verdict stands, the leases stay under a repair intent (--recover finishes it).
                    if (!(error instanceof PreserveIncomplete)) throw noVerdict(db, taskId, attempt.id, "preserve-failed", error)
                    repair = error.dir
                    preserved = { dir: error.dir, patch: null, tracked: [], untracked: [] }
                }
                const leasesReleased = failTask(db, taskId, attempt.id, repair)
                // A uat task's record turns blocked in a Work commit of its own, still under the settle lock.
                const work = await blockWork(root, fresh, input.result, built.checks.filter((check) => check.status === "red").map((check) => check.name))
                if (work !== null) recordEvent(db, "work-written", taskId, work)
                return { built, ending: { ...unsettled, status: "failed", work, preserved, leasesReleased, ...(repair === null ? {} : { repair }) } }
            }
            let settlement: Settlement
            try {
                settlement = await settle(root, built, fresh)
            } catch (error: unknown) {
                throw noVerdict(db, taskId, attempt.id, "settle-refused", error)
            }
            // The branch moved: from here the task is done whatever else happens (a crash here is reconciled by --recover from git).
            const leasesReleased = finishTask(db, taskId, attempt.id, settlement, "task-settled", settlement)
            return { built, ending: { ...unsettled, status: "done", settlement, work: settlement.work, leasesReleased } }
        })
        // The task ended; its worker has nothing left to do. Closing talks to Orca, so it runs outside the settle lock and any transaction.
        const closing = await closeSeatsOfTask(root, taskId).then(
            (seats): Pick<Ending, "seats" | "seatProblem"> => ({ seats }),
            (error: unknown): Pick<Ending, "seats" | "seatProblem"> => ({ seats: [], seatProblem: asRefusal(error).message }),
        )
        const seats = closing.seats.length > 0 ? closing.seats : frozen
        return reply(taskId, attempt, task, settled.built, { ...settled.ending, ...closing, seats }, true, pruned)
    } finally {
        db.close()
    }
}

/** `--recover` of a repair intent: finishes the reset from the preserve's manifest, then drops the intent and frees the leases of an ended task. */
const repairTask = async (db: DatabaseSync, root: string, task: TaskRow): Promise<VerbResult<VerifyData>> => {
    const dir = task.intentData?.dir ?? null
    if (dir === null) throw new Refusal("TASK_REPAIR_UNKNOWN", `task ${task.id} holds a repair intent that names no preserve folder; inspect its task-preserved events`)
    await resetPreserved(root, dir)
    const released = inTransaction(db, () => {
        clearIntent(db, task.id)
        recordEvent(db, "preserve-repaired", task.id, { dir })
        return isTerminal(task.status) ? releaseLeases(db, task.id) : 0
    })
    const data: RecoverData = { mode: "recover", task: task.id, status: task.status, verifier: null, landed: null, repaired: dir, pruned: [] }
    return { data, message: `task ${task.id}: the reset of ${dir} is finished; task is ${task.status}; released ${String(released)} lease(s)` }
}

/** The `verify-started` facts: the verifier and the HEAD it started from (absent on an event older than version 7). */
const startedFrom = (value: unknown): { readonly verifier: Verifier | null; readonly parent: string | undefined } => {
    if (typeof value !== "object" || value === null) return { verifier: null, parent: undefined }
    const record = value as Record<string, unknown>
    const verifier = typeof record.task === "string" && typeof record.pid === "number" && typeof record.host === "string" && typeof record.at === "string" ? { task: record.task, pid: record.pid, host: record.host, at: record.at } : null
    return { verifier, parent: typeof record.parent === "string" ? record.parent : undefined }
}

/**
 * `--recover`: git is the authority for landed. A task left in verifying whose verifier no longer holds the settle lock is
 * done when its branch carries the task's settle commit (message and `Starci-Task:` trailer) after the HEAD the verify started
 * from, and goes back to reported otherwise; either way that verifier's checkout is pruned. A task holding a repair intent has
 * its preserve reset finished.
 */
const recoverTask = async (cwd: string, taskId: string): Promise<VerbResult<VerifyData>> => {
    const callerRoot = await repositoryRoot(cwd)
    const db = openLedger(callerRoot)
    try {
        const task = getTask(db, taskId)
        const root = await taskCheckout(task, callerRoot)
        if (task.intent === "repair") return await repairTask(db, root, task)
        if (task.status !== "verifying") throw new Refusal("TASK_NOT_VERIFYING", `task ${taskId} is ${task.status}; --recover only frees a task stuck in verifying or finishes a preserve reset`)
        const holder = settleLockHolder(db)
        const { verifier, parent } = startedFrom(lastEvent(db, "verify-started", taskId))
        if (holder?.task === taskId) {
            throw new Refusal("VERIFY_LIVE", `task ${taskId} is being verified by pid ${String(holder.pid)} on ${holder.host} since ${holder.at}; wait for it, or stop that process first`)
        }
        const landed = (await commitWithMessage(root, "HEAD", settleMessage(task.contract, taskId), parent)) ?? null
        const pruned = await pruneVerifyWorktrees(root)
        const attempt = latestAttempt(db, taskId)
        if (landed !== null && attempt !== undefined) {
            const released = finishTask(db, taskId, attempt.id, { commit: landed, committed: true }, "verify-reconciled", { verifier, commit: landed })
            const data: RecoverData = { mode: "recover", task: taskId, status: "done", verifier, landed, repaired: null, pruned }
            return { data, message: `task ${taskId}: verifying -> done (its settle commit ${landed.slice(0, 12)} is on the branch; the verifier died after landing it); released ${String(released)} lease(s)` }
        }
        setStatus(db, taskId, "reported", "verifying")
        recordEvent(db, "verify-recovered", taskId, { verifier })
        const data: RecoverData = { mode: "recover", task: taskId, status: "reported", verifier, landed: null, repaired: null, pruned }
        const who = verifier === null ? "no verifier was recorded" : `verifier pid ${String(verifier.pid)} is gone`
        return { data, message: `task ${taskId}: verifying -> reported (${who}, no settle commit landed); pruned ${String(pruned.length)} verify checkout(s); verify it again` }
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
        task: { kind: "string", summary: "the ledger task to verify and settle (with --contract: the task whose files and @result the replay judges)", positional: true },
        contract: { kind: "string", summary: "dry-replay this contract json file in the working tree instead (no task status change)" },
        record: { kind: "boolean", summary: "with --contract: file every check run in the project's ledger" },
        "no-commit": { kind: "boolean", summary: "verify the task on a clean checkout without settling it or changing its status" },
        recover: { kind: "boolean", summary: "reconcile a task stuck in verifying (its verifier died) from git: done when its settle commit landed, else reported; or finish a broken preserve reset" },
    },
    run: async (context, flags): Promise<VerbResult<VerifyData>> => {
        if (flags.contract !== undefined) return verifyContract(context.cwd, resolve(context.cwd, flags.contract), flags.task, flags.record)
        if (flags.task === undefined) throw new Refusal("TASK_NOT_NAMED", "name the task: starci task verify <task-id>, or dry-replay a contract: starci task verify --contract <file>")
        if (flags.recover) return recoverTask(context.cwd, flags.task)
        return verifyTask(context.cwd, flags.task, !flags["no-commit"])
    },
})
