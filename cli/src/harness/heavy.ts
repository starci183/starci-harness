import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { availableParallelism, constants, cpus, freemem } from "node:os"
import { basename, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { pidAlive } from "../shared/exec.js"
import type { RunOptions } from "../shared/exec.js"
import { governorStorePath, now } from "./ledger.js"
import { withMachine } from "./machine.js"
import { locateOps } from "./ops.js"

/** What a heavy command is, for its memory cap: a typecheck, a lint, a test or suite run, a build, an npm install, a uat container. */
export type HeavyKind = "tsc" | "eslint" | "test" | "build" | "install" | "uat"

const HEAVY_KINDS = ["tsc", "eslint", "test", "build", "install", "uat"] as const

const heavySchema = z.strictObject({
    reserveMb: z.number().int().nonnegative(),
    maxSlots: z.number().int().positive().optional(),
    maxCpuPercent: z.number().positive().max(100),
    cpuWindowSeconds: z.number().int().positive(),
    pollSeconds: z.number().positive(),
    estimateMb: z.strictObject(Object.fromEntries(HEAVY_KINDS.map((kind) => [kind, z.number().int().positive()])) as Record<HeavyKind, z.ZodNumber>),
    memoryMb: z.strictObject(Object.fromEntries(HEAVY_KINDS.map((kind) => [kind, z.number().int().positive()])) as Record<HeavyKind, z.ZodNumber>),
    timeoutMinutes: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()),
    testWorkers: z.string().regex(/^(?:\d+|\d{1,3}%)$/),
    seatFreeMb: z.number().int().positive(),
    starvedTicketMinutes: z.number().positive(),
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
 * The environment variable a heavy command's children inherit: their own heavy commands run under the slot it holds, so a
 * `starci check run` a command check starts never waits on its own parent's slot.
 */
export const HEAVY_HELD_ENV = "STARCI_HEAVY_HELD"

/**
 * The host's load as admission reads it: free memory, the CPU average over the window, the count cap, the memory the running
 * commands are estimated to hold, and `admitted`, how many heavy commands may run now (the running ones plus how many more of
 * the smallest estimate fit), with why.
 */
export interface HostLoad {
    readonly freeMb: number
    readonly cpuPercent: number
    readonly cap: number
    readonly reserveMb: number
    readonly committedMb: number
    readonly running: number
    readonly admitted: number
    readonly pressure: boolean
    readonly reason: string
}

/** The count cap: floor(logical cores / 2), or `maxSlots` when set lower; at least one. */
export const slotCap = (rules: HeavyRules, cores: number = availableParallelism()): number => Math.max(1, Math.min(Math.floor(cores / 2), rules.maxSlots ?? Number.MAX_SAFE_INTEGER))

/**
 * Dynamic admission from RAM and CPU. A command of `kind` is admitted when the CPU average is at or under its ceiling, fewer than
 * the cap run, and (free RAM - reserveMb) covers the estimates of the running commands plus its own; while nothing runs, one is
 * admitted once free RAM covers its own estimate, so a host under its reserve still makes progress. `running` are the kinds
 * running now. Without a kind, `admits` is judged for the smallest estimate (what `host load` reports).
 */
export const admission = (rules: HeavyRules, freeMb: number, cpuPercent: number, running: readonly string[] = [], kind?: HeavyKind, cores?: number): HostLoad & { readonly admits: boolean } => {
    const cap = slotCap(rules, cores)
    const estimates: Readonly<Record<string, number>> = rules.estimateMb
    // A row of a kind this build does not know (an older or newer CLI) is held at the largest estimate.
    const estimate = (name: string): number => (name in estimates ? (estimates[name] ?? 0) : Math.max(...Object.values(estimates)))
    const committedMb = running.reduce((sum, name) => sum + estimate(name), 0)
    const own = kind === undefined ? Math.min(...Object.values(rules.estimateMb)) : estimate(kind)
    const room = freeMb - rules.reserveMb - committedMb
    const busy = cpuPercent > rules.maxCpuPercent
    const full = running.length >= cap
    const fits = running.length === 0 ? freeMb >= own : room >= own
    const admits = !busy && !full && fits
    const more = busy ? 0 : Math.max(0, Math.min(cap - running.length, running.length === 0 && room < own ? (freeMb >= own ? 1 : 0) : Math.floor(room / own)))
    const admitted = running.length + more
    const reasons = [
        ...(busy ? [`CPU ${String(cpuPercent)}% over ${String(rules.cpuWindowSeconds)} s is above ${String(rules.maxCpuPercent)}%: no new heavy command starts`] : []),
        ...(full ? [`${String(running.length)} running reach the cap of ${String(cap)} (floor(cores / 2)${rules.maxSlots === undefined ? "" : `, maxSlots ${String(rules.maxSlots)}`})`] : []),
        ...(!busy && !full && room < own ? [`free RAM ${String(freeMb)} MB less the reserve ${String(rules.reserveMb)} MB and the ${String(committedMb)} MB the running commands hold is under the reserve for one more (${String(own)} MB)`] : []),
    ]
    const capacity = `${String(admitted)} of cap ${String(cap)} fit: free ${String(freeMb)} MB - reserve ${String(rules.reserveMb)} MB - running ${String(committedMb)} MB = ${String(room)} MB room`
    return { freeMb, cpuPercent, cap, reserveMb: rules.reserveMb, committedMb, running: running.length, admitted, admits, pressure: admitted < cap, reason: reasons.length === 0 ? capacity : `${reasons.join("; ")}; ${capacity}` }
}

/** Runs `work` on the governor's store (ledger.ts governorStorePath), shared by every worktree of the harness. */
const withGovernor = <T>(work: (db: DatabaseSync) => T): T => withMachine(work, governorStorePath())

const TABLES = `
CREATE TABLE IF NOT EXISTS heavy_slots (
  id TEXT PRIMARY KEY, pid INTEGER NOT NULL, child_pid INTEGER, kind TEXT NOT NULL, label TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cpu_samples (at_ms INTEGER NOT NULL, idle REAL NOT NULL, total REAL NOT NULL);
CREATE TABLE IF NOT EXISTS seat_holds (
  task TEXT PRIMARY KEY, repo TEXT NOT NULL, since TEXT NOT NULL, last_at TEXT NOT NULL, free_mb INTEGER NOT NULL, floor_mb INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS host_starvation (id INTEGER PRIMARY KEY CHECK (id = 1), since TEXT NOT NULL, ticket TEXT);
`

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
            db.exec(TABLES)
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

/** The kinds of the heavy commands running now (live processes only). */
const runningKinds = (db: DatabaseSync): string[] => db.prepare("SELECT kind FROM heavy_slots WHERE state = 'running'").all().map((row) => String(row.kind))

/** The host's load now, over the commands running now. */
export const hostLoad = async (rules: HeavyRules = loadHeavyRules()): Promise<HostLoad> => {
    const cpu = await cpuPercent(rules)
    heavySlots()
    const running = withGovernor((db) => runningKinds(db))
    return admission(rules, Math.floor(freemem() / 1_048_576), cpu, running)
}

/** One row of the semaphore: a heavy command running (its child's pid once spawned) or waiting for a slot. */
export interface HeavySlot {
    readonly id: string
    readonly pid: number
    readonly childPid: number | null
    readonly kind: string
    readonly label: string
    readonly cwd: string
    readonly state: "running" | "waiting"
    readonly at: string
}

/** Every slot row of a live process, running first; rows of a process that is gone are dropped on the way. */
export const heavySlots = (): HeavySlot[] =>
    withGovernor((db) => {
        db.exec(TABLES)
        const rows = db.prepare("SELECT * FROM heavy_slots ORDER BY state, at").all()
        const live: HeavySlot[] = []
        for (const row of rows) {
            if (!pidAlive(Number(row.pid))) {
                db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
                continue
            }
            live.push({ id: String(row.id), pid: Number(row.pid), childPid: row.child_pid === null ? null : Number(row.child_pid), kind: String(row.kind), label: String(row.label), cwd: String(row.cwd), state: row.state === "running" ? "running" : "waiting", at: String(row.at) })
        }
        return live
    })

/**
 * One try for a slot, atomically (withMachine runs it under BEGIN IMMEDIATE, so two processes never both take the last room): admission is judged against
 * the commands running at this instant and the free RAM read now; admitted, the row turns running, else it stays (or becomes)
 * a waiting row. The load it was judged on, and the holders when it waits.
 */
const tryAcquire = (slot: Omit<HeavySlot, "childPid" | "state" | "at">, rules: HeavyRules, cpu: number): { readonly load: HostLoad; readonly holders: string[] | null } =>
    withGovernor((db) => {
        db.exec(TABLES)
        for (const row of db.prepare("SELECT id, pid FROM heavy_slots").all()) if (!pidAlive(Number(row.pid))) db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
        const running = db.prepare("SELECT label, pid FROM heavy_slots WHERE state = 'running'").all()
        const load = admission(rules, Math.floor(freemem() / 1_048_576), cpu, runningKinds(db), slot.kind as HeavyKind)
        const state = load.admits ? "running" : "waiting"
        db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, state, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state").run(slot.id, slot.pid, slot.kind, slot.label, slot.cwd, state, now())
        return { load, holders: state === "running" ? null : running.map((row) => `${String(row.label)} (pid ${String(row.pid)})`) }
    })

const setChild = (id: string, pid: number): void => {
    withGovernor((db) => db.prepare("UPDATE heavy_slots SET child_pid = ? WHERE id = ?").run(pid, id))
}

const release = (id: string): void => {
    withGovernor((db) => {
        db.exec(TABLES)
        db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(id)
    })
}

/** The `--max-old-space-size` a node tool of this kind runs under, added to whatever NODE_OPTIONS it inherits. */
const nodeOptions = (rules: HeavyRules, kind: HeavyKind, env: RunOptions["env"]): string => {
    const inherited = env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""
    const kept = inherited.replaceAll(/--max-old-space-size=\d+/g, "").trim()
    return `${kept} --max-old-space-size=${String(rules.memoryMb[kind])}`.trim()
}

/** A heavy command's run options with its slot: the memory cap, below-normal OS priority, the pid hook and HEAVY_HELD_ENV for its children. */
export interface Held {
    readonly options: RunOptions
    readonly pressure: boolean
    readonly rules: HeavyRules
}

/**
 * The worker count a test runner (jest or vitest, named in the argv) runs with: `heavy.testWorkers`, or one under pressure,
 * added as `--maxWorkers` unless the argv sets it already. An argv that names neither is returned as it is.
 */
export const testWorkerArgs = (argv: readonly string[], held: Held): readonly string[] => {
    const runner = argv.some((part) => /^(?:jest|vitest)(?:\.[cm]?js)?$/.test(basename(part)))
    if (!runner || argv.some((part) => part.startsWith("--maxWorkers"))) return argv
    return [...argv, `--maxWorkers=${held.pressure ? "1" : held.rules.testWorkers}`]
}

/**
 * Runs one heavy command (tsc, eslint, a test runner, a build, an npm install, a uat container) under a slot of the host-wide
 * semaphore in machine.sqlite; nothing the harness spawns that is heavy runs any other way (the heavy-sites audit in
 * cli/scripts holds it). Admission reads free memory and the CPU average (`admission`); a command with no slot is a waiting row
 * (`starci host load` shows the queue), polls every `heavy.pollSeconds`, and its wait is printed on stderr and recorded as a
 * `heavy-wait` host event; waiting never fails the command. The child runs below normal priority, a node tool under the kind's
 * `--max-old-space-size`, and inherits HEAVY_HELD_ENV: a process that inherited it already runs under its parent's slot and
 * takes no second one.
 */
export const withHeavySlot = async <T>(kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>): Promise<T> => {
    const rules = loadHeavyRules()
    const env = { ...options.env, [HEAVY_HELD_ENV]: "1", NODE_OPTIONS: nodeOptions(rules, kind, options.env) }
    // The kind's own budget (an install sized for a cold npm ci) replaces the caller's; it runs from the child's spawn, which
    // comes after admission, so time in the queue never counts against it.
    const budget = rules.timeoutMinutes[kind]
    const timed = budget === undefined ? options : { ...options, timeoutMs: budget * 60_000 }
    const base: RunOptions = { ...timed, env, priority: constants.priority.PRIORITY_BELOW_NORMAL }
    if (process.env[HEAVY_HELD_ENV] === "1") return work({ options: base, pressure: false, rules })
    const slot = { id: randomBytes(8).toString("hex"), pid: process.pid, kind, label, cwd }
    const started = Date.now()
    let announced = false
    let load: HostLoad
    for (;;) {
        // Re-judged at every poll from the RAM free now and the commands running now, so admission follows the host as it frees.
        const tried = tryAcquire(slot, rules, await cpuPercent(rules))
        load = tried.load
        if (tried.holders === null) break
        if (!announced) {
            process.stderr.write(`starci: ${label} waits for a heavy-command slot (${load.reason}; running: ${tried.holders.join(", ") || "none"})\n`)
            announced = true
        }
        await sleep(rules.pollSeconds * 1000)
    }
    if (announced) {
        const waitedMs = Date.now() - started
        withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs, pid: process.pid })))
    }
    try {
        return await work({ options: { ...base, onSpawn: (pid) => { setChild(slot.id, pid) } }, pressure: load.pressure, rules })
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
export const heldWhy = (rules: HeavyRules, load: Pick<HostLoad, "freeMb" | "cpuPercent">, running: readonly string[], kind: HeavyKind): string | undefined => {
    const judged = admission(rules, load.freeMb, load.cpuPercent, running, kind)
    if (judged.admits) return undefined
    if (load.cpuPercent > rules.maxCpuPercent) return `CPU ${String(load.cpuPercent)}% above ${String(rules.maxCpuPercent)}%`
    if (running.length >= judged.cap) return `${String(running.length)} running reach the cap of ${String(judged.cap)}`
    if (load.freeMb < rules.reserveMb) return `free RAM ${gb(load.freeMb)} below reserve ${gb(rules.reserveMb)}`
    return `free RAM ${gb(load.freeMb)} less reserve ${gb(rules.reserveMb)} and ${gb(judged.committedMb)} running leaves no room for ${kind} (${gb(rules.estimateMb[kind])})`
}

/** The kinds of the heavy commands running now, from the governor's store (live rows only after `heavySlots`). */
export const runningHeavyKinds = (): string[] =>
    withGovernor((db) => {
        db.exec(TABLES)
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
        db.exec(TABLES)
        const at = now()
        db.prepare("INSERT INTO seat_holds (task, repo, since, last_at, free_mb, floor_mb) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (task) DO UPDATE SET last_at = excluded.last_at, free_mb = excluded.free_mb, floor_mb = excluded.floor_mb").run(task, repo.replaceAll("\\", "/"), at, at, room.freeMb, room.floorMb)
    })
}

/** Ends the seat holds of `task`, or every one when no task is named (the floor admits again: nothing it held is held any more). */
export const clearSeatHolds = (task?: string): void => {
    withGovernor((db) => {
        db.exec(TABLES)
        if (task === undefined) db.prepare("DELETE FROM seat_holds").run()
        else db.prepare("DELETE FROM seat_holds WHERE task = ?").run(task)
    })
}

/** Every open seat hold, oldest first. */
export const seatHolds = (): SeatHold[] =>
    withGovernor((db) => {
        db.exec(TABLES)
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
        db.exec(TABLES)
        const row = db.prepare("SELECT ticket FROM host_starvation WHERE id = 1").get()
        return row === undefined || row.ticket === null ? null : String(row.ticket)
    })

/** Records the ticket the starvation episode that began at `since` opened. */
export const markStarvationTicketed = (since: string, ticket: string): void => {
    withGovernor((db) => {
        db.exec(TABLES)
        db.prepare("INSERT INTO host_starvation (id, since, ticket) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET since = excluded.since, ticket = excluded.ticket").run(since, ticket)
    })
}

/** Ends the starvation episode: nothing is held any more. */
export const endStarvation = (): void => {
    withGovernor((db) => {
        db.exec(TABLES)
        db.prepare("DELETE FROM host_starvation").run()
    })
}
