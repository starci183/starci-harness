import type { DatabaseSync } from "node:sqlite"
import { workflowBudgets } from "../../harness/budget.js"
import { currentGoal } from "../../harness/goal.js"
import type { NodeView } from "../../harness/graph.js"
import { clockOf, heavyFloors, heavySlots, heavySlotsInUse, heldWhy, loadHeavyRules } from "../../harness/heavy.js"
import { openExistingLedger } from "../../harness/ledger.js"
import { lastEvent } from "../../harness/tasks.js"
import { parallelSlots, snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { nodeTable } from "./engine.js"

/**
 * Why each live node stands still when the host holds it, instead of a bare state: a task whose verify waits for a heavy-command slot ("held:
 * heavy-command slot for tsc, 16 of 16 slots in use (since 21:02Z)"), and a task awaiting the owner, with the reason its
 * verify recorded (a custody key the live suite needs, a verify that never reached a verdict). Other nodes keep their why.
 */
const heldViews = (db: DatabaseSync, views: readonly NodeView[]): NodeView[] => {
    const live = views.filter((view) => view.task !== null && ["queued", "reported", "verifying", "awaiting_owner"].includes(view.task.status))
    if (live.length === 0) return [...views]
    const rules = loadHeavyRules()
    const waiting = heavySlots().filter((slot) => slot.state === "waiting")
    const used = heavySlotsInUse()
    return views.map((view) => {
        const task = view.task
        if (task === null || !live.includes(view)) return view
        if (task.status === "awaiting_owner") {
            const stuck = lastEvent(db, "verify-stuck", task.id) as { readonly reason?: unknown } | undefined
            return typeof stuck?.reason === "string" ? { ...view, why: `blocked, awaiting the owner: ${stuck.reason.split("\n")[0] ?? stuck.reason}` } : view
        }
        const slot = waiting.find((each) => each.label.includes(task.id) || each.cwd.includes(task.id))
        if (slot === undefined) return view
        const why = heldWhy(used, heavyFloors(rules, slot.cwd)) ?? "admitted at its next poll"
        return { ...view, why: `held: heavy-command slot for ${slot.kind}, ${why} (since ${clockOf(slot.at)})` }
    })
}

/** `starci workflow status <id>`: the workflow's status, reason, goal and graph versions, and every task's state and why; a pure read. */
export const workflowStatusVerb = defineVerb({
    path: ["workflow", "status"],
    summary: "one workflow: status and reason, graph version, progress, and each task's state, ledger task and why it waits",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/workflow-status@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openExistingLedger(root)
        if (db === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${flags.workflow}: this project has no ledger yet`)
        try {
            const snapshot = snapshotOf(db, flags.workflow)
            const { workflow, live } = snapshot
            const views = heldViews(db, snapshot.views)
            const goal = currentGoal(db, workflow.id, workflow.header, workflow.goalVersion)
            const maxTasks = goal.scope?.maxTasks === undefined ? "-" : String(goal.scope.maxTasks)
            const scope = goal.scope === null ? "no scope ceiling" : `scope ${goal.scope.paths?.join(", ") ?? "any path"}, max ${maxTasks} tasks`
            const done = views.filter((view) => view.state === "done").length
            const budget = workflowBudgets(root, workflow.id).budgets[0] ?? null
            const data = {
                workflow: workflow.id,
                goal: goal.text,
                acceptance: goal.acceptance,
                scope: goal.scope,
                runner: workflow.header.runner,
                status: workflow.status,
                reason: workflow.reason,
                goalVersion: workflow.goalVersion,
                graphVersion: workflow.graphVersion,
                maxParallel: parallelSlots(workflow.header),
                done,
                total: views.length,
                live,
                budget,
                nodes: views,
            }
            const message = [
                `workflow ${workflow.id} (${workflow.header.runner}, graph v${String(workflow.graphVersion)}): ${workflow.status}, ${String(done)}/${String(views.length)} done, ${String(live)} live`,
                `goal v${String(goal.version)}: ${goal.text}`,
                `acceptance: ${goal.acceptance.join(", ") || "-"}; ${scope}`,
                ...(workflow.reason === null ? [] : [`reason: ${workflow.reason}`]),
                ...(budget === null ? [] : [`budget: ${String(budget.used.minutes)} of ${String(budget.ceiling.minutes)} minutes, ${String(budget.used.tries)} of ${String(budget.ceiling.tries)} tries`]),
                nodeTable(views),
            ].join("\n")
            return { data, message }
        } finally {
            db.close()
        }
    },
})
