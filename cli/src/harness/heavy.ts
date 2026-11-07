import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { availableParallelism, constants, cpus, freemem, totalmem } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
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

const heavySchema = z.strictObject({
    reserveMb: z.number().int().nonnegative(),
    maxSlots: z.number().int().positive().optional(),
    maxCpuPercent: z.number().positive().max(100),
    cpuWindowSeconds: z.number().int().positive(),
    cpuStarveMinutes: z.number().positive(),
    managedCpuFloorPercent: z.number().nonnegative().max(100),
    underForeignPressureSlots: z.number().int().positive(),
    projectSlots: z.number().int().positive(),
    pollSeconds: z.number().positive(),
    estimateMb: z.strictObject(Object.fromEntries(HEAVY_KINDS.map((kind) => [kind, z.number().int().positive()])) as Record<HeavyKind, z.ZodNumber>),
    memoryMb: z.strictObject(Object.fromEntries(HEAVY_KINDS.map((kind) => [kind, z.number().int().positive()])) as Record<HeavyKind, z.ZodNumber>),
    timeoutMinutes: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()),
    timeoutMinutesPer1000Files: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()).optional(),
    testWorkers: z.string().regex(/^(?:\d+|\d{1,3}%)$/),
    testWorkerMb: z.number().int().positive(),
    seatFreeMb: z.number().int().positive(),
    starvedTicketMinutes: z.number().positive(),
    bootProofTimeoutSeconds: z.number().int().positive(),
    scannerCpuPercent: z.number().positive(),
    plan: z.strictObject({
        parent: z.strictObject({ baseMb: z.number().positive(), perRecordMb: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive() }),
        testParent: z.strictObject({ perSpecMb: z.number().positive(), margin: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive() }),
        testWorker: z.strictObject({ baseMb: z.number().positive(), perSpecMb: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive(), reserveMb: z.number().int().nonnegative() }),
        types: z.strictObject({ baseMb: z.number().positive(), perFileMb: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive() }),
        lintChunk: z.strictObject({ files: z.number().int().positive(), min: z.number().int().positive(), max: z.number().int().positive() }),
        learnAbovePercent: z.number().positive(),
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
    // Admission holds what a test run's parent may grow to: its heap ceiling, so a coverage run admitted is never one the host cannot hold.
    const { estimateMb, memoryMb } = parsed.data.heavy
    if (estimateMb.test !== memoryMb.test) throw new Refusal("OPS_INVALID", `${file} heavy block is invalid: estimateMb.test ${String(estimateMb.test)} differs from memoryMb.test ${String(memoryMb.test)}; admission holds a test run's parent at its heap ceiling`)
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
 * The environment variable a heavy command's children inherit: their own heavy commands run under the slot it holds, so a
 * `starci check run` a command check starts never waits on its own parent's slot.
 */
export const HEAVY_HELD_ENV = "STARCI_HEAVY_HELD"

/**
 * The host's load as admission reads it: free memory, the CPU average over the window, the share of it the governor's own running
 * commands burn (`managedCpuPercent`, read only while the CPU is above its ceiling, null otherwise or when the process table
 * cannot be read), the CPU rule that applied (`cpuRule`, null under the ceiling), the count cap, the memory the running commands
 * are estimated to hold, `roomMb` (free RAM less the reserve and what the running commands hold), and `admitted`, how many heavy
 * commands may run now (the running ones plus how many more of the smallest estimate fit), with why, and `shortMb`, the MB of its own
 * estimate the room lacks while nothing else runs (0 otherwise). `pressure` is true when no
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

/**
 * Dynamic admission from RAM and CPU. A command of `kind` is admitted when the CPU lets one more start (at or under its ceiling;
 * above it, the rule `cpuRuleOf` names from `managedCpu`, the share the governor's own running commands burn), fewer than the
 * cap run, and (free RAM - reserveMb) covers the estimates of the running commands plus its own; while nothing runs, one is
 * admitted whatever its estimate: no running command will release memory, so waiting could not help (an estimate is an estimate, a
 * learned factor can overshoot, and a host under its reserve or a small one still makes progress). `shortMb` is how much of its
 * estimate the room lacks while it is admitted alone; the caller sizes the command to the room and says so. The CPU never lifts a RAM
 * rule. `running` are the kinds running now. Without a kind, `admits` is judged for the smallest estimate (what `host load`
 * reports). `starved` (the queue admitted nothing for cpuStarveMinutes, `starvedQueue`) lets one command start under a hot
 * CPU: high CPU slows the queue, it never stops it.
 */
export const admission = (rules: HeavyRules, freeMb: number, cpuPercent: number, running: readonly RunningRow[] = [], kind?: HeavyKind, starved = false, managedCpu: number | null = null, ownMb?: number): HostLoad & { readonly admits: boolean; readonly cpuHolds: boolean } => {
    const cap = slotCap(rules)
    const estimates: Readonly<Record<string, number>> = rules.estimateMb
    // A row of a kind this build does not know (an older or newer CLI) is held at the largest estimate.
    const estimate = (name: string): number => (name in estimates ? (estimates[name] ?? 0) : Math.max(...Object.values(estimates)))
    // A row the memory plan sized holds its planned MB (memory-plan.ts), any other its kind's estimate.
    const committedMb = running.reduce((sum, row) => sum + (typeof row === "string" ? estimate(row) : row.mb), 0)
    const own = ownMb ?? (kind === undefined ? Math.min(...Object.values(rules.estimateMb)) : estimate(kind))
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
        ...(!cpuHolds && !full && !fits ? [`free RAM ${String(freeMb)} MB less the reserve ${String(rules.reserveMb)} MB and the ${String(committedMb)} MB the running commands hold is under the reserve for one more (${String(own)} MB)`] : []),
    ]
    const capacity = `${String(admitted)} of cap ${String(cap)} fit: free ${String(freeMb)} MB - reserve ${String(rules.reserveMb)} MB - running ${String(committedMb)} MB = ${String(room)} MB room`
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
    // The MB the memory plan holds for the row (memory-plan.ts); null for a row sized by its kind's estimate.
    if (!columns.includes("mb")) db.exec("ALTER TABLE heavy_slots ADD COLUMN mb INTEGER")
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

/** A running heavy command as admission counts it: its kind, or its kind and the MB its memory plan holds for it. */
export type RunningRow = string | { readonly kind: string; readonly mb: number }

/** The heavy commands running now (live processes only), each at its planned MB when the memory plan sized it. */
const runningRows = (db: DatabaseSync): RunningRow[] =>
    db.prepare("SELECT kind, mb FROM heavy_slots WHERE state = 'running'").all().map((row) => (typeof row.mb === "number" && row.mb > 0 ? { kind: String(row.kind), mb: row.mb } : String(row.kind)))

/** The kinds of the heavy commands running now (live processes only). */
const runningKinds = (db: DatabaseSync): string[] => runningRows(db).map((row) => (typeof row === "string" ? row : row.kind))

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
    const { running, starved } = withGovernor((db) => ({ running: runningRows(db), starved: starvedQueue(db, rules) }))
    return admission(rules, Math.floor(freemem() / 1_048_576), cpu, running, undefined, starved, managed)
}

const repositoryKeys = new Map<string, string>()

/**
 * The repository a heavy command's folder belongs to, for the per-project fairness cap: the folder holding `.git`, or for a
 * linked worktree (a `.git` file naming `<main>/.git/worktrees/<name>`) its main checkout; a folder in no repository is its own.
 */
export const repositoryKeyOf = (cwd: string): string => {
    const known = repositoryKeys.get(cwd)
    if (known !== undefined) return known
    const walk = (dir: string): string => {
        const dotGit = join(dir, ".git")
        if (existsSync(dotGit)) {
            if (statSync(dotGit).isDirectory()) return dir
            const gitdir = /^gitdir:\s*(\S.*)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim().replaceAll("\\", "/")
            return (gitdir === undefined ? undefined : /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir)?.[1]) ?? dir
        }
        const parent = dirname(dir)
        return parent === dir ? cwd : walk(parent)
    }
    const key = resolve(walk(resolve(cwd))).replaceAll("\\", "/").toLowerCase()
    repositoryKeys.set(cwd, key)
    return key
}

/**
 * The waiting rows in the order the governor serves them: a project with fewer commands running first, then by age (the
 * oldest wait first); a project already running projectSlots commands while another project waits is passed over.
 */
const servingOrder = (rows: readonly { readonly id: string; readonly kind: string; readonly cwd: string; readonly state: string; readonly at: string }[], rules: HeavyRules): { readonly id: string; readonly kind: string }[] => {
    const runningBy = new Map<string, number>()
    for (const row of rows) if (row.state === "running") runningBy.set(repositoryKeyOf(row.cwd), (runningBy.get(repositoryKeyOf(row.cwd)) ?? 0) + 1)
    const waiting = rows.filter((row) => row.state === "waiting").map((row) => ({ ...row, project: repositoryKeyOf(row.cwd) }))
    const held = (project: string): number => runningBy.get(project) ?? 0
    // The cap passes a project over only for another that is under it; when every waiting project is at its cap, none is held back.
    const open = waiting.some((row) => held(row.project) < rules.projectSlots)
    return waiting
        .filter((row) => !open || held(row.project) < rules.projectSlots)
        .sort((a, b) => held(a.project) - held(b.project) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

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
 * row joins the queue (keeping the time it first waited), and the queue is served in `servingOrder`: the first waiting row that
 * admission admits now, against the commands running at this instant and the free RAM read now, is the one that may start; this
 * row turns running only when it is that one. Above the CPU ceiling the rule `cpuRuleOf` names from `cpu.managed` applies: a
 * foreign load leaves underForeignPressureSlots open, the harness's own holds the queue until it is starved (`starvedQueue`) and
 * then admits the first fitting row alone. The load it was judged on, and the holders when it waits.
 */
const tryAcquire = (slot: Omit<HeavySlot, "childPid" | "state" | "at"> & { readonly mb?: number | undefined }, rules: HeavyRules, cpu: { readonly cpu: number; readonly managed: number | null }): { readonly load: HostLoad; readonly holders: string[] | null } =>
    withGovernor((db) => {
        ensureTables(db)
        for (const row of db.prepare("SELECT id, pid FROM heavy_slots").all()) if (!pidAlive(Number(row.pid))) db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
        db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, task, state, at, mb) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?) ON CONFLICT (id) DO NOTHING").run(slot.id, slot.pid, slot.kind, slot.label, slot.cwd, slot.task, now(), slot.mb ?? null)
        const rows = db.prepare("SELECT id, kind, cwd, state, at, mb FROM heavy_slots").all().map((row) => ({ id: String(row.id), kind: String(row.kind), cwd: String(row.cwd), state: String(row.state), at: String(row.at), mb: typeof row.mb === "number" && row.mb > 0 ? row.mb : undefined }))
        const running = db.prepare("SELECT label, pid FROM heavy_slots WHERE state = 'running'").all()
        const held = runningRows(db)
        const freeMb = Math.floor(freemem() / 1_048_576)
        const starved = starvedQueue(db, rules)
        const plannedOf = new Map(rows.map((row) => [row.id, row.mb] as const))
        const judge = (id: string, kind: string): ReturnType<typeof admission> => admission(rules, freeMb, cpu.cpu, held, kind as HeavyKind, starved, cpu.managed, plannedOf.get(id))
        const order = servingOrder(rows, rules)
        const first = order.find((row) => judge(row.id, row.kind).admits)
        const load = judge(slot.id, slot.kind)
        if (first?.id !== slot.id) {
            const place = order.findIndex((row) => row.id === slot.id)
            const queued = place < 0 ? "its project runs projectSlots commands while another project waits" : `${String(place)} ahead of it in the queue`
            return { load: { ...load, reason: `${load.reason}; ${queued}` }, holders: running.map((row) => `${String(row.label)} (pid ${String(row.pid)})`) }
        }
        db.prepare("UPDATE heavy_slots SET state = 'running' WHERE id = ?").run(slot.id)
        db.prepare("INSERT INTO heavy_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(LAST_ADMIT, String(Date.now()))
        return { load, holders: null }
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
 * (`memoryMb.eslint`, as STARCI_ESLINT_HEAP_MB) and the budget of the lite boot proof's worker from its spawn (`bootProofTimeoutSeconds`, as
 * STARCI_BOOT_PROOF_TIMEOUT_MS).
 */
export const hfsLimitsEnv = (rules: HeavyRules = loadHeavyRules()): Readonly<Record<string, string>> => ({
    STARCI_ESLINT_HEAP_MB: String(rules.memoryMb.eslint),
    STARCI_BOOT_PROOF_TIMEOUT_MS: String(rules.bootProofTimeoutSeconds * 1000),
    // The ESLint child's liveness budget (heavyTimeoutMinutes), which the rendered CI's lint job outlasts.
    ...(rules.timeoutMinutes.eslint === undefined ? {} : { STARCI_ESLINT_TIMEOUT_MINUTES: String(rules.timeoutMinutes.eslint) }),
    ...(rules.timeoutMinutesPer1000Files?.eslint === undefined ? {} : { STARCI_ESLINT_MINUTES_PER_1000_FILES: String(rules.timeoutMinutesPer1000Files.eslint) }),
})

/** The `--max-old-space-size` a node tool of this kind runs under, added to whatever NODE_OPTIONS it inherits. */
const nodeOptions = (rules: HeavyRules, kind: HeavyKind, env: RunOptions["env"], plannedMb?: number): string => {
    const inherited = env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""
    const kept = inherited.replaceAll(/--max-old-space-size=\d+/g, "").trim()
    return `${kept} --max-old-space-size=${String(plannedMb ?? rules.memoryMb[kind])}`.trim()
}

/**
 * What the memory plan sized for one child (memory-plan.ts): its heap (`memoryMb`, its --max-old-space-size and what admission holds in place of the
 * kind's estimate) and, for a test runner, what each worker is planned to hold (`workerMb`, held by admission for every worker after the first) and the
 * most workers the plan gives it.
 */
export interface HeavyPlanned {
    readonly memoryMb?: number | undefined
    readonly workerMb?: number | undefined
    readonly workers?: number | undefined
}

/**
 * A heavy command's run options with its slot: the memory cap, below-normal OS priority, the pid hook and HEAVY_HELD_ENV for its
 * children, and `roomMb`, the room admission measured for it (null for a command that runs under its parent's slot).
 */
export interface Held {
    readonly options: RunOptions
    readonly roomMb: number | null
    readonly rules: HeavyRules
    /** What the memory plan sized for it, when a plan was in force. */
    readonly planned?: HeavyPlanned | undefined
}

/** The most workers a test run takes: `heavy.testWorkers`, a count or a percent of the logical cores, at least one. */
export const testWorkerCap = (rules: HeavyRules, cores: number = availableParallelism()): number => {
    const percent = /^(\d{1,3})%$/.exec(rules.testWorkers)?.[1]
    return Math.max(1, percent === undefined ? Number(rules.testWorkers) : Math.floor((cores * Number(percent)) / 100))
}

/**
 * The workers a test run of the room `roomMb` gets: its own estimate (`estimateMb.test`, the parent's heap ceiling) holds the parent and
 * the first worker, and every further `testWorkerMb` of room one more, clamped to 1..testWorkerCap; a run under its parent's slot (null) takes the cap. So a
 * host with room runs wide, a starved one runs one worker, and the count follows the RAM free at admission, never the slot cap.
 */
export const testWorkerCount = (rules: HeavyRules, roomMb: number | null, cores: number = availableParallelism()): number => {
    const cap = testWorkerCap(rules, cores)
    if (roomMb === null) return cap
    const extra = Math.floor(Math.max(0, roomMb - rules.estimateMb.test) / rules.testWorkerMb)
    return Math.min(cap, 1 + extra)
}

/**
 * The workers a planned test run of the room `roomMb` gets: its planned parent heap holds the parent and the first worker, and every
 * further planned worker heap of room one more, clamped to 1..the plan's workers (all of them under a parent's slot, `roomMb` null). The
 * room is the one admission measured at the start, so the count is the most workers that fit; one when not even the parent fits.
 */
export const plannedWorkerCount = (planned: Pick<HeavyPlanned, "memoryMb" | "workerMb" | "workers">, roomMb: number | null): number => {
    const most = Math.max(1, planned.workers ?? 1)
    if (roomMb === null || planned.memoryMb === undefined || planned.workerMb === undefined || planned.workerMb <= 0) return most
    return Math.min(most, 1 + Math.floor(Math.max(0, roomMb - planned.memoryMb) / planned.workerMb))
}

/**
 * The argv of a test runner (jest or vitest, named in the argv) with `--maxWorkers` for the room its slot was admitted with, unless the
 * argv sets it already: the plan's workers that its planned heaps fit in the room (`plannedWorkerCount`), else `testWorkerCount`. An argv
 * that names neither runner is returned as it is.
 */
export const testWorkerArgs = (argv: readonly string[], held: Held): readonly string[] => {
    const runner = argv.some((part) => /^(?:jest|vitest)(?:\.[cm]?js)?$/.test(basename(part)))
    if (!runner || argv.some((part) => part.startsWith("--maxWorkers"))) return argv
    const byRoom = testWorkerCount(held.rules, held.roomMb)
    const workers = held.planned?.workers === undefined ? byRoom : held.planned.workerMb === undefined ? Math.max(1, Math.min(byRoom, held.planned.workers)) : plannedWorkerCount(held.planned, held.roomMb)
    return [...argv, `--maxWorkers=${String(workers)}`]
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

/**
 * Runs one heavy command (tsc, eslint, a test runner, a build, an npm install, a uat container) under a slot of the host-wide
 * semaphore in machine.sqlite; nothing the harness spawns that is heavy runs any other way (the heavy-sites audit in
 * cli/scripts holds it). Admission reads free memory, the CPU average and, above the ceiling, the managed share of it (`cpuLoad`, `admission`); a command with no slot is a waiting row
 * (`starci host load` shows the queue), polls every `heavy.pollSeconds`, and its wait is printed on stderr and recorded as a
 * `heavy-wait` host event. Waiting never fails the command: a coordinator's turn (`refuseHeavyWaits`) is refused HEAVY_DEFERRED
 * at once instead of waiting, and a verify's command (`withHeavyBound`) still in the queue at the verify's bound is refused
 * HOST_HELD, a non-verdict. The child runs below normal priority, a node tool under the kind's
 * `--max-old-space-size`, and inherits HEAVY_HELD_ENV: a process that inherited it already runs under its parent's slot and
 * takes no second one.
 */
export const withHeavySlot = async <T>(kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>, planned?: HeavyPlanned): Promise<T> => {
    const rules = loadHeavyRules()
    // A planned child runs under its planned heap. Jest's workers inherit their parent's heap flags (jest-worker forks with the parent's execArgv and
    // environment), so a worker's planned heap sizes the worker count and what admission holds, never a cap of its own.
    const env = { ...options.env, [HEAVY_HELD_ENV]: "1", NODE_OPTIONS: nodeOptions(rules, kind, options.env, planned?.memoryMb) }
    // The kind's own budget (an install sized for a cold npm ci) replaces the caller's; it runs from the child's spawn, which
    // comes after admission, so time in the queue never counts against it.
    const budget = heavyTimeoutMinutes(rules, kind, options.files)
    const timed = budget === undefined ? options : { ...options, timeoutMs: budget * 60_000 }
    const base: RunOptions = { ...timed, env, priority: constants.priority.PRIORITY_BELOW_NORMAL }
    if (process.env[HEAVY_HELD_ENV] === "1") return work({ options: base, roomMb: null, rules, planned })
    const owner = heavyOwner()
    const task = process.env[TASK_ENV] ?? null
    // A test runner holds its parent and its planned workers; any other planned child its heap.
    const plannedMb = planned?.memoryMb === undefined ? undefined : planned.memoryMb + (planned.workerMb ?? 0) * Math.max(0, (planned.workers ?? 1) - 1)
    const slot = { id: `${String(owner)}-${randomBytes(8).toString("hex")}`, pid: process.pid, kind, label, cwd, task, mb: plannedMb }
    const started = Date.now()
    const holdMs = Number(process.env[HOLD_ENV] ?? Number.NaN)
    const admit = async (announced: boolean): Promise<{ readonly load: HostLoad; readonly announced: boolean }> => {
        // Re-judged at every poll from the RAM free now and the commands running now, so admission follows the host as it frees.
        const tried = tryAcquire(slot, rules, await cpuLoad(rules))
        const { load } = tried
        if (tried.holders === null) return { load, announced }
        if (waitsRefused) {
            release(slot.id)
            throw new Refusal(HEAVY_DEFERRED, `${label} was not admitted at once (${load.reason}) and a coordinator's turn never waits in the heavy queue; it runs detached or on a later turn`)
        }
        if (Number.isFinite(holdMs) && Date.now() - started >= holdMs) {
            release(slot.id)
            withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs: Date.now() - started, pid: process.pid, owner, task, held: true })))
            throw new Refusal(HOST_HELD, `${label} waited ${String(Math.round((Date.now() - started) / 60_000))} min in the heavy queue, past its verify's bound of ${String(Math.round(holdMs / 60_000))} min (${load.reason}): the host held it, nothing judged the work; no verdict, no try spent, it is verified again once the host has room`, EXIT_HOST_HELD)
        }
        if (!announced) {
            process.stderr.write(`starci: ${label} waits for a heavy-command slot (${load.reason}; running: ${tried.holders.join(", ") || "none"})\n`)
        }
        await sleep(rules.pollSeconds * 1000)
        return admit(true)
    }
    const { load, announced } = await admit(false)
    if (load.shortMb > 0) {
        process.stderr.write(`starci: warning: ${label} is admitted alone with ${String(Math.max(0, load.roomMb))} MB of room (free ${String(load.freeMb)} MB less the ${String(load.reserveMb)} MB reserve) against its ${String(load.roomMb + load.shortMb)} MB estimate, short by ${String(load.shortMb)} MB; nothing else runs, so waiting would free nothing: it runs on that room (a test run with the workers that fit, at least one) and the estimate may be high\n`)
    }
    if (announced) {
        const waitedMs = Date.now() - started
        withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs, pid: process.pid, owner, task })))
    }
    try {
        return await work({ options: { ...base, onSpawn: (pid) => { setChild(slot.id, pid); options.onSpawn?.(pid) } }, roomMb: load.roomMb, rules, planned })
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
 * Why a heavy command of `kind` is not admitted now, in one short clause ("free RAM 2.6 GB below reserve 8 GB"); undefined when it
 * would be admitted. The full arithmetic is `admission(...).reason`.
 */
export const heldWhy = (rules: HeavyRules, load: Pick<HostLoad, "freeMb" | "cpuPercent" | "managedCpuPercent">, running: readonly string[], kind: HeavyKind): string | undefined => {
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
    return `free RAM ${gb(load.freeMb)} less reserve ${gb(rules.reserveMb)} and ${gb(judged.committedMb)} running leaves no room for ${kind} (${gb(rules.estimateMb[kind])})`
}

/** The kinds of the heavy commands running now, from the governor's store (live rows only after `heavySlots`). */
export const runningHeavyKinds = (): string[] =>
    withGovernor((db) => {
        ensureTables(db)
        return runningKinds(db)
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
