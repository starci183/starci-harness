import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { CONTRACT_SCHEMA, DEFAULT_BUDGET, contractProblems, parseContract } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { harnessWorktree } from "../../harness/kernel.js"
import { openLedger } from "../../harness/ledger.js"
import { acquireLeases, inTransaction } from "../../harness/leases.js"
import { askOrca, inLaunchGrace, isPingable, livenessOf, loadLiveness, recordPing } from "../../harness/liveness.js"
import type { Verdict } from "../../harness/liveness.js"
import { loadOps } from "../../harness/ops.js"
import type { OrcaBinary } from "../../harness/orca/client.js"
import { endWorker, noteHanded, projectSlots, recordWorker, workersOf } from "../../harness/project-workers.js"
import type { WorkerEnd, WorkerRecord } from "../../harness/project-workers.js"
import { describeRoute, routeTask, RouteRefusal } from "../../harness/router.js"
import { closeSeatsOfTask, isSeatOpen, SEAT_STOPPED, SEAT_WORKER_LOST, seatsOfTask } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { inOrder } from "../../harness/sequential.js"
import type { AttachedSupervisor } from "../../harness/supervisor.js"
import { createTask, getTask, latestAttempt, recordEvent, resultOf, TERMINAL_STATUSES } from "../../harness/tasks.js"
import type { ResultRow, TaskStatus } from "../../harness/tasks.js"
import type { Project } from "../../harness/work.js"
import { asRefusal, EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot, resolveSha } from "../../shared/git.js"
import type { VerbContext } from "../../shared/verb.js"
import { startSeat } from "../seat/start.js"
import { taskCancelVerb } from "../task/cancel.js"
import { taskVerifyVerb } from "../task/verify.js"

const TITLE_CHARS = 80
const TOPIC_CHARS = 60

const clip = (text: string, chars: number): string => (text.length <= chars ? text : `${text.slice(0, chars - 1)}…`)

/** The exact title of a Supervisor's worker terminal: `[Worker] <project>: <topic>`, clipped. */
export const workerTitle = (project: string, topic: string): string => clip(`[Worker] ${project}: ${topic}`, TITLE_CHARS)

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** What a Supervisor asks of one worker: the brief, the label it is routed by, the repository and paths it writes, the inputs its op names. */
export interface WorkerOrder {
    readonly brief: string
    readonly label: string
    readonly repo?: string | undefined
    readonly allow: readonly string[]
    readonly inputs: readonly string[]
    readonly topic?: string | undefined
}

/** A `--brief` value: the text of the file it names, else the text itself. */
const briefText = (cwd: string, brief: string): string => {
    const file = resolve(cwd, brief)
    const text = existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : brief
    if (text.trim() === "") throw new Refusal("CLI_USAGE", "--brief names an empty file or text: say what the worker does", EXIT_USAGE)
    return text.trim()
}

/** `name=value` inputs, split into the ones the label's op declares (base) and the rest (extend). */
const inputsOf = (label: string, given: readonly string[]): { readonly base?: Record<string, string>; readonly extend?: Record<string, string> } => {
    const declared = loadOps().labels[label]?.input.base ?? {}
    const pairs = given.map((entry) => {
        const at = entry.indexOf("=")
        if (at <= 0) throw new Refusal("CLI_USAGE", `--input takes name=value, not "${entry}"`, EXIT_USAGE)
        return [entry.slice(0, at), entry.slice(at + 1)] as const
    })
    const base = Object.fromEntries(pairs.filter(([name]) => name in declared))
    const extend = Object.fromEntries(pairs.filter(([name]) => !(name in declared)))
    return { ...(Object.keys(base).length === 0 ? {} : { base }), ...(Object.keys(extend).length === 0 ? {} : { extend }) }
}

/**
 * The contract of a worker: the label's op (its base context, output and checks), the brief as the input, and the paths it may
 * write; with no `--allow`, its one report file `starci-worker-<id>.md` (an investigation writes nothing else).
 */
const workerContract = (order: WorkerOrder, id: string, topic: string, revision: string, brief: string): Contract =>
    parseContract({
        schema: CONTRACT_SCHEMA,
        label: order.label,
        context: { revision, allowPaths: order.allow.length === 0 ? [`starci-worker-${id}.md`] : [...order.allow] },
        input: { summary: topic, details: brief, ...inputsOf(order.label, order.inputs) },
        budget: { ...DEFAULT_BUDGET },
    })

/** What a dispatch did: the worker, its task and worktree, and whether it launched now or waits for a slot. */
export interface WorkerDispatched {
    readonly worker: string
    readonly task: string
    readonly repo: string
    readonly worktree: string
    readonly branch: string
    readonly title: string
    readonly launched: boolean
    readonly detail: string
}

/** The coordinator identity a worker nests under: the attached Supervisor's Run, task and terminal. */
const nesting = (seat: AttachedSupervisor): { readonly terminal: string; readonly runId: string; readonly taskId: string } => ({ terminal: seat.terminal, runId: seat.run_id, taskId: seat.task_id })

/**
 * Launches one queued worker under the Supervisor (its Run, `--parent` its task, `--from` its terminal) in the worker's own
 * worktree, routed by the router from the worker's label like any Op, titled `[Worker] <project>: <topic>`. A refused route or
 * launch leaves the task queued (or as the launch left it) and says why.
 */
const launchWorker = async (context: VerbContext, seat: AttachedSupervisor, project: Project, worker: WorkerRecord): Promise<{ readonly launched: boolean; readonly detail: string }> => {
    const pick = routeTask(worker.repo, worker.task_id)
    if (pick instanceof RouteRefusal) return { launched: false, detail: `no route (${pick.code}): ${[pick.message, ...describeRoute(pick)].join("; ")}; it stays queued` }
    if (pick instanceof Refusal) return { launched: false, detail: `${pick.code}: ${pick.message}` }
    try {
        const started = await startSeat({
            root: worker.repo,
            cwd: context.cwd,
            task: worker.task_id,
            agent: pick.agent,
            model: pick.model,
            effort: pick.effort,
            pick,
            worktree: worker.worktree,
            coordinator: nesting(seat),
            title: workerTitle(project.name, worker.topic),
        })
        return { launched: true, detail: `${pick.agent}/${pick.model} routed (tier ${pick.tier}, pool ${pick.pool}): ${started.message.split("\n")[0] ?? "launched"}` }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { launched: false, detail: `launch refused (${refusal.code}): ${refusal.message.split("\n")[0] ?? ""}` }
    }
}

const taskStatusOf = (worker: WorkerRecord): TaskStatus => withLedger(worker.repo, (db) => getTask(db, worker.task_id).status)

/**
 * Launches the project's queued workers, oldest first, while the project has a free worker slot (routing.yaml
 * projectMaxWorkers, counted with its Kernels' Ops); one past the cap waits for the next call. Returns what it did.
 */
export const launchQueuedWorkers = async (context: VerbContext, seat: AttachedSupervisor, project: Project): Promise<string[]> => {
    const queued = workersOf(project.key, true).filter((worker) => taskStatusOf(worker) === "queued")
    const lines: string[] = []
    for (const worker of queued) {
        const slots = await projectSlots(project)
        if (slots.running >= slots.cap) {
            lines.push(`${worker.id}: queued, project ${project.name} runs ${String(slots.running)} of its ${String(slots.cap)} worker seats`)
            break
        }
        const launch = await launchWorker(context, seat, project, worker)
        lines.push(`${worker.id}: ${launch.detail}`)
    }
    return lines
}

/**
 * `supervisor dispatch`: the Supervisor hands one job to a `[Worker]` seat under it. The worker gets its own worktree of the target
 * repository (`<project state>/worktrees/<worker>` on branch `starci/<worker>`, from that checkout's HEAD), a task in that
 * repository's ledger whose contract is the brief on the label's op, the leases of its paths, and a row in machine.sqlite
 * `supervisor_workers`; then it launches when the project has a free worker slot, else it waits queued for `supervisor next`.
 */
export const dispatchWorker = async (context: VerbContext, seat: AttachedSupervisor, project: Project, order: WorkerOrder): Promise<WorkerDispatched> => {
    const repo = await repositoryRoot(resolve(context.cwd, order.repo ?? project.root))
    const brief = briefText(context.cwd, order.brief)
    const topic = clip((order.topic ?? brief.split("\n").find((line) => line.trim() !== "") ?? brief).replace(/^#+\s*/, "").trim(), TOPIC_CHARS)
    const id = `w-${randomUUID().slice(0, 8)}`
    const contract = workerContract(order, id, topic, await resolveSha(repo, "HEAD"), brief)
    const problems = contractProblems(contract, loadOps())
    if (problems.length > 0) throw new Refusal("CONTRACT_UNFIT", `the worker's contract is not fit to send:\n${problems.join("\n")}`)
    const made = await harnessWorktree(repo, id)
    const task = withLedger(repo, (db) =>
        inTransaction(db, () => {
            const created = createTask(db, contract, { worktree: made.path })
            acquireLeases(db, created)
            recordEvent(db, "worker-dispatched", created.id, { worker: id, project: project.key, supervisor: seat.id, worktree: made.path, branch: made.branch })
            return created
        }),
    )
    recordWorker({ id, project: project.key, repo, task_id: task.id, topic, worktree: made.path })
    const title = workerTitle(project.name, topic)
    const base = { worker: id, task: task.id, repo, worktree: made.path, branch: made.branch ?? `starci/${id}`, title }
    const slots = await projectSlots(project)
    if (slots.running >= slots.cap) return { ...base, launched: false, detail: `queued: project ${project.name} runs ${String(slots.running)} of its ${String(slots.cap)} worker seats; supervisor next launches it once one is released` }
    const launch = await launchWorker(context, seat, project, { id, project: project.key, repo, task_id: task.id, topic, worktree: made.path, created_at: "", handed: null, ended_at: null, ended_by: null })
    return { ...base, ...launch }
}

/** One worker as `supervisor workers` and `supervisor next` show it: its task, result, newest seat and that seat's liveness. */
export interface WorkerView {
    readonly id: string
    readonly topic: string
    readonly repo: string
    readonly worktree: string
    readonly task: string
    readonly taskStatus: TaskStatus
    readonly result: ResultRow | null
    readonly seat: { readonly id: string; readonly status: string; readonly handle: string | null; readonly terminal: string | null } | null
    readonly liveness: Verdict | "queued" | "none"
    /** What the worker came to that the Supervisor rules (`reported:<result>`, `failed`, `lost`, `awaiting_owner`), or null while it works. */
    readonly completion: string | null
    readonly handed: string | null
    readonly endedAt: string | null
    readonly endedBy: string | null
}

/** The completion of a worker's task the Supervisor rules, or null while it is queued, runs or is settling. */
const completionOf = (status: TaskStatus, result: ResultRow | null, seat: SeatRow | undefined): string | null => {
    if (status === "reported") return `reported:${result?.status ?? "?"}`
    if (status === "failed" || status === "awaiting_owner") return status
    if (status === "effect_unknown" && seat?.status === SEAT_WORKER_LOST) return "lost"
    return null
}

/** Reads one worker's task, result and newest seat from its repository's ledger. */
export const viewOf = (worker: WorkerRecord): WorkerView => {
    const rules = loadLiveness()
    return withLedger(worker.repo, (db) => {
        const task = getTask(db, worker.task_id)
        const attempt = latestAttempt(db, task.id)
        const result = attempt === undefined ? null : (resultOf(db, attempt.id) ?? null)
        const seat = seatsOfTask(db, task.id)[0]
        let liveness: WorkerView["liveness"] = "none"
        if (seat !== undefined) liveness = livenessOf(seat, rules).verdict
        else if (task.status === "queued") liveness = "queued"
        return {
            id: worker.id,
            topic: worker.topic,
            repo: worker.repo,
            worktree: worker.worktree,
            task: task.id,
            taskStatus: task.status,
            result,
            seat: seat === undefined ? null : { id: seat.id, status: seat.status, handle: seat.handle, terminal: seat.terminal },
            liveness,
            completion: completionOf(task.status, result, seat),
            handed: worker.handed,
            endedAt: worker.ended_at,
            endedBy: worker.ended_by,
        }
    })
}

/** A project's workers as views: the open ones, or with `all` the ended ones too. */
export const workerViews = (project: Project, all: boolean): WorkerView[] => workersOf(project.key, !all).map(viewOf)

// A seat Orca stopped waits for its release and one lost is gone by Orca's word: neither is closed again here.
const closable = (seat: SeatRow): boolean => isSeatOpen(seat) && seat.handle !== null && seat.status !== SEAT_STOPPED

/**
 * The mechanics `supervisor next` runs on its project's workers before it answers: each running worker past its launch grace is
 * pinged (Orca's word that it is gone makes its seat worker-lost and its task effect_unknown, `recordPing`), the seats of a worker
 * that reported, failed or was lost are closed (stopped, released, tab closed), so its slot frees, and the queued workers launch
 * while the project has slots.
 */
export const tendWorkers = async (context: VerbContext, seat: AttachedSupervisor, binary: OrcaBinary, project: Project): Promise<string[]> => {
    const rules = loadLiveness()
    const lines: string[] = []
    await inOrder(workersOf(project.key, true), async (worker) => {
        try {
            const status = taskStatusOf(worker)
            const seats = withLedger(worker.repo, (db) => seatsOfTask(db, worker.task_id))
            if (status === "running") {
                for (const open of seats.filter((one) => isPingable(one) && !inLaunchGrace(one, rules))) {
                    const answer = await askOrca(binary, open.handle ?? "", context.cwd, rules)
                    const recorded = withLedger(worker.repo, (db) => recordPing(db, open.id, answer))
                    if (recorded.lostTask !== null) lines.push(`${worker.id}: worker lost (${answer.kind === "gone" ? answer.evidence : answer.kind})`)
                }
            }
            const after = taskStatusOf(worker)
            const finished = after === "reported" || after === "failed" || after === "effect_unknown" || TERMINAL_STATUSES.includes(after)
            if (finished && withLedger(worker.repo, (db) => seatsOfTask(db, worker.task_id)).some(closable)) {
                const closings = await closeSeatsOfTask(worker.repo, worker.task_id)
                lines.push(...closings.map((closing) => `${worker.id}: seat ${closing.seat} ${closing.outcome}`))
            }
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            lines.push(`${worker.id}: not tended (${refusal.code}): ${refusal.message.split("\n")[0] ?? ""}`)
        }
    })
    lines.push(...(await launchQueuedWorkers(context, seat, project)))
    return lines
}

/** The oldest worker of a project with a completion the Supervisor was not handed yet; `hand` records it as handed. */
export const nextWorkerEvent = (project: Project, hand: boolean): WorkerView | null => {
    for (const worker of workersOf(project.key, true)) {
        const view = viewOf(worker)
        if (view.completion === null || view.completion === worker.handed) continue
        if (hand) noteHanded(worker.id, view.completion)
        return view
    }
    return null
}

/** A project's worker by its id, its task id or the id of one of its seats. */
export const findWorker = (project: Project, ref: string): WorkerRecord => {
    const workers = workersOf(project.key, false)
    const found = workers.find((worker) => worker.id === ref || worker.task_id === ref) ?? workers.find((worker) => withLedger(worker.repo, (db) => seatsOfTask(db, worker.task_id).some((seat) => seat.id === ref)))
    if (found === undefined) throw new Refusal("WORKER_UNKNOWN", `no worker, worker task or worker seat ${ref} in project ${project.name}; starci supervisor workers lists them`)
    return found
}

/** What an accept or reject did to a worker. */
export interface WorkerEnded {
    readonly worker: string
    readonly task: string
    readonly ended: WorkerEnd
    readonly branch: string
    readonly detail: string
}

const branchOf = (worker: WorkerRecord): string => `starci/${worker.id}`

/**
 * `supervisor accept`: a worker that reported `done` is settled by `task verify` in its repository (its checks on a clean
 * checkout of its candidate; green commits its paths on the worker's branch and the task is done, red fails it). The worker ends
 * `accepted` or `red`; landing the branch is Debug's. A worker that reported anything else, or has not reported, is refused.
 */
export const acceptWorker = async (context: VerbContext, project: Project, ref: string): Promise<WorkerEnded> => {
    const worker = findWorker(project, ref)
    if (worker.ended_at !== null) throw new Refusal("WORKER_ENDED", `worker ${worker.id} was ended ${worker.ended_by ?? ""} at ${worker.ended_at}`)
    const view = viewOf(worker)
    if (view.completion !== "reported:done") throw new Refusal("WORKER_NOT_ACCEPTABLE", `worker ${worker.id} is ${view.completion ?? view.taskStatus}; only a worker that reported done is accepted: reject it, or dispatch the job again`)
    const verified = await taskVerifyVerb.run({ ...context, cwd: worker.repo }, { task: worker.task_id, contract: undefined, record: false, "no-commit": false, recover: false })
    const data = verified.data as { readonly verdict?: string; readonly status?: string }
    const ended: WorkerEnd = data.verdict === "green" ? "accepted" : "red"
    endWorker(worker.id, ended)
    return { worker: worker.id, task: worker.task_id, ended, branch: branchOf(worker), detail: `verdict ${String(data.verdict)}, task ${String(data.status)}; ${verified.message.split("\n")[0] ?? ""}` }
}

/**
 * `supervisor reject`: ends a worker the Supervisor will not accept. A task still live is cancelled (its seat stopped and released,
 * its tab closed, its dirty paths preserved and reset, its leases freed); an ended task is left as it is.
 */
export const rejectWorker = async (context: VerbContext, project: Project, ref: string, reason: string | undefined): Promise<WorkerEnded> => {
    const worker = findWorker(project, ref)
    if (worker.ended_at !== null) throw new Refusal("WORKER_ENDED", `worker ${worker.id} was ended ${worker.ended_by ?? ""} at ${worker.ended_at}`)
    const status = taskStatusOf(worker)
    const detail = TERMINAL_STATUSES.includes(status)
        ? `task ${worker.task_id} is ${status}`
        : (await taskCancelVerb.run({ ...context, cwd: worker.repo }, { task: worker.task_id, reason: `worker ${worker.id} rejected by the Supervisor${reason === undefined ? "" : `: ${reason}`}` })).message
    endWorker(worker.id, "rejected")
    return { worker: worker.id, task: worker.task_id, ended: "rejected", branch: branchOf(worker), detail }
}
