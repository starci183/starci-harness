import { statfsSync } from "node:fs"
import { join } from "node:path"
import { captureToolSync } from "../shared/exec.js"

/**
 * The host's readings beside the heavy-command count (harness/heavy.ts): the free space of the drive a heavy command writes to, the one floor
 * admission keeps (`heavy.diskFloorMb` of ops/liveness.yaml: npm installs onto a full drive died with ENOSPC and "disk I/O error"), and the free
 * commit, which the seat floor's free memory reads (`hostFreeMb`) and admission does not.
 */

/** How long one reading of the host's free commit serves, in ms: its CIM query takes about half a second. */
const COMMIT_READING_MS = 2000

let commitReading: { readonly atMs: number; readonly mb: number | null } | undefined

/**
 * The commit charge the host can still give, in MB, on Windows (Win32_OperatingSystem FreeVirtualMemory): a process that cannot commit its memory
 * fails to start (STATUS_COMMITMENT_LIMIT, exit 3221225773) or dies in its first fork however much RAM is free, and on a host whose processes commit
 * more than they touch the free commit runs gigabytes under the free RAM. Null elsewhere (the kernel overcommits) and when the query fails.
 */
export const freeCommitMb = (): number | null => {
    if (process.platform !== "win32") return null
    if (commitReading !== undefined && Date.now() - commitReading.atMs < COMMIT_READING_MS) return commitReading.mb
    const shell = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const run = captureToolSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write((Get-CimInstance Win32_OperatingSystem -Property FreeVirtualMemory).FreeVirtualMemory)"], process.cwd(), 10_000)
    const kb = Number(run.stdout)
    commitReading = { atMs: Date.now(), mb: run.exitCode === 0 && Number.isFinite(kb) && kb > 0 ? Math.floor(kb / 1024) : null }
    return commitReading.mb
}

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
