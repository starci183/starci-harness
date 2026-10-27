import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { parseWait } from "../kernel/next.js"
import { projectFrom, supervisorNext } from "./driver.js"

/**
 * `starci supervisor next`: a Supervisor's only wait, for its project. It keeps one live Kernel per running orca workflow the
 * Supervisor owns in the project's repositories (relaunching on Orca's word, pausing and escalating past the relaunch limit) and
 * returns the project's oldest open escalation or handoff with its workflow digest; idle when none came.
 */
export const supervisorNextVerb = defineVerb({
    path: ["supervisor", "next"],
    summary: "sweep the Kernels of the workflows the project's Supervisor owns (relaunch on Orca's word) and return the project's oldest escalation or handoff with a digest; idle after --wait",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor", "owner"],
    schema: "starci/supervisor-next@1",
    flags: {
        wait: { kind: "string", summary: "seconds to wait for a decision before returning idle (default ops/liveness.yaml coordinators.nextWaitSeconds)" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const data = await supervisorNext(context, await projectFrom(context, flags.project), parseWait(flags.wait))
        const head = data.decision === null ? "idle" : `${data.kind} ${data.decision.id} of ${data.decision.workflowId} in ${data.decision.project}`
        const lines = [`supervisor: ${head}`, ...(data.decision === null ? [] : [`evidence: ${JSON.stringify(data.decision.evidence)}`]), ...data.actions]
        return { data, message: lines.join("\n") }
    },
})
