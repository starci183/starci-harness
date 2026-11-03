import { readWaiters, relaysOf } from "../../harness/needs.js"
import type { NeedRow, RelayRecord, WaiterRow } from "../../harness/needs.js"

/** One need with its waiters and the cross-branch relays of its resolving commits, as `needs list` and `needs show` print it. */
export interface NeedView extends NeedRow {
    readonly waiters: readonly WaiterRow[]
    readonly relays: readonly RelayRecord[]
}

/** A need with its waiters and relays read from the host store. */
export const viewOf = (need: NeedRow): NeedView => ({ ...need, waiters: readWaiters(need.project, need.key), relays: relaysOf(need.project, need.key) })

/** Who owns or resolves a need, in a few words. */
export const ownerLine = (need: NeedRow): string => {
    if (need.resolver?.kind === "task") {
        if (need.resolver.workflow === null) return `task ${need.resolver.task ?? "?"}`
        const keys = need.resolver.keys ?? (need.resolver.key === null ? [] : [need.resolver.key])
        return keys.map((key) => `${need.resolver?.kind === "task" ? (need.resolver.workflow ?? "?") : "?"}:${key}`).join(", ") || "-"
    }
    if (need.resolver?.kind === "package") {
        const handoffSuffix = need.resolver.handoff === null ? "" : ` ${need.resolver.handoff.branch}`
        const workerSuffix = need.resolver.worker === null ? "" : ` by ${need.resolver.worker}`
        return `package edit${handoffSuffix}${workerSuffix}`
    }
    if (need.owner?.kind === "workflow") return `workflow ${need.owner.workflow}`
    if (need.owner?.kind === "worker") return `worker ${need.owner.worker}`
    return "-"
}

/** One waiter in a few words: where it waits and whether it is reported, parked or released. */
export const waiterLine = (waiter: WaiterRow): string => `${waiter.workflow ?? "worker"}:${waiter.taskKey ?? "-"} (${waiter.task}${waiterStage(waiter)})`

const waiterStage = (waiter: WaiterRow): string => {
    if (waiter.releasedAt !== null) return ", released"
    return waiter.parkedAt === null ? ", reported" : ", parked"
}

/** One relay in a line: the waiting workflow and branch, how it went, and each resolving commit with the commit it became there. */
export const relayLine = (relay: RelayRecord): string => {
    const commitsText = relay.relayed.map((one) => `${one.from.slice(0, 12)} -> ${one.to.slice(0, 12)}`).join(", ")
    const relayedSuffix = relay.relayed.length === 0 ? "" : ` ${commitsText}`
    const filesSuffix = relay.files.length === 0 ? "" : `; conflict in ${relay.files.join(", ")}`
    return `relay to ${relay.workflow} (${relay.branch}, round ${String(relay.round)}): ${relay.status}${relayedSuffix}${filesSuffix}`
}
