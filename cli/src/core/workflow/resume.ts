import { inTransaction, openLedger } from "../../harness/ledger.js"
import { getWorkflow, setWorkflowStatus } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { exitOf, reportMessage, stepWorkflow } from "./engine.js"

/**
 * `starci workflow resume <id>`: a paused workflow runs again and takes one step at once, so what became ready while it was
 * paused is dispatched now; the step moves it to the status its nodes call for (blocked, done or running).
 */
export const workflowResumeVerb = defineVerb({
    path: ["workflow", "resume"],
    summary: "restart a paused workflow's dispatch and take one step (exit 1 when it is blocked)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor", "kernel"],
    schema: "starci/workflow-step@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            inTransaction(db, () => {
                const workflow = getWorkflow(db, flags.workflow)
                if (workflow.status !== "paused") throw new Refusal("WORKFLOW_NOT_PAUSED", `workflow ${workflow.id} is ${workflow.status}, not paused`)
                setWorkflowStatus(db, workflow.id, "running", null)
            })
        } finally {
            db.close()
        }
        const report = await stepWorkflow(context, root, flags.workflow)
        return { data: report, message: reportMessage(report), exitCode: exitOf(report) }
    },
})
