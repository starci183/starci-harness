// supersede.ts - cancel the local runs a newer push makes stale (owner 2026-11-22: "dồn!!! nhiều changes thì gộp 1 commit duy nhất và ci làm kiểu nếu push commit mới
// thì cancel lun commit cũ"). A lane runs one gate at a time: a new `lane gate` of the same lane (a new push of it) kills the process tree of the lane's running gate,
// releases its gate slot and says so in the lane's status file ("superseded by <sha>"). The batch lander does the same for a lane registered again with a new sha while
// its batch gate runs (land-batch.ts). Only a holder this host proves alive at the start the slot recorded is killed: a dead or reused pid is a reclaim, never a kill.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { killPidTree } from "../shared/exec.js"
import { landPaths, readStatuses, writeStatus } from "./land-queue.js"
import { judgeHolder, liveProbe, readHolder, releaseSlots, slotFile, slotKind } from "./slots.js"
import type { HostProbe, SlotRules } from "./slots.js"

/** One run a newer push cancelled: the slot it held and its pid. */
export interface Cancelled {
    readonly file: string
    readonly pid: number
}

/** The slot numbers of a kind. */
const numbers = (count: number): number[] => Array.from({ length: count }, (_unused, at) => at + 1)

/**
 * Cancels the running gate of `lane` that is not this process: each gate slot the lane holds whose pid is alive (held or old, on this host)
 * has its process tree killed and its slot released. `kill` and `probe` are seams for the specs.
 */
export const cancelLaneGate = (root: string, rules: SlotRules, lane: string, self = process.pid, kill: (pid: number) => boolean = killPidTree, probe: HostProbe = liveProbe(root)): Cancelled[] => {
    const kind = slotKind(rules, "gate")
    const cancelled: Cancelled[] = []
    for (const n of numbers(kind.count + (kind.burst?.count ?? 0))) {
        const file = slotFile(root, kind, n)
        const holder = readHolder(file)
        if (holder?.holder !== lane || holder.pid === null || holder.pid === self) continue
        const { state } = judgeHolder(kind, holder, probe)
        if (state !== "held" && state !== "old") continue
        if (holder.host !== null && holder.host !== probe.hostname) continue
        kill(holder.pid)
        releaseSlots(root, rules, "gate", lane, { n, pid: holder.pid })
        cancelled.push({ file, pid: holder.pid })
    }
    return cancelled
}

/** Writes "superseded by <sha>" into the lane's status file, keeping its state; a lane with no status file yet gets none. */
export const markSuperseded = (dir: string, lane: string, sha: string, what: string): boolean => {
    if (!existsSync(join(landPaths(dir).status, `${lane}.json`))) return false
    const current = readStatuses(dir).find((status) => status.lane === lane)
    if (current === undefined) return false
    writeStatus(dir, { ...current, at: new Date().toISOString(), supersededBy: sha, reason: `superseded by ${sha}: ${what}` })
    return true
}
