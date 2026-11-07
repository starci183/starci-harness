// memory-plan.ts - the memory plan of `starci app check` (RAM-SIZING): before the families run, the cache folder of the app is measured (the MB of every
// record), and the check's own heap and the lint chunk are taken from that scope and the constants of ops/liveness.yaml heavy.plan. The plan reaches
// @starci/hfs through STARCI_MEMORY_PLAN. A heavy command's heap is its cap (heavy.caps, heavy.testRun) and a test run's workers come from the RAM free
// at its admission (`testRunSizing` of heavy.ts); no earlier run is read.
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { getHeapStatistics } from "node:v8"
import { captureGitSync } from "../shared/git.js"
import { testRunSizing, type HeavyRules } from "./heavy.js"

/** The environment variable that carries the plan to @starci/hfs and to the CLI's own node runner. */
export const MEMORY_PLAN_ENV = "STARCI_MEMORY_PLAN"
/** Set on the re-executed check, so it never re-executes again. */
export const MEMORY_REEXEC_ENV = "STARCI_MEMORY_REEXEC"
/** The scope the plan is sized from. */
export interface Scope {
    /** MB of the per-spec coverage records (`.starcistacks/cache/test-coverage`). */
    readonly coverageMb: number
    /** MB of every cache record (`.starcistacks/cache`). */
    readonly recordMb: number
    /** MB of the largest cache file. */
    readonly largestMb: number
}

/** The plan in force for one app check. */
export interface MemoryPlan {
    readonly scope: Scope
    readonly parentMb: number
    readonly lintChunk: number
}

const MB = 1_048_576

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const ceil512 = (mb: number): number => Math.ceil(mb / 512) * 512

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

/** The scope of the cache folder under `appRoot`. */
export const measureScope = (appRoot: string): Scope => {
    const cache = join(appRoot, ".starcistacks", "cache")
    const all = bytesUnder(cache)
    const coverage = bytesUnder(join(cache, "test-coverage"))
    return { coverageMb: coverage.total / MB, recordMb: all.total / MB, largestMb: all.largest / MB }
}

/** The root of the checkout holding `cwd` (the app an app check judges); `cwd` itself outside a git checkout. */
export const appRootOf = (cwd: string): string => {
    const top = captureGitSync(["rev-parse", "--show-toplevel"], cwd)
    return top.exitCode === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : cwd
}

/**
 * The plan for `scope` under the constants of `rules.plan`. Without a `plan` block (an older ops/liveness.yaml) there is no plan.
 */
export const planMemory = (scope: Scope, rules: HeavyRules): MemoryPlan | null => {
    const constants = rules.plan
    if (constants === undefined) return null
    const { parent, lintChunk } = constants
    const parentMb = ceil512(clamp(parent.baseMb + parent.perRecordMb * scope.recordMb, parent.minMb, parent.maxMb))
    return { scope, parentMb, lintChunk: lintChunk.files }
}

/**
 * The plan in one line per part, as `app check --explain` names it, and the test run it would get on the RAM free now (`testRunSizing`).
 */
export const formatPlan = (plan: MemoryPlan, rules: HeavyRules, freeMb: number, cores: number): string[] => {
    const roomMb = freeMb - rules.reserveMb
    const run = testRunSizing(rules, roomMb, cores)
    return [
        `memory plan: records ${plan.scope.recordMb.toFixed(1)} MB (coverage ${plan.scope.coverageMb.toFixed(1)} MB, largest file ${plan.scope.largestMb.toFixed(1)} MB); parent heap ${String(plan.parentMb)} MB; lint chunk ${String(plan.lintChunk)} files`,
        `memory plan: a test run on the ${String(freeMb)} MB free now (room ${String(roomMb)} MB after the ${String(rules.reserveMb)} MB reserve): parent ${String(run.parentMb)} MB, ${String(run.workers)} workers at ${String(run.workerMb)} MB`,
    ]
}

/** This process's V8 heap limit in MB. */
export const heapLimitMb = (): number => Math.floor(getHeapStatistics().heap_size_limit / MB)

/** Whether the check must re-execute itself under the planned parent heap: node's limit is below it and this is not already the re-executed one. */
export const needsReexec = (plan: MemoryPlan, env: NodeJS.ProcessEnv = process.env, limitMb: number = heapLimitMb()): boolean => env[MEMORY_REEXEC_ENV] !== "1" && limitMb < plan.parentMb
