import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { admitCommand, finishCommand, getDecision, goalVersionOf, openDecisions, raiseDecision, readCommand } from "../../harness/coordinator-commands.js"
import type { Command, Decision, KernelDecisionKind } from "../../harness/coordinator-commands.js"
import { loadCoordinatorLiveness, olderThan } from "../../harness/coordinator-liveness.js"
import type { CoordinatorLiveness } from "../../harness/coordinator-liveness.js"
import { GOAL_CHANGE_SCHEMA, recordGoalChange } from "../../harness/goal.js"
import type { GoalChange } from "../../harness/goal.js"
import { launchKernelSeat, startKernel } from "../../harness/kernel.js"
import { now, openLedger } from "../../harness/ledger.js"
import { inTransaction } from "../../harness/leases.js"
import { loadLiveness } from "../../harness/liveness.js"
import { readMachine, textOf } from "../../harness/machine.js"
import { locateOrca, mailCheck, mailSend, requestIdOf, requestShow, workerShow } from "../../harness/orca/client.js"
import type { OrcaBinary, WorkerStartInput } from "../../harness/orca/client.js"
import { kernelSeatOf } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { inSupervisorTerminal, renewSupervisorLease, supervisorRecord } from "../../harness/supervisor.js"
import type { AttachedSupervisor } from "../../harness/supervisor.js"
import { recordEvent } from "../../harness/tasks.js"
import { DISPATCHING, getWorkflow, listWorkflows, setWorkflowStatus } from "../../harness/workflow.js"
import type { WorkflowRow } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import type { VerbContext } from "../../shared/verb.js"
import { inOrder } from "../../harness/sequential.js"
import { digestOf, RELAUNCH_LIMIT } from "../kernel/driver.js"
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

/** The last time anything happened to a workflow (its own events and its tasks'), the Kernel's progress clock. */
const lastProgress = (db: DatabaseSync, workflowId: string): string | null => {
    const row = db.prepare("SELECT MAX(at) AS at FROM events WHERE subject = ? OR subject IN (SELECT id FROM tasks WHERE workflow_id = ?)").get(workflowId, workflowId)
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

/** Resolves a Kernel launch with no dispatch receipt through Orca: completed -> replay; absent past the deadline -> an escalation. */
const resolveKernelLaunch = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, seat: SeatRow, rules: CoordinatorLiveness): Promise<string | null> => {
    if (seat.requestId === null || seat.handle !== null) return null
    const state = await requestShow(binary, seat.requestId, cwd).catch(() => "unknown")
    if (state === "completed") {
        await launchKernelSeat(root, cwd, seat.id, seat.launch as WorkerStartInput, binary)
        return `${workflow.id}: replayed the Kernel launch (request ${seat.requestId} completed)`
    }
    if (state !== "pending" && olderThan(seat.startedAt, rules.effectUnknownDeadlineMinutes)) {
        withLedger(root, (db) => raiseDecision(db, { scope: "supervisor", workflowId: workflow.id, kind: "escalation", subject: `stuck-launch:${seat.id}`, evidence: { project: root, escalation: { kind: "harness", question: `the Kernel launch ${seat.id} is unknown to Orca (request-show ${state}) past the deadline; check Orca, then seat stop it and kernel start` } } }))
        return `${workflow.id}: Kernel launch ${seat.id} stuck (${state})`
    }
    return null
}

/** Relaunches a Kernel, or past kernelRelaunchMax inside the window pauses its workflow and escalates to the owner. */
const relaunch = async (root: string, binary: OrcaBinary, cwd: string, workflow: WorkflowRow, why: string, replace: boolean, rules: CoordinatorLiveness): Promise<string> => {
    const since = new Date(Date.now() - rules.kernelRelaunchWindowMinutes * 60_000).toISOString()
    const limited = withLedger(root, (db) =>
        inTransaction(db, () => {
            const recent = db.prepare("SELECT id FROM events WHERE kind = 'kernel-relaunched' AND subject = ? AND at >= ? ORDER BY id DESC").all(workflow.id, since)
            if (recent.length < rules.kernelRelaunchMax) return null
            if (DISPATCHING.includes(getWorkflow(db, workflow.id).status) || getWorkflow(db, workflow.id).status === "paused") setWorkflowStatus(db, workflow.id, "paused", `${RELAUNCH_LIMIT}: ${String(recent.length)} relaunches in ${String(rules.kernelRelaunchWindowMinutes)} min`)
            return raiseDecision(db, { scope: "supervisor", workflowId: workflow.id, kind: "escalation", subject: `relaunch-limit:${String(recent[0]?.id)}`, evidence: { project: root, escalation: { kind: "owner", question: `the Kernel of ${workflow.id} was relaunched ${String(recent.length)} times in ${String(rules.kernelRelaunchWindowMinutes)} min (last: ${why}); the workflow is paused. Ask the owner, then workflow resume and kernel start.` } } })
        }),
    )
    if (limited !== null) return `${workflow.id}: relaunch limit reached, paused and escalated (${limited})`
    const started = await startKernel(root, cwd, workflow.id, binary, { replace })
    withLedger(root, (db) => { recordEvent(db, "kernel-relaunched", workflow.id, { why, seat: started.seat?.id ?? null }); })
    return `${workflow.id}: relaunched its Kernel (${why}) in ${started.worktree ?? "-"}`
}

/** The Kernel sweep of one project: every coordinated orca workflow keeps exactly one live Kernel, by Orca's word. */
const sweepKernels = async (root: string, binary: OrcaBinary, cwd: string, rules: CoordinatorLiveness): Promise<string[]> => {
    const workflows = withLedger(root, (db) => listWorkflows(db).filter(isCoordinated).map((workflow) => ({ workflow, seat: kernelSeatOf(db, workflow.id), progress: lastProgress(db, workflow.id) })))
    const done = await inOrder(workflows, async ({ workflow, seat, progress }): Promise<string | null> => {
        try {
            if (seat?.handle === null) return await resolveKernelLaunch(root, binary, cwd, workflow, seat, rules)
            const reason = await relaunchReason(binary, cwd, seat, progress, rules)
            return reason === null ? null : await relaunch(root, binary, cwd, workflow, reason.why, reason.replace, rules)
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            return `${workflow.id}: Kernel not relaunched (${refusal.code}): ${refusal.message.split("\n")[0] ?? ""}`
        }
    })
    return done.filter((line) => line !== null)
}

const oldestDecision = (): SupervisorDecision | undefined => {
    const all = registeredProjects().flatMap((project) => withLedger(project, (db) => openDecisions(db, "supervisor").map((decision) => ({ ...decision, project }))))
    return all.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))[0]
}

/**
 * `supervisor next`: the host's deterministic driver. It sweeps every project's coordinated workflows (a Kernel with a lapsed
 * lease and no progress past kernelTtlMinutes is relaunched on Orca's word; a launch with no receipt is resolved through
 * request-show; too many relaunches pause and escalate), then returns the oldest open escalation or handoff, else waits on the
 * Supervisor Run's mailbox until nextWaitSeconds pass and returns idle. Only the Supervisor's own terminal sweeps (it alone may
 * dispatch into its Run); from anywhere else the decisions are read.
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
        if (attached !== null && binary !== null) for (const project of registeredProjects()) actions.push(...(await sweepKernels(project, binary, context.cwd, rules)))
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
const raiseForKernel = (db: DatabaseSync, root: string, command: Command): string => {
    const answered = (command.answers ?? []).map((id) => getDecision(db, id)).filter((decision) => decision !== undefined)
    for (const decision of answered.filter((candidate) => candidate.workflowId !== command.workflow)) {
        raiseDecision(db, { scope: "kernel", workflowId: decision.workflowId, kind: "escalation-answer", subject: command.cmdId, evidence: { answers: decision.id, ruling: command.note ?? null, by: command.kind, workflow: command.workflow, goal: command.goal ?? null } })
    }
    const own: KernelDecisionKind = command.kind === "goal" ? "goal" : command.kind === "goal-change" ? "goal-change" : "done"
    const kind: KernelDecisionKind = answered.some((decision) => decision.workflowId === command.workflow) ? "escalation-answer" : own
    const goalVersion = goalVersionOf(db, command.workflow)
    return raiseDecision(db, { scope: "kernel", workflowId: command.workflow, kind, subject: command.cmdId, evidence: { project: root, cmdId: command.cmdId, command: command.kind, goal: command.goal ?? null, goalVersion, note: command.note ?? null, answers: command.answers ?? [] } })
}

const applySupervisor = async (context: VerbContext, root: string, command: Command, sha256: string): Promise<unknown> => {
    if (command.kind === "stop") {
        const stopped = await workflowStopVerb.run({ ...context, cwd: root }, { workflow: command.workflow, graceful: command.mode !== "hard", hard: command.mode === "hard" })
        const decision = (command.answers ?? []).length === 0 ? null : withLedger(root, (db) => raiseForKernel(db, root, command))
        return { stopped: stopped.message.split("\n")[0] ?? "", decision }
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
