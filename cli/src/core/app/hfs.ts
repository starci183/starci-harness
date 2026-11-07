import { spawnSync } from "node:child_process"
import { availableParallelism, freemem } from "node:os"
import { heavyRoomMb, hfsLimitsEnv, loadHeavyRules, testWorkerArgs, withHeavySlot, withOomNote } from "../../harness/heavy.js"
import { peakProbe } from "../../harness/peak-rss.js"
import { appRootOf, formatPlan, MEMORY_PLAN_ENV, MEMORY_REEXEC_ENV, measureScope, needsReexec, planMemory } from "../../harness/memory-plan.js"
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

/** What the CLI reads of a node child request beyond the shape of the installed @starci/hfs: what @starci/hfs 6.2 names. */
type NodeRequest = HeavyNodeRequest & {
    readonly files?: number | undefined
    readonly workers?: number | undefined
    readonly onAdmit?: ((admitted: { readonly workers?: number | undefined; readonly heapMb?: number | undefined }) => void) | undefined
}

/**
 * The HFS child execution port: admission and worker limits apply to each actual Node tool, each child admitted by the governor on its own (`app check`
 * itself holds no slot: it orchestrates). A request that names the number of files it judges (`files`) has its kind's liveness budget scaled with it
 * (`heavyTimeoutMinutes`); one that names `workers` caps a test run's workers at them. Each runs under its heap cap, a test run with the workers the RAM
 * free at its admission holds (`withHeavySlot`); `onAdmit` is told what it was admitted with, and the answer carries the tree's measured RAM peak (`peakProbe`).
 */
export const hfsNodeRunner = (admit = withHeavySlot, capture = captureCommand): HeavyNodeRun => async (request: NodeRequest) => {
    const probe = peakProbe()
    const inherited = request.env === undefined ? process.env.NODE_OPTIONS ?? "" : request.env.NODE_OPTIONS ?? ""
    let workers: number | undefined
    const ran = await admit(
        request.kind,
        request.label,
        request.cwd,
        {
            baseEnv: request.env ?? process.env,
            env: probe.env(inherited),
            captureBytes: request.maxBuffer,
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
            ...(request.files === undefined ? {} : { files: request.files }),
            ...(request.workers === undefined ? {} : { workers: request.workers }),
        },
        async (held) => {
            workers = held.test?.workers
            request.onAdmit?.({ workers, heapMb: held.heapMb })
            const argv = [process.execPath, ...request.args]
            const run = withOomNote(await capture(request.kind === "test" && !argv.includes("--runInBand") ? testWorkerArgs(argv, held) : argv, request.cwd, held.options), held)
            return {
                status: run.timedOut ? null : run.exitCode,
                signal: null,
                stdout: run.stdout,
                stderr: run.stderr,
                ...(run.timedOut ? { error: Object.assign(new Error("child deadline reached"), { code: "ETIMEDOUT" }) } : {}),
            }
        },
    )
    const peakMb = probe.peakMb(workers)
    return peakMb === undefined ? ran : { ...ran, peakMb }
}

/**
 * The memory plan of an app check (memory-plan.ts): measured on the app at `appRoot`, set in this process's environment for @starci/hfs and the node
 * runner, and printed under `--explain`. When node's heap is below the planned parent heap the check re-executes itself under it and this returns
 * the exit code of that run; otherwise undefined, and the check goes on here.
 */
export const applyMemoryPlan = (appRoot: string, argv: readonly string[], write: (text: string) => void): number | undefined => {
    const plan = planMemory(measureScope(appRoot), loadHeavyRules())
    if (plan === null) return undefined
    process.env[MEMORY_PLAN_ENV] = JSON.stringify(plan)
    if (argv.includes("--explain")) write(`${formatPlan(plan, loadHeavyRules(), Math.floor(freemem() / 1_048_576), availableParallelism()).join("\n")}\n`)
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
 * The governed runner of the dev verbs' heavy commands (`starci app stack up`: `npm ci`, a compose build or up) and of an app check's CI-parity steps and
 * Sonar scan: one slot of the host-wide semaphore per command, run without a shell, the result handed back as the spawn seam's shape with the tree's
 * measured RAM peak; `onAdmit`, when the request names one, is told once it was admitted.
 */
export const hfsCommandRunner = (admit = withHeavySlot, capture = captureCommand): HeavyCommandRun => async (request: Parameters<HeavyCommandRun>[0] & { readonly onAdmit?: ((admitted: { readonly heapMb?: number | undefined }) => void) | undefined }) => {
    const probe = peakProbe()
    const ran = await admit(request.kind, request.label, request.cwd, { baseEnv: request.env, env: probe.env(request.env.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? "") }, async (held) => {
        request.onAdmit?.({ heapMb: held.heapMb })
        const run = await capture(request.argv, request.cwd, held.options)
        return {
            status: run.timedOut ? null : run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
            ...(run.timedOut ? { error: Object.assign(new Error("child deadline reached"), { code: "ETIMEDOUT" }) } : {}),
        }
    })
    const peakMb = probe.peakMb()
    return peakMb === undefined ? ran : { ...ran, peakMb }
}

/**
 * Runs `starci app <verb>` in @starci/hfs, in-process, in the verb's working directory. Its stderr (an app check's progress) streams
 * as it prints it in either mode; in human mode its stdout streams too and the CLI adds nothing, and under `--json` the CLI passes
 * `--json` to a verb that `printsJson` and carries what it printed in the one envelope on stdout. The CLI passes its own version as `harness`: it is the starci-harness an app is judged and scaffolded at,
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
    const heavyRoom = (): number => heavyRoomMb()
    const io = context.json
        ? { cwd: context.cwd, harness, stdin, hostIdentity, runHeavyNode, heavyRoom, stackIo, stdout: (text: string) => { stdout += text }, stderr: (text: string) => { stderr += text; process.stderr.write(text) } }
        : { cwd: context.cwd, harness, stdin, hostIdentity, runHeavyNode, heavyRoom, stackIo, stdout: (text: string) => { process.stdout.write(text) }, stderr: (text: string) => { process.stderr.write(text) } }
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
