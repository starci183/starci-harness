import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { gb, heavySlots, heldWhy, hostLoad, loadHeavyRules, runningHeavyKinds, seatHolds, seatHoldWhy, seatRoom, starvation } from "../../harness/heavy.js"
import type { HeavyKind, HeavyRules, HeavySlot, HostLoad, SeatHold, Starvation } from "../../harness/heavy.js"
import { memoryHolders } from "../../harness/host-holders.js"
import type { Holders } from "../../harness/host-holders.js"
import { stateBase } from "../../harness/ledger.js"
import { registeredRepositories } from "../../harness/project-workers.js"
import { captureTool } from "../../shared/exec.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"

/** One heavy command as `host load` shows it: its slot row and the resident memory of the child it spawned. */
interface LoadRow extends HeavySlot {
    readonly rssMb: number | null
    /** How long a queued command has waited, in seconds; null for a running one. */
    readonly waitedSeconds: number | null
    /** Why a queued command is not admitted now ("free RAM 2.6 GB below reserve 8 GB"); null for a running one. */
    readonly why: string | null
}

interface LoadData {
    readonly load: HostLoad
    readonly slots: number
    readonly running: readonly LoadRow[]
    readonly queue: readonly LoadRow[]
    readonly seat: { readonly ok: boolean; readonly freeMb: number; readonly floorMb: number }
    /** The queued tasks whose worker seat the RAM floor holds, each with since when and why. */
    readonly seatHolds: readonly (SeatHold & { readonly why: string })[]
    readonly starvation: Starvation
    /** Who holds the memory: the top processes by working set, managed (the harness's) or not, command lines clipped and redacted. */
    readonly holders: Holders
    /** On Windows, the CPU Defender's real-time scan burns and, past heavy.scannerCpuPercent, the owner's exclusion command. */
    readonly scanner: Scanner | null
}

/**
 * Windows Defender's real-time scan as `host load` reads it: the CPU its engine (MsMpEng) burns, in percent of one core (300 is
 * three cores), and, past heavy.scannerCpuPercent, the exact command the owner runs to exclude the harness's state and every
 * registered repository. The harness never runs it: security settings are the owner's.
 */
interface Scanner {
    readonly process: string
    readonly cpuPercent: number
    readonly burning: boolean
    readonly ownerCommand: string | null
}

const SCANNER = "MsMpEng"

/** The quoted single-string form PowerShell reads for a path. */
const psQuoted = (path: string): string => `'${path.replaceAll("'", "''")}'`

/** Reads Defender's engine CPU (two typeperf samples a second apart, the last one counts); null off Windows or when the counter cannot be read. */
const scannerLoad = async (rules: HeavyRules): Promise<Scanner | null> => {
    if (process.platform !== "win32") return null
    const typeperf = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "typeperf.exe")
    const run = await captureTool(typeperf, [String.raw`\Process(${SCANNER})\% Processor Time`, "-si", "1", "-sc", "2"], process.cwd(), { timeoutMs: 15_000 }).catch(() => null)
    const samples = (run?.stdout ?? "").split("\n").flatMap((line) => {
        const value = /^"[^"]*","([\d.]+)"/.exec(line.trim())?.[1]
        return value === undefined ? [] : [Number(value)]
    })
    const last = samples.at(-1)
    if (last === undefined) return null
    const cpuPercent = Math.round(last)
    const burning = cpuPercent >= rules.scannerCpuPercent
    const paths = [stateBase(), ...registeredRepositories()]
    const ownerCommand = burning ? `Add-MpPreference -ExclusionPath ${[...new Set(paths)].map(psQuoted).join(",")}` : null
    return { process: SCANNER, cpuPercent, burning, ownerCommand }
}

/** A wait in seconds as minutes and hours ("1h45m", "12m", "40s"). */
const waited = (seconds: number): string => {
    if (seconds < 60) return `${String(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    return minutes < 60 ? `${String(minutes)}m` : `${String(Math.floor(minutes / 60))}h${String(minutes % 60).padStart(2, "0")}m`
}

/** The resident memory of each pid in MB, read from the host (tasklist on Windows, /proc on Linux, ps elsewhere); a pid it cannot read is absent. */
const residentMb = async (pids: readonly number[]): Promise<Map<number, number>> => {
    const found = new Map<number, number>()
    if (pids.length === 0) return found
    if (process.platform === "win32") {
        const run = await captureTool(join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "tasklist.exe"), ["/FO", "CSV", "/NH"], process.cwd(), { timeoutMs: 30_000 })
        for (const line of run.stdout.split("\n")) {
            const cells = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "")
            const pid = Number(cells[1])
            if (pids.includes(pid)) found.set(pid, Math.round(Number((cells[4] ?? "").replaceAll(/[^\d]/g, "")) / 1024))
        }
        return found
    }
    for (const pid of pids) {
        const status = join("/proc", String(pid), "status")
        if (existsSync(status)) {
            const kb = /VmRSS:\s+(\d+)/.exec(readFileSync(status, "utf8"))?.[1]
            if (kb !== undefined) found.set(pid, Math.round(Number(kb) / 1024))
            continue
        }
        const run = await captureTool("ps", ["-o", "rss=", "-p", String(pid)], process.cwd(), { timeoutMs: 10_000 })
        if (run.exitCode === 0 && run.stdout.trim() !== "") found.set(pid, Math.round(Number(run.stdout.trim()) / 1024))
    }
    return found
}

/**
 * `starci host load`: the host's heavy-command semaphore as it stands: the load that admits, the slots in use, the queue with how
 * long each waited and why, the seat floor's holds, each heavy child's memory, and who holds the host's memory (harness/host-holders.ts).
 */
export const hostLoadVerb = defineVerb({
    path: ["host", "load"],
    summary: "show the host's heavy-command governor: free RAM and CPU, how many heavy commands they admit, every running one with its child's pid and RSS, the queue with each wait and why, the seat RAM floor and its holds, who holds the memory (managed or not), and on Windows a Defender scan burning CPU with the owner's exclusion command",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/host-load@1",
    flags: {},
    run: async () => {
        const rules = loadHeavyRules()
        const load = await hostLoad(rules)
        const slots = heavySlots()
        const [rss, holders] = await Promise.all([residentMb(slots.flatMap((slot) => (slot.childPid === null ? [] : [slot.childPid]))), memoryHolders()])
        const running = runningHeavyKinds()
        const nowMs = Date.now()
        const rows = slots.map((slot): LoadRow => {
            const queued = slot.state === "waiting"
            return {
                ...slot,
                rssMb: slot.childPid === null ? null : (rss.get(slot.childPid) ?? null),
                waitedSeconds: queued ? Math.max(0, Math.round((nowMs - Date.parse(slot.at)) / 1000)) : null,
                why: queued ? (heldWhy(rules, load, running, slot.kind as HeavyKind) ?? "admitted at its next poll") : null,
            }
        })
        const starved = starvation(rules)
        const scanner = await scannerLoad(rules)
        const holds = seatHolds().map((hold) => ({ ...hold, why: seatHoldWhy(hold) }))
        const data: LoadData = { load, slots: load.cap, running: rows.filter((row) => row.state === "running"), queue: rows.filter((row) => row.state === "waiting"), seat: seatRoom(rules), seatHolds: holds, starvation: starved, holders, scanner }
        const runningTable = data.running.length === 0 ? [`running (0): none`] : [`running (${String(data.running.length)}):`, formatTable([["KIND", "LABEL", "PID", "CHILD", "RSS MB", "SINCE"], ...data.running.map((row) => [row.kind, row.label, String(row.pid), row.childPid === null ? "-" : String(row.childPid), row.rssMb === null ? "-" : String(row.rssMb), row.at])])]
        const queueTable = data.queue.length === 0 ? [`queue (0): none`] : [`queue (${String(data.queue.length)}):`, formatTable([["KIND", "LABEL", "PID", "WAITED", "WHY"], ...data.queue.map((row) => [row.kind, row.label, String(row.pid), waited(row.waitedSeconds ?? 0), row.why ?? "-"])])]
        const holdTable = holds.length === 0 ? [] : [`seat holds (${String(holds.length)}):`, formatTable([["TASK", "REPO", "WAITED", "WHY"], ...holds.map((hold) => [hold.task, hold.repo, waited(Math.max(0, Math.round((nowMs - Date.parse(hold.since)) / 1000))), hold.why])])]
        const holderLines =
            holders.unreadable === null
                ? [
                      `who holds memory (${String(holders.processes)} processes): managed ${gb(holders.managedMb)}, unmanaged ${gb(holders.unmanagedMb)}${holders.unmanagedGroups === "" ? "" : ` (${holders.unmanagedGroups})`}`,
                      formatTable([["PID", "NAME", "WS MB", "MANAGED", "GROUP", "COMMAND"], ...holders.top.map((item) => [String(item.pid), item.name, String(item.workingSetMb), item.managed ? "managed" : "unmanaged", item.group, item.command])]),
                  ]
                : [`who holds memory: unknown, the process table could not be read (${holders.unreadable})`]
        const message = [
            `free RAM ${String(load.freeMb)} MB, CPU ${String(load.cpuPercent)}% over ${String(rules.cpuWindowSeconds)} s: ${String(load.admitted)} heavy command(s) admitted now, ${String(load.running)} running, cap ${String(load.cap)} (${load.reason})`,
            `seat launches: ${data.seat.ok ? "allowed" : `held: free RAM ${gb(data.seat.freeMb)} below seat floor ${gb(data.seat.floorMb)}`} (floor ${String(data.seat.floorMb)} MB)`,
            ...runningTable,
            ...queueTable,
            ...holdTable,
            ...holderLines,
            ...(scanner?.ownerCommand == null
                ? []
                : [
                      `Windows Defender real-time scanning (${scanner.process}) burns ${String(scanner.cpuPercent)}% CPU (of one core; heavy.scannerCpuPercent ${String(rules.scannerCpuPercent)}). Security settings are the owner's, so starci never changes them; the owner may exclude the harness state and the repositories, in an elevated PowerShell:`,
                      `  ${scanner.ownerCommand}`,
                  ]),
        ]
        return { data, message: message.join("\n") }
    },
})
