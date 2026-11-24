import { appendFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { killPidTree } from "../shared/exec.js"
import { listProcesses } from "./process-table.js"
import type { HostProcess } from "./process-table.js"

/**
 * The harness's own runs and their reaper (`starci ops reap`). A command the harness starts for a caller (a
 * `slot run`, a `lane gate`, a `gallery shoot` or `app look` under its slot, an `app check`) records itself as one file in `<slot root>/_runs/`:
 * its pid and start, the label and folder, and its launchers, the chain of up to LAUNCHER_DEPTH processes above it (the shell or gate that
 * started it, and the agent or terminal above that), each with its start, so a reused pid never reads as alive. A run whose launcher is gone
 * has nobody to report to: the reaper stamps when it first saw that, and once the stamp is older than `reap.graceMinutes` (ops/slots.yaml)
 * it stops the run's whole process tree (the server and the browser of a shoot, the app check of a gate) and logs what it stopped in
 * `<slot root>/_reap.log`. A process the harness did not record is never touched, and neither is the reaper itself or one of its ancestors.
 */

/** How many processes above a run are its launchers: the shell (or gate) that started it and what started that. */
export const LAUNCHER_DEPTH = 2

/** A process named by its pid and when it started (epoch ms; null when the host does not say). */
export interface ProcessId {
    readonly pid: number
    readonly startMs: number | null
}

/** One recorded run. */
export interface RunRecord {
    readonly pid: number
    readonly startMs: number | null
    readonly label: string
    readonly cwd: string
    readonly at: string
    readonly launchers: readonly ProcessId[]
    /** Processes the run started outside its own tree's reach (a detached server), stopped with it. */
    readonly children: readonly ProcessId[]
    /** When a reap first saw a launcher gone (ISO). */
    readonly launcherGoneAt?: string
}

const runsDir = (root: string): string => join(root, "_runs")
const recordFile = (root: string, pid: number): string => join(runsDir(root), `${String(pid)}.json`)

/** The launchers of `pid` from one read of the process table: its parent, its parent's parent, ... up to LAUNCHER_DEPTH. Pure. */
export const launchersOf = (table: ReadonlyMap<number, Pick<HostProcess, "pid" | "ppid" | "startedMs">>, pid: number): ProcessId[] => {
    const chain: ProcessId[] = []
    let at = table.get(pid)
    for (let depth = 0; depth < LAUNCHER_DEPTH && at !== undefined; depth += 1) {
        const parent = table.get(at.ppid)
        if (parent === undefined || parent.pid === at.pid || parent.pid <= 4) break
        chain.push({ pid: parent.pid, startMs: parent.startedMs })
        at = parent
    }
    return chain
}

const write = (root: string, record: RunRecord): void => {
    mkdirSync(runsDir(root), { recursive: true })
    writeFileSync(recordFile(root, record.pid), `${JSON.stringify(record)}\n`)
}

/** The handle of this process's run: add a child it started detached, end the record when the run ends. */
export interface RunHandle {
    readonly child: (pid: number) => void
    readonly done: () => void
}

const NONE: RunHandle = { child: () => undefined, done: () => undefined }

/** This process's open run record, if any. */
let open: { readonly root: string; depth: number; record: RunRecord } | undefined

/**
 * Records this process as a harness run in `root` (the slot root) and returns its handle; nested calls in one process share one record (the
 * outer one ends it). It never fails its caller: a record it cannot write leaves the run unrecorded.
 */
export const registerRun = async (root: string, label: string, cwd: string): Promise<RunHandle> => {
    // A CI runner's job ends with its runner: nothing outlives a caller there.
    if (process.env.CI === "true" || process.env.CI === "1") return NONE
    if (open?.root === root) {
        open.depth += 1
        const outer = open
        return {
            child: (pid) => {
                addChild(outer, pid)
            },
            done: () => {
                outer.depth -= 1
            },
        }
    }
    try {
        const listed = await listProcesses(false)
        const table = typeof listed === "string" ? new Map<number, HostProcess>() : new Map(listed.map((item) => [item.pid, item]))
        const record: RunRecord = { pid: process.pid, startMs: table.get(process.pid)?.startedMs ?? null, label, cwd, at: new Date().toISOString(), launchers: launchersOf(table, process.pid), children: [] }
        write(root, record)
        const current = { root, depth: 1, record }
        open = current
        const done = (): void => {
            current.depth -= 1
            if (current.depth > 0) return
            open = undefined
            try {
                unlinkSync(recordFile(root, process.pid))
            } catch {
                // gone already (a reap, or a second done)
            }
        }
        process.once("exit", done)
        return {
            child: (pid) => {
                addChild(current, pid)
            },
            done,
        }
    } catch {
        return NONE
    }
}

const addChild = (current: { readonly root: string; record: RunRecord }, pid: number): void => {
    current.record = { ...current.record, children: [...current.record.children, { pid, startMs: null }] }
    try {
        write(current.root, current.record)
    } catch {
        // the record is the reaper's courtesy; the run goes on
    }
}

/** Every run recorded in `root`. */
export const readRuns = (root: string): RunRecord[] => {
    let names: string[]
    try {
        names = readdirSync(runsDir(root)).filter((name) => name.endsWith(".json"))
    } catch {
        return []
    }
    return names.flatMap((name) => {
        try {
            return [JSON.parse(readFileSync(join(runsDir(root), name), "utf8")) as RunRecord]
        } catch {
            return []
        }
    })
}

/** How the reaper reads the host. */
export interface ReapProbe {
    readonly nowMs: number
    /** Whether the process is the same one as recorded: alive, and started when recorded (a null start is not compared). */
    readonly same: (id: ProcessId) => boolean
    /** This process and its ancestors, never stopped. */
    readonly spared: ReadonlySet<number>
}

/** The verdict on one run. */
export interface RunVerdict {
    readonly record: RunRecord
    /** `finished` (the run's own process is gone: its record goes), `live` (a launcher lives), `orphan` (every check says its launcher is gone). */
    readonly state: "finished" | "live" | "orphan"
    /** Why: which launcher is gone, and since when. */
    readonly evidence: string
    /** An orphan past the grace: the reaper stops it. */
    readonly due: boolean
    /** When the launcher was first seen gone (the stamp a reap writes), for an orphan. */
    readonly goneSince?: string
}

/**
 * Judges a run on evidence alone: its own process gone (or its pid reused) is `finished`; a launcher (any of the chain) gone or reused makes it an
 * `orphan`, `due` once the stamp of the first sighting is `graceMinutes` old; a run that is the reaper or one of its ancestors is never due. Pure.
 */
export const judgeRun = (record: RunRecord, probe: ReapProbe, graceMinutes: number): RunVerdict => {
    if (!probe.same({ pid: record.pid, startMs: record.startMs })) return { record, state: "finished", evidence: `pid ${String(record.pid)} is gone`, due: false }
    const gone = record.launchers.find((launcher) => !probe.same(launcher))
    if (gone === undefined) return { record, state: "live", evidence: record.launchers.length === 0 ? "no launcher recorded" : `launcher pid ${String(record.launchers[0]?.pid)} alive`, due: false }
    const since = record.launcherGoneAt ?? new Date(probe.nowMs).toISOString()
    const minutes = (probe.nowMs - Date.parse(since)) / 60_000
    const due = minutes >= graceMinutes && !probe.spared.has(record.pid)
    return { record, state: "orphan", evidence: `launcher pid ${String(gone.pid)} is gone (first seen ${since}, ${String(Math.floor(minutes))} of ${String(graceMinutes)} min grace)`, due, goneSince: since }
}

/** What a reap found and did. */
export interface ReapReport {
    readonly verdicts: readonly RunVerdict[]
    readonly stopped: readonly RunRecord[]
}

/** The live probe: one read of the process table; null when it cannot be read (nothing is judged then). */
export const liveReapProbe = async (): Promise<ReapProbe | string> => {
    const listed = await listProcesses(false)
    if (typeof listed === "string") return listed
    const table = new Map(listed.map((item) => [item.pid, item]))
    const spared = new Set<number>([process.pid])
    let at = table.get(process.pid)
    for (let hops = 0; hops < 64 && at !== undefined && !spared.has(at.ppid); hops += 1) {
        spared.add(at.ppid)
        at = table.get(at.ppid)
    }
    const same = (id: ProcessId): boolean => {
        const item = table.get(id.pid)
        if (item === undefined) return false
        return id.startMs === null || item.startedMs === null || Math.abs(item.startedMs - id.startMs) <= 2000
    }
    return { nowMs: Date.now(), same, spared }
}

/**
 * One reap of the runs recorded in `root`: a finished run's record is dropped; an orphan is stamped the first time it is seen (with `execute`),
 * and one past its grace has its process tree and recorded children stopped (with `execute`), each stop logged in `<root>/_reap.log`. A dry run
 * changes nothing and says what a reap would do.
 */
export const reapRuns = (root: string, probe: ReapProbe, graceMinutes: number, execute: boolean, stop: (pid: number) => boolean = killPidTree): ReapReport => {
    const verdicts = readRuns(root).map((record) => judgeRun(record, probe, graceMinutes))
    const stopped: RunRecord[] = []
    if (!execute) return { verdicts, stopped }
    for (const verdict of verdicts) {
        const { record } = verdict
        if (verdict.state === "finished") {
            drop(root, record.pid)
            continue
        }
        if (verdict.state !== "orphan") continue
        if (!verdict.due) {
            if (record.launcherGoneAt === undefined && verdict.goneSince !== undefined) write(root, { ...record, launcherGoneAt: verdict.goneSince })
            continue
        }
        stop(record.pid)
        for (const child of record.children) if (probe.same(child) && !probe.spared.has(child.pid)) stop(child.pid)
        drop(root, record.pid)
        stopped.push(record)
        try {
            appendFileSync(join(root, "_reap.log"), `${new Date().toISOString()} stopped run pid ${String(record.pid)} "${record.label}" in ${record.cwd}${record.children.length === 0 ? "" : ` with children ${record.children.map((child) => String(child.pid)).join(", ")}`}: ${verdict.evidence}\n`)
        } catch {
            // the log is a courtesy
        }
    }
    return { verdicts, stopped }
}

const drop = (root: string, pid: number): void => {
    try {
        unlinkSync(recordFile(root, pid))
    } catch {
        // gone already
    }
}

/** The report lines of a reap. Pure. */
export const reapLines = (report: ReapReport, execute: boolean): string[] => [
    ...report.verdicts.filter((verdict) => verdict.state !== "live").map((verdict) => `${verdict.state === "finished" ? "finished" : verdict.due ? (execute ? "STOPPED" : "would stop") : "orphan (in grace)"} pid ${String(verdict.record.pid)} "${verdict.record.label}" in ${verdict.record.cwd}: ${verdict.evidence}`),
    `${String(report.verdicts.filter((verdict) => verdict.state === "live").length)} live run(s), ${String(report.verdicts.filter((verdict) => verdict.state === "orphan").length)} orphan(s), ${String(report.stopped.length)} stopped${execute ? "" : " (dry run: pass --execute)"}`,
]
