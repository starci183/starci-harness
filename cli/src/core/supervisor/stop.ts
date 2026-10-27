import { locateOrca } from "../../harness/orca/client.js"
import { stopSupervisor } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci supervisor stop`: closes the host Supervisor's terminal and retires its record; --abandon retires a launch with no receipt. */
export const supervisorStopVerb = defineVerb({
    path: ["supervisor", "stop"],
    summary: "stop the host [Supervisor] terminal and retire its record (--abandon: a reserved launch Orca gave no receipt for)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/supervisor-stop@1",
    flags: { abandon: { kind: "boolean", summary: "retire a reservation whose launch has no terminal receipt, after checking Orca by hand" } },
    run: async (context, flags) => {
        const data = await stopSupervisor(await locateOrca(context.cwd), context.cwd, flags.abandon)
        return { data, message: data.stopped === null ? "no Supervisor" : `stopped Supervisor ${data.stopped}` }
    },
})
