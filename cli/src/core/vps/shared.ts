import { inventoryDir, loadServer, loadVpsPolicy, locateFleetOps, resolvePins } from "../../harness/vps/policy.js"
import type { ManagedServer, VpsPins, VpsPolicy } from "../../harness/vps/policy.js"
import { describePlan } from "../../harness/vps/plan.js"
import type { VpsPlan } from "../../harness/vps/plan.js"
import type { StepOutcome } from "../../harness/vps/fleet.js"
import { UsageError } from "../../shared/errors.js"
import type { Role, VerbResult } from "../../shared/verb.js"

/** The owner alone runs a verb that opens the fleet's sealed keys. */
export const OWNER: readonly Role[] = ["owner"]

/** The owner and the Supervisor read the fleet's health (they open the sealed logins, change nothing). */
export const READERS: readonly Role[] = ["owner", "supervisor"]

/** The `--execute` flag every acting verb takes. */
export const EXECUTE = { kind: "boolean", summary: "apply the plan; without it the verb is a dry run that prints the plan and changes nothing" } as const

/** The `<id>` operand. */
export const SERVER_ID = { kind: "string", summary: "the server id (its ops/vps/servers/<id>.yaml)", required: true, positional: true } as const

/** The json data of a vps verb: a plain object of what it planned, found or did. */
export type VpsData = Readonly<Record<string, unknown>>

/** The policy, its ops folder and a server of the inventory. */
export interface VpsScope {
    readonly policy: VpsPolicy
    readonly opsDir: string
    readonly server: ManagedServer
}

/** Loads the policy and one server. */
export const scopeOf = (id: string): VpsScope => {
    const opsDir = locateFleetOps()
    const policy = loadVpsPolicy(opsDir)
    return { policy, opsDir, server: loadServer(policy, id, inventoryDir(policy, opsDir)) }
}

/** The policy's pins of a scope. */
export const pinsOf = (scope: VpsScope): VpsPins => resolvePins(scope.policy, scope.opsDir)

/** Refuses an action operand the verb does not take. */
export const requireAction = <A extends string>(action: string, actions: readonly A[], verb: string): A => {
    const found = actions.find((candidate) => candidate === action)
    if (found === undefined) throw new UsageError(`starci vps ${verb} takes ${actions.join(" | ")}; ${action} is neither`)
    return found
}

/** The answer of a planned verb: the plan in a dry run, or the plan and its outcomes; exit 1 when a step failed. */
export const planResult = (plan: VpsPlan, outcomes: readonly StepOutcome[] | undefined, extra: readonly string[] = []): VerbResult<{ readonly plan: VpsPlan; readonly outcomes: readonly StepOutcome[] | null; readonly execute: boolean }> => {
    const failed = outcomes?.some((outcome) => outcome.outcome === "failed") === true
    const lines = [
        ...describePlan(plan, outcomes !== undefined),
        ...(outcomes ?? []).map((outcome) => `  ${outcome.id}: ${outcome.outcome}${outcome.detail === "" ? "" : ` (${outcome.detail})`}`),
        ...extra,
    ]
    return { data: { plan, outcomes: outcomes ?? null, execute: outcomes !== undefined }, message: lines.join("\n"), ...(failed ? { exitCode: 1 } : {}) }
}
