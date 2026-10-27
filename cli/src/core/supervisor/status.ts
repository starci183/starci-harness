import { locateOrca } from "../../harness/orca/client.js"
import { inOrder } from "../../harness/sequential.js"
import { liveSupervisors, projectOfRecord, supervisorStatus, supervisorTitle } from "../../harness/supervisor.js"
import type { SupervisorState } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

const lineOf = (state: SupervisorState): string => {
    const seat = state.supervisor
    const detail = seat === null ? "" : ` (${seat.agent}/${seat.model}, terminal ${seat.terminal ?? "-"}, Run ${seat.run_id ?? "-"}, lease until ${seat.lease_until ?? "-"}${state.leaseExpired ? ", expired" : ""})`
    return `${supervisorTitle(state.project.name)} ${state.project.root}: ${state.liveness}${detail}`
}

/**
 * `starci supervisor status`: a project's Supervisor record and its liveness from Orca's terminal list (`--project`), or, with no
 * project, every live Supervisor of the host, one per project; changes nothing.
 */
export const supervisorStatusVerb = defineVerb({
    path: ["supervisor", "status"],
    summary: "report one project's Supervisor (--project) or every project's: record, lease and liveness (absent, starting, alive, gone or unknown)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: ["owner", "supervisor", "debug"],
    schema: "starci/supervisor-status@1",
    flags: { project: { kind: "string", summary: "any checkout or worktree of one project's repositories (default: every project)" } },
    run: async (context, flags) => {
        const binary = await locateOrca(context.cwd).catch(() => undefined)
        const projects = flags.project === undefined ? liveSupervisors().map(projectOfRecord) : [await projectFrom(context, flags.project, false)]
        const supervisors = await inOrder(projects, async (project) => supervisorStatus(binary, context.cwd, project))
        return { data: { supervisors }, message: supervisors.length === 0 ? "no Supervisor" : supervisors.map(lineOf).join("\n") }
    },
})
