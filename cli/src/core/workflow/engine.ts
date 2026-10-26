import type { DatabaseSync } from "node:sqlite"
import { writeBrief } from "../../harness/brief.js"
import type { NodeView, PlanNode } from "../../harness/graph.js"
import { openLedger } from "../../harness/ledger.js"
import { inTransaction } from "../../harness/leases.js"
import { loadOps } from "../../harness/ops.js"
import { askOrca, inLaunchGrace, isPingable, livenessOf, loadLiveness, recordPing } from "../../harness/liveness.js"
import { locateOrca } from "../../harness/orca/client.js"
import { seatsOfTask } from "../../harness/seats.js"
import { getTask } from "../../harness/tasks.js"
import { assertWorkflowBudget } from "../../harness/budget.js"
import { describeRoute, lineageOf, pickRoute, RouteRefusal } from "../../harness/router.js"
import type { RoutePick } from "../../harness/router.js"
import { createNodeTask, derivedStatus, DISPATCHING, setWorkflowStatus, SETTLING, snapshotOf, staleLiveTasks } from "../../harness/workflow.js"
import type { Snapshot, WorkflowRow, WorkflowStatus } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import type { VerbContext } from "../../shared/verb.js"
import { startSeat } from "../seat/start.js"
import { taskCancelVerb } from "../task/cancel.js"
import { taskVerifyVerb } from "../task/verify.js"

/** What one step did to one task: settled it, dispatched it, launched or cancelled it, or why it could not. */
export interface StepAction {
    readonly key: string | null
    readonly task: string | null
    readonly action: "verified" | "dispatched" | "launched" | "cancelled" | "lost" | "wait" | "problem"
    readonly detail: string
}

/** The task an inline run hands the chat agent next, with its brief and the commands that return it. */
export interface InlineNext {
    readonly key: string
    readonly task: string
    readonly summary: string
    readonly brief: string
    readonly output: string
    readonly commands: readonly string[]
}

/** A workflow after a step: its status and reason, every node's state, what this step did and the inline task to work next. */
export interface WorkflowReport {
    readonly workflow: string
    readonly runner: WorkflowRow["header"]["runner"]
    readonly status: WorkflowStatus
    readonly reason: string | null
    readonly graphVersion: number
    readonly nodes: readonly NodeView[]
    readonly actions: readonly StepAction[]
    readonly next: InlineNext | null
}

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** Reads a workflow's snapshot in a ledger connection of its own. */
export const readSnapshot = (root: string, id: string): Snapshot => withLedger(root, (db) => snapshotOf(db, id))

/** Moves the workflow to the status its nodes call for, in one transaction (a pause or stop is never overwritten), and returns the fresh snapshot. */
export const reconcile = (root: string, id: string): Snapshot =>
    withLedger(root, (db) =>
        inTransaction(db, () => {
            const snapshot = snapshotOf(db, id)
            const { status, reason } = derivedStatus(snapshot)
            setWorkflowStatus(db, id, status, reason)
            return snapshotOf(db, id)
        }),
    )

/**
 * Cancels tasks through `task cancel` (seats stopped and released, dirty paths preserved and reset, leases freed). A refusal
 * (a verify in flight, a worker Orca did not stop) is reported and the task stays live; the next step tries again.
 */
export const cancelTasks = async (context: VerbContext, tasks: readonly { readonly key: string | null; readonly task: string }[], reason: string): Promise<StepAction[]> => {
    const actions: StepAction[] = []
    for (const { key, task } of tasks) {
        try {
            const done = await taskCancelVerb.run(context, { task, reason })
            actions.push({ key, task, action: "cancelled", detail: done.message })
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            actions.push({ key, task, action: "problem", detail: `not cancelled (${refusal.code}): ${refusal.message}` })
        }
    }
    return actions
}

/**
 * Pings the worker seat of every running node past its launch grace (ops/liveness.yaml) and records each answer. Only Orca's
 * explicit word that a worker is gone marks its seat worker-lost and its task effect_unknown (the node turns lost and blocks
 * its dependents); an Orca that cannot tell is reported and nothing is concluded: unknown is not dead.
 */
const checkLiveness = async (context: VerbContext, root: string, snapshot: Snapshot): Promise<StepAction[]> => {
    const running = snapshot.views.flatMap((view) => (view.state === "running" && view.task !== null ? [{ key: view.key, task: view.task.id }] : []))
    if (running.length === 0) return []
    const rules = loadLiveness()
    const at = Date.now()
    const targets = withLedger(root, (db) =>
        running.flatMap((node) =>
            seatsOfTask(db, node.task)
                .filter((seat) => seat.role === "worker" && isPingable(seat) && !inLaunchGrace(seat, rules, at))
                .map((seat) => ({ ...node, seat: seat.id, handle: seat.handle ?? "" })),
        ),
    )
    if (targets.length === 0) return []
    let binary: Awaited<ReturnType<typeof locateOrca>>
    try {
        binary = await locateOrca(context.cwd)
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return [{ key: null, task: null, action: "problem", detail: `liveness not checked (${refusal.code}): ${refusal.message}` }]
    }
    const actions: StepAction[] = []
    for (const target of targets) {
        const answer = await askOrca(binary, target.handle, context.cwd, rules)
        const recorded = withLedger(root, (db) => recordPing(db, target.seat, answer))
        const verdict = livenessOf(recorded.seat, rules).verdict
        if (answer.kind === "gone") {
            const marked = recorded.lostTask === null ? "" : `; task ${recorded.lostTask} is effect_unknown and keeps its leases: cancel it (starci task cancel ${recorded.lostTask}) and amend with retry`
            actions.push({ key: target.key, task: target.task, action: "lost", detail: `seat ${target.seat} worker-lost: ${answer.evidence}${marked}` })
        } else if (answer.kind === "unknown") {
            const quiet = verdict === "quiet" ? `; quiet past ${String(rules.quietMinutes)} min, held` : ""
            actions.push({ key: target.key, task: target.task, action: "wait", detail: `seat ${target.seat}: Orca could not tell (${answer.why}); unknown is not dead${quiet}` })
        } else if (verdict === "stale") {
            actions.push({ key: target.key, task: target.task, action: "wait", detail: `seat ${target.seat} is stale: Orca answers but its terminal printed nothing for ${String(rules.activeStaleMinutes)} min or more` })
        }
    }
    return actions
}

/** Settles each reported node whose result is done through `task verify`: green commits its paths, red fails it. */
const settleReported = async (context: VerbContext, snapshot: Snapshot): Promise<StepAction[]> => {
    const actions: StepAction[] = []
    for (const view of snapshot.views) {
        if (view.state !== "reported" || view.task === null) continue
        try {
            const verified = await taskVerifyVerb.run(context, { task: view.task.id, contract: undefined, record: false, "no-commit": false, recover: false })
            const data = verified.data as { readonly verdict?: string; readonly status?: string; readonly checks?: readonly { readonly name: string; readonly status: string }[] }
            const red = (data.checks ?? []).filter((check) => check.status === "red").map((check) => check.name)
            actions.push({ key: view.key, task: view.task.id, action: "verified", detail: `verdict ${String(data.verdict)}, task ${String(data.status)}${red.length === 0 ? "" : `; red: ${red.join(", ")} (starci task status ${view.task.id})`}` })
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            // Another verifier took it first: that one settles it.
            actions.push({ key: view.key, task: view.task.id, action: refusal.code === "TASK_NOT_VERIFIABLE" ? "wait" : "problem", detail: `${refusal.code}: ${refusal.message}` })
        }
    }
    return actions
}

/** A launch: a pinned agent and model (the task's pair, else the workflow file's), or the router's pick. */
interface Launch {
    readonly agent: string
    readonly model: string
    readonly effort?: string | undefined
    readonly pick?: RoutePick | undefined
}

/**
 * The launch of a queued node task. A pin (the task's agent and model, else the workflow file's) is used as written; otherwise
 * the router picks from the task's label, the node's difficulty, its lineage (attempt number and contract-red members, through
 * the retry chain) and the workflow's bias. A refused pick is a wait: the task stays queued and the next step routes it again.
 */
const launchOf = (root: string, workflow: WorkflowRow, node: PlanNode, taskId: string): Launch | Refusal => {
    const { header } = workflow
    const effort = node.route.effort ?? header.effort
    if (node.route.agent !== undefined && node.route.model !== undefined) return { agent: node.route.agent, model: node.route.model, effort }
    if (header.agent !== undefined && header.model !== undefined) return { agent: header.agent, model: header.model, effort }
    const lineage = withLedger(root, (db) => lineageOf(db, taskId))
    const pick = pickRoute({ label: node.contract.label, difficulty: node.route.difficulty, attempt: lineage.attempts + 1, previousRed: lineage.reds, workflowBias: header.bias })
    if (pick instanceof RouteRefusal) return new Refusal(pick.code, [pick.message, ...describeRoute(pick)].join("; "))
    return { agent: pick.agent, model: pick.model, effort: effort ?? pick.effort, pick }
}

const launchTask = async (context: VerbContext, root: string, workflow: WorkflowRow, node: PlanNode, task: string): Promise<StepAction> => {
    const chosen = launchOf(root, workflow, node, task)
    if (chosen instanceof Refusal) return { key: node.key, task, action: "wait", detail: `no route (${chosen.code}): ${chosen.message}; the task stays queued` }
    try {
        const started = await startSeat({ root, cwd: context.cwd, task, agent: chosen.agent, model: chosen.model, effort: chosen.effort, pick: chosen.pick, worktree: workflow.header.worktree })
        const by = chosen.pick === undefined ? "pinned" : `routed (tier ${chosen.pick.tier}, pool ${chosen.pick.pool})`
        return { key: node.key, task, action: "launched", detail: `${chosen.agent}/${chosen.model} ${by}: ${started.message.split("\n")[0] ?? "launched"}` }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { key: node.key, task, action: "problem", detail: `launch refused (${refusal.code}): ${refusal.message}; the task stays queued and the next step launches it again` }
    }
}

// A node that cannot be dispatched now for one of these reasons waits for a later step; anything else is a problem to report.
const WAIT_CODES: readonly string[] = ["LEASE_CONFLICT", "NODE_TAKEN", "WORKFLOW_NOT_DISPATCHING"]

/**
 * Dispatches ready nodes in dependency order while the workflow has free slots (maxParallel for orca, one for inline) and
 * budget: each becomes a queued task holding its leases (a lease overlap is a wait). Then every queued orca task of the graph
 * gets its seat: the new ones, and any left queued by a launch that certainly failed or a refused route.
 */
const dispatchReady = async (context: VerbContext, root: string, snapshot: Snapshot): Promise<StepAction[]> => {
    const { workflow } = snapshot
    const actions: StepAction[] = []
    const orca = workflow.header.runner === "orca"
    let free = (orca ? workflow.header.maxParallel : 1) - snapshot.live
    for (const view of snapshot.views) {
        if (view.state !== "ready") continue
        if (free <= 0) {
            actions.push({ key: view.key, task: null, action: "wait", detail: orca ? `all ${String(workflow.header.maxParallel)} parallel slot(s) are taken` : "the inline run works one task at a time" })
            continue
        }
        const node = snapshot.nodes.find((candidate) => candidate.key === view.key)
        if (node === undefined) continue
        try {
            assertWorkflowBudget(root, workflow.id)
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            actions.push({ key: node.key, task: null, action: "wait", detail: `${refusal.code}: ${refusal.message}` })
            break
        }
        try {
            const task = withLedger(root, (db) => createNodeTask(db, workflow.id, node).task.id)
            free -= 1
            actions.push({ key: node.key, task, action: "dispatched", detail: orca ? "queued for a worker seat" : "queued for the chat agent" })
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            actions.push({ key: node.key, task: null, action: WAIT_CODES.includes(refusal.code) ? "wait" : "problem", detail: `${refusal.code}: ${refusal.message}` })
            if (refusal.code === "WORKFLOW_NOT_DISPATCHING") return actions
        }
    }
    if (!orca) return actions
    for (const view of readSnapshot(root, workflow.id).views) {
        const node = snapshot.nodes.find((candidate) => candidate.key === view.key)
        if (view.state !== "queued" || view.task === null || node === undefined) continue
        actions.push(await launchTask(context, root, workflow, node, view.task.id))
    }
    return actions
}

/** The inline task the chat agent works now: the node task that is queued or running, with its brief written. */
const inlineNext = (root: string, snapshot: Snapshot): InlineNext | null => {
    if (snapshot.workflow.header.runner !== "inline") return null
    const view = snapshot.views.find((candidate) => (candidate.state === "queued" || candidate.state === "running") && candidate.task !== null)
    if (view?.task == null) return null
    const id = view.task.id
    const task = withLedger(root, (db) => getTask(db, id))
    const files = writeBrief(task, loadOps(), root)
    const output = files.output.replace(/\\/g, "/")
    return {
        key: view.key,
        task: id,
        summary: task.contract.input.summary,
        brief: files.brief,
        output: files.output,
        commands: [
            `starci task verify ${id} --contract ${files.contract.replace(/\\/g, "/")}`,
            `starci task result ${id} --status done --output @${output}`,
            `starci workflow step ${snapshot.workflow.id}`,
        ],
    }
}

/**
 * One dispatch tick, idempotent: cancel live tasks no node carries any more, settle reported nodes through `task verify`,
 * dispatch the nodes that became ready (orca: launch their seats), then move the workflow to the status its nodes call for.
 * This is what a loop, the daemon or an inline chat agent calls.
 */
export const stepWorkflow = async (context: VerbContext, root: string, id: string): Promise<WorkflowReport> => {
    let snapshot = readSnapshot(root, id)
    const { status } = snapshot.workflow
    if (status === "defined") throw new Refusal("WORKFLOW_NOT_STARTED", `workflow ${id} is defined, not started; run starci workflow start ${id}`)
    const actions: StepAction[] = []
    if (SETTLING.includes(status)) {
        const stale = staleLiveTasks(snapshot.nodes, snapshot.tasks).map((task) => ({ key: task.key, task: task.id }))
        actions.push(...(await cancelTasks(context, stale, `workflow ${id}: no node of graph v${String(snapshot.workflow.graphVersion)} carries it`)))
        actions.push(...(await checkLiveness(context, root, readSnapshot(root, id))))
        actions.push(...(await settleReported(context, readSnapshot(root, id))))
        snapshot = reconcile(root, id)
        if (DISPATCHING.includes(snapshot.workflow.status)) actions.push(...(await dispatchReady(context, root, snapshot)))
        snapshot = reconcile(root, id)
    }
    return reportOf(root, snapshot, actions)
}

/** The report of a workflow as it stands, with what was done to it. */
export const reportOf = (root: string, snapshot: Snapshot, actions: readonly StepAction[]): WorkflowReport => ({
    workflow: snapshot.workflow.id,
    runner: snapshot.workflow.header.runner,
    status: snapshot.workflow.status,
    reason: snapshot.workflow.reason,
    graphVersion: snapshot.workflow.graphVersion,
    nodes: snapshot.views,
    actions,
    next: DISPATCHING.includes(snapshot.workflow.status) ? inlineNext(root, snapshot) : null,
})

/** The node table of a report: key, state, task and why. */
export const nodeTable = (nodes: readonly NodeView[]): string => formatTable([["TASK", "STATE", "LEDGER TASK", "WHY"], ...nodes.map((node) => [node.key, node.state, node.task?.id ?? "-", node.why])])

/** The human text of a report: the status line, the node table, the actions and the inline next task. */
export const reportMessage = (report: WorkflowReport): string => {
    const done = report.nodes.filter((node) => node.state === "done").length
    const lines = [
        `workflow ${report.workflow} (${report.runner}, graph v${String(report.graphVersion)}): ${report.status}, ${String(done)}/${String(report.nodes.length)} done${report.reason === null ? "" : `\nreason: ${report.reason}`}`,
        nodeTable(report.nodes),
        ...report.actions.map((action) => `${action.action}: ${action.key ?? "-"} ${action.task ?? ""} ${action.detail}`.replace(/\s+/g, " ").trim()),
    ]
    if (report.next !== null) {
        lines.push(`next (inline): ${report.next.task} [${report.next.key}] ${report.next.summary}`, `brief: ${report.next.brief}`, ...report.next.commands.map((command) => `  ${command}`))
    }
    return lines.join("\n")
}

/** A blocked workflow is a red verdict for the caller (exit 1), so a loop stops and hands it to the Kernel. */
export const exitOf = (report: WorkflowReport): number => (report.status === "blocked" ? 1 : 0)
