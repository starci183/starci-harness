import { openLedger } from "../../harness/ledger.js"
import { getWorkflow, setWorkflowStatus } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { exitOf, reportMessage, stepWorkflow } from "./engine.js"

/**
 * `starci workflow start <id>`: a defined workflow starts running and takes its first step: orca dispatches every ready task
 * up to maxParallel and launches their seats; inline queues the first ready task and prints it for the chat agent.
 */
export const workflowStartVerb = defineVerb({
    path: ["workflow", "start"],
    summary: "start a defined workflow: orca dispatches its ready tasks to worker seats, inline prints the next task for the chat agent",
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
            const workflow = getWorkflow(db, flags.workflow)
            if (workflow.status !== "defined") throw new Refusal("WORKFLOW_STARTED", `workflow ${workflow.id} is ${workflow.status}; a started workflow moves with starci workflow step ${workflow.id}`)
            setWorkflowStatus(db, workflow.id, "running", null)
        } finally {
            db.close()
        }
        const report = await stepWorkflow(context, root, flags.workflow)
        return { data: report, message: reportMessage(report), exitCode: exitOf(report) }
    },
})
