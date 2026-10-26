import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { normaliseRepoPath, parseContract } from "./contract.js"
import type { Contract } from "./contract.js"
import { headerSchema, LIVE_STATES, STUCK_STATES, viewNodes } from "./graph.js"
import type { Classified, Difficulty, NodeTask, NodeView, PlanNode, TaskRoute, WorkflowHeader } from "./graph.js"
import { now } from "./ledger.js"
import { acquireLeases, inTransaction } from "./leases.js"
import type { LeaseGrant } from "./leases.js"
import { createTask, getTask, recordEvent } from "./tasks.js"
import type { ResultStatus, TaskRow, TaskStatus } from "./tasks.js"

/**
 * The states of a workflow. defined -> running (start) -> done when every node is done; blocked while a node failed, came
 * back unfinished or lost its worker (an amend clears it); paused while dispatch is held (pause; resume returns to running);
 * stopping -> stopped (stop: graceful waits for live tasks, hard cancels them).
 */
export type WorkflowStatus = "defined" | "running" | "blocked" | "paused" | "stopping" | "stopped" | "done"

/**
 * Allowed transitions of a workflow, the one rule every status change goes through (setWorkflowStatus). A paused workflow
 * settles its live tasks but keeps its status until resume or stop; an amend that adds work reopens a done workflow.
 */
export const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
    defined: ["running", "stopped"],
    running: ["blocked", "done", "paused", "stopping"],
    blocked: ["running", "done", "paused", "stopping"],
    paused: ["running", "stopping"],
    stopping: ["stopped"],
    stopped: [],
    done: ["running", "blocked"],
}

const WORKFLOW_STATUSES = Object.keys(WORKFLOW_TRANSITIONS) as WorkflowStatus[]

/** The workflow statuses in which the harness dispatches ready nodes. */
export const DISPATCHING: readonly WorkflowStatus[] = ["running", "blocked"]

/** The workflow statuses in which a step still settles live tasks: every one that is started and not ended. */
export const SETTLING: readonly WorkflowStatus[] = ["running", "blocked", "paused", "stopping"]

/** A workflow as the ledger stores it: its goal and defaults (the workflow file without its tasks), versions and status. */
export interface WorkflowRow {
    readonly id: string
    readonly header: WorkflowHeader
    readonly goalVersion: number
    readonly graphVersion: number
    readonly status: WorkflowStatus
    readonly reason: string | null
    readonly createdAt: string
    readonly updatedAt: string | null
}

/** A ledger task of a workflow, with the plan key and node hash it was dispatched for. */
export interface WorkflowTask {
    readonly id: string
    readonly key: string | null
    readonly hash: string | null
    readonly status: TaskStatus
    readonly result: ResultStatus | null
    readonly tryNo: number
    readonly redChecks: string | null
    readonly createdAt: string
}

/** One recorded graph version: when, why, and the replan classification that produced it (empty for the first). */
export interface GraphVersion {
    readonly version: number
    readonly goalVersion: number
    readonly reason: string | null
    readonly classification: readonly Classified[]
    readonly createdAt: string
}

const LIVE_TASK_STATUSES: readonly TaskStatus[] = ["queued", "running", "effect_unknown", "reported", "verifying"]

/** True for a task that was dispatched and has not ended. */
export const isLiveTask = (task: WorkflowTask): boolean => LIVE_TASK_STATUSES.includes(task.status)

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const optText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value))

/** True when the ledger has the workflow graph tables; a read verb on a ledger older than version 4 sees no workflow. */
export const hasGraphTables = (db: DatabaseSync): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_nodes'").get() !== undefined

const toWorkflow = (row: Record<string, unknown>): WorkflowRow => {
    const status = text(row.status) as WorkflowStatus
    if (!WORKFLOW_STATUSES.includes(status)) throw new Refusal("LEDGER_DRIFT", `workflow ${text(row.id)} has an unknown status ${status}`)
    return {
        id: text(row.id),
        header: headerSchema.parse(JSON.parse(text(row.goal_json))),
        goalVersion: Number(row.goal_version),
        graphVersion: Number(row.graph_version),
        status,
        reason: optText(row.reason),
        createdAt: text(row.created_at),
        updatedAt: optText(row.updated_at),
    }
}

/** One workflow by id; refuses an unknown id. */
export const getWorkflow = (db: DatabaseSync, id: string): WorkflowRow => {
    const row = hasGraphTables(db) ? db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) : undefined
    if (row === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${id} in this project's ledger (starci workflow list)`)
    return toWorkflow(row)
}

/** Every workflow with a recorded graph, newest first. */
export const listWorkflows = (db: DatabaseSync): WorkflowRow[] =>
    hasGraphTables(db) ? db.prepare("SELECT * FROM workflows WHERE graph_version > 0 ORDER BY created_at DESC").all().map(toWorkflow) : []

const routeOf = (value: unknown): TaskRoute => {
    const route = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>
    const field = (name: string): string | undefined => (typeof route[name] === "string" ? route[name] : undefined)
    const difficulty = field("difficulty") as Difficulty | undefined
    const agent = field("agent")
    const model = field("model")
    const effort = field("effort")
    return {
        ...(difficulty === undefined ? {} : { difficulty }),
        ...(agent === undefined ? {} : { agent }),
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
    }
}

/** The nodes of one graph version, in the dependency order they were recorded in. */
export const graphOf = (db: DatabaseSync, workflowId: string, version: number): PlanNode[] => {
    const edges = new Map<string, string[]>()
    for (const row of db.prepare("SELECT plan_key, depends_on FROM edges WHERE workflow_id = ? AND graph_version = ? ORDER BY depends_on").all(workflowId, version)) {
        const key = text(row.plan_key)
        edges.set(key, [...(edges.get(key) ?? []), text(row.depends_on)])
    }
    return db
        .prepare("SELECT * FROM plan_nodes WHERE workflow_id = ? AND graph_version = ? ORDER BY rowid")
        .all(workflowId, version)
        .map((row): PlanNode => {
            const key = text(row.plan_key)
            const contract: Contract = parseContract(JSON.parse(text(row.contract_json)))
            return { key, contract, dependsOn: edges.get(key) ?? [], route: routeOf(JSON.parse(text(row.route_json))), round: Number(row.round), contractHash: text(row.contract_hash), hash: text(row.node_hash) }
        })
}

/** The recorded graph versions of a workflow, oldest first. */
export const graphVersions = (db: DatabaseSync, workflowId: string): GraphVersion[] =>
    db
        .prepare("SELECT * FROM graph_versions WHERE workflow_id = ? ORDER BY graph_version")
        .all(workflowId)
        .map((row) => ({
            version: Number(row.graph_version),
            goalVersion: Number(row.goal_version),
            reason: optText(row.reason),
            classification: JSON.parse(text(row.classification_json)) as Classified[],
            createdAt: text(row.created_at),
        }))

const insertGraph = (db: DatabaseSync, workflowId: string, version: number, goalVersion: number, nodes: readonly PlanNode[], reason: string | null, classification: readonly Classified[]): void => {
    const node = db.prepare("INSERT INTO plan_nodes (workflow_id, graph_version, plan_key, contract_json, contract_hash, node_hash, route_json, round) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    const edge = db.prepare("INSERT INTO edges (workflow_id, graph_version, plan_key, depends_on) VALUES (?, ?, ?, ?)")
    for (const planned of nodes) {
        node.run(workflowId, version, planned.key, JSON.stringify(planned.contract), planned.contractHash, planned.hash, JSON.stringify(planned.route), planned.round)
        for (const dep of planned.dependsOn) edge.run(workflowId, version, planned.key, dep)
    }
    db.prepare("INSERT INTO graph_versions (workflow_id, graph_version, goal_version, reason, classification_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        workflowId,
        version,
        goalVersion,
        reason,
        JSON.stringify(classification),
        now(),
    )
}

/** Records a new workflow with graph version 1, status defined. Refuses an id the ledger has already. */
export const insertWorkflow = (db: DatabaseSync, header: WorkflowHeader, nodes: readonly PlanNode[], file: string): WorkflowRow =>
    inTransaction(db, () => {
        if (db.prepare("SELECT 1 FROM workflows WHERE id = ?").get(header.id) !== undefined) {
            throw new Refusal("WORKFLOW_EXISTS", `workflow ${header.id} is defined already; change it with starci workflow amend ${header.id} --change <file>`)
        }
        const at = now()
        db.prepare("INSERT INTO workflows (id, goal_json, goal_version, graph_version, status, created_at, updated_at) VALUES (?, ?, 1, 1, 'defined', ?, ?)").run(header.id, JSON.stringify(header), at, at)
        insertGraph(db, header.id, 1, 1, nodes, `defined from ${file}`, [])
        recordEvent(db, "workflow-defined", header.id, { file, tasks: nodes.map((node) => node.key) })
        return getWorkflow(db, header.id)
    })

/** Records the next graph version of a workflow (an amend) with its classification; goal and graph versions move together. */
export const recordReplan = (db: DatabaseSync, workflow: WorkflowRow, header: WorkflowHeader, nodes: readonly PlanNode[], reason: string | null, classification: readonly Classified[]): WorkflowRow =>
    inTransaction(db, () => {
        const fresh = getWorkflow(db, workflow.id)
        if (fresh.graphVersion !== workflow.graphVersion) {
            throw new Refusal("WORKFLOW_MOVED", `workflow ${workflow.id} moved to graph version ${String(fresh.graphVersion)} while this amend was built on ${String(workflow.graphVersion)}; diff and amend again`)
        }
        const version = fresh.graphVersion + 1
        const goalVersion = fresh.goalVersion + 1
        insertGraph(db, fresh.id, version, goalVersion, nodes, reason, classification)
        db.prepare("UPDATE workflows SET goal_json = ?, goal_version = ?, graph_version = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(header), goalVersion, version, now(), fresh.id)
        recordEvent(db, "workflow-replanned", fresh.id, { graphVersion: version, reason, classes: classification.map((row) => `${row.key}:${row.class}`) })
        return getWorkflow(db, fresh.id)
    })

/** Moves a workflow to a status with its reason (an event records each change), refusing a move WORKFLOW_TRANSITIONS does not allow; returns the row. */
export const setWorkflowStatus = (db: DatabaseSync, id: string, status: WorkflowStatus, reason: string | null): WorkflowRow => {
    const before = getWorkflow(db, id)
    if (before.status === status && before.reason === reason) return before
    if (before.status !== status && !WORKFLOW_TRANSITIONS[before.status].includes(status)) {
        throw new Refusal("WORKFLOW_BAD_TRANSITION", `workflow ${id} cannot go from ${before.status} to ${status}`)
    }
    db.prepare("UPDATE workflows SET status = ?, reason = ?, updated_at = ? WHERE id = ?").run(status, reason, now(), id)
    if (before.status !== status) recordEvent(db, "workflow-status", id, { from: before.status, to: status, reason })
    return getWorkflow(db, id)
}

/** Every ledger task of a workflow, oldest first. */
export const workflowTasks = (db: DatabaseSync, workflowId: string): WorkflowTask[] =>
    db
        .prepare(
            // The newest attempt's result and the harness checks that were red on it, so a blocked reason names what failed.
            "SELECT tasks.*, (SELECT results.status FROM attempts JOIN results ON results.attempt_id = attempts.id WHERE attempts.task_id = tasks.id ORDER BY attempts.seq DESC LIMIT 1) AS result_status, " +
                "(SELECT group_concat(name, ', ') FROM check_runs WHERE check_runs.task_id = tasks.id AND check_runs.status = 'red' AND check_runs.runner = 'harness' AND check_runs.attempt_id = (SELECT id FROM attempts WHERE task_id = tasks.id ORDER BY seq DESC LIMIT 1)) AS red_checks " +
                "FROM tasks WHERE workflow_id = ? ORDER BY created_at, rowid",
        )
        .all(workflowId)
        .map((row) => ({
            id: text(row.id),
            key: optText(row.plan_key),
            hash: optText(row.plan_hash),
            status: text(row.status) as TaskStatus,
            result: optText(row.result_status) as ResultStatus | null,
            tryNo: Number(row.try_no),
            redChecks: optText(row.red_checks),
            createdAt: text(row.created_at),
        }))

/** The task carrying each node: the newest task of the node's plan key dispatched for the node's hash. */
export const nodeTasks = (nodes: readonly PlanNode[], tasks: readonly WorkflowTask[]): Map<string, NodeTask> => {
    const current = new Map<string, NodeTask>()
    const hashes = new Map(nodes.map((node) => [node.key, node.hash]))
    for (const task of tasks) {
        if (task.key === null || hashes.get(task.key) !== task.hash) continue
        current.set(task.key, { id: task.id, status: task.status, result: task.result, tryNo: task.tryNo, redChecks: task.redChecks })
    }
    return current
}

/** Live tasks of a workflow that no node of the current graph carries any more: left over by a drop or a redo whose cancel did not land. */
export const staleLiveTasks = (nodes: readonly PlanNode[], tasks: readonly WorkflowTask[]): WorkflowTask[] => {
    const carried = new Set([...nodeTasks(nodes, tasks).values()].map((task) => task.id))
    return tasks.filter((task) => isLiveTask(task) && !carried.has(task.id))
}

/** A workflow with its current graph, the state of every node and its ledger tasks. */
export interface Snapshot {
    readonly workflow: WorkflowRow
    readonly nodes: readonly PlanNode[]
    readonly views: readonly NodeView[]
    readonly tasks: readonly WorkflowTask[]
    readonly live: number
}

/** Reads a workflow's current graph and the state of each node. */
export const snapshotOf = (db: DatabaseSync, id: string): Snapshot => {
    const workflow = getWorkflow(db, id)
    const nodes = graphOf(db, id, workflow.graphVersion)
    const tasks = workflowTasks(db, id)
    return { workflow, nodes, views: viewNodes(nodes, nodeTasks(nodes, tasks)), tasks, live: tasks.filter(isLiveTask).length }
}

/**
 * The status a workflow's nodes call for. An ended or not yet started workflow keeps its status; a stopping one is stopped once
 * none of its tasks is live; otherwise done when every node is done, blocked (with the reason) while any node is stuck, else running.
 */
export const derivedStatus = (snapshot: Snapshot): { readonly status: WorkflowStatus; readonly reason: string | null } => {
    const { workflow, views, live } = snapshot
    if (workflow.status === "defined" || workflow.status === "stopped" || workflow.status === "paused") return { status: workflow.status, reason: workflow.reason }
    if (workflow.status === "stopping") return live === 0 ? { status: "stopped", reason: workflow.reason } : { status: "stopping", reason: workflow.reason }
    // Done waits for every task of the workflow, a leftover one still being cancelled or verified included.
    if (views.every((view) => view.state === "done") && live === 0) return { status: "done", reason: null }
    const stuck = views.filter((view) => STUCK_STATES.includes(view.state) && view.state !== "blocked")
    if (stuck.length > 0) return { status: "blocked", reason: stuck.map((view) => `${view.key}: ${view.why}`).join("; ") }
    return { status: "running", reason: null }
}

/** The live node states, for counting what holds a parallel slot. */
export const isLiveView = (view: NodeView): boolean => LIVE_STATES.includes(view.state)

const pathSet = (contract: Contract): string => [...new Set(contract.context.allowPaths.map(normaliseRepoPath))].sort().join("\n")

/**
 * The task a new dispatch of a node retries: the newest failed task of the same plan key doing the same work (label and
 * allowPaths). It gets the next try number; when the try budget of either contract is spent the dispatch is refused.
 */
export const retryOfNode = (db: DatabaseSync, workflowId: string, node: PlanNode): TaskRow | undefined => {
    const row = db.prepare("SELECT id FROM tasks WHERE workflow_id = ? AND plan_key = ? AND status = 'failed' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(workflowId, node.key)
    if (row === undefined) return undefined
    const previous = getTask(db, text(row.id))
    if (previous.label !== node.contract.label || pathSet(previous.contract) !== pathSet(node.contract)) return undefined
    const budget = Math.min(previous.contract.budget.tries, node.contract.budget.tries)
    if (previous.tryNo >= budget) {
        throw new Refusal("TRIES_EXHAUSTED", `${node.key} was try ${String(previous.tryNo)} of ${String(budget)} (task ${previous.id}); the try budget is spent, only the Supervisor or the owner raises it`)
    }
    return previous
}

/**
 * Dispatches one node: in one transaction it re-reads the graph (an amend may have moved it), refuses a node that already has
 * its task, creates the queued task with its plan key and node hash, and leases its allowPaths (LEASE_CONFLICT rolls all back).
 */
export const createNodeTask = (db: DatabaseSync, workflowId: string, node: PlanNode): { readonly task: TaskRow; readonly leases: LeaseGrant } =>
    inTransaction(db, () => {
        const workflow = getWorkflow(db, workflowId)
        // A pause or stop that landed while this step was running holds dispatch at once.
        if (!DISPATCHING.includes(workflow.status)) throw new Refusal("WORKFLOW_NOT_DISPATCHING", `workflow ${workflowId} is ${workflow.status}; nothing new is dispatched`)
        const planned = db.prepare("SELECT node_hash FROM plan_nodes WHERE workflow_id = ? AND graph_version = ? AND plan_key = ?").get(workflowId, workflow.graphVersion, node.key)
        if (planned === undefined || text(planned.node_hash) !== node.hash) throw new Refusal("WORKFLOW_MOVED", `${node.key} is not in graph version ${String(workflow.graphVersion)} as read; step again`)
        if (db.prepare("SELECT 1 FROM tasks WHERE workflow_id = ? AND plan_key = ? AND plan_hash = ?").get(workflowId, node.key, node.hash) !== undefined) {
            throw new Refusal("NODE_TAKEN", `${node.key} was dispatched already`)
        }
        const previous = retryOfNode(db, workflowId, node)
        const created = createTask(db, node.contract, { workflowId, ...(previous === undefined ? {} : { retryOf: previous.id }) })
        db.prepare("UPDATE tasks SET plan_key = ?, plan_hash = ? WHERE id = ?").run(node.key, node.hash, created.id)
        recordEvent(db, "workflow-dispatched", workflowId, { key: node.key, task: created.id, graphVersion: workflow.graphVersion })
        return { task: created, leases: acquireLeases(db, created) }
    })
