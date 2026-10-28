import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { admitCommand, answerDecision, awaitsOwner, finishCommand, getDecision, goalVersionOf, ledgerAnswers, openDecisions, raiseDecision, readCommand } from "../../harness/coordinator-commands.js"
import type { Command, Decision, KernelDecisionKind } from "../../harness/coordinator-commands.js"
import { loadCoordinatorLiveness, olderThan } from "../../harness/coordinator-liveness.js"
import type { CoordinatorLiveness } from "../../harness/coordinator-liveness.js"
import { GOAL_CHANGE_SCHEMA, recordGoalChange } from "../../harness/goal.js"
import type { GoalChange } from "../../harness/goal.js"
import { coordinatorOf, foreignKernelTerminal, launchKernelSeat, startKernel, SUPERVISOR_COORDINATOR } from "../../harness/kernel.js"
import type { NodeState } from "../../harness/graph.js"
import { deadOnArrivalFailure, openBlockedPrompts } from "../../harness/launch-failure.js"
import { ledgerPath, now, openLedger } from "../../harness/ledger.js"
import { inTransaction } from "../../harness/leases.js"
import { loadLiveness } from "../../harness/liveness.js"
import { readMachine, textOf, withMachine } from "../../harness/machine.js"
import { recordSeatOutcome } from "../../harness/outcomes.js"
import { assertOwnerRequests, closeOwnerRequests, isOwnerRequestId, openOwnerRequests, ownerRequestProjects } from "../../harness/owner-requests.js"
import type { OwnerRequest } from "../../harness/owner-requests.js"
import { closeWorker, locateOrca, mailCheck, mailSend, requestIdOf, requestShow, terminalList, workerShow } from "../../harness/orca/client.js"
import type { OrcaBinary, TerminalInventory, WorkerStartInput } from "../../harness/orca/client.js"
import type { RouteMember } from "../../harness/router.js"
import { kernelSeatOf, recordSeat, SEAT_LAUNCH_FAILED } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { askIdle, claimNudge, loadStallRules, nudgesOf, promptOf, reportStalled, sendNudge, STALL_GAVE_UP, STALL_NUDGED, stallKindOf, stallStep } from "../../harness/stall.js"
import { ensureSupervisor, hostSupervisors, inSupervisorTerminal, isAttached, keptProjects, liveSupervisors, projectOfRecord, renewSupervisorLease, retireHostSupervisor, startSupervisor, stopSupervisor, supervisorRecord, supervisorTitle } from "../../harness/supervisor.js"
import type { AttachedSupervisor, SupervisorEnsured } from "../../harness/supervisor.js"
import { sweepTerminals } from "../../harness/terminal-sweep.js"
import type { SweptTerminal } from "../../harness/terminal-sweep.js"
import { recordEvent } from "../../harness/tasks.js"
import { projectOf } from "../../harness/work.js"
import type { Project } from "../../harness/work.js"
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

/** What `supervisor next` returns: one decision (escalation or handoff) with its workflow digest, one owner request, or idle. */
export interface SupervisorNext {
    readonly kind: "escalation" | "handoff" | "owner-request" | "idle"
    readonly decision: SupervisorDecision | null
    readonly digest: Digest | null
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

/** The repositories whose ledgers the host registry lists and that exist. */
export const registeredRepositories = (): string[] =>
    readMachine((db) => db.prepare("SELECT repo_root, file FROM ledgers WHERE state != 'retired'").all(), [])
        .filter((row) => existsSync(textOf(row.file) ?? "") && existsSync(textOf(row.repo_root) ?? ""))
        .map((row) => textOf(row.repo_root) ?? "")

/** The registered repositories of one project (`projectOf` each: the Work root and its sides); a repository whose binding is unfit is reported, never swept. */
export const projectRepositories = async (project: Project): Promise<{ readonly repos: readonly string[]; readonly problems: readonly string[] }> => {
    const repos: string[] = []
    const problems: string[] = []
    await inOrder(registeredRepositories(), async (repo) => {
        try {
            if ((await projectOf(repo)).key === project.key) repos.push(repo)
        } catch (error: unknown) {
            problems.push(`${repo}: no project (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
        }
    })
    return { repos, problems }
}

/** A project given by `--project <path>`, else the project of the working directory. */
export const projectFrom = async (context: VerbContext, project: string | undefined, mint = true): Promise<Project> => projectOf(project === undefined ? context.cwd : resolve(context.cwd, project), mint)

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
 * Resolves a Kernel launch with no dispatch on its seat through Orca. A completed request whose receipt names a dispatch is
 * judged by that dispatch: a started worker is adopted; one that never started past stall.startDeadlineMinutes (or is gone) is
 * closed and the Kernel relaunched with that member behind every other. A completed request with no dispatch is replayed;
 * an absent one past the deadline is an escalation.
 */
const resolveKernelLaunch = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow): Promise<string | null> => {
    const { root, binary, cwd, rules } = scope
    if (seat.requestId === null || seat.handle !== null) return null
    const shownRequest = await requestShow(binary, seat.requestId, cwd).catch(() => null)
    const state = shownRequest?.state ?? "unknown"
    if (state === "completed" && shownRequest?.dispatchId != null) return judgeKernelDispatch(scope, workflow, seat, shownRequest.dispatchId)
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
const judgeKernelDispatch = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow, dispatchId: string): Promise<string | null> => {
    const { root, binary, cwd, rules, acting } = scope
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
    const failure = deadOnArrivalFailure(stallKindOf(shown?.failureText ?? null), states, shown?.failureText ?? null, shown?.terminal ?? seat.terminal)
    withLedger(root, (db) => { recordSeat(db, seat.id, { status: SEAT_LAUNCH_FAILED, handle: dispatchId, failure, facts: { deadOnArrival: { states, failure: shown?.failureText ?? null } } }); })
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
 * kind Orca's failure words name, else `stall`), and the Kernel is relaunched with that member behind every other.
 */
const kernelStall = async (scope: SweepScope, workflow: WorkflowRow, seat: SeatRow, inventory: TerminalInventory | null): Promise<string | null> => {
    const { root, binary, cwd, rules, acting } = scope
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
    reportStalled(agent, kind, `Kernel of ${workflow.id} ${step.detail}${signals.failureText === null ? "" : ": " + signals.failureText}`)
    const stalled = seat.agent === null ? [] : [{ agent: seat.agent, model: seat.model ?? "" }]
    return relaunch(root, binary, cwd, workflow, `stalled (${kind}): ${step.detail}`, { replace: true, acting, stalled }, rules)
}

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

/**
 * The Kernel sweep of one repository of the Supervisor's project: every orca workflow the Supervisor owns (its recorded
 * coordinator, set when `kernel start` or `workflow start` launched its Kernel) keeps exactly one live Kernel, by Orca's word. A
 * workflow nobody gave a Supervisor, or one still driven from a Kernel terminal another session adopted (Orca does not report it
 * gone), is never touched. A workflow a host Supervisor launched is adopted first (`adoptFromHost`). A Kernel Orca reports gone
 * (or silent past its TTL) is relaunched; a live one idle at its prompt with work pending meets the stall ladder. `ops` also runs
 * each owned workflow's Op stall ladder (the host driver's sweep, which needs no Kernel to be awake).
 */
const sweepKernels = async (root: string, binary: OrcaBinary, cwd: string, rules: CoordinatorLiveness, acting: AttachedSupervisor, ops: boolean): Promise<string[]> => {
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
            if (!adoption.moved && seat?.handle === null) lines.push((await resolveKernelLaunch(scope, workflow, seat)) ?? "")
            else if (!adoption.moved) {
                const reason = await relaunchReason(binary, cwd, seat, progress, rules)
                if (reason !== null) lines.push(await relaunch(root, binary, cwd, workflow, reason.why, { replace: reason.replace, acting }, rules))
                else if (seat !== undefined) lines.push((await kernelStall(scope, workflow, seat, live)) ?? "")
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

/**
 * The project's open Supervisor decisions in the order `supervisor next` returns them: the ones the Supervisor rules, oldest
 * first, then the ones awaiting the owner (`awaitsOwner`), so an owner's question never holds the others back.
 */
const openSupervisorDecisions = (repos: readonly string[]): SupervisorDecision[] =>
    repos
        .flatMap((project) => withLedger(project, (db) => openDecisions(db, "supervisor").map((decision) => ({ ...decision, project }))))
        .toSorted((a, b) => Number(awaitsOwner(a)) - Number(awaitsOwner(b)) || a.raisedAt.localeCompare(b.raisedAt))

/**
 * `supervisor next`: a Supervisor's own driver, for one project. From its terminal it sweeps the workflows it owns in every
 * repository of its project (a Kernel with a lapsed lease and no progress past kernelTtlMinutes is relaunched on Orca's word, a
 * live one idle at its prompt with work pending meets the stall ladder; a launch with no receipt is resolved through
 * request-show; too many relaunches pause and escalate), then returns the project's next open escalation or handoff it rules
 * (`openSupervisorDecisions`), else its oldest owner request (`supervisor ask`), else one awaiting the owner, else waits
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
    const round = async (delivery: string | undefined): Promise<SupervisorNext> => {
        if (attached !== null) renewSupervisorLease(attached.id)
        const { repos, problems } = await projectRepositories(project)
        actions.push(...problems.filter((problem) => !actions.includes(problem)))
        if (attached !== null && binary !== null) actions.push(...(await inOrder(repos, (repo) => sweepKernels(repo, binary, context.cwd, rules, attached, false))).flat())
        const decisions = openSupervisorDecisions(repos)
        const request = openOwnerRequests(project.key)[0]
        const decision = decisions.find((open) => request === undefined || !awaitsOwner(open))
        if (decision !== undefined) {
            const digest = withLedger(decision.project, (db) => digestOf(db, decision.workflowId))
            return { kind: decision.kind === "handoff" ? "handoff" : "escalation", decision, digest, request: null, actions }
        }
        if (request !== undefined) return { kind: "owner-request", decision: null, digest: null, request, actions }
        const left = deadline - Date.now()
        if (left <= 0) return { kind: "idle", decision: null, digest: null, request: null, actions }
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
 * request waits (a decision awaiting the owner is not its work: it waits for the owner's answer) and
 * no driver call came for stall.idleMinutes, it is nudged with its loop prompt; a nudge unanswered past nudgeGraceMinutes, or a
 * stall after nudgeMax nudges, gives it up: its member records a `stalled` outcome and the project's Supervisor is replaced by a
 * new launch with that member behind every other. Once kernelRelaunchMax replacements left the same decision waiting, the tick
 * stops replacing and reports it for the owner.
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
        await sendNudge(binary, cwd, { id: seat.id, terminal: seat.terminal }, step.n, stall.prompts.supervisor)
        return `${title} idle at its prompt with ${decision.id} waiting (${signals.evidence.join("; ")}): nudge ${String(step.n)} of ${String(stall.nudgeMax)}`
    }
    const replaced = readMachine((db) => db.prepare("SELECT data_json FROM host_events WHERE kind = ?").all(STALL_GAVE_UP), []).filter((row) => decisionOf(JSON.parse(String(row.data_json))) === decision.id).length
    if (replaced >= rules.kernelRelaunchMax) return `${title} stalled again with ${decision.id} waiting after ${String(replaced)} replacements: left for the owner (starci supervisor status)`
    const kind = stallKindOf(signals.failureText)
    recordHostEvent(STALL_GAVE_UP, seat.id, { member: `${seat.agent}/${seat.model}`, kind, why: step.detail, project: project.key, decision: decision.id, failure: signals.failureText })
    recordSeatOutcome({ ledger: "machine", id: seat.id, agent: seat.agent, model: seat.model, role: "supervisor", startedAt: seat.started_at })
    reportStalled(seat.agent, kind, `${title} ${step.detail}${signals.failureText === null ? "" : ": " + signals.failureText}`)
    await stopSupervisor(binary, cwd, project, false, "stalled")
    const started = await startSupervisor(binary, cwd, project, [{ agent: seat.agent, model: seat.model }])
    return `${title} stalled (${kind}, ${step.detail}): replaced by ${started.agent}/${started.model}`
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
const blockedPromptLines = (root: string): string[] =>
    ledgerPath(root) === undefined ? [] : withLedger(root, (db) => openBlockedPrompts(db).map((decision) => `BLOCKED PROMPT (${decision.id}, ${decision.workflowId}): ${questionOf(decision)}`))

/**
 * `supervisor tick`: one deterministic pass of the host driver, idempotent and safe to run every minute, with no LLM awake. It
 * keeps every project's Supervisor (`ensureSupervisors`), retires a version-2 host Supervisor Orca reports gone, and for each
 * Supervisor attached and alive it acts for it, over its project only: the owned workflows of the project's repositories get the
 * Kernel sweep (adoption from a host Supervisor, relaunch on Orca's word, the relaunch limit, a Kernel launch with no receipt) and
 * the stall ladder for their Kernels and Ops, and the Supervisor's own seat the stall ladder. Every open blocked-prompt escalation
 * is named on each tick until answered. Every action is an event (project ledger, or host_events for a Supervisor and the tick).
 * Before all of it, the terminal sweep (`sweepTerminals`) closes every harness terminal no open seat or live Supervisor holds and
 * every orphaned one, so an orphaned Supervisor is relaunched in the same pass. `dryRun` reports what that sweep would close and
 * does nothing else.
 */
export const supervisorTick = async (context: VerbContext, dryRun = false): Promise<SupervisorTick> => {
    const rules = loadCoordinatorLiveness()
    const binary = await locateOrca(context.cwd)
    const terminals = await sweepTerminals(binary, context.cwd, registeredRepositories(), dryRun)
    const closures = terminals.map((one) => `${dryRun ? "would close" : `closed (${one.outcome})`} terminal ${one.handle} "${one.title ?? ""}": ${one.why}`)
    if (dryRun) return { supervisors: [], swept: [], terminals, actions: closures }
    for (const one of terminals) recordHostEvent("terminal-swept", one.handle, one)
    const { ensured, problems } = await ensureSupervisors(binary, context.cwd)
    const actions: string[] = [...closures, ...problems]
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
        lines.push(...unresolved, ...(await inOrder(repos, (repo) => sweepKernels(repo, binary, context.cwd, rules, seat, true))).flat())
        lines.push(...repos.flatMap(blockedPromptLines))
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
