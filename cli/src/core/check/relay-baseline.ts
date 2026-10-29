import type { DatabaseSync } from "node:sqlite"
import { composerOf, isRelayKey } from "../../harness/graph.js"
import { openExistingLedger } from "../../harness/ledger.js"
import { relayHeadOf } from "../../harness/reconcile.js"
import { getTask } from "../../harness/tasks.js"
import { getWorkflow, graphOf } from "../../harness/workflow.js"
import type { Judging } from "./scope.js"

/**
 * A relayed source a check judges against: a relay node (harness/reconcile.ts relayTask) carries work another workflow already
 * settled, so a finding its relayed files held at the source's head (its last relayed commit) is the source's baseline, judged
 * there, and never the red of the relay node or of the waiter that composes it (base-findings.ts judgeAgainstRuns).
 */
export interface RelaySource {
    readonly node: string
    readonly head: string
    readonly paths: readonly string[]
}

const planKeyOf = (db: DatabaseSync, taskId: string): string | undefined => {
    const row = db.prepare("SELECT plan_key FROM tasks WHERE id = ?").get(taskId)
    return typeof row?.plan_key === "string" ? row.plan_key : undefined
}

/**
 * The relayed sources a check judges for: each relay node it judges as (`--task`, or one of a wave's tasks), and each relay node
 * whose relayed files it judges in full as their composer (its first waiter, graph.ts composerOf, or a workflow's final verify).
 */
export const relaySources = (root: string, judging: Judging): RelaySource[] => {
    const db = openExistingLedger(root)
    if (db === undefined) return []
    try {
        const taskIds = judging.task === undefined ? (judging.wave ?? []) : [judging.task]
        const tasks = taskIds.map((id) => ({ task: getTask(db, id), key: planKeyOf(db, id) }))
        const sources = new Map<string, RelaySource>()
        const add = (node: string, contract: Parameters<typeof relayHeadOf>[0], paths: readonly string[]): void => {
            const head = relayHeadOf(contract)
            if (head !== undefined && !sources.has(node)) sources.set(node, { node, head, paths })
        }
        for (const { task, key } of tasks) if (key !== undefined && isRelayKey(key)) add(key, task.contract, task.contract.context.allowPaths)
        const composers = new Set(tasks.flatMap(({ key }) => (key === undefined ? [] : [key])))
        const workflows = new Set([...(judging.workflow === undefined ? [] : [judging.workflow]), ...tasks.flatMap(({ task }) => (task.workflowId === null ? [] : [task.workflowId]))])
        for (const workflowId of workflows) {
            const graph = graphOf(db, workflowId, getWorkflow(db, workflowId).graphVersion)
            for (const node of graph) {
                const composer = composerOf(node, graph)
                if (!isRelayKey(node.key) || composer === undefined) continue
                if (judging.workflow === workflowId || composers.has(composer)) add(node.key, node.contract, node.contract.context.allowPaths)
            }
        }
        return [...sources.values()]
    } finally {
        db.close()
    }
}
