import type { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { git, nulPaths, resolveSha } from "../shared/git.js"
import { redactSecrets } from "../shared/secrets.js"
import { inCleanCheckout, prepareCheckout } from "./clean-verify.js"
import { resolveChecks } from "./contract.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { inTransaction, now } from "./ledger.js"
import { readMachine } from "./machine.js"
import { loadOps } from "./ops.js"
import { loadPolicy } from "./policy.js"
import { runCheck } from "./run-checks.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "./run-checks.js"
import { inOrder } from "./sequential.js"
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
 * The wave verify of a workflow: the heavy checks its due tasks left (`waveDue`) run once, on one clean checkout of the
 * workflow's HEAD, over the union of what those tasks landed, the diff from the oldest of their settle commits' parents. The
 * install comes from the shared cache, every contract's setup runs once, a scoped check runs once for all, and a command check
 * once per cwd and argv (per task when it reads the task's result or coverage). A red check is owned by the tasks whose files its
 * output names (every task that left it, when it names none); each owning task turns failed, back to the Kernel with the red
 * check rows on its attempt, and every task of the wave is judged. Undefined when no wave is due.
 */
export const runWave = async (db: DatabaseSync, callerRoot: string, workflow: string, timeoutMs: number): Promise<WaveReport | undefined> => {
    const ids = waveDue(db, workflow)
    const first = ids[0]
    if (first === undefined) return undefined
    const checkout = await taskCheckout(getTask(db, first), callerRoot)
    const tasks = await waveTasks(db, checkout, ids)
    const parents = [...new Set(tasks.flatMap((each) => (each.parent === null ? [] : [each.parent])))]
    const head = await resolveSha(checkout, "HEAD")
    const base = parents.length === 0 ? head : parents.length === 1 ? (parents[0] ?? head) : (await git(checkout, ["merge-base", "--octopus", ...parents])).trim()
    const allowPaths = [...new Set(tasks.flatMap((each) => each.task.contract.context.allowPaths))]
    const union: Contract = { ...tasks[0]?.task.contract ?? getTask(db, first).contract }
    const scoped: Contract = { ...union, context: { ...union.context, allowPaths } }
    // The scope decision is written before any command runs (contexts/authority/wave.md): the diff, its files, the commands, what is skipped.
    const changed = base === head ? [] : nulPaths(await git(checkout, ["diff", "--name-only", "-z", base, head]))
    const commands = [...new Set(tasks.flatMap((each) => each.checks.map((check) => (check.check.kind === "command" ? [check.check.run].flat().join(" ") : check.check.kind === "starci" ? `starci ${check.check.args.join(" ")} --base ${base.slice(0, 12)}` : check.name))))]
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
                    const at = check.check.kind === "starci" ? { ...place(null, landedNothing ? head : null), cwd: dir } : place(each.task, each.parent)
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
