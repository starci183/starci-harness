import { statfsSync } from "node:fs"

/**
 * The host's one reading beside the heavy-command slots (harness/heavy.ts): the free space of the drive a heavy command writes to, and the one floor
 * admission keeps (`heavy.diskFloorMb` of ops/liveness.yaml, or `host.diskFloorMb` of config.yaml): npm installs onto a full drive died with ENOSPC and
 * "disk I/O error", and a full drive corrupts git and the sqlite stores. No memory reading is a floor: a free slot runs.
 */

/** The free space of the drive holding `path`, in MB, as this user may use it; null when the drive cannot be read. */
export const freeDiskMb = (path: string): number | null => {
    try {
        const stats = statfsSync(path)
        return Math.floor((stats.bavail * stats.bsize) / 1_048_576)
    } catch {
        return null
    }
}

/** The floor as configured: the free space a heavy command's drive keeps. */
export interface FloorRules {
    readonly diskFloorMb: number
    /** Where the floor is set, as the queue line names it (default: heavy.diskFloorMb of ops/liveness.yaml). */
    readonly source?: string | undefined
}

/** One reading of the host the floor is judged on. */
export interface FloorReading {
    readonly diskMb: number | null
    /** The folder whose drive was read. */
    readonly disk: string
}

/** Reads the free space of `path`'s drive now. */
export const readFloors = (path: string): FloorReading => ({ diskMb: freeDiskMb(path), disk: path })

const gbOf = (mb: number): string => `${(mb / 1024).toFixed(1).replace(/\.0$/, "")} GB`

const floorName = (rules: FloorRules): string => {
    const source = rules.source ?? "heavy.diskFloorMb (ops/liveness.yaml)"
    const split = source.indexOf(" ")
    return split < 0 ? `${source} ${gbOf(rules.diskFloorMb)}` : `${source.slice(0, split)} ${gbOf(rules.diskFloorMb)}${source.slice(split)}`
}

/** The floor a reading is under, as the clause a queue line names; empty when the drive has room or cannot be read. Pure. */
export const floorsHeld = (rules: FloorRules, reading: FloorReading): string[] =>
    reading.diskMb !== null && reading.diskMb < rules.diskFloorMb ? [`free disk ${gbOf(reading.diskMb)} on the drive of ${reading.disk} is under ${floorName(rules)}`] : []
