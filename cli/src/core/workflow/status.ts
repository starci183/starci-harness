import { openExistingLedger } from "../../harness/ledger.js"
import { snapshotOf } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { nodeTable } from "./engine.js"

/** `starci workflow status <id>`: the workflow's status, reason, graph version, and every task's state and why; a pure read. */
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
        const db = openExistingLedger(await repositoryRoot(context.cwd))
        if (db === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${flags.workflow}: this project has no ledger yet`)
        try {
            const { workflow, views, live } = snapshotOf(db, flags.workflow)
            const done = views.filter((view) => view.state === "done").length
            const data = {
                workflow: workflow.id,
                goal: workflow.header.goal,
                runner: workflow.header.runner,
                status: workflow.status,
                reason: workflow.reason,
                goalVersion: workflow.goalVersion,
                graphVersion: workflow.graphVersion,
                maxParallel: workflow.header.maxParallel,
                done,
                total: views.length,
                live,
                nodes: views,
            }
            const message = [
                `workflow ${workflow.id} (${workflow.header.runner}, graph v${String(workflow.graphVersion)}): ${workflow.status}, ${String(done)}/${String(views.length)} done, ${String(live)} live`,
                `goal: ${workflow.header.goal}`,
                ...(workflow.reason === null ? [] : [`reason: ${workflow.reason}`]),
                nodeTable(views),
            ].join("\n")
            return { data, message }
        } finally {
            db.close()
        }
    },
})
