import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { admitCommand, answerDecision, finishCommand, getDecision, goalVersionOf, openDecisions, raiseDecision, readCommand } from "../../harness/coordinator-commands.js"
import type { Command, Decision, KernelDecisionKind } from "../../harness/coordinator-commands.js"
import { loadCoordinatorLiveness, olderThan } from "../../harness/coordinator-liveness.js"
import type { CoordinatorLiveness } from "../../harness/coordinator-liveness.js"
import { GOAL_CHANGE_SCHEMA, recordGoalChange } from "../../harness/goal.js"
import type { GoalChange } from "../../harness/goal.js"
import { coordinatorOf, foreignKernelTerminal, launchKernelSeat, startKernel, SUPERVISOR_COORDINATOR } from "../../harness/kernel.js"
import type { NodeState } from "../../harness/graph.js"
import { ledgerPath, now, openLedger } from "../../harness/ledger.js"
import { inTransaction } from "../../harness/leases.js"
import { loadLiveness } from "../../harness/liveness.js"
import { readMachine, textOf, withMachine } from "../../harness/machine.js"
import { recordSeatOutcome } from "../../harness/outcomes.js"
import { closeWorker, locateOrca, mailCheck, mailSend, requestIdOf, requestShow, terminalList, workerShow } from "../../harness/orca/client.js"
import type { OrcaBinary, TerminalInventory, WorkerStartInput } from "../../harness/orca/client.js"
import type { RouteMember } from "../../harness/router.js"
import { kernelSeatOf, recordSeat, SEAT_LAUNCH_FAILED } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { askIdle, claimNudge, loadStallRules, nudgesOf, promptOf, reportStalled, sendNudge, STALL_GAVE_UP, STALL_NUDGED, stallKindOf, stallStep } from "../../harness/stall.js"
import { ensureSupervisor, inSupervisorTerminal, isAttached, renewSupervisorLease, startSupervisor, stopSupervisor, supervisorRecord } from "../../harness/supervisor.js"
import type { AttachedSupervisor, SupervisorEnsured } from "../../harness/supervisor.js"
import { recordEvent } from "../../harness/tasks.js"
import { DISPATCHING, getWorkflow, listWorkflows, setWorkflowStatus, snapshotOf } from "../../harness/workflow.js"
import type { WorkflowRow } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import type { VerbContext } from "../../shared/verb.js"
import { inOrder } from "../../harness/sequential.js"
import { digestOf, RELAUNCH_LIMIT, sweepOpStalls } from "../kernel/driver.js"
import type { Digest } from "../kernel/driver.js"
import { workflowStopVerb } from "../workflow/stop.js"

/** A Supervisor decision with the project it lives in. */
export interface SupervisorDecision extends Decision {
    readonly project: string
}

/** What `supervisor next` returns: one decision (escalation or handoff) with its workflow digest, or idle. */
export interface SupervisorNext {
    readonly kind: "escalation" | "handoff" | "idle"
    readonly decision: SupervisorDecision | null
    readonly digest: Digest | null
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

/** The repositories whose ledgers the host registry lists and that exist. */
export const registeredProjects = (): string[] =>
    readMachine((db) => db.prepare("SELECT repo_root, file FROM ledgers WHERE state != 'retired'").all(), [])
        .filter((row) => existsSync(textOf(row.file) ?? "") && existsSync(textOf(row.repo_root) ?? ""))
        .map((row) => textOf(row.repo_root) ?? "")

const isCoordinated = (workflow: WorkflowRow): boolean =>
    workflow.header.runner === "orca" && ["running", "blocked", "paused"].includes(workflow.status) && workflow.reason?.startsWith(RELAUNCH_LIMIT) !== true

/** The events the drivers record about a seat rather than the work: relaunching a Kernel, or nudging or giving up a stalled seat, is not progress. */
const NOT_PROGRESS: readonly string[] = ["kernel-relaunched", "workflow-coordinator", "workflow-worktree", "workflow-kernel", STALL_NUDGED, STALL_GAVE_UP]

/** The last time a workflow's work moved (its own events and its tasks', but none a driver records about a seat), the Kernel's progress clock. */
const lastProgress = (db: DatabaseSync, workflowId: string): string | null => {
    const row = db
        .prepare(`SELECT MAX(at) AS at FROM events WHERE (subject = ? OR subject IN (SELECT id FROM tasks WHERE workflow_id = ?)) AND kind NOT IN (${NOT_PROGRESS.map(() => "?").join(", ")})`)
        .get(workflowId, workflowId, ...NOT_PROGRESS)
    return row?.at === null || row?.at === undefined ? null : String(row.at)
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
 * Resolves a Kernel launch with no dispatch on its seat through Orca. A completed request whose receipt names a dispatch is
 * judged by that dispatch: a started worker is adopted; one that never started past stall.startDeadlineMinutes (or is gone) is
 * closed and the Kernel relaunched with that member behind every other. A completed request with no dispatch is replayed;
 * an absent one past the deadline is an escalation.
 */
const resolveKernelLaunch = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, seat: SeatRow, rules: CoordinatorLiveness, acting: AttachedSupervisor): Promise<string | null> => {
    if (seat.requestId === null || seat.handle !== null) return null
    const shownRequest = await requestShow(binary, seat.requestId, cwd).catch(() => null)
    const state = shownRequest?.state ?? "unknown"
    if (state === "completed" && shownRequest?.dispatchId != null) return judgeKernelDispatch(root, binary, cwd, workflow, seat, shownRequest.dispatchId, rules, acting)
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

/** A Kernel launch's dispatch, judged as an Op's is: started -> adopted on the seat; never started past the deadline, or gone -> closed and relaunched elsewhere. */
const judgeKernelDispatch = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, seat: SeatRow, dispatchId: string, rules: CoordinatorLiveness, acting: AttachedSupervisor): Promise<string | null> => {
    const stall = loadStallRules()
    const shown = await workerShow(binary, dispatchId, cwd).catch(() => null)
    const states = shown === null ? [] : [shown.state, shown.observed].filter((value): value is string => value !== null)
    const gone = states.some((value) => loadLiveness().goneStates.includes(value))
    const unstarted = states.some((value) => stall.startUnknownStates.includes(value))
    if (shown?.state != null && !gone && !unstarted) {
        withLedger(root, (db) => { recordSeat(db, seat.id, { status: shown.state ?? seat.status, handle: dispatchId, terminal: shown.terminal, facts: { adopted: { dispatchId, state: shown.state } } }); })
        return `${workflow.id}: Kernel launch adopted (dispatch ${dispatchId} is ${shown.state})`
    }
    if (!gone && !(unstarted && olderThan(seat.startedAt, stall.startDeadlineMinutes))) return null
    await closeWorker(binary, dispatchId, cwd, shown?.terminal ?? seat.terminal)
    withLedger(root, (db) => { recordSeat(db, seat.id, { status: SEAT_LAUNCH_FAILED, handle: dispatchId, facts: { deadOnArrival: { states } } }); })
    const stalled = seat.agent === null ? [] : [{ agent: seat.agent, model: seat.model ?? "" }]
    return relaunch(root, binary, cwd, workflow, `Kernel launch ${seat.id} never started (${states.join("/") || "unknown"})`, { replace: false, acting, stalled }, rules)
}

/**
 * Relaunches a Kernel, or, once kernelRelaunchMax relaunches came with no progress since the first of them, pauses its workflow
 * and escalates to the owner instead: a Kernel that dies at every launch stops being relaunched however far apart they fall.
 */
const relaunch = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, why: string, options: { readonly replace: boolean; readonly acting: AttachedSupervisor; readonly stalled?: readonly RouteMember[] }, rules: CoordinatorLiveness): Promise<string> => {
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
    const started = await startKernel(root, cwd, workflow.id, binary, { replace: options.replace, acting: options.acting, stalled: options.stalled ?? [] })
    const member = started.seat === null ? "-" : `${started.seat.agent ?? "?"}/${started.seat.model ?? "?"}`
    withLedger(root, (db) => { recordEvent(db, "kernel-relaunched", workflow.id, { why, seat: started.seat?.id ?? null, member, avoided: options.stalled ?? [] }); })
    return `${workflow.id}: relaunched its Kernel as ${member} (${why}) in ${started.worktree ?? "-"}`
}

/** The node states a Kernel's driver acts on: a Kernel idle at its prompt while one of them stands has work pending. */
const ACTIONABLE: readonly NodeState[] = ["ready", "queued", "reported", "returned", "failed", "lost", "launch-unknown"]

/** A workflow whose Kernel has work pending: an open decision, or a node its driver acts on. */
const kernelPending = (db: DatabaseSync, workflowId: string): boolean => openDecisions(db, "kernel", workflowId).length > 0 || snapshotOf(db, workflowId).views.some((view) => ACTIONABLE.includes(view.state))

/** A coordinator's last driver call: its lease's renewal (every attach, next and submit), else its launch. */
/** The ledger file a project's outcomes are keyed by. */
const ledgerFileOf = (root: string): string => ledgerPath(root) ?? root

const lastCallOf = (leaseUntil: string | null, leaseMinutes: number, startedAt: string): string => (leaseUntil === null ? startedAt : new Date(Date.parse(leaseUntil) - leaseMinutes * 60_000).toISOString())

/**
 * The stall ladder of one Kernel seat that is alive by Orca's word: idle at its prompt (stall rules) with work pending and no
 * driver call for stall.idleMinutes, it is nudged with its loop prompt; a nudge unanswered past nudgeGraceMinutes, or a stall
 * after nudgeMax nudges, gives it up: its member records a `stalled` outcome (seat evidence and the provider circuit, by the
 * kind Orca's failure words name, else `stall`), and the Kernel is relaunched with that member behind every other.
 */
const kernelStall = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, seat: SeatRow, inventory: TerminalInventory | null, rules: CoordinatorLiveness, acting: AttachedSupervisor): Promise<string | null> => {
    const stall = loadStallRules()
    if (seat.handle === null || seat.terminal === null) return null
    const { pending, nudges } = withLedger(root, (db) => ({ pending: kernelPending(db, workflow.id), nudges: nudgesOf(db, seat.id) }))
    const lastCall = lastCallOf(seat.leaseUntil, rules.seatLeaseMinutes, seat.startedAt)
    if (!pending || !olderThan(lastCall, stall.idleMinutes)) return null
    const signals = await askIdle(binary, cwd, { terminal: seat.terminal, handle: seat.handle }, inventory, stall)
    if (signals.idle !== true) return null
    const step = stallStep(lastCall, nudges, stall)
    if (step.kind === "wait") return `${workflow.id}: Kernel idle at its prompt (${signals.evidence.join("; ")}); ${step.detail}`
    if (step.kind === "nudge") {
        const text = promptOf(stall.prompts.kernel, { workflow: workflow.id, launch: seat.id })
        if (!withLedger(root, (db) => claimNudge(db, workflow.id, seat.id, step.n, { role: "kernel", lastCall, evidence: signals.evidence }))) return null
        await sendNudge(binary, cwd, { id: seat.id, terminal: seat.terminal }, step.n, text)
        return `${workflow.id}: Kernel idle at its prompt with work pending (${signals.evidence.join("; ")}): nudge ${String(step.n)} of ${String(stall.nudgeMax)}`
    }
    const kind = stallKindOf(signals.failureText)
    const agent = seat.agent ?? "?"
    withLedger(root, (db) => { recordEvent(db, STALL_GAVE_UP, workflow.id, { seat: seat.id, role: "kernel", member: `${agent}/${seat.model ?? "?"}`, kind, why: step.detail, failure: signals.failureText }); })
    recordSeatOutcome({ ledger: ledgerFileOf(root), id: seat.id, agent, model: seat.model, role: "kernel", startedAt: seat.startedAt })
    reportStalled(agent, kind, `Kernel of ${workflow.id} ${step.detail}${signals.failureText === null ? "" : `: ${signals.failureText}`}`)
    const stalled = seat.agent === null ? [] : [{ agent: seat.agent, model: seat.model ?? "" }]
    return relaunch(root, binary, cwd, workflow, `stalled (${kind}): ${step.detail}`, { replace: true, acting, stalled }, rules)
}

/**
 * The Kernel sweep of one project: every orca workflow the Supervisor owns (its recorded coordinator, set when `kernel start` or
 * `workflow start` launched its Kernel) keeps exactly one live Kernel, by Orca's word. A workflow nobody gave the Supervisor, or
 * one still driven from a Kernel terminal another session adopted (Orca does not report it gone), is never touched. A Kernel Orca
 * reports gone (or silent past its TTL) is relaunched; a live one idle at its prompt with work pending meets the stall ladder.
 * `ops` also runs each owned workflow's Op stall ladder (the host driver's sweep, which needs no Kernel to be awake).
 */
const sweepKernels = async (root: string, binary: OrcaBinary, cwd: string, rules: CoordinatorLiveness, acting: AttachedSupervisor, ops: boolean): Promise<string[]> => {
    const owned = withLedger(root, (db) =>
        listWorkflows(db)
            .filter((workflow) => isCoordinated(workflow) && coordinatorOf(db, workflow.id) === SUPERVISOR_COORDINATOR)
            .map((workflow) => ({ workflow, seat: kernelSeatOf(db, workflow.id), progress: lastProgress(db, workflow.id), foreign: foreignKernelTerminal(db, workflow) })),
    )
    const live = owned.length > 0 ? await terminalList(binary, cwd).catch(() => null) : null
    const workflows = owned.filter(({ foreign }) => foreign === null || (live !== null && !live.truncated && !live.handles.has(foreign)))
    const done = await inOrder(workflows, async ({ workflow, seat, progress }): Promise<string[]> => {
        const lines: string[] = []
        try {
            if (seat?.handle === null) lines.push((await resolveKernelLaunch(root, binary, cwd, workflow, seat, rules, acting)) ?? "")
            else {
                const reason = await relaunchReason(binary, cwd, seat, progress, rules)
                if (reason !== null) lines.push(await relaunch(root, binary, cwd, workflow, reason.why, { replace: reason.replace, acting }, rules))
                else if (seat !== undefined) lines.push((await kernelStall(root, binary, cwd, workflow, seat, live, rules, acting)) ?? "")
            }
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            lines.push(`${workflow.id}: Kernel not relaunched (${refusal.code}): ${refusal.message.split("\n")[0] ?? ""}`)
        }
        if (ops && workflow.status !== "paused") lines.push(...(await sweepOpStalls(root, binary, cwd, workflow.id, live)).map((action) => `${workflow.id}: ${action.task ?? "-"} ${action.detail}`))
        return lines.filter((line) => line !== "")
    })
    return done.flat()
}

const oldestDecision = (): SupervisorDecision | undefined => {
    const all = registeredProjects().flatMap((project) => withLedger(project, (db) => openDecisions(db, "supervisor").map((decision) => ({ ...decision, project }))))
    return all.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))[0]
}

/**
 * `supervisor next`: the Supervisor's own driver. From its terminal it sweeps every project's workflows the Supervisor owns (a
 * Kernel with a lapsed lease and no progress past kernelTtlMinutes is relaunched on Orca's word, a live one idle at its prompt
 * with work pending meets the stall ladder; a launch with no receipt is resolved through request-show; too many relaunches pause
 * and escalate), then returns the oldest open escalation or handoff, else waits on the Supervisor Run's mailbox until
 * nextWaitSeconds pass and returns idle. From anywhere else the decisions are only read; `supervisor tick` sweeps for it.
 */
export const supervisorNext = async (context: VerbContext, waitSeconds?: number): Promise<SupervisorNext> => {
    const rules = loadCoordinatorLiveness()
    const deadline = Date.now() + (waitSeconds ?? rules.nextWaitSeconds) * 1000
    const seat = supervisorRecord()
    const attached: AttachedSupervisor | null = inSupervisorTerminal(seat) ? seat : null
    const binary = attached === null ? null : await locateOrca(context.cwd).catch(() => null)
    const actions: string[] = []
    let delivery: string | undefined
    for (;;) {
        if (attached !== null) renewSupervisorLease(attached.id)
        if (attached !== null && binary !== null) for (const project of registeredProjects()) actions.push(...(await sweepKernels(project, binary, context.cwd, rules, attached, false)))
        const decision = oldestDecision()
        if (decision !== undefined) {
            const digest = withLedger(decision.project, (db) => digestOf(db, decision.workflowId))
            return { kind: decision.kind === "handoff" ? "handoff" : "escalation", decision, digest, actions }
        }
        const left = deadline - Date.now()
        if (left <= 0) return { kind: "idle", decision: null, digest: null, actions }
        const waitMs = Math.min(rules.nextPollSeconds * 1000, left)
        if (attached === null || binary === null) await sleep(waitMs)
        else {
            try {
                const batch = await mailCheck(binary, { terminal: attached.terminal, run: attached.run_id, ack: delivery, waitMs }, context.cwd)
                delivery = batch.deliveryId ?? undefined
            } catch (error: unknown) {
                actions.push(`mailbox not read (${asRefusal(error).code}); the ledgers are read anyway`)
                await sleep(waitMs)
            }
        }
    }
}

const recordHostEvent = (kind: string, subject: string, data: unknown): void => {
    withMachine((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), kind, subject, JSON.stringify(data)))
}

const hostEventsOf = (kind: string, subject: string): { readonly at: string; readonly data: unknown }[] =>
    readMachine((db) => db.prepare("SELECT at, data_json FROM host_events WHERE kind = ? AND subject = ? ORDER BY id").all(kind, subject), []).map((row) => ({ at: String(row.at), data: JSON.parse(String(row.data_json)) as unknown }))

const decisionOf = (data: unknown): unknown => (typeof data === "object" && data !== null && "decision" in data ? data.decision : null)

/**
 * The stall ladder of the Supervisor seat: idle at its prompt (stall rules) while an escalation or handoff waits and no driver call
 * came for stall.idleMinutes, it is nudged with its loop prompt; a nudge unanswered past nudgeGraceMinutes, or a stall after
 * nudgeMax nudges, gives it up: its member records a `stalled` outcome and the Supervisor is replaced by a new launch with that
 * member behind every other. Once kernelRelaunchMax replacements left the same decision waiting, the tick stops replacing and
 * reports it for the owner.
 */
const supervisorStall = async (binary: OrcaBinary, cwd: string, seat: AttachedSupervisor, inventory: TerminalInventory | null, rules: CoordinatorLiveness): Promise<string | null> => {
    const stall = loadStallRules()
    const decision = oldestDecision()
    const lastCall = lastCallOf(seat.lease_until, rules.supervisorTtlMinutes, seat.started_at)
    if (decision === undefined || !olderThan(lastCall, stall.idleMinutes)) return null
    const signals = await askIdle(binary, cwd, { terminal: seat.terminal, handle: null }, inventory, stall)
    if (signals.idle !== true) return null
    const step = stallStep(lastCall, hostEventsOf(STALL_NUDGED, seat.id).map((event) => event.at), stall)
    if (step.kind === "wait") return `Supervisor idle at its prompt with ${decision.id} waiting (${signals.evidence.join("; ")}); ${step.detail}`
    if (step.kind === "nudge") {
        const claimed = withMachine((db) => {
            if (Number(db.prepare("SELECT COUNT(*) AS n FROM host_events WHERE kind = ? AND subject = ?").get(STALL_NUDGED, seat.id)?.n ?? 0) !== step.n - 1) return false
            db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), STALL_NUDGED, seat.id, JSON.stringify({ n: step.n, lastCall, decision: decision.id, evidence: signals.evidence }))
            return true
        })
        if (!claimed) return null
        await sendNudge(binary, cwd, { id: seat.id, terminal: seat.terminal }, step.n, stall.prompts.supervisor)
        return `Supervisor idle at its prompt with ${decision.id} waiting (${signals.evidence.join("; ")}): nudge ${String(step.n)} of ${String(stall.nudgeMax)}`
    }
    const replaced = readMachine((db) => db.prepare("SELECT data_json FROM host_events WHERE kind = ?").all(STALL_GAVE_UP), []).filter((row) => decisionOf(JSON.parse(String(row.data_json))) === decision.id).length
    if (replaced >= rules.kernelRelaunchMax) return `Supervisor stalled again with ${decision.id} waiting after ${String(replaced)} replacements: left for the owner (starci supervisor status)`
    const kind = stallKindOf(signals.failureText)
    recordHostEvent(STALL_GAVE_UP, seat.id, { member: `${seat.agent}/${seat.model}`, kind, why: step.detail, decision: decision.id, failure: signals.failureText })
    recordSeatOutcome({ ledger: "machine", id: seat.id, agent: seat.agent, model: seat.model, role: "supervisor", startedAt: seat.started_at })
    reportStalled(seat.agent, kind, `Supervisor ${step.detail}${signals.failureText === null ? "" : `: ${signals.failureText}`}`)
    await stopSupervisor(binary, cwd, false)
    const started = await startSupervisor(binary, cwd, [{ agent: seat.agent, model: seat.model }])
    return `Supervisor stalled (${kind}, ${step.detail}): replaced by ${started.agent}/${started.model}`
}

/** What one `supervisor tick` did: the Supervisor's ensure, and every action of its sweeps. */
export interface SupervisorTick {
    readonly supervisor: SupervisorEnsured | null
    readonly swept: boolean
    readonly actions: readonly string[]
}

/**
 * `supervisor tick`: one deterministic pass of the host driver, idempotent and safe to run every minute, with no LLM awake. It
 * keeps one Supervisor (ensure: started when Orca says it is gone), and while that Supervisor is attached and alive it acts for
 * it: every project's owned workflows get the Kernel sweep (relaunch on Orca's word, the relaunch limit, a Kernel launch with no
 * receipt) and the stall ladder for their Kernels and Ops, and the Supervisor's own seat the stall ladder. Every action is an
 * event (project ledger, or host_events for the Supervisor and the tick).
 */
export const supervisorTick = async (context: VerbContext): Promise<SupervisorTick> => {
    const rules = loadCoordinatorLiveness()
    const binary = await locateOrca(context.cwd)
    const actions: string[] = []
    let ensured: SupervisorEnsured | null = null
    try {
        ensured = await ensureSupervisor(binary, context.cwd)
        if (ensured.action !== "none") actions.push(`Supervisor ${ensured.liveness}: ${ensured.action}, ${ensured.detail}`)
    } catch (error: unknown) {
        actions.push(`Supervisor not ensured (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
    }
    const seat = supervisorRecord()
    const swept = isAttached(seat) && ensured?.liveness === "alive"
    if (swept && isAttached(seat)) {
        for (const project of registeredProjects()) actions.push(...(await sweepKernels(project, binary, context.cwd, rules, seat, true)))
        try {
            const line = await supervisorStall(binary, context.cwd, seat, await terminalList(binary, context.cwd).catch(() => null), rules)
            if (line !== null) actions.push(line)
        } catch (error: unknown) {
            actions.push(`Supervisor stall ladder stopped (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
        }
        if (actions.length > 0) recordHostEvent("supervisor-tick", seat.id, { actions })
    } else actions.push(`no attached live Supervisor (${ensured?.liveness ?? "unknown"}): nothing swept until it attaches`)
    return { supervisor: ensured, swept, actions }
}

/** Wakes a workflow's Kernel by mail (`dispatch:<its dispatch>`); the decision in the ledger is the content. */
const wakeKernel = async (root: string, cwd: string, command: Command, decision: string): Promise<string> => {
    const seat = withLedger(root, (db) => kernelSeatOf(db, command.workflow))
    const supervisor = supervisorRecord()
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
    (command.answers ?? [])
        .map((id) => getDecision(db, id))
        .filter((decision): decision is Decision => decision !== undefined && decision.workflowId !== command.workflow)
        .map((decision) => raiseDecision(db, { scope: "kernel", workflowId: decision.workflowId, kind: "escalation-answer", subject: command.cmdId, evidence: { answers: decision.id, ruling: command.note ?? null, by: command.kind, workflow: command.workflow, goal: command.goal ?? null } }))

const raiseForKernel = (db: DatabaseSync, root: string, command: Command): string => {
    const answered = (command.answers ?? []).map((id) => getDecision(db, id)).filter((decision) => decision !== undefined)
    answerOtherWorkflows(db, command)
    const own: KernelDecisionKind = command.kind === "goal" ? "goal" : command.kind === "goal-change" ? "goal-change" : "done"
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
 * `workflow stop`), and the escalations it answers close with it.
 */
export const supervisorSubmit = async (context: VerbContext, file: string): Promise<{ readonly command: unknown; readonly replay: boolean; readonly project: string }> => {
    const parsed = readCommand(file, "supervisor")
    const { command } = parsed
    const root = await repositoryRoot(command.project === undefined ? context.cwd : resolve(dirname(file), command.project))
    if (command.kind === "goal" && withLedger(root, (db) => db.prepare("SELECT 1 FROM commands WHERE workflow_id = ? AND kind = 'goal' AND status = 'applied'").get(command.workflow)) !== undefined) {
        throw new Refusal("GOAL_EXISTS", `workflow ${command.workflow} has its goal; change it with a goal-change based on its goal version`)
    }
    const admitted = withLedger(root, (db) => admitCommand(db, "supervisor", parsed))
    if (admitted.kind === "replay") return { command: admitted.row, replay: true, project: root }
    let outcome: unknown
    try {
        outcome = await applySupervisor(context, root, command, parsed.sha256)
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        withLedger(root, (db) => finishCommand(db, "supervisor", command, "failed", { code: refusal.code, message: refusal.message }))
        throw error
    }
    const row = withLedger(root, (db) => finishCommand(db, "supervisor", command, "applied", outcome))
    const seat = supervisorRecord()
    if (inSupervisorTerminal(seat)) renewSupervisorLease(seat.id)
    return { command: row, replay: false, project: root }
}
