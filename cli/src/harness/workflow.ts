import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { normaliseRepoPath, parseContract } from "./contract.js"
import type { Contract } from "./contract.js"
import { LIVE_STATES, composerOf, storedHeader, STUCK_STATES, viewNodes } from "./graph.js"
import type { Classified, Difficulty, NodeTask, NodeView, PlanNode, TaskRoute, WorkflowHeader } from "./graph.js"
import { recordFirstGoal } from "./goal.js"
import { loadRouting } from "./routing.js"
import { inTransaction, now } from "./ledger.js"
import { CUSTODY_RECHECK } from "./custody.js"
import { SEAT_WORKER_LOST } from "./seats.js"
import { harnessCause, revivableTasks, TASK_REVIVED } from "./revive.js"
import type { HarnessCause } from "./revive.js"
import { createTask, getTask, recordEvent, tryAfter } from "./tasks.js"
import type { ResultStatus, TaskRow, TaskStatus } from "./tasks.js"

/**
 * The states of a workflow. defined -> running (start) -> done when every node is done; blocked while a node failed, came
 * back unfinished or lost its worker (an amend clears it); paused while dispatch is held (pause; resume returns to running);
 * stopping -> stopped (stop: graceful waits for live tasks, hard cancels them).
 */
export type WorkflowStatus = "defined" | "running" | "blocked" | "paused" | "stopping" | "stopped" | "done"

/**
 * Allowed transitions of a workflow, the one rule every status change goes through (setWorkflowStatus). A paused workflow
 * settles its live tasks but keeps its status until resume or stop; an amend that adds work, or a done task returned because its
 * work never landed (`task verify --recover`), reopens a done workflow.
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

/**
 * The Kernel of an orca workflow in Orca, so its seats read as a tree: the coordinator terminal `[Kernel] <workflow>`
 * (`owned` when the harness created it, so it may close it; an ORCA_TERMINAL_HANDLE it adopted is not its own), the Run that
 * terminal coordinates, and the orchestration task every op's worker nests under. `closedAt` is set once its terminal is closed.
 */
export interface KernelRecord {
    readonly terminal: string | null
    readonly owned: boolean
    readonly runId: string | null
    readonly taskId: string | null
    readonly closedAt: string | null
}

/** A workflow as the ledger stores it: its goal and defaults (the workflow file without its tasks), versions, status and its Kernel in Orca. */
export interface WorkflowRow {
    readonly id: string
    readonly header: WorkflowHeader
    readonly goalVersion: number
    readonly graphVersion: number
    readonly status: WorkflowStatus
    readonly reason: string | null
    readonly kernel: KernelRecord
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
    readonly lost: boolean
    /** Reported, and its newest attempt's failed or blocked report was stopped by custody: the harness verifies it by its own run (harness/custody.ts CUSTODY_RECHECK). */
    readonly recheck: boolean
    readonly createdAt: string
    /** Set when the harness, not the task, ended it and it comes back to ready at the same try (harness/revive.ts). */
    readonly revive: HarnessCause | null
}

/** One recorded graph version: when, why, and the replan classification that produced it (empty for the first). */
export interface GraphVersion {
    readonly version: number
    readonly goalVersion: number
    readonly reason: string | null
    readonly classification: readonly Classified[]
    readonly createdAt: string
}

const LIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["queued", "running", "effect_unknown", "reported", "verifying"])

/** True for a task that was dispatched and has not ended. */
export const isLiveTask = (task: WorkflowTask): boolean => LIVE_TASK_STATUSES.has(task.status)

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const optText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value))

/** A workflow's parallel slots: the workflow file's maxParallel, else ops/routing.yaml workflowParallel, never above it, for orca; one for inline. */
export const parallelSlots = (header: WorkflowHeader): number => (header.runner === "orca" ? Math.min(header.maxParallel ?? Infinity, loadRouting().workflowParallel) : 1)

/** True when the ledger has the workflow graph tables; a read verb on a ledger older than version 4 sees no workflow. */
export const hasGraphTables = (db: DatabaseSync): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_nodes'").get() !== undefined

const toWorkflow = (row: Record<string, unknown>): WorkflowRow => {
    const status = text(row.status) as WorkflowStatus
    if (!WORKFLOW_STATUSES.includes(status)) throw new Refusal("LEDGER_DRIFT", `workflow ${text(row.id)} has an unknown status ${status}`)
    return {
        id: text(row.id),
        header: storedHeader(JSON.parse(text(row.goal_json))),
        goalVersion: Number(row.goal_version),
        graphVersion: Number(row.graph_version),
        status,
        reason: optText(row.reason),
        // A ledger opened read-only may predate the version 6 columns; a missing column reads as no Kernel.
        kernel: {
            terminal: optText(row.kernel_terminal),
            owned: Number(row.kernel_terminal_owned ?? 0) === 1,
            runId: optText(row.kernel_run_id),
            taskId: optText(row.kernel_task_id),
            closedAt: optText(row.kernel_closed_at),
        },
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
    const risk = Array.isArray(route.risk) ? route.risk.filter((tag): tag is string => typeof tag === "string") : []
    return {
        ...(difficulty === undefined ? {} : { difficulty }),
        ...(risk.length === 0 ? {} : { risk }),
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
        recordFirstGoal(db, header.id, header)
        recordEvent(db, "workflow-defined", header.id, { file, tasks: nodes.map((node) => node.key) })
        return getWorkflow(db, header.id)
    })

/** The graph version an amend command (by its cmdId) recorded, if it was applied already. */
export const graphVersionOfCommand = (db: DatabaseSync, workflowId: string, cmdId: string): number | undefined => {
    const row = db.prepare("SELECT graph_version FROM graph_versions WHERE workflow_id = ? AND cmd_id = ?").get(workflowId, cmdId)
    return row === undefined ? undefined : Number(row.graph_version)
}

/** What else a replan records: the command id it is idempotent by, and work done in the same transaction (accepted inputs). */
export interface ReplanRecord {
    readonly cmdId?: string
    readonly within?: (db: DatabaseSync) => void
}

/**
 * Records the next graph version of a workflow (an amend) with its classification, compare-and-swap on the graph version the
 * replan was built on (WORKFLOW_MOVED). The goal version is not moved: only a goal change does that (harness/goal.ts); the
 * graph version records which goal it was built for.
 */
export const recordReplan = (
    db: DatabaseSync,
    workflow: WorkflowRow,
    header: WorkflowHeader,
    nodes: readonly PlanNode[],
    reason: string | null,
    classification: readonly Classified[],
    record: ReplanRecord = {},
): WorkflowRow =>
    inTransaction(db, () => {
        const fresh = getWorkflow(db, workflow.id)
        if (fresh.graphVersion !== workflow.graphVersion) {
            throw new Refusal("WORKFLOW_MOVED", `workflow ${workflow.id} moved to graph version ${String(fresh.graphVersion)} while this amend was built on ${String(workflow.graphVersion)}; diff and amend again`)
        }
        if (fresh.goalVersion !== workflow.goalVersion) {
            throw new Refusal("STALE", `workflow ${workflow.id} moved to goal v${String(fresh.goalVersion)} while this amend was built on v${String(workflow.goalVersion)}; read the goal again and resubmit`)
        }
        const version = fresh.graphVersion + 1
        insertGraph(db, fresh.id, version, fresh.goalVersion, nodes, reason, classification)
        if (record.cmdId !== undefined) db.prepare("UPDATE graph_versions SET cmd_id = ? WHERE workflow_id = ? AND graph_version = ?").run(record.cmdId, fresh.id, version)
        db.prepare("UPDATE workflows SET goal_json = ?, graph_version = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(header), version, now(), fresh.id)
        record.within?.(db)
        recordEvent(db, "workflow-replanned", fresh.id, { graphVersion: version, goalVersion: fresh.goalVersion, cmdId: record.cmdId ?? null, reason, classes: classification.map((row) => `${row.key}:${row.class}`) })
        return getWorkflow(db, fresh.id)
    })

/**
 * Moves a workflow to a status with its reason (an event records each change, with `by`, the actor who moved it, when the
 * caller names one: `pausedBy` reads it), refusing a move WORKFLOW_TRANSITIONS does not allow; returns the row.
 */
export const setWorkflowStatus = (db: DatabaseSync, id: string, status: WorkflowStatus, reason: string | null, by?: string): WorkflowRow => {
    const before = getWorkflow(db, id)
    if (before.status === status && before.reason === reason) return before
    if (before.status !== status && !WORKFLOW_TRANSITIONS[before.status].includes(status)) {
        throw new Refusal("WORKFLOW_BAD_TRANSITION", `workflow ${id} cannot go from ${before.status} to ${status}`)
    }
    db.prepare("UPDATE workflows SET status = ?, reason = ?, updated_at = ? WHERE id = ?").run(status, reason, now(), id)
    if (before.status !== status) recordEvent(db, "workflow-status", id, { from: before.status, to: status, reason, ...(by === undefined ? {} : { by }) })
    return getWorkflow(db, id)
}

/** Who paused a workflow: the `by` of its newest move to paused, null when none was named (the harness's own pauses). */
export const pausedBy = (db: DatabaseSync, id: string): string | null => {
    const by: unknown = db.prepare("SELECT json_extract(data_json, '$.by') AS by FROM events WHERE kind = 'workflow-status' AND subject = ? AND json_extract(data_json, '$.to') = 'paused' ORDER BY id DESC LIMIT 1").get(id)?.by
    return typeof by === "string" ? by : null
}

/** What changed of a workflow's Kernel in Orca; a field left out keeps its value. */
export type KernelUpdate = Partial<KernelRecord>

/** Records what Orca made of a workflow's Kernel (an event records each change) and returns the row. */
export const recordKernel = (db: DatabaseSync, id: string, update: KernelUpdate): WorkflowRow => {
    const before = getWorkflow(db, id).kernel
    const after: KernelRecord = { ...before, ...update }
    db.prepare("UPDATE workflows SET kernel_terminal = ?, kernel_terminal_owned = ?, kernel_run_id = ?, kernel_task_id = ?, kernel_closed_at = ?, updated_at = ? WHERE id = ?").run(
        after.terminal,
        after.owned ? 1 : 0,
        after.runId,
        after.taskId,
        after.closedAt,
        now(),
        id,
    )
    recordEvent(db, "workflow-kernel", id, { before, after })
    return getWorkflow(db, id)
}

/** Every ledger task of a workflow, oldest first, each harness-killed one that comes back to ready marked with its cause. */
export const workflowTasks = (db: DatabaseSync, workflowId: string): WorkflowTask[] => {
    const rows = db
        .prepare(
            // The newest attempt's result and the harness checks that were red on it, so a blocked reason names what failed.
            "SELECT tasks.*, (SELECT results.status FROM attempts JOIN results ON results.attempt_id = attempts.id WHERE attempts.task_id = tasks.id ORDER BY attempts.seq DESC LIMIT 1) AS result_status, " +
                "(SELECT group_concat(name, ', ') FROM check_runs WHERE check_runs.task_id = tasks.id AND check_runs.status = 'red' AND check_runs.runner = 'harness' AND check_runs.attempt_id = (SELECT id FROM attempts WHERE task_id = tasks.id ORDER BY seq DESC LIMIT 1)) AS red_checks, " +
                "EXISTS (SELECT 1 FROM seats WHERE seats.task_id = tasks.id AND seats.status = ?) AS lost, " +
                "(tasks.status = 'reported' AND EXISTS (SELECT 1 FROM events WHERE events.subject = tasks.id AND events.kind = ? AND json_extract(events.data_json, '$.attempt') = (SELECT id FROM attempts WHERE task_id = tasks.id ORDER BY seq DESC LIMIT 1))) AS recheck " +
                "FROM tasks WHERE workflow_id = ? ORDER BY created_at, rowid",
        )
        .all(SEAT_WORKER_LOST, CUSTODY_RECHECK, workflowId)
        .map((row) => ({
            id: text(row.id),
            key: optText(row.plan_key),
            hash: optText(row.plan_hash),
            status: text(row.status) as TaskStatus,
            result: optText(row.result_status) as ResultStatus | null,
            tryNo: Number(row.try_no),
            redChecks: optText(row.red_checks),
            lost: Number(row.lost) === 1,
            recheck: Number(row.recheck) === 1,
            createdAt: text(row.created_at),
        }))
    const revivable = revivableTasks(db, rows)
    return rows.map((row) => ({ ...row, revive: revivable.get(row.id) ?? null }))
}

/**
 * The task carrying each node: the newest task of the node's plan key dispatched for the node's hash. A harness-killed task that
 * comes back (`revive`) carries nothing, so its node is ready again and the next dispatch retries it at the same try.
 */
export const nodeTasks = (nodes: readonly PlanNode[], tasks: readonly WorkflowTask[]): Map<string, NodeTask> => {
    const current = new Map<string, NodeTask>()
    const hashes = new Map(nodes.map((node) => [node.key, node.hash]))
    for (const task of tasks) {
        if (task.key === null || hashes.get(task.key) !== task.hash) continue
        if (task.revive !== null) current.delete(task.key)
        else current.set(task.key, { id: task.id, status: task.status, result: task.result, tryNo: task.tryNo, redChecks: task.redChecks, lost: task.lost, recheck: task.recheck })
    }
    return current
}

/** Live tasks of a workflow that no node of the current graph carries any more: left over by a drop or a redo whose cancel did not land. */
export const staleLiveTasks = (nodes: readonly PlanNode[], tasks: readonly WorkflowTask[]): WorkflowTask[] => {
    const carried = new Set([...nodeTasks(nodes, tasks).values()].map((task) => task.id))
    return tasks.filter((task) => isLiveTask(task) && !carried.has(task.id))
}

/** The ledger event of a workflow's final verify: the graph version it judged, its verdict, and why it is red. */
export const FINAL_VERIFY_EVENT = "workflow-final-verify"

/** A final verify of a workflow, as its event recorded it. */
export interface FinalVerify {
    readonly graphVersion: number
    readonly verdict: "green" | "red"
    readonly reason: string
}

/** A workflow with its current graph, the state of every node, its ledger tasks and its newest final verify. */
export interface Snapshot {
    readonly workflow: WorkflowRow
    readonly nodes: readonly PlanNode[]
    readonly views: readonly NodeView[]
    readonly tasks: readonly WorkflowTask[]
    readonly live: number
    readonly finalVerify: FinalVerify | null
    /** The done tasks whose heavy checks wait for the workflow's wave verify (harness/wave.ts). */
    readonly waveDue: readonly string[]
}

/** The newest final verify of a workflow, if any. */
const finalVerifyOf = (db: DatabaseSync, id: string): FinalVerify | null => {
    const row = db.prepare("SELECT data_json FROM events WHERE kind = ? AND subject = ? ORDER BY id DESC LIMIT 1").get(FINAL_VERIFY_EVENT, id)
    if (row === undefined) return null
    const data: unknown = JSON.parse(text(row.data_json))
    if (typeof data !== "object" || data === null || !("graphVersion" in data) || !("verdict" in data)) return null
    return { graphVersion: Number(data.graphVersion), verdict: data.verdict === "green" ? "green" : "red", reason: "reason" in data ? text(data.reason) : "" }
}

/**
 * The tasks of a workflow whose wave verify is due (harness/wave.ts): done, settled with heavy checks left to the wave
 * (`wave-due`), and not yet judged by a wave (`wave-judged`).
 */
export const waveDue = (db: DatabaseSync, workflowId: string): string[] =>
    db
        .prepare(
            "SELECT id FROM tasks WHERE workflow_id = ? AND status = 'done' AND EXISTS (SELECT 1 FROM events WHERE kind = 'wave-due' AND subject = tasks.id) AND NOT EXISTS (SELECT 1 FROM events WHERE kind = 'wave-judged' AND subject = tasks.id) ORDER BY created_at, rowid",
        )
        .all(workflowId)
        .map((row) => String(row.id))

/** Reads a workflow's current graph and the state of each node. */
export const snapshotOf = (db: DatabaseSync, id: string): Snapshot => {
    const workflow = getWorkflow(db, id)
    const nodes = graphOf(db, id, workflow.graphVersion)
    const tasks = workflowTasks(db, id)
    return { workflow, nodes, views: viewNodes(nodes, nodeTasks(nodes, tasks)), tasks, live: tasks.filter(isLiveTask).length, finalVerify: finalVerifyOf(db, id), waveDue: waveDue(db, id) }
}

/**
 * Whether a workflow's graph needs a final verify before it is done: a task of it deferred its composition rules to its composer
 * (graph.ts composerOf), so the modules it wrote are judged once more, in full, on the code every task left (core/workflow/engine.ts).
 */
export const needsFinalVerify = (snapshot: Snapshot): boolean => snapshot.nodes.some((node) => composerOf(node, snapshot.nodes) !== undefined)

/** The final verify that judges the workflow's current graph, if one ran. */
export const currentFinalVerify = (snapshot: Snapshot): FinalVerify | null =>
    snapshot.finalVerify?.graphVersion === snapshot.workflow.graphVersion ? snapshot.finalVerify : null

/**
 * The status a workflow's nodes call for. An ended or not yet started workflow keeps its status; a stopping one is stopped once
 * none of its tasks is live; otherwise done when every node is done (and its final verify, when one is due, is green), blocked
 * (with the reason) while any node is stuck or the final verify is red, else running.
 */
export const derivedStatus = (snapshot: Snapshot): { readonly status: WorkflowStatus; readonly reason: string | null } => {
    const { workflow, views, live } = snapshot
    if (workflow.status === "defined" || workflow.status === "stopped" || workflow.status === "paused") return { status: workflow.status, reason: workflow.reason }
    if (workflow.status === "stopping") return live === 0 ? { status: "stopped", reason: workflow.reason } : { status: "stopping", reason: workflow.reason }
    // Done waits for every task of the workflow, a leftover one still being cancelled or verified included, for its due wave,
    // and for a green final verify of the current graph when a task deferred its composition rules.
    if (views.every((view) => view.state === "done") && live === 0) {
        if (snapshot.waveDue.length > 0) return { status: "running", reason: `every task is done; the wave verify of ${snapshot.waveDue.join(", ")} is due` }
        const final = needsFinalVerify(snapshot) ? currentFinalVerify(snapshot) : { graphVersion: workflow.graphVersion, verdict: "green", reason: "" }
        if (final === null) return { status: "running", reason: "every task is done; the final verify of the deferred composition rules is next" }
        return final.verdict === "green" ? { status: "done", reason: null } : { status: "blocked", reason: `final verify: ${final.reason}` }
    }
    const stuck = views.filter((view) => STUCK_STATES.includes(view.state) && view.state !== "blocked")
    if (stuck.length > 0) return { status: "blocked", reason: stuck.map((view) => `${view.key}: ${view.why}`).join("; ") }
    return { status: "running", reason: null }
}

/** The live node states, for counting what holds a parallel slot. */
export const isLiveView = (view: NodeView): boolean => LIVE_STATES.includes(view.state)

const pathSet = (contract: Contract): string => [...new Set(contract.context.allowPaths.map(normaliseRepoPath))].sort((a, b) => (a < b ? -1 : Number(a > b))).join("\n")

/**
 * The task a new dispatch of a node retries: the newest failed task of the same plan key doing the same work (label and
 * allowPaths), or a cancelled one the harness ended (revive.ts `harnessCause`). It gets the next try number, or keeps its own
 * when the harness ended it (tasks.ts `tryAfter`); when the try budget of either contract is spent the dispatch is refused.
 */
export const retryOfNode = (db: DatabaseSync, workflowId: string, node: PlanNode): TaskRow | undefined => {
    const row = db
        .prepare("SELECT id, status FROM tasks WHERE workflow_id = ? AND plan_key = ? AND status IN ('failed', 'cancelled') ORDER BY created_at DESC, rowid DESC")
        .all(workflowId, node.key)
        .find((candidate) => text(candidate.status) === "failed" || harnessCause(db, text(candidate.id)) !== null)
    if (row === undefined) return undefined
    const previous = getTask(db, text(row.id))
    if (previous.label !== node.contract.label || pathSet(previous.contract) !== pathSet(node.contract)) return undefined
    const budget = Math.min(previous.contract.budget.tries, node.contract.budget.tries) + triesRaisedFor(db, workflowId, node.key)
    if (tryAfter(db, previous) > budget) {
        throw new Refusal(
            "TRIES_EXHAUSTED",
            `${node.key} was try ${String(previous.tryNo)} of ${String(budget)} (task ${previous.id}); the try budget is spent: raise this task's tries (starci budget raise ${workflowId} --task ${node.key} --tries <n> --reason <why>, as its Kernel, the Supervisor or the owner), then retry it`,
        )
    }
    return previous
}

/** The event a task-scoped tries raise records (subject `<workflow>/<plan key>`, data: tries, by, reason), read by `retryOfNode`. */
export const TRIES_RAISED = "tries-raised"

/** The tries raised for one node of a workflow, over every task of its plan key (`raiseNodeTries`). */
export const triesRaisedFor = (db: DatabaseSync, workflowId: string, key: string): number =>
    Number(db.prepare("SELECT COALESCE(SUM(json_extract(data_json, '$.tries')), 0) AS n FROM events WHERE kind = ? AND subject = ?").get(TRIES_RAISED, `${workflowId}/${key}`)?.n ?? 0)

/**
 * Raises the try budget of one node of a workflow (its plan key, whichever task of it ran last) by `tries`, over the contract's
 * `budget.tries`: the route out of TRIES_EXHAUSTED for a single task, whose tries the harness spent (a red not its own, a verify the
 * infrastructure stopped) or that the Supervisor rules worth another try. The workflow's own ceiling (`budget raise` without
 * --task) is untouched. Returns the node's try budget before and after.
 */
export const raiseNodeTries = (db: DatabaseSync, workflowId: string, key: string, raise: { readonly tries: number; readonly by: string; readonly reason: string }): { readonly task: string | null; readonly before: number; readonly after: number } => {
    const node = db.prepare("SELECT 1 FROM plan_nodes WHERE workflow_id = ? AND plan_key = ?").get(workflowId, key)
    const last = db.prepare("SELECT id FROM tasks WHERE workflow_id = ? AND plan_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(workflowId, key)
    if (node === undefined && last === undefined) throw new Refusal("TASK_UNKNOWN", `workflow ${workflowId} has no task ${key}`)
    const task = last === undefined ? null : getTask(db, String(last.id))
    const base = task === null ? 0 : task.contract.budget.tries
    const before = base + triesRaisedFor(db, workflowId, key)
    recordEvent(db, TRIES_RAISED, `${workflowId}/${key}`, { tries: raise.tries, by: raise.by, reason: raise.reason, task: task?.id ?? null })
    return { task: task?.id ?? null, before, after: before + raise.tries }
}

/**
 * Dispatches one node: in one transaction it re-reads the graph (an amend may have moved it), refuses a node that already has
 * its task, and creates the queued task with its plan key and node hash. A node whose paths another live task also writes
 * dispatches all the same: each works in its own Op worktree, and the second to land rebases onto the first.
 */
export const createNodeTask = (db: DatabaseSync, workflowId: string, node: PlanNode): { readonly task: TaskRow } =>
    inTransaction(db, () => {
        const workflow = getWorkflow(db, workflowId)
        // A pause or stop that landed while this step was running holds dispatch at once.
        if (!DISPATCHING.includes(workflow.status)) throw new Refusal("WORKFLOW_NOT_DISPATCHING", `workflow ${workflowId} is ${workflow.status}; nothing new is dispatched`)
        const planned = db.prepare("SELECT node_hash FROM plan_nodes WHERE workflow_id = ? AND graph_version = ? AND plan_key = ?").get(workflowId, workflow.graphVersion, node.key)
        if (planned === undefined || text(planned.node_hash) !== node.hash) throw new Refusal("WORKFLOW_MOVED", `${node.key} is not in graph version ${String(workflow.graphVersion)} as read; step again`)
        // A node's task blocks a second dispatch unless the harness ended it and it comes back (workflowTasks `revive`).
        if (workflowTasks(db, workflowId).some((task) => task.key === node.key && task.hash === node.hash && task.revive === null)) {
            throw new Refusal("NODE_TAKEN", `${node.key} was dispatched already`)
        }
        const previous = retryOfNode(db, workflowId, node)
        const cause = previous === undefined ? null : harnessCause(db, previous.id)
        const created = createTask(db, node.contract, { workflowId, ...(previous === undefined ? {} : { retryOf: previous.id }) })
        if (cause !== null) recordEvent(db, TASK_REVIVED, created.id, { from: previous?.id ?? null, cause, tryNo: created.tryNo })
        // The dependency tasks it runs on: the early cutoff later compares their settled results with the current ones.
        const carrying = nodeTasks(graphOf(db, workflowId, workflow.graphVersion), workflowTasks(db, workflowId))
        const inputs = Object.fromEntries(node.dependsOn.map((dep) => [dep, carrying.get(dep)?.id ?? null]))
        db.prepare("UPDATE tasks SET plan_key = ?, plan_hash = ?, plan_inputs_json = ? WHERE id = ?").run(node.key, node.hash, JSON.stringify(inputs), created.id)
        recordEvent(db, "workflow-dispatched", workflowId, { key: node.key, task: created.id, graphVersion: workflow.graphVersion })
        return { task: created }
    })
