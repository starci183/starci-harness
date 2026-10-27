import { classifyFailure, recordOutcome } from "./circuit.js"
import type { ProviderOutcome } from "./circuit.js"
import { OrcaFailure } from "./orca/client.js"
import { loadRouting, poolOfAgent, providerOfAgent } from "./routing.js"

/** Who a coordinator launch accounts to: the routed agent and its pool. */
export interface CoordinatorMember {
    readonly agent: string
    readonly pool: string
}

const report = (member: CoordinatorMember, outcome: ProviderOutcome): void => {
    try {
        recordOutcome(providerOfAgent(loadRouting(), member.agent), outcome)
    } catch (error: unknown) {
        process.stderr.write(`coordinator provider outcome was not recorded: ${error instanceof Error ? error.message : String(error)}\n`)
    }
}

/** Accounts a coordinator launch (or its replay) through the same provider circuit and AIMD feedback as Op workers. */
export const coordinatorLaunch = async <T>(member: CoordinatorMember, launch: () => Promise<T>): Promise<T> => {
    const pool = poolOfAgent(loadRouting(), member.pool) ?? member.pool
    let result: T
    try {
        result = await launch()
    } catch (error: unknown) {
        if (error instanceof OrcaFailure) {
            const kind = error.effect === "unknown" ? "unknown" : classifyFailure(loadRouting(), `${error.orcaCode ?? ""} ${error.message}`)
            report(member, { kind, pool, detail: error.message })
        }
        throw error
    }
    report(member, { kind: "success", pool })
    return result
}
