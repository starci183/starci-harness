import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { pointerSpec, writeBrief } from "../../harness/brief.js"
import type { BriefFiles } from "../../harness/brief.js"
import { inTransaction, now, openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { recordOutcome } from "../../harness/circuit.js"
import { BLOCKED_PROMPT, escalateBlockedPrompt, explainLaunchFailure, failureText } from "../../harness/launch-failure.js"
import type { LaunchFailure } from "../../harness/launch-failure.js"
import { describeRoute, routeTask, RouteRefusal } from "../../harness/router.js"
import type { RoutePick } from "../../harness/router.js"
import { loadRouting, poolOfAgent, providerOfAgent, selectsModel } from "../../harness/routing.js"
import {
    LAUNCH_TIMEOUT_MS,
    OrcaFailure,
    closeWorker,
    dispatchOfFailure,
    effectiveLaunch,
    awaitWorktree,
    isSelectorNotFound,
    locateOrca,
    orcaArgv,
    repoAdd,
    repositoryOfSelector,
    requestIdOf,
    runCreate,
    runCreateFlags,
    terminalOfFailure,
    terminalRename,
    workerShow,
    workerStart,
    workerStartFlags,
    worktreeSelector,
    worktreeSetParent,
} from "../../harness/orca/client.js"
import type { EffectiveLaunch, OrcaBinary, WorkerClosed, WorkerShown, WorkerStartInput, WorkerStarted } from "../../harness/orca/client.js"
import { ensureKernel, launchableKernel, opTitle, workflowWorktreeOf } from "../../harness/kernel.js"
import { beginWork } from "../../harness/baseline.js"
import { ensureOpWorktree, opWorktreeOf, opWorktreePlace } from "../../harness/land.js"
import type { KernelLaunch } from "../../harness/kernel.js"
import { SEAT_LAUNCH_FAILED, SEAT_LAUNCH_UNKNOWN, SEAT_LAUNCH_UNSETTLED, SEAT_RELEASED, SEAT_STARTING, getSeat, isSeatOpen, noteTab, openSeat, recordSeat, recordSeatLaunch, seatsOfTask } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { getTask, latestAttempt, openAttempt, recordEvent, setStatus } from "../../harness/tasks.js"
import type { TaskRow, TaskStatus } from "../../harness/tasks.js"
import { getWorkflow } from "../../harness/workflow.js"
import { asRefusal, EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { reapplyLocal } from "../deps/packages.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"

/** What a seat start (or its dry run, or its resume) did. */
export interface SeatStartData {
    readonly task: string
    readonly dryRun: boolean
    readonly resumed: boolean
    readonly brief: string
    readonly contract: string
    readonly orca: OrcaBinary
    readonly argv: { readonly runCreate: readonly string[] | null; readonly workerStart: readonly string[] }
    readonly seat: SeatRow | null
    readonly attempt: string | null
    readonly runId: string | null
    readonly dispatchId: string | null
    readonly requestId: string | null
    readonly effective: unknown
    readonly attested: EffectiveLaunch | null
    /** The coordinator the worker nests under (its Kernel, or the Supervisor of a `[Worker]`: Run, task and terminal), or null when it launched flat. */
    readonly kernel: KernelLaunch | null
}

/** What launching a worker on a queued task needs; the module function `seat start` and `task send --launch` share. */
export interface SeatStartOptions {
    readonly root: string
    readonly cwd: string
    readonly task: string
    readonly agent: string
    readonly model: string
    readonly effort?: string | undefined
    readonly worktree?: string | undefined
    readonly run?: string | undefined
    readonly timeoutMs?: number | undefined
    readonly dryRun?: boolean | undefined
    /** The router's pick that chose agent and model, stored on the attempt (pick_json). */
    readonly pick?: RoutePick | undefined
    /** The coordinator a task outside any workflow nests under (a Supervisor's `[Worker]`: its Run, task and terminal); a workflow task nests under its Kernel. */
    readonly coordinator?: KernelLaunch | undefined
    /** The seat's title; default `opTitle` of the task. */
    readonly title?: string | undefined
}

const TITLE_CHARS = 80

/** Stands in for the Run id in a dry run that would create its Run first. */
const RUN_PLACEHOLDER = "<result.run.id of run-create>"

/** Stands in for the request id in a dry run, which opens no attempt to derive it from. */
const REQUEST_PLACEHOLDER = "<derived from the attempt id>"

const clip = (text: string): string => (text.length <= TITLE_CHARS ? text : `${text.slice(0, TITLE_CHARS - 1)}…`)

/** The folder a --worktree value names (a path, or a path: selector); another Orca selector leaves the repository root. */
const worktreeFolder = (value: string | undefined, cwd: string, root: string): string => {
    if (value === undefined) return root
    if (value.startsWith("path:")) return value.slice("path:".length)
    return value.includes(":") && !/^[A-Za-z]:[\\/]/.test(value) ? root : resolve(cwd, value)
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Everything one launch sends to Orca, stored on its seat (seats.launch_json) so a resume replays exactly the same calls and request ids. */
const launchRecordSchema = z.object({
    attempt: z.string(),
    objective: z.string(),
    run: z.string().nullable(),
    runRequest: z.string(),
    start: z.object({
        spec: z.string(),
        taskTitle: z.string(),
        worktree: z.string(),
        agent: z.string(),
        model: z.string().optional(),
        effort: z.string().optional(),
        parent: z.string().optional(),
        from: z.string().optional(),
        timeoutMs: z.number().int().positive(),
        retryRequest: z.string(),
    }),
})

type LaunchRecord = z.infer<typeof launchRecordSchema>

/** The start input of a launch record with its Run. */
const startInput = (record: LaunchRecord, run: string): WorkerStartInput => ({ ...record.start, run })

const argvOf = (binary: OrcaBinary, record: LaunchRecord, runId: string | null): SeatStartData["argv"] => ({
    runCreate: record.run === null ? [binary.path, ...orcaArgv("run-create", runCreateFlags({ objective: record.objective, from: record.start.from, retryRequest: record.runRequest }))] : null,
    workerStart: [binary.path, ...orcaArgv("worker-start", workerStartFlags(startInput(record, runId ?? RUN_PLACEHOLDER)))],
})

/**
 * The Kernel a launch nests its worker under: the workflow's, unless --run names another Run (Orca refuses a parent from
 * another Run). Null launches flat, in a Run of its own.
 */
const nestingOf = (kernel: KernelLaunch | null, options: SeatStartOptions): KernelLaunch | null => (kernel !== null && (options.run === undefined || options.run === kernel.runId) ? kernel : null)

/**
 * The launch record of a new attempt: request ids come from the attempt id, so a resume derives and sends the same ones. A
 * workflow task nests under its Kernel: the Kernel's Run, `--parent` its task and `--from` its coordinator terminal, the one
 * caller Orca accepts for that Run. A task without one is launched from ORCA_TERMINAL_HANDLE when this process runs in Orca.
 */
const launchRecord = (task: TaskRow, files: BriefFiles, options: SeatStartOptions, attempt: string, kernel: KernelLaunch | null): LaunchRecord => {
    const from = kernel?.terminal ?? process.env.ORCA_TERMINAL_HANDLE
    return {
        attempt,
        objective: clip(`StarCi task ${task.id}: ${task.contract.input.summary}`),
        run: kernel?.runId ?? options.run ?? null,
        runRequest: requestIdOf("run-create", attempt),
        start: {
            spec: pointerSpec(task.id, files),
            taskTitle: options.title ?? opTitle(task),
            worktree: worktreeSelector(options.worktree, options.cwd, options.root),
            agent: options.agent,
            // An agent that takes no launch-time model (modelSelection: false) runs its own; Orca refuses --model for it.
            ...(selectsModel(loadRouting(), options.agent) ? { model: options.model, ...(options.effort === undefined ? {} : { effort: options.effort }) } : {}),
            ...(kernel === null ? {} : { parent: kernel.taskId }),
            ...(from === undefined || from === "" ? {} : { from }),
            timeoutMs: options.timeoutMs ?? LAUNCH_TIMEOUT_MS,
            retryRequest: requestIdOf("worker-start", attempt),
        },
    }
}

/** How a launch ended, with the record it ran under: a ready worker, a certain failure (no worker can be running), or an unknown outcome. */
type Launched =
    | { readonly kind: "ready"; readonly record: LaunchRecord; readonly runId: string; readonly started: WorkerStarted }
    | { readonly kind: "failed"; readonly record: LaunchRecord; readonly runId: string | null; readonly dispatchId: string | null; readonly terminal: string | null; readonly error: Refusal }
    | { readonly kind: "unknown"; readonly record: LaunchRecord; readonly runId: string | null; readonly dispatchId: string | null; readonly terminal: string | null; readonly error: Refusal }

/**
 * Runs worker-start; when Orca answers selector_not_found (it does not know the repository or the new worktree yet) the repository is registered
 * (`orca repo add`), Orca is given time to discover the worktree, and the start tried once more under a request id of its own, recorded on the seat first so a resume
 * replays the retry. Returns the record the launch ran under.
 */
const startWorker = async (db: DatabaseSync, binary: OrcaBinary, seat: SeatRow, record: LaunchRecord, runId: string, root: string, cwd: string): Promise<{ readonly record: LaunchRecord; readonly started: WorkerStarted }> => {
    try {
        return { record, started: await workerStart(binary, startInput(record, runId), cwd) }
    } catch (error: unknown) {
        if (!isSelectorNotFound(error) || record.start.retryRequest === requestIdOf("worker-start-after-repo-add", record.attempt)) throw error
        const repository = await repositoryOfSelector(record.start.worktree, root)
        await repoAdd(binary, repository, cwd)
        await awaitWorktree(binary, record.start.worktree, cwd)
        const retried: LaunchRecord = { ...record, start: { ...record.start, retryRequest: requestIdOf("worker-start-after-repo-add", record.attempt) } }
        recordSeatLaunch(db, seat.id, retried, retried.start.retryRequest)
        recordEvent(db, "seat-repo-added", seat.taskId, { seat: seat.id, repository, request: retried.start.retryRequest })
        return { record: retried, started: await workerStart(binary, startInput(retried, runId), cwd) }
    }
}

/** Issues run-create (unless the Run is known) and worker-start under the record's request ids; never throws for an Orca answer. */
const launch = async (db: DatabaseSync, binary: OrcaBinary, seat: SeatRow, given: LaunchRecord, knownRun: string | null, root: string, cwd: string): Promise<Launched> => {
    let record = given
    let runId = knownRun
    if (runId === null) {
        try {
            runId = await runCreate(binary, { objective: record.objective, from: record.start.from, retryRequest: record.runRequest }, cwd)
        } catch (error: unknown) {
            // No worker-start was issued, so whatever happened to the Run, no worker can be running.
            return { kind: "failed", record, runId: null, dispatchId: null, terminal: null, error: asRefusal(error) }
        }
        recordSeat(db, seat.id, { status: SEAT_STARTING, runId })
    }
    try {
        const ran = await startWorker(db, binary, seat, record, runId, root, cwd)
        return { kind: "ready", record: ran.record, runId, started: ran.started }
    } catch (error: unknown) {
        record = launchRecordSchema.safeParse(getSeat(db, seat.id).launch).data ?? record
        if (error instanceof OrcaFailure) {
            const dispatchId = dispatchOfFailure(error) ?? null
            const terminal = terminalOfFailure(error) ?? null
            return error.effect === "unknown" ? { kind: "unknown", record, runId, dispatchId, terminal, error } : { kind: "failed", record, runId, dispatchId, terminal, error }
        }
        // A refusal before Orca ran (it could not be spawned) had no effect; anything else is not known to have had none.
        return error instanceof Refusal ? { kind: "failed", record, runId, dispatchId: null, terminal: null, error } : { kind: "unknown", record, runId, dispatchId: null, terminal: null, error: asRefusal(error) }
    }
}

/** True while the task still runs this attempt: a cancel (or anything else) during the launch makes the worker an orphan. */
const stillOurs = (db: DatabaseSync, taskId: string, attemptId: string): boolean => {
    const status = getTask(db, taskId).status
    return (status === "running" || status === "effect_unknown") && latestAttempt(db, taskId)?.id === attemptId
}

const endAttempt = (db: DatabaseSync, attemptId: string, outcome: string): void => {
    db.prepare("UPDATE attempts SET outcome = ?, ended_at = ? WHERE id = ? AND outcome IS NULL").run(outcome, now(), attemptId)
}

/** Puts a task whose launch certainly failed back in the queue (launch rolled back): losing a try to an Orca hiccup is wrong. */
const rollBack = (db: DatabaseSync, taskId: string): string => {
    setStatus(db, taskId, "queued")
    return `task ${taskId} is queued again`
}

const closeNote = (closed: WorkerClosed | null): string => (closed === null ? "" : `; worker ${closed.dispatchId}: stop ${closed.stop}, release ${closed.release}, tab ${closed.tab}`)

const seatAfterClose = (closed: WorkerClosed | null): string => (closed === null || closed.settled ? SEAT_RELEASED : SEAT_LAUNCH_UNSETTLED)

interface Launching {
    readonly root: string
    readonly db: DatabaseSync
    readonly binary: OrcaBinary
    readonly cwd: string
    readonly task: TaskRow
    readonly seat: SeatRow
    readonly files: BriefFiles
    readonly resumed: boolean
    readonly kernel: KernelLaunch | null
}

/**
 * Tells the provider circuit what a launch proved: a ready worker is a success, a certain worker-start failure reports the kind
 * explainLaunchFailure gave it, an unknown outcome is only noted (unknown is never a failure). A failed run-create, a spawn
 * error and an agent blocked at a prompt are the host's, not the provider's, and report nothing. Recording never changes the
 * launch's own result; a failure to record is a ledger event.
 */
const reportLaunch = (db: DatabaseSync, taskId: string, agent: string, launched: Launched, failure: LaunchFailure | null): void => {
    try {
        const routing = loadRouting()
        const provider = providerOfAgent(routing, agent)
        const pool = poolOfAgent(routing, agent)
        if (launched.kind === "ready") recordOutcome(provider, { kind: "success", pool })
        else if (launched.kind === "unknown") recordOutcome(provider, { kind: "unknown", detail: launched.error.message })
        else if (launched.runId !== null && launched.error instanceof OrcaFailure && failure !== null && failure.kind !== BLOCKED_PROMPT && failure.kind !== "stall") {
            recordOutcome(provider, { kind: failure.kind, pool, detail: launched.error.message })
        }
    } catch (error: unknown) {
        recordEvent(db, "provider-outcome-unrecorded", taskId, { agent, launch: launched.kind, error: messageOf(error) })
    }
}

type LaunchOf<Kind extends Launched["kind"]> = Extract<Launched, { readonly kind: Kind }>

/**
 * A launch Orca certainly did not start: the worker is closed (after explainLaunchFailure read its screen), the attempt ends, the
 * seat keeps why, and the task goes back to the queue. An agent blocked at a prompt ends its attempt `blocked-prompt` (no member
 * outcome) and raises the Supervisor's harness escalation naming the prompt and the worktree.
 */
const settleFailed = async (at: Launching, launched: LaunchOf<"failed">, failure: LaunchFailure): Promise<never> => {
    const { db, binary, cwd, task, seat } = at
    const attemptId = launched.record.attempt
    const blocked = failure.kind === BLOCKED_PROMPT
    const closed = launched.dispatchId === null ? null : await closeWorker(binary, launched.dispatchId, cwd, launched.terminal)
    const ours = inTransaction(db, () => {
        endAttempt(db, attemptId, blocked ? BLOCKED_PROMPT : "launch-failed")
        if (closed !== null) noteTab(db, seat.id, closed)
        recordSeat(db, seat.id, {
            status: closed === null || closed.settled ? SEAT_LAUNCH_FAILED : SEAT_LAUNCH_UNSETTLED,
            ...(launched.dispatchId === null ? {} : { handle: launched.dispatchId }),
            terminal: launched.terminal,
            failure,
            facts: { error: launched.error.message, cleanup: closed },
        })
        recordEvent(db, "seat-launch-failed", task.id, { seat: seat.id, attempt: attemptId, runId: launched.runId, kind: failure.kind, prompt: failure.prompt, cleanup: closed })
        if (blocked && task.workflowId !== null) {
            escalateBlockedPrompt(db, { project: at.root, workflowId: task.workflowId, seat: seat.id, worktree: worktreeFolder(launched.record.start.worktree, cwd, at.root), failure })
        }
        return stillOurs(db, task.id, attemptId)
    })
    const after = ours ? rollBack(db, task.id) : `task ${task.id} is ${getTask(db, task.id).status}`
    const escalated = blocked && task.workflowId !== null ? "; the Supervisor has a harness escalation for the prompt" : ""
    throw new Refusal(launched.error.code, `${failureText(failure)}\n${launched.error.message}${closeNote(closed)}\nattempt ${attemptId} closed as ${blocked ? BLOCKED_PROMPT : "launch-failed"}; ${after}${escalated}`)
}

/** A launch whose outcome Orca did not tell: the task waits as effect_unknown for a resume, unless it left the attempt meanwhile. */
const settleUnknown = async (at: Launching, launched: LaunchOf<"unknown">): Promise<never> => {
    const { db, binary, cwd, task, seat } = at
    const { record } = launched
    const attemptId = record.attempt
    const handle = launched.dispatchId === null ? {} : { handle: launched.dispatchId }
    const ours = inTransaction(db, () => {
        recordSeat(db, seat.id, { status: SEAT_LAUNCH_UNKNOWN, ...handle, terminal: launched.terminal, facts: { error: launched.error.message } })
        recordEvent(db, "seat-launch-unknown", task.id, { seat: seat.id, attempt: attemptId, runId: launched.runId, dispatchId: launched.dispatchId, request: record.start.retryRequest })
        const mine = stillOurs(db, task.id, attemptId)
        if (mine && getTask(db, task.id).status === "running") setStatus(db, task.id, "effect_unknown")
        return mine
    })
    if (!ours && launched.dispatchId !== null) {
        const terminal = launched.terminal ?? (await workerShow(binary, launched.dispatchId, cwd).then((shown) => shown.terminal, () => null))
        const closed = await closeWorker(binary, launched.dispatchId, cwd, terminal)
        noteTab(db, seat.id, closed)
        recordSeat(db, seat.id, { status: closed.settled ? SEAT_RELEASED : SEAT_LAUNCH_UNKNOWN, facts: { closed, orphaned: true } })
    }
    const next = ours
        ? `task ${task.id} is effect_unknown and keeps its worktree; seat ${seat.id} stays open. Replay the same launch (request ${record.start.retryRequest}) with: starci seat start ${task.id} --resume`
        : `task ${task.id} is ${getTask(db, task.id).status}; seat ${seat.id} is left ${getSeat(db, seat.id).status}`
    throw new Refusal("ORCA_OUTCOME_UNKNOWN", `${launched.error.message}\nthe launch of ${task.id} may or may not have started a worker; unknown is not dead. ${next}`)
}

/** What worker-show attested of a started worker, against what the launch asked for. */
const attestLaunch = async (at: Launching, launched: LaunchOf<"ready">) => {
    const { db, binary, cwd, task } = at
    const { started, record } = launched
    const attemptId = record.attempt
    // Attest the launch from worker-show; an Orca that does not answer proves nothing about the worker, so it is only noted.
    const shown: WorkerShown | string = await workerShow(binary, started.dispatchId, cwd).catch((error: unknown) => messageOf(error))
    const effective = typeof shown === "string" ? started.effective : (shown.effective ?? started.effective)
    const attested = effectiveLaunch(effective)
    const requested = record.start
    const mismatch = (requested.model !== undefined && attested.model !== null && attested.model !== requested.model) || (attested.agent !== null && attested.agent !== requested.agent)
    const ours = stillOurs(db, task.id, attemptId)
    // Orca names a worker tab after its task id; the harness names it by role and task, as every seat it runs is named.
    const terminal = typeof shown === "string" ? started.terminal : (shown.terminal ?? started.terminal)
    return { shown, effective, attested, requested, mismatch, ours, terminal }
}

/** A worker that launched wrong or whose task moved on: it is closed and the launch is refused. */
const abandonReady = async (at: Launching, launched: LaunchOf<"ready">, attestation: Awaited<ReturnType<typeof attestLaunch>>): Promise<never> => {
    const { db, binary, cwd, task, seat } = at
    const { started } = launched
    const attemptId = launched.record.attempt
    const { attested, requested, mismatch, terminal } = attestation
    const closed = await closeWorker(binary, started.dispatchId, cwd, terminal)
    noteTab(db, seat.id, closed)
    const outcome = mismatch ? "model-mismatch" : "orphaned"
    const rolled = inTransaction(db, () => {
        db.prepare("UPDATE attempts SET agent = COALESCE(?, agent), model = COALESCE(?, model) WHERE id = ?").run(attested.agent, attested.model, attemptId)
        endAttempt(db, attemptId, outcome)
        recordSeat(db, seat.id, { status: seatAfterClose(closed), facts: { closed, attested, reason: outcome } })
        recordEvent(db, `seat-${outcome}`, task.id, { seat: seat.id, attempt: attemptId, requested: { agent: requested.agent, model: requested.model }, attested, closed })
        return stillOurs(db, task.id, attemptId)
    })
    if (mismatch) {
        const after = rolled ? rollBack(db, task.id) : `task ${task.id} is ${getTask(db, task.id).status}`
        throw new Refusal(
            "MODEL_MISMATCH",
            `requested ${requested.agent} ${requested.model ?? "(its own model)"}, Orca launched ${attested.agent ?? requested.agent} ${attested.model ?? "(model not named)"}; the worker was closed${closeNote(closed)}\nattempt ${attemptId} closed as model-mismatch; ${after}`,
        )
    }
    throw new Refusal("TASK_LEFT_DURING_LAUNCH", `task ${task.id} became ${getTask(db, task.id).status} while its worker was launching; the worker was closed${closeNote(closed)}`)
}

/**
 * Lists an Op's worktree under its Kernel's worktree in Orca (`[Op] <workflow>: <task>`), so the Supervisor, Kernel and Op tree
 * reads the same in Orca's worktree list as in its Run's task tree. Best effort: a refusal is an event, never a failed launch.
 */
const nestOpWorktree = async (db: DatabaseSync, binary: OrcaBinary, task: TaskRow, cwd: string): Promise<void> => {
    const made = opWorktreeOf(db, task.id)
    if (made === undefined || task.workflowId === null) return
    try {
        await worktreeSetParent(binary, { worktree: made.path, parent: made.target, displayName: `[Op] ${task.workflowId}: ${task.id}` }, cwd)
        recordEvent(db, "op-worktree-nested", task.id, { worktree: made.path, parent: made.target })
    } catch (error: unknown) {
        recordEvent(db, "op-worktree-nest-skipped", task.id, { worktree: made.path, parent: made.target, reason: messageOf(error) })
    }
}

/** A worker that launched as asked: the attempt is attested, the seat records the worker and its tab is titled. */
const settleReady = async (at: Launching, launched: LaunchOf<"ready">, base: Omit<SeatStartData, "seat" | "dispatchId" | "effective" | "attested">): Promise<VerbResult<SeatStartData>> => {
    const { db, binary, cwd, task, seat } = at
    const { started, runId, record } = launched
    const attemptId = record.attempt
    recordSeat(db, seat.id, { status: started.state, handle: started.dispatchId, terminal: started.terminal, runId, facts: { orcaTask: started.taskId, parent: record.start.parent ?? null, effective: started.effective } })
    const attestation = await attestLaunch(at, launched)
    if (attestation.mismatch || !attestation.ours) return abandonReady(at, launched, attestation)
    const { shown, effective, attested, requested, terminal } = attestation
    const seatRow = inTransaction(db, () => {
        db.prepare("UPDATE attempts SET agent = COALESCE(?, agent), model = COALESCE(?, model) WHERE id = ?").run(attested.agent, attested.model, attemptId)
        recordEvent(db, "attempt-attested", attemptId, { requested: { agent: requested.agent, model: requested.model, effort: requested.effort ?? null }, attested, attestation: typeof shown === "string" ? shown : "worker-show" })
        if (getTask(db, task.id).status === "effect_unknown") setStatus(db, task.id, "running")
        return typeof shown === "string"
            ? recordSeat(db, seat.id, { status: started.state, facts: { attestation: shown } })
            : recordSeat(db, seat.id, { status: shown.state ?? started.state, terminal: shown.terminal, facts: { effective: shown.effective } })
    })
    const titled = terminal === null ? "no terminal handle to title" : await terminalRename(binary, terminal, requested.taskTitle, cwd)
    if (titled !== undefined) recordEvent(db, "seat-title-skipped", task.id, { seat: seat.id, reason: titled })
    await nestOpWorktree(db, binary, task, cwd)
    const data: SeatStartData = { ...base, seat: seatRow, dispatchId: started.dispatchId, effective, attested }
    const model = attested.model ?? `${requested.model ?? "its own model"} (not attested)`
    const under = requested.parent === undefined ? "" : ` under the Kernel task ${requested.parent}`
    return { data, message: `seat ${seat.id} (${requested.agent} ${model}) runs task ${task.id} as dispatch ${started.dispatchId} in run ${runId}${under}; brief ${at.files.brief}` }
}

/** Records how a launch ended and moves the task: ready runs, a certain failure goes back to the queue, unknown waits for a resume. */
const settleLaunch = async (at: Launching, launched: Launched): Promise<VerbResult<SeatStartData>> => {
    const { db, binary } = at
    const { record } = launched
    if (launched.kind === "failed") {
        // The screen is read before settleFailed releases the worker, whose terminal goes with it.
        const failure = await explainLaunchFailure(binary, launched.error, at.cwd, loadRouting())
        reportLaunch(db, at.task.id, record.start.agent, launched, failure)
        return settleFailed(at, launched, failure)
    }
    reportLaunch(db, at.task.id, record.start.agent, launched, null)
    switch (launched.kind) {
        case "unknown":
            return settleUnknown(at, launched)
        case "ready": {
            const base = { task: at.task.id, dryRun: false, resumed: at.resumed, brief: at.files.brief, contract: at.files.contract, orca: binary, argv: argvOf(binary, record, launched.runId), attempt: record.attempt, runId: launched.runId, requestId: record.start.retryRequest, kernel: at.kernel }
            return settleReady(at, launched, base)
        }
    }
}

/**
 * Requires the workflow's attached Kernel before a real launch; a dry run only reads its recorded identity.
 */
const kernelOf = async (db: DatabaseSync, task: TaskRow, binary: OrcaBinary, options: SeatStartOptions): Promise<KernelLaunch | null> => {
    if (task.workflowId === null) return null
    const workflowId = task.workflowId
    if (options.dryRun !== true && getWorkflow(db, workflowId).header.runner === "orca") {
        await ensureKernel(options.root, options.cwd, workflowId, binary)
    }
    return launchableKernel(getWorkflow(db, workflowId))
}

/**
 * Launches one Orca worker on a queued task. The claim comes first, in one BEGIN IMMEDIATE transaction (queued -> running, a
 * new attempt, an open seat carrying the launch record), so two concurrent starts cannot both launch; only then is Orca called.
 */
export const startSeat = async (given: SeatStartOptions): Promise<VerbResult<SeatStartData>> => {
    const { root, cwd } = given
    const ops = loadOps()
    const db = openLedger(root)
    try {
        const task = getTask(db, given.task)
        if (task.status !== "queued") throw new Refusal("TASK_NOT_QUEUED", `task ${task.id} is ${task.status}; only a queued task gets a seat (an effect_unknown launch resumes with --resume)`)
        // Every Op of a workflow works in a worktree of its own, cut from the branch of the workflow's worktree (or of the folder
        // --worktree names), and lands back on it; a task outside a workflow runs where --worktree says, else in this repository.
        const recorded = task.workflowId === null ? undefined : workflowWorktreeOf(db, task.workflowId)
        const target = given.worktree === undefined ? (recorded ?? root) : worktreeFolder(given.worktree, cwd, root)
        const opPath = task.workflowId === null || given.coordinator !== undefined ? undefined : given.dryRun === true ? opWorktreePlace(root, task.workflowId, task.id).path : (await ensureOpWorktree(root, task.id, target)).path
        const options: SeatStartOptions = { ...given, worktree: opPath === undefined ? given.worktree : `path:${opPath.replaceAll("\\", "/")}` }
        const binary = await locateOrca(cwd)
        const kernel = options.coordinator ?? nestingOf(await kernelOf(db, task, binary, options), options)
        if (options.dryRun === true) {
            const files = writeBrief(task, ops, root)
            const record = launchRecord(task, files, options, "dry-run", kernel)
            const shown: LaunchRecord = { ...record, runRequest: REQUEST_PLACEHOLDER, start: { ...record.start, retryRequest: REQUEST_PLACEHOLDER } }
            const argv = argvOf(binary, shown, record.run)
            const data: SeatStartData = { task: task.id, dryRun: true, resumed: false, brief: files.brief, contract: files.contract, orca: binary, argv, seat: null, attempt: null, runId: record.run, dispatchId: null, requestId: null, effective: null, attested: null, kernel }
            const lines = [
                "dry run: nothing launched, the ledger is unchanged",
                `brief: ${files.brief}`,
                ...(argv.runCreate === null ? [] : [`run-create argv: ${JSON.stringify(argv.runCreate)}`]),
                `worker-start argv: ${JSON.stringify(argv.workerStart)}`,
            ]
            return { data, message: lines.join("\n") }
        }

        const claim = inTransaction(db, () => {
            const current = getTask(db, options.task)
            if (current.status !== "queued") throw new Refusal("TASK_NOT_QUEUED", `task ${current.id} is ${current.status}; another seat start claimed it first`)
            const running = setStatus(db, current.id, "running")
            const attempt = openAttempt(db, current.id, { agent: options.agent, model: options.model, ...(options.pick === undefined ? {} : { pick: options.pick }) })
            const files = writeBrief(running, ops, root)
            const record = launchRecord(running, files, options, attempt.id, kernel)
            const seat = openSeat(db, { role: "worker", agent: options.agent, model: options.model, taskId: current.id, attemptId: attempt.id, requestId: record.start.retryRequest, launch: record })
            return { task: running, seat, record, files }
        })
        await beginWork(root, worktreeFolder(options.worktree, cwd, root), claim.task)
        // A repository in local package mode gives the worker's checkout the same local @starci copies as its work tree; a
        // failed copy is recorded and the launch goes on, since the worker can still run `starci deps source --sync`.
        const synced = await reapplyLocal(root, worktreeFolder(options.worktree, cwd, root))
        if (synced !== undefined) recordEvent(db, synced.status === "green" ? "deps-local-synced" : "deps-local-sync-failed", claim.task.id, { detail: synced.detail })
        const files = writeBrief(claim.task, ops, root)
        const launched = await launch(db, binary, claim.seat, claim.record, claim.record.run, root, cwd)
        return await settleLaunch({ root, db, binary, cwd, task: claim.task, seat: claim.seat, files, resumed: false, kernel }, launched)
    } finally {
        db.close()
    }
}

/** The statuses from which a launch may be resumed: unknown, or a running task whose launch process died before Orca answered. */
const RESUMABLE: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["effect_unknown", "running"])

/**
 * Replays the recorded launch of a task whose outcome is unknown, under the same request ids: Orca applies a request id at most
 * once, so a replay answers the first launch's outcome instead of starting a second worker. Concurrent resumes are safe for
 * the same reason.
 */
export const resumeSeat = async (options: { readonly root: string; readonly cwd: string; readonly task: string }): Promise<VerbResult<SeatStartData>> => {
    const { root, cwd } = options
    const db = openLedger(root)
    try {
        const binary = await locateOrca(cwd)
        const claim = inTransaction(db, () => {
            const task = getTask(db, options.task)
            const attempt = latestAttempt(db, task.id)
            const seat = seatsOfTask(db, task.id).find(isSeatOpen)
            const resumable =
                RESUMABLE.has(task.status) &&
                seat !== undefined &&
                (seat.status === SEAT_LAUNCH_UNKNOWN || (seat.status === SEAT_STARTING && seat.handle === null)) &&
                (task.status === "effect_unknown" || seat.status === SEAT_STARTING)
            if (!resumable || attempt === undefined) throw new Refusal("SEAT_NOT_RESUMABLE", `task ${task.id} is ${task.status} with ${seat === undefined ? "no open seat" : "seat " + seat.id + " " + seat.status}; only a launch whose outcome is unknown resumes`)
            const parsed = launchRecordSchema.safeParse(seat.launch)
            if (!parsed.success || parsed.data.attempt !== attempt.id) throw new Refusal("SEAT_NOT_RESUMABLE", `seat ${seat.id} carries no launch record of attempt ${attempt.id}; it cannot be replayed`)
            recordEvent(db, "seat-resume", task.id, { seat: seat.id, attempt: attempt.id, request: parsed.data.start.retryRequest })
            const runId = seat.runId ?? parsed.data.run
            return { task, seat, record: parsed.data, runId }
        })
        const recorded = claim.task.workflowId === null ? undefined : workflowWorktreeOf(db, claim.task.workflowId)
        await beginWork(root, claim.task.worktree ?? recorded ?? root, claim.task)
        const files = writeBrief(claim.task, loadOps(), root)
        const launched = await launch(db, binary, claim.seat, claim.record, claim.runId, root, cwd)
        const parent = claim.record.start.parent
        const kernel = parent === undefined || claim.runId === null || claim.record.start.from === undefined ? null : { terminal: claim.record.start.from, runId: claim.runId, taskId: parent }
        return await settleLaunch({ root, db, binary, cwd, task: claim.task, seat: claim.seat, files, resumed: true, kernel }, launched)
    } finally {
        db.close()
    }
}

/** Parses a --timeout-ms value; refuses anything but a positive whole number of milliseconds. */
export const parseTimeout = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Refusal("CLI_USAGE", `--timeout-ms must be a positive whole number of milliseconds, not "${value}"`, EXIT_USAGE)
    return parsed
}

/** What a launch runs: the agent, model and effort, and the router's pick when the router chose them. */
export interface LaunchChoice {
    readonly agent: string
    readonly model: string
    readonly effort?: string | undefined
    readonly pick?: RoutePick | undefined
}

/**
 * The agent, model and effort of a launch: as given, or, with neither --agent nor --model, the router's pick for the task
 * (its label, attempt number and contract-red lineage). A pick is remembered for balance only when `record` is true.
 */
export const chooseLaunch = (root: string, task: string, given: { readonly agent?: string | undefined; readonly model?: string | undefined; readonly effort?: string | undefined }, record: boolean): LaunchChoice => {
    if (given.agent !== undefined && given.model !== undefined) return { agent: given.agent, model: given.model, effort: given.effort }
    if (given.agent !== undefined || given.model !== undefined) throw new Refusal("CLI_USAGE", "give both --agent and --model, or neither and the router picks them", EXIT_USAGE)
    const pick = routeTask(root, task, { record })
    if (pick instanceof RouteRefusal) throw new Refusal(pick.code, [pick.message, ...describeRoute(pick)].join("\n"))
    if (pick instanceof Refusal) throw pick
    return { agent: pick.agent, model: pick.model, effort: given.effort ?? pick.effort, pick }
}

/** The route lines a launch prints before its own message, when the router chose. */
export const routeLines = (choice: LaunchChoice): string[] => (choice.pick === undefined ? [] : describeRoute(choice.pick))

/** `starci seat start`: renders the worker brief of a queued task and launches one Orca worker on it; the task moves to running. */
export const seatStartVerb = defineVerb({
    path: ["seat", "start"],
    summary: "launch an Orca worker on a queued task with its rendered brief; --resume replays a launch whose outcome is unknown; --dry-run prints the orca argv",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "kernel", "supervisor", "coordinator"],
    schema: "starci/seat-start@1",
    flags: {
        task: { kind: "string", summary: "the queued task id (or, with --resume, the effect_unknown one)", required: true, positional: true },
        agent: { kind: "string", summary: "the Orca agent id (claude, codex, ...); with --model, or neither and the router picks; --resume reuses the recorded one" },
        model: { kind: "string", summary: "the provider model id; with --agent, or neither and the router picks; --resume reuses the recorded one" },
        effort: { kind: "string", summary: "the reasoning effort of the model" },
        worktree: { kind: "string", summary: "where the worker runs: a path or an Orca worktree selector (default: this repository)" },
        run: { kind: "string", summary: "an existing Orca Run id (default: create a Run for this task)" },
        "timeout-ms": { kind: "string", summary: `how long Orca may wait for a ready worker (worker-start --timeout-ms; default ${String(LAUNCH_TIMEOUT_MS)})` },
        resume: { kind: "boolean", summary: "replay the recorded launch of an effect_unknown task under the same Orca request id" },
        "dry-run": { kind: "boolean", summary: "write the brief and print the orca argv; launch nothing and leave the ledger as it is" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        if (flags.resume) {
            const given = (["agent", "model", "effort", "worktree", "run", "timeout-ms"] as const).filter((name) => flags[name] !== undefined)
            const dropped = [...given.map((name) => "--" + name), ...(flags["dry-run"] ? ["--dry-run"] : [])]
            if (given.length > 0 || flags["dry-run"]) throw new Refusal("CLI_USAGE", `--resume replays the recorded launch as it was; drop ${dropped.join(", ")}`, EXIT_USAGE)
            const resumed = await resumeSeat({ root, cwd: context.cwd, task: flags.task })
            return { ...resumed, data: { ...resumed.data, route: null } }
        }
        const timeoutMs = parseTimeout(flags["timeout-ms"])
        const choice = chooseLaunch(root, flags.task, flags, !flags["dry-run"])
        const started = await startSeat({ root, cwd: context.cwd, task: flags.task, agent: choice.agent, model: choice.model, effort: choice.effort, pick: choice.pick, worktree: flags.worktree, run: flags.run, timeoutMs, dryRun: flags["dry-run"] })
        return { ...started, data: { ...started.data, route: choice.pick ?? null }, message: [...routeLines(choice), started.message].join("\n") }
    },
})
