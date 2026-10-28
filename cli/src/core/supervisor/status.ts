import { locateOrca } from "../../harness/orca/client.js"
import { inOrder } from "../../harness/sequential.js"
import { liveSupervisors, projectOfRecord, supervisorStatus, supervisorTitle } from "../../harness/supervisor.js"
import type { SupervisorState } from "../../harness/supervisor.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

/** What `supervisor status` says of a Supervisor: its liveness, except that one alive past its lease is stalled (its loop stopped). */
type StatusWord = SupervisorState["liveness"] | "stalled"

const wordOf = (state: SupervisorState): StatusWord => (state.liveness === "alive" && state.leaseExpired ? "stalled" : state.liveness)

const lineOf = (state: SupervisorState): string => {
    const seat = state.supervisor
    const word = wordOf(state)
    const head = word === "stalled" ? `stalled (lease expired at ${seat?.lease_until ?? "-"})` : word
    const lease = state.leaseExpired ? `lease expired at ${seat?.lease_until ?? "-"}` : `lease until ${seat?.lease_until ?? "-"}`
    const detail = seat === null ? "" : ` (${seat.agent}/${seat.model}, terminal ${seat.terminal ?? "-"}, Run ${seat.run_id ?? "-"}, ${lease})`
    return `${supervisorTitle(state.project.name)} ${state.project.root}: ${head}${detail}`
}

/**
 * `starci supervisor status`: a project's Supervisor record and its liveness from Orca's terminal list (`--project`), or, with no
 * project, every live Supervisor of the host, one per project; one Orca lists but whose lease expired is `stalled`, never alive
 * (the tick's stall ladder nudges it). Changes nothing.
 */
export const supervisorStatusVerb = defineVerb({
    path: ["supervisor", "status"],
    summary: "report one project's Supervisor (--project) or every project's: record, lease and liveness (absent, starting, alive, stalled past its lease, gone or unknown)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: ["owner", "supervisor", "debug"],
    schema: "starci/supervisor-status@1",
    flags: { project: { kind: "string", summary: "any checkout or worktree of one project's repositories (default: every project)" } },
    run: async (context, flags) => {
        const binary = await locateOrca(context.cwd).catch(() => undefined)
        const projects = flags.project === undefined ? liveSupervisors().map(projectOfRecord) : [await projectFrom(context, flags.project, false)]
        const states = await inOrder(projects, async (project) => supervisorStatus(binary, context.cwd, project))
        const supervisors = states.map((state) => ({ ...state, liveness: wordOf(state) }))
        // One word for the host: alive when every listed Supervisor is, absent when none is listed, else the first other word.
        const liveness = supervisors.length === 0 ? "absent" : (supervisors.find((state) => state.liveness !== "alive")?.liveness ?? "alive")
        return { data: { liveness, supervisors }, message: states.length === 0 ? "no Supervisor" : states.map(lineOf).join("\n") }
    },
})
