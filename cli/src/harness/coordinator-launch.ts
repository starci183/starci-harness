import { classifyFailure, recordOutcome } from "./circuit.js"
import type { ProviderOutcome } from "./circuit.js"
import { BLOCKED_PROMPT, explainLaunchFailure } from "./launch-failure.js"
import type { LaunchFailure } from "./launch-failure.js"
import { OrcaFailure } from "./orca/client.js"
import type { OrcaBinary } from "./orca/client.js"
import { loadRouting, poolOfAgent, providerOfAgent } from "./routing.js"

/** Who a coordinator launch accounts to: the routed agent and its pool. */
export interface CoordinatorMember {
    readonly agent: string
    readonly pool: string
}

/** How a worker-start launch's certain failure is explained (its screen read once) and where the explanation goes. */
export interface LaunchExplaining {
    readonly binary: OrcaBinary
    readonly cwd: string
    readonly explained: (failure: LaunchFailure) => void
}

const report = (member: CoordinatorMember, outcome: ProviderOutcome): void => {
    try {
        recordOutcome(providerOfAgent(loadRouting(), member.agent), outcome)
    } catch (error: unknown) {
        process.stderr.write(`coordinator provider outcome was not recorded: ${error instanceof Error ? error.message : String(error)}\n`)
    }
}

/**
 * Accounts a coordinator launch (or its replay) through the same provider circuit and AIMD feedback as Op workers. With
 * `explaining`, a certain failure is explained first (harness/launch-failure.ts): an agent blocked at a prompt reports nothing.
 */
export const coordinatorLaunch = async <T>(member: CoordinatorMember, launch: () => Promise<T>, explaining?: LaunchExplaining): Promise<T> => {
    const routing = loadRouting()
    const pool = poolOfAgent(routing, member.pool) ?? member.pool
    let result: T
    try {
        result = await launch()
    } catch (error: unknown) {
        if (error instanceof OrcaFailure && error.effect === "unknown") report(member, { kind: "unknown", detail: error.message })
        else if (error instanceof OrcaFailure) {
            const failure = explaining === undefined ? null : await explainLaunchFailure(explaining.binary, error, explaining.cwd, routing)
            if (failure !== null) explaining?.explained(failure)
            const kind = failure?.kind ?? classifyFailure(routing, `${error.orcaCode ?? ""} ${error.message}`)
            if (kind !== BLOCKED_PROMPT && kind !== "stall") report(member, { kind, pool, detail: error.message })
        }
        throw error
    }
    report(member, { kind: "success", pool })
    return result
}
