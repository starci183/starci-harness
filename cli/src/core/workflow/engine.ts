import type { DatabaseSync } from "node:sqlite"
import { writeBrief } from "../../harness/brief.js"
import type { NodeView, PlanNode } from "../../harness/graph.js"
import { openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { getTask } from "../../harness/tasks.js"
import {
    createNodeTask,
    derivedStatus,
    DISPATCHING,
    pickRouteLocally,
    setWorkflowStatus,
    snapshotOf,
    staleLiveTasks,
} from "../../harness/workflow.js"
import type { Route, RouteInput, Snapshot, WorkflowRow, WorkflowStatus } from "../../harness/workflow.js"
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
    readonly action: "verified" | "dispatched" | "launched" | "cancelled" | "wait" | "problem"
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

/** Moves the workflow to the status its nodes call for and returns the fresh snapshot. */
export const reconcile = (root: string, id: string): Snapshot =>
    withLedger(root, (db) => {
        const snapshot = snapshotOf(db, id)
        const { status, reason } = derivedStatus(snapshot)
        setWorkflowStatus(db, id, status, reason)
        return snapshotOf(db, id)
    })

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

const routeFor = (db: DatabaseSync, workflow: WorkflowRow, node: PlanNode): Route | Refusal => {
    const { agent, model, effort } = node.route
    if (agent !== undefined && model !== undefined) return { agent, model, ...(effort === undefined ? {} : { effort }) }
    const earlier = db.prepare("SELECT status FROM tasks WHERE workflow_id = ? AND plan_key = ? ORDER BY created_at DESC, rowid DESC").all(workflow.id, node.key)
    const input: RouteInput = {
        label: node.contract.label,
        ...(node.route.difficulty === undefined ? {} : { difficulty: node.route.difficulty }),
        attempt: earlier.length + 1,
        ...(earlier[0] === undefined ? {} : { previousRed: earlier[0].status === "failed" }),
    }
    // The one seam to the router: swap pickRouteLocally for harness/router.ts pickRoute once it lands.
    const picked = pickRouteLocally(workflow.header)(input)
    if (picked instanceof Refusal) return picked
    return effort === undefined ? picked : { ...picked, effort }
}

const launch = async (context: VerbContext, root: string, workflow: WorkflowRow, key: string, task: string, route: Route): Promise<StepAction> => {
    try {
        const started = await startSeat({ root, cwd: context.cwd, task, agent: route.agent, model: route.model, effort: route.effort, worktree: workflow.header.worktree })
        return { key, task, action: "launched", detail: started.message.split("\n")[0] ?? "launched" }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { key, task, action: "problem", detail: `launch refused (${refusal.code}): ${refusal.message}; the task stays queued and the next step launches it again` }
    }
}

/**
 * Dispatches ready nodes in dependency order while the workflow has free slots (maxParallel for orca, one for inline): each
 * becomes a queued task holding its leases; an orca task then gets its seat. A lease overlap or a refused route is a wait.
 * An orca task left queued by a launch that certainly failed is launched again first.
 */
const dispatchReady = async (context: VerbContext, root: string, snapshot: Snapshot): Promise<StepAction[]> => {
    const { workflow } = snapshot
    const actions: StepAction[] = []
    const orca = workflow.header.runner === "orca"
    if (orca) {
        for (const view of snapshot.views) {
            if (view.state !== "queued" || view.task === null) continue
            const node = snapshot.nodes.find((candidate) => candidate.key === view.key)
            if (node === undefined) continue
            const route = withLedger(root, (db) => routeFor(db, workflow, node))
            actions.push(route instanceof Refusal ? { key: view.key, task: view.task.id, action: "wait", detail: `${route.code}: ${route.message}` } : await launch(context, root, workflow, view.key, view.task.id, route))
        }
    }
    let free = (orca ? workflow.header.maxParallel : 1) - snapshot.live
    for (const view of snapshot.views) {
        if (view.state !== "ready") continue
        if (free <= 0) {
            actions.push({ key: view.key, task: null, action: "wait", detail: orca ? `all ${String(workflow.header.maxParallel)} parallel slot(s) are taken` : "the inline run works one task at a time" })
            continue
        }
        const node = snapshot.nodes.find((candidate) => candidate.key === view.key)
        if (node === undefined) continue
        const route = orca ? withLedger(root, (db) => routeFor(db, workflow, node)) : null
        if (route instanceof Refusal) {
            actions.push({ key: node.key, task: null, action: "wait", detail: `${route.code}: ${route.message}` })
            continue
        }
        let task: string
        try {
            task = withLedger(root, (db) => createNodeTask(db, workflow.id, node).task.id)
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            actions.push({ key: node.key, task: null, action: refusal.code === "LEASE_CONFLICT" || refusal.code === "NODE_TAKEN" ? "wait" : "problem", detail: `${refusal.code}: ${refusal.message}` })
            continue
        }
        free -= 1
        actions.push({ key: node.key, task, action: "dispatched", detail: orca ? `queued for ${route?.agent ?? "-"}/${route?.model ?? "-"}` : "queued for the chat agent" })
        if (route !== null) actions.push(await launch(context, root, workflow, node.key, task, route))
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
    if (status !== "done" && status !== "stopped") {
        const stale = staleLiveTasks(snapshot.nodes, snapshot.tasks).map((task) => ({ key: task.key, task: task.id }))
        actions.push(...(await cancelTasks(context, stale, `workflow ${id}: no node of graph v${String(snapshot.workflow.graphVersion)} carries it`)))
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
