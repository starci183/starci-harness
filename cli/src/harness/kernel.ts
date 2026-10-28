import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { git, refExists } from "../shared/git.js"
import { coordinatorBrief } from "./coordinator-brief.js"
import { coordinatorLaunch } from "./coordinator-launch.js"
import { BLOCKED_PROMPT, escalateBlockedPrompt } from "./launch-failure.js"
import type { LaunchFailure } from "./launch-failure.js"
import { loadCoordinatorLiveness } from "./coordinator-liveness.js"
import { now, openLedger, projectDir } from "./ledger.js"
import { inTransaction } from "./leases.js"
import { awaitWorktree, closeWorker, dispatchOfFailure, isSelectorNotFound, LAUNCH_TIMEOUT_MS, OrcaFailure, repoAdd, repositoryOfSelector, requestIdOf, runCreate, runUse, taskCreate, terminalClose, terminalList, terminalOfFailure, terminalRename, workerShow, workerStart } from "./orca/client.js"
import type { OrcaBinary, WorkerClosed, WorkerStarted, WorkerStartInput } from "./orca/client.js"
import { describeRoute, pickCoordinator, RouteRefusal } from "./router.js"
import { loadRouting, selectsModel } from "./routing.js"
import { getSeat, kernelSeatOf, kernelSeatsOf, launchUnreconciled, noteTab, openKernelSeat, recordSeat, renewSeatLease, SEAT_LAUNCH_FAILED, SEAT_LAUNCH_UNKNOWN, SEAT_RELEASED, SEAT_STOPPED } from "./seats.js"
import type { SeatRow } from "./seats.js"
import { requireSupervisor } from "./supervisor.js"
import type { AttachedSupervisor } from "./supervisor.js"
import { recordEvent } from "./tasks.js"
import { projectOf } from "./work.js"
import { materialiseHooks } from "./worktree.js"
import { getWorkflow, recordKernel } from "./workflow.js"
import type { KernelRecord, WorkflowRow } from "./workflow.js"

/** The exact title of a workflow's Kernel seat and orchestration task. */
export const kernelTitle = (workflowId: string): string => `[Kernel] ${workflowId}`

const OP_TITLE_CHARS = 80

/** An Op seat's title: `[Op] <label> (<task id>) - <summary>`, clipped; the Kernel above it names the workflow. */
export const opTitle = (task: { readonly id: string; readonly contract: { readonly label: string; readonly input: { readonly summary: string } } }): string => {
    const title = `[Op] ${task.contract.label} (${task.id}) - ${task.contract.input.summary}`
    return title.length <= OP_TITLE_CHARS ? title : `${title.slice(0, OP_TITLE_CHARS - 1)}…`
}

/**
 * The coordinator `kernel start` (and so `workflow start`) records on a workflow: the Supervisor of the workflow's project
 * (`projectOf` its repository) owns it and sweeps its Kernel.
 */
export const SUPERVISOR_COORDINATOR = "supervisor"

/**
 * The coordinator of a workflow: its latest `workflow-coordinator` event, else the Supervisor when a Kernel seat of it exists
 * (only the Supervisor's startKernel opens one, so a workflow it launched before the event existed is still its own), else null.
 */
export const coordinatorOf = (db: DatabaseSync, workflowId: string): string | null => {
    const row = db.prepare("SELECT data_json FROM events WHERE kind = 'workflow-coordinator' AND subject = ? ORDER BY id DESC LIMIT 1").get(workflowId)
    const data: unknown = row === undefined ? null : JSON.parse(String(row.data_json))
    if (typeof data === "object" && data !== null && "coordinator" in data && typeof data.coordinator === "string") return data.coordinator
    return db.prepare("SELECT 1 FROM seats WHERE role = 'kernel' AND workflow_id = ? LIMIT 1").get(workflowId) === undefined ? null : SUPERVISOR_COORDINATOR
}

/**
 * The Kernel terminal a workflow records that no Kernel seat of it ever held: a terminal another session adopted as its Kernel
 * (the terminal model), not one the Supervisor launched. Null when there is none, or it is closed.
 */
export const foreignKernelTerminal = (db: DatabaseSync, workflow: WorkflowRow): string | null => {
    const { terminal, closedAt } = workflow.kernel
    if (terminal === null || closedAt !== null) return null
    return db.prepare("SELECT 1 FROM seats WHERE role = 'kernel' AND workflow_id = ? AND terminal = ?").get(workflow.id, terminal) === undefined ? terminal : null
}

/** The Kernel identity every Op launch supplies to Orca. */
export interface KernelLaunch {
    readonly terminal: string
    readonly runId: string
    readonly taskId: string
}

/** The attached child Run and task, or null while no Kernel is attached. */
export const launchableKernel = (workflow: WorkflowRow): KernelLaunch | null => {
    const { terminal, runId, taskId, closedAt } = workflow.kernel
    if (workflow.header.runner !== "orca" || closedAt !== null || terminal === null || runId === null || taskId === null) return null
    return { terminal, runId, taskId }
}

/** The recorded Kernel, its seat, and the actions a start or attach performed. */
export interface KernelEnsured {
    readonly kernel: KernelRecord
    readonly seat: SeatRow | null
    readonly worktree: string | null
    readonly notes: readonly string[]
}

const withRecord = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** The workflow's one worktree as recorded, if any (one workflow = one worktree, owner ruling). */
export const workflowWorktreeOf = (db: DatabaseSync, workflowId: string): string | undefined => {
    const row = db.prepare("SELECT worktree FROM workflows WHERE id = ?").get(workflowId)
    return row?.worktree === null || row?.worktree === undefined ? undefined : String(row.worktree)
}

/**
 * Creates (or reuses) the single git worktree an orca workflow runs in: the header's `worktree` when it names one, else
 * `<project state>/worktrees/<workflow>` on branch `starci/<workflow>`. Every Op, every verify and every relaunched Kernel or
 * retried attempt of the workflow uses it, so its code survives a crash. Recorded once; a recorded path is reused.
 */
export const ensureWorkflowWorktree = async (root: string, workflowId: string): Promise<string> => {
    const { workflow, known } = withRecord(root, (db) => ({ workflow: getWorkflow(db, workflowId), known: workflowWorktreeOf(db, workflowId) }))
    if (known !== undefined && existsSync(known)) return known
    const given = workflow.header.worktree
    const { path, branch, created } = given === undefined ? await harnessWorktree(root, workflowId) : namedWorktree(root, workflowId, given)
    withRecord(root, (db) => {
        db.prepare("UPDATE workflows SET worktree = ? WHERE id = ?").run(path, workflowId)
        recordEvent(db, "workflow-worktree", workflowId, { path, branch, created })
    })
    return path
}

/** Where a workflow's worktree is and how it came to be: the branch the harness made it on, whether this call created it. */
export interface WorktreeMade {
    readonly path: string
    readonly branch: string | null
    readonly created: boolean
}

/** The folder a workflow header's `worktree` names, which must exist; an Orca selector names none and is refused. */
const namedWorktree = (root: string, workflowId: string, given: string): WorktreeMade => {
    if (/^(?:(?:identity|id|name|branch|issue):|(?:current|active|new-child|new-top-level)$)/.test(given)) {
        throw new Refusal("WORKTREE_SELECTOR", `workflow ${workflowId} names the Orca selector ${given}; one workflow runs in one git worktree, so name a folder (or none, and the harness makes one)`)
    }
    const path = resolve(root, given.startsWith("path:") ? given.slice("path:".length) : given)
    if (!existsSync(path)) throw new Refusal("WORKTREE_MISSING", `workflow ${workflowId} names worktree ${given}, which does not exist`)
    return { path, branch: null, created: false }
}

/**
 * The harness's own worktree of a workflow or a Supervisor's `[Worker]`, `<project state>/worktrees/<name>` on branch
 * `starci/<name>`, added from HEAD when missing.
 */
export const harnessWorktree = async (root: string, name: string): Promise<WorktreeMade> => {
    const path = join(projectDir(root), "worktrees", name)
    const branch = `starci/${name}`
    if (existsSync(path)) return { path, branch, created: false }
    mkdirSync(dirname(path), { recursive: true })
    const args = (await refExists(root, `refs/heads/${branch}`)) ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]
    await git(root, args)
    await materialiseHooks(root, path)
    return { path, branch, created: true }
}

/** Requires an attached live Kernel before an Op launches into its Run; Ops never launch flat outside it. */
export const ensureKernel = async (root: string, cwd: string, workflowId: string, binary: OrcaBinary): Promise<KernelEnsured> => {
    const workflow = withRecord(root, (db) => getWorkflow(db, workflowId))
    if (workflow.header.runner !== "orca") return { kernel: workflow.kernel, seat: null, worktree: null, notes: [] }
    const kernel = launchableKernel(workflow)
    if (kernel === null) throw new Refusal("KERNEL_REQUIRED", `workflow ${workflowId} needs its Kernel agent; the Supervisor runs starci kernel start ${workflowId}`)
    const live = await terminalList(binary, cwd)
    if (!live.truncated && !live.handles.has(kernel.terminal)) throw new Refusal("KERNEL_REQUIRED", `workflow ${workflowId}'s Kernel terminal is gone; supervisor next relaunches it`)
    return { kernel: workflow.kernel, seat: null, worktree: null, notes: [] }
}

/**
 * How a Kernel start runs: `replace` fences a Kernel Orca still shows, `acting` is the attached Supervisor the host driver acts
 * for (else the caller must be its terminal).
 */
export interface KernelStartOptions {
    readonly replace?: boolean
    readonly acting?: AttachedSupervisor
}

const retiredStatus = (closed: WorkerClosed, current: string): string => {
    if (closed.settled) return SEAT_RELEASED
    return closed.stopped ? SEAT_STOPPED : current
}

/**
 * Retires a Kernel seat that is still open before a start launches another: refused while its launch is not reconciled (no
 * dispatch, or its outcome unknown: the Supervisor's sweep resolves it) and while Orca shows it alive (unless `replace`), else
 * stopped, released and its tab closed. A seat Orca does not settle refuses the start, so a workflow never holds two open
 * Kernel seats; a repeated start finishes the release.
 */
const retireOpenSeat = async (root: string, cwd: string, seat: SeatRow, binary: OrcaBinary, replace: boolean): Promise<string> => {
    if (seat.handle === null || launchUnreconciled(seat)) throw new Refusal("KERNEL_STARTING", `Kernel seat ${seat.id} has a launch whose outcome is not known yet (request ${seat.requestId ?? "-"}); supervisor next resolves it through Orca`)
    if (!replace) {
        const shown = await workerShow(binary, seat.handle, cwd).catch(() => null)
        const gone = shown !== null && ["exited", "failed", "stopped", "released", "abandoned"].some((state) => state === shown.state || state === shown.observed)
        if (!gone) throw new Refusal("KERNEL_RUNNING", `Kernel seat ${seat.id} (dispatch ${seat.handle}) is not reported gone by Orca; unknown is not dead`)
    }
    const closed = await closeWorker(binary, seat.handle, cwd, seat.terminal)
    withRecord(root, (db) => {
        noteTab(db, seat.id, closed)
        recordSeat(db, seat.id, { status: retiredStatus(closed, seat.status), facts: { closed } })
    })
    if (!closed.settled) throw new Refusal("KERNEL_RELEASE_PENDING", `the previous Kernel dispatch ${seat.handle} is not released: ${closed.stop}; ${closed.release}; the next start finishes it`)
    return `retired the previous Kernel seat ${seat.id} (dispatch ${seat.handle}, tab ${closed.tab})`
}

/**
 * Launches the routed Kernel agent as a child dispatch in the Run of its project's Supervisor (worker-start --run/--parent/--from,
 * title `[Kernel] <workflow>`) inside the workflow's one worktree; only that Supervisor's own terminal, or the host driver acting
 * for it, may call it. A seat row is reserved first with the attempt's request id, so an unknown launch is resolved through Orca and
 * never launched twice. `replace` fences a Kernel Orca still shows (idle past its TTL, or given up by the stall ladder).
 */
export const startKernel = async (root: string, cwd: string, workflowId: string, binary: OrcaBinary, options: KernelStartOptions = {}): Promise<KernelEnsured> => {
    const supervisor = await requireSupervisor(binary, cwd, await projectOf(root), options.acting)
    const workflow = withRecord(root, (db) => getWorkflow(db, workflowId))
    if (workflow.header.runner !== "orca") throw new Refusal("KERNEL_INLINE", "an inline workflow has no Orca Kernel seat: the chat agent is its Kernel")
    if (!["running", "blocked", "paused"].includes(workflow.status)) throw new Refusal("KERNEL_NOT_RUNNING", `workflow ${workflowId} is ${workflow.status}; start a defined workflow with starci workflow start`)
    const notes: string[] = []
    const foreign = withRecord(root, (db) => foreignKernelTerminal(db, workflow))
    if (foreign !== null) {
        const live = await terminalList(binary, cwd).catch(() => null)
        if (live === null || live.truncated || live.handles.has(foreign)) {
            throw new Refusal("KERNEL_FOREIGN", `workflow ${workflowId} is driven from terminal ${foreign}, which another session adopted as its Kernel and Orca does not report gone; let that session finish or close its terminal first`)
        }
    }
    // The newest open seat is judged by `replace`; an older one still open beside it is a second Kernel and is retired outright.
    const open = withRecord(root, (db) => kernelSeatsOf(db, workflowId))
    for (const [index, seat] of open.entries()) notes.push(await retireOpenSeat(root, cwd, seat, binary, options.replace === true || index > 0))
    if (workflow.kernel.terminal !== null && workflow.kernel.owned && workflow.kernel.closedAt === null && open.length === 0) await terminalClose(binary, workflow.kernel.terminal, cwd).catch(() => "gone")
    const worktree = await ensureWorkflowWorktree(root, workflowId)
    const pick = pickCoordinator("kernel")
    if (pick instanceof RouteRefusal) throw new Refusal(pick.code, describeRoute(pick).join("; "))
    const launchId = `k-${randomUUID().slice(0, 8)}`
    const spec = coordinatorBrief({ role: "kernel", root, workflowId, launchId, agent: pick.agent, model: pick.model, worktree })
    const input: WorkerStartInput = {
        spec,
        taskTitle: kernelTitle(workflowId),
        worktree: `path:${worktree.replaceAll("\\", "/")}`,
        agent: pick.agent,
        ...(selectsModel(loadRouting(), pick.agent) ? { model: pick.model, effort: pick.effort } : {}),
        run: supervisor.run_id,
        parent: supervisor.task_id,
        from: supervisor.terminal,
        timeoutMs: LAUNCH_TIMEOUT_MS,
        retryRequest: requestIdOf("kernel-worker-start", launchId),
    }
    withRecord(root, (db) => { inTransaction(db, () => {
            // Every seat this start found is retired by now, so any open seat is another start's reservation.
            if (kernelSeatOf(db, workflowId) !== undefined) throw new Refusal("KERNEL_MOVED", "another Kernel start reserved this workflow meanwhile; inspect starci seat list")
            openKernelSeat(db, { id: launchId, workflowId, agent: pick.agent, model: pick.model, requestId: input.retryRequest, launch: input })
            recordKernel(db, workflowId, { terminal: null, owned: true, closedAt: null })
            if (coordinatorOf(db, workflowId) !== SUPERVISOR_COORDINATOR) recordEvent(db, "workflow-coordinator", workflowId, { coordinator: SUPERVISOR_COORDINATOR, seat: launchId })
        }); },
    )
    await launchKernelSeat(root, cwd, launchId, input, binary)
    notes.push(`launched ${kernelTitle(workflowId)} as ${pick.agent}/${pick.model} in ${worktree}; its first command is starci kernel attach`)
    const seat = withRecord(root, (db) => getSeat(db, launchId))
    return { kernel: withRecord(root, (db) => getWorkflow(db, workflowId).kernel), seat, worktree, notes }
}

/**
 * Sends (or replays, under the same request id) a reserved Kernel seat's worker-start and records what Orca answered: a ready
 * worker's dispatch and terminal, else the seat closed launch-failed (a typed refusal) or kept launch-unknown with the dispatch and
 * agent terminal the failed receipt names, which the Supervisor's sweep reconciles (`supervisor/driver.ts` resolveKernelLaunch).
 */
export const launchKernelSeat = async (root: string, cwd: string, seatId: string, input: WorkerStartInput, binary: OrcaBinary): Promise<SeatRow> => {
    const explained: { failure?: LaunchFailure } = {}
    try {
        const start = async (): Promise<WorkerStarted> => {
            try {
                return await workerStart(binary, input, cwd)
            } catch (error: unknown) {
                if (!isSelectorNotFound(error)) throw error
                await repoAdd(binary, await repositoryOfSelector(input.worktree, root), cwd)
                await awaitWorktree(binary, input.worktree, cwd)
                return workerStart(binary, input, cwd)
            }
        }
        const started = await coordinatorLaunch({ agent: input.agent, pool: input.agent }, start, { binary, cwd, explained: (failure) => (explained.failure = failure) })
        const seat = withRecord(root, (db) => recordSeat(db, seatId, { status: started.state, handle: started.dispatchId, terminal: started.terminal, ...(started.runId === null ? {} : { runId: started.runId }) }))
        if (started.terminal !== null) await terminalRename(binary, started.terminal, kernelTitle(seat.workflowId ?? ""), cwd)
        return seat
    } catch (error: unknown) {
        const status = error instanceof OrcaFailure && error.effect === "none" ? SEAT_LAUNCH_FAILED : SEAT_LAUNCH_UNKNOWN
        const { failure } = explained
        const dispatchId = error instanceof OrcaFailure ? dispatchOfFailure(error) : undefined
        const terminal = error instanceof OrcaFailure ? (terminalOfFailure(error) ?? null) : null
        withRecord(root, (db) => {
            const seat = recordSeat(db, seatId, { status, ...(dispatchId === undefined ? {} : { handle: dispatchId }), terminal, ...(failure === undefined ? {} : { failure }), facts: { error: error instanceof Error ? error.message : String(error) } })
            if (failure?.kind === BLOCKED_PROMPT && seat.workflowId !== null) {
                escalateBlockedPrompt(db, { project: root, workflowId: seat.workflowId, seat: seatId, worktree: input.worktree.replace(/^path:/, ""), failure })
            }
        })
        throw error
    }
}

/**
 * `kernel attach`: adopts the dispatched agent's own terminal (ORCA_TERMINAL_HANDLE) as the coordinator of the workflow's
 * child Run (taken back with run-use after a relaunch, else created) and its `[Kernel] <workflow>` task, with stable replay ids.
 */
export const attachKernel = async (root: string, cwd: string, workflowId: string, launchId: string, binary: OrcaBinary): Promise<KernelEnsured> => {
    const workflow = withRecord(root, (db) => getWorkflow(db, workflowId))
    const terminal = process.env.ORCA_TERMINAL_HANDLE
    const seat = withRecord(root, (db) => kernelSeatOf(db, workflowId))
    if (workflow.header.runner !== "orca" || seat?.id !== launchId || terminal === undefined || terminal === "" || (seat.terminal !== null && seat.terminal !== terminal)) {
        throw new Refusal("KERNEL_ATTACH_REFUSED", "attach runs in the reserved Kernel agent terminal with its launch id (the brief names both)")
    }
    if (!["running", "blocked", "paused"].includes(workflow.status)) throw new Refusal("KERNEL_NOT_RUNNING", `workflow ${workflowId} is ${workflow.status}`)
    let kernel = withRecord(root, (db) => {
        db.prepare("UPDATE seats SET terminal = COALESCE(terminal, ?) WHERE id = ?").run(terminal, seat.id)
        renewSeatLease(db, seat.id, loadCoordinatorLiveness().seatLeaseMinutes)
        return recordKernel(db, workflowId, { terminal, owned: true, closedAt: null }).kernel
    })
    await terminalRename(binary, terminal, kernelTitle(workflowId), cwd)
    if (kernel.runId !== null) {
        try {
            await runUse(binary, { id: kernel.runId, from: terminal }, cwd)
        } catch (error: unknown) {
            if (!(error instanceof OrcaFailure) || error.effect !== "none") throw error
            kernel = withRecord(root, (db) => recordKernel(db, workflowId, { runId: null, taskId: null }).kernel)
        }
    }
    if (kernel.runId === null) {
        const runId = await runCreate(binary, { objective: `StarCi workflow ${workflowId}: ${workflow.header.goal}`, from: terminal, retryRequest: requestIdOf("kernel-run-create", `${workflowId}\0${launchId}`) }, cwd)
        kernel = withRecord(root, (db) => recordKernel(db, workflowId, { runId, taskId: null }).kernel)
    }
    if (kernel.taskId === null && kernel.runId !== null) {
        const taskId = await taskCreate(binary, { spec: `StarCi Kernel of workflow ${workflowId}; the ledger is state and every Op belongs under this task.`, taskTitle: kernelTitle(workflowId), run: kernel.runId, from: terminal, retryRequest: requestIdOf("kernel-task-create", `${workflowId}\0${kernel.runId}`) }, cwd)
        kernel = withRecord(root, (db) => recordKernel(db, workflowId, { taskId }).kernel)
    }
    const worktree = withRecord(root, (db) => workflowWorktreeOf(db, workflowId)) ?? null
    return { kernel, seat: withRecord(root, (db) => getSeat(db, launchId)), worktree, notes: [`attached ${kernelTitle(workflowId)} to ${terminal}, Run ${kernel.runId ?? "-"}`] }
}

/** A self-stop keeps the terminal long enough to send its handoff; its Supervisor completes the close. */
export type KernelClosing = "closed" | "gone" | "kept-adopted" | "awaiting-handoff" | "none" | `error: ${string}`

/** Closes a Kernel seat's dispatch and its tab: settled, the seat is released and the tab's end returned; unsettled, the error. */
const closeKernelDispatch = async (root: string, cwd: string, binary: OrcaBinary, seat: SeatRow, handle: string, terminal: string | null): Promise<KernelClosing> => {
    const closed = await closeWorker(binary, handle, cwd, seat.terminal ?? terminal)
    if (!closed.settled) return `error: ${closed.release}; ${closed.tab}`
    withRecord(root, (db) => recordSeat(db, seat.id, { status: SEAT_RELEASED, facts: { closed } }))
    return closed.tab === "closed" || closed.tab === "gone" ? closed.tab : "gone"
}

/** Releases a Kernel dispatch after its Ops, then closes its terminal; a repeated stop finishes a partial release. */
export const closeKernel = async (root: string, cwd: string, workflowId: string, binary: OrcaBinary): Promise<KernelClosing> => {
    const { kernel, seat } = withRecord(root, (db) => ({ kernel: getWorkflow(db, workflowId).kernel, seat: kernelSeatOf(db, workflowId) }))
    if ((kernel.terminal === null && seat === undefined) || kernel.closedAt !== null) return "none"
    if (process.env.ORCA_TERMINAL_HANDLE !== undefined && process.env.ORCA_TERMINAL_HANDLE === kernel.terminal) return "awaiting-handoff"
    let outcome: KernelClosing = "kept-adopted"
    if (seat?.handle != null) outcome = await closeKernelDispatch(root, cwd, binary, seat, seat.handle, kernel.terminal)
    else if (kernel.owned && kernel.terminal !== null) outcome = await terminalClose(binary, kernel.terminal, cwd).catch((error: unknown): KernelClosing => `error: ${error instanceof Error ? error.message : String(error)}`)
    withRecord(root, (db) => {
        if (outcome.startsWith("error: ")) recordEvent(db, "workflow-kernel-close-failed", workflowId, { terminal: kernel.terminal, outcome })
        else recordKernel(db, workflowId, { closedAt: now() })
    })
    return outcome
}
