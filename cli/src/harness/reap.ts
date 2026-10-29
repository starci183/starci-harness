import { basename, isAbsolute, join, relative, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { captureTool, pidAlive } from "../shared/exec.js"
import type { Spawned } from "../shared/exec.js"
import { heavySlots } from "./heavy.js"
import { clipCommand } from "./host-holders.js"
import { openMachine, projectsRoot, stateBase } from "./ledger.js"
import { closeWorkspaceTerminals, closeWorktreeTerminals, orcaBinarySync, terminalList } from "./orca/client.js"
import type { OrcaBinary } from "./orca/client.js"
import { listProcesses } from "./process-table.js"
import type { HostProcess } from "./process-table.js"
import { busySubject, lockersOf } from "./worktree-busy.js"

/**
 * The harness reaps what it started before it removes a worktree of its own: the processes it recorded starting in an Op
 * worktree (every run, detached or served program this CLI started there, shared/exec.ts observeSpawns), the heavy
 * commands the governor admitted there (heavy_slots), every process whose working folder lies inside the folder, and every
 * process under one of those. Its Orca terminals are closed, those processes are ended and seen gone, and only then is the
 * folder removed (harness/land.ts removeWorktreeFolder). Nothing is ever chosen by its name, and this process and its
 * ancestors are never ended: a seat that settles its own task keeps its terminal, and its worktree is retried by `worktree gc`.
 */

/** One process the reap ended or found still alive: why it was the harness's to end, and where it worked. */
export interface ReapedProcess {
    readonly pid: number
    readonly name: string
    readonly why: "recorded" | "heavy" | "cwd" | "descendant"
    readonly cwd: string | null
}

/** What one reap did: the terminals it closed, the processes it ended, the ones still alive after it, and why it ended none when it could not look. */
export interface Reap {
    readonly terminals: readonly string[]
    /** What `orca terminal close --worktree path:<folder> --all` answered (it also stops terminals no list shows), or why it was not sent; null without Orca. */
    readonly workspace: string | null
    readonly killed: readonly ReapedProcess[]
    readonly survivors: readonly ReapedProcess[]
    readonly unreadable: string | null
}

const TABLE = `CREATE TABLE IF NOT EXISTS op_processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL, worktree TEXT NOT NULL, task TEXT, kind TEXT NOT NULL,
  label TEXT NOT NULL, cwd TEXT NOT NULL, recorded_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS op_processes_by_worktree ON op_processes (worktree);`

const withProcesses = <T>(work: (db: DatabaseSync) => T): T => {
    const db = openMachine()
    try {
        db.exec(TABLE)
        return work(db)
    } finally {
        db.close()
    }
}

/** The Op worktree a folder lies in (`<projects>/<ledger id>/worktrees/<workflow>.ops/<task>`) with its task, else undefined. */
export const opWorktreeAt = (folder: string): { readonly worktree: string; readonly task: string } | undefined => {
    const root = projectsRoot()
    const rel = relative(root, resolve(folder))
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined
    const [id, worktrees, ops, task] = rel.split(/[\\/]/)
    if (id === undefined || worktrees !== "worktrees" || ops?.endsWith(".ops") !== true || task === undefined || task === "") return undefined
    return { worktree: join(root, id, worktrees, ops, task), task }
}

const GIT = /^git(?:\.exe)?$/i

/**
 * Records a process this CLI started inside an Op worktree, with the task, folder and command, in the host store's
 * `op_processes` (the observer main.ts gives shared/exec.ts). A git call is not recorded: it never outlives its own run.
 */
export const recordSpawn = (spawned: Spawned): void => {
    if (GIT.test(basename(spawned.tool))) return
    const at = opWorktreeAt(spawned.cwd)
    if (at === undefined) return
    const label = clipCommand([basename(spawned.tool), ...spawned.args].join(" "))
    withProcesses((db) => db.prepare("INSERT INTO op_processes (pid, worktree, task, kind, label, cwd, recorded_ms) VALUES (?, ?, ?, 'command', ?, ?, ?)").run(spawned.pid, busySubject(at.worktree), at.task, label, spawned.cwd, Date.now()))
}

/**
 * Records the processes working in an Op worktree right after Orca started its seat there (kind `seat`, labelled with the
 * terminal handle): Orca names no pid for a terminal it starts, so the seat's shell and agent are found by the folder they start
 * in, before either can change it. This process and its ancestors are never recorded. Returns how many it recorded.
 */
export const recordSeatProcesses = async (folder: string, terminal: string | null): Promise<number> => {
    const at = opWorktreeAt(folder)
    if (at === undefined) return 0
    const listed = await listProcesses(true)
    if (typeof listed === "string") return 0
    const spared = selfAndAncestors(new Map(listed.map((item) => [item.pid, item])))
    const found = listed.filter((item) => !spared.has(item.pid) && insideFolder(at.worktree, item.cwd))
    const recorded = Date.now()
    withProcesses((db) => {
        for (const item of found) db.prepare("INSERT INTO op_processes (pid, worktree, task, kind, label, cwd, recorded_ms) VALUES (?, ?, ?, 'seat', ?, ?, ?)").run(item.pid, busySubject(at.worktree), at.task, `${item.name} of terminal ${terminal ?? "unknown"}`, item.cwd ?? "", recorded)
    })
    return found.length
}

/** Drops the records of a removed worktree's processes. */
export const forgetProcesses = (folder: string): void => {
    withProcesses((db) => db.prepare("DELETE FROM op_processes WHERE worktree = ?").run(busySubject(folder)))
}

interface Recorded {
    readonly pid: number
    readonly since: number
}

const recordedIn = (folder: string): Recorded[] =>
    withProcesses((db) => db.prepare("SELECT pid, recorded_ms FROM op_processes WHERE worktree = ?").all(busySubject(folder)).map((row) => ({ pid: Number(row.pid), since: Number(row.recorded_ms) })))

/** How far a process's start may lie after the moment its pid was recorded and still be that process (clock and spawn latency). */
const SAME_PROCESS_MS = 5_000

const insideFolder = (folder: string, path: string | null): boolean => {
    if (path === null) return false
    const key = busySubject(folder)
    const at = busySubject(path)
    return at === key || at.startsWith(`${key}/`)
}

/** This process and every ancestor of it: a reap never ends the process that runs it, nor the shell or seat that started it. */
const selfAndAncestors = (table: ReadonlyMap<number, HostProcess>): Set<number> => {
    const own = new Set<number>([process.pid, process.ppid])
    let at = table.get(process.ppid)
    for (let hops = 0; hops < 64 && at !== undefined && !own.has(at.ppid); hops += 1) {
        own.add(at.ppid)
        at = table.get(at.ppid)
    }
    return own
}

const ORCA_IMAGE = /^orca(?:[\s-][\w\s-]*)?(?:\.exe)?$/i

/** True when `child` may be a child of a process that started at `parentStart`: it started no earlier, so its pid is not a reuse. */
const startedAfter = (child: HostProcess, parentStart: number | null): boolean => child.startedMs === null || parentStart === null || child.startedMs + SAME_PROCESS_MS >= parentStart

/**
 * The processes a reap of `folder` ends, from one read of the process table: the recorded ones still alive (the same process,
 * by its start), the governor's heavy commands working there, every process working inside the folder, and every process under
 * one of those (each hop started after its parent, so a reused pid never makes a stranger a child), less this process and its
 * ancestors.
 */
const targetsOf = (processes: readonly HostProcess[], folder: string, recorded: readonly Recorded[]): Map<number, ReapedProcess> => {
    const table = new Map(processes.map((item) => [item.pid, item]))
    const spared = selfAndAncestors(table)
    // Orca (its app and its CLI) hosts every terminal of the host: it is asked to let go of the folder, never ended.
    for (const item of processes) if (ORCA_IMAGE.test(item.name)) spared.add(item.pid)
    const roots = new Map<number, ReapedProcess["why"]>()
    // A recorded process that already exited still names the pid its orphans list as their parent, from the time it was recorded.
    const goneParents = new Map<number, number>()
    for (const row of recorded) {
        const live = table.get(row.pid)
        if (live === undefined) goneParents.set(row.pid, row.since)
        else if (live.startedMs === null || live.startedMs <= row.since + SAME_PROCESS_MS) roots.set(row.pid, "recorded")
    }
    for (const slot of heavySlots().filter((one) => insideFolder(folder, one.cwd))) {
        for (const pid of slot.childPid === null ? [slot.pid] : [slot.pid, slot.childPid]) if (table.has(pid) && !roots.has(pid)) roots.set(pid, "heavy")
    }
    for (const item of processes) if (!roots.has(item.pid) && insideFolder(folder, item.cwd)) roots.set(item.pid, "cwd")
    for (const pid of spared) roots.delete(pid)
    const targets = new Map<number, ReapedProcess>()
    for (const [pid, why] of roots) {
        const item = table.get(pid)
        if (item !== undefined) targets.set(pid, { pid, name: item.name, why, cwd: item.cwd })
    }
    const under = (item: HostProcess): boolean => {
        let child = item
        for (let hops = 0; hops < 32; hops += 1) {
            if (spared.has(child.ppid)) return false
            const gone = goneParents.get(child.ppid)
            if (gone !== undefined) return startedAfter(child, gone)
            const parent = table.get(child.ppid)
            if (parent === undefined || parent.pid === child.pid || !startedAfter(child, parent.startedMs)) return false
            if (roots.has(parent.pid)) return true
            child = parent
        }
        return false
    }
    for (const item of processes) if (!targets.has(item.pid) && !spared.has(item.pid) && item.pid > 4 && under(item)) targets.set(item.pid, { pid: item.pid, name: item.name, why: "descendant", cwd: item.cwd })
    return targets
}

/** How long ended processes get to exit on SIGTERM before SIGKILL (POSIX), and how long a reap waits for them to be gone. */
const GRACE_MS = 3_000

const pause = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Ends each pid, never its tree by parent id (a reused parent id would take strangers): taskkill /F on Windows, SIGTERM then SIGKILL elsewhere. */
const endAll = async (pids: readonly number[]): Promise<void> => {
    if (pids.length === 0) return
    if (process.platform === "win32") {
        const taskkill = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "taskkill.exe")
        await captureTool(taskkill, [...pids.flatMap((pid) => ["/PID", String(pid)]), "/F"], process.cwd(), { timeoutMs: 30_000 }).catch(() => undefined)
    } else {
        const signal = (name: NodeJS.Signals): void => {
            for (const pid of pids) {
                try {
                    process.kill(pid, name)
                } catch {
                    // Gone already, or not this user's: the look after the kill says which.
                }
            }
        }
        signal("SIGTERM")
        for (let waited = 0; waited < GRACE_MS && pids.some(pidAlive); waited += 100) await pause(100)
        signal("SIGKILL")
    }
    for (let waited = 0; waited < GRACE_MS && pids.some(pidAlive); waited += 100) await pause(100)
}

/** How long a removal waits after closing a worktree's terminals, for their shells to exit. */
const TERMINAL_EXIT_MS = 2_000

/**
 * Closes every Orca terminal working in `folder` or below it (each tab but the caller's own), then forces the workspace closed
 * with `orca terminal close --worktree path:<folder> --all`, which also stops terminals no list shows and drops its saved tabs,
 * layouts and resume records, unless the caller's own terminal works there. Returns the handles closed and what the forced close
 * answered. Never throws.
 */
export const closeFolderTerminals = async (binary: OrcaBinary, folder: string, repo: string): Promise<{ readonly terminals: string[]; readonly workspace: string }> => {
    const terminals = await closeWorktreeTerminals(binary, folder, repo).catch(() => [])
    const own = process.env.ORCA_TERMINAL_HANDLE
    const ownHere = own !== undefined && (await terminalList(binary, repo).then((inventory) => inventory.terminals.some((terminal) => terminal.handle === own && insideFolder(folder, terminal.worktree)), () => true))
    const workspace = ownHere
        ? "kept: the caller's own terminal works there"
        : await closeWorkspaceTerminals(binary, folder, repo).then(
              (answer) => `closed: ${JSON.stringify(answer ?? null).slice(0, 300)}`,
              (error: unknown) => `not closed: ${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}`,
          )
    return { terminals, workspace }
}

/**
 * Reaps a worktree in the order a held folder needs: reads the process table first (while the parent chains still stand), closes
 * the Orca terminals working in `folder` (each tab but the caller's own, then `orca terminal close --worktree path:<folder>
 * --all`, Orca's forced close, which also stops terminals no list shows and drops the workspace's saved tabs and layouts, unless
 * the caller's own terminal works there), runs `between` (the caller unlinks the install links and has Orca forget the
 * workspace, whose own watcher and terminal host otherwise keep the folder), and only then, for a folder under the harness's
 * state (`end`), ends the processes `targetsOf` names, looks again, ends what a first kill left or started, and says which are
 * still alive. Orca itself is never ended. Never throws for a process it could not end.
 */
export const reapWorktree = async (folder: string, repo: string, end: boolean, between: () => Promise<void>): Promise<Reap> => {
    const listed = end ? await listProcesses(true).catch((error: unknown) => (error instanceof Error ? error.message : String(error))) : "the folder is not under the harness's state"
    const first = typeof listed === "string" ? new Map<number, ReapedProcess>() : targetsOf(listed, folder, recordedIn(folder))
    const binary = orcaBinarySync()
    const { terminals, workspace } = binary === undefined ? { terminals: [], workspace: null } : await closeFolderTerminals(binary, folder, repo)
    // A closed tab's shell takes a moment to exit and let go of its working folder.
    if (terminals.length > 0) await pause(TERMINAL_EXIT_MS)
    await between()
    if (typeof listed === "string") return { terminals, workspace, killed: [], survivors: [], unreadable: end ? listed : null }
    if (first.size === 0) return { terminals, workspace, killed: [], survivors: [], unreadable: null }
    const killed = new Map(first)
    let pending = [...first.keys()]
    let survivors: ReapedProcess[] = []
    // Two rounds: what the first kill missed or a dying process started is named by a fresh read and ended in the second.
    for (let round = 0; round < 2 && pending.length > 0; round += 1) {
        await endAll(pending)
        const after = await listProcesses(true).catch(() => undefined)
        if (after === undefined || typeof after === "string") {
            survivors = pending.filter(pidAlive).map((pid) => killed.get(pid) ?? { pid, name: "", why: "recorded", cwd: null })
            break
        }
        const again = targetsOf(after, folder, recordedIn(folder))
        for (const [pid, item] of again) if (!killed.has(pid)) killed.set(pid, item)
        survivors = [...again.values()]
        pending = [...again.keys()]
    }
    const alive = new Set(survivors.map((item) => item.pid))
    return { terminals, workspace, killed: [...killed.values()].filter((item) => !alive.has(item.pid)), survivors, unreadable: null }
}

/** True when `folder` lies under the harness's state base, the folders whose processes a reap may end. */
export const harnessFolder = (folder: string): boolean => insideFolder(stateBase(), folder) && busySubject(folder) !== busySubject(stateBase())

/** One line naming processes: "123 python3.exe (cwd), 456 node.exe (descendant)". */
export const describeProcesses = (items: readonly ReapedProcess[]): string => items.map((item) => `${String(item.pid)} ${item.name} (${item.why})`).join(", ")

/**
 * Who holds a folder its reap could not free, as far as the host tells: the processes the reap ended that are still alive, else
 * the processes working inside it now (this process or an ancestor of it, which a reap never ends, or one started since), else
 * what a handle tool names (worktree-busy.ts lockersOf), else what was tried.
 */
export const heldBy = async (folder: string, reap: Reap): Promise<string> => {
    if (reap.survivors.length > 0) return `still alive after the reap: ${describeProcesses(reap.survivors)}`
    const listed = await listProcesses(true).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    const working = typeof listed === "string" ? [] : listed.filter((item) => insideFolder(folder, item.cwd))
    if (working.length > 0) {
        const own = typeof listed === "string" ? new Set<number>() : selfAndAncestors(new Map(listed.map((item) => [item.pid, item])))
        return `working in it: ${working.map((item) => `${String(item.pid)} ${item.name}${own.has(item.pid) ? " (this process or its ancestor, never ended)" : ""}`).join(", ")}`
    }
    const { lockers, how } = await lockersOf(folder)
    if (lockers !== null) return `held by (${how}): ${lockers.replaceAll(/\s*\n\s*/g, "; ")}`
    const scan = typeof listed === "string" ? `the process table could not be read (${listed})` : `no process works inside it (${String(listed.length)} processes read)`
    return `holder unknown: ${scan}; ${how}`
}
