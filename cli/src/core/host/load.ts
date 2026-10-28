import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { heavySlots, hostLoad, loadHeavyRules, seatRoom } from "../../harness/heavy.js"
import type { HeavySlot, HostLoad } from "../../harness/heavy.js"
import { captureTool } from "../../shared/exec.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"

/** One heavy command as `host load` shows it: its slot row and the resident memory of the child it spawned. */
interface LoadRow extends HeavySlot {
    readonly rssMb: number | null
}

interface LoadData {
    readonly load: HostLoad
    readonly slots: number
    readonly running: readonly LoadRow[]
    readonly queue: readonly LoadRow[]
    readonly seat: { readonly ok: boolean; readonly freeMb: number; readonly floorMb: number }
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

/** `starci host load`: the host's heavy-command semaphore as it stands: the load that admits, the slots in use, the queue and each heavy child's memory. */
export const hostLoadVerb = defineVerb({
    path: ["host", "load"],
    summary: "show the host's heavy-command governor: free RAM and CPU, how many heavy commands they admit, every running one with its child's pid and RSS, the queue, and the seat RAM floor",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/host-load@1",
    flags: {},
    run: async () => {
        const rules = loadHeavyRules()
        const load = await hostLoad(rules)
        const slots = heavySlots()
        const rss = await residentMb(slots.flatMap((slot) => (slot.childPid === null ? [] : [slot.childPid])))
        const rows = slots.map((slot): LoadRow => ({ ...slot, rssMb: slot.childPid === null ? null : (rss.get(slot.childPid) ?? null) }))
        const data: LoadData = { load, slots: rules.slots, running: rows.filter((row) => row.state === "running"), queue: rows.filter((row) => row.state === "waiting"), seat: seatRoom(rules) }
        const table = (title: string, list: readonly LoadRow[]): string[] =>
            list.length === 0 ? [`${title}: none`] : [`${title}:`, formatTable([["KIND", "LABEL", "PID", "CHILD", "RSS MB", "SINCE"], ...list.map((row) => [row.kind, row.label, String(row.pid), row.childPid === null ? "-" : String(row.childPid), row.rssMb === null ? "-" : String(row.rssMb), row.at])])]
        const message = [
            `free RAM ${String(load.freeMb)} MB, CPU ${String(load.cpuPercent)}% over ${String(rules.cpuWindowSeconds)} s: ${String(load.admitted)} of ${String(rules.slots)} heavy slot(s) admitted (${load.reason})`,
            `seat launches: ${data.seat.ok ? "allowed" : "held"} (floor ${String(data.seat.floorMb)} MB)`,
            ...table(`running (${String(data.running.length)})`, data.running),
            ...table(`queue (${String(data.queue.length)})`, data.queue),
        ]
        return { data, message: message.join("\n") }
    },
})
