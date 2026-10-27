import { openExistingLedger } from "../../harness/ledger.js"
import { listWorkflows, snapshotOf } from "../../harness/workflow.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** `starci workflow list`: every workflow of the project with its runner, status, graph version and progress; a pure read. */
export const workflowListVerb = defineVerb({
    path: ["workflow", "list"],
    summary: "the project's workflows: runner, status, graph version, tasks done of total, and the reason of a blocked one",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/workflow-list@1",
    flags: {},
    run: async (context) => {
        const db = openExistingLedger(await repositoryRoot(context.cwd))
        if (db === undefined) return { data: { workflows: [] }, message: "no workflows" }
        try {
            const workflows = listWorkflows(db).map((workflow) => {
                const { views } = snapshotOf(db, workflow.id)
                const done = views.filter((view) => view.state === "done").length
                return { id: workflow.id, runner: workflow.header.runner, status: workflow.status, goalVersion: workflow.goalVersion, graphVersion: workflow.graphVersion, done, total: views.length, reason: workflow.reason, goal: workflow.header.goal }
            })
            const rows = workflows.map((row) => [row.id, row.runner, row.status, `v${String(row.goalVersion)}`, `v${String(row.graphVersion)}`, `${String(row.done)}/${String(row.total)}`, row.reason ?? "-"])
            const message = workflows.length === 0 ? "no workflows" : formatTable([["WORKFLOW", "RUNNER", "STATUS", "GOAL", "GRAPH", "DONE", "REASON"], ...rows])
            return { data: { workflows }, message }
        } finally {
            db.close()
        }
    },
})
