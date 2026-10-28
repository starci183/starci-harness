import { worktreeGc } from "../../harness/worktree-gc.js"
import { reconcileLineage } from "../../harness/orca/lineage.js"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { admitCommand, answerDecision, awaitsOwner, defaultRuling, finishCommand, getDecision, goalVersionOf, ledgerAnswers, openDecisions, raiseDecision, readCommand } from "../../harness/coordinator-commands.js"
import type { Command, Decision, KernelDecisionKind, SupervisorDecisionKind } from "../../harness/coordinator-commands.js"
import { loadCoordinatorLiveness, olderThan } from "../../harness/coordinator-liveness.js"
import type { CoordinatorLiveness } from "../../harness/coordinator-liveness.js"
import { GOAL_CHANGE_SCHEMA, recordGoalChange } from "../../harness/goal.js"
import type { GoalChange } from "../../harness/goal.js"
import { coordinatorOf, foreignKernelTerminal, launchKernelSeat, startKernel, SUPERVISOR_COORDINATOR } from "../../harness/kernel.js"
import type { NodeState } from "../../harness/graph.js"
import { deadOnArrivalFailure, openBlockedPrompts, resubmitPendingComposer } from "../../harness/launch-failure.js"
import { loadRouting } from "../../harness/routing.js"
import { inTransaction, ledgerPath, now, openLedger } from "../../harness/ledger.js"
import { judgeStart, loadLiveness } from "../../harness/liveness.js"
import { readMachine, recordTerminalList, withMachine } from "../../harness/machine.js"
import { reconcileStaleLaunches } from "../../harness/stale-launch.js"
import { recordSeatOutcome } from "../../harness/outcomes.js"
import { assertOwnerRequests, closeOwnerRequests, isOwnerRequestId, openOwnerRequests, ownerRequestProjects } from "../../harness/owner-requests.js"
import type { OwnerRequest } from "../../harness/owner-requests.js"
import { closeWorker, locateOrca, mailCheck, mailSend, requestIdOf, requestShow, terminalList, terminalSend, UNKNOWN_STATES, workerShow } from "../../harness/orca/client.js"
import type { OrcaBinary, TerminalInventory, WorkerStartInput } from "../../harness/orca/client.js"
import { holdTerminal, kernelSeatOf, launchUnreconciled, noteTab, recordSeat, SEAT_LAUNCH_FAILED } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { askIdle, claimNudge, coordinatorStallEscalates, loadStallRules, nudgesOf, promptOf, repeatedStallQuestion, reportStalled, sendNudge, STALL_GAVE_UP, STALL_NUDGED, stallKindOf, stallStep } from "../../harness/stall.js"
import { ensureSupervisor, hostSupervisors, inSupervisorTerminal, isAttached, keptProjects, liveSupervisors, projectOfRecord, renewSupervisorLease, retireHostSupervisor, startSupervisor, stopSupervisor, supervisorRecord, supervisorTitle } from "../../harness/supervisor.js"
import type { AttachedSupervisor, SupervisorEnsured } from "../../harness/supervisor.js"
import { sweepTerminals } from "../../harness/terminal-sweep.js"
import type { SweptTerminal } from "../../harness/terminal-sweep.js"
import { projectRepositories, registeredRepositories, slotsOfRepository } from "../../harness/project-workers.js"
import { recordEvent } from "../../harness/tasks.js"
import { ticketEscalation } from "../../harness/tickets.js"
import { projectOf } from "../../harness/work.js"
import type { Project } from "../../harness/work.js"
import { DISPATCHING, getWorkflow, listWorkflows, setWorkflowStatus, snapshotOf } from "../../harness/workflow.js"
import type { WorkflowRow } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import type { VerbContext } from "../../shared/verb.js"
import { settleWorkflow } from "../workflow/engine.js"
import { inOrder } from "../../harness/sequential.js"
import { digestOf, RELAUNCH_LIMIT, sweepOpBudgets, sweepOpStalls } from "../kernel/driver.js"
import type { Digest } from "../kernel/driver.js"
import { workflowStopVerb } from "../workflow/stop.js"
import { nextWorkerEvent, tendWorkers } from "./workers.js"
import { applyNeedOwner } from "../needs/answer.js"
import type { WorkerView } from "./workers.js"

/** A Supervisor decision with the project it lives in. */
export interface SupervisorDecision extends Decision {
    readonly project: string
}

/** What `supervisor next` returns: one decision (escalation, handoff or shared-need) with its workflow digest, one worker's completion, one owner request, or idle. */
export interface SupervisorNext {
    readonly kind: "escalation" | "handoff" | "shared-need" | "worker" | "owner-request" | "idle"
    readonly decision: SupervisorDecision | null
    readonly digest: Digest | null
    readonly worker: WorkerView | null
    readonly request: OwnerRequest | null
    readonly actions: readonly string[]
}

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

const sleep = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** A project given by `--project <path>`, else the project of the working directory. */
export const projectFrom = async (context: VerbContext, project: string | undefined, mint = true): Promise<Project> => projectOf(project === undefined ? context.cwd : resolve(context.cwd, project), mint)

const isCoordinated = (workflow: WorkflowRow): boolean =>
    workflow.header.runner === "orca" && ["running", "blocked", "paused"].includes(workflow.status) && workflow.reason?.startsWith(RELAUNCH_LIMIT) !== true

/** The event `supervisor next` records when it hands its Supervisor a decision awaiting the owner or Debug, which it hands over once. */
const DECISION_RELAYED = "decision-relayed"

/** True when the Supervisor was already handed this decision awaiting the owner or Debug. */
const relayed = (decision: SupervisorDecision): boolean =>
    withLedger(decision.project, (db) => db.prepare(`SELECT 1 FROM events WHERE kind = '${DECISION_RELAYED}' AND subject = ? AND json_extract(data_json, '$.id') = ?`).get(decision.workflowId, decision.id) !== undefined)

/** The event the tick records when it wakes, or gives up, a Kernel whose workflow has ready work and no live Op (`readyIdle`). */
const READY_IDLE_WOKEN = "ready-idle-woken"

/** The events the drivers record about a seat rather than the work: relaunching a Kernel, nudging, waking or giving up a stalled seat, or handing the Supervisor a decision, is not progress. */
const NOT_PROGRESS: readonly string[] = ["kernel-relaunched", "workflow-coordinator", "workflow-worktree", "workflow-kernel", STALL_NUDGED, STALL_GAVE_UP, DECISION_RELAYED, READY_IDLE_WOKEN]

/** The last time a workflow's work moved (its own events and its tasks', but none a driver records about a seat), the Kernel's progress clock. */
const lastProgress = (db: DatabaseSync, workflowId: string): string | null => {
    const row = db
        .prepare(`SELECT MAX(at) AS at FROM events WHERE (subject = ? OR subject IN (SELECT id FROM tasks WHERE workflow_id = ?)) AND kind NOT IN (${NOT_PROGRESS.map(() => "?").join(", ")})`)
        .get(workflowId, workflowId, ...NOT_PROGRESS)
    return row?.at === null || row?.at === undefined ? null : String(row.at)
}

/** What one Kernel sweep acts with: the repository, Orca, the caller's folder, the liveness rules and the Supervisor acting. */
interface SweepScope {
    readonly root: string
    readonly binary: OrcaBinary
    readonly cwd: string
    readonly rules: CoordinatorLiveness
    readonly acting: AttachedSupervisor
}

/** Why a Kernel needs a relaunch, from Orca's word only; null while it is alive, unknown or still making progress. */
const relaunchReason = async (binary: OrcaBinary, cwd: string, seat: SeatRow | undefined, progress: string | null, rules: CoordinatorLiveness): Promise<{ readonly why: string; readonly replace: boolean } | null> => {
    if (seat === undefined) return { why: "no open Kernel seat", replace: false }
    if (seat.handle === null) return null
    const leaseLapsed = seat.leaseUntil === null || seat.leaseUntil < now()
    if (!leaseLapsed || !olderThan(progress, rules.kernelTtlMinutes)) return null
    const gone = loadLiveness()
    try {
        const shown = await workerShow(binary, seat.handle, cwd)
        const state = [shown.state, shown.observed].find((value): value is string => value !== null && gone.goneStates.includes(value))
        if (state !== undefined) return { why: `Orca says the Kernel worker is ${state}`, replace: false }
        if (shown.lastOutputAt !== null && olderThan(shown.lastOutputAt, rules.kernelTtlMinutes)) return { why: `Orca reports the Kernel idle since ${shown.lastOutputAt}, past ${String(rules.kernelTtlMinutes)} min with no progress`, replace: true }
        return null
    } catch (error: unknown) {
        const code = asRefusal(error)
        return code instanceof Refusal && "orcaCode" in code && gone.goneErrors.includes(String(code.orcaCode)) ? { why: `Orca answers ${String(code.orcaCode)}`, replace: false } : null
    }
}

/**
 * Reconciles a Kernel launch Orca never confirmed (`launchUnreconciled`: still in launch, or its outcome unknown) through Orca.
 * Its dispatch is the one the seat recorded (a failed worker-start's receipt names it), else the one request-show's receipt
 * names, and is judged (`judgeKernelDispatch`). A completed request whose receipt names no dispatch is replayed under the same
 * request id, so Orca answers the dispatch it made, never a second one; a pending one waits; one Orca does not know past
 * effectUnknownDeadlineMinutes is an escalation. No second Kernel is launched while this one may be alive.
 */
const resolveKernelLaunch = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow, live: TerminalInventory | null): Promise<string | null> => {
    const { root, binary, cwd, rules } = scope
    if (seat.handle !== null) return judgeKernelDispatch(scope, workflow, seat, seat.handle, live)
    if (seat.requestId === null) return null
    const shownRequest = await requestShow(binary, seat.requestId, cwd).catch(() => null)
    const state = shownRequest?.state ?? "unknown"
    if (state === "completed" && shownRequest?.dispatchId != null) return judgeKernelDispatch(scope, workflow, seat, shownRequest.dispatchId, live)
    if (state === "completed") {
        await launchKernelSeat(root, cwd, seat.id, seat.launch as WorkerStartInput, binary)
        return `${workflow.id}: replayed the Kernel launch (request ${seat.requestId} completed, no dispatch yet)`
    }
    if (state !== "pending" && olderThan(seat.startedAt, rules.effectUnknownDeadlineMinutes)) {
        withLedger(root, (db) => raiseDecision(db, { scope: "supervisor", workflowId: workflow.id, kind: "escalation", subject: `stuck-launch:${seat.id}`, evidence: { project: root, escalation: { kind: "harness", question: `the Kernel launch ${seat.id} is unknown to Orca (request-show ${state}) past the deadline; check Orca, then seat stop it and kernel start` } } }))
        return `${workflow.id}: Kernel launch ${seat.id} stuck (${state})`
    }
    return null
}

/**
 * Whether a Kernel came alive by its own word: its `kernel attach` (or a later driver call) renewed the seat's lease from the
 * dispatch's own terminal, which Orca does not report gone. Orca may keep such a worker at start_unknown for good, since the
 * agent's turn start went unobserved and the Kernel reports to the ledger, not to its dispatch.
 */
const attachedKernel = (seat: SeatRow, dispatchTerminal: string | null, live: TerminalInventory | null): boolean =>
    seat.leaseUntil !== null &&
    seat.terminal !== null &&
    (dispatchTerminal === null || dispatchTerminal === seat.terminal) &&
    (live === null || live.truncated || live.handles.has(seat.terminal))

/**
 * A Kernel launch's dispatch, judged by `judgeStart` (harness/liveness.ts) with the Kernel's attach as its own proof of life,
 * since Orca keeps a worker whose turn start it could not observe at start_unknown even once the agent runs. `started` is
 * reconciled on the seat (its dispatch, terminal and Orca's state, `ready` for a start Orca never observed; the stall ladder
 * judges it from then on). While it waits, a dispatch left pasted in the agent's composer is submitted again
 * (`resubmitPendingComposer`). `quiet` (a live terminal that printed nothing since the launch) is never fenced: it is waited on and,
 * past effectUnknownDeadlineMinutes, escalated to the Supervisor. `gone` and `dead` are fenced, closed launch-failed and
 * relaunched once on the coordinator tier's order, and only once the fence held: nothing is launched beside a live dispatch.
 */
const judgeKernelDispatch = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow, dispatchId: string, live: TerminalInventory | null): Promise<string | null> => {
    const { root, binary, cwd, rules, acting } = scope
    const stall = loadStallRules()
    const shown = await workerShow(binary, dispatchId, cwd).catch(() => null)
    const attached = shown !== null && attachedKernel(seat, shown.terminal, live)
    const { verdict, states, terminal, printed } = judgeStart({ shown, seat, live, alive: attached }, stall)
    const said = states.join("/") || "unknown"
    if (verdict === "waiting" || verdict === "quiet") withLedger(root, (db) => { holdTerminal(db, seat, terminal); })
    if (shown === null) return null
    // The paste itself prints, so an unattached Kernel whose dispatch sits in its composer reads as started too.
    if (verdict === "waiting" || verdict === "quiet" || (verdict === "started" && !attached)) {
        const resubmitted = await resubmitPendingComposer(binary, cwd, root, { id: seat.id, terminal }, loadRouting())
        if (resubmitted !== null) return `${workflow.id}: Kernel launch ${seat.id} ${resubmitted}`
    }
    if (verdict === "waiting") return null
    if (verdict === "started") {
        const status = shown.state === null || stall.startUnknownStates.includes(shown.state) || UNKNOWN_STATES.includes(shown.state) ? "ready" : shown.state
        withLedger(root, (db) => { recordSeat(db, seat.id, { status, handle: dispatchId, ...(terminal === null ? {} : { terminal }), facts: { adopted: { dispatchId, states, attached, printed } } }); })
        return `${workflow.id}: Kernel launch ${seat.id} reconciled (dispatch ${dispatchId} is ${said}${attached ? ", attached" : `, last printed ${printed ?? "-"}`})`
    }
    if (verdict === "quiet") {
        if (!olderThan(seat.startedAt, rules.effectUnknownDeadlineMinutes)) return `${workflow.id}: Kernel launch ${seat.id} is ${said} with its terminal ${terminal ?? "-"} listed and quiet: waiting, never fenced while it lives`
        withLedger(root, (db) => raiseDecision(db, { scope: "supervisor", workflowId: workflow.id, kind: "escalation", subject: `stuck-launch:${seat.id}`, evidence: { project: root, escalation: { kind: "harness", question: `the Kernel launch ${seat.id} (dispatch ${dispatchId}) is ${said} and its terminal ${terminal ?? "-"} is alive but printed nothing since the launch; look at that terminal, then seat stop it and kernel start, or let it attach` } } }))
        return `${workflow.id}: Kernel launch ${seat.id} quiet in a live terminal past the deadline: escalated, not fenced`
    }
    const closed = await closeWorker(binary, dispatchId, cwd, terminal)
    if (!closed.stopped) {
        withLedger(root, (db) => { recordSeat(db, seat.id, { status: seat.status, handle: dispatchId, facts: { notFenced: { verdict, states, closed } } }); })
        return `${workflow.id}: Kernel launch ${seat.id} ${verdict} (${said}) but Orca did not fence dispatch ${dispatchId} (${closed.stop}): no second Kernel until it does`
    }
    const failure = deadOnArrivalFailure(stallKindOf(shown.failureText), states, shown.failureText, terminal)
    withLedger(root, (db) => {
        noteTab(db, seat.id, closed)
        recordSeat(db, seat.id, { status: SEAT_LAUNCH_FAILED, handle: dispatchId, failure, facts: { deadOnArrival: { verdict, states, failure: shown.failureText }, closed } })
    })
    return relaunch(root, binary, cwd, workflow, `Kernel launch ${seat.id} ${verdict === "gone" ? "is gone" : "never started"} (${said})`, { replace: false, acting }, rules)
}

/**
 * Relaunches a Kernel, or, once kernelRelaunchMax relaunches came with no progress since the first of them, pauses its workflow
 * and escalates to the owner instead: a Kernel that dies at every launch stops being relaunched however far apart they fall.
 */
const relaunch = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, why: string, options: { readonly replace: boolean; readonly acting: AttachedSupervisor }, rules: CoordinatorLiveness): Promise<string> => {
    const limited = withLedger(root, (db) =>
        inTransaction(db, () => {
            const since = lastProgress(db, workflow.id) ?? ""
            const recent = db.prepare("SELECT id FROM events WHERE kind = 'kernel-relaunched' AND subject = ? AND at > ? ORDER BY id DESC").all(workflow.id, since)
            if (recent.length < rules.kernelRelaunchMax) return null
            if (DISPATCHING.includes(getWorkflow(db, workflow.id).status) || getWorkflow(db, workflow.id).status === "paused") setWorkflowStatus(db, workflow.id, "paused", `${RELAUNCH_LIMIT}: ${String(recent.length)} relaunches with no progress`)
            return raiseDecision(db, { scope: "supervisor", workflowId: workflow.id, kind: "escalation", subject: `relaunch-limit:${String(recent[0]?.id)}`, evidence: { project: root, escalation: { kind: "owner", question: `the Kernel of ${workflow.id} was relaunched ${String(recent.length)} times with no progress since ${since === "" ? "it started" : since} (last: ${why}); the workflow is paused. Ask the owner, then workflow resume and kernel start.` } } })
        }),
    )
    if (limited !== null) return `${workflow.id}: relaunch limit reached, paused and escalated (${limited})`
    const started = await startKernel(root, cwd, workflow.id, binary, { replace: options.replace, acting: options.acting })
    const member = started.seat === null ? "-" : `${started.seat.agent ?? "?"}/${started.seat.model ?? "?"}`
    withLedger(root, (db) => { recordEvent(db, "kernel-relaunched", workflow.id, { why, seat: started.seat?.id ?? null, member }); })
    return `${workflow.id}: relaunched its Kernel as ${member} (${why}) in ${started.worktree ?? "-"}`
}

/** The node states a Kernel's driver acts on: a Kernel idle at its prompt while one of them stands has work pending. */
const ACTIONABLE: ReadonlySet<NodeState> = new Set<NodeState>(["ready", "queued", "reported", "returned", "failed", "lost", "launch-unknown"])

/** A workflow whose Kernel has work pending: an open decision, or a node its driver acts on. */
const kernelPending = (db: DatabaseSync, workflowId: string): boolean => openDecisions(db, "kernel", workflowId).length > 0 || snapshotOf(db, workflowId).views.some((view) => ACTIONABLE.has(view.state))

/** A coordinator's last driver call: its lease's renewal (every attach, next and submit), else its launch. */
/** The ledger file a project's outcomes are keyed by. */
const ledgerFileOf = (root: string): string => ledgerPath(root) ?? root

const lastCallOf = (leaseUntil: string | null, leaseMinutes: number, startedAt: string): string => (leaseUntil === null ? startedAt : new Date(Date.parse(leaseUntil) - leaseMinutes * 60_000).toISOString())

/**
 * The stall ladder of one Kernel seat that is alive by Orca's word: idle at its prompt (stall rules) with work pending and no
 * driver call for stall.idleMinutes, it is nudged with its loop prompt; a nudge unanswered past nudgeGraceMinutes, or a stall
 * after nudgeMax nudges, gives it up: its member records a `stalled` outcome (seat evidence and the provider circuit, by the
 * kind Orca's failure words name, else `stall`), and the Kernel is relaunched on the coordinator tier's listed order (another
 * member only while the circuit or quota takes the first out); repeated plain stalls also escalate kind harness to the
 * Supervisor (`coordinatorStallEscalates`).
 */
const kernelStall = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow, inventory: TerminalInventory | null): Promise<string | null> => {
    const { root, binary, cwd, rules } = scope
    const stall = loadStallRules()
    if (seat.handle === null || seat.terminal === null) return null
    const { pending, nudges } = withLedger(root, (db) => ({ pending: kernelPending(db, workflow.id), nudges: nudgesOf(db, seat.id) }))
    const lastCall = lastCallOf(seat.leaseUntil, rules.seatLeaseMinutes, seat.startedAt)
    if (!pending || !olderThan(lastCall, stall.idleMinutes)) return null
    const signals = await askIdle(binary, cwd, { terminal: seat.terminal, handle: seat.handle }, inventory, stall)
    if (signals.idle !== true) return null
    // A prompt still pasted in the composer is submitted, never nudged over.
    const resubmitted = await resubmitPendingComposer(binary, cwd, root, { id: seat.id, terminal: seat.terminal }, loadRouting())
    if (resubmitted !== null) return `${workflow.id}: Kernel idle at its prompt: ${resubmitted}`
    const step = stallStep(lastCall, nudges, stall)
    if (step.kind === "wait") return `${workflow.id}: Kernel idle at its prompt (${signals.evidence.join("; ")}); ${step.detail}`
    if (step.kind === "nudge") {
        const text = promptOf(stall.prompts.kernel, { workflow: workflow.id, launch: seat.id, wait: String(rules.nextWaitSeconds) })
        if (!withLedger(root, (db) => claimNudge(db, workflow.id, seat.id, step.n, { role: "kernel", lastCall, evidence: signals.evidence }))) return null
        await sendNudge(binary, cwd, { id: seat.id, terminal: seat.terminal }, step.n, text)
        return `${workflow.id}: Kernel idle at its prompt with work pending (${signals.evidence.join("; ")}): nudge ${String(step.n)} of ${String(stall.nudgeMax)}`
    }
    return giveUpKernel(scope, workflow, seat, signals.failureText, step.detail)
}

/**
 * Remedy 2 of the stall ladder for a Kernel seat: its member records a `stalled` outcome (seat evidence and the provider circuit,
 * by the kind Orca's failure words name, else `stall`), repeated plain stalls escalate kind harness to the Supervisor
 * (`coordinatorStallEscalates`), and the Kernel is relaunched on the coordinator tier's listed order.
 */
const giveUpKernel = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow, failureText: string | null, detail: string): Promise<string> => {
    const { root, binary, cwd, rules, acting } = scope
    const stall = loadStallRules()
    const kind = stallKindOf(failureText)
    const agent = seat.agent ?? "?"
    const member = `${agent}/${seat.model ?? "?"}`
    const since = new Date(Date.now() - stall.coordinatorStallWindowMinutes * 60_000).toISOString()
    const stalls = withLedger(root, (db) => {
        recordEvent(db, STALL_GAVE_UP, workflow.id, { seat: seat.id, role: "kernel", member, kind, why: detail, failure: failureText })
        return Number(db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = '${STALL_GAVE_UP}' AND subject = ? AND at > ? AND json_extract(data_json, '$.kind') = 'stall' AND json_extract(data_json, '$.member') = ?`).get(workflow.id, since, member)?.n ?? 0)
    })
    recordSeatOutcome({ ledger: ledgerFileOf(root), id: seat.id, agent, model: seat.model, role: "kernel", startedAt: seat.startedAt })
    reportStalled(agent, kind, `Kernel of ${workflow.id} ${detail}${failureText === null ? "" : ": " + failureText}`)
    if (coordinatorStallEscalates(kind, stalls, stall)) withLedger(root, (db) => raiseDecision(db, { scope: "supervisor", workflowId: workflow.id, kind: "escalation", subject: `coordinator-stalls:${seat.id}`, evidence: { project: root, escalation: { kind: "harness", question: repeatedStallQuestion(`the Kernel of ${workflow.id}`, member, stalls, stall) } } }))
    return relaunch(root, binary, cwd, workflow, `stalled (${kind}): ${detail}`, { replace: true, acting }, rules)
}

/** The node states of a live Op: a dispatched attempt that has not ended. */
const LIVE_OP: ReadonlySet<NodeState> = new Set<NodeState>(["running", "launch-unknown", "lost", "reported", "verifying"])

/**
 * Ready work nobody runs: a dispatching workflow with ready or queued nodes and no live Op since the later of its last progress
 * and its Kernel seat's launch (`clock`), while its project has a free worker slot. Past stall.readyIdleMinutes the tick types
 * the Kernel a prompt naming the ready tasks (stall.prompts.readyIdle, once per seat and clock); past stall.readyStallMinutes the
 * Kernel is given up as the stall ladder gives one up (`giveUpKernel`), once per seat and clock, so the relaunch limit still bounds
 * the relaunches.
 */
const readyIdle = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow | undefined): Promise<string | null> => {
    const { root, binary, cwd, rules } = scope
    const stall = loadStallRules()
    if (seat?.handle == null || seat.terminal === null || !DISPATCHING.includes(workflow.status)) return null
    const { views, progress, woken } = withLedger(root, (db) => ({ views: snapshotOf(db, workflow.id).views, progress: lastProgress(db, workflow.id), woken: eventsOfSeat(db, READY_IDLE_WOKEN, workflow.id, seat.id) }))
    const ready = views.filter((view) => view.state === "ready" || view.state === "queued").map((view) => view.key)
    if (ready.length === 0 || views.some((view) => LIVE_OP.has(view.state))) return null
    const clock = progress === null || progress < seat.startedAt ? seat.startedAt : progress
    if (!olderThan(clock, stall.readyIdleMinutes)) return null
    const slots = await slotsOfRepository(root)
    if (slots.running >= slots.cap) return null
    const named = ready.join(", ")
    if (olderThan(clock, stall.readyStallMinutes)) {
        if (woken.some((event) => event.clock === clock && event.step === "gave-up")) return null
        withLedger(root, (db) => { recordEvent(db, READY_IDLE_WOKEN, workflow.id, { seat: seat.id, clock, step: "gave-up", ready }); })
        return giveUpKernel(scope, workflow, seat, null, `ready work (${named}) with no live Op since ${clock}, past ${String(stall.readyStallMinutes)} min`)
    }
    if (woken.some((event) => event.clock === clock)) return null
    withLedger(root, (db) => { recordEvent(db, READY_IDLE_WOKEN, workflow.id, { seat: seat.id, clock, step: "woken", ready }); })
    const text = promptOf(stall.prompts.readyIdle, { workflow: workflow.id, tasks: named, since: clock, wait: String(rules.nextWaitSeconds) })
    try {
        await terminalSend(binary, { terminal: seat.terminal, text, retryRequest: requestIdOf("ready-idle", `${seat.id}\0${clock}`) }, cwd)
    } catch (error: unknown) {
        return `${workflow.id}: ready work (${named}) idle since ${clock}; the wake was not delivered (${asRefusal(error).code})`
    }
    return `${workflow.id}: ready work (${named}) with no live Op since ${clock}: Kernel woken`
}

/** The ready-idle events of one Kernel seat: the clock each was recorded for and its step (woken, gave-up). */
const eventsOfSeat = (db: DatabaseSync, kind: string, workflowId: string, seatId: string): { readonly clock: string; readonly step: string }[] =>
    db
        .prepare("SELECT json_extract(data_json, '$.clock') AS clock, json_extract(data_json, '$.step') AS step FROM events WHERE kind = ? AND subject = ? AND json_extract(data_json, '$.seat') = ?")
        .all(kind, workflowId, seatId)
        .map((row) => ({ clock: String(row.clock), step: String(row.step) }))

/** The Run a Kernel seat was launched into: Orca's receipt, else the `--run` its launch sent. */
const runOfSeat = (seat: SeatRow): string | null => {
    const launch = seat.launch
    return seat.runId ?? (typeof launch === "object" && launch !== null && "run" in launch && typeof launch.run === "string" ? launch.run : null)
}

/**
 * The adoption of a workflow whose Kernel a host Supervisor launched (a version-2 host store, `hostSupervisors`): the sweep of the
 * Supervisor of its project records it as that Supervisor's (`workflow-coordinator` with `project` and `adoptedFrom`, once), and
 * relaunches its Kernel into its own Run only when the host Supervisor's Run has no coordinator any more (that row retired, or
 * Orca reports its terminal gone); while that terminal lives, the Kernel is left running where it is. `moved` is true when it
 * relaunched (or reached the relaunch limit), so nothing more is judged on the seat it fenced.
 */
const adoptFromHost = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow | undefined, live: TerminalInventory | null): Promise<{ readonly line: string | null; readonly moved: boolean }> => {
    const { root, binary, cwd, rules, acting } = scope
    const run = seat === undefined ? null : runOfSeat(seat)
    const host = run === null ? undefined : hostSupervisors().find((candidate) => candidate.runId === run)
    if (host === undefined) return { line: null, moved: false }
    const adopted = withLedger(root, (db) => {
        const latest = db.prepare("SELECT data_json FROM events WHERE kind = 'workflow-coordinator' AND subject = ? ORDER BY id DESC LIMIT 1").get(workflow.id)
        if (latest !== undefined && String(latest.data_json).includes(`"adoptedFrom":"${host.id}"`)) return false
        recordEvent(db, "workflow-coordinator", workflow.id, { coordinator: SUPERVISOR_COORDINATOR, project: acting.project, supervisor: acting.id, adoptedFrom: host.id })
        return true
    })
    const gone = host.endedAt !== null || (host.terminal !== null && live !== null && !live.truncated && !live.handles.has(host.terminal))
    if (gone) return { line: await relaunch(root, binary, cwd, workflow, `adopted from the host Supervisor ${host.id}, whose Run has no coordinator any more`, { replace: true, acting }, rules), moved: true }
    return { line: adopted ? `${workflow.id}: adopted from the host Supervisor ${host.id}; its Kernel stays in that Run while ${host.terminal ?? "its terminal"} lives` : null, moved: false }
}

/** The event the Supervisor's driver records when it decides an owner escalation on its default. */
const ESCALATION_DEFAULTED = "escalation-defaulted"

/**
 * Decides, for the Supervisor and without the owner, every open escalation of a repository's ledger that carries a default it
 * may rule (`defaultRuling`: a product choice inside the goal with the answer the Kernel proposed and why): in one transaction its
 * Kernel gets an `escalation-answer` whose ruling is that default, the escalation is answered by `default:<Supervisor>`, and an
 * `escalation-defaulted` event keeps the ruling and its reasoning. Returns a line per ruling.
 */
const ruleDefaults = (root: string, acting: AttachedSupervisor): string[] =>
    withLedger(root, (db) =>
        inTransaction(db, () =>
            openDecisions(db, "supervisor").flatMap((decision) => {
                const ruled = defaultRuling(decision)
                if (ruled === null) return []
                const question = questionOf(decision)
                const reasoning = `a product choice inside the accepted goal with a proposed default, so the Supervisor decides it on that default without the owner (${ruled.reason})`
                const answer = raiseDecision(db, {
                    scope: "kernel",
                    workflowId: decision.workflowId,
                    kind: "escalation-answer",
                    subject: `default:${decision.id}`,
                    evidence: { answers: decision.id, question, ruling: ruled.ruling, reasoning, by: "default", supervisor: acting.id, workflow: decision.workflowId, goal: null },
                })
                answerDecision(db, decision.id, `default:${acting.id}`, "supervisor")
                recordEvent(db, ESCALATION_DEFAULTED, decision.workflowId, { id: decision.id, answer, question, ruling: ruled.ruling, reasoning, supervisor: acting.id })
                return [`${decision.workflowId}: escalation ${decision.id} decided on its default (${ruled.ruling}); the Kernel has ${answer}`]
            }),
        ),
    )

/**
 * The Kernel sweep of one repository of the Supervisor's project: every orca workflow the Supervisor owns (its recorded
 * coordinator, set when `kernel start` or `workflow start` launched its Kernel) keeps exactly one live Kernel, by Orca's word. A
 * workflow nobody gave a Supervisor, or one still driven from a Kernel terminal another session adopted (Orca does not report it
 * gone), is never touched. A workflow a host Supervisor launched is adopted first (`adoptFromHost`). A Kernel Orca reports gone
 * (or silent past its TTL) is relaunched; a live one idle at its prompt with work pending meets the stall ladder. `ops` also runs
 * each owned workflow's Op budget ladder and Op stall ladder (the host driver's sweep, which needs no Kernel to be awake).
 */
const sweepKernels = async (context: VerbContext, root: string, binary: OrcaBinary, rules: CoordinatorLiveness, acting: AttachedSupervisor, ops: boolean): Promise<string[]> => {
    const { cwd } = context
    const ruled = ruleDefaults(root, acting)
    const owned = withLedger(root, (db) =>
        listWorkflows(db)
            .filter((workflow) => isCoordinated(workflow) && coordinatorOf(db, workflow.id) === SUPERVISOR_COORDINATOR)
            .map((workflow) => ({ workflow, seat: kernelSeatOf(db, workflow.id), progress: lastProgress(db, workflow.id), foreign: foreignKernelTerminal(db, workflow) })),
    )
    const live = owned.length > 0 ? await terminalList(binary, cwd).catch(() => null) : null
    const workflows = owned.filter(({ foreign }) => foreign === null || (live !== null && !live.truncated && !live.handles.has(foreign)))
    const scope: SweepScope = { root, binary, cwd, rules, acting }
    const done = await inOrder(workflows, async ({ workflow, seat, progress }): Promise<string[]> => {
        const lines: string[] = []
        try {
            const adoption = await adoptFromHost(scope, workflow, seat, live)
            lines.push(adoption.line ?? "")
            if (!adoption.moved && seat !== undefined && launchUnreconciled(seat)) lines.push((await resolveKernelLaunch(scope, workflow, seat, live)) ?? "")
            else if (!adoption.moved) {
                const reason = await relaunchReason(binary, cwd, seat, progress, rules)
                if (reason !== null) lines.push(await relaunch(root, binary, cwd, workflow, reason.why, { replace: reason.replace, acting }, rules))
                else if (seat !== undefined) lines.push((await kernelStall(scope, workflow, seat, live)) ?? "")
            }
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            lines.push(`${workflow.id}: Kernel not relaunched (${refusal.code}): ${refusal.message.split("\n")[0] ?? ""}`)
        }
        // A filed result is verified, a dead verify reclaimed and a settled worker's seat closed without waiting for the Kernel's turn.
        try {
            // The tick and `supervisor next` never wait on a wave: it starts as a detached job (harness/wave.ts) and they move on.
            lines.push(...(await settleWorkflow({ ...context, cwd: root }, root, workflow.id, { detachWave: true })).filter((action) => action.action !== "wait").map((action) => `${workflow.id}: ${action.action} ${action.task ?? "-"} ${action.detail}`))
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            lines.push(`${workflow.id}: not settled (${refusal.code}): ${refusal.message.split("\n")[0] ?? ""}`)
        }
        if (ops && workflow.status !== "paused") {
            const opActions = [...(await sweepOpBudgets(root, binary, cwd, workflow.id)), ...(await sweepOpStalls(root, binary, cwd, workflow.id, live))]
            lines.push(...opActions.map((action) => `${workflow.id}: ${action.task ?? "-"} ${action.detail}`))
            try {
                const current = withLedger(root, (db) => ({ workflow: getWorkflow(db, workflow.id), seat: kernelSeatOf(db, workflow.id) }))
                lines.push((await readyIdle(scope, current.workflow, current.seat)) ?? "")
            } catch (error: unknown) {
                lines.push(`${workflow.id}: ready work not judged (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
            }
        }
        return lines.filter((line) => line !== "")
    })
    return [...ruled, ...done.flat()]
}

/**
 * The project's open Supervisor decisions in the order `supervisor next` returns them: the ones the Supervisor rules, oldest
 * first, then the ones awaiting the owner or Debug (`awaitsOwner`), so such a question never holds the others back.
 */
const openSupervisorDecisions = (repos: readonly string[]): SupervisorDecision[] =>
    repos
        .flatMap((project) => withLedger(project, (db) => openDecisions(db, "supervisor").map((decision) => ({ ...decision, project }))))
        .toSorted((a, b) => Number(awaitsOwner(a)) - Number(awaitsOwner(b)) || a.raisedAt.localeCompare(b.raisedAt))

/**
 * Files every open `harness` escalation of the project's repositories as a ticket for Debug (`ticketEscalation` in
 * harness/tickets.ts: blocking, deduped onto the live ticket of the same defect, the escalation waiting on it), once each, as
 * lines for `next`'s actions; the ticket's close releases the escalation and wakes the Supervisor.
 */
const ticketHarnessEscalations = (repos: readonly string[], project: Project): string[] =>
    openSupervisorDecisions(repos)
        .filter((decision) => awaitsOwner(decision) && (decision.evidence as { readonly escalation?: { readonly kind?: unknown } } | null)?.escalation?.kind === "harness")
        .flatMap((decision) => {
            const filed = ticketEscalation(decision.project.replaceAll("\\", "/"), project, decision)
            return filed === null ? [] : [`harness escalation ${decision.id} filed as ticket ${filed.ticket.id} (${filed.outcome}, seen ${String(filed.ticket.occurrences)} times)`]
        })

/**
 * `supervisor next`: a Supervisor's own driver, for one project. From its terminal it sweeps the workflows it owns in every
 * repository of its project (a Kernel with a lapsed lease and no progress past kernelTtlMinutes is relaunched on Orca's word, a
 * live one idle at its prompt with work pending meets the stall ladder; a launch Orca never confirmed is reconciled through
 * Orca (`resolveKernelLaunch`); too many relaunches pause and escalate) and tends its `[Worker]` seats (`tendWorkers`), then
 * returns the project's next open escalation or handoff it rules (`openSupervisorDecisions`), else a worker's completion not
 * handed yet (`nextWorkerEvent`), else its oldest owner request (`supervisor ask`), else one awaiting the owner or Debug its Supervisor was not handed yet, else waits
 * on its Run's mailbox until nextWaitSeconds pass and returns idle. From anywhere else the decisions are only read; `supervisor
 * tick` sweeps for it.
 */
export const supervisorNext = async (context: VerbContext, project: Project, waitSeconds?: number): Promise<SupervisorNext> => {
    const rules = loadCoordinatorLiveness()
    const deadline = Date.now() + (waitSeconds ?? rules.nextWaitSeconds) * 1000
    const seat = supervisorRecord(project.key)
    const attached: AttachedSupervisor | null = inSupervisorTerminal(seat) ? seat : null
    const binary = attached === null ? null : await locateOrca(context.cwd).catch(() => null)
    const actions: string[] = []
    // Waits on the Supervisor Run's mailbox (acking `delivery`), else sleeps; answers the delivery the next wait acks.
    const awaitMail = async (delivery: string | undefined, waitMs: number): Promise<string | undefined> => {
        if (attached === null || binary === null) {
            await sleep(waitMs)
            return delivery
        }
        try {
            const batch = await mailCheck(binary, { terminal: attached.terminal, run: attached.run_id, ack: delivery, waitMs }, context.cwd)
            return batch.deliveryId ?? undefined
        } catch (error: unknown) {
            actions.push(`mailbox not read (${asRefusal(error).code}); the ledgers are read anyway`)
            await sleep(waitMs)
            return delivery
        }
    }
    // One round: sweep, then answer the oldest decision, or wait for mail and go round again until the deadline.
    // The longest sweep a round took: the wait stops early by it, so the last round's sweep still ends by the deadline and `next`
    // returns inside the caller's shell timeout instead of being killed there with nothing printed.
    let sweepMs = 0
    const round = async (delivery: string | undefined): Promise<SupervisorNext> => {
        const swept = Date.now()
        if (attached !== null) renewSupervisorLease(attached.id)
        const { repos, problems } = await projectRepositories(project)
        actions.push(...problems.filter((problem) => !actions.includes(problem)))
        if (attached !== null && binary !== null) {
            actions.push(...(await inOrder(repos, (repo) => sweepKernels(context, repo, binary, rules, attached, false))).flat())
            actions.push(...(await tendWorkers(context, attached, binary, project)))
        }
        sweepMs = Math.max(sweepMs, Date.now() - swept)
        if (attached !== null) actions.push(...ticketHarnessEscalations(repos, project))
        const decisions = openSupervisorDecisions(repos).filter((open) => !awaitsOwner(open) || attached === null || !relayed(open))
        const handOver = (decision: SupervisorDecision): SupervisorNext => {
            const digest = withLedger(decision.project, (db) => {
                if (attached !== null && awaitsOwner(decision)) recordEvent(db, DECISION_RELAYED, decision.workflowId, { id: decision.id, supervisor: attached.id })
                return digestOf(db, decision.workflowId)
            })
            return { kind: decision.kind as SupervisorDecisionKind, decision, digest, worker: null, request: null, actions }
        }
        const ruled = decisions.find((open) => !awaitsOwner(open))
        if (ruled !== undefined) return handOver(ruled)
        const worker = nextWorkerEvent(project, attached !== null)
        if (worker !== null) return { kind: "worker", decision: null, digest: null, worker, request: null, actions }
        const request = openOwnerRequests(project.key)[0]
        if (request !== undefined) return { kind: "owner-request", decision: null, digest: null, worker: null, request, actions }
        const relay = decisions.find(awaitsOwner)
        if (relay !== undefined) return handOver(relay)
        const left = deadline - Date.now() - sweepMs
        if (left <= 0) return { kind: "idle", decision: null, digest: null, worker: null, request: null, actions }
        // The sweep may have taken a while: the wait is a driver call too, so the lease is renewed as it starts.
        if (attached !== null) renewSupervisorLease(attached.id)
        return round(await awaitMail(delivery, Math.min(rules.nextPollSeconds * 1000, left)))
    }
    return round(undefined)
}

const recordHostEvent = (kind: string, subject: string, data: unknown): void => {
    withMachine((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), kind, subject, JSON.stringify(data)))
}

const hostEventsOf = (kind: string, subject: string): { readonly at: string; readonly data: unknown }[] =>
    readMachine((db) => db.prepare("SELECT at, data_json FROM host_events WHERE kind = ? AND subject = ? ORDER BY id").all(kind, subject), []).map((row) => ({ at: String(row.at), data: JSON.parse(String(row.data_json)) as unknown }))

const decisionOf = (data: unknown): unknown => (typeof data === "object" && data !== null && "decision" in data ? data.decision : null)

/**
 * The stall ladder of a Supervisor seat: idle at its prompt (stall rules) while a decision of its project that it rules or an owner
 * request waits (a decision awaiting the owner or Debug is not its work: it waits for their answer) and
 * no driver call came for stall.idleMinutes, it is nudged with its loop prompt; a nudge unanswered past nudgeGraceMinutes, or a
 * stall after nudgeMax nudges, gives it up: its member records a `stalled` outcome and the project's Supervisor is replaced by a
 * new launch on the coordinator tier's listed order (another member only while the circuit or quota takes the first out);
 * repeated plain stalls also escalate kind harness (`coordinatorStallEscalates`). Once kernelRelaunchMax
 * replacements left the same decision waiting, the tick stops replacing and reports it for the owner.
 */
const supervisorStall = async (binary: OrcaBinary, cwd: string, seat: AttachedSupervisor, repos: readonly string[], inventory: TerminalInventory | null, rules: CoordinatorLiveness): Promise<string | null> => {
    const stall = loadStallRules()
    const project = projectOfRecord(seat)
    const title = supervisorTitle(project.name)
    const decision = openSupervisorDecisions(repos).find((open) => !awaitsOwner(open)) ?? openOwnerRequests(project.key)[0]
    const lastCall = lastCallOf(seat.lease_until, rules.supervisorTtlMinutes, seat.started_at)
    if (decision === undefined || !olderThan(lastCall, stall.idleMinutes)) return null
    const signals = await askIdle(binary, cwd, { terminal: seat.terminal, handle: null }, inventory, stall)
    if (signals.idle !== true) return null
    const step = stallStep(lastCall, hostEventsOf(STALL_NUDGED, seat.id).map((event) => event.at), stall)
    if (step.kind === "wait") return `${title} idle at its prompt with ${decision.id} waiting (${signals.evidence.join("; ")}); ${step.detail}`
    if (step.kind === "nudge") {
        const claimed = withMachine((db) => {
            if (Number(db.prepare("SELECT COUNT(*) AS n FROM host_events WHERE kind = ? AND subject = ?").get(STALL_NUDGED, seat.id)?.n ?? 0) !== step.n - 1) return false
            db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), STALL_NUDGED, seat.id, JSON.stringify({ n: step.n, lastCall, project: project.key, decision: decision.id, evidence: signals.evidence }))
            return true
        })
        if (!claimed) return null
        await sendNudge(binary, cwd, { id: seat.id, terminal: seat.terminal }, step.n, promptOf(stall.prompts.supervisor, { wait: String(rules.nextWaitSeconds) }))
        return `${title} idle at its prompt with ${decision.id} waiting (${signals.evidence.join("; ")}): nudge ${String(step.n)} of ${String(stall.nudgeMax)}`
    }
    const gaveUp = readMachine((db) => db.prepare("SELECT at, data_json FROM host_events WHERE kind = ?").all(STALL_GAVE_UP), []).map((row) => ({ at: String(row.at), data: JSON.parse(String(row.data_json)) as Readonly<Record<string, unknown>> }))
    const replaced = gaveUp.filter((row) => decisionOf(row.data) === decision.id).length
    if (replaced >= rules.kernelRelaunchMax) return `${title} stalled again with ${decision.id} waiting after ${String(replaced)} replacements: left for the owner (starci supervisor status)`
    const kind = stallKindOf(signals.failureText)
    const member = `${seat.agent}/${seat.model}`
    const since = new Date(Date.now() - stall.coordinatorStallWindowMinutes * 60_000).toISOString()
    const stalls = 1 + gaveUp.filter((row) => row.at > since && row.data.project === project.key && row.data.kind === "stall" && row.data.member === member).length
    recordHostEvent(STALL_GAVE_UP, seat.id, { member, kind, why: step.detail, project: project.key, decision: decision.id, failure: signals.failureText })
    recordSeatOutcome({ ledger: "machine", id: seat.id, agent: seat.agent, model: seat.model, role: "supervisor", startedAt: seat.started_at })
    reportStalled(seat.agent, kind, `${title} ${step.detail}${signals.failureText === null ? "" : ": " + signals.failureText}`)
    const escalated = coordinatorStallEscalates(kind, stalls, stall) ? escalateSupervisorStalls(decision, repeatedStallQuestion(title, member, stalls, stall), seat.id) : null
    await stopSupervisor(binary, cwd, project, false, "stalled")
    const started = await startSupervisor(binary, cwd, project)
    return `${title} stalled (${kind}, ${step.detail}): replaced by ${started.agent}/${started.model}${escalated === null ? "" : `; escalated to Debug (harness ${escalated})`}`
}

/**
 * Raises the harness escalation of a Supervisor's repeated plain stalls on the workflow the waiting work names (the decision's,
 * or the one an owner request was given to), where the next Supervisor reads it after the work it rules; with no workflow to
 * carry it, the tick's line (a `supervisor-tick` host event) is the word Debug reads.
 */
const escalateSupervisorStalls = (waiting: SupervisorDecision | OwnerRequest, question: string, seat: string): string | null => {
    const place = "workflowId" in waiting ? { repo: waiting.project, workflow: waiting.workflowId } : { repo: waiting.repository ?? waiting.projectRoot, workflow: waiting.workflow }
    if (place.workflow === null || ledgerPath(place.repo) === undefined) return null
    const workflow = place.workflow
    return withLedger(place.repo, (db) => raiseDecision(db, { scope: "supervisor", workflowId: workflow, kind: "escalation", subject: `coordinator-stalls:${seat}`, evidence: { project: place.repo, escalation: { kind: "harness", question } } }))
}

/** The projects that own a running orca workflow: the repositories whose ledgers hold one a Supervisor coordinates, by `projectOf`. */
const projectsWithWorkflows = async (problems: string[]): Promise<Project[]> => {
    const found: Project[] = []
    await inOrder(registeredRepositories(), async (repo) => {
        const owns = withLedger(repo, (db) => listWorkflows(db).some((workflow) => isCoordinated(workflow) && coordinatorOf(db, workflow.id) === SUPERVISOR_COORDINATOR))
        if (!owns) return
        try {
            found.push(await projectOf(repo))
        } catch (error: unknown) {
            problems.push(`${repo}: no project (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
        }
    })
    return found
}

/** What `ensureSupervisors` did: one ensure per kept project, and the projects it could not ensure or resolve. */
export interface SupervisorsEnsured {
    readonly ensured: readonly SupervisorEnsured[]
    readonly problems: readonly string[]
}

/**
 * Keeps every project's Supervisor alive, the host-wide half of `supervisor tick` (and what a host service calls to start the
 * Supervisors): the projects of `keptProjects` (a live Supervisor, or one ended by anything but the owner's stop), every project
 * holding an open owner request and every project owning a running orca workflow get `ensureSupervisor`, each once.
 */
export const ensureSupervisors = async (binary: OrcaBinary, cwd: string): Promise<SupervisorsEnsured> => {
    const problems: string[] = []
    const projects = new Map<string, Project>()
    for (const project of [...keptProjects(), ...ownerRequestProjects(), ...(await projectsWithWorkflows(problems))]) if (!projects.has(project.key)) projects.set(project.key, project)
    const ensured: SupervisorEnsured[] = []
    await inOrder([...projects.values()], async (project) => {
        try {
            ensured.push(await ensureSupervisor(binary, cwd, project))
        } catch (error: unknown) {
            problems.push(`${supervisorTitle(project.name)} not ensured (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
        }
    })
    return { ensured, problems }
}

/** What one `supervisor tick` did: every project's ensure, the projects whose Supervisor it acted for, the terminals it closed, and every action. */
export interface SupervisorTick {
    readonly supervisors: readonly SupervisorEnsured[]
    readonly swept: readonly string[]
    readonly terminals: readonly SweptTerminal[]
    readonly actions: readonly string[]
}

const questionOf = (decision: Decision): string => {
    const evidence = decision.evidence
    const escalation = typeof evidence === "object" && evidence !== null && "escalation" in evidence ? evidence.escalation : null
    return typeof escalation === "object" && escalation !== null && "question" in escalation && typeof escalation.question === "string" ? escalation.question : decision.subject
}

/** Every open blocked-prompt escalation of a repository's ledger, named loudly on each tick until the Supervisor answers it. */
/** The tick's worktree collector of one repository (harness/worktree-gc.ts), as lines: each worktree it removed or could not. */
const gcLines = async (root: string): Promise<string[]> => {
    try {
        return (await worktreeGc(root, false)).filter((entry) => entry.due).map((entry) => `worktree ${entry.kind} ${entry.path} ${entry.removed ? "removed" : "left"} (${entry.reason})${entry.preserved === null ? "" : `; its work preserved in ${entry.preserved}`}`)
    } catch (error: unknown) {
        return [`worktree gc of ${root} not run (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`]
    }
}

/** The tick's Orca lineage reconcile of one repository (harness/orca/lineage.ts), as lines: each lineage it set, or Orca refused. */
const lineageLines = async (root: string, binary: OrcaBinary, cwd: string): Promise<string[]> => {
    try {
        return (await reconcileLineage(root, binary, cwd)).map((fix) => `worktree ${fix.path} (${fix.owner}): ${fix.outcome === "set" ? "lineage set, " : ""}${fix.detail}`)
    } catch (error: unknown) {
        return [`Orca lineage of ${root} not reconciled (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`]
    }
}

const blockedPromptLines = (root: string): string[] =>
    ledgerPath(root) === undefined ? [] : withLedger(root, (db) => openBlockedPrompts(db).map((decision) => `BLOCKED PROMPT (${decision.id}, ${decision.workflowId}): ${questionOf(decision)}`))

/**
 * `supervisor tick`: one deterministic pass of the host driver, idempotent and safe to run every minute, with no LLM awake. It
 * keeps every project's Supervisor (`ensureSupervisors`), retires a version-2 host Supervisor Orca reports gone, and for each
 * Supervisor attached and alive it acts for it, over its project only: the owned workflows of the project's repositories get the
 * Kernel sweep (adoption from a host Supervisor, relaunch on Orca's word, the relaunch limit, a Kernel launch Orca never confirmed) and
 * the stall ladder for their Kernels and Ops, and the Supervisor's own seat the stall ladder. Every open blocked-prompt escalation
 * is named on each tick until answered. Every action is an event (project ledger, or host_events for a Supervisor and the tick).
 * Before all of it, the terminal sweep (`sweepTerminals`) closes every harness terminal no open seat or live Supervisor holds and
 * every orphaned one, so an orphaned Supervisor is relaunched in the same pass; then the full terminal list is recorded for the
 * pool count (`recordTerminalList`) and every stale unreconciled Kernel launch of any registered ledger with nothing alive is
 * closed (`reconcileStaleLaunches`). `dryRun` reports what the terminal sweep would close and does nothing else.
 */
export const supervisorTick = async (context: VerbContext, dryRun = false): Promise<SupervisorTick> => {
    const rules = loadCoordinatorLiveness()
    const binary = await locateOrca(context.cwd)
    const terminals = await sweepTerminals(binary, context.cwd, registeredRepositories(), dryRun)
    const closures = terminals.map((one) => `${dryRun ? "would close" : `closed (${one.outcome})`} terminal ${one.handle} "${one.title ?? ""}": ${one.why}`)
    if (dryRun) return { supervisors: [], swept: [], terminals, actions: closures }
    for (const one of terminals) recordHostEvent("terminal-swept", one.handle, one)
    const inventory = await terminalList(binary, context.cwd).catch(() => null)
    const stale: string[] = []
    if (inventory !== null) {
        recordTerminalList(inventory.handles, inventory.truncated)
        stale.push(...(await reconcileStaleLaunches(binary, context.cwd, inventory)))
        for (const line of stale) recordHostEvent("stale-launch-closed", "tick", { line })
    }
    const { ensured, problems } = await ensureSupervisors(binary, context.cwd)
    const actions: string[] = [...closures, ...stale, ...problems]
    for (const one of ensured) if (one.action !== "none") actions.push(`${supervisorTitle(one.project.name)} ${one.liveness}: ${one.action}, ${one.detail}`)
    const retired = await retireHostSupervisor(binary, context.cwd).catch((error: unknown) => `host Supervisor not retired (${asRefusal(error).code})`)
    if (retired !== null) actions.push(retired)
    const swept: string[] = []
    await inOrder(ensured, async (one) => {
        const seat = supervisorRecord(one.project.key)
        const title = supervisorTitle(one.project.name)
        if (!isAttached(seat) || one.liveness !== "alive") {
            actions.push(`${title}: no attached live Supervisor (${one.liveness}): nothing swept until it attaches`)
            return
        }
        swept.push(one.project.name)
        const lines: string[] = []
        const { repos, problems: unresolved } = await projectRepositories(one.project)
        lines.push(...unresolved, ...(await inOrder(repos, (repo) => sweepKernels(context, repo, binary, rules, seat, true))).flat())
        lines.push(...repos.flatMap(blockedPromptLines), ...(await inOrder(repos, gcLines)).flat(), ...(await inOrder(repos, (repo) => lineageLines(repo, binary, context.cwd))).flat())
        try {
            const line = await supervisorStall(binary, context.cwd, seat, repos, await terminalList(binary, context.cwd).catch(() => null), rules)
            if (line !== null) lines.push(line)
        } catch (error: unknown) {
            lines.push(`${title} stall ladder stopped (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
        }
        if (lines.length > 0) recordHostEvent("supervisor-tick", seat.id, { project: one.project.key, actions: lines })
        actions.push(...lines.map((line) => `${title}: ${line}`))
    })
    return { supervisors: ensured, swept, terminals, actions }
}

/** Wakes a workflow's Kernel by mail (`dispatch:<its dispatch>`); the decision in the ledger is the content. */
const wakeKernel = async (root: string, cwd: string, command: Command, decision: string): Promise<string> => {
    const seat = withLedger(root, (db) => kernelSeatOf(db, command.workflow))
    const supervisor = supervisorRecord((await projectOf(root)).key)
    if (seat?.handle == null || !inSupervisorTerminal(supervisor)) return "the Kernel reads the decision with its next kernel next"
    try {
        const binary = await locateOrca(cwd)
        await mailSend(binary, { to: `dispatch:${seat.handle}`, from: supervisor.terminal, type: "status", subject: `[Supervisor] ${command.kind}`, body: command.note ?? command.goal ?? command.kind, payload: { cmdId: command.cmdId, decision }, retryRequest: requestIdOf("supervisor-mail", command.cmdId) }, cwd)
        return "mailed the Kernel"
    } catch (error: unknown) {
        return `mail not sent (${asRefusal(error).code}); the Kernel reads the decision with its next kernel next`
    }
}

/** Raises the Kernel's decision for a Supervisor command, and an escalation-answer for each other workflow whose escalation it answers. */
/** Raises an escalation-answer for the Kernel of each other workflow whose escalation a Supervisor command answers. */
const answerOtherWorkflows = (db: DatabaseSync, command: Command): string[] =>
    ledgerAnswers(command, "supervisor")
        .map((id) => getDecision(db, id))
        .filter((decision): decision is Decision => decision !== undefined && decision.workflowId !== command.workflow)
        .map((decision) => raiseDecision(db, { scope: "kernel", workflowId: decision.workflowId, kind: "escalation-answer", subject: command.cmdId, evidence: { answers: decision.id, ruling: command.note ?? null, by: command.kind, workflow: command.workflow, goal: command.goal ?? null } }))

const raiseForKernel = (db: DatabaseSync, root: string, command: Command): string => {
    const answered = ledgerAnswers(command, "supervisor").map((id) => getDecision(db, id)).filter((decision) => decision !== undefined)
    answerOtherWorkflows(db, command)
    const own: KernelDecisionKind = command.kind === "goal" || command.kind === "goal-change" ? command.kind : "done"
    const kind: KernelDecisionKind = answered.some((decision) => decision.workflowId === command.workflow) ? "escalation-answer" : own
    const goalVersion = goalVersionOf(db, command.workflow)
    return raiseDecision(db, { scope: "kernel", workflowId: command.workflow, kind, subject: command.cmdId, evidence: { project: root, cmdId: command.cmdId, command: command.kind, goal: command.goal ?? null, goalVersion, note: command.note ?? null, answers: command.answers ?? [] } })
}

/**
 * A stop ends its workflow's conversation: every open decision of the stopped workflow, the Kernel's and the Supervisor's, is
 * answered by the stop's cmdId, and no Kernel decision is raised for a Kernel the stop closes. An escalation of another
 * workflow the stop answers still gets its escalation-answer.
 */
const endDecisions = (db: DatabaseSync, command: Command): { readonly closed: readonly string[]; readonly answered: readonly string[] } =>
    inTransaction(db, () => {
        const open = [...openDecisions(db, "kernel", command.workflow), ...openDecisions(db, "supervisor", command.workflow)]
        for (const decision of open) answerDecision(db, decision.id, `stopped: ${command.cmdId}`, decision.scope)
        return { closed: open.map((decision) => decision.id), answered: answerOtherWorkflows(db, command) }
    })

const applySupervisor = async (context: VerbContext, root: string, command: Command, sha256: string): Promise<unknown> => {
    if (command.kind === "need-owner") return applyNeedOwner(root, command)
    if (command.kind === "stop") {
        const stopped = await workflowStopVerb.run({ ...context, cwd: root }, { workflow: command.workflow, graceful: command.mode !== "hard", hard: command.mode === "hard" })
        const ended = withLedger(root, (db) => endDecisions(db, command))
        return { stopped: stopped.message.split("\n")[0] ?? "", ended }
    }
    if (command.kind === "goal-change") {
        const change: GoalChange = {
            schema: GOAL_CHANGE_SCHEMA,
            workflow: command.workflow,
            cmdId: command.cmdId,
            goal: command.goal ?? "",
            ...(command.basedOn.goal === undefined ? {} : { basedOn: command.basedOn.goal }),
            ...(command.acceptance === undefined ? {} : { acceptance: command.acceptance }),
            ...(command.scope === undefined ? {} : { scope: command.scope }),
        }
        withLedger(root, (db) => recordGoalChange(db, getWorkflow(db, command.workflow), { change, sha256 }, command.basedOn.goal ?? 0, "supervisor"))
    }
    const decision = withLedger(root, (db) => raiseForKernel(db, root, command))
    return { decision, mail: await wakeKernel(root, context.cwd, command, decision) }
}

/**
 * `supervisor submit <file>`: one Supervisor command to a workflow's Kernel (goal, goal-change, stop), possibly answering
 * escalations. It is admitted under cmdId dedupe and basedOn (goal version), applied (a Kernel decision is raised, stop runs
 * `workflow stop`), and the escalations and owner requests (`supervisor ask`) it answers close with it, each recording its cmdId.
 */
export const supervisorSubmit = async (context: VerbContext, file: string, projectFlag?: string): Promise<{ readonly command: unknown; readonly replay: boolean; readonly project: string }> => {
    const parsed = readCommand(file, "supervisor")
    const { command } = parsed
    let target = context.cwd
    if (command.project !== undefined) target = resolve(dirname(file), command.project)
    else if (projectFlag !== undefined) target = (await projectFrom(context, projectFlag)).root
    const root = await repositoryRoot(target)
    const owner = await projectOf(root)
    const caller = liveSupervisors().find((seat) => inSupervisorTerminal(seat))
    if (caller !== undefined && caller.project !== owner.key) {
        throw new Refusal("PROJECT_FOREIGN", `workflow ${command.workflow} of ${root} belongs to project ${owner.name}, not to this ${supervisorTitle(projectOfRecord(caller).name)}; its own Supervisor submits it`)
    }
    const requests = (command.answers ?? []).filter(isOwnerRequestId)
    assertOwnerRequests(owner.key, requests, command.cmdId)
    if (command.kind === "goal" && withLedger(root, (db) => db.prepare("SELECT 1 FROM commands WHERE workflow_id = ? AND kind = 'goal' AND status = 'applied'").get(command.workflow)) !== undefined) {
        throw new Refusal("GOAL_EXISTS", `workflow ${command.workflow} has its goal; change it with a goal-change based on its goal version`)
    }
    const admitted = withLedger(root, (db) => admitCommand(db, "supervisor", parsed))
    const closing = { cmdId: command.cmdId, workflow: command.workflow, repository: root }
    if (admitted.kind === "replay") {
        closeOwnerRequests(requests, closing)
        return { command: admitted.row, replay: true, project: root }
    }
    let outcome: unknown
    try {
        outcome = await applySupervisor(context, root, command, parsed.sha256)
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        withLedger(root, (db) => finishCommand(db, "supervisor", command, "failed", { code: refusal.code, message: refusal.message }))
        throw error
    }
    const row = withLedger(root, (db) => finishCommand(db, "supervisor", command, "applied", outcome))
    closeOwnerRequests(requests, closing)
    if (caller !== undefined) renewSupervisorLease(caller.id)
    return { command: row, replay: false, project: root }
}
