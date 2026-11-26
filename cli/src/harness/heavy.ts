import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { availableParallelism, constants, freemem, tmpdir, totalmem } from "node:os"
import { basename, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { EXIT_HOST_HELD, Refusal } from "../shared/errors.js"
import { killPidTree, pidAlive } from "../shared/exec.js"
import type { RunOptions } from "../shared/exec.js"
import { floorsHeld, readFloors } from "./host-floors.js"
import { readHostSettings } from "./host-settings.js"
import type { HostSettings } from "./host-settings.js"
import { legacyGovernorPath, now } from "./ledger.js"
import { withMachine } from "./machine.js"
import { logEvent, selfStartMs } from "./slot-store.js"
import { DatabaseSync as Sqlite } from "node:sqlite"
import { assertNotRemoving } from "./remove-lock.js"
import { locateOps } from "./ops.js"
import { trimEndChars } from "../shared/trim.js"

/**
 * What a heavy command is, for its memory cap (a process limit, never admission): a typecheck, a lint, a test or suite run, a build of a package or a script (`build`), an
 * app's own build that @starci/hfs asks for (`appBuild`: the api and web builds of `app stack`, a compose build, the CI-parity build of `app check`, the
 * Sonar scan), an npm install, a uat container.
 */
export type HeavyKind = "tsc" | "eslint" | "test" | "build" | "appBuild" | "install" | "uat"

const HEAVY_KINDS = ["tsc", "eslint", "test", "build", "appBuild", "install", "uat"] as const

/** The host's free RAM in MB: shown (`host load`, an out-of-memory note), never judged; no admission reads it. */
export const hostFreeMb = (): number => Math.floor(freemem() / 1_048_576)

/** The kinds whose one process has a heap cap of its own (`heavy.caps`); a test run's parent and workers have theirs in `heavy.testRun`. */
const FIXED_KINDS = ["tsc", "eslint", "build", "appBuild", "install", "uat"] as const
type FixedKind = (typeof FIXED_KINDS)[number]

const heavySchema = z.strictObject({
    diskFloorMb: z.number().int().nonnegative(),
    /** The free space under which `lane gate` warns and lists the landed worktrees that can be removed (harness/disk-warning.ts); default 50 GB, never under the floor. */
    diskWarnMb: z.number().int().nonnegative().optional(),
    pollSeconds: z.number().positive(),
    caps: z.strictObject(Object.fromEntries(FIXED_KINDS.map((kind) => [kind, z.strictObject({ capMb: z.number().int().positive() })])) as Record<FixedKind, z.ZodObject<{ capMb: z.ZodNumber }, z.core.$strict>>),
    timeoutMinutes: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()),
    timeoutMinutesPer1000Files: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()).optional(),
    testWorkers: z.string().regex(/^(?:\d+|\d{1,3}%)$/),
    testRun: z.strictObject({ parentMb: z.number().int().positive(), workerMb: z.number().int().positive() }),
    starvedTicketMinutes: z.number().positive(),
    bootProofTimeoutSeconds: z.number().int().positive(),
    scannerCpuPercent: z.number().positive(),
    plan: z.strictObject({
        parent: z.strictObject({ baseMb: z.number().positive(), perRecordMb: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive() }),
        lintChunk: z.strictObject({ files: z.number().int().positive() }),
    }).optional(),
})

/** The `heavy` block of ops/liveness.yaml: the disk floor, each kind's heap cap (process limits), the timeouts and the poll. The slot count is the host's (`hostSlots`). */
export type HeavyRules = z.infer<typeof heavySchema>

const loaded = new Map<string, HeavyRules>()

/** Loads and validates the `heavy` block of ops/liveness.yaml (STARCI_OPS_DIR honoured); read once per process. */
export const loadHeavyRules = (dir: string = locateOps()): HeavyRules => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const rules = readHeavyRules(dir)
    loaded.set(dir, rules)
    return rules
}

/** Reads and validates the `heavy` block of ops/liveness.yaml now, never from the cache of `loadHeavyRules`. */
export const readHeavyRules = (dir: string = locateOps()): HeavyRules => {
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = z.looseObject({ heavy: heavySchema }).safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} heavy block is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data.heavy
}

/**
 * The disk floor this host keeps and where it is set: config.yaml `host.diskFloorMb` (harness/host-settings.ts), the one machine-level place every CLI copy
 * reads, else the `heavy.diskFloorMb` default of ops/liveness.yaml. Pure over the settings it is handed.
 */
export const diskFloorOf = (rules: Pick<HeavyRules, "diskFloorMb">, settings: Pick<HostSettings, "diskFloorMb" | "source">): { readonly diskFloorMb: number; readonly source: string } =>
    settings.diskFloorMb === undefined ? { diskFloorMb: rules.diskFloorMb, source: "heavy.diskFloorMb (ops/liveness.yaml)" } : { diskFloorMb: settings.diskFloorMb, source: `host.diskFloorMb (${settings.source})` }

/**
 * The heavy rules as they stand now: ops/liveness.yaml read again and the host's disk floor laid over it (`diskFloorOf`). A waiting command judges every
 * admission attempt on these, so a floor or a cap the owner changes reaches a command already in the queue. A read that fails keeps `last`.
 */
export const currentHeavyRules = (last: HeavyRules, read: () => HeavyRules = readHeavyRules, settings: () => Pick<HostSettings, "diskFloorMb" | "source"> = readHostSettings): HeavyRules & { readonly diskFloorSource: string } => {
    let rules = last
    try {
        rules = read()
    } catch {
        // ops/liveness.yaml mid-write or gone: the rules of the last attempt stand.
    }
    let floor = { diskFloorMb: rules.diskFloorMb, source: "heavy.diskFloorMb (ops/liveness.yaml)" }
    try {
        floor = diskFloorOf(rules, settings())
    } catch {
        // config.yaml unreadable this instant: the liveness default stands for this attempt.
    }
    return { ...rules, diskFloorMb: floor.diskFloorMb, diskFloorSource: floor.source }
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
 * The host's heavy-command load: `cap` slots (one per `gbPerSlot` GB of the host's physical RAM, `hostSlots`), the slots the running commands hold
 * (`used`, one each), the host floors held now (the free disk under the disk floor), the slots free now and why, and `pressure` when a new command may
 * not start. The free RAM is shown, never judged.
 */
export interface HostLoad {
    readonly freeMb: number
    readonly cap: number
    readonly used: number
    readonly floors: readonly string[]
    /** The slots a new command may take now: none while a floor holds. */
    readonly free: number
    readonly pressure: boolean
    readonly reason: string
}

/** The GB of physical RAM a slot stands for when config.yaml sets no `heavy.gbPerSlot`: 64 GB is 16 slots, 128 GB is 32. */
export const DEFAULT_GB_PER_SLOT = 4

/**
 * The slots of a host, the owner's rule: one per `gbPerSlot` GB of its physical RAM, at least one, never a fixed number. The RAM is counted in whole GB
 * as installed: the OS reports 64 GB less what the firmware and GPU reserve (about 63.8 GB), which must still be 64. Pure.
 */
export const slotsOf = (totalMb: number, gbPerSlot: number = DEFAULT_GB_PER_SLOT): number => Math.max(1, Math.floor(Math.round(totalMb / 1024) / gbPerSlot))

let hostSlotCount: { readonly slots: number; readonly gbPerSlot: number; readonly source: string } | undefined

/**
 * This host's slots, computed once per process: its physical RAM over `heavy.gbPerSlot` of the host's config.yaml (harness/host-settings.ts), else
 * DEFAULT_GB_PER_SLOT. A config.yaml that cannot be read (a damaged file) leaves the default and says so in `source`.
 */
export const hostSlots = (): { readonly slots: number; readonly gbPerSlot: number; readonly source: string } => {
    if (hostSlotCount !== undefined) return hostSlotCount
    let gbPerSlot = DEFAULT_GB_PER_SLOT
    let source = "default"
    try {
        const settings = readHostSettings()
        if (settings.gbPerSlot !== undefined) {
            gbPerSlot = settings.gbPerSlot
            source = `heavy.gbPerSlot (${settings.source})`
        }
    } catch (error: unknown) {
        source = `default (config.yaml unreadable: ${error instanceof Error ? error.message : String(error)})`
    }
    hostSlotCount = { slots: slotsOf(Math.floor(totalmem() / 1_048_576), gbPerSlot), gbPerSlot, source }
    return hostSlotCount
}

/** What one admission is judged on: the slots of the host, the slots in use, the command's name, the floors held, the free RAM shown. */
export interface Judged {
    readonly slots: number
    readonly used: number
    readonly what?: string
    readonly floors?: readonly string[]
    readonly freeMb?: number
}

/**
 * Admission, the owner's rule: a heavy command takes ONE slot and starts when a slot is free (`used < slots`) and no disk floor holds; it gives the slot
 * back when it ends. Nothing else decides it: no free RAM, no commit, no weight, no reserve, no CPU rule. A gate that runs several in turn takes one for
 * each step as it starts; a running web or api server takes none. Pure.
 */
export const admission = (judged: Judged): HostLoad & { readonly admits: boolean } => {
    const { used, floors = [], freeMb = 0 } = judged
    const cap = Math.max(1, judged.slots)
    const full = used >= cap
    const floored = floors.length > 0
    const inUse = `${String(used)} of ${String(cap)} slots in use`
    const reasons = [...floors, ...(full ? [inUse] : [])]
    return {
        freeMb,
        cap,
        used,
        floors,
        free: floored ? 0 : Math.max(0, cap - used),
        admits: !floored && !full,
        pressure: floored || full,
        reason: reasons.length === 0 ? inUse : reasons.join("; "),
    }
}

/** Runs `work` on the host store (machine.sqlite, ledger.ts machinePath), the one every checkout and installed CLI of the host resolves. */
const withGovernor = <T>(work: (db: DatabaseSync) => T): T => withMachine(work)

const TABLES = `
CREATE TABLE IF NOT EXISTS heavy_slots (
  id TEXT PRIMARY KEY, pid INTEGER NOT NULL, child_pid INTEGER, kind TEXT NOT NULL, label TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS host_starvation (id INTEGER PRIMARY KEY CHECK (id = 1), since TEXT NOT NULL, ticket TEXT);
`

/**
 * Creates the governor's tables, adding the columns a store made before them lacks. `weight` is no rule of this copy: every row is one slot, and the
 * column is written 1 only so an older CLI copy still running on the host, which sums it, counts each of this copy's rows as one.
 */
const ensureTables = (db: DatabaseSync): void => {
    db.exec(TABLES)
    const columns = db.prepare("PRAGMA table_info(heavy_slots)").all().map((column) => column.name)
    if (!columns.includes("task")) db.exec("ALTER TABLE heavy_slots ADD COLUMN task TEXT")
    if (!columns.includes("weight")) db.exec("ALTER TABLE heavy_slots ADD COLUMN weight INTEGER")
    // The OS start of the holder and of its child, so a kill (`killHeavySlot`) can prove a pid is still the process that took the row.
    if (!columns.includes("pid_start")) db.exec("ALTER TABLE heavy_slots ADD COLUMN pid_start TEXT")
    if (!columns.includes("child_start")) db.exec("ALTER TABLE heavy_slots ADD COLUMN child_start TEXT")
}

/** A heavy_slots row as a slot. */
const slotOf = (row: Record<string, unknown>, source: HeavySlot["source"] = "store"): HeavySlot => ({
    id: String(row.id),
    pid: Number(row.pid),
    pidStart: typeof row.pid_start === "string" ? row.pid_start : null,
    childPid: row.child_pid === null || row.child_pid === undefined ? null : Number(row.child_pid),
    childStart: typeof row.child_start === "string" ? row.child_start : null,
    kind: String(row.kind),
    label: String(row.label),
    cwd: String(row.cwd),
    task: typeof row.task === "string" ? row.task : null,
    state: row.state === "running" ? "running" : "waiting",
    at: String(row.at),
    source,
})

/**
 * The running rows of a CLI copy older than the host store (its own `governor.sqlite`, ledger.ts legacyGovernorPath) whose pid is alive, read only: they
 * are foreign, never written, and each holds one slot until its command ends and its copy deletes it.
 */
export const legacyHeavyRows = (file: string | undefined = legacyGovernorPath()): HeavySlot[] => {
    if (file === undefined || !existsSync(file)) return []
    try {
        const db = new Sqlite(file, { readOnly: true, timeout: 5000 })
        try {
            if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'heavy_slots'").get() === undefined) return []
            return db
                .prepare("SELECT * FROM heavy_slots WHERE state = 'running' ORDER BY at")
                .all()
                .filter((row) => pidAlive(Number(row.pid)))
                .map((row) => slotOf(row, "foreign"))
        } finally {
            db.close()
        }
    } catch {
        return []
    }
}

/** The slots the running commands (live rows, an older copy's included) hold, but the `except` ones (the caller's ancestors, which wait on it): one each. */
const inUse = (db: DatabaseSync, except: ReadonlySet<string> = new Set()): number => {
    const rows = db.prepare("SELECT id FROM heavy_slots WHERE state = 'running'").all().filter((row) => !except.has(String(row.id)))
    return rows.length + legacyHeavyRows().filter((row) => !except.has(row.id)).length
}

/** The host's load now: the slots in use against the host's slots, and the floors held for work in the current folder. */
export const hostLoad = (rules: HeavyRules = loadHeavyRules(), slots: number = hostSlots().slots): HostLoad => {
    heavySlots()
    const used = withGovernor((db) => inUse(db))
    return admission({ slots, used, floors: heavyFloors(rules, process.cwd()), freeMb: hostFreeMb() })
}

/** The waiting rows in the order the governor serves them: first come, first served (the order they joined the queue). */
const servingOrder = (rows: readonly { readonly id: string; readonly kind: string; readonly state: string }[]): { readonly id: string; readonly kind: string }[] => rows.filter((row) => row.state === "waiting")

/** One row of the semaphore: a heavy command running (its child's pid once spawned) or waiting for its slot. */
export interface HeavySlot {
    readonly id: string
    /** The process that holds the row (the CLI that runs the command) and its OS start; null on a row an older copy wrote. */
    readonly pid: number
    readonly pidStart: string | null
    /** The heavy command itself, once spawned, and when: the process the row maps to, which `killHeavySlot` kills. */
    readonly childPid: number | null
    readonly childStart: string | null
    /** store: a row of machine.sqlite; foreign: a live row of an older copy's governor.sqlite, counted, never written. */
    readonly source: "store" | "foreign"
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
                dropDead(db, row, `pid ${String(process.pid)}`)
                continue
            }
            live.push(slotOf(row))
        }
        return live
    })

/**
 * One try for a slot, atomically (withMachine runs it under BEGIN IMMEDIATE, so two processes never both take the last slot). The row joins the queue
 * (keeping its place), and the queue is first come, first served (`servingOrder`): only the head may start, and it starts when `admission` finds one of
 * the host's `slots` free at this instant. The rows of the caller's ancestors (`parents`) are not counted: they wait on it. The load it was judged on,
 * and the holders when it waits.
 */
const tryAcquire = (
    slot: Pick<HeavySlot, "id" | "pid" | "pidStart" | "kind" | "label" | "cwd" | "task">,
    slots: number,
    freeMb: number,
    parents: ReadonlySet<string> = new Set(),
    floors: readonly string[] = [],
): { readonly load: HostLoad; readonly holders: string[] | null; readonly place: number } =>
    withGovernor((db) => {
        ensureTables(db)
        for (const row of db.prepare("SELECT id, pid, child_pid, label FROM heavy_slots").all()) if (!pidAlive(Number(row.pid))) dropDead(db, row, `${slot.label} (pid ${String(process.pid)})`)
        // weight 1: only for an older CLI copy still running on the host, which sums the column (ensureTables).
        db.prepare("INSERT INTO heavy_slots (id, pid, pid_start, kind, label, cwd, task, weight, state, at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'waiting', ?) ON CONFLICT (id) DO NOTHING").run(slot.id, slot.pid, slot.pidStart, slot.kind, slot.label, slot.cwd, slot.task, now())
        const rows = db.prepare("SELECT id, kind, state FROM heavy_slots ORDER BY rowid").all().map((row) => ({ id: String(row.id), kind: String(row.kind), state: String(row.state) }))
        const own = db.prepare("SELECT id, label, pid, at FROM heavy_slots WHERE state = 'running'").all().filter((row) => !parents.has(String(row.id)))
        // The live rows of an older CLI copy's own store count too (`legacyHeavyRows`): the host's slots are one pool, whoever runs.
        const foreign = legacyHeavyRows()
            .filter((row) => !parents.has(row.id))
            .map((row) => ({ id: row.id, label: `${row.label} [older copy]`, pid: row.pid, at: row.at }))
        const running: Record<string, unknown>[] = [...own, ...foreign]
        const load = admission({ slots, used: running.length, what: slot.label, floors, freeMb })
        const order = servingOrder(rows)
        if (order[0]?.id !== slot.id || !load.admits) {
            const place = order.findIndex((row) => row.id === slot.id)
            const queued = place <= 0 ? "first in the queue" : `${String(place)} ahead of it in the queue`
            return { load: { ...load, reason: `${load.reason}; ${queued}` }, holders: running.map((row) => `${String(row.label)} (pid ${String(row.pid)}, since ${String(row.at)})`), place: Math.max(0, place) }
        }
        db.prepare("UPDATE heavy_slots SET state = 'running', at = ? WHERE id = ?").run(now(), slot.id)
        return { load, holders: null, place: 0 }
    })

/** Deletes the row of a holder that is gone and logs it (slot_events). */
const dropDead = (db: DatabaseSync, row: Record<string, unknown>, by: string): void => {
    db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(String(row.id))
    const child = row.child_pid === null || row.child_pid === undefined ? null : Number(row.child_pid)
    logEvent(db, { action: "reclaimed", slot: `heavy ${String(row.id)}`, holder: String(row.label), pid: Number(row.pid), childPid: child, command: String(row.label), by, evidence: `dead: pid ${String(row.pid)} is not alive` })
}

const setChild = (id: string, pid: number): void => {
    withGovernor((db) => db.prepare("UPDATE heavy_slots SET child_pid = ?, child_start = ? WHERE id = ?").run(pid, now(), id))
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

/** The heap a node tool of `kind` runs under: its cap (`heavy.caps`), a process limit, never an admission rule. */
export const heapFor = (rules: HeavyRules, kind: FixedKind): number => rules.caps[kind].capMb

/** `inherited` NODE_OPTIONS with its `--max-old-space-size` replaced by `mb`. */
const withHeap = (inherited: string, mb: number): string => `${inherited.replaceAll(/--max-old-space-size=\d+/g, "").trim()} --max-old-space-size=${String(mb)}`.trim()

/**
 * A heavy command's run options with its slot: the heap cap, below-normal OS priority, the pid hook and HEAVY_PARENTS_ENV for its children, and,
 * for a test run, the sizing it runs under.
 */
export interface Held {
    readonly options: RunOptions
    readonly rules: HeavyRules
    /** A test run's parent, workers and worker caps. */
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
 * The size of a test run, fixed by the rules: the jest parent takes `parentMb`, the workers are min(`testWorkers` of the cores, `maxWorkers`), at
 * least one, each with `workerMb` as its heap. `maxWorkers` is a cap its caller names for a run that can use no more (the jest discovery asks for one).
 */
export const testRunSizing = (rules: HeavyRules, cores: number = availableParallelism(), maxWorkers: number = Number.MAX_SAFE_INTEGER): TestRunSizing => {
    const { parentMb, workerMb } = rules.testRun
    const workers = Math.max(1, Math.min(testWorkerCap(rules, cores), maxWorkers))
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
 * The variable naming the workers a test run was admitted with. Jest and vitest get them as `--maxWorkers` (`testWorkerArgs`); a runner the argv does not
 * name (a package's `npm test` running `node --test`) reads it and runs that many spec processes at once, never the cores less one it would take unbounded.
 */
export const TEST_WORKERS_ENV = "STARCI_TEST_WORKERS"

/**
 * The environment a test run's parent takes from its sizing: NODE_OPTIONS with the parent's heap and the preload that gives each worker the worker
 * cap as its heap, STARCI_WORKER_HEAP_MB for it, and TEST_WORKERS_ENV.
 */
export const testRunEnv = (sizing: TestRunSizing, inherited: string, preload: string = workerHeapPreload()): Readonly<Record<string, string>> => ({
    NODE_OPTIONS: `${withHeap(inherited, sizing.parentMb)} --require=${preload}`,
    STARCI_WORKER_HEAP_MB: String(sizing.workerMb),
    [TEST_WORKERS_ENV]: String(sizing.workers),
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

/** What one governed command is judged on: the heavy rules, the host's slots and the floors. The host's, or a spec's. */
export interface Governed {
    readonly rules: HeavyRules
    /** The free RAM in MB, shown in an out-of-memory note; never judged. */
    readonly freeMb: () => number
    /** The host's slots (`hostSlots`: its physical RAM over gbPerSlot); the live host's when absent. */
    readonly slots?: number
    /** The host floors held now for a command working in `cwd` under `rules` (harness/host-floors.ts); none when absent (a spec's host). */
    readonly floors?: (cwd: string, rules: HeavyRules) => string[]
    /** The rules as they stand now, read again at every admission attempt (`currentHeavyRules`); `rules` throughout when absent. */
    readonly reread?: (last: HeavyRules) => HeavyRules
}

/** The host floors held now for work in `cwd`: the free space of its drive under the host's disk floor (`currentHeavyRules`). */
export const heavyFloors = (rules: HeavyRules, cwd: string): string[] => {
    const current = currentHeavyRules(rules, () => rules)
    return floorsHeld({ diskFloorMb: current.diskFloorMb, source: current.diskFloorSource }, readFloors(cwd))
}

const liveHost = (): Governed => {
    const rules = loadHeavyRules()
    return { rules, freeMb: hostFreeMb, slots: hostSlots().slots, reread: (last) => currentHeavyRules(last), floors: (cwd, now) => floorsHeld({ diskFloorMb: now.diskFloorMb, source: (now as { readonly diskFloorSource?: string }).diskFloorSource }, readFloors(cwd)) }
}

/** How often a waiting command prints its position, so a hook that waits does not look hung. */
const WAIT_LINE_MS = 60_000

/** Whether this process runs on a CI runner: one job on its own machine, so no other command shares it and no queue is kept. */
const onCiRunner = (): boolean => process.env.CI === "true" || process.env.CI === "1"

/** The line a waiting command prints: its place in the first come, first served queue, why it waits (every slot in use, or a floor) and who runs. Waiting holds nothing. */
export const waitLine = (label: string, place: number, load: Pick<HostLoad, "cap" | "reason">, holders: readonly string[]): string =>
    `starci: ${label} waits for one of the ${String(load.cap)} heavy-command slots on this host: ${place === 0 ? "first in the queue" : `${String(place)} ahead of it`}; ${load.reason}; running: ${holders.join("; ") || "none"}`

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
 * heavy-sites audit holds it). It holds ONE slot and starts when it heads the queue and a slot is free (`admission`), else waits in a first come, first served queue, holding nothing, polls every `heavy.pollSeconds` and prints its place, why it waits and
 * the running commands every minute. A test run is sized by `testRunSizing`, any other kind runs under its heap cap (`heapFor`). A wait is recorded as a `heavy-wait` host event and never fails the command: a coordinator's turn (`refuseHeavyWaits`) is refused HEAVY_DEFERRED at once
 * instead of waiting, and a verify's command (`withHeavyBound`) still in the queue at the verify's bound is refused HOST_HELD, a non-verdict. The child
 * runs below normal priority under its heap caps and inherits HEAVY_PARENTS_ENV with this slot added: a heavy command it starts is admitted on its own,
 * and its ancestors' rows never count against it, so it never waits on them. `options.workers` caps a test run's workers when its caller names a cap. A CI
 * runner keeps no queue: its one job is sized from that runner's own free RAM.
 */
export const withHeavySlot = async <T>(kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>): Promise<T> => {
    // An install or an npm command writes node_modules and its links: never in a worktree `lane remove` is unlinking (harness/remove-lock.ts).
    if (kind === "install" || kind === "build" || kind === "appBuild") assertNotRemoving(cwd)
    return governed(liveHost(), kind, label, cwd, options, work)
}

/** `withHeavySlot` on the given rules and free-RAM reading. */
export const governed = async <T>(host: Governed, kind: HeavyKind, label: string, cwd: string, options: RunOptions, work: (held: Held) => Promise<T>): Promise<T> => {
    const { rules } = host
    const owner = heavyOwner()
    const parents = heavyParents()
    const slotId = `${String(owner)}-${randomBytes(8).toString("hex")}`
    const inherited = options.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""
    const env = { ...options.env, [HEAVY_PARENTS_ENV]: [...parents, slotId].join(",") }
    // The kind's own budget (an install sized for a cold npm ci) replaces the caller's; it runs from the child's spawn, which
    // comes after admission, so time in the queue never counts against it.
    const budget = heavyTimeoutMinutes(rules, kind, options.files)
    const timed = budget === undefined ? options : { ...options, timeoutMs: budget * 60_000 }
    const base: RunOptions = { ...timed, env, priority: constants.priority.PRIORITY_BELOW_NORMAL }
    // The command's process limits: its heap cap in its environment, or a test run's parent, workers and worker caps.
    const limits = ((): Pick<Held, "test" | "options" | "heapMb"> => {
        if (kind === "test") {
            const test = testRunSizing(rules, availableParallelism(), options.workers)
            return { test, heapMb: test.parentMb, options: { ...base, env: { ...env, ...testRunEnv(test, inherited) } } }
        }
        const heapMb = heapFor(rules, kind)
        return { heapMb, options: { ...base, env: { ...env, NODE_OPTIONS: withHeap(inherited, heapMb) } } }
    })()
    // A command on a CI runner has no queue: its runner runs one job.
    if (onCiRunner()) return work({ rules, freeMb: host.freeMb(), ...limits })
    const task = process.env[TASK_ENV] ?? null
    const ancestors = new Set(parents)
    const slot = { id: slotId, pid: process.pid, pidStart: new Date(selfStartMs()).toISOString(), kind, label, cwd, task }
    const slots = host.slots ?? hostSlots().slots
    const started = Date.now()
    const holdMs = Number(process.env[HOLD_ENV] ?? Number.NaN)
    let live = rules
    const admit = async (lastLineAt: number | null): Promise<{ readonly load: HostLoad; readonly waited: boolean }> => {
        // Re-judged at every poll: the rules as they stand now (the host's disk floor, read again), the slots in use and the floors now.
        live = host.reread?.(live) ?? live
        const tried = tryAcquire(slot, slots, host.freeMb(), ancestors, host.floors?.(cwd, live) ?? [])
        const { load } = tried
        if (tried.holders === null) return { load, waited: lastLineAt !== null }
        if (waitsRefused) {
            release(slot.id)
            throw new Refusal(HEAVY_DEFERRED, `${label} was not admitted at once (${load.reason}) and a coordinator's turn never waits in the heavy queue; it runs detached or on a later turn`)
        }
        if (Number.isFinite(holdMs) && Date.now() - started >= holdMs) {
            release(slot.id)
            withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs: Date.now() - started, pid: process.pid, owner, task, held: true })))
            throw new Refusal(HOST_HELD, `${label} waited ${String(Math.round((Date.now() - started) / 60_000))} min in the heavy queue, past its verify's bound of ${String(Math.round(holdMs / 60_000))} min (${load.reason}): the host held it, nothing judged the work; no verdict, no try spent, it is verified again once a slot frees`, EXIT_HOST_HELD)
        }
        const due = lastLineAt === null || Date.now() - lastLineAt >= WAIT_LINE_MS
        if (due) process.stderr.write(`${waitLine(label, tried.place, load, tried.holders)}\n`)
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
    if (waited) {
        const waitedMs = Date.now() - started
        withGovernor((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, 'heavy-wait', ?, ?)").run(now(), label, JSON.stringify({ kind, cwd, waitedMs, pid: process.pid, owner, task })))
    }
    try {
        const onSpawn = (pid: number): void => {
            setChild(slot.id, pid)
            options.onSpawn?.(pid)
        }
        return await work({ options: { ...limits.options, onSpawn }, rules, freeMb: load.freeMb, heapMb: limits.heapMb, test: limits.test })
    } finally {
        release(slot.id)
    }
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

/** Why a heavy command is not admitted now, in one short clause (every slot in use, or a floor); undefined when it would be admitted. */
export const heldWhy = (used: number, floors: readonly string[] = [], slots: number = hostSlots().slots): string | undefined => {
    const judged = admission({ slots, used, floors })
    return judged.admits ? undefined : judged.reason
}

/**
 * What @starci/hfs reads as the room of an app check's parallel children (`io.heavyRoom`): the slots free now (this process's ancestors aside), at
 * least one, times the eslint heap cap, so it starts as many children as can be admitted at once; each child still takes its own slot. On a CI runner,
 * its one job's free RAM.
 */
export const heavyRoomMb = (host: Governed = liveHost()): number => {
    const { rules } = host
    if (onCiRunner()) return host.freeMb()
    const ancestors = new Set(heavyParents())
    const used = withGovernor((db) => {
        ensureTables(db)
        return inUse(db, ancestors)
    })
    return Math.max(1, (host.slots ?? hostSlots().slots) - used) * rules.caps.eslint.capMb
}

/** The slots the running heavy commands hold now, one each, from the governor's store (live rows only after `heavySlots`). */
export const heavySlotsInUse = (): number =>
    withGovernor((db) => {
        ensureTables(db)
        return inUse(db)
    })

/** How long the host has starved the harness's work: since when heavy admission has held a command (its oldest waiting row), null while nothing waits. */
export interface Starvation {
    readonly admissionSince: string | null
    readonly waiting: number
}

/** Reads the starvation now (`Starvation`). */
export const starvation = (): Starvation => {
    const waiting = heavySlots().filter((slot) => slot.state === "waiting")
    return { admissionSince: waiting.map((slot) => slot.at).sort((left, right) => left.localeCompare(right))[0] ?? null, waiting: waiting.length }
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

/** What a kill of a heavy slot found or did (`killHeavySlot`). */
export interface HeavyKill {
    readonly id: string
    readonly label: string
    readonly pid: number
    readonly childPid: number | null
    /** The process whose tree is (or would be) killed: the heavy command (the child) once spawned, else the row's holder. */
    readonly target: number
    readonly evidence: string
    readonly killed: boolean
    /** The holder was already gone: the row was only reclaimed. */
    readonly reclaimedOnly: boolean
}

/** How far a recorded start may sit from the OS's reading of it and still be the same process (the child's is stamped right after its spawn). */
const START_MATCH_MS = 2000

/**
 * The last resort on a heavy slot (`starci slot kill heavy <id>`): kills the process tree of the heavy command the row maps to (its child, else its
 * holder while nothing is spawned yet) and deletes the row, logged in slot_events. Refused HEAVY_SLOT_UNKNOWN for no such row of the store (a foreign
 * row of an older copy is never touched), SLOT_KILL_UNPROVEN when the row records no start to match, and SLOT_KILL_REUSED when the pid now runs a process
 * started at another time. A holder already gone is not killed: its row is reclaimed. Dry unless `execute`; `startOf`, `alive` and `kill` are seams.
 */
export const killHeavySlot = (
    id: string,
    given: { readonly execute: boolean; readonly by: string; readonly startOf: (pid: number) => number | null; readonly alive?: (pid: number) => boolean; readonly kill?: (pid: number) => boolean },
): HeavyKill => {
    const alive = given.alive ?? pidAlive
    const row = withGovernor((db) => {
        ensureTables(db)
        const found = db.prepare("SELECT * FROM heavy_slots WHERE id = ?").get(id)
        return found === undefined ? undefined : slotOf(found)
    })
    if (row === undefined) throw new Refusal("HEAVY_SLOT_UNKNOWN", `no heavy slot ${id} in the host store (starci slot list heavy); a row of an older copy's governor.sqlite is never touched`)
    const childPid = row.childPid
    const child = childPid !== null && alive(childPid)
    const target = child ? childPid : row.pid
    const recorded = child ? row.childStart : row.pidStart
    const base = { id, label: row.label, pid: row.pid, childPid: row.childPid, target }
    if (!alive(row.pid)) {
        const evidence = `dead: pid ${String(row.pid)} is not alive`
        if (given.execute) {
            withGovernor((db) => {
                dropDead(db, { id, pid: row.pid, child_pid: row.childPid, label: row.label }, `${given.by} (slot kill: nothing left to kill)`)
            })
        }
        return { ...base, evidence, killed: false, reclaimedOnly: given.execute }
    }
    if (recorded === null) throw new Refusal("SLOT_KILL_UNPROVEN", `heavy ${id} (${row.label}) records no start for pid ${String(target)}: it cannot be proven to be the process that took the row`)
    const started = given.startOf(target)
    if (started === null) throw new Refusal("SLOT_KILL_UNPROVEN", `the host does not report the start of pid ${String(target)}: it cannot be proven to be the process of heavy ${id}`)
    if (Math.abs(started - Date.parse(recorded)) > START_MATCH_MS) {
        throw new Refusal("SLOT_KILL_REUSED", `pid ${String(target)} now runs a process started ${new Date(started).toISOString()}, not the one heavy ${id} recorded (${recorded}): nothing is killed`)
    }
    const evidence = `pid ${String(target)} (${child ? "the heavy command" : "its holder"}) alive since ${new Date(started).toISOString()}`
    if (!given.execute) return { ...base, evidence, killed: false, reclaimedOnly: false }
    ;(given.kill ?? killPidTree)(target)
    withGovernor((db) => {
        ensureTables(db)
        db.prepare("DELETE FROM heavy_slots WHERE id = ?").run(id)
        logEvent(db, { action: "killed", slot: `heavy ${id}`, holder: row.label, pid: row.pid, childPid: row.childPid, command: row.label, by: given.by, evidence: `killed the process tree of pid ${String(target)}: ${evidence}` })
    })
    return { ...base, evidence, killed: true, reclaimedOnly: false }
}
