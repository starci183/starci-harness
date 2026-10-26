import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { pointerSpec, writeBrief } from "../../harness/brief.js"
import type { BriefFiles } from "../../harness/brief.js"
import { now, openLedger } from "../../harness/ledger.js"
import { assertLeasesHeld, inTransaction, renewLeases } from "../../harness/leases.js"
import { loadOps } from "../../harness/ops.js"
import {
    LAUNCH_TIMEOUT_MS,
    OrcaFailure,
    closeWorker,
    dispatchOfFailure,
    effectiveLaunch,
    locateOrca,
    orcaArgv,
    requestIdOf,
    runCreate,
    runCreateFlags,
    workerShow,
    workerStart,
    workerStartFlags,
} from "../../harness/orca/client.js"
import type { EffectiveLaunch, OrcaBinary, WorkerClosed, WorkerShown, WorkerStartInput, WorkerStarted } from "../../harness/orca/client.js"
import { SEAT_LAUNCH_FAILED, SEAT_LAUNCH_UNKNOWN, SEAT_LAUNCH_UNSETTLED, SEAT_RELEASED, SEAT_STARTING, getSeat, isSeatOpen, openSeat, recordSeat, seatFacts, seatsOfTask } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { getTask, latestAttempt, openAttempt, recordEvent, setStatus } from "../../harness/tasks.js"
import type { TaskRow, TaskStatus } from "../../harness/tasks.js"
import { asRefusal, EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
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
}

const TITLE_CHARS = 80

/** Stands in for the Run id in a dry run that would create its Run first. */
const RUN_PLACEHOLDER = "<result.run.id of run-create>"

/** Stands in for the request id in a dry run, which opens no attempt to derive it from. */
const REQUEST_PLACEHOLDER = "<derived from the attempt id>"

/** Orca's worktree selectors; anything else is a filesystem path and becomes `path:<absolute path>`. */
const SELECTOR = /^(?:(?:identity|id|name|branch|issue|path):|(?:current|active|new-child|new-top-level)$)/

const clip = (text: string): string => (text.length <= TITLE_CHARS ? text : `${text.slice(0, TITLE_CHARS - 1)}…`)

const worktreeSelector = (value: string | undefined, cwd: string, root: string): string => {
    if (value !== undefined && SELECTOR.test(value)) return value
    return `path:${resolve(cwd, value ?? root).replace(/\\/g, "/")}`
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Everything one launch sends to Orca, stored on its seat (facts.launch) so a resume replays exactly the same calls and request ids. */
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
        model: z.string(),
        effort: z.string().optional(),
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

/** The launch record of a new attempt: request ids come from the attempt id, so a resume derives and sends the same ones. */
const launchRecord = (task: TaskRow, files: BriefFiles, options: SeatStartOptions, attempt: string): LaunchRecord => {
    const from = process.env.ORCA_TERMINAL_HANDLE
    return {
        attempt,
        objective: clip(`StarCi task ${task.id}: ${task.contract.input.summary}`),
        run: options.run ?? null,
        runRequest: requestIdOf("run-create", attempt),
        start: {
            spec: pointerSpec(task.id, files),
            taskTitle: clip(`[Worker] ${task.id} ${task.contract.label}: ${task.contract.input.summary}`),
            worktree: worktreeSelector(options.worktree, options.cwd, options.root),
            agent: options.agent,
            model: options.model,
            ...(options.effort === undefined ? {} : { effort: options.effort }),
            ...(from === undefined ? {} : { from }),
            timeoutMs: options.timeoutMs ?? LAUNCH_TIMEOUT_MS,
            retryRequest: requestIdOf("worker-start", attempt),
        },
    }
}

/** How a launch ended: a ready worker, a certain failure (no worker can be running), or an unknown outcome. */
type Launched =
    | { readonly kind: "ready"; readonly runId: string; readonly started: WorkerStarted }
    | { readonly kind: "failed"; readonly runId: string | null; readonly dispatchId: string | null; readonly error: Refusal }
    | { readonly kind: "unknown"; readonly runId: string | null; readonly dispatchId: string | null; readonly error: Refusal }

/** Issues run-create (unless the Run is known) and worker-start under the record's request ids; never throws for an Orca answer. */
const launch = async (db: DatabaseSync, binary: OrcaBinary, seat: SeatRow, record: LaunchRecord, knownRun: string | null, cwd: string): Promise<Launched> => {
    let runId = knownRun
    if (runId === null) {
        try {
            runId = await runCreate(binary, { objective: record.objective, from: record.start.from, retryRequest: record.runRequest }, cwd)
        } catch (error: unknown) {
            // No worker-start was issued, so whatever happened to the Run, no worker can be running.
            return { kind: "failed", runId: null, dispatchId: null, error: asRefusal(error) }
        }
        recordSeat(db, seat.id, { status: SEAT_STARTING, facts: { runId } })
    }
    try {
        return { kind: "ready", runId, started: await workerStart(binary, startInput(record, runId), cwd) }
    } catch (error: unknown) {
        if (error instanceof OrcaFailure) {
            const dispatchId = dispatchOfFailure(error) ?? null
            return error.effect === "unknown" ? { kind: "unknown", runId, dispatchId, error } : { kind: "failed", runId, dispatchId, error }
        }
        // A refusal before Orca ran (it could not be spawned) had no effect; anything else is not known to have had none.
        return error instanceof Refusal ? { kind: "failed", runId, dispatchId: null, error } : { kind: "unknown", runId, dispatchId: null, error: asRefusal(error) }
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

/**
 * Puts a task whose launch certainly failed back in the queue: losing a try to an Orca hiccup is wrong. This needs the
 * transitions running -> queued and effect_unknown -> queued ("launch rolled back"); until tasks.ts has them, the refusal
 * is reported instead and the task keeps its state.
 */
const rollBack = (db: DatabaseSync, taskId: string): string => {
    try {
        setStatus(db, taskId, "queued")
        return `task ${taskId} is queued again`
    } catch (error: unknown) {
        return `task ${taskId} was not rolled back (${messageOf(error)})`
    }
}

const closeNote = (closed: WorkerClosed | null): string => (closed === null ? "" : `; worker ${closed.dispatchId}: stop ${closed.stop}, release ${closed.release}`)

const seatAfterClose = (closed: WorkerClosed | null): string => (closed === null || closed.settled ? SEAT_RELEASED : SEAT_LAUNCH_UNSETTLED)

interface Launching {
    readonly db: DatabaseSync
    readonly binary: OrcaBinary
    readonly cwd: string
    readonly task: TaskRow
    readonly seat: SeatRow
    readonly record: LaunchRecord
    readonly files: BriefFiles
    readonly resumed: boolean
}

/** Records how a launch ended and moves the task: ready runs, a certain failure goes back to the queue, unknown waits for a resume. */
const settleLaunch = async (at: Launching, launched: Launched): Promise<VerbResult<SeatStartData>> => {
    const { db, binary, cwd, task, seat, record } = at
    const attemptId = record.attempt
    const base = { task: task.id, dryRun: false, resumed: at.resumed, brief: at.files.brief, contract: at.files.contract, orca: binary, argv: argvOf(binary, record, launched.runId), attempt: attemptId, runId: launched.runId, requestId: record.start.retryRequest }

    if (launched.kind === "failed") {
        const closed = launched.dispatchId === null ? null : await closeWorker(binary, launched.dispatchId, cwd)
        const ours = inTransaction(db, () => {
            endAttempt(db, attemptId, "launch-failed")
            recordSeat(db, seat.id, {
                status: closed === null || closed.settled ? SEAT_LAUNCH_FAILED : SEAT_LAUNCH_UNSETTLED,
                ...(launched.dispatchId === null ? {} : { handle: launched.dispatchId }),
                facts: { error: launched.error.message, cleanup: closed },
            })
            recordEvent(db, "seat-launch-failed", task.id, { seat: seat.id, attempt: attemptId, runId: launched.runId, cleanup: closed })
            return stillOurs(db, task.id, attemptId)
        })
        const after = ours ? rollBack(db, task.id) : `task ${task.id} is ${getTask(db, task.id).status}`
        throw new Refusal(launched.error.code, `${launched.error.message}${closeNote(closed)}\nattempt ${attemptId} closed as launch-failed; ${after}`)
    }

    if (launched.kind === "unknown") {
        const handle = launched.dispatchId === null ? {} : { handle: launched.dispatchId }
        const ours = inTransaction(db, () => {
            recordSeat(db, seat.id, { status: SEAT_LAUNCH_UNKNOWN, ...handle, facts: { error: launched.error.message } })
            recordEvent(db, "seat-launch-unknown", task.id, { seat: seat.id, attempt: attemptId, runId: launched.runId, dispatchId: launched.dispatchId, request: record.start.retryRequest })
            const mine = stillOurs(db, task.id, attemptId)
            if (mine && getTask(db, task.id).status === "running") setStatus(db, task.id, "effect_unknown")
            return mine
        })
        if (!ours && launched.dispatchId !== null) {
            const closed = await closeWorker(binary, launched.dispatchId, cwd)
            recordSeat(db, seat.id, { status: closed.settled ? SEAT_RELEASED : SEAT_LAUNCH_UNKNOWN, facts: { closed, orphaned: true } })
        }
        const next = ours
            ? `task ${task.id} is effect_unknown and keeps its leases; seat ${seat.id} stays open. Replay the same launch (request ${record.start.retryRequest}) with: starci seat start ${task.id} --resume`
            : `task ${task.id} is ${getTask(db, task.id).status}; seat ${seat.id} is left ${getSeat(db, seat.id).status}`
        throw new Refusal("ORCA_OUTCOME_UNKNOWN", `${launched.error.message}\nthe launch of ${task.id} may or may not have started a worker; unknown is not dead. ${next}`)
    }

    const { started, runId } = launched
    recordSeat(db, seat.id, { status: started.state, handle: started.dispatchId, facts: { runId, orcaTask: started.taskId, terminal: started.terminal, effective: started.effective } })
    // Attest the launch from worker-show; an Orca that does not answer proves nothing about the worker, so it is only noted.
    const shown: WorkerShown | string = await workerShow(binary, started.dispatchId, cwd).catch((error: unknown) => messageOf(error))
    const effective = typeof shown === "string" ? started.effective : (shown.effective ?? started.effective)
    const attested = effectiveLaunch(effective)
    const requested = record.start
    const mismatch = (attested.model !== null && attested.model !== requested.model) || (attested.agent !== null && attested.agent !== requested.agent)
    const ours = stillOurs(db, task.id, attemptId)

    if (mismatch || !ours) {
        const closed = await closeWorker(binary, started.dispatchId, cwd)
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
                `requested ${requested.agent} ${requested.model}, Orca launched ${attested.agent ?? requested.agent} ${attested.model ?? "(model not named)"}; the worker was closed${closeNote(closed)}\nattempt ${attemptId} closed as model-mismatch; ${after}`,
            )
        }
        throw new Refusal("TASK_LEFT_DURING_LAUNCH", `task ${task.id} became ${getTask(db, task.id).status} while its worker was launching; the worker was closed${closeNote(closed)}`)
    }

    const seatRow = inTransaction(db, () => {
        db.prepare("UPDATE attempts SET agent = COALESCE(?, agent), model = COALESCE(?, model) WHERE id = ?").run(attested.agent, attested.model, attemptId)
        recordEvent(db, "attempt-attested", attemptId, { requested: { agent: requested.agent, model: requested.model, effort: requested.effort ?? null }, attested, attestation: typeof shown === "string" ? shown : "worker-show" })
        if (getTask(db, task.id).status === "effect_unknown") setStatus(db, task.id, "running")
        return typeof shown === "string"
            ? recordSeat(db, seat.id, { status: started.state, facts: { attestation: shown } })
            : recordSeat(db, seat.id, { status: shown.state ?? started.state, facts: { terminal: shown.terminal, effective: shown.effective } })
    })
    const data: SeatStartData = { ...base, seat: seatRow, dispatchId: started.dispatchId, effective, attested }
    const model = attested.model ?? `${requested.model} (not attested)`
    return { data, message: `seat ${seat.id} (${requested.agent} ${model}) runs task ${task.id} as dispatch ${started.dispatchId} in run ${runId}; brief ${at.files.brief}` }
}

/**
 * Launches one Orca worker on a queued task. The claim comes first, in one BEGIN IMMEDIATE transaction (queued -> running, a
 * new attempt, an open seat carrying the launch record), so two concurrent starts cannot both launch; only then is Orca called.
 */
export const startSeat = async (options: SeatStartOptions): Promise<VerbResult<SeatStartData>> => {
    const { root, cwd } = options
    const ops = loadOps()
    const db = openLedger(root)
    try {
        const task = getTask(db, options.task)
        if (task.status !== "queued") throw new Refusal("TASK_NOT_QUEUED", `task ${task.id} is ${task.status}; only a queued task gets a seat (an effect_unknown launch resumes with --resume)`)
        const binary = await locateOrca(cwd)
        if (options.dryRun === true) {
            const files = writeBrief(task, ops, root)
            const record = launchRecord(task, files, options, "dry-run")
            const shown: LaunchRecord = { ...record, runRequest: REQUEST_PLACEHOLDER, start: { ...record.start, retryRequest: REQUEST_PLACEHOLDER } }
            const argv = argvOf(binary, shown, options.run ?? null)
            const data: SeatStartData = { task: task.id, dryRun: true, resumed: false, brief: files.brief, contract: files.contract, orca: binary, argv, seat: null, attempt: null, runId: options.run ?? null, dispatchId: null, requestId: null, effective: null, attested: null }
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
            assertLeasesHeld(db, current)
            const running = setStatus(db, current.id, "running")
            const attempt = openAttempt(db, current.id, { agent: options.agent, model: options.model })
            renewLeases(db, current)
            const files = writeBrief(running, ops, root)
            const record = launchRecord(running, files, options, attempt.id)
            const seat = openSeat(db, { role: "worker", agent: options.agent, taskId: current.id, facts: { attempt: attempt.id, model: options.model, effort: options.effort ?? null, worktree: record.start.worktree, launch: record } })
            return { task: running, seat, record, files }
        })
        const launched = await launch(db, binary, claim.seat, claim.record, claim.record.run, cwd)
        return await settleLaunch({ db, binary, cwd, task: claim.task, seat: claim.seat, record: claim.record, files: claim.files, resumed: false }, launched)
    } finally {
        db.close()
    }
}

/** The statuses from which a launch may be resumed: unknown, or a running task whose launch process died before Orca answered. */
const RESUMABLE: readonly TaskStatus[] = ["effect_unknown", "running"]

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
                RESUMABLE.includes(task.status) &&
                seat !== undefined &&
                (seat.status === SEAT_LAUNCH_UNKNOWN || (seat.status === SEAT_STARTING && seat.handle === null)) &&
                (task.status === "effect_unknown" || seat.status === SEAT_STARTING)
            if (!resumable || attempt === undefined) throw new Refusal("SEAT_NOT_RESUMABLE", `task ${task.id} is ${task.status} with ${seat === undefined ? "no open seat" : `seat ${seat.id} ${seat.status}`}; only a launch whose outcome is unknown resumes`)
            const facts = seatFacts(db, seat.id)
            const parsed = launchRecordSchema.safeParse(facts.launch)
            if (!parsed.success || parsed.data.attempt !== attempt.id) throw new Refusal("SEAT_NOT_RESUMABLE", `seat ${seat.id} carries no launch record of attempt ${attempt.id}; it cannot be replayed`)
            assertLeasesHeld(db, task)
            renewLeases(db, task)
            recordEvent(db, "seat-resume", task.id, { seat: seat.id, attempt: attempt.id, request: parsed.data.start.retryRequest })
            const runId = typeof facts.runId === "string" ? facts.runId : parsed.data.run
            return { task, seat, record: parsed.data, runId }
        })
        const files = writeBrief(claim.task, loadOps(), root)
        const launched = await launch(db, binary, claim.seat, claim.record, claim.runId, cwd)
        return await settleLaunch({ db, binary, cwd, task: claim.task, seat: claim.seat, record: claim.record, files, resumed: true }, launched)
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

/** `starci seat start`: renders the worker brief of a queued task and launches one Orca worker on it; the task moves to running. */
export const seatStartVerb = defineVerb({
    path: ["seat", "start"],
    summary: "launch an Orca worker on a queued task with its rendered brief; --resume replays a launch whose outcome is unknown; --dry-run prints the orca argv",
    editions: ["full"],
    effect: "host",
    roles: ["owner", "kernel", "supervisor", "coordinator"],
    schema: "starci/seat-start@1",
    flags: {
        task: { kind: "string", summary: "the queued task id (or, with --resume, the effect_unknown one)", required: true, positional: true },
        agent: { kind: "string", summary: "required: the Orca agent id (claude, codex, ...); --resume reuses the recorded one" },
        model: { kind: "string", summary: "required: the provider model id; --resume reuses the recorded one" },
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
            if (given.length > 0 || flags["dry-run"]) throw new Refusal("CLI_USAGE", `--resume replays the recorded launch as it was; drop ${[...given.map((name) => `--${name}`), ...(flags["dry-run"] ? ["--dry-run"] : [])].join(", ")}`, EXIT_USAGE)
            return resumeSeat({ root, cwd: context.cwd, task: flags.task })
        }
        if (flags.agent === undefined || flags.model === undefined) throw new Refusal("CLI_USAGE", "seat start needs --agent and --model (or --resume)", EXIT_USAGE)
        return startSeat({ root, cwd: context.cwd, task: flags.task, agent: flags.agent, model: flags.model, effort: flags.effort, worktree: flags.worktree, run: flags.run, timeoutMs: parseTimeout(flags["timeout-ms"]), dryRun: flags["dry-run"] })
    },
})
