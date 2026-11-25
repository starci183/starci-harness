// supersede.ts - cancel the local runs a newer push makes stale. A lane runs one gate at a time: a new `lane gate` of the same lane (a new push of it) kills the
// process tree of the lane's running gate and releases its gate slot. Only a holder this host proves alive at the start the slot recorded is killed: a dead or
// reused pid is a reclaim, never a kill.
import { killPidTree } from "../shared/exec.js"
import { freeView, listSlots, liveProbe } from "./slots.js"
import type { HostProbe, SlotRules } from "./slots.js"

/** One run a newer push cancelled: the slot it held (its store row or foreign lock file) and its pid. */
export interface Cancelled {
    readonly where: string
    readonly pid: number
}

/**
 * Cancels the running gate of `lane` that is not this process: each gate slot the lane holds (a row of the host store, or a foreign lock file of an older
 * copy) whose pid is alive (held or old, on this host) has its process tree killed and its slot released. `kill` and `probe` are seams for the specs.
 */
export const cancelLaneGate = (root: string, rules: SlotRules, lane: string, self = process.pid, kill: (pid: number) => boolean = killPidTree, probe: HostProbe = liveProbe()): Cancelled[] => {
    const cancelled: Cancelled[] = []
    for (const view of listSlots(root, rules, ["gate"], probe)) {
        if (view.holder !== lane || view.pid === null || view.pid === undefined || view.pid === self) continue
        if (view.state !== "held" && view.state !== "old") continue
        if (view.alive !== "yes") continue
        kill(view.pid)
        freeView(root, rules, view, `lane gate ${lane} (pid ${String(self)}), superseding`, `cancelled: a newer gate of ${lane} killed the process tree of pid ${String(view.pid)}`)
        cancelled.push({ where: view.where, pid: view.pid })
    }
    return cancelled
}
