import { locateOrca } from "../../harness/orca/client.js"
import { supervisorRecord, supervisorStatus } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** Reports the singleton Supervisor and its liveness from Orca's terminal list. */
export const supervisorStatusVerb = defineVerb({
    path: ["supervisor", "status"],
    summary: "report the Supervisor's recorded identity and live terminal state",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: ["owner", "debug"],
    schema: "starci/supervisor-status@1",
    flags: {},
    run: async (context) => {
        const data = supervisorRecord() === null ? { supervisor: null, liveness: "absent" } : await supervisorStatus(await locateOrca(context.cwd), context.cwd)
        return { data, message: `Supervisor: ${data.liveness}` }
    },
})
