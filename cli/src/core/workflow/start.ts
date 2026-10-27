import { openLedger } from "../../harness/ledger.js"
import { startKernel } from "../../harness/kernel.js"
import { locateOrca } from "../../harness/orca/client.js"
import { requireSupervisor } from "../../harness/supervisor.js"
import { projectOf } from "../../harness/work.js"
import { getWorkflow, setWorkflowStatus } from "../../harness/workflow.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { exitOf, readSnapshot, reportOf, reportMessage, stepWorkflow } from "./engine.js"

/**
 * `starci workflow start <id>`. orca: only from the terminal of the Supervisor of the workflow's project (else
 * SUPERVISOR_REQUIRED); the workflow gets its one worktree and its `[Kernel] <id>` agent is launched into that Supervisor's Run
 * (worker-start --run/--parent/--from). The Kernel's `kernel attach` creates its child Run and its `kernel next` dispatches the
 * Ops. A Kernel launch that fails leaves the workflow running for `kernel start` (or `supervisor next`) to relaunch. inline:
 * unchanged, its first step prints the next task.
 */
export const workflowStartVerb = defineVerb({
    path: ["workflow", "start"],
    summary: "start a defined workflow: orca (from the terminal of its project's Supervisor) makes its one worktree and launches its [Kernel] agent; inline prints the next task",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor", "kernel"],
    schema: "starci/workflow-step@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const before = readSnapshot(root, flags.workflow).workflow
        const binary = before.header.runner === "orca" ? await locateOrca(context.cwd) : undefined
        if (binary !== undefined) await requireSupervisor(binary, context.cwd, await projectOf(root))
        const db = openLedger(root)
        const runner = (() => {
            try {
                const workflow = getWorkflow(db, flags.workflow)
                if (workflow.status !== "defined") throw new Refusal("WORKFLOW_STARTED", `workflow ${workflow.id} is ${workflow.status}; a started workflow moves with starci workflow step ${workflow.id}`)
                setWorkflowStatus(db, workflow.id, "running", null)
                return workflow.header.runner
            } finally {
                db.close()
            }
        })()
        if (runner === "orca" && binary !== undefined) {
            const kernel = await startKernel(root, context.cwd, flags.workflow, binary)
            const report = reportOf(root, readSnapshot(root, flags.workflow), kernel.notes.map((detail) => ({ key: null, task: null, action: "kernel", detail })))
            return { data: report, message: reportMessage(report) }
        }
        const report = await stepWorkflow(context, root, flags.workflow)
        return { data: report, message: reportMessage(report), exitCode: exitOf(report) }
    },
})
