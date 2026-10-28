import type { DatabaseSync } from "node:sqlite"
import { hostname } from "node:os"
import { join } from "node:path"
import { pidAlive } from "../shared/exec.js"
import { git, nulPaths, resolveSha } from "../shared/git.js"
import { asRefusal, Refusal } from "../shared/errors.js"
import { redactSecrets } from "../shared/secrets.js"
import { assertNoInfraFailure, inCleanCheckout, prepareCheckout } from "./clean-verify.js"
import { resolveChecks } from "./contract.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { opWorktreeOf } from "./land.js"
import { inTransaction, now } from "./ledger.js"
import { readMachine } from "./machine.js"
import { loadOps } from "./ops.js"
import { loadPolicy } from "./policy.js"
import { runCheck } from "./run-checks.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "./run-checks.js"
import { inOrder } from "./sequential.js"
import { settleLockHolder, thisVerifier, withSettleLock } from "./settle.js"
import type { Verifier } from "./settle.js"
import { getTask, latestAttempt, recordEvent, resultOf, setStatus, setVerdict, taskCheckout } from "./tasks.js"
import type { TaskRow } from "./tasks.js"
import { waveDue } from "./workflow.js"

/** The `starci check` verbs a scoped check runs: typecheck and lint over the scope of a diff. */
const SCOPED_VERBS: ReadonlySet<string> = new Set(["run", "lint", "typecheck"])

/**
 * A heavy check: one that runs typecheck, lint or tests (a scoped `starci check` verb, or any command check). In the wave tier a
 * workflow task's heavy checks run in the workflow's wave verify, never in its own.
 */
export const isWaveCheck = (check: ResolvedCheck): boolean =>
    check.check.kind === "command" || (check.check.kind === "starci" && check.check.args[0] === "check" && SCOPED_VERBS.has(check.check.args[1] ?? ""))

/** Whether any of these checks runs a tool the checkout's install provides (a command, or a starci verb run on the checkout). */
export const needsInstall = (checks: readonly ResolvedCheck[]): boolean => checks.some((check) => check.check.kind === "command" || check.check.kind === "starci")

/** Whether a task is a Supervisor's `[Worker]` (machine.sqlite supervisor_workers): its branch is landed by Debug, whose round is its wave. */
const isSupervisorWorker = (taskId: string): boolean => readMachine((db) => db.prepare("SELECT 1 FROM supervisor_workers WHERE task_id = ?").get(taskId) !== undefined, false)

/**
 * Splits a task's checks into those its own verify runs (tier 1, contexts/authority/branch.md) and those it leaves to a wave
 * (tier 2): in the wave tier (policy/quality.yaml `verify.tier`) a task of a workflow leaves its heavy checks to the workflow's
 * wave (`wave-due`), and a Supervisor's `[Worker]` to Debug's round after it lands the worker's branch; a task sent alone
 * (`task send`, nothing to run a wave for it), or the task tier, runs them all.
 */
export const splitChecks = (root: string, task: TaskRow, checks: readonly ResolvedCheck[]): { readonly own: readonly ResolvedCheck[]; readonly wave: readonly ResolvedCheck[] } => {
    if (loadPolicy(root).quality.verify.tier !== "wave" || (task.workflowId === null && !isSupervisorWorker(task.id))) return { own: checks, wave: [] }
    return { own: checks.filter((check) => !isWaveCheck(check)), wave: checks.filter(isWaveCheck) }
}

/** One task of a wave: its row, the heavy checks it left, the files it landed and the base its own diff starts from. */
interface WaveTask {
    readonly task: TaskRow
    readonly checks: readonly ResolvedCheck[]
    readonly files: readonly string[]
    readonly parent: string | null
}

/** What a wave verify judged: the tasks, its base and head, the outcomes per task, and the tasks it returned red. */
export interface WaveReport {
    readonly workflow: string
    readonly base: string
    readonly head: string
    readonly changed: readonly string[]
    readonly commands: readonly string[]
    readonly tasks: readonly string[]
    readonly prepared: readonly CheckOutcome[]
    readonly outcomes: Readonly<Record<string, readonly CheckOutcome[]>>
    readonly returned: readonly string[]
    readonly verdict: "green" | "red"
}

const sourceOf = (db: DatabaseSync, task: TaskRow): ResultSource => {
    const attempt = latestAttempt(db, task.id)
    const filed = attempt === undefined ? undefined : resultOf(db, attempt.id)
    return filed === undefined ? { missing: `task ${task.id} has no filed result` } : { output: filed.output, from: `the result filed on ${filed.attemptId}` }
}

const toSlash = (path: string): string => path.replaceAll("\\", "/")

/** The tail of a repository path a tool prints it by (tsc relative to its tsconfig, eslint absolute): its last two segments. */
const printedAs = (file: string): string => file.split("/").slice(-2).join("/")

/**
 * The tasks a red check of the wave belongs to: those whose landed files the check's output names, else, when it names none of
 * them, every task of the wave that left that check (a red repository gate, a build that names no task's file).
 */
const owners = (outcome: CheckOutcome, tasks: readonly WaveTask[]): WaveTask[] => {
    const detail = toSlash(outcome.detail)
    const named = tasks.filter((each) => each.files.some((file) => detail.includes(printedAs(file))))
    return named.length > 0 ? named : [...tasks]
}

/**
 * The key a check is run once by across the wave: a scoped check once for every task that landed a commit (over their union),
 * and per task for one that landed nothing (it proves the tracked files under its own allowPaths); a command once per cwd and
 * argv unless it reads the task.
 */
const runKey = (check: ResolvedCheck, task: TaskRow): string => {
    const primitive = check.check
    if (primitive.kind !== "command") return JSON.stringify({ primitive, own: task.settleCommit === null ? task.id : "" })
    const own = primitive.verdict !== undefined || primitive.coverage !== undefined ? task.id : ""
    return JSON.stringify({ cwd: task.contract.context.cwd ?? ".", run: primitive.run, own })
}

/**
 * Builds the wave's tasks from the ledger: each due task's heavy checks, the files its settle commit landed (its allowPaths when it
 * landed nothing) and that commit's parent.
 */
const waveTasks = async (db: DatabaseSync, checkout: string, ids: readonly string[]): Promise<WaveTask[]> => {
    const ops = loadOps()
    return inOrder(ids, async (id) => {
        const task = getTask(db, id)
        const checks = resolveChecks(task.contract, ops).filter(isWaveCheck)
        if (task.settleCommit === null) return { task, checks, files: task.contract.context.allowPaths, parent: null }
        const parent = await resolveSha(checkout, `${task.settleCommit}^`)
        const files = nulPaths(await git(checkout, ["diff", "--name-only", "-z", parent, task.settleCommit]))
        return { task, checks, files, parent }
    })
}

/** Records one task's part of the wave: its check rows on its newest attempt, its judgement, and, red, its return to failed. */
const recordTask = (db: DatabaseSync, workflow: string, each: WaveTask, outcomes: readonly CheckOutcome[], red: boolean): void => {
    const attempt = latestAttempt(db, each.task.id)
    inTransaction(db, () => {
        const insert = db.prepare("INSERT INTO check_runs (task_id, attempt_id, contract_hash, name, runner, status, exit_code, detail, ran_at) VALUES (?, ?, ?, ?, 'harness', ?, ?, ?, ?)")
        const at = now()
        for (const outcome of outcomes) insert.run(each.task.id, attempt?.id ?? null, each.task.contractHash, outcome.name, outcome.status, outcome.exitCode, redactSecrets(outcome.detail), at)
        recordEvent(db, "wave-judged", each.task.id, { workflow, verdict: red ? "red" : "green", checks: outcomes.map((outcome) => `${outcome.name} ${outcome.status}`) })
        if (!red) return
        if (attempt !== undefined) setVerdict(db, attempt.id, "red")
        setStatus(db, each.task.id, "failed", "done")
        recordEvent(db, "wave-returned", each.task.id, { workflow, red: outcomes.filter((outcome) => outcome.status === "red").map((outcome) => outcome.name) })
    })
}

/**
 * The wave verify of a workflow: the heavy checks its due tasks left (`waveDue`) run once, on one clean checkout of the head of
 * the branch they landed on, over the union of what those tasks landed, the diff from the oldest of their settle commits'
 * parents. The install comes from the shared cache, every contract's setup runs once, a scoped check runs once for all, and a command check
 * once per cwd and argv (per task when it reads the task's result or coverage). A red check is owned by the tasks whose files its
 * output names (every task that left it, when it names none); each owning task turns failed, back to the Kernel with the red
 * check rows on its attempt, and every task of the wave is judged. Undefined when no wave is due.
 *
 * Every settling caller (`workflow step`, `kernel next`, `supervisor next`, the `supervisor tick`) may reach a due wave at once:
 * the first takes the workflow's wave lock (waveLockKey) and runs it on one checkout, removed when it ends; every other caller
 * is refused with WAVE_RUNNING and starts nothing, and reads the verdict on its next step.
 */
export const runWave = async (db: DatabaseSync, callerRoot: string, workflow: string, timeoutMs: number): Promise<WaveReport | undefined> => {
    const first = waveDue(db, workflow)[0]
    if (first === undefined) return undefined
    // The wave judges the branch the tasks landed on: an Op task's target checkout (its own worktree is gone once it landed).
    const checkout = opWorktreeOf(db, first)?.target ?? (await taskCheckout(getTask(db, first), callerRoot))
    const head = await resolveSha(checkout, "HEAD")
    const key = waveLockKey(workflow)
    const running = settleLockHolder(db, key)
    if (running !== undefined) throw waveRunning(workflow, running)
    // Set once the lock is taken: a SETTLE_BUSY before it means another caller won the lock, one after it is the wave's own.
    const taken = { held: false }
    try {
        return await withSettleLock(db, thisVerifier(`wave:${workflow}@${head.slice(0, 12)}`), 0, key, () => {
            taken.held = true
            return judgeWave(db, workflow, checkout, timeoutMs)
        })
    } catch (error: unknown) {
        // Another caller took the lock between the look above and this one: it runs the wave, this one does not.
        if (!taken.held && asRefusal(error).code === "SETTLE_BUSY") throw waveRunning(workflow, settleLockHolder(db, key))
        throw error
    }
}

/** The wave lock of a workflow (a ledger meta row, harness/settle.ts withSettleLock): one wave of it runs at a time on the host. */
export const waveLockKey = (workflow: string): string => `wave-lock:${workflow}`

/** The job row of a workflow's detached wave (a ledger meta row): who started it and when, until the job takes the wave lock. */
const waveJobKey = (workflow: string): string => `wave-job:${workflow}`

/** How long a started job may take to reach the wave lock before another caller may start one again. */
const JOB_START_MS = 120_000

/**
 * Claims the start of a workflow's detached wave job for this process, under BEGIN IMMEDIATE so concurrent callers start one job:
 * undefined when this caller claimed it (it then starts the job and records its pid with recordWaveJob), else why it must not:
 * the wave runs (its lock is held) or a job started moments ago has not reached the lock yet.
 */
export const claimWaveJob = (db: DatabaseSync, workflow: string): string | undefined => {
    const running = settleLockHolder(db, waveLockKey(workflow))
    if (running !== undefined) return waveRunning(workflow, running).message
    db.exec("BEGIN IMMEDIATE")
    try {
        const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(waveJobKey(workflow))
        const job = row === undefined ? undefined : (JSON.parse(String(row.value)) as { readonly pid: number; readonly host: string; readonly at: string })
        if (job !== undefined && Date.now() - Date.parse(job.at) < JOB_START_MS && (job.host !== hostname() || pidAlive(job.pid))) {
            db.exec("COMMIT")
            return `the wave of workflow ${workflow} was started as a job (pid ${String(job.pid)}) at ${job.at}; its verdict is read on the next step`
        }
        db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(waveJobKey(workflow), JSON.stringify({ pid: process.pid, host: hostname(), at: now() }))
        db.exec("COMMIT")
        return undefined
    } catch (error: unknown) {
        db.exec("ROLLBACK")
        throw error
    }
}

/** Records the pid of the job a claim started (or, with null, gives a failed start's claim back). */
export const recordWaveJob = (db: DatabaseSync, workflow: string, pid: number | null): void => {
    if (pid === null) {
        db.prepare("DELETE FROM meta WHERE key = ?").run(waveJobKey(workflow))
        return
    }
    db.prepare("UPDATE meta SET value = json_set(value, '$.pid', ?) WHERE key = ?").run(pid, waveJobKey(workflow))
    recordEvent(db, "wave-started", workflow, { pid })
}

/** Whether a wave of the workflow runs or a job to run it is starting: what `workflow wave --wait` waits out. */
export const waveBusy = (db: DatabaseSync, workflow: string): boolean => {
    if (settleLockHolder(db, waveLockKey(workflow)) !== undefined) return true
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(waveJobKey(workflow))
    if (row === undefined) return false
    const job = JSON.parse(String(row.value)) as { readonly pid: number; readonly host: string; readonly at: string }
    return Date.now() - Date.parse(job.at) < JOB_START_MS && (job.host !== hostname() || pidAlive(job.pid))
}

/** The refusal a caller meets when another process runs the workflow's wave: it starts none of its own and waits for that verdict. */
export const WAVE_RUNNING = "WAVE_RUNNING"

const waveRunning = (workflow: string, holder: Verifier | undefined): Refusal =>
    new Refusal(
        WAVE_RUNNING,
        holder === undefined
            ? `the wave of workflow ${workflow} is being started by another process; its verdict is read on the next step`
            : `the wave of workflow ${workflow} runs in pid ${String(holder.pid)} on ${holder.host} since ${holder.at} (${holder.task}); its verdict is read on the next step`,
    )

/**
 * The wave itself, run while this process holds the workflow's wave lock. The due tasks and the head are read again under the
 * lock: a wave another caller finished meanwhile judged its tasks (`wave-judged`), so they are no longer due and its recorded
 * verdict stands for that head; nothing is run twice.
 */
const judgeWave = async (db: DatabaseSync, workflow: string, checkout: string, timeoutMs: number): Promise<WaveReport | undefined> => {
    // The lock now stands for the wave; a job row that started it is spent.
    db.prepare("DELETE FROM meta WHERE key = ?").run(waveJobKey(workflow))
    const ids = waveDue(db, workflow)
    const first = ids[0]
    if (first === undefined) return undefined
    const tasks = await waveTasks(db, checkout, ids)
    const parents = [...new Set(tasks.flatMap((each) => (each.parent === null ? [] : [each.parent])))]
    const head = await resolveSha(checkout, "HEAD")
    const base = parents.length === 0 ? head : parents.length === 1 ? (parents[0] ?? head) : (await git(checkout, ["merge-base", "--octopus", ...parents])).trim()
    const allowPaths = [...new Set(tasks.flatMap((each) => each.task.contract.context.allowPaths))]
    const union: Contract = { ...tasks[0]?.task.contract ?? getTask(db, first).contract }
    // A scoped check judges exactly what the tasks landed (`check run --within`): the union of their own diffs, never another
    // commit that sits in base..head (a merge, or work no task of this wave landed); a landed config file still widens it.
    const landed = [...new Set(tasks.flatMap((each) => (each.task.settleCommit === null ? [] : each.files)))]
    const scoped: Contract = { ...union, context: { ...union.context, allowPaths: landed.length === 0 ? allowPaths : landed } }
    // The scope decision is written before any command runs (contexts/authority/wave.md): the diff, its files, the commands, what is skipped.
    const changed = base === head ? [] : nulPaths(await git(checkout, ["diff", "--name-only", "-z", base, head]))
    const commands = [...new Set(tasks.flatMap((each) => each.checks.map((check) => (check.check.kind === "command" ? [check.check.run].flat().join(" ") : check.check.kind === "starci" ? `starci ${check.check.args.join(" ")} --base ${base.slice(0, 12)}${landed.length > 0 ? ` --within -- <${String(landed.length)} landed file(s)>` : ""}` : check.name))))]
    const scope = {
        diff: `${base}..${head}`,
        changed,
        paths: allowPaths,
        commands,
        skipped: "every task's cheap checks (lands, secrets, loosening, paths, files, json, cited, cite) ran in its own verify; CI runs the full suite after the push",
    }
    recordEvent(db, "wave-scope", workflow, { tasks: ids, ...scope })
    const judged = await inCleanCheckout(checkout, head, `wave-${workflow}`, async (dir) => {
        const place = (task: TaskRow | null, parent: string | null): CheckPlace => ({
            root: dir,
            source: checkout,
            cwd: join(dir, task?.contract.context.cwd ?? "."),
            diffBase: parent ?? base,
            timeoutMs,
            ...(task === null ? {} : { taskId: task.id, result: sourceOf(db, task) }),
        })
        // One install and setup per cwd the tasks run in; a node_modules a first one made is reused by the next (install-cache.ts).
        const cwds = [...new Set(tasks.map((each) => each.task.contract.context.cwd ?? "."))]
        const prepared = (await inOrder(cwds, (cwd) => {
            const group = tasks.filter((each) => (each.task.contract.context.cwd ?? ".") === cwd)
            const setups = [...new Map(group.flatMap((each) => each.task.contract.context.setup ?? []).map((command) => [JSON.stringify(command), command])).values()]
            return prepareCheckout({ ...place(null, null), cwd: join(dir, cwd) }, [setups])
        })).flat()
        // An install or setup out of time is the harness's failure: the wave reaches no verdict and fails no task; it runs again.
        assertNoInfraFailure(prepared)
        const ran = new Map<string, CheckOutcome>()
        const outcomes: Record<string, CheckOutcome[]> = {}
        if (prepared.every((outcome) => outcome.status === "green")) {
            for (const each of tasks) {
                outcomes[each.task.id] = await inOrder(each.checks, async (check) => {
                    const key = runKey(check, each.task)
                    const known = ran.get(key)
                    if (known !== undefined) return { ...known, name: check.name }
                    // A task that landed nothing proves the tracked files under its own allowPaths: an empty diff (head..head) over them.
                    const landedNothing = each.task.settleCommit === null
                    const scope = check.check.kind === "starci" && !landedNothing ? scoped : each.task.contract
                    // It judges as the wave's tasks (`--wave`): each one's composition deferral and its composers' obligations hold on the union.
                    const wave = landedNothing ? [each.task.id] : tasks.map((one) => one.task.id)
                    const at = check.check.kind === "starci" ? { ...place(null, landedNothing ? head : null), cwd: dir, within: !landedNothing && landed.length > 0, wave } : place(each.task, each.parent)
                    const outcome = await runCheck(check, scope, at)
                    ran.set(key, outcome)
                    return outcome
                })
            }
        }
        return { prepared, outcomes }
    })
    const redOwners = new Set<string>()
    const prepRed = judged.prepared.filter((outcome) => outcome.status === "red")
    if (prepRed.length > 0) for (const each of tasks) redOwners.add(each.task.id)
    // A red run belongs among the tasks that shared it (one run key): those its output names, else all of them.
    const sharing = (key: string): WaveTask[] => tasks.filter((each) => each.checks.some((check) => runKey(check, each.task) === key))
    for (const each of tasks) {
        each.checks.forEach((check, index) => {
            const outcome = judged.outcomes[each.task.id]?.[index]
            if (outcome?.status === "red") for (const owner of owners(outcome, sharing(runKey(check, each.task)))) redOwners.add(owner.task.id)
        })
    }
    for (const each of tasks) recordTask(db, workflow, each, [...judged.prepared, ...(judged.outcomes[each.task.id] ?? [])].map((outcome) => (outcome.status === "red" && !redOwners.has(each.task.id) ? { ...outcome, status: "green", detail: `red, but owned by another task of the wave\n${outcome.detail}` } : outcome)), redOwners.has(each.task.id))
    const returned = tasks.filter((each) => redOwners.has(each.task.id)).map((each) => each.task.id)
    const verdict = returned.length === 0 ? "green" : "red"
    const prepared = judged.prepared.map((outcome) => `${outcome.name} ${outcome.status}: ${outcome.detail.split("\n")[0] ?? ""}`)
    recordEvent(db, "wave-verified", workflow, { base, head, tasks: ids, returned, verdict, prepared })
    return { workflow, base, head, changed, commands, tasks: ids, prepared: judged.prepared, outcomes: judged.outcomes, returned, verdict }
}
