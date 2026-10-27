import { locateOrca } from "../../harness/orca/client.js"
import { supervisorStatus } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci supervisor status`: the host Supervisor's record and its liveness from Orca's terminal list; changes nothing. */
export const supervisorStatusVerb = defineVerb({
    path: ["supervisor", "status"],
    summary: "report the host Supervisor's record, lease and liveness (absent, starting, alive, gone or unknown)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: ["owner", "supervisor", "debug"],
    schema: "starci/supervisor-status@1",
    flags: {},
    run: async (context) => {
        const binary = await locateOrca(context.cwd).catch(() => undefined)
        const data = await supervisorStatus(binary, context.cwd)
        const seat = data.supervisor
        const detail = seat === null ? "" : ` (${seat.agent}/${seat.model}, terminal ${seat.terminal ?? "-"}, Run ${seat.run_id ?? "-"}, lease until ${seat.lease_until ?? "-"}${data.leaseExpired ? ", expired" : ""})`
        return { data, message: `Supervisor: ${data.liveness}${detail}` }
    },
})
