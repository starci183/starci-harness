import { z } from "zod"
import { hfsLimitsEnv } from "../../harness/heavy.js"
import { UsageError } from "../../shared/errors.js"
import type { FlagSpec, VerbContext, VerbResult } from "../../shared/verb.js"
import { packageVersion } from "../version.js"

/** The `starci app` verbs @starci/hfs implements; each is one verb file of this folder. */
export type HfsVerb = "add" | "check" | "ci" | "codemod" | "coverage" | "db" | "emit" | "explain" | "hygiene" | "lint" | "new" | "release" | "scaffold" | "secret" | "stack" | "sync" | "upgrade"

/**
 * What the CLI hands @starci/hfs besides its version, for the verbs that use it: the caller's role an urgent release record names, and the
 * ticket queue a red release back-fill files its fix ticket into (returns the ticket id).
 */
export interface HfsHarness {
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

/** `--quiet`, which every `starci app` verb takes: @starci/hfs prints no human chatter. */
export const QUIET_FLAG = {
    quiet: { kind: "boolean", summary: "suppress human-readable chatter" },
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `--edition`, taken where an app is created or judged (scaffold, check, upgrade). */
export const EDITION_FLAG = {
    edition: { kind: "string", summary: "app edition, full or lite" },
} as const satisfies Readonly<Record<string, FlagSpec>>

/** The values of `--edition`. */
export const EDITION = z.enum(["full", "lite"])

/** A flag value that is a finite number, kept as its text for @starci/hfs. */
export const NUMBER = z.string().refine((value) => value.trim() !== "" && Number.isFinite(Number(value)), "a number")

type FlagValue = string | boolean | readonly string[] | undefined

const spellingOf = (name: string, spec: FlagSpec): string => (spec.positional === true || spec.kind === "rest" ? name : `--${name}`)

/** The text values of a flag: one for a string, each for a list or rest, none for a boolean or an absent flag. */
const textsOf = (value: FlagValue): readonly string[] => {
    if (typeof value === "string") return [value]
    return typeof value === "object" ? value : []
}

/** Refuses a value outside its flag's schema as usage, naming the flag and never echoing the value. */
const checkChoice = (name: string, spec: FlagSpec, schema: z.ZodType<string>, value: FlagValue): void => {
    for (const entry of textsOf(value)) {
        if (schema.safeParse(entry).success) continue
        const allowed = schema instanceof z.ZodEnum ? `one of: ${schema.options.join(", ")}` : "a number"
        throw new UsageError(`${spellingOf(name, spec)} expects ${allowed}`)
    }
}

/**
 * The @starci/hfs arguments of a verb's typed flags: its positionals in declared order, then each given option (a list flag
 * once per value), every value first checked against its schema in `choices`.
 */
export const hfsArgv = (specs: Readonly<Record<string, FlagSpec>>, values: Readonly<Record<string, FlagValue>>, choices: Readonly<Record<string, z.ZodType<string>>> = {}): string[] => {
    const operands: string[] = []
    const options: string[] = []
    for (const [name, spec] of Object.entries(specs)) {
        const value = values[name]
        const schema = choices[name]
        if (schema !== undefined) checkChoice(name, spec, schema, value)
        if (spec.positional === true || spec.kind === "rest") operands.push(...textsOf(value))
        else if (value === true) options.push(`--${name}`)
        else options.push(...textsOf(value).flatMap((entry) => [`--${name}`, entry]))
    }
    return [...operands, ...options]
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
    Object.assign(process.env, hfsLimitsEnv())
    const harness = { version: packageVersion(), ...extra }
    const io = context.json
        ? { cwd: context.cwd, harness, stdin, stdout: (text: string) => { stdout += text }, stderr: (text: string) => { stderr += text } }
        : { cwd: context.cwd, harness, stdin, stdout: (text: string) => { process.stdout.write(text) }, stderr: (text: string) => { process.stderr.write(text) } }
    const { main } = await import("@starci/hfs")
    const exitCode = await main([verb, ...full], io)
    const data: HfsRunData = { verb, argv: full, exitCode, output: context.json ? parsed(stdout.trim()) : null, stderr }
    return { data, message: "", exitCode }
}
