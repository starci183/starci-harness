import { inTransaction, openLedger } from "../../harness/ledger.js"
import { isParkedReason } from "../../harness/park.js"
import { getWorkflow, pausedBy, setWorkflowStatus } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { actorOf, COORDINATORS, HOLDING_ACTORS } from "./actor.js"
import { exitOf, reportMessage, stepWorkflow } from "./engine.js"

/**
 * `starci workflow resume <id>`: a paused workflow runs again and takes one step at once, so what became ready while it was
 * paused is dispatched now; the step moves it to the status its nodes call for (blocked, done or running). A pause the owner or
 * Debug set (`pausedBy`) is refused WORKFLOW_HELD from a Supervisor or Kernel (`actorOf`), and a parked workflow WORKFLOW_PARKED
 * from anyone: `project unpark` lifts it.
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
                if (isParkedReason(workflow.reason)) throw new Refusal("WORKFLOW_PARKED", `workflow ${workflow.id} is parked with its project; starci project unpark brings it back`)
                const actor = actorOf(db)
                const holder = pausedBy(db, workflow.id)
                if (COORDINATORS.includes(actor) && holder !== null && HOLDING_ACTORS.includes(holder)) {
                    throw new Refusal("WORKFLOW_HELD", `workflow ${workflow.id} was paused by the ${holder}; a ${actor} never lifts that pause, the ${holder} resumes it`)
                }
                setWorkflowStatus(db, workflow.id, "running", null, actor)
            })
        } finally {
            db.close()
        }
        const report = await stepWorkflow(context, root, flags.workflow)
        return { data: report, message: reportMessage(report), exitCode: exitOf(report) }
    },
})
