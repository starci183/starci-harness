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
import { COMMIT_FLOOR_MB, COMMIT_RAMP_SECONDS, commitFloorHeld, floorsHeld, freeCommitMb, readFloors } from "./host-floors.js"
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
 * What a heavy command is, for its memory cap and its weight: a typecheck, a lint, a test or suite run, a build of a package or a script (`build`), an
 * app's own build that @starci/hfs asks for (`appBuild`: the api and web builds of `app stack`, a compose build, the CI-parity build of `app check`, the
 * Sonar scan), an npm install, a uat container.
 */
export type HeavyKind = "tsc" | "eslint" | "test" | "build" | "appBuild" | "install" | "uat"

const HEAVY_KINDS = ["tsc", "eslint", "test", "build", "appBuild", "install", "uat"] as const

/** The memory free for heavy commands, in MB: the free RAM, and on Windows never more than the free commit (`freeCommitMb`). */
export const hostFreeMb = (): number => {
    const ram = Math.floor(freemem() / 1_048_576)
    const commit = freeCommitMb()
    return commit === null ? ram : Math.min(ram, commit)
}

/** The kinds whose one process has a heap cap of its own (`heavy.caps`); a test run's parent and workers have theirs in `heavy.testRun`. */
const FIXED_KINDS = ["tsc", "eslint", "build", "appBuild", "install", "uat"] as const
type FixedKind = (typeof FIXED_KINDS)[number]

const heavySchema = z.strictObject({
    gbPerSlot: z.number().int().positive(),
    diskFloorMb: z.number().int().nonnegative(),
    /** The free space under which `lane gate` warns and lists the landed worktrees that can be removed (harness/disk-warning.ts); default 50 GB, never under the floor. */
    diskWarnMb: z.number().int().nonnegative().optional(),
    pollSeconds: z.number().positive(),
    caps: z.strictObject(Object.fromEntries(FIXED_KINDS.map((kind) => [kind, z.strictObject({ capMb: z.number().int().positive() })])) as Record<FixedKind, z.ZodObject<{ capMb: z.ZodNumber }, z.core.$strict>>),
    timeoutMinutes: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()),
    timeoutMinutesPer1000Files: z.partialRecord(z.enum(HEAVY_KINDS), z.number().positive()).optional(),
    testWorkers: z.string().regex(/^(?:\d+|\d{1,3}%)$/),
    testRun: z.strictObject({ parentMb: z.number().int().positive(), workerMb: z.number().int().positive() }),
    /**
     * The free commit (Windows: the memory the host can still promise, `freeCommitMb`) a heavy command leaves the host: it waits while the free commit, less
     * the planned memory of the commands admitted in the last `commitRampSeconds` and its own, is under this floor. Absent: 8192.
     */
    commitFloorMb: z.number().int().nonnegative().optional(),
    /** How long a just-admitted command counts its planned memory against the free commit, before its own pages show in the reading. Absent: 60. */
    commitRampSeconds: z.number().nonnegative().optional(),
    seatFreeMb: z.number().int().positive(),
    starvedTicketMinutes: z.number().positive(),
    bootProofTimeoutSeconds: z.number().int().positive(),
    scannerCpuPercent: z.number().positive(),
    plan: z.strictObject({
        parent: z.strictObject({ baseMb: z.number().positive(), perRecordMb: z.number().positive(), minMb: z.number().int().positive(), maxMb: z.number().int().positive() }),
        lintChunk: z.strictObject({ files: z.number().int().positive() }),
    }).optional(),
})

/** The `heavy` block of ops/liveness.yaml: the host's heavy-command slot units (one per `gbPerSlot` GB of RAM), the disk floor, each kind's heap cap and the seat RAM floor. */
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
 * The host's heavy-command load: `cap` slot units (one per `heavy.gbPerSlot` GB of the host's RAM, `slotCap`), the units the running commands hold
 * (`used`, each its weight, `heavyWeight`) and how many commands run, the host floors held now (the free disk under `heavy.diskFloorMb`), the units
 * free now and why, and `pressure` when the command judged (`need` units) may not start. The free RAM is shown, never judged.
 */
export interface HostLoad {
    readonly freeMb: number
    readonly cap: number
    readonly used: number
    readonly running: number
    readonly floors: readonly string[]
    /** The units a new command may take now: none while a floor holds. */
    readonly free: number
    /** The units the command judged needs (its weight, never above `cap`). */
    readonly need: number
    readonly pressure: boolean
    readonly reason: string
}

/**
 * The slot units of the host, the owner's rule: one per `heavy.gbPerSlot` GB of the host's physical RAM, at least one (64 GB at 4 GB a unit: 16). The
 * RAM is counted in whole GB as installed: the OS reports 64 GB less what the firmware and GPU reserve (about 63.8 GB), which must still be 64.
 */
export const slotCap = (rules: Pick<HeavyRules, "gbPerSlot">, totalMb: number = Math.floor(totalmem() / 1_048_576)): number => Math.max(1, Math.floor(Math.round(totalMb / 1024) / rules.gbPerSlot))

/** The most units one heavy command holds, the owner's rule: light 1, medium 2, the heaviest 3. */
export const MAX_WEIGHT = 3

/**
 * The memory a command of `kind` plans to take, in MB: its kind's heap cap (`heavy.caps`), and for a test run the parent and every worker it is sized to
 * (`testRunSizing`: `heavy.testRun` and `heavy.testWorkers` of the cores, at most `workers` when its caller names them).
 */
export const plannedMb = (rules: HeavyRules, kind: HeavyKind, cores: number = availableParallelism(), workers?: number): number =>
    kind === "test" ? testRunSizing(rules, cores, workers).holdMb : rules.caps[kind].capMb

/**
 * The units a heavy command holds while it runs: its planned memory (`plannedMb`) in slot units, rounded up, from 1 to MAX_WEIGHT. Nothing else sets it: the
 * caps of ops/liveness.yaml are the one table, so a measured cap that changes moves the weight with it. A kind this CLI does not know (a row another CLI
 * copy wrote) weighs 1.
 */
export const heavyWeight = (rules: HeavyRules, kind: string, cores: number = availableParallelism(), workers?: number): number => {
    if (!(HEAVY_KINDS as readonly string[]).includes(kind)) return 1
    const unitMb = rules.gbPerSlot * 1024
    return Math.min(MAX_WEIGHT, Math.max(1, Math.ceil(plannedMb(rules, kind as HeavyKind, cores, workers) / unitMb)))
}

/** Every kind with its weight on this host, lightest first: what `host load` prints. */
export const kindWeights = (rules: HeavyRules, cores: number = availableParallelism()): { readonly kind: HeavyKind; readonly weight: number }[] =>
    HEAVY_KINDS.map((kind) => ({ kind, weight: heavyWeight(rules, kind, cores) })).sort((left, right) => left.weight - right.weight)

/** What one admission is judged on: the units in use, the commands running, the weight and name of the command, the floors held, the free RAM shown. */
export interface Judged {
    readonly used: number
    readonly running?: number
    readonly weight?: number
    readonly what?: string
    readonly floors?: readonly string[]
    readonly freeMb?: number
    readonly totalMb?: number
}

/**
 * Admission is a sum: a heavy command of weight W starts when `used + W <= cap` (`slotCap`) and no host floor holds (`floors`: the free disk and the free
 * commit, harness/host-floors.ts). A weight above the cap counts as the cap, so the heaviest command still runs alone on a small host. Nothing else decides
 * it: no free-RAM room, no reserve, no CPU rule. Each heavy command holds its units only while it runs, so a gate that runs several in turn takes each one's
 * as it starts. A running web or api server takes none. Pure.
 */
export const admission = (rules: Pick<HeavyRules, "gbPerSlot">, judged: Judged): HostLoad & { readonly admits: boolean } => {
    const { used, floors = [], freeMb = 0 } = judged
    const cap = slotCap(rules, judged.totalMb)
    const need = Math.min(judged.weight ?? 1, cap)
    const full = used + need > cap
    const floored = floors.length > 0
    const inUse = `${String(used)} of ${String(cap)} slot units in use`
    const reasons = [...floors, ...(full ? [`${inUse}; ${judged.what ?? "the next command"} needs ${String(need)}`] : [])]
    return {
        freeMb,
        cap,
        used,
        running: judged.running ?? used,
        floors,
        free: floored ? 0 : Math.max(0, cap - used),
        need,
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
CREATE TABLE IF NOT EXISTS seat_holds (
  task TEXT PRIMARY KEY, repo TEXT NOT NULL, since TEXT NOT NULL, last_at TEXT NOT NULL, free_mb INTEGER NOT NULL, floor_mb INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS host_starvation (id INTEGER PRIMARY KEY CHECK (id = 1), since TEXT NOT NULL, ticket TEXT);
`

/** Creates the governor's tables, adding the `task` and `weight` columns a store made before them lacks. */
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
const slotOf = (rules: HeavyRules, row: Record<string, unknown>, source: HeavySlot["source"] = "store"): HeavySlot => ({
    id: String(row.id),
    pid: Number(row.pid),
    pidStart: typeof row.pid_start === "string" ? row.pid_start : null,
    childPid: row.child_pid === null || row.child_pid === undefined ? null : Number(row.child_pid),
    childStart: typeof row.child_start === "string" ? row.child_start : null,
    kind: String(row.kind),
    label: String(row.label),
    cwd: String(row.cwd),
    task: typeof row.task === "string" ? row.task : null,
    weight: rowWeight(rules, row),
    state: row.state === "running" ? "running" : "waiting",
    at: String(row.at),
    source,
})

/**
 * The running rows of a CLI copy older than the host store (its own `governor.sqlite`, ledger.ts legacyGovernorPath) whose pid is alive, read only: they
 * are foreign, never written, and their units count against the cap until their commands end and their copy deletes them.
 */
export const legacyHeavyRows = (rules: HeavyRules, file: string | undefined = legacyGovernorPath()): HeavySlot[] => {
    if (file === undefined || !existsSync(file)) return []
    try {
        const db = new Sqlite(file, { readOnly: true, timeout: 5000 })
        try {
            if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'heavy_slots'").get() === undefined) return []
            return db
                .prepare("SELECT * FROM heavy_slots WHERE state = 'running' ORDER BY at")
                .all()
                .filter((row) => pidAlive(Number(row.pid)))
                .map((row) => slotOf(rules, row, "foreign"))
        } finally {
            db.close()
        }
    } catch {
        return []
    }
}

/** The units a row holds: the weight it was admitted with, else (a row a CLI copy without weights wrote) its kind's weight now. */
const rowWeight = (rules: HeavyRules, row: { readonly kind?: unknown; readonly weight?: unknown }): number =>
    typeof row.weight === "number" || typeof row.weight === "bigint" ? Number(row.weight) : heavyWeight(rules, String(row.kind))

/** The running commands (live rows) but the `except` ones (the caller's ancestors, which wait on it): how many, and the units they hold. */
const inUse = (db: DatabaseSync, rules: HeavyRules, except: ReadonlySet<string> = new Set()): { readonly running: number; readonly used: number } => {
    const rows = db.prepare("SELECT id, kind, weight FROM heavy_slots WHERE state = 'running'").all().filter((row) => !except.has(String(row.id)))
    const foreign = legacyHeavyRows(rules).filter((row) => !except.has(row.id))
    return { running: rows.length + foreign.length, used: rows.reduce((sum, row) => sum + rowWeight(rules, row), 0) + foreign.reduce((sum, slot) => sum + slot.weight, 0) }
}

/**
 * The host's load now: the units the running commands hold against the cap, judged for the head of the queue (its weight and label) when one
 * waits, and the floors held for work in the current folder.
 */
export const hostLoad = (rules: HeavyRules = loadHeavyRules()): HostLoad => {
    const head = heavySlots(rules).find((slot) => slot.state === "waiting")
    const { running, used } = withGovernor((db) => inUse(db, rules))
    const commit =
        commitFloorHeld(freeCommitMb(), rules.commitFloorMb ?? COMMIT_FLOOR_MB, head === undefined || running === 0 ? 0 : commitNeedOf(rules, head.kind, head.weight))
    return admission(rules, { used, running, ...(head === undefined ? {} : { weight: head.weight, what: head.label }), floors: [...heavyFloors(rules, process.cwd()), ...commit], freeMb: hostFreeMb() })
}

/** The waiting rows in the order the governor serves them: first come, first served (the order they joined the queue). */
const servingOrder = (rows: readonly { readonly id: string; readonly kind: string; readonly state: string }[]): { readonly id: string; readonly kind: string }[] => rows.filter((row) => row.state === "waiting")

/** One row of the semaphore: a heavy command running (its child's pid once spawned) or waiting for its slot units. */
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
    /** The slot units it holds while it runs (`heavyWeight`). */
    readonly weight: number
    readonly state: "running" | "waiting"
    readonly at: string
}

/** Every slot row of a live process, running first; rows of a process that is gone are dropped on the way. */
export const heavySlots = (rules: HeavyRules = loadHeavyRules()): HeavySlot[] =>
    withGovernor((db) => {
        ensureTables(db)
        const rows = db.prepare("SELECT * FROM heavy_slots ORDER BY state, at").all()
        const live: HeavySlot[] = []
        for (const row of rows) {
            if (!pidAlive(Number(row.pid))) {
                dropDead(db, row, `pid ${String(process.pid)}`)
                continue
            }
            live.push(slotOf(rules, row))
        }
        return live
    })

/**
 * One try for a slot, atomically (withMachine runs it under BEGIN IMMEDIATE, so two processes never both take the last units). The row joins the
 * queue (keeping its place), and the queue is first come, first served (`servingOrder`): only the head may start, and it starts when `admission`
 * admits its weight against the units the commands running at this instant hold. A light command behind a heavy head waits with it, so the heavy one
 * is never starved by light ones that would fit. The rows of the caller's ancestors (`parents`) are not counted: they wait on it. The load it was
 * judged on, and the holders when it waits.
 */
const tryAcquire = (
    slot: Pick<HeavySlot, "id" | "pid" | "pidStart" | "kind" | "label" | "cwd" | "task" | "weight">,
    rules: HeavyRules,
    freeMb: number,
    parents: ReadonlySet<string> = new Set(),
    floors: readonly string[] = [],
    totalMb?: number,
    commitMb: number | null = null,
): { readonly load: HostLoad; readonly holders: string[] | null; readonly place: number } =>
    withGovernor((db) => {
        ensureTables(db)
        for (const row of db.prepare("SELECT id, pid, child_pid, label FROM heavy_slots").all()) if (!pidAlive(Number(row.pid))) dropDead(db, row, `${slot.label} (pid ${String(process.pid)})`)
        db.prepare("INSERT INTO heavy_slots (id, pid, pid_start, kind, label, cwd, task, weight, state, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?) ON CONFLICT (id) DO NOTHING").run(slot.id, slot.pid, slot.pidStart, slot.kind, slot.label, slot.cwd, slot.task, slot.weight, now())
        const rows = db.prepare("SELECT id, kind, state FROM heavy_slots ORDER BY rowid").all().map((row) => ({ id: String(row.id), kind: String(row.kind), state: String(row.state) }))
        const own = db.prepare("SELECT id, label, pid, at, kind, weight FROM heavy_slots WHERE state = 'running'").all().filter((row) => !parents.has(String(row.id)))
        // The live rows of an older CLI copy's own store count too (`legacyHeavyRows`): the host's cap is one, whoever runs.
        const foreign = legacyHeavyRows(rules)
            .filter((row) => !parents.has(row.id))
            .map((row) => ({ id: row.id, label: `${row.label} [older copy]`, pid: row.pid, at: row.at, kind: row.kind, weight: row.weight }))
        const running: Record<string, unknown>[] = [...own, ...foreign]
        const used = running.reduce((sum, row) => sum + rowWeight(rules, row), 0)
        // The commit floor: the planned memory of the commands admitted in the last commitRampSeconds is not in the reading yet, so it is taken off.
        const rampFrom = Date.now() - (rules.commitRampSeconds ?? COMMIT_RAMP_SECONDS) * 1000
        const rampingMb = running.filter((row) => Date.parse(String(row.at)) >= rampFrom).reduce((sum, row) => sum + commitNeedOf(rules, String(row.kind), rowWeight(rules, row)), 0)
        // With no heavy command running, no admission of the governor's can free the commit the head plans: the head then waits only while the free
        // commit itself is under the floor, never for its own plan, so a command planning more than the host's free commit runs alone instead of
        // waiting forever (as a weight above the cap does; h-commit-floor-head).
        const need = running.length === 0 ? 0 : commitNeedOf(rules, slot.kind, slot.weight)
        const commit = commitFloorHeld(commitMb, rules.commitFloorMb ?? COMMIT_FLOOR_MB, need, rampingMb)
        const load = admission(rules, { used, running: running.length, weight: slot.weight, what: slot.label, floors: [...floors, ...commit], freeMb, ...(totalMb === undefined ? {} : { totalMb }) })
        const order = servingOrder(rows)
        if (order[0]?.id !== slot.id || !load.admits) {
            const place = order.findIndex((row) => row.id === slot.id)
            const queued = place <= 0 ? "first in the queue" : `${String(place)} ahead of it in the queue`
            return { load: { ...load, reason: `${load.reason}; ${queued}` }, holders: running.map((row) => `${String(row.label)} (${String(rowWeight(rules, row))} units, pid ${String(row.pid)}, since ${String(row.at)})`), place: Math.max(0, place) }
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

/**
 * The commit a command is judged to need against heavy.commitFloorMb: its planned MB capped at the slot units it holds (weight x gbPerSlot). A test
 * run plans every worker's heap cap (23 GB on this host), which is a ceiling its pages never all commit; counting it whole kept the head of the queue
 * waiting forever on a host with 24 GB free commit (h-commit-floor-head).
 */
export const commitNeedOf = (rules: HeavyRules, kind: string, weight?: unknown): number => {
    const units = Math.min(MAX_WEIGHT, Math.max(1, Number.isFinite(Number(weight)) && Number(weight) > 0 ? Number(weight) : 1))
    return Math.min(plannedOf(rules, kind), units * rules.gbPerSlot * 1024)
}

/** The planned MB of a row's kind (`plannedMb`); a kind this copy does not know plans one slot unit. */
const plannedOf = (rules: HeavyRules, kind: string): number => ((HEAVY_KINDS as readonly string[]).includes(kind) ? plannedMb(rules, kind as HeavyKind) : rules.gbPerSlot * 1024)

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

/** What one governed command is judged on: the heavy rules, the host's RAM (for its slot count) and the floors. The host's, or a spec's. */
export interface Governed {
    readonly rules: HeavyRules
    readonly freeMb: () => number
    /** The host's physical RAM in MB, which sets the slot count; the live host's when absent. */
    readonly totalMb?: number
    /** The host floors held now for a command working in `cwd` under `rules` (harness/host-floors.ts); none when absent (a spec's host). */
    readonly floors?: (cwd: string, rules: HeavyRules) => string[]
    /** The rules as they stand now, read again at every admission attempt (`currentHeavyRules`); `rules` throughout when absent. */
    readonly reread?: (last: HeavyRules) => HeavyRules
    /** The host's free commit in MB (`freeCommitMb`), null where the host reports none; no commit floor when absent (a spec's host). */
    readonly commitMb?: () => number | null
}

/** The host floors held now for work in `cwd`: the free space of its drive under the host's disk floor (`currentHeavyRules`). */
export const heavyFloors = (rules: HeavyRules, cwd: string): string[] => {
    const current = currentHeavyRules(rules, () => rules)
    return floorsHeld({ diskFloorMb: current.diskFloorMb, source: current.diskFloorSource }, readFloors(cwd))
}

const liveHost = (): Governed => {
    const rules = loadHeavyRules()
    return { rules, freeMb: hostFreeMb, commitMb: freeCommitMb, reread: (last) => currentHeavyRules(last), floors: (cwd, now) => floorsHeld({ diskFloorMb: now.diskFloorMb, source: (now as { readonly diskFloorSource?: string }).diskFloorSource }, readFloors(cwd)) }
}

/** How often a waiting command prints its position, so a hook that waits does not look hung. */
const WAIT_LINE_MS = 60_000

/** Whether this process runs on a CI runner: one job on its own machine, so no other command shares it and no queue is kept. */
const onCiRunner = (): boolean => process.env.CI === "true" || process.env.CI === "1"

/** The line a waiting command prints: its place in the first come, first served queue, why it waits (the units or a floor) and who runs. Waiting holds nothing. */
export const waitLine = (label: string, place: number, load: Pick<HostLoad, "cap" | "need" | "reason">, holders: readonly string[]): string =>
    `starci: ${label} waits for a heavy-command slot (${String(load.need)} of the ${String(load.cap)} slot units on this host): ${place === 0 ? "first in the queue" : `${String(place)} ahead of it`}; ${load.reason}; running: ${holders.join("; ") || "none"}`

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
 * heavy-sites audit holds it). It holds its weight in slot units (`heavyWeight`) and starts when it heads the queue and those units are free
 * (`admission`), else waits in a first come, first served queue, holding nothing, polls every `heavy.pollSeconds` and prints its place, why it waits and
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
    // The units it holds: its kind's planned memory in slot units, a test run's from the workers it is sized to.
    const weight = heavyWeight(rules, kind, availableParallelism(), options.workers)
    const slot = { id: slotId, pid: process.pid, pidStart: new Date(selfStartMs()).toISOString(), kind, label, cwd, task, weight }
    const started = Date.now()
    const holdMs = Number(process.env[HOLD_ENV] ?? Number.NaN)
    let live = rules
    const admit = async (lastLineAt: number | null): Promise<{ readonly load: HostLoad; readonly waited: boolean }> => {
        // Re-judged at every poll: the rules as they stand now (the host's disk floor and the caps, read again), the running count and the floors now.
        live = host.reread?.(live) ?? live
        const tried = tryAcquire(slot, live, host.freeMb(), ancestors, host.floors?.(cwd, live) ?? [], host.totalMb, host.commitMb?.() ?? null)
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

/**
 * Whether a new worker seat may launch now: free memory at or above `heavy.seatFreeMb` (each agent terminal costs memory). A
 * refused launch is a wait; the task stays queued and a later step launches it.
 */
export const seatRoom = (rules: HeavyRules = loadHeavyRules()): { readonly ok: boolean; readonly freeMb: number; readonly floorMb: number } => {
    const freeMb = hostFreeMb()
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

/** Why a heavy command of `weight` (named `what`) is not admitted now, in one short clause (the units, or a floor); undefined when it would be admitted. */
export const heldWhy = (rules: HeavyRules, used: number, floors: readonly string[] = [], weight = 1, what?: string): string | undefined => {
    const judged = admission(rules, { used, floors, weight, ...(what === undefined ? {} : { what }) })
    return judged.admits ? undefined : judged.reason
}

/**
 * What @starci/hfs reads as the room of an app check's parallel children (`io.heavyRoom`): how many eslint children the units free now admit (this
 * process's ancestors aside), at least one, times the eslint heap cap, so it starts as many children as can be admitted at once; each child still
 * takes its own units. On a CI runner, its one job's free RAM.
 */
export const heavyRoomMb = (host: Governed = liveHost()): number => {
    const { rules } = host
    if (onCiRunner()) return host.freeMb()
    const ancestors = new Set(heavyParents())
    const { used } = withGovernor((db) => {
        ensureTables(db)
        return inUse(db, rules, ancestors)
    })
    return Math.max(1, Math.floor((slotCap(rules, host.totalMb) - used) / heavyWeight(rules, "eslint"))) * rules.caps.eslint.capMb
}

/** The slot units the running heavy commands hold now, from the governor's store (live rows only after `heavySlots`). */
export const heavyUnitsInUse = (rules: HeavyRules = loadHeavyRules()): number =>
    withGovernor((db) => {
        ensureTables(db)
        return inUse(db, rules).used
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
    const waiting = heavySlots(rules).filter((slot) => slot.state === "waiting")
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
    rules: HeavyRules = loadHeavyRules(),
): HeavyKill => {
    const alive = given.alive ?? pidAlive
    const row = withGovernor((db) => {
        ensureTables(db)
        const found = db.prepare("SELECT * FROM heavy_slots WHERE id = ?").get(id)
        return found === undefined ? undefined : slotOf(rules, found)
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
