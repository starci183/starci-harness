import { attachKernel } from "../../harness/kernel.js"
import { locateOrca } from "../../harness/orca/client.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { exitOf, reportMessage, stepWorkflow } from "../workflow/engine.js"

/** Attaches the Kernel agent's terminal to its child Run, then takes the first workflow step. */
export const kernelAttachVerb = defineVerb({
    path: ["kernel", "attach"],
    summary: "attach the dispatched Kernel terminal, create its child Run and take a workflow step",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel"],
    schema: "starci/kernel-attached@1",
    flags: {
        workflow: { kind: "string", required: true, positional: true, summary: "the workflow id" },
        launch: { kind: "string", required: true, summary: "the launch id supplied in the generated Kernel brief" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const attached = await attachKernel(root, context.cwd, flags.workflow, flags.launch, await locateOrca(context.cwd))
        const report = await stepWorkflow(context, root, flags.workflow)
        return { data: { ...attached, report }, message: [...attached.notes, reportMessage(report)].join("\n"), exitCode: exitOf(report) }
    },
})
