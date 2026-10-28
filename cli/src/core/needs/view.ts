import { readWaiters } from "../../harness/needs.js"
import type { NeedRow, WaiterRow } from "../../harness/needs.js"

/** One need with its waiters, as `needs list` and `needs show` print it. */
export interface NeedView extends NeedRow {
    readonly waiters: readonly WaiterRow[]
}

export const viewOf = (need: NeedRow): NeedView => ({ ...need, waiters: readWaiters(need.project, need.key) })

/** Who owns or resolves a need, in a few words. */
export const ownerLine = (need: NeedRow): string => {
    if (need.resolver?.kind === "task") return need.resolver.workflow === null ? `task ${need.resolver.task ?? "?"}` : `${need.resolver.workflow}:${need.resolver.key ?? "?"}`
    if (need.resolver?.kind === "package") return `package edit${need.resolver.handoff === null ? "" : ` ${need.resolver.handoff.branch}`}${need.resolver.worker === null ? "" : ` by ${need.resolver.worker}`}`
    if (need.owner?.kind === "workflow") return `workflow ${need.owner.workflow}`
    if (need.owner?.kind === "worker") return `worker ${need.owner.worker}`
    return "-"
}

/** One waiter in a few words: where it waits and whether it is reported, parked or released. */
export const waiterLine = (waiter: WaiterRow): string => `${waiter.workflow ?? "worker"}:${waiter.taskKey ?? "-"} (${waiter.task}${waiter.releasedAt === null ? (waiter.parkedAt === null ? ", reported" : ", parked") : ", released"})`

