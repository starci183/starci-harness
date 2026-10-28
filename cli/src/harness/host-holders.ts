import { join } from "node:path"
import { captureTool } from "../shared/exec.js"
import { redactSecrets } from "../shared/secrets.js"
import { heavySlots } from "./heavy.js"
import { stateBase } from "./ledger.js"

/**
 * Who holds this host's memory: the processes with the largest working set, each grouped as managed (a heavy command the
 * governor admitted, a process under it, a seat or any process of the harness's own state folders and CLI) or unmanaged (other
 * node, the WSL VM and Docker, IDEs, agents, the rest), with its command line clipped and redacted. Read by `starci host load` and
 * by the starvation ticket of `supervisor tick`; a read of the process table only, never a kill.
 */

/** One process as the host lists it. */
interface HostProcess {
    readonly pid: number
    readonly ppid: number
    readonly name: string
    readonly workingSetMb: number
    readonly commandLine: string
}

/** The groups a holder falls in: the harness's own work, or what the harness does not manage. */
export type HolderGroup = "heavy" | "harness" | "node" | "wsl-docker" | "ide" | "agent" | "other"

/** One holder of memory as `host load` and the starvation ticket show it. */
export interface Holder {
    readonly pid: number
    readonly name: string
    readonly workingSetMb: number
    readonly managed: boolean
    readonly group: HolderGroup
    /** The command line clipped to COMMAND_CHARS and redacted (`redactSecrets`, then any `token=`, `--password x`-like value). */
    readonly command: string
}

/** Who holds memory now: the top holders, the managed and unmanaged totals over every process, and how the table was read. */
export interface Holders {
    readonly top: readonly Holder[]
    readonly managedMb: number
    readonly unmanagedMb: number
    readonly processes: number
    /** The unmanaged processes by group over the whole table, largest first (`unmanagedByGroup`). */
    readonly unmanagedGroups: string
    /** Null when the table was read; else why it could not be (the tool that failed), so the section says so instead of guessing. */
    readonly unreadable: string | null
}

const COMMAND_CHARS = 160

// A value after a flag (`--token x`, `--api-key=x`) or an assignment (`PASSWORD=x`) whose name says it is a credential, whatever
// redactSecrets' value rules recognise.
const CREDENTIAL_WORD = String.raw`[\w.-]*(?:token|secret|password|passwd|pwd|apikey|api-key|api_key|auth|credential|key)[\w.-]*`
const CREDENTIAL_FLAG = new RegExp(String.raw`(--?${CREDENTIAL_WORD}(?:=|\s+))("[^"]*"|'[^']*'|\S+)`, "gi")
const CREDENTIAL_ASSIGNMENT = new RegExp(String.raw`(\b${CREDENTIAL_WORD}=)("[^"]*"|'[^']*'|\S+)`, "gi")

/** A command line as a holder shows it: redacted, then clipped; never the full text a process was started with. */
export const clipCommand = (text: string): string => {
    const redacted = redactSecrets(text.replaceAll(/\s+/g, " ").trim()).replaceAll(CREDENTIAL_FLAG, (_, flag: string) => `${flag}[redacted]`).replaceAll(CREDENTIAL_ASSIGNMENT, (_, name: string) => `${name}[redacted]`)
    return redacted.length <= COMMAND_CHARS ? redacted : `${redacted.slice(0, COMMAND_CHARS - 1)}…`
}

const WSL_DOCKER = /^(?:vmmem|vmmemwsl|vmwp|wsl|wslhost|wslservice|com\.docker\.[\w.-]+|docker(?:d| desktop)?|containerd)(?:\.exe)?$/i
const IDE = /^(?:code|code - insiders|cursor|windsurf|devenv|idea64|webstorm64|rider64|pycharm64|zed|sublime_text)(?:\.exe)?$/i
const AGENT = /^(?:claude|codex|devin|orca|cursor-agent|gemini|aider)(?:\.exe)?$/i
// An agent a node process hosts, named by its package; a path that merely contains ".claude" is not one.
const AGENT_COMMAND = /@anthropic-ai[\\/]claude-code|@openai[\\/]codex|[\\/]orca[\\/](?:dist|bin)[\\/]/i
const NODE = /^node(?:\.exe)?$/i

/** The group of an unmanaged process, by its image name, then its command line. */
const unmanagedGroup = (item: HostProcess): HolderGroup => {
    if (WSL_DOCKER.test(item.name)) return "wsl-docker"
    if (IDE.test(item.name)) return "ide"
    if (AGENT.test(item.name) || AGENT_COMMAND.test(item.commandLine)) return "agent"
    if (NODE.test(item.name)) return "node"
    return "other"
}

/** Every process of the host with its parent, image name, working set and command line; a host without the tool answers why not. */
const listProcesses = async (): Promise<HostProcess[] | string> => {
    if (process.platform === "win32") {
        const script = "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p = $_.ProcessId; q = $_.ParentProcessId; n = $_.Name; w = $_.WorkingSetSize; c = $_.CommandLine } } | ConvertTo-Json -Compress"
        const shell = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        const run = await captureTool(shell, ["-NoProfile", "-NonInteractive", "-Command", script], process.cwd(), { timeoutMs: 60_000 }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
        if (typeof run === "string") return `powershell Win32_Process: ${run}`
        if (run.exitCode !== 0) return `powershell Win32_Process exited ${String(run.exitCode)}`
        let rows: unknown
        try {
            rows = JSON.parse(run.stdout)
        } catch {
            return "powershell Win32_Process printed no json"
        }
        return (Array.isArray(rows) ? rows : [rows]).map((raw) => {
            const row = raw as { readonly p?: number; readonly q?: number; readonly n?: string; readonly w?: number; readonly c?: string | null }
            return { pid: row.p ?? 0, ppid: row.q ?? 0, name: row.n ?? "", workingSetMb: Math.round((row.w ?? 0) / 1_048_576), commandLine: row.c ?? "" }
        })
    }
    const run = await captureTool("ps", ["-eo", "pid=,ppid=,rss=,comm=,args="], process.cwd(), { timeoutMs: 30_000 }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    if (typeof run === "string") return `ps: ${run}`
    if (run.exitCode !== 0) return `ps exited ${String(run.exitCode)}`
    return run.stdout.split("\n").flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line)
        if (match === null) return []
        return [{ pid: Number(match[1]), ppid: Number(match[2]), name: match[4] ?? "", workingSetMb: Math.round(Number(match[3]) / 1024), commandLine: match[5] ?? "" }]
    })
}

/**
 * The harness's own processes: each recorded heavy command's process and child, every process under them, and any process
 * whose command line names the harness's state folder (an Op or a verify checkout, a seat working there) or runs the harness CLI.
 */
const managedPids = (processes: readonly HostProcess[]): Map<number, HolderGroup> => {
    const managed = new Map<number, HolderGroup>()
    for (const slot of heavySlots()) {
        managed.set(slot.pid, "heavy")
        if (slot.childPid !== null) managed.set(slot.childPid, "heavy")
    }
    // The CLI alone does not make a process managed: another app's `starci app release` runs it ungoverned, and is exactly what
    // this section has to name. A seat or a verify works in the state folder (an Op worktree `<workflow>.ops/<task>`, a clean
    // checkout `starci-verify-<task>`), so its command line names that place.
    const state = stateBase().replaceAll("\\", "/").toLowerCase()
    const harnessCommand = (line: string): boolean => {
        const slashed = line.replaceAll("\\", "/").toLowerCase()
        return (state !== "" && slashed.includes(state)) || /\.ops\/t-[0-9a-f]{8}\b|\bstarci-verify-t-[0-9a-f]{8}\b/.test(slashed)
    }
    for (const item of processes) if (!managed.has(item.pid) && harnessCommand(item.commandLine)) managed.set(item.pid, "harness")
    // A process under a managed one (an eslint worker under a heavy lint, a tool under a seat) is managed as its root is.
    const parent = new Map(processes.map((item) => [item.pid, item.ppid]))
    for (const item of processes) {
        if (managed.has(item.pid)) continue
        let at = item.ppid
        for (let hops = 0; hops < 32 && at > 0; hops += 1) {
            const group = managed.get(at)
            if (group !== undefined) {
                managed.set(item.pid, group)
                break
            }
            const next = parent.get(at)
            if (next === undefined || next === at) break
            at = next
        }
    }
    return managed
}

/** The unmanaged holders by group, largest first: "node 22.1 GB (31), wsl-docker 6.5 GB (1), …", for one line of a report. */
export const unmanagedByGroup = (holders: readonly Holder[]): string => {
    const groups = new Map<HolderGroup, { mb: number; count: number }>()
    for (const item of holders.filter((each) => !each.managed)) {
        const entry = groups.get(item.group) ?? { mb: 0, count: 0 }
        groups.set(item.group, { mb: entry.mb + item.workingSetMb, count: entry.count + 1 })
    }
    return [...groups].sort((left, right) => right[1].mb - left[1].mb).map(([group, entry]) => `${group} ${(entry.mb / 1024).toFixed(1)} GB (${String(entry.count)})`).join(", ")
}

/** Who holds the host's memory now (`Holders`), the `top` largest working sets first. */
export const memoryHolders = async (top = 12): Promise<Holders> => {
    const listed = await listProcesses()
    if (typeof listed === "string") return { top: [], managedMb: 0, unmanagedMb: 0, processes: 0, unmanagedGroups: "", unreadable: listed }
    const managed = managedPids(listed)
    const holders = listed
        .filter((item) => item.pid !== process.pid)
        .map((item): Holder => {
            const group = managed.get(item.pid)
            return { pid: item.pid, name: item.name, workingSetMb: item.workingSetMb, managed: group !== undefined, group: group ?? unmanagedGroup(item), command: clipCommand(item.commandLine) }
        })
        .sort((left, right) => right.workingSetMb - left.workingSetMb)
    const sum = (list: readonly Holder[]): number => list.reduce((total, item) => total + item.workingSetMb, 0)
    return { top: holders.slice(0, top), managedMb: sum(holders.filter((item) => item.managed)), unmanagedMb: sum(holders.filter((item) => !item.managed)), processes: listed.length, unmanagedGroups: unmanagedByGroup(holders), unreadable: null }
}
