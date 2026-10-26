import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { pointerSpec, writeBrief } from "../../harness/brief.js"
import { now, openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { OrcaFailure, closeWorker, dispatchOfFailure, locateOrca, orcaArgv, runCreate, runCreateFlags, workerShow, workerStart, workerStartFlags } from "../../harness/orca/client.js"
import type { OrcaBinary, WorkerShown, WorkerStartInput, WorkerStarted } from "../../harness/orca/client.js"
import { SEAT_LAUNCH_FAILED, SEAT_LAUNCH_UNSETTLED, openSeat, recordSeat } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { getTask, openAttempt, recordEvent, setStatus } from "../../harness/tasks.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"

interface SeatStartData {
    readonly task: string
    readonly dryRun: boolean
    readonly brief: string
    readonly contract: string
    readonly orca: OrcaBinary
    readonly argv: { readonly runCreate: readonly string[] | null; readonly workerStart: readonly string[] }
    readonly seat: SeatRow | null
    readonly attempt: string | null
    readonly runId: string | null
    readonly dispatchId: string | null
    readonly effective: unknown
}

const TITLE_CHARS = 80

/** Stands in for the Run id in a dry run that would create its Run first. */
const RUN_PLACEHOLDER = "<result.run.id of run-create>"

/** Orca's worktree selectors; anything else is a filesystem path and becomes `path:<absolute path>`. */
const SELECTOR = /^(?:(?:identity|id|name|branch|issue|path):|(?:current|active|new-child|new-top-level)$)/

const clip = (text: string): string => (text.length <= TITLE_CHARS ? text : `${text.slice(0, TITLE_CHARS - 1)}…`)

const worktreeSelector = (value: string | undefined, cwd: string, root: string): string => {
    if (value !== undefined && SELECTOR.test(value)) return value
    return `path:${resolve(cwd, value ?? root).replace(/\\/g, "/")}`
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The attempt of a launch that never reached a worker ends here; a worker's own result is filed by `task result` instead.
const closeAttempt = (db: DatabaseSync, attemptId: string): void => {
    db.prepare("UPDATE attempts SET outcome = 'launch-failed', ended_at = ? WHERE id = ? AND outcome IS NULL").run(now(), attemptId)
}

/** `starci seat start`: renders the worker brief of a queued task and launches one Orca worker on it; the task moves to running. */
export const seatStartVerb = defineVerb({
    path: ["seat", "start"],
    summary: "launch an Orca worker on a queued task with its rendered brief; --dry-run prints the orca argv and the brief instead",
    editions: ["full"],
    effect: "host",
    roles: ["owner", "kernel", "coordinator"],
    schema: "starci/seat-start@1",
    flags: {
        task: { kind: "string", summary: "the queued task id", required: true, positional: true },
        agent: { kind: "string", summary: "the Orca agent id (claude, codex, ...)", required: true },
        model: { kind: "string", summary: "the provider model id", required: true },
        effort: { kind: "string", summary: "the reasoning effort of the model" },
        worktree: { kind: "string", summary: "where the worker runs: a path or an Orca worktree selector (default: this repository)" },
        run: { kind: "string", summary: "an existing Orca Run id (default: create a Run for this task)" },
        "dry-run": { kind: "boolean", summary: "write the brief and print the orca argv; launch nothing and leave the ledger as it is" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const ops = loadOps()
        const db = openLedger(root)
        try {
            const task = getTask(db, flags.task)
            if (task.status !== "queued") throw new Refusal("TASK_NOT_QUEUED", `task ${task.id} is ${task.status}; only a queued task gets a seat`)
            const binary = await locateOrca(context.cwd)
            const files = writeBrief(task, ops, root)
            const from = process.env.ORCA_TERMINAL_HANDLE
            const objective = clip(`StarCi task ${task.id}: ${task.contract.input.summary}`)
            const start: WorkerStartInput = {
                spec: pointerSpec(task.id, files),
                taskTitle: clip(`[Worker] ${task.id} ${task.contract.label}: ${task.contract.input.summary}`),
                worktree: worktreeSelector(flags.worktree, context.cwd, root),
                agent: flags.agent,
                model: flags.model,
                effort: flags.effort,
                run: flags.run,
                from,
            }
            const argv = {
                runCreate: flags.run === undefined ? [binary.path, ...orcaArgv("run-create", runCreateFlags({ objective, from }))] : null,
                workerStart: [binary.path, ...orcaArgv("worker-start", workerStartFlags({ ...start, run: flags.run ?? RUN_PLACEHOLDER }))],
            }
            const base = { task: task.id, brief: files.brief, contract: files.contract, orca: binary, argv }
            if (flags["dry-run"]) {
                const data: SeatStartData = { ...base, dryRun: true, seat: null, attempt: null, runId: flags.run ?? null, dispatchId: null, effective: null }
                const lines = [
                    "dry run: nothing launched, the ledger is unchanged",
                    `brief: ${files.brief}`,
                    ...(argv.runCreate === null ? [] : [`run-create argv: ${JSON.stringify(argv.runCreate)}`]),
                    `worker-start argv: ${JSON.stringify(argv.workerStart)}`,
                ]
                return { data, message: lines.join("\n") }
            }

            const attempt = openAttempt(db, task.id, { agent: flags.agent, model: flags.model })
            const seat = openSeat(db, { role: "worker", agent: flags.agent, taskId: task.id, facts: { attempt: attempt.id, model: flags.model, effort: flags.effort ?? null, worktree: start.worktree } })
            let runId: string | undefined = flags.run
            let started: WorkerStarted
            try {
                runId ??= await runCreate(binary, { objective, from }, context.cwd)
                started = await workerStart(binary, { ...start, run: runId }, context.cwd)
            } catch (error: unknown) {
                const dispatchId = error instanceof OrcaFailure ? dispatchOfFailure(error) : undefined
                const cleanup = dispatchId === undefined ? null : await closeWorker(binary, dispatchId, context.cwd)
                closeAttempt(db, attempt.id)
                // A start whose leftovers could not be released keeps its handle and an open status, so `seat stop` can finish it.
                recordSeat(db, seat.id, {
                    status: cleanup === null || cleanup.settled ? SEAT_LAUNCH_FAILED : SEAT_LAUNCH_UNSETTLED,
                    ...(dispatchId === undefined ? {} : { handle: dispatchId }),
                    facts: { error: messageOf(error), cleanup },
                })
                recordEvent(db, "seat-launch-failed", task.id, { seat: seat.id, attempt: attempt.id, runId: runId ?? null, cleanup })
                const refusal = asRefusal(error)
                const note = cleanup === null ? "" : `\ncleanup of ${cleanup.dispatchId}: stop ${cleanup.stop}, release ${cleanup.release}`
                throw new Refusal(refusal.code, `${refusal.message}${note}\ntask ${task.id} stays queued; attempt ${attempt.id} closed as launch-failed`)
            }
            recordSeat(db, seat.id, { status: started.state, handle: started.dispatchId, facts: { runId, orcaTask: started.taskId, terminal: started.terminal, effective: started.effective } })
            setStatus(db, task.id, "running")
            // Attest the launch from worker-show; an Orca that does not answer proves nothing about the worker, so it is only noted.
            const shown: WorkerShown | string = await workerShow(binary, started.dispatchId, context.cwd).catch((error: unknown) => messageOf(error))
            const unanswered = typeof shown === "string"
            const attested = unanswered
                ? recordSeat(db, seat.id, { status: started.state, facts: { attestation: shown } })
                : recordSeat(db, seat.id, { status: shown.state ?? started.state, facts: { terminal: shown.terminal, effective: shown.effective } })
            const effective = unanswered ? started.effective : (shown.effective ?? started.effective)
            const data: SeatStartData = { ...base, dryRun: false, seat: attested, attempt: attempt.id, runId, dispatchId: started.dispatchId, effective }
            return { data, message: `seat ${seat.id} (${flags.agent} ${flags.model}) runs task ${task.id} as dispatch ${started.dispatchId} in run ${runId}; brief ${files.brief}` }
        } finally {
            db.close()
        }
    },
})
