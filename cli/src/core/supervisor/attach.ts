import { locateOrca } from "../../harness/orca/client.js"
import { attachSupervisor, supervisorTitle } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

/** Binds the launched Supervisor's own terminal to its project's record and Orca Run. */
export const supervisorAttachVerb = defineVerb({
    path: ["supervisor", "attach"],
    summary: "attach the project's reserved Supervisor agent terminal and create its Run and task",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor"],
    schema: "starci/supervisor@1",
    flags: {
        launch: { kind: "string", required: true, summary: "the launch id supplied in the generated Supervisor brief" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const data = await attachSupervisor(await locateOrca(context.cwd), context.cwd, project, flags.launch)
        return { data, message: `attached ${supervisorTitle(project.name)} ${data.terminal ?? "-"} to Run ${data.run_id ?? "-"}, task ${data.task_id ?? "-"}` }
    },
})
