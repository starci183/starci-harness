// memory-plan.ts - the memory plan of `starci app check` (RAM-SIZING): before the families run, the app is measured from its
// git index and file sizes alone (per side the unit specs and sources; the MB of the per-spec coverage records and of every cache record), and each
// heap is sized from that scope with the fitted constants of ops/liveness.yaml heavy.plan, instead of one figure per kind. The plan reaches @starci/hfs
// through STARCI_MEMORY_PLAN (it puts the planned heap on each child it asks the CLI to run) and the governor holds each running row at its planned MB.
// What a child really peaked at is learned per app and per machine (memory-factors.json in the app's untracked tool cache, never in the app): a kind that ran over its plan is planned
// higher next run, never beyond MAX_FACTOR times its fitted heap, and a kind that ran well under its plan eases back toward the fitted one.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { availableParallelism, freemem, homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { getHeapStatistics } from "node:v8"
import { captureGitSync } from "../shared/git.js"
import type { HeavyRules } from "./heavy.js"

/** The environment variable that carries the plan to @starci/hfs and to the CLI's own node runner. */
export const MEMORY_PLAN_ENV = "STARCI_MEMORY_PLAN"
/** Set on the re-executed check, so it never re-executes again. */
export const MEMORY_REEXEC_ENV = "STARCI_MEMORY_REEXEC"
/** The learned factors' file name, in the app's untracked tool cache. */
export const FACTORS_FILE = "memory-factors.json"

/**
 * The learned factors' file of the app at `appRoot`: `memory-factors.json` in its untracked tool cache of slot `app.tool-cache`,
 * `${STARCI_CACHE_HOME:-%LOCALAPPDATA%/StarCi/cache}/<repo>/app-check/` (the folder `@starci/hfs` writes the run log to, `toolCacheDir` of its
 * `cache/run-log.mts`), so the factors are host state of this checkout and never a file in the app.
 */
export const factorsPath = (appRoot: string, env: NodeJS.ProcessEnv = process.env): string => {
    const home = env.STARCI_CACHE_HOME ?? (process.platform === "win32" ? join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "StarCi", "cache") : join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "starci"))
    let real = resolve(appRoot)
    try {
        real = realpathSync(real)
    } catch {
        // the given path names the app
    }
    return join(home, `${basename(real)}-${createHash("sha256").update(real).digest("hex").slice(0, 12)}`, "app-check", FACTORS_FILE)
}
/** The most a learned factor multiplies a fitted heap by, however high one run peaked: a factor is a correction, never a new model. */
export const MAX_FACTOR = 2
/** A run that peaked under this percent of its plan eases its kind's factor back (to at most this share of it per run). */
export const EASE_BELOW_PERCENT = 75
const EASE_STEP = 0.85

/** What one side of the app holds: its unit specs and its TypeScript sources (specs and declarations excluded). */
export interface SideScope {
    readonly specs: number
    readonly sources: number
}

/** The scope the plan is sized from. */
export interface Scope {
    readonly sides: Readonly<Record<string, SideScope>>
    /** MB of the per-spec coverage records (`.starcistacks/cache/test-coverage`). */
    readonly coverageMb: number
    /** MB of every cache record (`.starcistacks/cache`). */
    readonly recordMb: number
    /** MB of the largest cache file. */
    readonly largestMb: number
}

/** The kinds a factor is learned for. */
export type PlannedKind = "parent" | "test" | "testWorker" | "tsc"
/** The app's learned factors, each at least 1. */
export type Factors = Readonly<Partial<Record<PlannedKind, number>>> & { readonly lintPerFileMb?: number }

/** The heaps of one side. */
export interface SidePlan {
    readonly testParentMb: number
    readonly testWorkerMb: number
    readonly workers: number
    readonly typesMb: number
}

/** The plan in force for one app check. */
export interface MemoryPlan {
    readonly scope: Scope
    readonly freeMb: number
    readonly cores: number
    readonly parentMb: number
    readonly sides: Readonly<Partial<Record<string, SidePlan>>>
    readonly lintChunk: number
    readonly factors: Factors
}

const SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/u
const SOURCE = /\.[cm]?tsx?$/u
const DECLARATION = /\.d\.[cm]?ts$/u
const MB = 1_048_576

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const ceil512 = (mb: number): number => Math.ceil(mb / 512) * 512

/** The side a tracked path belongs to: its first folder when that is `be` or `fe`. */
export const sideOf = (file: string): string | null => {
    const head = file.split("/")[0]
    return head === "be" || head === "fe" ? head : null
}

const bytesUnder = (dir: string): { readonly total: number; readonly largest: number } => {
    let total = 0
    let largest = 0
    const walk = (at: string): void => {
        let entries
        try {
            entries = readdirSync(at, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const path = join(at, entry.name)
            if (entry.isDirectory()) {
                walk(path)
                continue
            }
            const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0
            total += size
            largest = Math.max(largest, size)
        }
    }
    walk(dir)
    return { total, largest }
}

/** The scope of `tracked` (app-relative posix paths) and the cache folder under `appRoot`. */
export const scopeOf = (appRoot: string, tracked: readonly string[]): Scope => {
    const sides: Record<string, { specs: number; sources: number }> = {}
    for (const file of tracked) {
        const side = sideOf(file)
        if (side === null || file.includes("/node_modules/")) continue
        const counts = (sides[side] ??= { specs: 0, sources: 0 })
        if (SPEC.test(file)) counts.specs += 1
        else if (SOURCE.test(file) && !DECLARATION.test(file)) counts.sources += 1
    }
    const cache = join(appRoot, ".starcistacks", "cache")
    const all = bytesUnder(cache)
    const coverage = bytesUnder(join(cache, "test-coverage"))
    return { sides, coverageMb: coverage.total / MB, recordMb: all.total / MB, largestMb: all.largest / MB }
}

/** The root of the checkout holding `cwd` (the app an app check judges); `cwd` itself outside a git checkout. */
export const appRootOf = (cwd: string): string => {
    const top = captureGitSync(["rev-parse", "--show-toplevel"], cwd)
    return top.exitCode === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : cwd
}

/** The scope of the app at `appRoot`, read from its git index; null outside a git checkout. */
export const measureScope = (appRoot: string): Scope | null => {
    const listed = captureGitSync(["ls-files", "-z"], appRoot)
    if (listed.exitCode !== 0) return null
    return scopeOf(appRoot, listed.stdout.split("\0").filter((file) => file !== ""))
}

/** The learned factors of the app at `appRoot`; none when it has learned nothing. */
export const readFactors = (appRoot: string): Factors => {
    try {
        const parsed = JSON.parse(readFileSync(factorsPath(appRoot), "utf8")) as Record<string, unknown>
        const out: Record<string, number> = {}
        for (const [kind, value] of Object.entries(parsed)) if (typeof value === "number" && Number.isFinite(value) && value > 0) out[kind] = value
        return out
    } catch {
        return {}
    }
}

/**
 * The plan for `scope` under the constants of `rules.plan`, on a host with `freeMb` free and `cores` logical cores. Each heap is multiplied by the
 * kind's learned factor before it is clamped. Without a `plan` block (an older ops/liveness.yaml) there is no plan.
 */
export const planMemory = (scope: Scope, rules: HeavyRules, freeMb: number = Math.floor(freemem() / MB), cores: number = availableParallelism(), factors: Factors = {}): MemoryPlan | null => {
    const constants = rules.plan
    if (constants === undefined) return null
    const factor = (kind: PlannedKind): number => clamp(factors[kind] ?? 1, 1, MAX_FACTOR)
    const { parent, testParent, testWorker, types, lintChunk } = constants
    const parentMb = ceil512(clamp((parent.baseMb + parent.perRecordMb * scope.recordMb) * factor("parent"), parent.minMb, parent.maxMb))
    const percent = /^(\d{1,3})%$/u.exec(rules.testWorkers)?.[1]
    const workerCap = Math.max(1, Math.min(cores - 1, percent === undefined ? Number(rules.testWorkers) : Math.floor((cores * Number(percent)) / 100)))
    const room = freeMb - testWorker.reserveMb
    const sides: Record<string, SidePlan> = {}
    for (const [side, { specs, sources }] of Object.entries(scope.sides)) {
        // A worker's heap is never planned above the room free RAM leaves (a worker heap is no cap of its own, only what admission holds), so one worker's
        // estimate cannot exceed the host's room however high its factor.
        const ceilingMb = Math.min(testWorker.maxMb, Math.max(testWorker.minMb, room))
        const workerMbAt = (workers: number): number => Math.min(ceilingMb, ceil512(clamp((testWorker.baseMb + (testWorker.perSpecMb * specs) / workers) * factor("testWorker"), testWorker.minMb, testWorker.maxMb)))
        // The worker heap shrinks as the workers grow: from the cap down, the first count the room holds at its own worker heap.
        let workers = workerCap
        while (workers > 1 && Math.floor(room / workerMbAt(workers)) < workers) workers -= 1
        sides[side] = {
            testParentMb: ceil512(clamp(testParent.margin * testParent.perSpecMb * specs * factor("test"), testParent.minMb, testParent.maxMb)),
            testWorkerMb: workerMbAt(workers),
            workers,
            typesMb: ceil512(clamp((types.baseMb + types.perFileMb * sources) * factor("tsc"), types.minMb, types.maxMb)),
        }
    }
    const learned = factors.lintPerFileMb
    const budget = rules.memoryMb.eslint
    const chunk = learned === undefined ? lintChunk.files : clamp(Math.floor(budget / learned), lintChunk.min, lintChunk.max)
    return { scope, freeMb, cores, parentMb, sides, lintChunk: chunk, factors }
}

/** The plan in force for this process, from its environment; null when the check runs without one. */
export const planInForce = (env: NodeJS.ProcessEnv = process.env): MemoryPlan | null => {
    const text = env[MEMORY_PLAN_ENV]
    if (text === undefined || text === "") return null
    try {
        return JSON.parse(text) as MemoryPlan
    } catch {
        return null
    }
}

/** The plan in one line per part, as `app check --explain` and an out-of-memory message name it. */
export const formatPlan = (plan: MemoryPlan): string[] => {
    const scope = Object.entries(plan.scope.sides).map(([side, counts]) => `${side} ${String(counts.specs)} specs, ${String(counts.sources)} sources`).join("; ")
    const lines = [
        `memory plan: scope ${scope || "no be or fe side"}; records ${plan.scope.recordMb.toFixed(1)} MB (coverage ${plan.scope.coverageMb.toFixed(1)} MB, largest file ${plan.scope.largestMb.toFixed(1)} MB); free ${String(plan.freeMb)} MB, ${String(plan.cores)} cores`,
        `memory plan: parent heap ${String(plan.parentMb)} MB; lint chunk ${String(plan.lintChunk)} files`,
        ...Object.entries(plan.sides).flatMap(([side, sized]) => sized === undefined ? [] : `memory plan: ${side} test parent ${String(sized.testParentMb)} MB, ${String(sized.workers)} workers at ${String(sized.testWorkerMb)} MB, tsc ${String(sized.typesMb)} MB`),
    ]
    const learned = Object.entries(plan.factors).filter(([, value]) => value > 1)
    if (learned.length > 0) lines.push(`memory plan: learned factors ${learned.map(([kind, value]) => `${kind} x${value.toFixed(2)}`).join(", ")} (${FACTORS_FILE} in the app's tool cache)`)
    return lines
}

/** This process's V8 heap limit in MB. */
export const heapLimitMb = (): number => Math.floor(getHeapStatistics().heap_size_limit / MB)

/** Whether the check must re-execute itself under the planned parent heap: node's limit is below it and this is not already the re-executed one. */
export const needsReexec = (plan: MemoryPlan, env: NodeJS.ProcessEnv = process.env, limitMb: number = heapLimitMb()): boolean => env[MEMORY_REEXEC_ENV] !== "1" && limitMb < plan.parentMb

/** The kind a child's sampled peak is learned for. */
const learnedKind = (kind: string, worker: boolean): PlannedKind | null => (kind === "test" ? (worker ? "testWorker" : "test") : kind === "tsc" ? "tsc" : null)

/**
 * Learns from one child, written to the app's factors file. A peak more than `abovePercent` over its plan raises the kind's factor to peak / planned times
 * the factor in force, at most MAX_FACTOR; a peak under EASE_BELOW_PERCENT of its plan eases a factor above 1 back toward 1. Returns the line to print, or
 * null when the child fit its plan (or the factor stays).
 */
export const learnPeak = (appRoot: string, kind: string, plannedMb: number, peakMb: number, abovePercent: number, worker = false): string | null => {
    const learned = learnedKind(kind, worker)
    if (learned === null || plannedMb <= 0) return null
    const factors = { ...readFactors(appRoot) } as Record<string, number>
    const held = clamp(factors[learned] ?? 1, 1, MAX_FACTOR)
    const raise = peakMb > plannedMb * (1 + abovePercent / 100)
    const ease = !raise && held > 1 && peakMb < plannedMb * (EASE_BELOW_PERCENT / 100)
    if (!raise && !ease) return null
    const next = raise ? Math.min(MAX_FACTOR, held * (peakMb / plannedMb)) : Math.max(1, held * Math.max(EASE_STEP, peakMb / plannedMb))
    if (Math.round(next * 100) === Math.round(held * 100)) return null
    factors[learned] = Math.round(next * 100) / 100
    const file = factorsPath(appRoot)
    try {
        if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, `${JSON.stringify(factors, null, 2)}\n`)
    } catch {
        return `starci: ${kind} peaked at ${String(Math.round(peakMb))} MB over its planned ${String(plannedMb)} MB; ${factorsPath(appRoot)} could not be written, so the next run plans the same`
    }
    if (ease) return `starci: ${kind} peaked at ${String(Math.round(peakMb))} MB, under ${String(EASE_BELOW_PERCENT)}% of its planned ${String(plannedMb)} MB; its factor eases to x${factors[learned].toFixed(2)} for this app's next run (${factorsPath(appRoot)})`
    return `starci: ${kind} peaked at ${String(Math.round(peakMb))} MB, over its planned ${String(plannedMb)} MB by more than ${String(abovePercent)}%; its factor is now x${factors[learned].toFixed(2)} for this app's next run, at most x${String(MAX_FACTOR)} (${factorsPath(appRoot)})`
}
