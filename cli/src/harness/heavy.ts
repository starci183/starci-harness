import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { constants, cpus, freemem } from "node:os"
import { basename, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { pidAlive } from "../shared/exec.js"
import type { RunOptions } from "../shared/exec.js"
import { now } from "./ledger.js"
import { withMachine } from "./machine.js"
import { locateOps } from "./ops.js"

/** What a heavy command is, for its memory cap: a typecheck, a lint, a test or suite run, a build, an npm install, a uat container. */
export type HeavyKind = "tsc" | "eslint" | "test" | "build" | "install" | "uat"

const HEAVY_KINDS = ["tsc", "eslint", "test", "build", "install", "uat"] as const

const heavySchema = z.strictObject({
    slots: z.number().int().positive(),
    lowFreeMb: z.number().int().positive(),
    criticalFreeMb: z.number().int().positive(),
    maxCpuPercent: z.number().positive().max(100),
    cpuWindowSeconds: z.number().int().positive(),
    pollSeconds: z.number().positive(),
    memoryMb: z.strictObject(Object.fromEntries(HEAVY_KINDS.map((kind) => [kind, z.number().int().positive()])) as Record<HeavyKind, z.ZodNumber>),
    testWorkers: z.string().regex(/^(?:\d+|\d{1,3}%)$/),
    seatFreeMb: z.number().int().positive(),
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
    if (parsed.data.heavy.criticalFreeMb > parsed.data.heavy.lowFreeMb) throw new Refusal("OPS_INVALID", `${file}: heavy.criticalFreeMb is above heavy.lowFreeMb`)
    loaded.set(dir, parsed.data.heavy)
    return parsed.data.heavy
}

/**
 * The environment variable a heavy command's children inherit: their own heavy commands run under the slot it holds, so a
 * `starci check run` a command check starts never waits on its own parent's slot.
 */
export const HEAVY_HELD_ENV = "STARCI_HEAVY_HELD"

/** The host's load as admission reads it: free memory, the CPU average over the window, and how many heavy commands it admits. */
export interface HostLoad {
    readonly freeMb: number
    readonly cpuPercent: number
    readonly admitted: number
    readonly pressure: boolean
    readonly reason: string
}

/**
 * How many heavy commands may run at once: none while free memory is under the critical floor or the CPU average is above its
 * ceiling, one under the low floor, else every slot. Pressure is anything below every slot.
 */
export const admission = (rules: HeavyRules, freeMb: number, cpuPercent: number): HostLoad => {
    const at = { freeMb, cpuPercent }
    if (freeMb < rules.criticalFreeMb) return { ...at, admitted: 0, pressure: true, reason: `free RAM ${String(freeMb)} MB is under the critical floor ${String(rules.criticalFreeMb)} MB` }
    if (cpuPercent > rules.maxCpuPercent) return { ...at, admitted: 0, pressure: true, reason: `CPU ${String(cpuPercent)}% over ${String(rules.cpuWindowSeconds)} s is above ${String(rules.maxCpuPercent)}%` }
    if (freeMb < rules.lowFreeMb) return { ...at, admitted: Math.min(1, rules.slots), pressure: true, reason: `free RAM ${String(freeMb)} MB is under the low floor ${String(rules.lowFreeMb)} MB` }
    return { ...at, admitted: rules.slots, pressure: false, reason: "below every threshold" }
}

const TABLES = `
CREATE TABLE IF NOT EXISTS heavy_slots (
  id TEXT PRIMARY KEY, pid INTEGER NOT NULL, child_pid INTEGER, kind TEXT NOT NULL, label TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cpu_samples (at_ms INTEGER NOT NULL, idle REAL NOT NULL, total REAL NOT NULL);
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
        withMachine((db) => {
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

/** The host's load now. */
export const hostLoad = async (rules: HeavyRules = loadHeavyRules()): Promise<HostLoad> => admission(rules, Math.floor(freemem() / 1_048_576), await cpuPercent(rules))

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
    withMachine((db) => {
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

/** One try for a slot, atomically: admitted, the row turns running; else it stays (or becomes) a waiting row. Null when admitted, else the holders. */
const tryAcquire = (slot: Omit<HeavySlot, "childPid" | "state" | "at">, allowed: number): string[] | null =>
    withMachine((db) => {
        db.exec(TABLES)
        for (const row of db.prepare("SELECT id, pid FROM heavy_slots").all()) if (!pidAlive(Number(row.pid))) db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
        const running = db.prepare("SELECT label, pid FROM heavy_slots WHERE state = 'running'").all()
        const state = running.length < allowed ? "running" : "waiting"
        db.prepare("INSERT INTO heavy_slots (id, pid, kind, label, cwd, state, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state").run(slot.id, slot.pid, slot.kind, slot.label, slot.cwd, state, now())
        return state === "running" ? null : running.map((row) => `${String(row.label)} (pid ${String(row.pid)})`)
    })

const setChild = (id: string, pid: number): void => {
    withMachine((db) => db.prepare("UPDATE heavy_slots SET child_pid = ? WHERE id = ?").run(pid, id))
}

const release = (id: string): void => {
    withMachine((db) => {
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
    const base: RunOptions = { ...options, env, priority: constants.priority.PRIORITY_BELOW_NORMAL }
    if (process.env[HEAVY_HELD_ENV] === "1") return work({ options: base, pressure: false, rules })
    const slot = { id: randomBytes(8).toString("hex"), pid: process.pid, kind, label, cwd }
    const started = Date.now()
    let announced = false
    let load: HostLoad
    for (;;) {
        load = await hostLoad(rules)
        const holders = tryAcquire(slot, load.admitted)
        if (holders === null) break
        if (!announced) {
            process.stderr.write(`starci: ${label} waits for a heavy-command slot (${String(load.admitted)} admitted: ${load.reason}; running: ${holders.join(", ") || "none"})\n`)
            announced = true
        }
        await sleep(rules.pollSeconds * 1000)
    }
    if (announced) {
        const waitedMs = Date.now() - started
        withMachine((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs, pid: process.pid })))
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
