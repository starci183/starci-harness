import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { parseWait } from "../kernel/next.js"
import { supervisorNext } from "./driver.js"

/**
 * `starci supervisor next`: the Supervisor's only wait. It keeps one live Kernel per running orca workflow on the host
 * (relaunching on Orca's word, pausing and escalating past the relaunch limit) and returns the oldest open escalation or
 * handoff with its workflow digest; idle when none came.
 */
export const supervisorNextVerb = defineVerb({
    path: ["supervisor", "next"],
    summary: "sweep every project's Kernels (relaunch on Orca's word) and return the oldest escalation or handoff with a digest; idle after --wait",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor", "owner"],
    schema: "starci/supervisor-next@1",
    flags: { wait: { kind: "string", summary: "seconds to wait for a decision before returning idle (default ops/liveness.yaml coordinators.nextWaitSeconds)" } },
    run: async (context, flags) => {
        const data = await supervisorNext(context, parseWait(flags.wait))
        const head = data.decision === null ? "idle" : `${data.kind} ${data.decision.id} of ${data.decision.workflowId} in ${data.decision.project}`
        const lines = [`supervisor: ${head}`, ...(data.decision === null ? [] : [`evidence: ${JSON.stringify(data.decision.evidence)}`]), ...data.actions]
        return { data, message: lines.join("\n") }
    },
})
