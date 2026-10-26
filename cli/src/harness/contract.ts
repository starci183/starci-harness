import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { posix } from "node:path"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { primitiveCheckSchema } from "./ops.js"
import type { Ops, PrimitiveCheck } from "./ops.js"

/**
 * A repository path as the harness compares it: forward slashes, no `./` or `.` segments, no doubled or trailing slash.
 * The one normaliser of contract paths; a lease, a candidate and a files check all see the same spelling.
 */
export const normaliseRepoPath = (path: string): string => {
    const slashed = posix.normalize(path.trim().replace(/\\/g, "/"))
    return slashed === "/" ? slashed : slashed.replace(/\/+$/, "")
}

/** True when `file` is one of `prefixes` or lies below one of them, compared on whole segments. */
export const underPaths = (file: string, prefixes: readonly string[]): boolean => {
    const target = normaliseRepoPath(file)
    return prefixes.some((prefix) => {
        const normal = normaliseRepoPath(prefix)
        return normal === "." || target === normal || target.startsWith(`${normal}/`)
    })
}

/** The file name a json check uses to read the worker's filed result (its output json) instead of a file in the tree. */
export const RESULT_FILE = "@result"

const repoPathSchema = z.string().min(1).transform(normaliseRepoPath)

const argValueSchema = z.union([z.string(), z.number(), z.array(z.string())])

/** One entry of expectedOutput: a named preset with its arguments, or a primitive check written out. */
const expectedCheckSchema = z.union([
    z.object({ preset: z.string().min(1), args: z.record(z.string(), argValueSchema).optional() }),
    z.object({ check: primitiveCheckSchema }),
])

/** A task contract: what the receiver may read and write, what to do, and what the result must satisfy. */
export const contractSchema = z.object({
    schema: z.literal("starci/contract@1"),
    label: z.string().min(1),
    context: z.object({
        base: z.string().min(1),
        allowPaths: z.array(repoPathSchema).min(1),
        readPaths: z.array(repoPathSchema).optional(),
        cwd: repoPathSchema.optional(),
        /** Commands (argv) the clean checkout runs in cwd after install and before the checks, e.g. code generation. */
        setup: z.array(z.array(z.string().min(1)).min(1)).optional(),
    }),
    input: z.object({ summary: z.string().min(1), details: z.string().optional() }),
    expectedOutput: z.object({ checks: z.array(expectedCheckSchema).min(1) }),
    budget: z.object({ minutes: z.number().int().positive(), tries: z.number().int().positive().max(5) }),
})

/** A parsed contract. */
export type Contract = z.infer<typeof contractSchema>

/** One expected check after expansion, with where it came from and whether it proves behaviour. */
export interface ResolvedCheck {
    readonly name: string
    readonly behavioural: boolean
    readonly check: PrimitiveCheck
}

/** Schema-validates a contract and normalises its paths; every contract the harness holds comes through here. */
export const parseContract = (raw: unknown): Contract => {
    const parsed = contractSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("CONTRACT_INVALID", z.prettifyError(parsed.error))
    return parsed.data
}

/** Reads and schema-validates a contract file. */
export const readContract = (file: string): Contract => {
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("CONTRACT_UNREADABLE", `${file} is not readable json: ${error instanceof Error ? error.message : String(error)}`)
    }
    return parseContract(raw)
}

/** How a preset entry is written in expectedOutput, with its arguments, for messages that must show the exact form. */
export const presetForm = (name: string, args: readonly string[]): string =>
    JSON.stringify(args.length === 0 ? { preset: name } : { preset: name, args: Object.fromEntries(args.map((arg) => [arg, "..."])) })

/** Replaces `{name}` placeholders with the contract's arguments; a whole-value placeholder keeps the argument's type. */
const substitute = (value: unknown, args: Readonly<Record<string, z.infer<typeof argValueSchema>>>): unknown => {
    if (typeof value === "string") {
        const whole = /^\{([A-Za-z0-9_-]+)\}$/.exec(value)
        if (whole?.[1] !== undefined) return args[whole[1]] ?? value
        return value.replace(/\{([A-Za-z0-9_-]+)\}/g, (match: string, key: string) => {
            const arg = args[key]
            return arg === undefined ? match : Array.isArray(arg) ? arg.join(" ") : String(arg)
        })
    }
    if (Array.isArray(value)) return value.map((item) => substitute(item, args))
    if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, args)]))
    return value
}

/** Expands every expected check into a primitive one, refusing unknown presets and missing arguments. */
export const resolveChecks = (contract: Contract, ops: Ops): ResolvedCheck[] =>
    contract.expectedOutput.checks.map((entry, index): ResolvedCheck => {
        if ("check" in entry) return { name: `check-${String(index + 1)}:${entry.check.kind}`, behavioural: ["command", "json", "probe"].includes(entry.check.kind), check: entry.check }
        const preset = ops.presets[entry.preset]
        if (preset === undefined) throw new Refusal("CONTRACT_UNKNOWN_PRESET", `expectedOutput names an unknown preset: ${entry.preset}; presets: ${Object.keys(ops.presets).join(", ")}`)
        const args = entry.args ?? {}
        const missing = (preset.args ?? []).filter((name) => !(name in args))
        if (missing.length > 0) throw new Refusal("CONTRACT_PRESET_ARGS", `preset ${entry.preset} needs: ${missing.join(", ")}; write it as ${presetForm(entry.preset, preset.args ?? [])}`)
        const parsed = primitiveCheckSchema.safeParse(substitute(preset.check, args))
        if (!parsed.success) {
            throw new Refusal("CONTRACT_PRESET_ARGS", `preset ${entry.preset} does not expand to a valid check (write it as ${presetForm(entry.preset, preset.args ?? [])}): ${z.prettifyError(parsed.error)}`)
        }
        return { name: entry.preset, behavioural: preset.behavioural, check: parsed.data }
    })

/** The contract's identity: sha256 of its canonical json, so a replan can tell an unchanged task from a changed one. */
export const contractHash = (contract: Contract): string => {
    const canonical = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(canonical)
            : typeof value === "object" && value !== null
              ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
              : value
    return createHash("sha256").update(JSON.stringify(canonical(contract))).digest("hex")
}

// The product Work tree of a repository (Business/SRS, Architecture/SDS, features/...). A docs task writes a scope inside it, never
// the whole tree, just as no task is handed the whole repository.
const WORK_TREE = ".starciwork"

// allowPaths are literal paths, matched as `:(literal)` pathspecs and lease prefixes; a glob there would match nothing.
const GLOB = /[*?[\]{}!]/

const placeProblems = (what: string, path: string): string[] => [
    ...(GLOB.test(path) ? [`${what} "${path}" carries a glob character; name literal folders or files (a folder covers everything below it)`] : []),
    ...(path.split("/").includes("..") ? [`${what} "${path}" leaves the repository`] : []),
    ...(path.startsWith("/") || /^[A-Za-z]:/.test(path) ? [`${what} "${path}" must be repository-relative`] : []),
]

/** Problems that make a contract unfit to send, beyond its schema: label, paths and the behavioural rule. */
export const contractProblems = (contract: Contract, ops: Ops): string[] => {
    const problems: string[] = []
    const label = ops.labels[contract.label]
    if (label === undefined) problems.push(`unknown label ${contract.label}; labels: ${Object.keys(ops.labels).join(", ")}`)
    const seen = new Set<string>()
    for (const path of contract.context.allowPaths) {
        // The schema already normalised the entry, so `./src/` and `src` are the same path here.
        if (path === ".") problems.push(`allowPaths entry "${path}" is the whole repository; name concrete folders or files`)
        if (path === WORK_TREE) problems.push(`allowPaths entry "${path}" is the whole Work tree; name the scope inside it (for example ${WORK_TREE}/features/<feature>)`)
        problems.push(...placeProblems("allowPaths entry", path))
        if (seen.has(path)) problems.push(`allowPaths entry "${path}" is named twice`)
        seen.add(path)
    }
    if (contract.context.cwd !== undefined) problems.push(...placeProblems("cwd", contract.context.cwd))
    try {
        const checks = resolveChecks(contract, ops)
        if (label?.requireBehavioural === true && !checks.some((check) => check.behavioural)) {
            const forms = Object.entries(ops.presets)
                .filter(([, preset]) => preset.behavioural)
                .map(([name, preset]) => presetForm(name, preset.args ?? []))
            problems.push(
                `label ${contract.label} needs at least one behavioural check; lint and typecheck alone prove nothing about behaviour. Add one of these to expectedOutput.checks: ${forms.join(", ")}`,
            )
        }
    } catch (error: unknown) {
        problems.push(error instanceof Error ? error.message : String(error))
    }
    return problems
}
