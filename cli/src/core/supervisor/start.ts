import { locateOrca } from "../../harness/orca/client.js"
import { startSupervisor } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** Starts the host's routed Supervisor agent and refuses a second live seat. */
export const supervisorStartVerb = defineVerb({
    path: ["supervisor", "start"],
    summary: "launch the host's [Supervisor] agent in the runtime checkout",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor@1",
    flags: {},
    run: async (context) => {
        const data = await startSupervisor(await locateOrca(context.cwd), context.cwd)
        return { data, message: `Supervisor ${data.agent}/${data.model}: ${data.terminal ?? "starting; its agent attaches"}` }
    },
})
