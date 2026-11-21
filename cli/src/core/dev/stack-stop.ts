import { existsSync } from "node:fs"
import { join } from "node:path"
import { listProcesses } from "../../harness/process-table.js"
import type { HostProcess } from "../../harness/process-table.js"
import { endAll } from "../../harness/reap.js"
import { captureTool, pidAlive } from "../../shared/exec.js"

/**
 * The dev stack processes of a checkout, stopped before `dev sync` installs: on Windows a process that loaded a file of `node_modules` (a
 * `.node` addon such as lightningcss) makes npm fail with EPERM halfway through, so the processes the stack's local state records are
 * ended first, with their children, and seen gone. They are read through the app's own pinned CLI (`starci --json app stack status`),
 * the one that knows where its environment keeps its state, and left recorded: `app stack restart` then finds them gone and starts them again.
 */

/** One process the dev environment recorded starting. */
export interface RecordedProcess {
    readonly pid: number
    readonly startedAt: string
    readonly command?: string | undefined
}

/** The recorded processes of a dev environment, by name. */
export type StackProcesses = Readonly<Record<string, RecordedProcess>>

/** What a stop did: the names it ended (or found already gone) and the ones still alive after it. */
export interface StackStop {
    readonly stopped: readonly string[]
    readonly alive: readonly string[]
}

/** The app's own pinned CLI in the checkout: the stack is read and restarted with the hfs the app pins, never this CLI's. */
export const appCli = (root: string): string => join(root, "node_modules", "starci-harness", "dist", "main.js")

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The recorded processes out of the envelope `starci --json app stack status` printed, or why it holds none. Pure. */
export const parseStackStatus = (stdout: string): StackProcesses | string => {
    let envelope: unknown
    try {
        envelope = JSON.parse(stdout)
    } catch {
        return `it printed no json (${stdout.trim().slice(0, 160) || "nothing"})`
    }
    if (!isRecord(envelope)) return "it printed no json envelope"
    if (envelope.ok === false) return `${String(envelope.code)}: ${String(envelope.message)}`
    const output = isRecord(envelope.data) ? envelope.data.output : undefined
    const processes = isRecord(output) ? output.processes : undefined
    if (!isRecord(processes)) return "its envelope names no processes"
    const found: Record<string, RecordedProcess> = {}
    for (const [name, entry] of Object.entries(processes)) {
        if (!isRecord(entry) || typeof entry.pid !== "number" || typeof entry.startedAt !== "string") return `its record of ${name} has no pid`
        found[name] = { pid: entry.pid, startedAt: entry.startedAt, command: typeof entry.command === "string" ? entry.command : undefined }
    }
    return found
}

/**
 * The processes the dev environment `env` of the checkout recorded, read through the app's pinned CLI; undefined when the checkout has no
 * such CLI to ask (no install, or a half-wiped one), a string saying why the record could not be read otherwise.
 */
export const readStackProcesses = async (root: string, env: string): Promise<StackProcesses | string | undefined> => {
    const cli = appCli(root)
    if (!existsSync(cli)) return undefined
    // The status exits 1 when anything is down; its envelope is printed either way.
    const run = await captureTool(process.execPath, [cli, "--json", "app", "stack", "status", "--env", env], root, { timeoutMs: 120_000 })
    return parseStackStatus(run.stdout)
}

/** A recorded process and the host's process that holds its pid are one: started within a minute of the record, else running its recorded command. */
const RECORD_WINDOW_MS = 60_000

/** True when `live` is the process the record names, not a later one that reuses its pid. Pure. */
export const sameProcess = (entry: RecordedProcess, live: HostProcess): boolean => {
    const recorded = Date.parse(entry.startedAt)
    if (live.startedMs !== null && Number.isFinite(recorded)) return Math.abs(live.startedMs - recorded) <= RECORD_WINDOW_MS
    const words = (entry.command ?? "").toLowerCase().replaceAll("\\", "/").split(/\s+/u).filter((word) => word !== "").map((word) => word.replaceAll('"', ""))
    const line = live.commandLine.toLowerCase().replaceAll("\\", "/").replaceAll('"', "")
    return words.length > 0 && words.slice(1).every((word) => line.includes(word))
}

/** The pids to end for the recorded processes: each one still the recorded process (its name in `running`), and every process under it that started after its parent. Pure. */
export const stopTargets = (processes: StackProcesses, table: readonly HostProcess[]): { readonly running: readonly string[]; readonly pids: readonly number[] } => {
    const byPid = new Map(table.map((item) => [item.pid, item]))
    const running = Object.entries(processes).filter(([, entry]) => {
        const live = byPid.get(entry.pid)
        return live !== undefined && sameProcess(entry, live)
    }).map(([name]) => name)
    const pids = new Set(running.map((name) => processes[name]?.pid ?? -1))
    for (let grown = true; grown; ) {
        grown = false
        for (const item of table) {
            const parent = byPid.get(item.ppid)
            if (pids.has(item.pid) || parent === undefined || !pids.has(parent.pid) || item.pid === process.pid) continue
            if (item.startedMs !== null && parent.startedMs !== null && item.startedMs + 5_000 < parent.startedMs) continue
            pids.add(item.pid)
            grown = true
        }
    }
    return { running, pids: [...pids] }
}

/**
 * Ends the recorded processes that still run, with their children, and sees them gone: `stopped` names the ones it ended, `alive` what
 * still runs after it. A recorded process already gone, or whose pid another process reuses, is neither. A process table that cannot be
 * read ends nothing and is said in `alive`.
 */
export const stopStackProcesses = async (processes: StackProcesses): Promise<StackStop> => {
    if (Object.keys(processes).length === 0) return { stopped: [], alive: [] }
    const table = await listProcesses()
    if (typeof table === "string") return { stopped: [], alive: [`the recorded processes (the process table could not be read: ${table})`] }
    const { running, pids } = stopTargets(processes, table)
    await endAll(pids)
    const still = pids.filter(pidAlive)
    const pidOf = (name: string): number => processes[name]?.pid ?? -1
    const children = still.filter((pid) => !running.some((name) => pidOf(name) === pid))
    return {
        stopped: running.filter((name) => !still.includes(pidOf(name))),
        alive: [...running.filter((name) => still.includes(pidOf(name))).map((name) => `${name} (pid ${String(pidOf(name))})`), ...(children.length > 0 ? [`their child process(es) ${children.join(", ")}`] : [])],
    }
}
