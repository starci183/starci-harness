import { locateOrca } from "../../harness/orca/client.js"
import { stopSupervisor } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** Closes the host Supervisor and releases its singleton reservation. */
export const supervisorStopVerb = defineVerb({
    path: ["supervisor", "stop"],
    summary: "stop the host Supervisor terminal",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor-stop@1",
    flags: {},
    run: async (context) => {
        const data = await stopSupervisor(await locateOrca(context.cwd), context.cwd)
        return { data, message: data.stopped === null ? "no Supervisor" : `stopped Supervisor ${data.stopped}` }
    },
})
