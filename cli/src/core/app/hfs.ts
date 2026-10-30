import { hfsLimitsEnv } from "../../harness/heavy.js"
import { loadPolicy } from "../../harness/policy.js"
import { hostAgeIdentity } from "../../harness/secret-env.js"
import type { FlagSpec, VerbContext, VerbResult } from "../../shared/verb.js"
import { packageVersion } from "../version.js"

/** The `starci app` verbs @starci/hfs implements; each is one verb file of this folder. */
export type HfsVerb = "add" | "check" | "ci" | "codemod" | "coverage" | "db" | "emit" | "explain" | "hygiene" | "lint" | "new" | "release" | "scaffold" | "secret" | "stack" | "sync" | "upgrade"

/**
 * What the CLI hands @starci/hfs besides its version, for the verbs that use it: the caller's role an urgent release record names, and the
 * ticket queue a red release back-fill files its fix ticket into (returns the ticket id), and the harness secret.env's age identity
 * every verb that opens a sealed member reads last (`hostIdentity`, handed to @starci/hfs as its own io port, never inside
 * `harness`; `hostAgeIdentity` when the caller names none).
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

/** The operands of a forwarded argv that come before its first option: the action and what it names (`secret set <env> <slug> <KEY>`). */
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
 * Runs `starci app <verb>` in @starci/hfs, in-process, in the verb's working directory. In human mode its stdout and stderr
 * stream as it prints them and the CLI adds nothing; under `--json` the CLI passes `--json` to a verb that `printsJson` and
 * carries what it printed. The CLI passes its own version as `harness`: it is the starci-harness an app is judged and scaffolded at,
 * never a pin bundled in @starci/hfs. The exit code is @starci/hfs's (0 clean, 1 findings or red, 2 refusal or usage, 3 an unarmed mutation).
 * `stdin`, when given, replaces the process stdin of a verb that reads one (`app secret set`): what it returns stays in memory
 * and reaches @starci/hfs alone. `extra` adds the role and ticket queue of HfsHarness. The limits of ops/liveness.yaml @starci/hfs reads from its
 * environment (`hfsLimitsEnv`: the ESLint heap, the boot proof's budget) are set on this process first, so the children it spawns inherit them.
 */
export const runHfs = async (context: VerbContext, verb: HfsVerb, argv: readonly string[], printsJson: boolean, stdin?: () => string, extra: HfsHarness = {}): Promise<VerbResult<HfsRunData>> => {
    const full = context.json && printsJson ? [...argv, "--json"] : [...argv]
    let stdout = ""
    let stderr = ""
    Object.assign(process.env, hfsLimitsEnv(), { STARCI_GATE_ERROR_LIMIT: String(loadPolicy().quality.gate.errorLimit) })
    const { hostIdentity = hostAgeIdentity(), ...more } = extra
    const harness = { version: packageVersion(), ...more }
    const io = context.json
        ? { cwd: context.cwd, harness, stdin, hostIdentity, stdout: (text: string) => { stdout += text }, stderr: (text: string) => { stderr += text } }
        : { cwd: context.cwd, harness, stdin, hostIdentity, stdout: (text: string) => { process.stdout.write(text) }, stderr: (text: string) => { process.stderr.write(text) } }
    const { main } = await import("@starci/hfs")
    const exitCode = await main([verb, ...full], io)
    const data: HfsRunData = { verb, argv: full, exitCode, output: context.json ? parsed(stdout.trim()) : null, stderr }
    return { data, message: "", exitCode }
}
