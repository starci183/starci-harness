import { startKernel } from "../../harness/kernel.js"
import { locateOrca } from "../../harness/orca/client.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** Relaunches a running workflow's missing Kernel as a Supervisor child dispatch. */
export const kernelStartVerb = defineVerb({
    path: ["kernel", "start"],
    summary: "launch a running Orca workflow's Kernel agent from the Supervisor terminal",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/kernel@1",
    flags: { workflow: { kind: "string", required: true, positional: true, summary: "the running workflow id" } },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const data = await startKernel(root, context.cwd, flags.workflow, await locateOrca(context.cwd))
        return { data, message: data.notes.join("\n") }
    },
})
