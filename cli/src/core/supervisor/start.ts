import { locateOrca } from "../../harness/orca/client.js"
import { startSupervisor, supervisorTitle } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

/** Starts a project's routed Supervisor agent in the project's main checkout and refuses a second live seat of that project. */
export const supervisorStartVerb = defineVerb({
    path: ["supervisor", "start"],
    summary: "launch the project's [Supervisor] <project> agent in its main checkout (the project of the working directory, or --project)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor@1",
    flags: { project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" } },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const data = await startSupervisor(await locateOrca(context.cwd), context.cwd, project)
        return { data, message: `${supervisorTitle(project.name)} ${data.agent}/${data.model} in ${project.root}: ${data.terminal ?? "starting; its agent attaches"}` }
    },
})
