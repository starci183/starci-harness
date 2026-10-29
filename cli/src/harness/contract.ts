import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { contractCiteProblems, fillCiteCheck } from "./cite.js"
import { BEHAVIOURAL_KINDS, checkEntrySchema, entryApplies, entryFile, entryShared, keyNameSchema, outputSpecSchema, placeholdersOf, primitiveCheckSchema, trustTier } from "./ops.js"
import type { CheckArgs, CheckEntry, Op, Ops, OutputSpec, OutputType, PrimitiveCheck, TrustTier } from "./ops.js"
import { loadPolicy, neverRead } from "./policy.js"
import { rulePagesOf } from "./rule-pages.js"

/**
 * A repository path as the harness compares it: forward slashes, no `./` or `.` segments, no doubled or trailing slash.
 * The one normaliser of contract paths; a candidate, a preserve and a files check all see the same spelling.
 */
export const normaliseRepoPath = (path: string): string => {
    const slashed = posix.normalize(path.trim().replaceAll("\\", "/"))
    if (slashed === "/") return slashed
    let end = slashed.length
    while (end > 0 && slashed[end - 1] === "/") end -= 1
    return slashed.slice(0, end)
}

/**
 * Two repository paths overlap when one equals the other or is a directory prefix of it, compared segment by segment and
 * without case; `.` is the whole repository. `Src/A` and `src/a` are one path on every host: a product is checked out on
 * Windows and macOS too, where they are one file.
 */
export const pathsOverlap = (left: string, right: string): boolean => {
    const spell = (path: string): string[] => normaliseRepoPath(path).toLowerCase().split("/")
    const a = spell(left)
    const b = spell(right)
    if (a[0] === "." || b[0] === ".") return true
    const shorter = a.length <= b.length ? a : b
    const longer = shorter === a ? b : a
    return shorter.every((segment, index) => segment === longer[index])
}

/** The paths a task may write: its contract's allowPaths, normalised and without duplicates. */
export const taskPaths = (task: { readonly contract: { readonly context: { readonly allowPaths: readonly string[] } } }): string[] => [...new Set(task.contract.context.allowPaths.map(normaliseRepoPath))]

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

/** The schema tag of a contract the harness writes. */
export const CONTRACT_SCHEMA = "starci/contract@2"

/** The schema tag of a contract written before the op pattern; it is still read, as the equivalent contract@2. */
export const LEGACY_CONTRACT_SCHEMA = "starci/contract@1"

/** The prefix of a context entry that names a file of the harness checkout instead of the repository. */
export const HARNESS_PREFIX = "harness:"

// The product Work tree of a repository (Business/SRS, Architecture/SDS, features/...). A docs task writes a scope inside it, never
// the whole tree, just as no task is handed the whole repository; a task whose context reads it is work-driven.
const WORK_TREE = ".starciwork"

const repoPathSchema = z.string().min(1).transform(normaliseRepoPath)

/** A context entry as the harness compares it: `harness:` plus a normalised path, or a normalised repository path. */
export const normaliseContextEntry = (entry: string): string =>
    entry.startsWith(HARNESS_PREFIX) ? `${HARNESS_PREFIX}${normaliseRepoPath(entry.slice(HARNESS_PREFIX.length))}` : normaliseRepoPath(entry)

const contextEntrySchema = z.string().min(1).transform(normaliseContextEntry)

const namedInputsSchema = z.record(keyNameSchema, z.string().min(1))

const outputKeysSchema = z.record(keyNameSchema, outputSpecSchema)

/** The budget of a contract whose writer names none: `contract new`, an inline workflow task and a uat contract built from a Work record. */
export const DEFAULT_BUDGET = { minutes: 60, tries: 3 } as const

const budgetSchema = z.strictObject({ minutes: z.number().int().positive(), tries: z.number().int().positive().max(5) })

/** Commands (argv) the clean checkout runs in cwd after install and before the checks, e.g. code generation. */
const setupSchema = z.array(z.array(z.string().min(1)).min(1))

/**
 * A task contract: what the receiver may read and write, what to do, and what the result must satisfy. Each of context,
 * input, output and checks has a `base`, owned by the label's op file, and an `extend`, the Kernel's part, which only adds.
 * A contract may pin a copy of the base; `contract check` refuses one that drops or loosens an item of the op's base.
 * `cites` are the anchor ids the task answers for (harness/cite.ts): an author (an op whose output carries `cites`) must cite
 * each, a grader (one whose output carries `citeGrades`) must grade each; every one must resolve in the contexts.
 */
export const contractSchema = z.strictObject({
    schema: z.literal(CONTRACT_SCHEMA),
    label: z.string().min(1),
    context: z.strictObject({
        revision: z.string().min(1),
        allowPaths: z.array(repoPathSchema).min(1),
        cwd: repoPathSchema.optional(),
        setup: setupSchema.optional(),
        /** The task that composes the module this task writes (its plan key in the workflow): the composition rules of policy/quality.yaml are deferred to it. */
        composedBy: z.string().min(1).optional(),
        base: z.array(contextEntrySchema).optional(),
        extend: z.array(contextEntrySchema).optional(),
    }),
    input: z.strictObject({ summary: z.string().min(1), details: z.string().optional(), base: namedInputsSchema.optional(), extend: namedInputsSchema.optional() }),
    output: z.strictObject({ base: outputKeysSchema.optional(), extend: outputKeysSchema.optional() }).optional(),
    checks: z.strictObject({ base: z.array(checkEntrySchema).optional(), extend: z.array(checkEntrySchema).optional() }).optional(),
    cites: z.array(z.string().min(1)).optional(),
    budget: budgetSchema,
})

/** A parsed contract. */
export type Contract = z.output<typeof contractSchema>

// contract@1: `context.base` was the revision, `readPaths` the files to read and `expectedOutput.checks` every check.
const legacyContractSchema = z.object({
    schema: z.literal(LEGACY_CONTRACT_SCHEMA),
    label: z.string().min(1),
    context: z.object({ base: z.string().min(1), allowPaths: z.array(z.string()), readPaths: z.array(z.string()).optional(), cwd: z.string().optional(), setup: setupSchema.optional() }),
    input: z.object({ summary: z.string(), details: z.string().optional() }),
    expectedOutput: z.object({ checks: z.array(z.unknown()) }),
    budget: z.unknown(),
})

/** The contract@2 a contract@1 means: readPaths become context.extend and its checks checks.extend; the op adds its base. */
const fromLegacy = (legacy: z.infer<typeof legacyContractSchema>): unknown => ({
    schema: CONTRACT_SCHEMA,
    label: legacy.label,
    context: {
        revision: legacy.context.base,
        allowPaths: legacy.context.allowPaths,
        ...(legacy.context.cwd === undefined ? {} : { cwd: legacy.context.cwd }),
        ...(legacy.context.setup === undefined ? {} : { setup: legacy.context.setup }),
        ...(legacy.context.readPaths === undefined || legacy.context.readPaths.length === 0 ? {} : { extend: legacy.context.readPaths }),
    },
    input: { summary: legacy.input.summary, ...(legacy.input.details === undefined ? {} : { details: legacy.input.details }) },
    checks: { extend: legacy.expectedOutput.checks },
    budget: legacy.budget,
})

/** One expected check after expansion: its trust tier, and whether it proves behaviour (never when the tier is T2). */
export interface ResolvedCheck {
    readonly name: string
    readonly tier: TrustTier
    readonly behavioural: boolean
    readonly check: PrimitiveCheck
}

/** Schema-validates a contract and normalises its paths; a contract@1 is read as its contract@2. Every contract the harness holds comes through here. */
export const parseContract = (raw: unknown): Contract => {
    let value = raw
    if (typeof raw === "object" && raw !== null && "schema" in raw && raw.schema === LEGACY_CONTRACT_SCHEMA) {
        const legacy = legacyContractSchema.safeParse(raw)
        if (!legacy.success) throw new Refusal("CONTRACT_INVALID", `a ${LEGACY_CONTRACT_SCHEMA} contract: ${z.prettifyError(legacy.error)}`)
        value = fromLegacy(legacy.data)
    }
    const parsed = contractSchema.safeParse(value)
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

/** How a preset entry is written in a check list, with its arguments, for messages that must show the exact form. */
export const presetForm = (name: string, args: readonly string[]): string =>
    JSON.stringify(args.length === 0 ? { preset: name } : { preset: name, args: Object.fromEntries(args.map((arg) => [arg, "..."])) })

/** The default order of strings (by UTF-16 code unit), spelled out so hashes and listings stay the same on every locale. */
export const byCodeUnit = (left: string, right: string): number => {
    if (left < right) return -1
    return left > right ? 1 : 0
}

const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (typeof value !== "object" || value === null) return value
    return Object.fromEntries(Object.keys(value).sort(byCodeUnit).map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
}

const sameEntry = (left: CheckEntry, right: CheckEntry): boolean => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))

/**
 * Where a resolved item came from: the op file's base, or the contract (its pinned base or its extend). A context file may
 * also come from the task's `paths`: a page owning a rule that governs a path under its allowPaths (rule-pages.ts).
 */
export type Source = "base" | "extend" | "paths"

/** One file the task reads, resolved: `harness` files live in the harness checkout, the others in the repository; a `shared` one is never cited. */
export interface ContextFile {
    readonly entry: string
    readonly source: Source
    readonly harness: boolean
    readonly path: string
    readonly shared: boolean
}

/** One named input with its value. */
export interface ResolvedInput {
    readonly name: string
    readonly value: string
    readonly source: Source
    readonly summary?: string
}

/** One key the worker's output must carry. */
export interface ResolvedOutput {
    readonly key: string
    readonly spec: OutputSpec
    readonly source: Source
}

/** The contract as the worker works it: base ∪ extend of every part, and the problems that make it unfit. */
export interface ResolvedContract {
    readonly op: Op
    readonly context: readonly ContextFile[]
    readonly inputs: readonly ResolvedInput[]
    readonly output: readonly ResolvedOutput[]
    readonly checks: readonly { readonly entry: CheckEntry; readonly source: Source }[]
    readonly workDriven: boolean
    readonly problems: readonly string[]
}

/** The op of a contract's label, refusing an unknown label. */
export const opOf = (contract: Contract, ops: Ops): Op => {
    const op = ops.labels[contract.label]
    if (op === undefined) throw new Refusal("CONTRACT_UNKNOWN_LABEL", `unknown label ${contract.label}; labels: ${Object.keys(ops.labels).join(", ")}`)
    return op
}

const fill = (entry: string, values: Readonly<Record<string, string>>): string => entry.replace(/\{([A-Za-z]\w*)\}/g, (match: string, key: string) => values[key] ?? match)

/** True when `entry` is not looser than `base`: same type, no fewer items, no new condition, the same trace. */
const notLooser = (spec: OutputSpec, base: OutputSpec): boolean =>
    spec.type === base.type &&
    ("minItems" in spec ? (spec.minItems ?? 0) : 0) >= ("minItems" in base ? (base.minItems ?? 0) : 0) &&
    (!("when" in spec) || spec.when === undefined || ("when" in base && base.when !== undefined)) &&
    (!("cites" in base) || base.cites === undefined || ("cites" in spec && spec.cites === base.cites))

const minItemsOf = (spec: OutputSpec): number => ("minItems" in spec ? (spec.minItems ?? 0) : 0)

/** Inputs: the op names its base inputs, the contract gives their values in input.base and adds its own in input.extend. */
const resolveInputs = (contract: Contract, op: Op, problems: string[]): ResolvedInput[] => {
    const { label } = contract
    const given = contract.input.base ?? {}
    const extra = contract.input.extend ?? {}
    const inputs: ResolvedInput[] = []
    for (const [name, summary] of Object.entries(op.input.base)) {
        const value = given[name]
        if (value === undefined) problems.push(`input.base lacks ${name} (${summary}); a ${label} contract must give it`)
        else inputs.push({ name, value, source: "base", summary })
    }
    for (const name of Object.keys(given).filter((name) => !(name in op.input.base))) problems.push(`input.base names ${name}, which is no base input of ${label}; put it in input.extend`)
    for (const [name, value] of Object.entries(extra)) {
        if (name in op.input.base) problems.push(`input.extend names ${name}, a base input of ${label}; give it in input.base`)
        else inputs.push({ name, value, source: "extend" })
    }
    return inputs
}

/**
 * Context: the op's files, then the contract's, then the rule pages of the allowPaths that neither names (each contexts page
 * owning a rule over a path the task may write, so a rule the worker applies there is citable). A pinned base must keep every
 * file of the op's base.
 */
const resolveContext = (contract: Contract, op: Op, values: Readonly<Record<string, string>>, harnessRoot: string, problems: string[]): ContextFile[] => {
    const { label } = contract
    const context: ContextFile[] = []
    const add = (entry: string, source: Source, shared = false): void => {
        const filled = normaliseContextEntry(fill(entry, values))
        const known = context.findIndex((file) => file.entry === filled)
        // A file the contract names again (its extend) is one the task means to apply, so it is citable even when the base reads it as background.
        if (known >= 0) {
            const file = context[known]
            if (file !== undefined && file.shared && !shared) context[known] = { ...file, shared: false }
            return
        }
        const harness = filled.startsWith(HARNESS_PREFIX)
        context.push({ entry: filled, source, harness, path: harness ? filled.slice(HARNESS_PREFIX.length) : filled, shared })
    }
    for (const entry of op.context.base) if (entryApplies(entry, values)) add(entryFile(entry), "base", entryShared(entry))
    if (contract.context.base !== undefined) {
        const pinned = new Set(contract.context.base.map((entry) => normaliseContextEntry(fill(entry, values))))
        for (const file of context.filter((item) => !pinned.has(item.entry))) problems.push(`context.base drops ${file.entry}, a file of the ${label} op's base`)
        for (const entry of contract.context.base) add(entry, "base")
    }
    for (const entry of contract.context.extend ?? []) add(entry, "extend")
    for (const page of rulePagesOf(harnessRoot, contract.context.allowPaths, values.edition)) add(`${HARNESS_PREFIX}${page}`, "paths")
    return context
}

/** Output: the op's keys, then the contract's; a key the op owns may be made stricter, never looser. */
const resolveOutput = (contract: Contract, op: Op, problems: string[]): Map<string, ResolvedOutput> => {
    const { label } = contract
    const output = new Map<string, ResolvedOutput>(Object.entries(op.output.base).map(([key, spec]) => [key, { key, spec, source: "base" }]))
    const pinnedOutput = contract.output?.base
    if (pinnedOutput !== undefined) {
        for (const key of Object.keys(op.output.base).filter((key) => !(key in pinnedOutput))) problems.push(`output.base drops ${key}, a key of the ${label} op's base`)
    }
    for (const [part, keys] of [["base", pinnedOutput ?? {}], ["extend", contract.output?.extend ?? {}]] as const) {
        for (const [key, spec] of Object.entries(keys)) {
            const owned = op.output.base[key]
            if (owned === undefined) {
                if (!output.has(key)) output.set(key, { key, spec, source: "extend" })
            } else if (notLooser(spec, owned)) output.set(key, { key, spec, source: "base" })
            else problems.push(`output.${part}.${key} loosens the ${label} op's base (${JSON.stringify(owned)}): ${JSON.stringify(spec)}`)
        }
    }
    return output
}

/** Checks: the op's, then the contract's, each once. A pinned base must keep every check of the op's base. */
const resolveCheckEntries = (contract: Contract, op: Op, problems: string[]): { entry: CheckEntry; source: Source }[] => {
    const { label } = contract
    const checks: { entry: CheckEntry; source: Source }[] = []
    const addCheck = (entry: CheckEntry, source: Source): void => {
        if (!checks.some((check) => sameEntry(check.entry, entry))) checks.push({ entry, source })
    }
    for (const entry of op.checks.base) addCheck(entry, "base")
    const pinnedChecks = contract.checks?.base
    if (pinnedChecks !== undefined) {
        for (const entry of op.checks.base.filter((entry) => !pinnedChecks.some((pinned) => sameEntry(pinned, entry)))) problems.push(`checks.base drops ${JSON.stringify(entry)}, a check of the ${label} op's base`)
        for (const entry of pinnedChecks) addCheck(entry, "base")
    }
    for (const entry of contract.checks?.extend ?? []) addCheck(entry, "extend")
    return checks
}

/** Resolves base ∪ extend of every part of a contract against its op, noting each item it drops or loosens. */
export const resolveContract = (contract: Contract, ops: Ops): ResolvedContract => {
    const op = opOf(contract, ops)
    const problems: string[] = []
    const inputs = resolveInputs(contract, op, problems)
    const values: Record<string, string> = { label: contract.label, ...Object.fromEntries(inputs.map((input) => [input.name, input.value])) }
    const context = resolveContext(contract, op, values, ops.root, problems)
    const output = resolveOutput(contract, op, problems)
    const checks = resolveCheckEntries(contract, op, problems)
    const workDriven = context.some((file) => !file.harness && underPaths(file.path, [WORK_TREE]))
    const required = [...output.values()].filter((item) => !("when" in item.spec) || item.spec.when === undefined || workDriven)
    return { op, context, inputs, output: required, checks, workDriven, problems }
}

/** The absolute path of a context file: a harness file under the harness checkout, a repository file under `root`. */
export const contextPath = (file: ContextFile, ops: Ops, root: string): string => join(file.harness ? ops.root : root, file.path)

// A rule id has a letter and a digit or a hyphen (R01, BE-ERROR-1, FE-ICON, knowledge-product-agnostic); a plain word is no id.
const RULE_ID = /^(?=.*[A-Za-z])(?=.*[\d-])[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/

/** True when `id` has the shape of a rule or record id. */
export const isRuleId = (id: string): boolean => RULE_ID.test(id)

/** The ids a file names literally: a token of a Markdown heading, or the value of a yaml `id:` line. */
export const ruleIdsIn = (text: string): Set<string> => {
    const ids = new Set<string>()
    for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
        const heading = /^ {0,3}#{1,6}\s(.*)$/.exec(line)
        if (heading?.[1] !== undefined) for (const token of heading[1].split(/[^A-Za-z0-9._-]+/)) if (isRuleId(token)) ids.add(token)
        const keyed = /^\s*(?:-\s+)?id:\s*["']?([^"'\s#]+)/.exec(line)
        if (keyed?.[1] !== undefined) ids.add(keyed[1])
    }
    return ids
}

// A Work record id: lower-case dotted segments (impl.shop.web.cart, integration.commerce.sepay).
const WORK_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/

/**
 * The Work records a text points at: every token shaped as a Work id or a path under `.starciwork/`. A token is only a
 * candidate; the cited check accepts it when the checkout holds the record it names.
 */
export const workNamesIn = (text: string): Set<string> => {
    const names = new Set<string>()
    for (const raw of text.split(/[^A-Za-z0-9._/-]+/)) {
        const token = raw.replace(/[./]+$/, "")
        if (WORK_ID.test(token) || token.startsWith(`${WORK_TREE}/`)) names.add(token)
    }
    return names
}

/** Replaces `{name}` placeholders with the contract's arguments; a whole-value placeholder keeps the argument's type. */
const substitute = (value: unknown, args: CheckArgs): unknown => {
    if (typeof value === "string") {
        const whole = /^\{([A-Za-z0-9_-]+)\}$/.exec(value)
        if (whole?.[1] !== undefined) return args[whole[1]] ?? value
        return value.replace(/\{([A-Za-z0-9_-]+)\}/g, (match: string, key: string) => {
            const arg = args[key]
            if (arg === undefined) return match
            return Array.isArray(arg) ? arg.join(" ") : String(arg)
        })
    }
    if (Array.isArray(value)) return value.map((item) => substitute(item, args))
    if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, args)]))
    return value
}

/** The context files a read trace may cite: every file but the shared ones every task of the label reads anyway. */
export const citableContext = (resolved: ResolvedContract): ContextFile[] => resolved.context.filter((file) => !file.shared)

/** One traced key of a `cited` check: the files its ids come from and, for a Work key, the Work names its inputs give. */
interface Trace {
    key: string
    minItems: number
    files: string[]
    cites: "context" | "work"
    named?: string[]
}

/**
 * The trace a `cited` check verifies: each output key that cites, with the context files its ids must come from. A Work key
 * reads the Work context files and its own Work allowPaths, and carries the Work ids and paths its inputs name, so the check
 * also accepts a record a context file or an input points at (run-checks.ts readableWork).
 */
const traceOf = (resolved: ResolvedContract, contract: Contract, ops: Ops): Trace[] =>
    resolved.output
        .filter((item) => "cites" in item.spec && item.spec.cites !== undefined)
        .map((item) => {
            const work = "cites" in item.spec && item.spec.cites === "work"
            const files = citableContext(resolved).filter((file) => !work || (!file.harness && underPaths(file.path, [WORK_TREE])))
            // Harness files are absolute here; repository files stay relative, read from the checkout the check runs in.
            const read = files.map((file) => (file.harness ? join(ops.root, file.path) : file.path))
            const base = { key: item.key, minItems: minItemsOf(item.spec), files: read }
            if (!work) return { ...base, cites: "context" }
            // A Work key may also cite a record the task wrote: its own Work scope is read in the candidate, folders included.
            const written = contract.context.allowPaths.filter((path) => underPaths(path, [WORK_TREE]))
            const inputs = [contract.input.summary, contract.input.details ?? "", ...resolved.inputs.map((input) => input.value)].join("\n")
            const named = [...workNamesIn(inputs)].sort(byCodeUnit)
            return { ...base, files: [...read, ...written], cites: "work", ...(named.length === 0 ? {} : { named }) }
        })

/**
 * Expands one entry into its primitive check. A preset's arguments come from the entry, else from the contract's inputs of the
 * same name. The tier comes from the check's kind; only a T0 or T1 check is behavioural, whatever the preset or entry says.
 */
const expand = (entry: CheckEntry, index: number, ops: Ops, inputs: CheckArgs): ResolvedCheck => {
    if ("check" in entry) {
        const tier = trustTier(entry.check.kind)
        return { name: `check-${String(index + 1)}:${entry.check.kind}`, tier, behavioural: tier !== "T2" && BEHAVIOURAL_KINDS.has(entry.check.kind), check: entry.check }
    }
    const preset = ops.presets[entry.preset]
    if (preset === undefined) throw new Refusal("CONTRACT_UNKNOWN_PRESET", `the checks name an unknown preset: ${entry.preset}; presets: ${Object.keys(ops.presets).join(", ")}`)
    const args: CheckArgs = { ...inputs, ...("args" in entry ? (entry.args ?? {}) : {}) }
    const missing = (preset.args ?? []).filter((name) => !(name in args))
    if (missing.length > 0) throw new Refusal("CONTRACT_PRESET_ARGS", `preset ${entry.preset} needs: ${missing.join(", ")}; write it as ${presetForm(entry.preset, preset.args ?? [])}`)
    const parsed = primitiveCheckSchema.safeParse(substitute(preset.check, args))
    if (!parsed.success) {
        throw new Refusal("CONTRACT_PRESET_ARGS", `preset ${entry.preset} does not expand to a valid check (write it as ${presetForm(entry.preset, preset.args ?? [])}): ${z.prettifyError(parsed.error)}`)
    }
    const tier = trustTier(parsed.data.kind)
    return { name: entry.preset, tier, behavioural: preset.behavioural && tier !== "T2", check: parsed.data }
}

/** The name of the generated check of the output keys. */
export const OUTPUT_CHECK = "output"

/**
 * Expands every check of the resolved contract into a primitive one (refusing unknown presets and missing arguments), fills
 * the trace of a `cited` check and the contract's part of a `cite` check, and adds the generated `output` check: the filed result carries every required key with its type.
 */
export const resolveChecks = (contract: Contract, ops: Ops): ResolvedCheck[] => {
    const resolved = resolveContract(contract, ops)
    const inputs: CheckArgs = Object.fromEntries(resolved.inputs.map((input) => [input.name, input.value]))
    const outputKeys = resolved.output.map((item) => item.key)
    const checks = resolved.checks.map(({ entry }, index): ResolvedCheck => {
        const check = expand(entry, index, ops, inputs)
        if (check.check.kind === "cite") return { ...check, check: { kind: "cite", ...fillCiteCheck(check.check, ops.root, contract.cites, outputKeys) } }
        // The harness checkout rides along so a red trace names the page that owns an id the task was not handed.
        return check.check.kind === "cited" && check.check.trace === undefined ? { ...check, check: { kind: "cited", trace: traceOf(resolved, contract, ops), harness: ops.root } } : check
    })
    if (resolved.output.length === 0) return checks
    const types: Record<string, OutputType> = Object.fromEntries(resolved.output.map((item) => [item.key, item.spec.type]))
    // The output is the worker's own claim: its shape can make the task red, never prove what the task did.
    return [...checks, { name: OUTPUT_CHECK, tier: "T2", behavioural: false, check: { kind: "json", file: RESULT_FILE, requiredKeys: Object.keys(types), types } }]
}

/** The contract's identity: sha256 of its canonical json, so a replan can tell an unchanged task from a changed one. */
export const contractHash = (contract: Contract): string => createHash("sha256").update(JSON.stringify(canonical(contract))).digest("hex")

// allowPaths are literal paths, matched as `:(literal)` pathspecs and path prefixes; a glob there would match nothing.
// Brackets stay allowed: a framework names folders with them (`[locale]`), and a literal pathspec reads them as written.
const GLOB = /[*?{}!]/

const placeProblems = (what: string, path: string): string[] => [
    ...(GLOB.test(path) ? [`${what} "${path}" carries a glob character; name literal folders or files (a folder covers everything below it)`] : []),
    ...(path.split("/").includes("..") ? [`${what} "${path}" leaves the repository`] : []),
    ...(path.startsWith("/") || /^[A-Za-z]:/.test(path) ? [`${what} "${path}" must be repository-relative`] : []),
]

/** Problems of the read trace the contract can be judged on now: a cited key needs ids, and harness files say whether they have any. */
const traceProblems = (resolved: ResolvedContract, ops: Ops): string[] => {
    const problems: string[] = []
    for (const item of resolved.output) {
        if (!("cites" in item.spec) || item.spec.cites !== "context" || minItemsOf(item.spec) === 0) continue
        // A repository file may be written by an earlier task, so only an all-harness context can be judged before the work.
        const citable = citableContext(resolved)
        if (citable.some((file) => !file.harness)) continue
        const named = citable.some((file) => {
            const path = join(ops.root, file.path)
            return existsSync(path) && ruleIdsIn(readFileSync(path, "utf8")).size > 0
        })
        if (!named) problems.push(`output key ${item.key} must cite at least ${String(minItemsOf(item.spec))} rule id(s), but no context file it may cite (shared files excluded) names one; extend context with the rules the task applies`)
    }
    return problems
}

/** The bytes per token the context budget estimates with. */
export const BYTES_PER_TOKEN = 4

/**
 * The estimated tokens of the fixed context files that exist now: harness files, and repository files under `root` when it is
 * given. A rule page of the paths is the second layer, opened at the section a written file needs, so it is not counted.
 */
export const contextTokens = (resolved: ResolvedContract, ops: Ops, root?: string): { readonly tokens: number; readonly bytes: number; readonly unmeasured: readonly string[] } => {
    let bytes = 0
    const unmeasured: string[] = []
    for (const file of resolved.context.filter((item) => item.source !== "paths")) {
        const inRepository = root === undefined ? undefined : join(root, file.path)
        const path = file.harness ? join(ops.root, file.path) : inRepository
        if (path === undefined || !existsSync(path)) unmeasured.push(file.entry)
        else bytes += statSync(path).size
    }
    return { tokens: Math.ceil(bytes / BYTES_PER_TOKEN), bytes, unmeasured }
}

/** The context budget of the op: a context estimated heavier than it is unfit, so a task never starts by reading past its window. */
export const budgetProblems = (resolved: ResolvedContract, ops: Ops): string[] => {
    const budget = resolved.op.context.budget
    if (budget === undefined) return []
    const { tokens, bytes } = contextTokens(resolved, ops)
    if (tokens <= budget) return []
    return [`the context is about ${String(tokens)} tokens (${String(bytes)} bytes / ${String(BYTES_PER_TOKEN)}), over the ${resolved.op.label} op's budget of ${String(budget)}; name the topic files the task needs, not whole trees`]
}

/** Problems of the context files: an unfilled placeholder, a path that is no repository place, a harness file that is missing. */
const contextProblems = (resolved: ResolvedContract, ops: Ops): string[] => {
    const problems: string[] = []
    for (const file of resolved.context) {
        const unfilled = placeholdersOf(file.entry)
        if (unfilled.length > 0) {
            const names = unfilled.map((name) => "{" + name + "}").join(", ")
            problems.push(`context file ${file.entry} names ${names}, which no input gives`)
            continue
        }
        problems.push(...placeProblems(`context file ${file.harness ? HARNESS_PREFIX : ""}`, file.path))
        if (file.harness && !existsSync(join(ops.root, file.path))) problems.push(`context file ${file.entry} does not exist in the harness checkout ${ops.root}`)
    }
    return problems
}

/** Whether the label's op asks for a behavioural check and none of the expanded checks is one. */
export const lacksBehaviouralCheck = (resolved: ResolvedContract, checks: readonly ResolvedCheck[]): boolean => resolved.op.checks.behavioural && !checks.some((check) => check.behavioural)

/** The presets that prove behaviour, each with the arguments it needs. */
export const behaviouralPresets = (ops: Ops): { readonly name: string; readonly args: readonly string[] }[] =>
    Object.entries(ops.presets)
        .filter(([, preset]) => preset.behavioural)
        .map(([name, preset]) => ({ name, args: preset.args ?? [] }))

/** Problems of the expanded checks: there must be one, and a behavioural label needs a behavioural check (resolving may refuse). */
const checkProblems = (contract: Contract, resolved: ResolvedContract, ops: Ops): string[] => {
    const problems: string[] = []
    const checks = resolveChecks(contract, ops)
    if (checks.length === 0) problems.push("the contract has no check; add one to checks.extend")
    if (lacksBehaviouralCheck(resolved, checks)) {
        const forms = behaviouralPresets(ops).map((preset) => presetForm(preset.name, preset.args))
        problems.push(
            `label ${contract.label} needs at least one behavioural check, one the harness observes itself (T0) or reads from a receipted run (T1); lint, typecheck and the worker's own result (T2) prove nothing about behaviour. Add one of these to checks.extend: ${forms.join(", ")}`,
        )
    }
    return problems
}

/** The problems of a contract's allowPaths: the whole repository or Work tree, a neverRead file, a bad place, a duplicate. */
const allowPathProblems = (allowPaths: readonly string[]): string[] => {
    const problems: string[] = []
    const seen = new Set<string>()
    const policy = loadPolicy()
    for (const path of allowPaths) {
        // The schema already normalised the entry, so `./src/` and `src` are the same path here.
        if (path === ".") problems.push(`allowPaths entry "${path}" is the whole repository; name concrete folders or files`)
        if (path === WORK_TREE) problems.push(`allowPaths entry "${path}" is the whole Work tree; name the scope inside it (for example ${WORK_TREE}/features/<feature>)`)
        if (neverRead(policy, path)) problems.push(`allowPaths entry "${path}" names a file policy/security.yaml neverRead lists; the harness never opens it, so no task may write it`)
        problems.push(...placeProblems("allowPaths entry", path))
        if (seen.has(path)) problems.push(`allowPaths entry "${path}" is named twice`)
        seen.add(path)
    }
    return problems
}

/** What a contract is judged on: every problem, or (`budget: false`) all but the context budget, for a contract already admitted. */
export interface ContractJudging {
    readonly budget?: boolean
}

/**
 * Problems that make a contract unfit to send, beyond its schema: label, base kept, paths, context files, the context budget and
 * the behavioural rule. The budget measures the context files as they are now, so it is judged once, when the contract is
 * admitted (task send, supervisor dispatch, workflow define, or a workflow change that adds or edits it). An admitted contract
 * (`budget: false`) keeps the budget it passed then: its verify, relaunch, retry of the same hash and settle never refuse it for
 * a context that grew under it (tasks.ts isAdmitted, graph.ts buildGraph's `held`, task verify).
 */
export const contractProblems = (contract: Contract, ops: Ops, judging: ContractJudging = {}): string[] => {
    const problems = allowPathProblems(contract.context.allowPaths)
    if (contract.context.cwd !== undefined) problems.push(...placeProblems("cwd", contract.context.cwd))
    let resolved: ResolvedContract
    try {
        resolved = resolveContract(contract, ops)
    } catch (error: unknown) {
        return [...problems, error instanceof Error ? error.message : String(error)]
    }
    problems.push(...resolved.problems, ...contextProblems(resolved, ops), ...traceProblems(resolved, ops), ...(judging.budget === false ? [] : budgetProblems(resolved, ops)), ...contractCiteProblems(contract.cites, ops.root))
    try {
        problems.push(...checkProblems(contract, resolved, ops))
    } catch (error: unknown) {
        problems.push(error instanceof Error ? error.message : String(error))
    }
    return problems
}
