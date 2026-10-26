import { openLedger } from "../../harness/ledger.js"
import { getWorkflow, isLiveTask, setWorkflowStatus, workflowTasks } from "../../harness/workflow.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { cancelTasks, closeKernelActions, readSnapshot, reconcile, reportMessage, reportOf } from "./engine.js"
import type { StepAction } from "./engine.js"

/**
 * `starci workflow stop <id> --graceful|--hard`: graceful dispatches nothing new and lets live tasks report and settle (each
 * step verifies them; the workflow is stopped once none is live); hard cancels every live task now through task cancel, which
 * stops and releases its seats. A task that cannot be cancelled yet (a verify in flight) keeps the workflow stopping. Once the
 * workflow is stopped, after its ops, its Kernel terminal is closed (a graceful stop: by the step that stops it).
 */
export const workflowStopVerb = defineVerb({
    path: ["workflow", "stop"],
    summary: "stop a workflow: --graceful dispatches nothing new and waits for live tasks, --hard cancels every live task and its seats now; once stopped, its Kernel terminal is closed",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/workflow-step@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        graceful: { kind: "boolean", summary: "send nothing new; live tasks finish and settle" },
        hard: { kind: "boolean", summary: "cancel every live task and its seats now" },
    },
    run: async (context, flags) => {
        if (flags.graceful === flags.hard) throw new Refusal("CLI_USAGE", "workflow stop takes exactly one of --graceful and --hard", EXIT_USAGE)
        const mode = flags.hard ? "hard" : "graceful"
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        const live = (() => {
            try {
                const workflow = getWorkflow(db, flags.workflow)
                if (workflow.status === "stopped" || workflow.status === "done") throw new Refusal("WORKFLOW_ENDED", `workflow ${workflow.id} is ${workflow.status} already`)
                setWorkflowStatus(db, workflow.id, workflow.status === "defined" ? "stopped" : "stopping", `${mode} stop asked`)
                return workflowTasks(db, workflow.id).filter(isLiveTask)
            } finally {
                db.close()
            }
        })()
        const actions: StepAction[] = mode === "hard" ? await cancelTasks(context, live.map((task) => ({ key: task.key, task: task.id })), `workflow ${flags.workflow}: hard stop`) : []
        const snapshot = reconcile(root, flags.workflow)
        actions.push(...(await closeKernelActions(context, root, snapshot)))
        const report = reportOf(root, readSnapshot(root, flags.workflow), actions)
        return { data: report, message: reportMessage(report) }
    },
})
