import { openLedger } from "../../harness/ledger.js"
import { inTransaction } from "../../harness/leases.js"
import { DISPATCHING, getWorkflow, setWorkflowStatus } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { readSnapshot, reportMessage, reportOf } from "./engine.js"

/**
 * `starci workflow pause <id>`: holds dispatch. Nothing new is dispatched or launched while paused; live tasks keep running,
 * and each step still verifies and settles what they report. `workflow resume` restarts dispatch.
 */
export const workflowPauseVerb = defineVerb({
    path: ["workflow", "pause"],
    summary: "hold a running workflow's dispatch: nothing new is sent, live tasks keep running and each step still settles them; resume restarts it",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor", "kernel"],
    schema: "starci/workflow-step@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        reason: { kind: "string", summary: "why, kept as the workflow's reason while it is paused" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            inTransaction(db, () => {
                const workflow = getWorkflow(db, flags.workflow)
                if (workflow.status === "paused") throw new Refusal("WORKFLOW_PAUSED", `workflow ${workflow.id} is paused already; starci workflow resume ${workflow.id} restarts it`)
                if (!DISPATCHING.includes(workflow.status)) throw new Refusal("WORKFLOW_NOT_RUNNING", `workflow ${workflow.id} is ${workflow.status}; only a running or blocked workflow is paused`)
                setWorkflowStatus(db, workflow.id, "paused", flags.reason ?? `paused (was ${workflow.status})`)
            })
        } finally {
            db.close()
        }
        const report = reportOf(root, readSnapshot(root, flags.workflow), [])
        return { data: report, message: reportMessage(report) }
    },
})
