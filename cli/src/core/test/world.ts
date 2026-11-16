import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { heavyCommand } from "../../harness/run-checks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { evidenceTail } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** What `@starci/jest-preset/world-cache` answers for a whole kind before any jest process starts (`preflight`). */
interface Preflight {
    readonly specs: number
    readonly allCached: boolean
    readonly lines: readonly WorldLine[]
}

/**
 * The cache's answer for every spec file of the kind, read through the preset the app has installed (`@starci/jest-preset/world-cache`, 2.11.0 and later),
 * or undefined when the app has no `be/` folder or an older preset: the run then goes to jest, whose runner asks the cache itself. A run whose every spec
 * is cached starts nothing: a world's globalSetup (containers, migrations) would run before any runner could skip a file.
 */
export const preflightOf = (root: string, kind: WorldKind): Preflight | undefined => {
    const be = join(root, "be")
    if (!existsSync(join(be, "package.json"))) return undefined
    try {
        const loaded: unknown = createRequire(join(be, "package.json"))("@starci/jest-preset/world-cache")
        const ask: unknown = typeof loaded === "object" && loaded !== null ? Reflect.get(loaded, "preflight") : undefined
        return typeof ask === "function" ? (Reflect.apply(ask, undefined, [be, kind]) as Preflight) : undefined
    } catch {
        return undefined
    }
}

/** The two world kinds a person asks for; each runs through the app's own `test:<kind>` script, so the typecheck of the tests comes first. */
export type WorldKind = "integration" | "e2e"

/** The variable that turns the result cache off for one run (`--full`); `@starci/jest-preset` reads it. */
export const CACHE_ENV = "STARCI_TEST_CACHE"
/** The variable that asks for more than one spec file at a time (`--workers`); `@starci/test-world` and `@starci/jest-preset` read it. */
export const WORKERS_ENV = "STARCI_TEST_WORLD_WORKERS"
/** The variable naming the json file the runner writes its report to. */
export const REPORT_ENV = "STARCI_TEST_REPORT"

/** One line of the runner's report: a spec file that ran, was cached or failed. */
export interface WorldLine {
    readonly spec: string
    readonly kind: string
    readonly outcome: "ran" | "cached" | "failed"
    /** This run's duration, or the duration of the green run a cached spec stands for. */
    readonly ms: number
    readonly why: string
}

interface WorldData {
    readonly kind: WorldKind
    readonly argv: readonly string[]
    readonly cwd: string
    readonly full: boolean
    /** The workers `--workers` asked for; undefined when the app's `tests:` block of application-stacks.yaml decides. */
    readonly workers: number | undefined
    readonly specs: readonly string[]
    readonly ran: number
    readonly cached: number
    readonly failed: number
    readonly lines: readonly WorldLine[]
    readonly summary: string
    readonly exitCode: number | null
    readonly timedOut: boolean
    readonly verdict: "passed" | "failed"
    readonly output: string
}

/** The workers `--workers` names: a positive integer; undefined when it is not given, so the app's `tests:` block of application-stacks.yaml (one when absent) decides. */
export const workersOf = (given: string | undefined): number | undefined => {
    if (given === undefined) return undefined
    const workers = Number(given)
    if (!Number.isInteger(workers) || workers < 1) throw new Refusal("TEST_WORLD_WORKERS", `--workers is a positive integer, got "${given}"`)
    return workers
}

/** The command and the environment of one run: the app's script, the named specs after `--`, and the cache and worker switches in the environment. */
export const worldRun = (kind: WorldKind, flags: { readonly full: boolean; readonly spec: readonly string[]; readonly workers: number | undefined }, report: string): { readonly argv: readonly string[]; readonly env: Readonly<Record<string, string>> } => ({
    argv: ["npm", "run", `test:${kind}`, ...(flags.spec.length === 0 ? [] : ["--", ...flags.spec.map((spec) => spec.replaceAll("\\", "/"))])],
    env: { [REPORT_ENV]: report, ...(flags.workers === undefined ? {} : { [WORKERS_ENV]: String(flags.workers) }), ...(flags.full ? { [CACHE_ENV]: "off" } : {}) },
})

/** The lines of a runner report file, an empty list when the run wrote none (the typecheck failed, or no spec was selected). */
export const linesOf = (text: string): readonly WorldLine[] => {
    try {
        const parsed: unknown = JSON.parse(text)
        const lines: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "lines") : undefined
        return Array.isArray(lines) ? (lines as WorldLine[]) : []
    } catch {
        return []
    }
}

const seconds = (ms: number): string => (ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`)

/** The report as the verb prints it: one line per spec file with its time, then the counts and the time the cache saved. */
export const reportOf = (lines: readonly WorldLine[]): string => {
    const count = (outcome: WorldLine["outcome"]): number => lines.filter((line) => line.outcome === outcome).length
    const sum = (outcomes: readonly WorldLine["outcome"][]): number => lines.filter((line) => outcomes.includes(line.outcome)).reduce((total, line) => total + line.ms, 0)
    const rows = lines.map((line) => `${line.outcome === "cached" ? "cached" : line.outcome === "failed" ? "FAILED" : "ran   "}  ${line.spec}  ${line.outcome === "cached" ? `green before in ${seconds(line.ms)}` : `${seconds(line.ms)}, ${line.why}`}`)
    return [...rows, `${String(lines.length)} spec file(s): ${String(count("ran"))} ran, ${String(count("cached"))} cached, ${String(count("failed"))} failed; ${seconds(sum(["ran", "failed"]))} spent, ${seconds(sum(["cached"]))} saved by the cache`].join("\n")
}

/**
 * `starci test integration` and `starci test e2e`: a person's run of the world suites of an app, on the slots its `.starcistacks/application-stacks.yaml` declares (`tests.<kind>.workers`, one when absent), exclusive specs alone after the parallel ones, and through the result cache. The run
 * is the app's own `npm run test:<kind>` (the typecheck of the tests first, then jest on that one project), under a heavy-command slot, so it is
 * the run `npm run test:<kind>` makes, with the switches the verb sets in its environment: a spec file whose inputs are unchanged since its last
 * green run is not run and is reported `cached`; a new, changed or previously red one runs (the inputs and the records are
 * `@starci/jest-preset`'s, contexts/code/be/test.md BE-TEST-17). `--full` ignores the cache and refreshes it; `--spec <path>` runs the named
 * spec files whatever the cache says; `--workers <n>` overrides the workers the app declares. On request only (R12):
 * no CI workflow, hook or gate row runs these. Red (exit 1) when a spec fails or the typecheck of the tests does.
 */
const worldVerb = (kind: WorldKind) =>
    defineVerb({
        path: ["test", kind],
        summary: `run the ${kind} specs of the app on the world slots application-stacks.yaml declares (tests.${kind}.workers, one when absent), exclusive specs alone, through the result cache: a spec whose inputs are unchanged since its last green run is skipped and reported cached; --full ignores the cache, --spec runs one regardless; on request only, never in CI or a hook`,
        editions: BOTH_EDITIONS,
        effect: "local-write",
        roles: EVERYONE,
        schema: kind === "integration" ? "starci/test-integration@1" : "starci/test-e2e@1",
        flags: {
            full: { kind: "boolean", summary: "ignore the cache: run every spec file, then record the green ones" },
            spec: { kind: "list", summary: "run this spec file (a path, or a part of it) whatever the cache says (repeatable)" },
            workers: { kind: "string", summary: "run this many spec files at once, each on a data slot of its own, instead of the workers application-stacks.yaml declares for the kind" },
        },
        run: async (context, flags) => {
            const root = await repositoryRoot(context.cwd)
            const workers = workersOf(flags.workers)
            const known = flags.full || flags.spec.length > 0 ? undefined : preflightOf(root, kind)
            if (known?.allCached === true) {
                const summary = reportOf(known.lines)
                const data: WorldData = { kind, argv: [], cwd: root, full: false, workers, specs: [], ran: 0, cached: known.specs, failed: 0, lines: known.lines, summary, exitCode: 0, timedOut: false, verdict: "passed", output: "" }
                return { data, message: [summary, `every ${kind} spec file is cached: nothing ran, no world started (--full runs them anyway)`].join("\n"), exitCode: 0 }
            }
            const folder = mkdtempSync(join(tmpdir(), "starci-test-"))
            const reportFile = join(folder, "report.json")
            try {
                const { argv, env } = worldRun(kind, { full: flags.full, spec: flags.spec, workers }, reportFile)
                const run = await heavyCommand(argv, root, { env })
                let text = ""
                try {
                    text = readFileSync(reportFile, "utf8")
                } catch {
                    // the run wrote no report: the typecheck of the tests failed first, or jest found no spec
                }
                const lines = linesOf(text)
                const verdict = run.exitCode === 0 ? "passed" : "failed"
                const count = (outcome: WorldLine["outcome"]): number => lines.filter((line) => line.outcome === outcome).length
                const output = evidenceTail(run.stdout, run.stderr)
                const data: WorldData = {
                    kind,
                    argv,
                    cwd: root,
                    full: flags.full,
                    workers,
                    specs: flags.spec,
                    ran: count("ran"),
                    cached: count("cached"),
                    failed: count("failed"),
                    lines,
                    summary: lines.length === 0 ? "no spec file ran" : reportOf(lines),
                    exitCode: run.exitCode,
                    timedOut: run.timedOut,
                    verdict,
                    output,
                }
                const ran = `${argv.join(" ")} exited ${String(run.exitCode)} (${verdict})${run.timedOut ? ", killed at the deadline" : ""}`
                return { data, message: [data.summary, ran, ...(verdict === "failed" ? [output] : [])].join("\n"), exitCode: verdict === "passed" ? 0 : 1 }
            } finally {
                rmSync(folder, { recursive: true, force: true })
            }
        },
    })

export const testIntegrationVerb = worldVerb("integration")
export const testE2eVerb = worldVerb("e2e")
