import { locateOrca } from "../../harness/orca/client.js"
import { stopSupervisor, supervisorTitle } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

/** `starci supervisor stop`: closes a project's Supervisor tab and retires its record; --abandon retires a launch with no receipt. */
export const supervisorStopVerb = defineVerb({
    path: ["supervisor", "stop"],
    summary: "close the project's [Supervisor] tab, its agent with it, and retire its record (--abandon: a reserved launch Orca gave no receipt for)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor-stop@1",
    flags: {
        abandon: { kind: "boolean", summary: "retire a reservation whose launch has no terminal receipt, after checking Orca by hand" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const data = await stopSupervisor(await locateOrca(context.cwd), context.cwd, project, flags.abandon)
        return { data, message: data.stopped === null ? `no Supervisor of ${project.name}` : `stopped ${supervisorTitle(project.name)} ${data.stopped}, tab ${data.tab}` }
    },
})
