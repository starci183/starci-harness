import type { DatabaseSync } from "node:sqlite"
import { assertScope, currentGoal, withGoal } from "../../harness/goal.js"
import type { Goal } from "../../harness/goal.js"
import { applyChanges, buildGraph, isGeneratedKey, readPlanSource, uatWalksOf } from "../../harness/graph.js"
import type { Classified, PlanNode, PlanPlace, PlanSource, PlanTask, WorkflowHeader } from "../../harness/graph.js"
import type { Ops } from "../../harness/ops.js"
import { carryHashes, classifyReplan, freshRounds, readResults, revertRows } from "../../harness/reconcile.js"
import type { Results } from "../../harness/reconcile.js"
import { assertRunPlace } from "../../harness/work.js"
import { retryOfNode } from "../../harness/workflow.js"
import type { Snapshot } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"

/** A replan built against a workflow's current graph: the new graph, its classification, the goal it serves, and why. */
export interface Replan {
    readonly header: WorkflowHeader
    readonly goal: Goal
    readonly nodes: readonly PlanNode[]
    readonly classification: readonly Classified[]
    readonly accepts: ReadonlySet<string>
    readonly reason: string
    readonly notes: readonly string[]
    readonly unchanged: boolean
}

/** The Kernel's per-key choices that come with a desired graph instead of a change file. */
export interface ReplanOptions {
    /** The settled facts of the workflow's tasks (reconcile.ts ensureResultHashes, then readResults); read as stored when left out. */
    readonly results?: Results
    /** Removed keys whose committed effect stays: no revert node. */
    readonly keepEffect?: ReadonlySet<string>
    /** Stale keys the Kernel keeps on their dependencies' current results. */
    readonly accepts?: ReadonlySet<string>
}

const sameHeader = (left: WorkflowHeader, right: WorkflowHeader): boolean => JSON.stringify(left) === JSON.stringify(right)

/**
 * Reads the replan file of a workflow and checks the run place of every uat walk it asks for (assertRunPlace), the async part
 * a replan needs before buildReplan judges it against the ledger.
 */
export const readReplanSource = async (file: string, ops: Ops, place: PlanPlace): Promise<PlanSource> => {
    const source = readPlanSource(file, ops, place)
    await Promise.all(uatWalksOf(source, ops).map((walk) => assertRunPlace(place.repo, walk)))
    return source
}

/** What a replan file asks for before the graph is built: the goal, the tasks, the Kernel's per-key choices, and the problems so far. */
interface Asked {
    readonly header: WorkflowHeader
    readonly tasks: readonly PlanTask[]
    readonly retries: ReadonlySet<string>
    readonly keepEffect: ReadonlySet<string>
    readonly accepts: ReadonlySet<string>
    readonly problems: readonly string[]
    readonly reason: string
}

type ChangeSource = Extract<PlanSource, { readonly kind: "change" }>
type WorkflowSource = Exclude<PlanSource, ChangeSource>

/** A change file applied to the current graph; it must name this workflow. */
const tasksOfChange = (snapshot: Snapshot, file: string, source: ChangeSource, ops: Ops, place: PlanPlace): Asked => {
    const { workflow } = snapshot
    if (source.workflow !== workflow.id) throw new Refusal("WORKFLOW_MISMATCH", `${file} changes workflow ${source.workflow}, not ${workflow.id}`)
    const applied = applyChanges(snapshot.nodes, source.changes, source.dir, workflow.header.base, ops, { workflow: workflow.id, place })
    return { ...applied, header: workflow.header, reason: source.reason ?? `change file ${file}` }
}

/**
 * A desired graph: a whole workflow file of the same id and runner, reconciled against the current graph by task key. Each
 * task keeps its retry round by key; the harness's revert nodes the file leaves out are kept, since the harness owns them.
 */
const tasksOfWorkflowFile = (snapshot: Snapshot, file: string, source: WorkflowSource, options: ReplanOptions): Asked => {
    const { workflow } = snapshot
    if (source.header.id !== workflow.id) throw new Refusal("WORKFLOW_MISMATCH", `${file} is workflow ${source.header.id}, not ${workflow.id}`)
    if (source.header.runner !== workflow.header.runner) throw new Refusal("WORKFLOW_RUNNER_FIXED", `workflow ${workflow.id} runs ${workflow.header.runner}; a replan keeps its runner`)
    const rounds = new Map(snapshot.nodes.map((node) => [node.key, node.round]))
    const asked = new Set(source.tasks.map((task) => task.key))
    const generated = snapshot.nodes.filter((node) => isGeneratedKey(node.key) && !asked.has(node.key))
    const tasks = [...source.tasks.map((task) => ({ ...task, round: rounds.get(task.key) ?? 0 })), ...generated]
    return {
        header: source.header,
        tasks,
        retries: new Set<string>(),
        keepEffect: options.keepEffect ?? new Set<string>(),
        accepts: options.accepts ?? new Set<string>(),
        problems: source.problems,
        reason: `desired graph ${file}`,
    }
}

const unfit = (workflowId: string, problems: readonly string[]): Refusal => new Refusal("WORKFLOW_INVALID", `the replan of ${workflowId} is not fit:\n${problems.map((problem) => `- ${problem}`).join("\n")}`)

/** Builds a task list into nodes: fit, hashes carried for unchanged nodes, re-added keys moved to a fresh round. */
const nodesOf = (db: DatabaseSync, snapshot: Snapshot, tasks: readonly PlanTask[], ops: Ops): { readonly nodes: PlanNode[]; readonly notes: readonly string[] } => {
    const built = buildGraph(tasks, ops)
    if (built.problems.length > 0) throw unfit(snapshot.workflow.id, built.problems)
    return { nodes: freshRounds(db, snapshot.workflow.id, carryHashes(built.nodes, snapshot.nodes), snapshot.nodes), notes: built.notes }
}

const STARTS: ReadonlySet<Classified["class"]> = new Set<Classified["class"]>(["redo", "add", "rework", "redo-live", "revert"])

/**
 * Builds the replan a file asks for (`source`, read by readReplanSource): a change file (add, edit, remove, retry, accept)
 * applied to the current graph, or a desired graph (a whole workflow file of the same id and runner) reconciled against it by
 * task key. The header always carries the current goal (only a goal change moves it); the new graph must be fit, inside the
 * goal's scope ceiling (SCOPE_EXCEEDED) and every new attempt within its try budget. Drops of done tasks add their revert
 * nodes. `unchanged` says it moves nothing.
 */
export const buildReplan = (db: DatabaseSync, snapshot: Snapshot, file: string, source: PlanSource, ops: Ops, place: PlanPlace, options: ReplanOptions = {}): Replan => {
    const { workflow } = snapshot
    const goal = currentGoal(db, workflow.id, workflow.header, workflow.goalVersion)
    const asked = source.kind === "change" ? tasksOfChange(snapshot, file, source, ops, place) : tasksOfWorkflowFile(snapshot, file, source, options)
    if (asked.problems.length > 0) throw unfit(workflow.id, asked.problems)
    const header = withGoal(asked.header, goal)
    const results = options.results ?? readResults(db, workflow.id, snapshot.tasks)
    const first = nodesOf(db, snapshot, asked.tasks, ops)
    const judged = classifyReplan({ before: snapshot.views, beforeNodes: snapshot.nodes, after: first.nodes, retries: asked.retries, keepEffect: asked.keepEffect, accepts: asked.accepts, results })
    const built = judged.reverts.length === 0 ? first : nodesOf(db, snapshot, [...first.nodes, ...judged.reverts.map((plan) => plan.task)], ops)
    const classification = [...judged.rows, ...revertRows(built.nodes, judged.reverts)]
    assertScope(workflow.id, built.nodes, goal)
    const problems: string[] = []
    for (const row of classification) {
        if (!STARTS.has(row.class)) continue
        const node = built.nodes.find((candidate) => candidate.key === row.key)
        if (node === undefined) continue
        try {
            retryOfNode(db, workflow.id, node)
        } catch (error: unknown) {
            problems.push(`${row.key}: ${asRefusal(error).message}`)
        }
    }
    if (problems.length > 0) throw new Refusal("TRIES_EXHAUSTED", problems.join("\n"))
    const unchanged = classification.every((row) => row.class === "keep" || row.class === "continue") && asked.accepts.size === 0 && sameHeader(header, workflow.header)
    return { header, goal, nodes: built.nodes, classification, accepts: asked.accepts, reason: asked.reason, notes: built.notes, unchanged }
}

/** The classification as a table: task, class, its state before, the task a replan cancels, and why. */
export const classificationTable = (rows: readonly Classified[]): string =>
    formatTable([["TASK", "CLASS", "WAS", "CANCELS", "WHY"], ...rows.map((row) => [row.key, row.class, row.state ?? "-", row.cancel ?? "-", row.why])])

/** Counts per class, e.g. `keep 2, rework 1, add 1`. */
export const classCounts = (rows: readonly Classified[]): string => {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.class, (counts.get(row.class) ?? 0) + 1)
    return [...counts.entries()].map(([name, count]) => `${name} ${String(count)}`).join(", ")
}
