import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { parseWait } from "../kernel/next.js"
import { projectFrom, supervisorNext } from "./driver.js"
import type { SupervisorNext } from "./driver.js"

/** The head and detail lines of what `next` returned. */
const linesOf = (data: SupervisorNext): string[] => {
    const { decision, worker, request } = data
    if (decision !== null) return [`${data.kind} ${decision.id} of ${decision.workflowId} in ${decision.project}`, `evidence: ${JSON.stringify(decision.evidence)}`]
    if (worker !== null) return [`worker ${worker.id} ${worker.completion ?? worker.taskStatus}: ${worker.topic} (task ${worker.task} in ${worker.repo})`, `result: ${JSON.stringify(worker.result?.output ?? null)}`]
    if (request !== null) return [`owner-request ${request.id} from ${request.by} at ${request.at}`, `request: ${request.text}`]
    return ["idle"]
}

/**
 * `starci supervisor next`: a Supervisor's only wait, for its project. It keeps one live Kernel per running orca workflow the
 * Supervisor owns in the project's repositories (relaunching on Orca's word, pausing and escalating past the relaunch limit), tends
 * its `[Worker]` seats (pings them, closes the seats of finished ones, launches queued ones into free slots), and returns the
 * project's next open escalation or handoff it rules with its workflow digest, else a worker's report or end, else its oldest owner
 * request (`supervisor ask`), else an escalation awaiting the owner or Debug, handed over once; idle when none came.
 */
export const supervisorNextVerb = defineVerb({
    path: ["supervisor", "next"],
    summary: "sweep the project's Kernels and [Worker] seats, then return its next escalation or handoff with a digest, else a worker's report or end (once), else its oldest owner-request, else one awaiting the owner or Debug (once); idle after --wait",
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
        const [head, ...said] = linesOf(data)
        return { data, message: [`supervisor: ${head ?? "idle"}`, ...said, ...data.actions].join("\n") }
    },
})
