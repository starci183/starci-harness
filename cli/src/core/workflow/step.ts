import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { exitOf, reportMessage, stepWorkflow } from "./engine.js"

/**
 * `starci workflow step <id>`: one idempotent dispatch tick: settle what is reported (task verify), dispatch what became ready,
 * move the workflow's status. Exit 1 when the workflow is blocked, so a loop stops and the Kernel amends.
 */
export const workflowStepVerb = defineVerb({
    path: ["workflow", "step"],
    summary: "one dispatch tick: ping running seats, verify reported tasks, dispatch newly ready ones within maxParallel, update the status (exit 1 when blocked)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/workflow-step@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
    },
    run: async (context, flags) => {
        const report = await stepWorkflow(context, await repositoryRoot(context.cwd), flags.workflow)
        return { data: report, message: reportMessage(report), exitCode: exitOf(report) }
    },
})
