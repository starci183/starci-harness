import { existsSync, readFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import { join, resolve } from "node:path"
import { opForkOf } from "../../harness/baseline.js"
import { briefFiles } from "../../harness/brief.js"
import { cleanVerify, declaredFiles, pruneVerifyWorktrees, VERIFY_INFRA } from "../../harness/clean-verify.js"
import type { CleanVerify, CleanVerifyInput } from "../../harness/clean-verify.js"
import { contractHash, contractProblems, readContract, resolveChecks } from "../../harness/contract.js"
import { blockOnCustody, CUSTODY_CODES, isCustodyRecheck } from "../../harness/custody.js"
import type { Contract, ContractJudging } from "../../harness/contract.js"
import { enablePatterns, patternsOfFindings, patternsOfPaths } from "../../harness/hfs-patterns.js"
import type { PatternNeed, PatternsEnabled } from "../../harness/hfs-patterns.js"
import { inTransaction, now, openExistingLedger, openLedger } from "../../harness/ledger.js"
import { loadLiveness } from "../../harness/liveness.js"
import { loadOps } from "../../harness/ops.js"
import type { Ops } from "../../harness/ops.js"
import { PreserveIncomplete, preserveTaskPaths, resetPreserved } from "../../harness/preserve.js"
import type { Preserved, StaleCleared } from "../../harness/preserve.js"
import { LAND_ORPHANED } from "../../harness/revive.js"
import { recheckOf, recordBaselineFindings, runCheck } from "../../harness/run-checks.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "../../harness/run-checks.js"
import { closeSeatsOfTask } from "../../harness/seats.js"
import type { SeatClosing } from "../../harness/seats.js"
import { assertSettleLockHeld, blockWork, settle, settleLockHolder, settleMessage, thisVerifier, verifyLockKey, withSettleLock, workLine } from "../../harness/settle.js"
import { LAND_CONFLICT, LAND_CONFLICT_EVENT, LandConflict, landLockKey, landTargetOf, opWorktreeOf, refreshOpInstall, removeOpWorktree } from "../../harness/land.js"
import { HOST_HELD, withHeavyBound } from "../../harness/heavy.js"
import { reapplyLocal } from "../deps/packages.js"
import type { LandTarget, OpWorktree, WorktreeRemoval } from "../../harness/land.js"
import type { Settlement, Verifier, WorkWrite } from "../../harness/settle.js"
import { clearIntent, getTask, isAdmitted, lastEvent, latestAttempt, markIntent, recordEvent, recordSettleCommit, resultOf, setStatus, setVerdict, taskCheckout, VERIFY_HOST_HELD } from "../../harness/tasks.js"
import type { AttemptRow, TaskRow, TaskStatus } from "../../harness/tasks.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { commitWithMessage, repositoryRoot, resolveSha, samePath } from "../../shared/git.js"
import { inOrder } from "../../harness/sequential.js"
import { needsInstall, splitChecks } from "../../harness/wave.js"
import { getWorkflow, setWorkflowStatus } from "../../harness/workflow.js"
import { evidenceTail, formatTable } from "../../shared/output.js"
import { redactSecrets } from "../../shared/secrets.js"
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
    readonly conflict: readonly string[] | null
    readonly worktree: WorktreeRemoval | null
    readonly seats: readonly SeatClosing[]
    readonly pruned: readonly string[]
}

/**
 * What `--recover` did: a task stuck in verifying with no live verifier is reconciled from git (its settle commit landed: done,
 * with `landed`) or put back to reported; a task holding a repair intent has its preserve reset finished (`repaired`); a done
 * task whose work never landed is failed land-orphaned, its work preserved from the checkout it lands on (`orphaned`).
 */
interface RecoverData {
    readonly mode: "recover"
    readonly task: string
    readonly status: TaskStatus
    readonly verifier: Verifier | null
    readonly landed: string | null
    readonly repaired: string | null
    readonly pruned: readonly string[]
    readonly orphaned?: string | null
}

type VerifyData = ContractVerifyData | TaskVerifyData | RecoverData

const MINUTE_MS = 60_000

/** Refuses an unfit contract; `judging` sets aside the context budget of a contract the ledger admitted already (tasks.ts isAdmitted). */
const unfit = (contract: Contract, ops: Ops, judging: ContractJudging): void => {
    const problems = contractProblems(contract, ops, judging)
    if (problems.length > 0) throw new Refusal("CONTRACT_UNFIT", `the contract is not fit to verify:\n${problems.join("\n")}`)
}

const report = (checks: readonly CheckOutcome[], verdict: "green" | "red", extra: readonly string[]): string => {
    const table = formatTable([["CHECK", "KIND", "STATUS"], ...checks.map((check) => [check.name, check.kind, check.status])])
    const reds = checks.filter((check) => check.status === "red").map((check) => `--- ${check.name}\n${check.detail}`)
    return [table, `verdict: ${verdict}`, ...extra, ...reds].join("\n")
}

/** Keeps every check of one verify as the task's evidence: its status, exit code and detail (an output tail), secrets redacted. */
const recordRuns = (db: DatabaseSync, taskId: string | null, attemptId: string | null, hash: string, checks: readonly CheckOutcome[]): void => {
    const insert = db.prepare("INSERT INTO check_runs (task_id, attempt_id, contract_hash, name, runner, status, exit_code, detail, ran_at) VALUES (?, ?, ?, ?, 'harness', ?, ?, ?, ?)")
    const at = now()
    for (const check of checks) insert.run(taskId, attemptId, hash, check.name, check.status, check.exitCode, redactSecrets(check.detail), at)
}

/**
 * What `@result` json checks read for a task: its filed result, else (before filing, in the worker's dry replay) its output file.
 * A result the harness took over from a custody-stopped run (harness/custody.ts CUSTODY_RECHECK) has its verdict keys set aside.
 */
const resultSource = (db: DatabaseSync, root: string, task: TaskRow, attempt: AttemptRow | undefined, fileFallback: boolean): ResultSource => {
    const filed = attempt === undefined ? undefined : resultOf(db, attempt.id)
    if (filed !== undefined) return { output: filed.output, from: `the result filed on ${filed.attemptId}`, ...recheckOf(db, task, filed.attemptId) }
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
 * The install of the task's Op worktree made to match its own lockfile before its checks run (harness/land.ts refreshOpInstall),
 * with the local package sources reapplied over a new install in local package mode: one `install` outcome per folder installed
 * anew, none when every install still holds.
 */
const opInstall = async (root: string, taskId: string, made: OpWorktree): Promise<CheckOutcome[]> => {
    const reinstalled = await refreshOpInstall(root, taskId, made)
    if (reinstalled.length === 0) return []
    const outcomes = reinstalled.map((one): CheckOutcome => {
        const exitCode = one.run?.exitCode ?? 0
        const tail = one.run === null ? "" : `\n${evidenceTail(one.run.stdout, one.run.stderr)}`
        return { name: "install", kind: "install", status: exitCode === 0 ? "green" : "red", exitCode, detail: `${one.folder}: ${one.note}${tail}` }
    })
    if (outcomes.some((outcome) => outcome.status === "red")) return outcomes
    const reapplied = await reapplyLocal(made.target, made.path)
    return reapplied === undefined ? outcomes : [...outcomes, { name: "deps-local", kind: "install", status: reapplied.status, exitCode: null, detail: reapplied.detail }]
}

/**
 * The dry replay of `--contract`: the checks run in the working tree as it is, and the ledger only hears of it with --record.
 * Naming the task scopes the files check to what that task may have written and lets `@result` read its output file; in the
 * task's Op worktree its install is first made to match the worktree's own lockfile (`opInstall`). A check the host held in the
 * heavy queue past the contract's budget refuses HOST_HELD: no verdict, nothing of the work judged.
 */
const verifyContract = async (cwd: string, file: string, taskId: string | undefined, record: boolean): Promise<VerbResult<VerifyData>> => {
    const ops = loadOps()
    const contract = readContract(file)
    const root = await repositoryRoot(cwd)
    unfit(contract, ops, { budget: !isAdmitted(root, contract) })
    let place: CheckPlace = { root, cwd: join(root, contract.context.cwd ?? ".") }
    let made: OpWorktree | undefined
    if (taskId !== undefined) {
        const db = openExistingLedger(root)
        if (db === undefined) throw new Refusal("TASK_UNKNOWN", `no task ${taskId}: this project has no ledger yet`)
        try {
            const task = getTask(db, taskId)
            place = { ...place, taskId, since: task.createdAt, result: resultSource(db, root, task, latestAttempt(db, taskId), true) }
            made = opWorktreeOf(db, taskId)
        } finally {
            db.close()
        }
        // In its Op worktree a task's scoped checks and changed-file coverage diff from its fork, so they judge this attempt alone.
        const fork = await opForkOf(root, taskId)
        if (fork !== undefined) place = { ...place, diffBase: fork }
    }
    const own = made !== undefined && taskId !== undefined && samePath(made.path, root) ? { task: taskId, made } : undefined
    const checks = await heldFor(root, taskId, () =>
        withHeavyBound(contract.budget.minutes * MINUTE_MS, taskId, async () => {
            const installed = own === undefined ? [] : await opInstall(root, own.task, own.made)
            if (installed.some((check) => check.status === "red")) return installed
            return [...installed, ...(await inOrder(resolveChecks(contract, ops), (check) => runCheck(check, contract, place)))]
        }),
    )
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

/**
 * Runs a verify of `taskId` that settles nothing (a `--contract` replay naming the task, or `--no-commit`): one the host held
 * (HOST_HELD) records `verify-host-held` on the task's newest attempt before it refuses, so a question its worker files after it
 * is harness-held (harness/routes.ts). Without a task, or in a repository with no ledger, it only runs.
 */
const heldFor = async <T>(root: string, taskId: string | undefined, run: () => Promise<T>): Promise<T> => {
    try {
        return await run()
    } catch (error: unknown) {
        const db = taskId === undefined || asRefusal(error).code !== HOST_HELD ? undefined : openExistingLedger(root)
        if (db !== undefined && taskId !== undefined) {
            try {
                recordEvent(db, VERIFY_HOST_HELD, taskId, { attempt: latestAttempt(db, taskId)?.id ?? null, settle: false, error: asRefusal(error).message })
            } finally {
                db.close()
            }
        }
        throw error
    }
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
        throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is verifying already; once no verifier holds its verifier lock the next workflow step or supervisor tick recovers it (by hand: starci task verify ${task.id} --recover)`)
    }
    if (task.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${task.id} is ${task.status}; only a reported task is verified and settled`)
    const result = resultOf(db, attempt.id)
    // A failed or blocked report custody stopped is the harness's to judge by its own run (core/task/result.ts).
    if (result?.status !== "done" && !isCustodyRecheck(db, task.id, attempt.id)) {
        throw new Refusal("RESULT_NOT_DONE", `attempt ${attempt.id} reported ${result?.status ?? "nothing"}; only a done result is verified, a ${result?.status ?? "missing"} result goes back to the sender`)
    }
    return attempt
}

/**
 * The events of a verify that reached no verdict and count toward settleNoVerdictMax. An infrastructure failure (verify-infra: an
 * install or setup out of time or an install no change explains, VERIFY_INFRA; verify-deadline: a lock given up at its deadline) is the harness's, not the task's:
 * it returns the task to reported like the others but never counts toward awaiting_owner.
 */
const NO_VERDICT_KINDS = ["verify-error", "preserve-failed", "settle-refused"] as const

/**
 * A verify that reached no verdict (it broke, or HEAD moved under the settle) puts the task back to reported; no try is spent.
 * Once the attempt's result has reached no verdict `settleNoVerdictMax` times (ops/liveness.yaml), the failure is persistent
 * (a path git cannot write, a broken checkout): the task ends awaiting_owner with the last reason and its work left in its
 * checkout, instead of returning to reported for a step to retry forever.
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
    })
    return new Refusal(
        refusal.code,
        `${refusal.message}\ntask ${taskId} reached no verdict ${String(ends)} times in a row: it is awaiting_owner, its work left in the work tree; fix the cause and send a retry (starci task send <contract> --retry-of ${taskId})`,
    )
}

/**
 * A settling verify the host held (HOST_HELD: a heavy command of it waited in the queue past the verify's timeout) judged nothing:
 * its task goes back to reported with no try spent and no count toward settleNoVerdictMax, recorded `verify-host-held`, and the
 * next workflow step or supervisor tick verifies it again.
 */
const hostHeld = (db: DatabaseSync, taskId: string, error: unknown): Refusal => {
    const refusal = asRefusal(error)
    inTransaction(db, () => {
        recordEvent(db, VERIFY_HOST_HELD, taskId, { attempt: latestAttempt(db, taskId)?.id ?? null, settle: true, error: refusal.message })
        setStatus(db, taskId, "reported", "verifying")
    })
    return new Refusal(HOST_HELD, `${refusal.message}\ntask ${taskId} is reported again (host-held: no verdict, no try spent); it is verified again on the next step`, refusal.exitCode)
}

/**
 * A settling verify whose lock gave up at its deadline (VERIFY_DEADLINE, harness/settle.ts) reached no verdict: its task goes
 * back to reported, unless another verifier or --recover moved it first.
 */
const deadlined = async <T>(db: DatabaseSync, taskId: string, attemptId: string, run: () => Promise<T>): Promise<T> => {
    try {
        return await run()
    } catch (error: unknown) {
        if (asRefusal(error).code === "VERIFY_DEADLINE" && getTask(db, taskId).status === "verifying") throw noVerdict(db, taskId, attemptId, "verify-deadline", error)
        throw error
    }
}

/** How a settling verify ended the task: what it settled or preserved, the files that did not rebase, and which seats it closed. */
interface Ending {
    readonly status: TaskStatus
    readonly settlement: Settlement | null
    readonly work: WorkWrite | null
    readonly preserved: Preserved | null
    readonly conflict: readonly string[] | null
    readonly seats: readonly SeatClosing[]
    readonly seatProblem?: string
    readonly repair?: string
    /** Work found under the task's allowPaths in the checkout it lands on, preserved there and put back (`preserveEscaped`). */
    readonly escaped?: Preserved
}

/** What the settle cleared in the checkout it lands on before its fast-forward (harness/preserve.ts clearStale). */
const staleLine = (stale: StaleCleared | null): string[] => {
    if (stale === null) return []
    const dropped = stale.dropped.length === 0 ? [] : [`${stale.dropped.join(", ")} dropped (git holds their content)`]
    const kept = stale.preserved.dir === null ? [] : [`${[...stale.preserved.tracked, ...stale.preserved.untracked].join(", ") || "the index"} preserved in ${stale.preserved.dir}`]
    return [`stale: the checkout it lands on held dirty paths the fast-forward writes or its allowPaths hold; ${[...dropped, ...kept].join("; ")} (land-stale)`]
}

const seatLine = (ending: Ending): string[] => [
    ...(ending.escaped?.dir == null ? [] : [`escaped: ${[...ending.escaped.tracked, ...ending.escaped.untracked].join(", ")} sat under allowPaths in the checkout it lands on; preserved in ${ending.escaped.dir} as this task's work, and put back`]),
    ...staleLine(ending.settlement?.stale ?? null),
    ...(ending.seats.length === 0 ? [] : ["seats: " + ending.seats.map((seat) => seat.seat + " " + seat.outcome).join(", ")]),
    ...(ending.seatProblem === undefined ? [] : [`warning: the task's seats were not closed (${ending.seatProblem}); close them with starci seat stop <seat>`]),
    ...(ending.repair === undefined ? [] : [`warning: the red work is saved in ${ending.repair} but not every path was put back; starci task verify <task> --recover finishes the reset`]),
]

/** How the verdict landed: settled with a commit, settled with nothing to commit, left unsettled, or checked only. */
const landedNote = (settlement: Settlement | null, commit: boolean, preserved: Preserved | null, conflict: readonly string[] | null): string => {
    if (conflict !== null) return `conflict: ${conflict.join(", ") || "the work"} does not rebase onto the branch's head; its work is preserved in ${preserved?.dir ?? "nothing (it was clean)"} until its Kernel settles it (repair keeps it for the amend on the new head, discard drops it)`
    if (settlement !== null) return settlement.committed ? `settled: ${settlement.branch} -> ${settlement.commit.slice(0, 12)}` : "settled: the task changed nothing, no commit"
    if (!commit) return "checked only (--no-commit): nothing settled"
    const work = preserved?.dir == null ? "nothing of the task was dirty" : `its work was preserved in ${preserved.dir} and its paths reset`
    return `not settled: ${work}`
}

const reply = (taskId: string, attempt: AttemptRow, task: TaskRow, built: CleanVerify | null, ending: Ending, commit: boolean, pruned: readonly string[], worktree: WorktreeRemoval | null): VerbResult<VerifyData> => {
    const { status, settlement, preserved, conflict, seats } = ending
    const checks = built?.checks ?? []
    const verdict = built?.verdict ?? "red"
    const data: TaskVerifyData = {
        mode: "task",
        task: taskId,
        attempt: attempt.id,
        hash: task.contractHash,
        base: built?.base ?? "",
        candidate: built?.candidate ?? "",
        tree: built?.tree ?? "",
        changed: built?.changed ?? [],
        notes: built?.notes ?? [],
        verdict,
        checks,
        settlement,
        work: ending.work,
        status,
        preserved,
        conflict,
        worktree,
        seats,
        pruned,
    }
    const landed = landedNote(settlement, commit, preserved, conflict)
    const extra = [
        `task ${taskId}: ${status}; ${landed}`,
        ...(worktree === null ? [] : [`worktree: ${worktree.path} ${worktree.removed ? "removed" : "left"}; ${worktree.detail}`]),
        ...(ending.work === null ? [] : [workLine(ending.work)]),
        ...seatLine(ending),
        ...(settlement?.warnings ?? []).map((warning) => `warning: ${warning}`),
        ...(built?.notes ?? []).map((note) => `note: ${note}`),
        ...(pruned.length === 0 ? [] : [`pruned ${String(pruned.length)} leftover verify checkout(s)`]),
    ]
    return { data, message: report(checks, verdict, extra), exitCode: verdict === "green" ? 0 : 1 }
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
        throw new Refusal("VERIFY_WORKER_LIVE", `task ${taskId}: the worker of seat ${live.map((seat) => seat.seat + " (" + seat.outcome + ")").join(", ")} may still write; nothing was verified, stop it and verify again`)
    }
    return seats
}

/** The red ending: the verdict and the failed status land in one transaction; a reset that broke keeps a repair intent. */
const failTask = (db: DatabaseSync, taskId: string, attemptId: string, repair: string | null): void => {
    inTransaction(db, () => {
        setVerdict(db, attemptId, "red")
        setStatus(db, taskId, "failed", "verifying")
        if (repair !== null) markIntent(db, taskId, "repair", repair)
    })
}

/**
 * The green ending: verdict, settle record, the commit (recordSettleCommit) and done in one transaction; the heavy checks the
 * task left to its workflow's wave are recorded as due (`wave-due`, read by harness/wave.ts waveDue).
 */
const finishTask = (db: DatabaseSync, taskId: string, attemptId: string, settlement: { readonly commit: string; readonly committed: boolean }, event: string, data: unknown, deferred: readonly string[]): void => {
    inTransaction(db, () => {
        setVerdict(db, attemptId, "green")
        recordEvent(db, event, taskId, data)
        if (deferred.length > 0) recordEvent(db, "wave-due", taskId, { checks: deferred })
        recordSettleCommit(db, taskId, settlement.committed ? settlement.commit : null)
        setStatus(db, taskId, "done", "verifying")
    })
}

/**
 * The conflict ending: the task's work did not rebase onto the head it lands on. No check ran, so no verdict is set; the
 * attempt ends `conflict`, the task fails, and its work, preserved first, is the prior work the amend's retry starts from on
 * the new head. Nothing resolves the conflict here.
 */
const conflictTask = (db: DatabaseSync, taskId: string, attemptId: string, conflict: LandConflict, preserved: Preserved): void => {
    inTransaction(db, () => {
        db.prepare("UPDATE attempts SET outcome = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(LAND_CONFLICT, now(), attemptId)
        recordEvent(db, LAND_CONFLICT_EVENT, taskId, { files: conflict.files, onto: conflict.onto, preserved: preserved.dir })
        setStatus(db, taskId, "failed", "verifying")
    })
}

/** Saves and resets a task's dirty allowPaths for a red or conflict ending; a reset that broke comes back as `repair`. */
const preserveEnding = async (db: DatabaseSync, root: string, task: TaskRow, attemptId: string): Promise<{ readonly preserved: Preserved; readonly repair: string | null }> => {
    try {
        return { preserved: await preserveTaskPaths(root, task, db), repair: null }
    } catch (error: unknown) {
        if (!(error instanceof PreserveIncomplete)) throw noVerdict(db, task.id, attemptId, "preserve-failed", error)
        return { preserved: { dir: error.dir, patch: null, tracked: [], untracked: [] }, repair: error.dir }
    }
}

/** The event a verify records when it found and preserved the task's work in the checkout it lands on. */
const LAND_ESCAPED = "land-escaped"

/**
 * Work the task wrote outside its own checkout, into the checkout it lands on (an Op worktree's target): every file dirty there
 * under the task's allowPaths is saved as the task's work (a `task-preserved` event, the prior work a retry starts from) and put
 * back, recorded `land-escaped`, so the target holds no task's work and its retry starts from it. A red or a conflict ending runs
 * it before the task returns, under the target's land lock; a green one lands instead, and its settle clears the target
 * (harness/preserve.ts clearStale). Null when the task works in its target or nothing escaped.
 */
const preserveEscaped = async (db: DatabaseSync, task: TaskRow, target: LandTarget): Promise<Preserved | null> => {
    if (target.own) return null
    const saved = await preserveTaskPaths(target.checkout, task, db)
    if (saved.dir === null) return null
    recordEvent(db, LAND_ESCAPED, task.id, { target: target.checkout, branch: target.branch, dir: saved.dir, tracked: saved.tracked, untracked: saved.untracked })
    return saved
}

/** The ending's escaped work, when there was some. */
const escapedOf = (escaped: Preserved | null): Pick<Ending, "escaped"> => (escaped === null ? {} : { escaped })

/** preserveEscaped on a red or conflict ending, under the land lock; a preserve that breaks reaches no verdict. */
const returnEscaped = async (db: DatabaseSync, task: TaskRow, attemptId: string, target: LandTarget, underLand: <T>(work: () => Promise<T>) => Promise<T>): Promise<Preserved | null> => {
    try {
        return await underLand(() => preserveEscaped(db, task, target))
    } catch (error: unknown) {
        throw noVerdict(db, task.id, attemptId, "preserve-failed", error)
    }
}

/**
 * Declares the opt-in patterns `needs` names on the branch a workflow task lands on (harness/hfs-patterns.ts); a task outside a
 * workflow, working in the checkout it lands on, gets none: the harness edits hfs.json only on a workflow's branch.
 */
const declarePatterns = async (at: Settling, why: string, needs: readonly PatternNeed[]): Promise<PatternsEnabled> => {
    const workflow = at.task.workflowId
    if (workflow === null || at.target.own || needs.length === 0) return { commit: null, added: [], refused: null }
    return enablePatterns({ db: at.db, checkout: at.target.checkout, branch: at.target.branch, workflow, task: at.task.id, why }, needs)
}

/** The files a task's filed result names, for the patterns its verify declares first. */
const resultFiles = (output: unknown): string[] => {
    const files = typeof output === "object" && output !== null ? (output as { readonly files?: unknown }).files : undefined
    return Array.isArray(files) ? files.filter((file): file is string => typeof file === "string") : []
}

/** What one pass of a settling verify reached: an ending, or `moved` when the head moved before its verified commit could land. */
type Pass = { readonly built: CleanVerify | null; readonly ending: Ending } | "moved"

interface Settling {
    readonly db: DatabaseSync
    readonly root: string
    readonly task: TaskRow
    readonly attempt: AttemptRow
    readonly input: CleanVerifyInput
    readonly target: LandTarget
    readonly me: Verifier
    readonly unsettled: Ending
    /** The checks this task left to its workflow's wave (recorded `wave-due` when it lands). */
    readonly deferred: readonly string[]
}

/**
 * One pass of a settling verify. The candidate is built in the task's checkout and, for an Op worktree, rebased onto the head
 * of the branch it lands on, then checked on a clean checkout. A conflict preserves the work and returns the task `conflict`;
 * red preserves and fails it. Green lands under the target's land lock (`locked`: the caller holds it already): a head that
 * moved since the rebase makes an unlocked pass return `moved`, so the caller verifies again under the lock.
 */
const settlePass = async (at: Settling, locked: boolean): Promise<Pass> => {
    const { db, root, task, attempt, input, target, me, unsettled, deferred } = at
    const underLand = <T>(work: () => Promise<T>): Promise<T> => (locked ? work() : withSettleLock(db, me, input.timeoutMs ?? MINUTE_MS, landLockKey(target), work))
    const made = opWorktreeOf(db, task.id)
    const onto = target.own ? undefined : await resolveSha(target.checkout, `refs/heads/${target.branch}`)
    let built: CleanVerify
    try {
        built = await cleanVerify({ ...input, ...(onto === undefined ? {} : { onto }), ...(made === undefined ? {} : { fork: made.fork }) })
    } catch (error: unknown) {
        assertSettleLockHeld(db, me, verifyLockKey(task.id))
        if (CUSTODY_CODES.has(asRefusal(error).code)) throw blockOnCustody(db, task.id, "verifying", asRefusal(error))
        if (asRefusal(error).code === HOST_HELD) throw hostHeld(db, task.id, error)
        if (!(error instanceof LandConflict)) throw noVerdict(db, task.id, attempt.id, asRefusal(error).code === VERIFY_INFRA ? "verify-infra" : "verify-error", error)
        const { preserved } = await preserveEnding(db, root, task, attempt.id)
        const escaped = await returnEscaped(db, task, attempt.id, target, underLand)
        conflictTask(db, task.id, attempt.id, error, preserved)
        return { built: null, ending: { ...unsettled, status: "failed", preserved, conflict: error.files, ...escapedOf(escaped) } }
    }
    // A verify that outlived its deadline lost its lock: it records, preserves and lands nothing (the catch above holds the same fence).
    assertSettleLockHeld(db, me, verifyLockKey(task.id))
    recordRuns(db, task.id, attempt.id, task.contractHash, built.checks)
    recordBaselineFindings(db, task.id, built.checks)
    recordEvent(db, "task-verified", task.id, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, foreign: built.foreign, settle: true, onto: onto ?? null })
    // A red that names an opt-in slot of an undeclared pattern is the harness's to remedy: it declares the pattern on the branch and
    // the caller verifies again on the new head, under the land lock, so the task spends no try on it.
    if (built.verdict === "red" && !locked) {
        const reds = built.checks.filter((check) => check.status === "red").map((check) => check.detail)
        if ((await declarePatterns(at, "verify-red", await patternsOfFindings(reds))).commit !== null) return "moved"
    }
    if (built.verdict === "red") {
        const { preserved, repair } = await preserveEnding(db, root, task, attempt.id)
        const escaped = await returnEscaped(db, task, attempt.id, target, underLand)
        failTask(db, task.id, attempt.id, repair)
        // A uat task's record turns blocked in a Work commit of its own on the target branch, under its land lock.
        const work = await underLand(() => blockWork(target.checkout, task, input.result, built.checks.filter((check) => check.status === "red").map((check) => check.name)))
        if (work !== null) recordEvent(db, "work-written", task.id, work)
        return { built, ending: { ...unsettled, status: "failed", work, preserved, ...(repair === null ? {} : { repair }), ...escapedOf(escaped) } }
    }
    let settlement: Settlement
    try {
        // What sits dirty in the target on its paths would block the fast-forward: settle clears it first, under the land lock.
        settlement = await underLand(() => settle(target, built, task, db))
    } catch (error: unknown) {
        if (!locked && asRefusal(error).code === "HEAD_MOVED") return "moved"
        throw noVerdict(db, task.id, attempt.id, "settle-refused", error)
    }
    // The branch moved: from here the task is done whatever else happens (a crash here is reconciled by --recover from git).
    finishTask(db, task.id, attempt.id, settlement, "task-settled", settlement, deferred)
    return { built, ending: { ...unsettled, status: "done", settlement, work: settlement.work } }
}

/**
 * The ledger task path: clean verify, record, verdict, then land on green or fail on red; --no-commit only checks. A settling
 * verify holds the task's verifier lock throughout; the target's land lock is held only while a verified commit lands, so verifies
 * of one workflow run side by side and land one after another. The first pass verifies without the land lock; when another task
 * landed meanwhile, the second pass verifies again on the new head under the land lock, so what is verified is what lands. Once
 * the task ended, its seats are closed and its Op worktree is removed. Its heavy commands wait in the queue at most the contract's
 * budget (harness/heavy.ts withHeavyBound); one held past it ends the verify host-held (`hostHeld`), never red.
 */
const verifyTask = async (cwd: string, taskId: string, commit: boolean): Promise<VerbResult<VerifyData>> => {
    const callerRoot = await repositoryRoot(cwd)
    const ops = loadOps()
    const db = openLedger(callerRoot)
    try {
        const task = getTask(db, taskId)
        const judge = (): Promise<VerbResult<VerifyData>> => withHeavyBound(task.contract.budget.minutes * MINUTE_MS, task.id, () => judgeTask(db, callerRoot, ops, task, commit))
        // A settling verify the host held records it itself (`hostHeld`), returning its task to reported.
        return await (commit ? judge() : heldFor(callerRoot, task.id, judge))
    } finally {
        db.close()
    }
}

/** verifyTask's judgement of `task` under its heavy bound, on the caller's ledger `db`. */
const judgeTask = async (db: DatabaseSync, callerRoot: string, ops: Ops, task: TaskRow, commit: boolean): Promise<VerbResult<VerifyData>> => {
    const taskId = task.id
    const attempt = verifiable(db, task, commit)
    // The task's work lives in its own checkout, which may not be the caller's: it is judged there and lands on its target.
    const root = await taskCheckout(task, callerRoot)
    const pruned = await pruneVerifyWorktrees(root)
    // The task's contract was admitted when it was queued, so the context that grew under it since is no refusal.
    unfit(task.contract, ops, { budget: false })
    const target = await landTargetOf(db, task, root)
    const made = opWorktreeOf(db, taskId)
    // The wave tier leaves a workflow task's heavy checks (typecheck, lint, tests) to its workflow's wave verify (harness/wave.ts).
    const split = splitChecks(root, task, resolveChecks(task.contract, ops))
    const deferred = split.wave.map((check) => check.name)
    const input: CleanVerifyInput = {
        root,
        contract: task.contract,
        checks: split.own,
        install: needsInstall(split.own),
        name: taskId,
        message: settleMessage(task.contract, taskId),
        taskId,
        since: task.createdAt,
        result: resultSource(db, root, task, attempt, false),
        timeoutMs: task.contract.budget.minutes * MINUTE_MS,
        ...(target.own ? {} : { target: target.checkout }),
    }
    const unsettled: Ending = { status: task.status, settlement: null, work: null, preserved: null, conflict: null, seats: [] }
    const noted = (built: CleanVerify | null): CleanVerify | null => (built === null || deferred.length === 0 ? built : { ...built, notes: [...built.notes, `left to the workflow's wave verify: ${deferred.join(", ")}`] })
    if (!commit) {
        const onto = target.own ? undefined : await resolveSha(target.checkout, `refs/heads/${target.branch}`)
        const built = await cleanVerify({ ...input, ...(onto === undefined ? {} : { onto }), ...(made === undefined ? {} : { fork: made.fork }) })
        recordRuns(db, taskId, attempt.id, task.contractHash, built.checks)
        recordEvent(db, "task-verified", taskId, { attempt: attempt.id, verdict: built.verdict, candidate: built.candidate, base: built.base, foreign: built.foreign, settle: false })
        return reply(taskId, attempt, task, noted(built), { ...unsettled, status: getTask(db, taskId).status }, false, pruned, null)
    }
    const frozen = await freezeWorker(root, taskId)
    const me = thisVerifier(taskId)
    const settled = await deadlined(db, taskId, attempt.id, () => withSettleLock(db, me, MINUTE_MS, verifyLockKey(taskId), async (): Promise<Exclude<Pass, "moved">> => {
        const fresh = getTask(db, taskId)
        if (fresh.status !== "reported") throw new Refusal("TASK_NOT_VERIFIABLE", `task ${taskId} is ${fresh.status} now; another verify took it while this one waited`)
        // The claim, by compare-and-swap, before any git side effect; the parent lets --recover find a landing.
        setStatus(db, taskId, "verifying", "reported")
        recordEvent(db, "verify-started", taskId, { ...me, parent: await resolveSha(target.checkout, `refs/heads/${target.branch}`), checkout: root, target: target.checkout, branch: target.branch })
        const at: Settling = { db, root, task: fresh, attempt, input, target, me, unsettled, deferred }
        const paths = [...fresh.contract.context.allowPaths, ...resultFiles(resultOf(db, attempt.id)?.output)]
        await declarePatterns(at, "verify", await patternsOfPaths(target.checkout, paths))
        const first = await settlePass(at, false)
        if (first !== "moved") return first
        recordEvent(db, "verify-head-moved", taskId, { branch: target.branch })
        const second = await withSettleLock(db, me, input.timeoutMs ?? MINUTE_MS, landLockKey(target), () => settlePass(at, true))
        if (second === "moved") throw noVerdict(db, taskId, attempt.id, "settle-refused", new Refusal("HEAD_MOVED", `${target.branch} moved under its land lock`))
        return second
    }))
    // The task ended; its worker has nothing left to do. Closing talks to Orca, so it runs outside every lock and transaction.
    const closing = await closeSeatsOfTask(root, taskId).then(
        (seats): Pick<Ending, "seats" | "seatProblem"> => ({ seats }),
        (error: unknown): Pick<Ending, "seats" | "seatProblem"> => ({ seats: [], seatProblem: asRefusal(error).message }),
    )
    const seats = closing.seats.length > 0 ? closing.seats : frozen
    const worktree = getTask(db, taskId).intent === null ? ((await removeOpWorktree(callerRoot, taskId).catch(() => undefined)) ?? null) : null
    return reply(taskId, attempt, task, noted(settled.built), { ...settled.ending, ...closing, seats }, true, pruned, worktree)
}

/** `--recover` of a repair intent: finishes the reset from the preserve's manifest, then drops the intent. */
const repairTask = async (db: DatabaseSync, root: string, task: TaskRow): Promise<VerbResult<VerifyData>> => {
    const dir = task.intentData?.dir ?? null
    if (dir === null) throw new Refusal("TASK_REPAIR_UNKNOWN", `task ${task.id} holds a repair intent that names no preserve folder; inspect its task-preserved events`)
    await resetPreserved(root, dir)
    inTransaction(db, () => {
        clearIntent(db, task.id)
        recordEvent(db, "preserve-repaired", task.id, { dir })
    })
    const data: RecoverData = { mode: "recover", task: task.id, status: task.status, verifier: null, landed: null, repaired: dir, pruned: [] }
    return { data, message: `task ${task.id}: the reset of ${dir} is finished; task is ${task.status}` }
}

/** The `verify-started` facts: the verifier and the HEAD it started from (absent on an event older than version 7). */
const startedFrom = (value: unknown): { readonly verifier: Verifier | null; readonly parent: string | undefined } => {
    if (typeof value !== "object" || value === null) return { verifier: null, parent: undefined }
    const record = value as Record<string, unknown>
    const verifier = typeof record.task === "string" && typeof record.pid === "number" && typeof record.host === "string" && typeof record.at === "string" ? { task: record.task, pid: record.pid, host: record.host, at: record.at } : null
    return { verifier, parent: typeof record.parent === "string" ? record.parent : undefined }
}


/**
 * `--recover` of a done task whose work never landed: it settled no commit while its result names files under its allowPaths
 * (a verify before the `lands` check knew that case). Its work sits where the worker wrote it, in the checkout it lands on: it is
 * preserved there as the task's work and put back under the land lock, and the task is failed `land-orphaned`, a harness cause,
 * so it returns to ready at the same try and its retry starts from that work. Refused for any other done task.
 */
const recoverOrphan = async (db: DatabaseSync, callerRoot: string, task: TaskRow): Promise<VerbResult<VerifyData>> => {
    const attempt = latestAttempt(db, task.id)
    const declared = attempt === undefined ? [] : declaredFiles(resultOf(db, attempt.id)?.output, task.contract.context.allowPaths)
    if (task.settleCommit !== null || declared.length === 0 || attempt === undefined) {
        throw new Refusal("TASK_NOT_VERIFYING", `task ${task.id} is done${task.settleCommit === null ? " with nothing its result names" : ` at ${task.settleCommit.slice(0, 12)}`}; --recover frees a task stuck in verifying, finishes a preserve reset, or returns a done task whose named files never landed`)
    }
    const made = opWorktreeOf(db, task.id)
    const target: LandTarget = made === undefined ? await landTargetOf(db, task, callerRoot) : { checkout: made.target, branch: made.targetBranch, own: false }
    const landed = await commitWithMessage(target.checkout, `refs/heads/${target.branch}`, settleMessage(task.contract, task.id), startedFrom(lastEvent(db, "verify-started", task.id)).parent)
    if (landed !== undefined) throw new Refusal("TASK_LANDED", `task ${task.id}'s settle commit ${landed.slice(0, 12)} is on ${target.branch}; nothing to return`)
    const me = thisVerifier(task.id)
    const preserved = await withSettleLock(db, me, MINUTE_MS, landLockKey(target), () => preserveTaskPaths(target.checkout, task, db))
    inTransaction(db, () => {
        recordEvent(db, LAND_ORPHANED, task.id, { target: target.checkout, branch: target.branch, declared, dir: preserved.dir, tracked: preserved.tracked, untracked: preserved.untracked })
        setStatus(db, task.id, "failed", "done")
        // A workflow that ended on that task did not end: its work is back to do.
        if (task.workflowId !== null && getWorkflow(db, task.workflowId).status === "done") setWorkflowStatus(db, task.workflowId, "running", null)
    })
    const where = preserved.dir === null ? `nothing of it was found in ${target.checkout}` : `${[...preserved.tracked, ...preserved.untracked].join(", ")} preserved from ${target.checkout} in ${preserved.dir}`
    const data: RecoverData = { mode: "recover", task: task.id, status: "failed", verifier: null, landed: null, repaired: null, pruned: [], orphaned: preserved.dir }
    return { data, message: `task ${task.id}: done -> failed (land-orphaned: its result names ${declared.join(", ")} but nothing landed on ${target.branch}); ${where}; it returns to ready at the same try and its retry starts from that work` }
}

/**
 * `--recover`: git is the authority for landed. A task left in verifying whose verifier no longer holds its verifier lock is
 * done when the branch it lands on carries the task's settle commit (message and `Starci-Task:` trailer) after the head the
 * verify started from, and goes back to reported otherwise; either way that verifier's checkout is pruned. A task holding a repair intent has
 * its preserve reset finished; a done task whose work never landed is returned (`recoverOrphan`).
 */
const recoverTask = async (cwd: string, taskId: string): Promise<VerbResult<VerifyData>> => {
    const callerRoot = await repositoryRoot(cwd)
    const db = openLedger(callerRoot)
    try {
        const task = getTask(db, taskId)
        if (task.status === "done" && task.intent === null) return await recoverOrphan(db, callerRoot, task)
        const root = await taskCheckout(task, callerRoot)
        if (task.intent === "repair") return await repairTask(db, root, task)
        if (task.status !== "verifying") throw new Refusal("TASK_NOT_VERIFYING", `task ${taskId} is ${task.status}; --recover only frees a task stuck in verifying or finishes a preserve reset`)
        const holder = settleLockHolder(db, verifyLockKey(taskId))
        const { verifier, parent } = startedFrom(lastEvent(db, "verify-started", taskId))
        const target = await landTargetOf(db, task, root)
        if (holder !== undefined) {
            throw new Refusal("VERIFY_LIVE", `task ${taskId} is being verified by pid ${String(holder.pid)} on ${holder.host} since ${holder.at}; wait for it, or stop that process first`)
        }
        const landed = (await commitWithMessage(target.checkout, `refs/heads/${target.branch}`, settleMessage(task.contract, taskId), parent)) ?? null
        const pruned = await pruneVerifyWorktrees(root)
        const attempt = latestAttempt(db, taskId)
        if (landed !== null && attempt !== undefined) {
            const deferred = splitChecks(root, task, resolveChecks(task.contract, loadOps())).wave.map((check) => check.name)
            finishTask(db, taskId, attempt.id, { commit: landed, committed: true }, "verify-reconciled", { verifier, commit: landed }, deferred)
            const data: RecoverData = { mode: "recover", task: taskId, status: "done", verifier, landed, repaired: null, pruned }
            return { data, message: `task ${taskId}: verifying -> done (its settle commit ${landed.slice(0, 12)} is on ${target.branch}; the verifier died after landing it)` }
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
        recover: { kind: "boolean", summary: "reconcile a task stuck in verifying (its verifier died) from git: done when its settle commit landed, else reported; finish a broken preserve reset; or return a done task whose named files never landed (land-orphaned, its work preserved)" },
    },
    run: async (context, flags): Promise<VerbResult<VerifyData>> => {
        if (flags.contract !== undefined) return verifyContract(context.cwd, resolve(context.cwd, flags.contract), flags.task, flags.record)
        if (flags.task === undefined) throw new Refusal("TASK_NOT_NAMED", "name the task: starci task verify <task-id>, or dry-replay a contract: starci task verify --contract <file>")
        if (flags.recover) return recoverTask(context.cwd, flags.task)
        return verifyTask(context.cwd, flags.task, !flags["no-commit"])
    },
})
