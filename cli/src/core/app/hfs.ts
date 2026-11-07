import { spawnSync } from "node:child_process"
import { relative } from "node:path"
import { hfsLimitsEnv, loadHeavyRules, testWorkerArgs, withHeavySlot, type HeavyPlanned } from "../../harness/heavy.js"
import { appRootOf, formatPlan, learnPeak, MEMORY_PLAN_ENV, MEMORY_REEXEC_ENV, measureScope, needsReexec, planInForce, planMemory, readFactors, sideOf, type MemoryPlan } from "../../harness/memory-plan.js"
import { listProcesses } from "../../harness/process-table.js"
import { captureCommand } from "../../shared/exec.js"
import type { HeavyNodeRequest, HeavyNodeRun } from "@starci/hfs/runtime/scripts/api/node/run-node.mjs"
import type { HeavyCommandRun } from "@starci/hfs"
import { loadPolicy } from "../../harness/policy.js"
import { hostAgeIdentity } from "../../harness/secret-env.js"
import type { FlagSpec, VerbContext, VerbResult } from "../../shared/verb.js"
import { packageVersion } from "../version.js"

/** The `starci app` verbs @starci/hfs implements; each is one verb file of this folder. */
export type HfsVerb = "add" | "remove" | "check" | "ci" | "codemod" | "coverage" | "db" | "emit" | "release" | "scaffold" | "secret" | "slot" | "stack" | "sync" | "upgrade" | "world"

/**
 * What the CLI hands @starci/hfs besides its version, for the verbs that use it: the caller's role an urgent release record names, and the
 * ticket queue a red release back-fill files its fix ticket into (returns the ticket id), and the harness secret.env's age identity
 * every verb that opens a sealed member reads last (`hostIdentity`, handed to @starci/hfs as its own io port, never inside
 * `harness`; `hostAgeIdentity` of the verb's working directory when the caller names none: this CLI's secret.env, then the harness home's).
 */
export interface HfsHarness {
    readonly hostIdentity?: { readonly label: string; readonly read: () => string | undefined }
    readonly role?: string
    readonly openTicket?: (input: { readonly title: string; readonly tail: string; readonly code: string; readonly tag: string; readonly head: string }) => string | null
}

/** What one `starci app` run did: the @starci/hfs argv, its exit code and, under `--json`, what it printed. */
export interface HfsRunData {
    readonly verb: HfsVerb
    readonly argv: readonly string[]
    readonly exitCode: number
    /** The parsed json report of a verb that prints one, else its stdout text; null outside `--json`, where it streamed. */
    readonly output: unknown
    readonly stderr: string
}

/**
 * The one flag of a `starci app` verb: every argument after its path, handed to @starci/hfs as typed. @starci/hfs owns the
 * verb's flags, their parsing and its help (`starci app <verb> --help`); the CLI declares none of them.
 */
export const FORWARDED = {
    args: { kind: "rest", summary: "the verb's arguments and flags, as @starci/hfs takes them (starci app <verb> --help prints them)" },
} as const satisfies Readonly<Record<string, FlagSpec>>

/** Where `--name` stands in an argv (`--name value` or `--name=value`), before any `--`. */
const indexesOf = (args: readonly string[], name: string): number[] => {
    const end = args.includes("--") ? args.indexOf("--") : args.length
    return args.slice(0, end).flatMap((token, at) => (token === `--${name}` || token.startsWith(`--${name}=`) ? [at] : []))
}

/**
 * The value of the last `--name` of a forwarded argv, for the few flags the CLI reads before it forwards (the CI gate of a
 * production deploy, an executed release); @starci/hfs still parses and judges them.
 */
export const argValue = (args: readonly string[], name: string): string | undefined => {
    const at = indexesOf(args, name).at(-1)
    if (at === undefined) return undefined
    const token = args[at] ?? ""
    return token.includes("=") ? token.slice(token.indexOf("=") + 1) : args[at + 1]
}

/** Whether a forwarded argv sets the boolean `--name` (given bare, or `=true`). */
export const argSet = (args: readonly string[], name: string): boolean =>
    indexesOf(args, name).some((at) => {
        const token = args[at] ?? ""
        return !token.includes("=") || token.slice(token.indexOf("=") + 1) === "true"
    })

/** A forwarded argv without `--name` and its value: a flag the CLI resolves itself and @starci/hfs never sees. */
export const withoutArg = (args: readonly string[], name: string): string[] => {
    const drop = new Set(indexesOf(args, name).flatMap((at) => ((args[at] ?? "").includes("=") ? [at] : [at, at + 1])))
    return args.filter((_token, at) => !drop.has(at))
}

/** The operands of a forwarded argv that come before its first option: the action and what it names (`secret set <slug> <KEY>`, its `--env` aside). */
export const leadingOperands = (args: readonly string[]): string[] => {
    const first = args.findIndex((token) => token.startsWith("-"))
    return first < 0 ? [...args] : args.slice(0, first)
}

const parsed = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return text
    }
}

/**
 * The side of the app a child judges, for its memory plan: a test runner's working folder (`<app>/be`), else the tsconfig a tsc names (`-p fe/...`).
 */
export const requestSide = (request: Pick<HeavyNodeRequest, "args" | "cwd">, appRoot: string): string | null => {
    const project = request.args.indexOf("-p")
    const named = project >= 0 ? request.args[project + 1] : undefined
    if (named !== undefined) return sideOf(named.replaceAll("\\", "/"))
    return sideOf(relative(appRoot, request.cwd).replaceAll("\\", "/"))
}

/** What the plan in force sizes for one child: a coverage run's parent and workers, a tsc program's heap; nothing for any other child. */
export const plannedFor = (plan: MemoryPlan | null, request: Pick<HeavyNodeRequest, "kind" | "args" | "cwd">, appRoot: string): HeavyPlanned | undefined => {
    if (plan === null) return undefined
    const side = requestSide(request, appRoot)
    const sized = side === null ? undefined : plan.sides[side]
    if (sized === undefined) return undefined
    if (request.kind === "tsc") return { memoryMb: sized.typesMb }
    if (request.kind === "test" && request.args.includes("--coverage")) return { memoryMb: sized.testParentMb, workerMb: sized.testWorkerMb, workers: sized.workers }
    return undefined
}

/** The root of the app the plan was measured on, where its factors are learned. */
const PLAN_ROOT_ENV = "STARCI_MEMORY_PLAN_ROOT"
const PEAK_SAMPLE_MS = 15_000

/** Samples the resident memory of `pid` (the parent) and of its descendants (each worker) until stopped; the peaks in MB. */
const samplePeaks = (pid: number): { readonly stop: () => Promise<{ readonly parentMb: number; readonly workerMb: number }> } => {
    let parentMb = 0
    let workerMb = 0
    let pending: Promise<void> = Promise.resolve()
    const sample = (): void => {
        pending = listProcesses()
            .then((table) => {
                if (typeof table === "string") return
                const children = new Map<number, number[]>()
                for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid])
                const memory = new Map(table.map((row) => [row.pid, row.workingSetMb] as const))
                parentMb = Math.max(parentMb, memory.get(pid) ?? 0)
                const walk = (at: number): void => {
                    for (const child of children.get(at) ?? []) {
                        workerMb = Math.max(workerMb, memory.get(child) ?? 0)
                        walk(child)
                    }
                }
                walk(pid)
            })
            .catch(() => undefined)
    }
    const timer = setInterval(sample, PEAK_SAMPLE_MS)
    timer.unref()
    return {
        stop: async () => {
            clearInterval(timer)
            await pending
            return { parentMb, workerMb }
        },
    }
}

/** Learns the sampled peaks of a planned child for the app's next run, printing a warning for each that ran over its plan. */
const learnPeaks = async (sampler: ReturnType<typeof samplePeaks>, planned: HeavyPlanned, kind: string, appRoot: string): Promise<void> => {
    if (planned.memoryMb === undefined) return
    const peaks = await sampler.stop()
    const above = loadHeavyRules().plan?.learnAbovePercent ?? 20
    const warnings = [learnPeak(appRoot, kind, planned.memoryMb, peaks.parentMb, above), planned.workerMb === undefined ? null : learnPeak(appRoot, kind, planned.workerMb, peaks.workerMb, above, true)]
    for (const warning of warnings) if (warning !== null) process.stderr.write(`${warning}\n`)
}

/**
 * The HFS child execution port: admission and worker limits apply to each actual Node tool. A request that names the number of files it judges
 * (`files`, @starci/hfs releases after 5.0.7) has its kind's liveness budget scaled with it (`heavyTimeoutMinutes`). Under a memory plan
 * (`STARCI_MEMORY_PLAN`, set by `app check`) a coverage run and a tsc program run at their planned heaps, admission holds those, and their sampled
 * peaks are learned for the app's next run.
 */
export const hfsNodeRunner = (admit = withHeavySlot, capture = captureCommand): HeavyNodeRun => async (request: HeavyNodeRequest & { readonly files?: number | undefined }) => {
    const appRoot = process.env[PLAN_ROOT_ENV] ?? request.cwd
    const planned = plannedFor(planInForce(), request, appRoot)
    let sampler: ReturnType<typeof samplePeaks> | undefined
    const onSpawn = (pid: number): void => {
        sampler = samplePeaks(pid)
    }
    const result = await admit(
        request.kind,
        request.label,
        request.cwd,
        {
            baseEnv: request.env ?? process.env,
            env: { NODE_OPTIONS: request.env === undefined ? process.env.NODE_OPTIONS ?? "" : request.env.NODE_OPTIONS ?? "" },
            captureBytes: request.maxBuffer,
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
            ...(request.files === undefined ? {} : { files: request.files }),
            ...(planned === undefined ? {} : { onSpawn }),
        },
        async (held) => {
            const argv = [process.execPath, ...request.args]
            const run = await capture(request.kind === "test" && !argv.includes("--runInBand") ? testWorkerArgs(argv, held) : argv, request.cwd, held.options)
            return {
                status: run.timedOut ? null : run.exitCode,
                signal: null,
                stdout: run.stdout,
                stderr: run.stderr,
                ...(run.timedOut ? { error: Object.assign(new Error("child deadline reached"), { code: "ETIMEDOUT" }) } : {}),
            }
        },
        planned,
    )
    if (sampler !== undefined && planned !== undefined) await learnPeaks(sampler, planned, request.kind, appRoot)
    return result
}

/**
 * The memory plan of an app check (memory-plan.ts): measured on the app at `appRoot`, set in this process's environment for @starci/hfs and the node
 * runner, and printed under `--explain`. When node's heap is below the planned parent heap the check re-executes itself under it and this returns
 * the exit code of that run; otherwise undefined, and the check goes on here.
 */
export const applyMemoryPlan = (appRoot: string, argv: readonly string[], write: (text: string) => void): number | undefined => {
    const scope = measureScope(appRoot)
    if (scope === null) return undefined
    const plan = planMemory(scope, loadHeavyRules(), undefined, undefined, readFactors(appRoot))
    if (plan === null) return undefined
    process.env[MEMORY_PLAN_ENV] = JSON.stringify(plan)
    process.env[PLAN_ROOT_ENV] = appRoot
    if (argv.includes("--explain")) write(`${formatPlan(plan).join("\n")}\n`)
    if (!needsReexec(plan)) return undefined
    const kept = (process.env.NODE_OPTIONS ?? "").replaceAll(/--max-old-space-size=\d+/g, "").trim()
    const flags = process.execArgv.filter((flag) => !flag.startsWith("--max-old-space-size"))
    const run = spawnSync(process.execPath, [`--max-old-space-size=${String(plan.parentMb)}`, ...flags, ...process.argv.slice(1)], {
        stdio: "inherit",
        env: { ...process.env, [MEMORY_REEXEC_ENV]: "1", NODE_OPTIONS: kept },
    })
    return run.status ?? 1
}

/**
 * The governed runner of the dev verbs' heavy commands (`starci app stack up`: `npm ci`, a compose build or up): one slot of the host-wide
 * semaphore per command, run without a shell, the result handed back as the spawn seam's shape.
 */
export const hfsCommandRunner = (admit = withHeavySlot, capture = captureCommand): HeavyCommandRun => async (request) =>
    admit(request.kind, request.label, request.cwd, { baseEnv: request.env }, async (held) => {
        const run = await capture(request.argv, request.cwd, held.options)
        return {
            status: run.timedOut ? null : run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
            ...(run.timedOut ? { error: Object.assign(new Error("child deadline reached"), { code: "ETIMEDOUT" }) } : {}),
        }
    }, buildPlanned(planInForce(), request.kind))

/** A CI build step of an app check (`build` family: the typecheck script, build:be, next build) runs at the largest tsc heap the plan gives a side. */
export const buildPlanned = (plan: MemoryPlan | null, kind: string): HeavyPlanned | undefined => {
    if (plan === null || kind !== "build") return undefined
    const heaps = Object.values(plan.sides).flatMap((sized) => (sized === undefined ? [] : [sized.typesMb]))
    return heaps.length === 0 ? undefined : { memoryMb: Math.max(...heaps) }
}

/**
 * Runs `starci app <verb>` in @starci/hfs, in-process, in the verb's working directory. In human mode its stdout and stderr
 * stream as it prints them and the CLI adds nothing; under `--json` the CLI passes `--json` to a verb that `printsJson` and
 * carries what it printed. The CLI passes its own version as `harness`: it is the starci-harness an app is judged and scaffolded at,
 * never a pin bundled in @starci/hfs. The exit code is @starci/hfs's (0 clean, 1 findings or red, 2 refusal or usage, 3 an unarmed mutation).
 * `stdin`, when given, replaces the process stdin of a verb that reads one (`app secret set`): what it returns stays in memory
 * and reaches @starci/hfs alone. `extra` adds the role and ticket queue of HfsHarness. The limits of ops/liveness.yaml @starci/hfs reads from its
 * environment (`hfsLimitsEnv`: the ESLint heap, the boot proof's budget) and the branch profile policy are set on this process
 * first, so the children it spawns inherit them.
 */
export const runHfs = async (context: VerbContext, verb: HfsVerb, argv: readonly string[], printsJson: boolean, stdin?: () => string, extra: HfsHarness = {}): Promise<VerbResult<HfsRunData>> => {
    const full = context.json && printsJson ? [...argv, "--json"] : [...argv]
    let stdout = ""
    let stderr = ""
    // What an app's branch profile may lower (policy/loosening.yaml branchProfiles, after the
    // app's own overlay narrowed it), which @starci/hfs reads from its environment.
    const policy = loadPolicy(context.treeRoot)
    Object.assign(process.env, hfsLimitsEnv(), {
        STARCI_PROFILE_BRANCHES: policy.loosening.branchProfiles.branches.join(","),
        STARCI_PROFILE_GATES: policy.loosening.branchProfiles.gates.join(","),
    })
    const { hostIdentity = hostAgeIdentity(context.cwd), ...more } = extra
    const harness = { version: packageVersion(), ...more }
    const runHeavyNode = hfsNodeRunner()
    const stackIo = { heavy: hfsCommandRunner() }
    const io = context.json
        ? { cwd: context.cwd, harness, stdin, hostIdentity, runHeavyNode, stackIo, stdout: (text: string) => { stdout += text }, stderr: (text: string) => { stderr += text } }
        : { cwd: context.cwd, harness, stdin, hostIdentity, runHeavyNode, stackIo, stdout: (text: string) => { process.stdout.write(text) }, stderr: (text: string) => { process.stderr.write(text) } }
    if (verb === "check") {
        // The memory plan (memory-plan.ts): a check whose parent heap is below its plan ran again under it, and that run printed everything.
        const rerun = applyMemoryPlan(appRootOf(context.cwd), full, io.stdout)
        if (rerun !== undefined) process.exit(rerun)
    }
    const { main } = await import("@starci/hfs")
    const exitCode = await main([verb, ...full], io)
    const data: HfsRunData = { verb, argv: full, exitCode, output: context.json ? parsed(stdout.trim()) : null, stderr }
    return { data, message: "", exitCode }
}
