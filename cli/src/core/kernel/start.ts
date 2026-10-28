import { startKernel } from "../../harness/kernel.js"
import { locateOrca } from "../../harness/orca/client.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci kernel start <workflow>`: from the terminal of the Supervisor of the workflow's project, launches the Kernel of a
 * running orca workflow whose Kernel Orca reports gone (or that never had one, or `--replace`), in the workflow's worktree, into
 * that Run. Every previous Kernel seat of the workflow is stopped, released and its tab closed first, so one Kernel holds it.
 */
export const kernelStartVerb = defineVerb({
    path: ["kernel", "start"],
    summary: "launch (or relaunch) a running orca workflow's [Kernel] agent from the terminal of its project's Supervisor, retiring the previous Kernel seat and its tab; refuses while Orca shows one alive unless --replace",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/kernel@1",
    flags: {
        workflow: { kind: "string", required: true, positional: true, summary: "the running workflow id" },
        replace: { kind: "boolean", summary: "retire the previous Kernel even while Orca shows it alive (stop, release, close its tab), then launch" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const data = await startKernel(root, context.cwd, flags.workflow, await locateOrca(context.cwd), { replace: flags.replace })
        return { data, message: data.notes.join("\n") }
    },
})
