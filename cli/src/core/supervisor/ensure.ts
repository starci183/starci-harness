import { locateOrca } from "../../harness/orca/client.js"
import { ensureSupervisor } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci supervisor ensure`: keeps one Supervisor on the host, for a scheduler to run every few minutes. It starts one when
 * there is none or Orca says its terminal is gone, replays a launch whose answer was lost, and otherwise does nothing.
 */
export const supervisorEnsureVerb = defineVerb({
    path: ["supervisor", "ensure"],
    summary: "start the Supervisor when none is alive by Orca's word, replay a lost launch, else nothing (for a scheduled task)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor-ensure@1",
    flags: {},
    run: async (context) => {
        const data = await ensureSupervisor(await locateOrca(context.cwd), context.cwd)
        return { data, message: `Supervisor ${data.liveness}: ${data.action}, ${data.detail}`, ...(data.action === "stuck" ? { exitCode: 1 } : {}) }
    },
})
