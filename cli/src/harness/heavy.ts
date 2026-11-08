import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { availableParallelism, constants, cpus, freemem, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { EXIT_HOST_HELD, Refusal } from "../shared/errors.js"
import { pidAlive } from "../shared/exec.js"
import type { RunOptions } from "../shared/exec.js"
import { managedCpuTimes } from "./host-holders.js"
import { governorStorePath, now } from "./ledger.js"
import { withMachine } from "./machine.js"
import { locateOps } from "./ops.js"
import { trimEndChars } from "../shared/trim.js"

/** What a heavy command is, for its memory cap: a typecheck, a lint, a test or suite run, a build, an npm install, a uat container. */
export type HeavyKind = "tsc" | "eslint" | "test" | "build" | "install" | "uat"

const HEAVY_KINDS = ["tsc", "eslint", "test", "build", "install", "uat"] as const

/** The kinds whose one process has a cap of its own (`heavy.caps`): a test run is sized at admission from the RAM free then (`testRunSizing`). */
const FIXED_KINDS = ["tsc", "eslint", "build", "install", "uat"] as const
type FixedKind = (typeof FIXED_KINDS)[number]

const heavySchema = z.strictObject({
    reserveMb: z.number().int().nonnegative(),
    maxSlots: z.number().int().positive().optional(),
    maxCpuPercent: z.number().positive().max(100),
    cpuWindowSeconds: z.number().int().positive(),
    cpuStarveMinutes: z.number().positive(),
    managedCpuFloorPercent: z.number().nonnegative().max(100),
    underForeignPressureSlots: z.number().int().positive(),
    pollSeconds: z.number().positive(),
    caps: z.strictObject(Object.fromEntries(FIXED_KINDS.map((kind) => [kind, z.strictObject({ capMb: z.number().int().positive(), minMb: z.number().int().positive() })])) as Record<FixedKind, z.ZodObject<{ capMb: z.ZodNumber; minMb: z.ZodNumber }, z.core.$strict>>),
    timeoutMinutes: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()),
    timeoutMinutesPer1000Files: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()).optional(),
    testWorkers: z.string().regex(/^(?:\d+|\d{1,3}%)$/),
    testRun: z.strictObject({ parentMb: z.number().int().positive(), workerMb: z.number().int().positive() }),
    plannedSeconds: z.number().positive(),
    seatFreeMb: z.number().int().positive(),
    starvedTicketMinutes: z.number().positive(),
    bootProofTimeoutSeconds: z.number().int().positive(),
    scannerCpuPercent: z.number().positive(),
    plan: z.strictObject({
        parent: z.strictObject({ baseMb: z.number().positive(), perRecordMb: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive() }),
        lintChunk: z.strictObject({ files: z.number().int().positive() }),
    }).optional(),
})

/** The `heavy` block of ops/liveness.yaml: the host's heavy-command slots, the RAM and CPU that admit them, each kind's memory cap and the seat RAM floor. */
export type HeavyRules = z.infer<typeof heavySchema>

const loaded = new Map<string, HeavyRules>()

/** Loads and validates the `heavy` block of ops/liveness.yaml (STARCI_OPS_DIR honoured); read once per process. */
export const loadHeavyRules = (dir: string = locateOps()): HeavyRules => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = z.looseObject({ heavy: heavySchema }).safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} heavy block is invalid: ${z.prettifyError(parsed.error)}`)
    loaded.set(dir, parsed.data.heavy)
    return parsed.data.heavy
}

/**
 * The liveness budget of one heavy command in minutes, or undefined when the kind declares none (the caller's applies): the kind's
 * `timeoutMinutes`, raised for a command that names the number of files it judges to `timeoutMinutesPer1000Files` for each thousand of them, and
 * never below `timeoutMinutes`. It bounds a hung child; it measures no quality, and a command that finishes early is never judged by it.
 */
export const heavyTimeoutMinutes = (rules: HeavyRules, kind: HeavyKind, files?: number): number | undefined => {
    const base = rules.timeoutMinutes[kind]
    if (base === undefined) return undefined
    const rate = rules.timeoutMinutesPer1000Files?.[kind]
    return rate === undefined || files === undefined ? base : Math.max(base, (rate * files) / 1000)
}

/**
 * The environment variable a heavy command's children inherit: the slot ids of the heavy commands they run under, comma-separated. A heavy command a child
 * starts (a `starci check run` a command check runs) is admitted on its own, and the rows of its ancestors never count against it: they wait on it, so
 * counting them could hold it forever.
 */
export const HEAVY_PARENTS_ENV = "STARCI_HEAVY_PARENTS"

/** The slot ids of the heavy commands this process runs under (`HEAVY_PARENTS_ENV`). */
const heavyParents = (): string[] => (process.env[HEAVY_PARENTS_ENV] ?? "").split(",").filter((id) => id !== "")

/**
 * The host's load as admission reads it: free memory, the CPU average over the window, the share of it the governor's own running
 * commands burn (`managedCpuPercent`, read only while the CPU is above its ceiling, null otherwise or when the process table
 * cannot be read), the CPU rule that applied (`cpuRule`, null under the ceiling), the count cap, the memory the recently admitted commands
 * planned, `roomMb` (free RAM less the reserve and that plan), and `admitted`, how many heavy commands may run now (the running ones plus how many
 * more of the smallest need fit), with why, and `shortMb`, the MB of its own need the room lacks while nothing else runs (0 otherwise). `pressure` is true when no
 * command beyond the running ones fits now: the host cannot admit the next one.
 */
export interface HostLoad {
    readonly freeMb: number
    readonly cpuPercent: number
    readonly managedCpuPercent: number | null
    readonly cpuRule: string | null
    readonly cap: number
    readonly reserveMb: number
    readonly committedMb: number
    readonly roomMb: number
    readonly shortMb: number
    readonly running: number
    readonly admitted: number
    readonly pressure: boolean
    readonly reason: string
}

/** The count cap: floor(logical cores / 2), or `maxSlots` when set lower; at least one. */
export const slotCap = (rules: HeavyRules, cores: number = availableParallelism()): number => Math.max(1, Math.min(Math.floor(cores / 2), rules.maxSlots ?? Number.MAX_SAFE_INTEGER))

/**
 * The CPU rule for a CPU average above the ceiling. The ceiling governs the harness's own contribution: when the share the
 * governor's running commands burn (`managed`, percent of the host's total CPU) is under managedCpuFloorPercent, the load is
 * foreign and holding the harness back would not lower it, so up to underForeignPressureSlots commands run under it. Otherwise
 * (the share is at or above the floor, or unknown) the ceiling holds every new command. Either way a starved queue
 * (`starvedQueue`) admits its oldest fitting command, one at a time. `slots` is how many more commands the CPU lets start now.
 */
const cpuRuleOf = (rules: HeavyRules, cpuPercent: number, managed: number | null, running: number, starved: boolean): { readonly slots: number; readonly rule: string } => {
    const window = `${String(cpuPercent)}% over ${String(rules.cpuWindowSeconds)} s`
    const starve = `the queue admitted nothing for ${String(rules.cpuStarveMinutes)} min`
    const foreignSlots = rules.underForeignPressureSlots
    if (managed !== null && managed < rules.managedCpuFloorPercent) {
        const head = `CPU ${String(cpuPercent)}% is foreign (managed ${String(managed)}%, under heavy.managedCpuFloorPercent ${String(rules.managedCpuFloorPercent)}%): ${String(foreignSlots)} slots under foreign pressure`
        if (running < foreignSlots) return { slots: foreignSlots - running, rule: `${head}, ${String(running)} in use` }
        if (starved) return { slots: 1, rule: `${head}, all in use, but ${starve}: the oldest fitting command starts, one at a time` }
        return { slots: 0, rule: `${head}, all in use: no more starts until ${starve}, then the oldest fitting one does` }
    }
    const share = managed === null ? "the managed share is unknown" : `the load is the harness's own (managed ${String(managed)}%, at or above heavy.managedCpuFloorPercent ${String(rules.managedCpuFloorPercent)}%)`
    if (starved) return { slots: 1, rule: `CPU ${window} is above ${String(rules.maxCpuPercent)}% and ${share}, but ${starve}: the oldest fitting command starts, one at a time` }
    return { slots: 0, rule: `CPU ${window} is above ${String(rules.maxCpuPercent)}% and ${share}: no new heavy command starts until ${starve}, then the oldest fitting one does` }
}

/** The least room a command of each kind starts in: `heavy.caps` minMb, and for a test run its parent and one worker (`heavy.testRun`). */
export const needsOf = (rules: HeavyRules): Readonly<Record<HeavyKind, number>> => ({
    tsc: rules.caps.tsc.minMb,
    eslint: rules.caps.eslint.minMb,
    build: rules.caps.build.minMb,
    install: rules.caps.install.minMb,
    uat: rules.caps.uat.minMb,
    test: rules.testRun.parentMb + rules.testRun.workerMb,
})

/**
 * Dynamic admission from RAM and CPU. A command of `kind` is admitted when the CPU lets one more start (at or under its ceiling;
 * above it, the rule `cpuRuleOf` names from `managedCpu`, the share the governor's own running commands burn), fewer than the
 * cap run, and the room covers its least need: room = free RAM now - reserveMb - what the commands admitted in the last `plannedSeconds` planned
 * (a `running` row carries that plan, and 0 once the command has had that long to grow into the free RAM, which then shows it). While nothing runs,
 * one is admitted whatever the room: no running command will release memory, so waiting could not help. `shortMb` is how much of its need the room
 * lacks while it is admitted alone; the caller sizes the command to the room and says so. The CPU never lifts a RAM rule. Without a kind, `admits` is
 * judged for the smallest need (what `host load` reports). `starved` (the queue admitted nothing for cpuStarveMinutes, `starvedQueue`) lets one
 * command start under a hot CPU: high CPU slows the queue, it never stops it.
 */
export const admission = (rules: HeavyRules, freeMb: number, cpuPercent: number, running: readonly RunningRow[] = [], kind?: HeavyKind, starved = false, managedCpu: number | null = null, ownMb?: number): HostLoad & { readonly admits: boolean; readonly cpuHolds: boolean } => {
    const cap = slotCap(rules)
    const needs: Readonly<Record<string, number>> = needsOf(rules)
    const committedMb = running.reduce((sum, row) => sum + row.mb, 0)
    const own = ownMb ?? (kind === undefined ? Math.min(...Object.values(needs)) : (needs[kind] ?? 0))
    const room = freeMb - rules.reserveMb - committedMb
    const hot = cpuPercent > rules.maxCpuPercent
    const cpu = hot ? cpuRuleOf(rules, cpuPercent, managedCpu, running.length, starved) : { slots: Number.MAX_SAFE_INTEGER, rule: null }
    const cpuHolds = cpu.slots === 0
    const full = running.length >= cap
    const alone = running.length === 0
    const fits = alone || room >= own
    const admits = !cpuHolds && !full && fits
    const byRoom = alone && room < own ? 1 : Math.floor(room / own)
    const fitting = Math.max(0, Math.min(cap - running.length, byRoom))
    const admitted = running.length + Math.min(cpu.slots, fitting)
    const maxSlotsSuffix = rules.maxSlots === undefined ? "" : `, maxSlots ${String(rules.maxSlots)}`
    const reasons = [
        ...(cpu.rule === null ? [] : [cpu.rule]),
        ...(full ? [`${String(running.length)} running reach the cap of ${String(cap)} (floor(cores / 2)${maxSlotsSuffix})`] : []),
        ...(!cpuHolds && !full && !fits ? [`free RAM ${String(freeMb)} MB less the reserve ${String(rules.reserveMb)} MB and the ${String(committedMb)} MB that commands admitted in the last ${String(rules.plannedSeconds)} s planned is under the need of one more (${String(own)} MB)`] : []),
    ]
    const capacity = `${String(admitted)} of cap ${String(cap)} fit: free ${String(freeMb)} MB - reserve ${String(rules.reserveMb)} MB - planned ${String(committedMb)} MB = ${String(room)} MB room`
    return {
        freeMb,
        cpuPercent,
        managedCpuPercent: hot ? managedCpu : null,
        cpuRule: cpu.rule,
        cap,
        reserveMb: rules.reserveMb,
        committedMb,
        roomMb: room,
        shortMb: alone ? Math.max(0, own - room) : 0,
        running: running.length,
        admitted,
        admits,
        cpuHolds,
        pressure: admitted <= running.length,
        reason: reasons.length === 0 ? capacity : `${reasons.join("; ")}; ${capacity}`,
    }
}

/** Runs `work` on the governor's store (ledger.ts governorStorePath), shared by every worktree of the harness. */
const withGovernor = <T>(work: (db: DatabaseSync) => T): T => withMachine(work, governorStorePath())

const TABLES = `
CREATE TABLE IF NOT EXISTS heavy_slots (
  id TEXT PRIMARY KEY, pid INTEGER NOT NULL, child_pid INTEGER, kind TEXT NOT NULL, label TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cpu_samples (at_ms INTEGER NOT NULL, idle REAL NOT NULL, total REAL NOT NULL);
CREATE TABLE IF NOT EXISTS managed_cpu_samples (at_ms INTEGER NOT NULL, total REAL NOT NULL, pids_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seat_holds (
  task TEXT PRIMARY KEY, repo TEXT NOT NULL, since TEXT NOT NULL, last_at TEXT NOT NULL, free_mb INTEGER NOT NULL, floor_mb INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS host_starvation (id INTEGER PRIMARY KEY CHECK (id = 1), since TEXT NOT NULL, ticket TEXT);
CREATE TABLE IF NOT EXISTS heavy_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Creates the governor's tables, adding the `task` column a store made before it lacks. */
const ensureTables = (db: DatabaseSync): void => {
    db.exec(TABLES)
    const columns = db.prepare("PRAGMA table_info(heavy_slots)").all().map((column) => column.name)
    if (!columns.includes("task")) db.exec("ALTER TABLE heavy_slots ADD COLUMN task TEXT")
    // The MB the command planned to take (its parent and workers, or its heap cap).
    if (!columns.includes("mb")) db.exec("ALTER TABLE heavy_slots ADD COLUMN mb INTEGER")
    // The epoch ms at which the row was admitted: its plan counts in the room for `heavy.plannedSeconds` after it.
    if (!columns.includes("admitted_ms")) db.exec("ALTER TABLE heavy_slots ADD COLUMN admitted_ms INTEGER")
}

/** The heavy_meta row holding the epoch ms of the governor's last admission, what the starvation clock runs from. */
const LAST_ADMIT = "last-admit-ms"

/** This host's CPU time so far, summed over every core. */
const cpuTimes = (): { readonly idle: number; readonly total: number } => {
    let idle = 0
    let total = 0
    for (const cpu of cpus()) {
        idle += cpu.times.idle
        total += cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq
    }
    return { idle, total }
}

const SAMPLE_MIN_MS = 1000

/**
 * The CPU average over the window (`heavy.cpuWindowSeconds`), host-wide: every reading is kept in machine.sqlite, so the average
 * runs from the newest reading at least a window old (else the oldest one there is) to now; with no reading a second old, this
 * process samples one second itself.
 */
export const cpuPercent = async (rules: HeavyRules): Promise<number> => {
    const windowMs = rules.cpuWindowSeconds * 1000
    const reading = (): { readonly idle: number; readonly total: number; readonly atMs: number } => ({ ...cpuTimes(), atMs: Date.now() })
    const record = (sample: ReturnType<typeof reading>): { readonly idle: number; readonly total: number } | undefined =>
        withGovernor((db) => {
            ensureTables(db)
            db.prepare("INSERT INTO cpu_samples (at_ms, idle, total) VALUES (?, ?, ?)").run(sample.atMs, sample.idle, sample.total)
            db.prepare("DELETE FROM cpu_samples WHERE at_ms < ?").run(sample.atMs - windowMs * 5)
            const old =
                db.prepare("SELECT idle, total FROM cpu_samples WHERE at_ms <= ? ORDER BY at_ms DESC LIMIT 1").get(sample.atMs - windowMs) ??
                db.prepare("SELECT idle, total FROM cpu_samples WHERE at_ms <= ? ORDER BY at_ms ASC LIMIT 1").get(sample.atMs - SAMPLE_MIN_MS)
            return old === undefined ? undefined : { idle: Number(old.idle), total: Number(old.total) }
        })
    let current = reading()
    let since = record(current)
    if (since === undefined) {
        since = current
        await sleep(SAMPLE_MIN_MS)
        current = reading()
        record(current)
    }
    const total = current.total - since.total
    return total <= 0 ? 0 : Math.round(100 * (1 - (current.idle - since.idle) / total))
}

/** The heavy_meta row holding the epoch ms at which a process last took a managed CPU reading, so one process reads at a time. */
const MANAGED_CLAIM = "managed-cpu-claim-ms"

/** How often a managed CPU reading is taken at most (a process-table read: PowerShell on Windows); half the window when shorter. */
const MANAGED_SAMPLE_MS = 10_000

/** One managed CPU reading: when, the host's CPU time so far over every core, and each managed process's CPU time so far, in ms. */
interface ManagedReading {
    readonly atMs: number
    readonly total: number
    readonly pids: Readonly<Record<string, number>>
}

/** Two managed readings the share is measured between: the older and the newest. */
interface ManagedPair {
    readonly old: ManagedReading
    readonly current: ManagedReading
}

/**
 * The managed share between two readings, in percent of the host's total CPU: each managed process's CPU time since the older
 * reading (all of it for a process the older one did not hold, or held at more, a reused pid), at most the host's whole time.
 * A managed process that ended between them is not counted, so the share can only read low by what ended.
 */
const managedShare = (old: ManagedReading, current: ManagedReading): number => {
    const total = current.total - old.total
    if (total <= 0) return 0
    let used = 0
    for (const [pid, cpuMs] of Object.entries(current.pids)) {
        const before = old.pids[pid]
        used += before === undefined || before > cpuMs ? cpuMs : cpuMs - before
    }
    return Math.round((100 * Math.min(used, total)) / total)
}

/**
 * The share of the host's CPU the governor's own running heavy commands burn (their processes and every process under them,
 * `managedCpuTimes` of harness/host-holders.ts), averaged over the window as `cpuPercent` is: readings live in machine.sqlite
 * (`managed_cpu_samples`), the newest is compared with the newest at least a window older (else the oldest a second older), and
 * one process host-wide takes a new reading at most every MANAGED_SAMPLE_MS (`managed-cpu-claim-ms` in heavy_meta); with no
 * pair a second apart, this process reads twice itself. Null when the process table cannot be read: the share is unknown.
 */
export const managedCpuPercent = async (rules: HeavyRules): Promise<number | null> => {
    const windowMs = rules.cpuWindowSeconds * 1000
    const refreshMs = Math.min(MANAGED_SAMPLE_MS, windowMs / 2)
    const read = async (): Promise<ManagedReading | null> => {
        const times = await managedCpuTimes(heavySlots())
        if (typeof times === "string") return null
        return { atMs: Date.now(), total: cpuTimes().total, pids: Object.fromEntries([...times].map(([pid, cpuMs]) => [String(pid), cpuMs])) }
    }
    const store = (reading: ManagedReading): void => {
        withGovernor((db) => {
            db.prepare("INSERT INTO managed_cpu_samples (at_ms, total, pids_json) VALUES (?, ?, ?)").run(reading.atMs, reading.total, JSON.stringify(reading.pids))
            db.prepare("DELETE FROM managed_cpu_samples WHERE at_ms < ?").run(reading.atMs - windowMs * 5)
        })
    }
    const toReading = (row: Record<string, unknown> | undefined): ManagedReading | undefined =>
        row === undefined ? undefined : { atMs: Number(row.at_ms), total: Number(row.total), pids: JSON.parse(String(row.pids_json)) as Record<string, number> }
    const pairIn = (db: DatabaseSync): ManagedPair | undefined => {
        const current = toReading(db.prepare("SELECT * FROM managed_cpu_samples ORDER BY at_ms DESC LIMIT 1").get())
        if (current === undefined) return undefined
        const old =
            toReading(db.prepare("SELECT * FROM managed_cpu_samples WHERE at_ms <= ? ORDER BY at_ms DESC LIMIT 1").get(current.atMs - windowMs)) ??
            toReading(db.prepare("SELECT * FROM managed_cpu_samples WHERE at_ms <= ? ORDER BY at_ms ASC LIMIT 1").get(current.atMs - SAMPLE_MIN_MS))
        return old === undefined ? undefined : { old, current }
    }
    // One open of the store decides: a reading is due (and claimed), or the stored pair answers.
    const decided = withGovernor((db): { readonly due: true } | { readonly due: false; readonly found: ManagedPair | undefined } => {
        ensureTables(db)
        const at = Date.now()
        const newest = Number(db.prepare("SELECT MAX(at_ms) AS at FROM managed_cpu_samples").get()?.at ?? 0)
        const claimed = Number(db.prepare("SELECT value FROM heavy_meta WHERE key = ?").get(MANAGED_CLAIM)?.value ?? 0)
        if (at - newest < refreshMs || at - claimed < refreshMs) return { due: false, found: pairIn(db) }
        db.prepare("INSERT INTO heavy_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(MANAGED_CLAIM, String(at))
        return { due: true }
    })
    if (!decided.due && decided.found !== undefined) return managedShare(decided.found.old, decided.found.current)
    const taken = decided.due ? await read() : undefined
    if (taken === null) return null
    const found = taken === undefined ? undefined : withGovernor((db) => {
        db.prepare("INSERT INTO managed_cpu_samples (at_ms, total, pids_json) VALUES (?, ?, ?)").run(taken.atMs, taken.total, JSON.stringify(taken.pids))
        db.prepare("DELETE FROM managed_cpu_samples WHERE at_ms < ?").run(taken.atMs - windowMs * 5)
        return pairIn(db)
    })
    if (found !== undefined) return managedShare(found.old, found.current)
    const first = taken ?? (await read())
    if (first === null) return null
    if (taken === undefined) store(first)
    await sleep(SAMPLE_MIN_MS)
    const second = await read()
    if (second === null) return null
    store(second)
    return managedShare(first, second)
}

/** A running heavy command as admission counts it: its kind and the MB it planned, which counts for `plannedSeconds` after its admission and is 0 after. */
export interface RunningRow {
    readonly kind: string
    readonly mb: number
}

/** The heavy commands running now (live processes only) but the `except` ones (the caller's ancestors), each with the MB it planned while its admission is under `plannedSeconds` old. */
const runningRows = (db: DatabaseSync, rules: HeavyRules, atMs: number = Date.now(), except: ReadonlySet<string> = new Set()): RunningRow[] =>
    db.prepare("SELECT id, kind, mb, admitted_ms FROM heavy_slots WHERE state = 'running'").all().filter((row) => !except.has(String(row.id))).map((row) => ({
        kind: String(row.kind),
        mb: typeof row.mb === "number" && typeof row.admitted_ms === "number" && atMs - row.admitted_ms < rules.plannedSeconds * 1000 ? row.mb : 0,
    }))

/**
 * Whether the queue is starved: commands wait and none was admitted for cpuStarveMinutes, counted from the later of the last
 * admission and the oldest wait (a queue that formed just now after an idle hour is not starved).
 */
const starvedQueue = (db: DatabaseSync, rules: HeavyRules, at: number = Date.now()): boolean => {
    const oldest = db.prepare("SELECT MIN(at) AS at FROM heavy_slots WHERE state = 'waiting'").get()?.at
    if (oldest === null || oldest === undefined) return false
    const last = Number(db.prepare("SELECT value FROM heavy_meta WHERE key = ?").get(LAST_ADMIT)?.value ?? 0)
    return at - Math.max(last, Date.parse(String(oldest))) >= rules.cpuStarveMinutes * 60_000
}

/** The CPU the governor judges on: the window's average and, only while it is above the ceiling, the managed share of it. */
export const cpuLoad = async (rules: HeavyRules): Promise<{ readonly cpu: number; readonly managed: number | null }> => {
    const cpu = await cpuPercent(rules)
    return { cpu, managed: cpu > rules.maxCpuPercent ? await managedCpuPercent(rules) : null }
}

/** The host's load now, over the commands running now, with the CPU rule and the starvation rule as the queue stands. */
export const hostLoad = async (rules: HeavyRules = loadHeavyRules()): Promise<HostLoad> => {
    const { cpu, managed } = await cpuLoad(rules)
    heavySlots()
    const { running, starved } = withGovernor((db) => ({ running: runningRows(db, rules), starved: starvedQueue(db, rules) }))
    return admission(rules, Math.floor(freemem() / 1_048_576), cpu, running, undefined, starved, managed)
}

/** The waiting rows in the order the governor serves them: first come, first served (the order they joined the queue). */
const servingOrder = (rows: readonly { readonly id: string; readonly kind: string; readonly state: string }[]): { readonly id: string; readonly kind: string }[] => rows.filter((row) => row.state === "waiting")

/** One row of the semaphore: a heavy command running (its child's pid once spawned) or waiting for a slot. */
export interface HeavySlot {
    readonly id: string
    readonly pid: number
    readonly childPid: number | null
    readonly kind: string
    readonly label: string
    readonly cwd: string
    /** The task whose verify the command runs for (`withHeavyBound`), else null. */
    readonly task: string | null
    readonly state: "running" | "waiting"
    readonly at: string
}

/** Every slot row of a live process, running first; rows of a process that is gone are dropped on the way. */
export const heavySlots = (): HeavySlot[] =>
    withGovernor((db) => {
        ensureTables(db)
        const rows = db.prepare("SELECT * FROM heavy_slots ORDER BY state, at").all()
        const live: HeavySlot[] = []
        for (const row of rows) {
            if (!pidAlive(Number(row.pid))) {
                db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
                continue
            }
            live.push({
                id: String(row.id),
                pid: Number(row.pid),
                childPid: row.child_pid === null ? null : Number(row.child_pid),
                kind: String(row.kind),
                label: String(row.label),
                cwd: String(row.cwd),
                task: typeof row.task === "string" ? row.task : null,
                state: row.state === "running" ? "running" : "waiting",
                at: String(row.at),
            })
        }
        return live
    })

/**
 * One try for a slot, atomically (withMachine runs it under BEGIN IMMEDIATE, so two processes never both take the last room). The
 * row joins the queue (keeping its place), and the queue is first come, first served (`servingOrder`): only the head may start, and
 * it starts when admission admits it now, against the commands running at this instant and the free RAM read now, and its plan is
 * written in the same transaction (`planFor`), so the next admission finds it; a row behind a head that waits for RAM waits too. Above the CPU ceiling the rule `cpuRuleOf` names from `cpu.managed` applies: a
 * foreign load leaves underForeignPressureSlots open, the harness's own holds the queue until it is starved (`starvedQueue`) and
 * then admits the first fitting row alone. The rows of the caller's ancestors (`parents`) are not counted: they wait on it. The load it was judged on, and the
 * holders when it waits.
 */
const tryAcquire = (slot: Omit<HeavySlot, "childPid" | "state" | "at"> & { readonly mb: number }, rules: HeavyRules, cpu: { readonly cpu: number; readonly managed: number | null }, freeMb: number, planFor: (roomMb: number) => number, parents: ReadonlySet<string> = new Set()): { readonly load: HostLoad; readonly holders: string[] | null; readonly place: number } =>
    withGovernor((db) => {
        ensureTables(db)
        for (const row of db.prepare("SELECT id, pid FROM heavy_slots").all()) if (!pidAlive(Number(row.pid))) db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
        db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, task, state, at, mb) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?) ON CONFLICT (id) DO NOTHING").run(slot.id, slot.pid, slot.kind, slot.label, slot.cwd, slot.task, now(), slot.mb)
        const rows = db.prepare("SELECT id, kind, cwd, state, at, mb FROM heavy_slots ORDER BY rowid").all().map((row) => ({ id: String(row.id), kind: String(row.kind), cwd: String(row.cwd), state: String(row.state), at: String(row.at), mb: typeof row.mb === "number" && row.mb > 0 ? row.mb : undefined }))
        const running = db.prepare("SELECT id, label, pid, mb, admitted_ms FROM heavy_slots WHERE state = 'running'").all().filter((row) => !parents.has(String(row.id)))
        const atMs = Date.now()
        const held = runningRows(db, rules, atMs, parents)
        const starved = starvedQueue(db, rules)
        const plannedOf = new Map(rows.map((row) => [row.id, row.mb] as const))
        const judge = (id: string, kind: string): ReturnType<typeof admission> => admission(rules, freeMb, cpu.cpu, held, kind as HeavyKind, starved, cpu.managed, plannedOf.get(id))
        const order = servingOrder(rows)
        const load = judge(slot.id, slot.kind)
        if (order[0]?.id !== slot.id || !load.admits) {
            const place = order.findIndex((row) => row.id === slot.id)
            const queued = place <= 0 ? "first in the queue" : `${String(place)} ahead of it in the queue`
            return { load: { ...load, reason: `${load.reason}; ${queued}` }, holders: running.map((row) => `${String(row.label)} (pid ${String(row.pid)}) planned ${String(row.mb)} MB, admitted ${String(Math.round((atMs - Number(row.admitted_ms ?? atMs)) / 1000))} s ago`), place: Math.max(0, place) }
        }
        db.prepare("UPDATE heavy_slots SET state = 'running', admitted_ms = ?, mb = ? WHERE id = ?").run(atMs, planFor(load.roomMb), slot.id)
        db.prepare("INSERT INTO heavy_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(LAST_ADMIT, String(Date.now()))
        return { load, holders: null, place: 0 }
    })

const setChild = (id: string, pid: number): void => {
    withGovernor((db) => db.prepare("UPDATE heavy_slots SET child_pid = ? WHERE id = ?").run(pid, id))
}

const release = (id: string): void => {
    withGovernor((db) => {
        ensureTables(db)
        db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(id)
    })
}

/**
 * The limits @starci/hfs reads from its environment, from their one owner here: the heap of the ESLint child an app check spawns
 * (`caps.eslint`, as STARCI_ESLINT_HEAP_MB), the heap of the tsc child (`caps.tsc`, as STARCI_TSC_HEAP_MB) and the budget of the lite boot proof's worker from its spawn (`bootProofTimeoutSeconds`, as
 * STARCI_BOOT_PROOF_TIMEOUT_MS).
 */
export const hfsLimitsEnv = (rules: HeavyRules = loadHeavyRules()): Readonly<Record<string, string>> => ({
    STARCI_ESLINT_HEAP_MB: String(rules.caps.eslint.capMb),
    STARCI_TSC_HEAP_MB: String(rules.caps.tsc.capMb),
    STARCI_BOOT_PROOF_TIMEOUT_MS: String(rules.bootProofTimeoutSeconds * 1000),
    // The ESLint child's liveness budget (heavyTimeoutMinutes), which the rendered CI's lint job outlasts.
    ...(rules.timeoutMinutes.eslint === undefined ? {} : { STARCI_ESLINT_TIMEOUT_MINUTES: String(rules.timeoutMinutes.eslint) }),
    ...(rules.timeoutMinutesPer1000Files?.eslint === undefined ? {} : { STARCI_ESLINT_MINUTES_PER_1000_FILES: String(rules.timeoutMinutesPer1000Files.eslint) }),
})

/** The heap a node tool of `kind` runs under on a room of `roomMb`: its cap, or the room when that is under the cap, and never under the least it starts in. */
export const heapFor = (rules: HeavyRules, kind: FixedKind, roomMb: number): number => Math.max(rules.caps[kind].minMb, Math.min(rules.caps[kind].capMb, Math.floor(roomMb)))

/** `inherited` NODE_OPTIONS with its `--max-old-space-size` replaced by `mb`. */
const withHeap = (inherited: string, mb: number): string => `${inherited.replaceAll(/--max-old-space-size=\d+/g, "").trim()} --max-old-space-size=${String(mb)}`.trim()

/**
 * A heavy command's run options with its slot: the memory cap, below-normal OS priority, the pid hook and HEAVY_PARENTS_ENV for its
 * children, `roomMb`, the room admission measured for it (null on a CI runner, which keeps no queue), and, for a test run, the sizing it runs under.
 */
export interface Held {
    readonly options: RunOptions
    readonly roomMb: number | null
    readonly rules: HeavyRules
    /** A test run's parent, workers and worker caps, sized from the room measured at its admission. */
    readonly test?: TestRunSizing | undefined
    /** The heap cap the command's node process runs under (a test run's parent), in MB. */
    readonly heapMb?: number | undefined
    /** The RAM free when the command was admitted, in MB. */
    readonly freeMb?: number | undefined
}

/** The most workers a test run takes: `heavy.testWorkers`, a count or a percent of the logical cores, at least one, and one core stays free for the parent. */
export const testWorkerCap = (rules: HeavyRules, cores: number = availableParallelism()): number => {
    const percent = /^(\d{1,3})%$/.exec(rules.testWorkers)?.[1]
    return Math.max(1, Math.min(cores - 1, percent === undefined ? Number(rules.testWorkers) : Math.floor((cores * Number(percent)) / 100)))
}

/** What a test run is sized to: the jest parent's cap, the workers, and the cap of each. */
export interface TestRunSizing {
    /** The jest parent's heap cap and plan, `heavy.testRun.parentMb`. */
    readonly parentMb: number
    readonly workers: number
    /** Each worker's heap cap and the RSS past which jest recycles it (`--workerIdleMemoryLimit`), `heavy.testRun.workerMb`. */
    readonly workerMb: number
    /** What the run plans to take: the parent and every worker. */
    readonly holdMb: number
}

/**
 * The size of a test run from the room now, greedily and with no earlier run read. `roomMb` is the free RAM now less `reserveMb` and what the commands
 * admitted in the last `plannedSeconds` planned. The jest parent takes `parentMb`; the workers are what the rest of the room holds,
 * clamp(floor((room - parent) / workerMb), 1, min(cores - 1, `testWorkers`, `maxWorkers`)); each worker takes `workerMb`. One worker is the floor.
 * `maxWorkers` is a cap its caller names for a run that can use no more (the jest discovery asks for one); an app check test step names none, so it takes what the room at its start holds.
 */
export const testRunSizing = (rules: HeavyRules, roomMb: number, cores: number = availableParallelism(), maxWorkers: number = Number.MAX_SAFE_INTEGER): TestRunSizing => {
    const { parentMb, workerMb } = rules.testRun
    const workers = Math.max(1, Math.min(testWorkerCap(rules, cores), maxWorkers, Math.floor((Math.max(0, roomMb) - parentMb) / workerMb)))
    return { parentMb, workers, workerMb, holdMb: parentMb + workers * workerMb }
}

/**
 * The script a test run's parent preloads (`--require`). Jest forks its workers with the parent's environment and flags, so the parent's heap would be
 * every worker's; this gives each fork the worker cap as its heap instead and drops itself from the fork's NODE_OPTIONS.
 */
const WORKER_HEAP_FILE = "starci-jest-worker-heap-1.cjs"
const WORKER_HEAP_SOURCE = `const cp = require("node:child_process")
const mb = Number(process.env.STARCI_WORKER_HEAP_MB)
const ours = /--require[= ](?:"[^"]*starci-jest-worker-heap[^"]*"|\\S*starci-jest-worker-heap\\S*)/g
if (mb > 0) {
  const fork = cp.fork
  cp.fork = function (file, ...rest) {
    const at = rest.findIndex((part) => part !== null && typeof part === "object" && !Array.isArray(part))
    const given = at < 0 ? {} : rest[at]
    const env = given.env ?? process.env
    const kept = (env.NODE_OPTIONS ?? "").replace(/--max-old-space-size=\\d+/g, "").replace(ours, "").trim()
    const options = { ...given, execArgv: (given.execArgv ?? process.execArgv).filter((flag) => !flag.startsWith("--max-old-space-size")), env: { ...env, NODE_OPTIONS: \`\${kept} --max-old-space-size=\${mb}\`.trim() } }
    if (at < 0) rest.push(options)
    else rest[at] = options
    return fork.call(this, file, ...rest)
  }
}
`

/** Writes the preload once and returns its path, slash-separated so NODE_OPTIONS takes it on any host. */
const workerHeapPreload = (): string => {
    const file = join(tmpdir(), WORKER_HEAP_FILE)
    if (!existsSync(file) || readFileSync(file, "utf8") !== WORKER_HEAP_SOURCE) writeFileSync(file, WORKER_HEAP_SOURCE)
    return file.replaceAll("\\", "/")
}

/**
 * The environment a test run's parent takes from its sizing: NODE_OPTIONS with the parent's heap and the preload that gives each worker the worker
 * cap as its heap, and STARCI_WORKER_HEAP_MB for it.
 */
export const testRunEnv = (sizing: TestRunSizing, inherited: string, preload: string = workerHeapPreload()): Readonly<Record<string, string>> => ({
    NODE_OPTIONS: `${withHeap(inherited, sizing.parentMb)} --require=${preload}`,
    STARCI_WORKER_HEAP_MB: String(sizing.workerMb),
})

const RUNNER = /^(jest|vitest)(?:\.[cm]?js)?$/

/**
 * The argv of a test runner (jest or vitest, named in the argv) with `--maxWorkers` of the sizing its slot was admitted with and, for jest,
 * `--workerIdleMemoryLimit` at the worker cap (a worker that grows past it is recycled), each unless the argv sets it already. An argv that
 * names neither runner is returned as it is.
 */
export const testWorkerArgs = (argv: readonly string[], held: Held): readonly string[] => {
    const runner = argv.map((part) => RUNNER.exec(basename(part))?.[1]).find((name) => name !== undefined)
    const sizing = held.test
    if (runner === undefined || sizing === undefined) return argv
    const sets = (flag: string): boolean => argv.some((part) => part.startsWith(flag))
    return [...argv, ...(sets("--maxWorkers") ? [] : [`--maxWorkers=${String(sizing.workers)}`]), ...(runner !== "jest" || sets("--workerIdleMemoryLimit") ? [] : [`--workerIdleMemoryLimit=${String(sizing.workerMb)}MB`])]
}

/** The refusal a heavy command meets in a coordinator's turn (`refuseHeavyWaits`) when the governor does not admit it at once. */
export const HEAVY_DEFERRED = "HEAVY_DEFERRED"

let waitsRefused = false

/**
 * Marks this process as a coordinator's turn (`kernel next`, `kernel submit`, `supervisor next`, `supervisor tick`): its own heavy
 * commands never queue (`withHeavySlot` refuses HEAVY_DEFERRED instead of waiting), and the workflow step it runs starts every
 * heavy settle (a verify, a wave, a final verify) as a detached job (`heavyWaitsRefused`, core/workflow/engine.ts).
 */
export const refuseHeavyWaits = (): void => {
    waitsRefused = true
}

/** Whether this process is a coordinator's turn that never waits in the heavy queue (`refuseHeavyWaits`). */
export const heavyWaitsRefused = (): boolean => waitsRefused

/** The refusal of a heavy command a verify's bound (`withHeavyBound`) stopped in the queue: the host held it, no verdict on the work. */
export const HOST_HELD = "HOST_HELD"

/** The environment variable carrying a verify's queue bound in ms to every process it starts (`withHeavyBound`). */
const HOLD_ENV = "STARCI_HEAVY_HOLD_MS"

/** The environment variable naming the pid whose wait a heavy command's queue time counts toward (`heavyOwner`). */
const OWNER_ENV = "STARCI_HEAVY_OWNER"

/** The environment variable naming the task whose verify a heavy command runs for (`withHeavyBound`, `taskQueuedMs`). */
const TASK_ENV = "STARCI_HEAVY_TASK"

/**
 * Runs a verify (`task verify`) whose heavy commands, and those of every process it starts while it runs, wait in the queue at most
 * `holdMs` (the verify's timeout) and are then refused HOST_HELD: the host held the work, nothing judged it, so the verify ends with
 * no verdict and spends no try. Their queue time is counted toward the verify's process (`heavyOwner`, `queuedSince`), so its lock
 * deadline counts only the time its commands ran, and toward `task`, the task it verifies (`taskQueuedMs`), so that task's budget
 * clock leaves it out. The bound ends with `work`: whatever the same process runs after it waits as before.
 */
export const withHeavyBound = async <T>(holdMs: number, task: string | undefined, work: () => Promise<T>): Promise<T> => {
    const before = { hold: process.env[HOLD_ENV], owner: process.env[OWNER_ENV], task: process.env[TASK_ENV] }
    process.env[HOLD_ENV] = String(holdMs)
    process.env[OWNER_ENV] = before.owner ?? String(process.pid)
    const owned = before.task ?? task
    if (owned !== undefined) process.env[TASK_ENV] = owned
    const restore = (name: string, value: string | undefined): void => {
        if (value === undefined) Reflect.deleteProperty(process.env, name)
        else process.env[name] = value
    }
    try {
        return await work()
    } finally {
        restore(HOLD_ENV, before.hold)
        restore(OWNER_ENV, before.owner)
        restore(TASK_ENV, before.task)
    }
}

/** The pid whose verify a heavy command of this process waits for: the bounding verify's (`withHeavyBound`), else this process's. */
export const heavyOwner = (): number => Number(process.env[OWNER_ENV] ?? process.pid)

/**
 * How long, in ms, the heavy commands counted toward `owner` (its own and its children's, `heavyOwner`) waited in the queue since
 * `since` (an ISO time): every finished wait recorded as a `heavy-wait` host event since then, clipped to `since`, plus each wait
 * still in the queue. What a verify's lock deadline leaves out (harness/settle.ts).
 */
export const queuedSince = (owner: number, since: string): number =>
    withGovernor((db) => {
        ensureTables(db)
        const from = Date.parse(since)
        const finished = db
            .prepare("SELECT at, data_json FROM host_events WHERE kind = 'heavy-wait' AND at >= ? AND json_extract(data_json, '$.owner') = ?")
            .all(since, owner)
            .reduce((sum, row) => sum + Math.min(Number((JSON.parse(String(row.data_json)) as { readonly waitedMs?: unknown }).waitedMs ?? 0), Date.parse(String(row.at)) - from), 0)
        const waiting = db
            .prepare("SELECT at FROM heavy_slots WHERE state = 'waiting' AND id LIKE ?")
            .all(`${String(owner)}-%`)
            .reduce((sum, row) => sum + Date.now() - Math.max(Date.parse(String(row.at)), from), 0)
        return finished + waiting
    })

/** A folder as `taskQueuedMs` compares it: resolved, forward slashes, no trailing slash, lower case on Windows. */
const folderKey = (path: string): string => {
    const slashed = trimEndChars(resolve(path).replaceAll("\\", "/"), "/")
    return process.platform === "win32" ? slashed.toLowerCase() : slashed
}

/** The wall clock the spans cover once: overlapping waits count once, and nothing before `from`. */
const unionMs = (spans: readonly (readonly [number, number])[], from: number): number => {
    let total = 0
    let reached = from
    for (const [start, end] of spans.filter(([start, end]) => end > start).sort((left, right) => left[0] - right[0])) {
        if (end <= reached) continue
        total += end - Math.max(start, reached)
        reached = end
    }
    return total
}

/**
 * How long, in ms of wall clock between `since` (an ISO time) and `at`, at least one heavy command of a task waited in the queue:
 * a command a verify of the task ran (`withHeavyBound` tags it with the task, its baseline checkout included) or one that ran in
 * the task's own checkout `worktree` (its worker's own checks), finished waits from their `heavy-wait` host events and waits
 * still in the queue from their slot rows. Overlapping waits count once. What a task's budget clock leaves out
 * (harness/budget-ladder.ts): time the host held its work is no time the task spent.
 */
export const taskQueuedMs = (task: string, worktree: string | null, since: string, at: number = Date.now()): number =>
    withGovernor((db) => {
        ensureTables(db)
        const from = Date.parse(since)
        const home = worktree === null ? null : folderKey(worktree)
        const owns = (owner: string | null, cwd: string): boolean => owner === task || (home !== null && cwd !== "" && (folderKey(cwd) === home || folderKey(cwd).startsWith(`${home}/`)))
        const spans: (readonly [number, number])[] = []
        const finished = db.prepare("SELECT at, data_json FROM host_events WHERE kind = 'heavy-wait' AND at >= ?").all(since)
        for (const row of finished) {
            const data = JSON.parse(String(row.data_json)) as { readonly waitedMs?: unknown; readonly task?: unknown; readonly cwd?: unknown }
            if (!owns(typeof data.task === "string" ? data.task : null, typeof data.cwd === "string" ? data.cwd : "")) continue
            const end = Math.min(Date.parse(String(row.at)), at)
            spans.push([Math.max(end - Number(data.waitedMs ?? 0), from), end])
        }
        for (const row of db.prepare("SELECT at, cwd, task FROM heavy_slots WHERE state = 'waiting'").all()) {
            if (owns(typeof row.task === "string" ? row.task : null, String(row.cwd))) spans.push([Math.max(Date.parse(String(row.at)), from), at])
        }
        return unionMs(spans, from)
    })

/** What one governed command is judged on: the heavy rules and the RAM free now. The host's, or a spec's. */
export interface Governed {
    readonly rules: HeavyRules
    readonly freeMb: () => number
}

const liveHost = (): Governed => ({ rules: loadHeavyRules(), freeMb: () => Math.floor(freemem() / 1_048_576) })

/** How often a waiting command prints its position, so a hook that waits does not look hung. */
const WAIT_LINE_MS = 60_000

/** Whether this process runs on a CI runner: one job on its own machine, so no other command shares its RAM and no queue is kept. */
const onCiRunner = (): boolean => process.env.CI === "true" || process.env.CI === "1"

/**
 * The line a waiting command prints: its place in the first come, first served queue, the MB it needs against the room, and who holds what
 * (each running command's plan and how long ago it was admitted). Waiting holds nothing.
 */
export const waitLine = (label: string, place: number, needMb: number, load: Pick<HostLoad, "freeMb" | "reserveMb" | "committedMb" | "roomMb" | "reason">, holders: readonly string[]): string =>
    `starci: ${label} waits for a heavy-command slot: ${place === 0 ? "first in the queue" : `${String(place)} ahead of it`}, needs ${String(needMb)} MB, room ${String(load.roomMb)} MB (free ${String(load.freeMb)} MB - reserve ${String(load.reserveMb)} MB - ${String(load.committedMb)} MB planned by recent admissions); running: ${holders.join("; ") || "none"}; ${load.reason}`

/** The heap-exhaustion signatures of node and jest in a command's output. */
const HEAP_EXHAUSTED = /heap out of memory|JavaScript heap|ERR_WORKER_OUT_OF_MEMORY|ran out of memory/i

/** The line that names the cause when a command's output shows it ran out of memory: the heap caps it ran under and the RAM free at its admission. Empty otherwise. */
export const oomNote = (output: string, held: Pick<Held, "heapMb" | "freeMb" | "test">): string =>
    HEAP_EXHAUSTED.test(output) && held.heapMb !== undefined
        ? `starci: heap cap ${String(held.heapMb)} MB reached${held.test === undefined ? "" : ` (workers ${String(held.test.workerMb)} MB each)`}; free RAM was ${String(held.freeMb ?? 0)} MB at admission; the caps are in ops/liveness.yaml\n`
        : ""

/** A command's run with the out-of-memory line (`oomNote`) appended to its stderr when it failed; a green run as it is. */
export const withOomNote = <R extends { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }>(run: R, held: Pick<Held, "heapMb" | "freeMb" | "test">): R =>
    run.exitCode === 0 ? run : { ...run, stderr: `${run.stderr}${oomNote(run.stdout + run.stderr, held)}` }

/**
 * Runs one heavy command (tsc, eslint, a test runner, a build, an npm install, a uat container) under a row of the machine-wide queue (`heavy_slots` in
 * machine.sqlite, taken under the store's lock, so admissions are serialised); nothing the harness spawns that is heavy runs any other way (the
 * heavy-sites audit holds it). The command sizes itself greedily to the room now, the RAM free less `reserveMb` and the plan of the commands admitted in
 * the last `plannedSeconds` (`admission`): a test run takes the workers the room holds (`testRunSizing`), any other kind its cap or the room when that is
 * less (`heapFor`). It starts at once when the room covers its least need (`needsOf`), else waits in a first come, first served queue, holding nothing,
 * polls every `heavy.pollSeconds` and prints its place, its need and the running commands every minute; with nothing running it starts on the room there
 * is. A wait is recorded as a `heavy-wait` host event and never fails the command: a coordinator's turn (`refuseHeavyWaits`) is refused HEAVY_DEFERRED at once
 * instead of waiting, and a verify's command (`withHeavyBound`) still in the queue at the verify's bound is refused HOST_HELD, a non-verdict. The child
 * runs below normal priority under its heap caps and inherits HEAVY_PARENTS_ENV with this slot added: a heavy command it starts is admitted on its own,
 * and its ancestors' rows never count against it, so it never waits on them. `options.workers` caps a test run's workers when its caller names a cap. A CI
 * runner keeps no queue: its one job is sized from that runner's own free RAM.
 */
export const withHeavySlot = async <T>(kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>): Promise<T> =>
    governed(liveHost(), kind, label, cwd, options, work)

/** `withHeavySlot` on the given rules and free-RAM reading. */
export const governed = async <T>(host: Governed, kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>): Promise<T> => {
    const { rules } = host
    const owner = heavyOwner()
    const parents = heavyParents()
    const slotId = `${String(owner)}-${randomBytes(8).toString("hex")}`
    // The heaps and workers come from the room its admission measures, so the environment is set after it.
    const inherited = options.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""
    const env = { ...options.env, [HEAVY_PARENTS_ENV]: [...parents, slotId].join(",") }
    // The kind's own budget (an install sized for a cold npm ci) replaces the caller's; it runs from the child's spawn, which
    // comes after admission, so time in the queue never counts against it.
    const budget = heavyTimeoutMinutes(rules, kind, options.files)
    const timed = budget === undefined ? options : { ...options, timeoutMs: budget * 60_000 }
    const base: RunOptions = { ...timed, env, priority: constants.priority.PRIORITY_BELOW_NORMAL }
    /** The command sized to `roomMb`: its heap caps in its environment, and what it plans to take. */
    const sized = (roomMb: number): Pick<Held, "test" | "options" | "heapMb"> & { readonly planMb: number } => {
        if (kind === "test") {
            const test = testRunSizing(rules, roomMb, availableParallelism(), options.workers)
            return { test, heapMb: test.parentMb, planMb: test.holdMb, options: { ...base, env: { ...env, ...testRunEnv(test, inherited) } } }
        }
        const heapMb = heapFor(rules, kind, roomMb)
        return { heapMb, planMb: heapMb, options: { ...base, env: { ...env, NODE_OPTIONS: withHeap(inherited, heapMb) } } }
    }
    // A command on a CI runner has no queue: it is sized from the RAM free now less the reserve.
    if (onCiRunner()) {
        const freeMb = host.freeMb()
        return work({ roomMb: null, rules, freeMb, ...sized(freeMb - rules.reserveMb) })
    }
    const task = process.env[TASK_ENV] ?? null
    const needMb = needsOf(rules)[kind]
    const ancestors = new Set(parents)
    const slot = { id: slotId, pid: process.pid, kind, label, cwd, task, mb: needMb }
    const started = Date.now()
    const holdMs = Number(process.env[HOLD_ENV] ?? Number.NaN)
    const admit = async (lastLineAt: number | null): Promise<{ readonly load: HostLoad; readonly waited: boolean }> => {
        // Re-judged at every poll from the RAM free now and the commands admitted lately, so admission follows the host as it frees.
        const tried = tryAcquire(slot, rules, await cpuLoad(rules), host.freeMb(), (roomMb) => sized(roomMb).planMb, ancestors)
        const { load } = tried
        if (tried.holders === null) return { load, waited: lastLineAt !== null }
        if (waitsRefused) {
            release(slot.id)
            throw new Refusal(HEAVY_DEFERRED, `${label} was not admitted at once (${load.reason}) and a coordinator's turn never waits in the heavy queue; it runs detached or on a later turn`)
        }
        if (Number.isFinite(holdMs) && Date.now() - started >= holdMs) {
            release(slot.id)
            withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs: Date.now() - started, pid: process.pid, owner, task, held: true })))
            throw new Refusal(HOST_HELD, `${label} waited ${String(Math.round((Date.now() - started) / 60_000))} min in the heavy queue, past its verify's bound of ${String(Math.round(holdMs / 60_000))} min (${load.reason}): the host held it, nothing judged the work; no verdict, no try spent, it is verified again once the host has room`, EXIT_HOST_HELD)
        }
        const due = lastLineAt === null || Date.now() - lastLineAt >= WAIT_LINE_MS
        if (due) process.stderr.write(`${waitLine(label, tried.place, needMb, load, tried.holders)}\n`)
        await sleep(rules.pollSeconds * 1000)
        return admit(due ? Date.now() : lastLineAt)
    }
    let admitted: { readonly load: HostLoad; readonly waited: boolean }
    try {
        admitted = await admit(null)
    } catch (error: unknown) {
        release(slot.id)
        throw error
    }
    const { load, waited } = admitted
    if (load.shortMb > 0) {
        process.stderr.write(`starci: warning: ${label} is admitted alone with ${String(Math.max(0, load.roomMb))} MB of room (free ${String(load.freeMb)} MB less the ${String(load.reserveMb)} MB reserve) against the ${String(load.roomMb + load.shortMb)} MB it needs, short by ${String(load.shortMb)} MB; nothing else runs, so waiting would free nothing: it runs on that room under its heap caps (a test run with the workers that fit, at least one)\n`)
    }
    if (waited) {
        const waitedMs = Date.now() - started
        withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs, pid: process.pid, owner, task })))
    }
    try {
        const onSpawn = (pid: number): void => {
            setChild(slot.id, pid)
            options.onSpawn?.(pid)
        }
        // The room is the one this admission measured: the RAM free now less the reserve and the plan of the commands admitted lately.
        const run = sized(load.roomMb)
        return await work({ options: { ...run.options, onSpawn }, roomMb: load.roomMb, rules, freeMb: load.freeMb, heapMb: run.heapMb, test: run.test })
    } finally {
        release(slot.id)
    }
}

/**
 * Whether a new worker seat may launch now: free memory at or above `heavy.seatFreeMb` (each agent terminal costs memory). A
 * refused launch is a wait; the task stays queued and a later step launches it.
 */
export const seatRoom = (rules: HeavyRules = loadHeavyRules()): { readonly ok: boolean; readonly freeMb: number; readonly floorMb: number } => {
    const freeMb = Math.floor(freemem() / 1_048_576)
    return { ok: freeMb >= rules.seatFreeMb, freeMb, floorMb: rules.seatFreeMb }
}

/** Megabytes as gigabytes with one decimal ("2.6 GB"), the unit every hold reason speaks in. */
export const gb = (mb: number): string => `${(mb / 1024).toFixed(1).replace(/\.0$/, "")} GB`

/** An ISO time as the short UTC clock a hold reason names ("21:02Z"); the date too when it is not today. */
export const clockOf = (at: string): string => {
    const date = new Date(at)
    if (Number.isNaN(date.getTime())) return at
    const clock = `${date.toISOString().slice(11, 16)}Z`
    return date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) ? clock : `${date.toISOString().slice(0, 10)} ${clock}`
}

/**
 * Why a heavy command of `kind` is not admitted now, in one short clause ("free RAM 2.6 GB below reserve 4 GB"); undefined when it
 * would be admitted. The full arithmetic is `admission(...).reason`.
 */
export const heldWhy = (rules: HeavyRules, load: Pick<HostLoad, "freeMb" | "cpuPercent" | "managedCpuPercent">, running: readonly RunningRow[], kind: HeavyKind): string | undefined => {
    const judged = admission(rules, load.freeMb, load.cpuPercent, running, kind, false, load.managedCpuPercent)
    if (judged.admits) return undefined
    if (judged.cpuHolds) {
        const managed = load.managedCpuPercent
        if (managed !== null && managed < rules.managedCpuFloorPercent) return `CPU ${String(load.cpuPercent)}% is foreign (managed ${String(managed)}%) and its ${String(rules.underForeignPressureSlots)} slots under foreign pressure are in use`
        const managedText = managed === null ? "unknown" : `${String(managed)}%`
        return `CPU ${String(load.cpuPercent)}% above ${String(rules.maxCpuPercent)}% (managed ${managedText})`
    }
    if (running.length >= judged.cap) return `${String(running.length)} running reach the cap of ${String(judged.cap)}`
    if (load.freeMb < rules.reserveMb) return `free RAM ${gb(load.freeMb)} below reserve ${gb(rules.reserveMb)}`
    return `free RAM ${gb(load.freeMb)} less reserve ${gb(rules.reserveMb)} and ${gb(judged.committedMb)} planned by recent admissions leaves no room for ${kind} (${gb(needsOf(rules)[kind])})`
}

/**
 * The room the next heavy command of this process would be sized to now: the free RAM less `reserveMb` and what the commands admitted in the last
 * `plannedSeconds` planned (this process's ancestors aside); on a CI runner the free RAM less the reserve. An app check sizes its parallel children by it.
 */
export const heavyRoomMb = (host: Governed = liveHost()): number => {
    const { rules } = host
    const freeMb = host.freeMb()
    if (onCiRunner()) return freeMb - rules.reserveMb
    const ancestors = new Set(heavyParents())
    const planned = withGovernor((db) => {
        ensureTables(db)
        return runningRows(db, rules, Date.now(), ancestors).reduce((sum, row) => sum + row.mb, 0)
    })
    return freeMb - rules.reserveMb - planned
}

/** The heavy commands running now, from the governor's store (live rows only after `heavySlots`), each with the MB it planned while its admission is recent. */
export const runningHeavyRows = (rules: HeavyRules = loadHeavyRules()): RunningRow[] =>
    withGovernor((db) => {
        ensureTables(db)
        return runningRows(db, rules)
    })

/** A queued task whose worker seat the RAM floor held: since when, last seen, and the memory it was judged on. */
export interface SeatHold {
    readonly task: string
    readonly repo: string
    readonly since: string
    readonly lastAt: string
    readonly freeMb: number
    readonly floorMb: number
}

/** The reason a seat hold reads as: "free RAM 2.6 GB below seat floor 6 GB (since 21:02Z)". */
export const seatHoldWhy = (hold: Pick<SeatHold, "freeMb" | "floorMb" | "since">): string => `free RAM ${gb(hold.freeMb)} below seat floor ${gb(hold.floorMb)} (since ${clockOf(hold.since)})`

/**
 * Records that the seat floor held a task's launch (core/seat/start.ts, SEAT_RAM_LOW): its first hold keeps its time, every later
 * one refreshes the memory it was judged on. The hold ends when the task launches or the floor admits again (`clearSeatHolds`).
 */
export const recordSeatHold = (repo: string, task: string, room: { readonly freeMb: number; readonly floorMb: number }): void => {
    withGovernor((db) => {
        ensureTables(db)
        const at = now()
        db.prepare("INSERT INTO seat_holds (task, repo, since, last_at, free_mb, floor_mb) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (task) DO UPDATE SET last_at = excluded.last_at, free_mb = excluded.free_mb, floor_mb = excluded.floor_mb").run(task, repo.replaceAll("\\", "/"), at, at, room.freeMb, room.floorMb)
    })
}

/** Ends the seat holds of `task`, or every one when no task is named (the floor admits again: nothing it held is held any more). */
export const clearSeatHolds = (task?: string): void => {
    withGovernor((db) => {
        ensureTables(db)
        if (task === undefined) db.prepare("DELETE FROM seat_holds").run()
        else db.prepare("DELETE FROM seat_holds WHERE task = ?").run(task)
    })
}

/** Every open seat hold, oldest first. */
export const seatHolds = (): SeatHold[] =>
    withGovernor((db) => {
        ensureTables(db)
        return db
            .prepare("SELECT * FROM seat_holds ORDER BY since, task")
            .all()
            .map((row) => ({ task: String(row.task), repo: String(row.repo), since: String(row.since), lastAt: String(row.last_at), freeMb: Number(row.free_mb), floorMb: Number(row.floor_mb) }))
    })

/**
 * How long the host has starved the harness's work: since when heavy admission has held a command (its oldest waiting row) and
 * since when the seat floor has held a launch (its oldest seat hold), each null while nothing is held. A seat hold the floor no
 * longer justifies (free memory is back above it) is cleared first.
 */
export interface Starvation {
    readonly admissionSince: string | null
    readonly waiting: number
    readonly seatSince: string | null
    readonly seatHeld: number
}

/** Reads the starvation now (`Starvation`). */
export const starvation = (rules: HeavyRules = loadHeavyRules()): Starvation => {
    if (seatRoom(rules).ok) clearSeatHolds()
    const waiting = heavySlots().filter((slot) => slot.state === "waiting")
    const holds = seatHolds()
    return { admissionSince: waiting.map((slot) => slot.at).sort((left, right) => left.localeCompare(right))[0] ?? null, waiting: waiting.length, seatSince: holds[0]?.since ?? null, seatHeld: holds.length }
}

/**
 * The starvation episode's ticket bookkeeping: `ticketed` when the episode that began at or before `since` already opened its
 * ticket. An episode ends when nothing is held (`endStarvation`), so a new hold after it is a new episode.
 */
export const starvationTicketed = (): string | null =>
    withGovernor((db) => {
        ensureTables(db)
        const row = db.prepare("SELECT ticket FROM host_starvation WHERE id = 1").get()
        return row === undefined || row.ticket === null ? null : String(row.ticket)
    })

/** Records the ticket the starvation episode that began at `since` opened. */
export const markStarvationTicketed = (since: string, ticket: string): void => {
    withGovernor((db) => {
        ensureTables(db)
        db.prepare("INSERT INTO host_starvation (id, since, ticket) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET since = excluded.since, ticket = excluded.ticket").run(since, ticket)
    })
}

/** Ends the starvation episode: nothing is held any more. */
export const endStarvation = (): void => {
    withGovernor((db) => {
        ensureTables(db)
        db.prepare("DELETE FROM host_starvation").run()
    })
}
