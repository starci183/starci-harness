import { attachKernel } from "../../harness/kernel.js"
import { locateOrca } from "../../harness/orca/client.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci kernel attach <workflow> --launch <id>`: the Kernel agent's first command; its loop is then `kernel next` / `kernel submit`. */
export const kernelAttachVerb = defineVerb({
    path: ["kernel", "attach"],
    summary: "adopt the launched Kernel agent's terminal as coordinator of the workflow's child Run and its [Kernel] task",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel"],
    schema: "starci/kernel-attached@1",
    flags: {
        workflow: { kind: "string", required: true, positional: true, summary: "the workflow id" },
        launch: { kind: "string", required: true, summary: "the launch id the Kernel brief names" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const data = await attachKernel(root, context.cwd, flags.workflow, flags.launch, await locateOrca(context.cwd))
        return { data, message: [...data.notes, `next: starci kernel next ${flags.workflow}`].join("\n") }
    },
})
