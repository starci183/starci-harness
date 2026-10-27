import { locateOrca } from "../../harness/orca/client.js"
import { ensureSupervisor, supervisorTitle } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

/**
 * `starci supervisor ensure`: keeps a project's one Supervisor. It starts one when there is none or Orca says its terminal is
 * gone, replays a launch whose answer was lost, and otherwise does nothing; `supervisor tick` does it for every project.
 */
export const supervisorEnsureVerb = defineVerb({
    path: ["supervisor", "ensure"],
    summary: "start the project's Supervisor when none is alive by Orca's word, replay a lost launch, else nothing",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor-ensure@1",
    flags: { project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" } },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const data = await ensureSupervisor(await locateOrca(context.cwd), context.cwd, project)
        return { data, message: `${supervisorTitle(project.name)} ${data.liveness}: ${data.action}, ${data.detail}`, ...(data.action === "stuck" ? { exitCode: 1 } : {}) }
    },
})
