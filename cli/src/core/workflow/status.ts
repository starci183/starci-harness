import { workflowBudgets } from "../../harness/budget.js"
import { currentGoal } from "../../harness/goal.js"
import { openExistingLedger } from "../../harness/ledger.js"
import { parallelSlots, snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { nodeTable } from "./engine.js"

/** `starci workflow status <id>`: the workflow's status, reason, goal and graph versions, and every task's state and why; a pure read. */
export const workflowStatusVerb = defineVerb({
    path: ["workflow", "status"],
    summary: "one workflow: status and reason, graph version, progress, and each task's state, ledger task and why it waits",
    editions: BOTH_EDITIONS,
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
            const { workflow, views, live } = snapshotOf(db, flags.workflow)
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
