import type { DatabaseSync } from "node:sqlite"
import { applyChanges, buildGraph, classify, readPlanSource, uatWalksOf } from "../../harness/graph.js"
import type { Classified, PlanNode, PlanPlace, PlanSource, PlanTask, WorkflowHeader } from "../../harness/graph.js"
import type { Ops } from "../../harness/ops.js"
import { assertRunPlace } from "../../harness/work.js"
import { retryOfNode } from "../../harness/workflow.js"
import type { Snapshot } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"

/** A replan built against a workflow's current graph: the new goal and graph, its classification, and why. */
export interface Replan {
    readonly header: WorkflowHeader
    readonly nodes: readonly PlanNode[]
    readonly classification: readonly Classified[]
    readonly reason: string
    readonly notes: readonly string[]
    readonly unchanged: boolean
}

const sameHeader = (left: WorkflowHeader, right: WorkflowHeader): boolean => JSON.stringify(left) === JSON.stringify(right)

/**
 * Reads the replan file of a workflow and checks the run place of every uat walk it asks for (assertRunPlace), the async part
 * a replan needs before buildReplan judges it against the ledger.
 */
export const readReplanSource = async (file: string, ops: Ops, place: PlanPlace): Promise<PlanSource> => {
    const source = readPlanSource(file, ops, place)
    for (const walk of uatWalksOf(source, ops)) await assertRunPlace(place.repo, walk)
    return source
}

/**
 * Builds the replan a file asks for (`source`, read by readReplanSource): a change file (add, edit, remove, retry) applied to the current graph, or a whole workflow
 * file of the same id and runner that replaces it (a task keeps its retry round by key). The new graph must be fit; a redo of
 * a failed task must stay within its try budget. Refuses WORKFLOW_INVALID with every problem; `unchanged` says it moves nothing.
 */
export const buildReplan = (db: DatabaseSync, snapshot: Snapshot, file: string, source: PlanSource, ops: Ops, place: PlanPlace): Replan => {
    const { workflow } = snapshot
    let header = workflow.header
    let tasks: readonly PlanTask[]
    let retries: ReadonlySet<string> = new Set<string>()
    const problems: string[] = []
    let reason: string
    if (source.kind === "change") {
        if (source.workflow !== workflow.id) throw new Refusal("WORKFLOW_MISMATCH", `${file} changes workflow ${source.workflow}, not ${workflow.id}`)
        const applied = applyChanges(snapshot.nodes, source.changes, source.dir, header.base, ops, { workflow: workflow.id, place })
        tasks = applied.tasks
        retries = applied.retries
        problems.push(...applied.problems)
        reason = source.reason ?? `change file ${file}`
    } else {
        if (source.header.id !== workflow.id) throw new Refusal("WORKFLOW_MISMATCH", `${file} is workflow ${source.header.id}, not ${workflow.id}`)
        if (source.header.runner !== header.runner) throw new Refusal("WORKFLOW_RUNNER_FIXED", `workflow ${workflow.id} runs ${header.runner}; a replan keeps its runner`)
        const rounds = new Map(snapshot.nodes.map((node) => [node.key, node.round]))
        tasks = source.tasks.map((task) => ({ ...task, round: rounds.get(task.key) ?? 0 }))
        problems.push(...source.problems)
        header = source.header
        reason = `workflow file ${file}`
    }
    const built = buildGraph(tasks, ops)
    problems.push(...built.problems)
    if (problems.length > 0) throw new Refusal("WORKFLOW_INVALID", `the replan of ${workflow.id} is not fit:\n${problems.map((problem) => `- ${problem}`).join("\n")}`)
    const classification = classify(snapshot.views, snapshot.nodes, built.nodes, retries)
    for (const row of classification) {
        if (row.class !== "redo" && row.class !== "add") continue
        const node = built.nodes.find((candidate) => candidate.key === row.key)
        if (node === undefined) continue
        try {
            retryOfNode(db, workflow.id, node)
        } catch (error: unknown) {
            problems.push(`${row.key}: ${asRefusal(error).message}`)
        }
    }
    if (problems.length > 0) throw new Refusal("TRIES_EXHAUSTED", problems.join("\n"))
    const unchanged = classification.every((row) => row.class === "keep" || row.class === "continue") && sameHeader(header, workflow.header)
    return { header, nodes: built.nodes, classification, reason, notes: built.notes, unchanged }
}

/** The classification as a table: task, class, its state before, the task a replan cancels, and why. */
export const classificationTable = (rows: readonly Classified[]): string =>
    formatTable([["TASK", "CLASS", "WAS", "CANCELS", "WHY"], ...rows.map((row) => [row.key, row.class, row.state ?? "-", row.cancel ?? "-", row.why])])

/** Counts per class, e.g. `keep 2, redo 1, add 1`. */
export const classCounts = (rows: readonly Classified[]): string => {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.class, (counts.get(row.class) ?? 0) + 1)
    return [...counts.entries()].map(([name, count]) => `${name} ${String(count)}`).join(", ")
}
