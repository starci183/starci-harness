import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { runtimeRoot } from "./ledger.js"

/*
 * The DNA measurement: the one owner of the shape a measured law of contexts/grammars/contract.yaml takes, and of how a measured
 * value is judged against it. The contract owns the shape (its `mustKeep.shape` and `mustKeep.measureFields` say what a field
 * means); this file reads that shape and nothing older.
 *
 *   mustKeep:
 *     common:  [ { id: DNA-COMMON-…, role, law, measure, owner, followUp? }, … ]   # held by every grammar of the contract
 *     core:    [ … ]                                                              # held by that grammar only
 *     offset-pop: [ … ]
 *
 * A measure names a `kind` (what is read on the rendered page), a `select` (which elements), a `metric`, an `op` and a `value`.
 * Kinds: box, style, attr, relation, uniform, count, seams, a11y, text, tokens, interaction, source. Values: a literal with its
 * unit, or { token }, { threshold }, { vendor }, { self }, { count }, { rows }, { oneOf }, { before }, { fixture }.
 *
 * The loader flattens an entry into variants: the `cases` and `checks` of a measure each become one fully specified variant, so
 * the page evaluates one select, one metric list, one op and one value at a time. `{ threshold }` and `{ contract }` are resolved
 * here, from contexts/ui/proof/thresholds.yaml and from the contract itself, so a number is read where it is owned and the page
 * receives a plain value. The page side (core/dna/measure.ts) reads the page; this side judges what it read.
 *
 * Coverage. An entry none of whose variants matched an element is not exercised; the run reports it per id and never passes it.
 * A law that carries `followUp` is red by design: it is listed with the open item that makes it hold and does not fail the run, but
 * the moment it holds in every grammar the run says so (stale-follow-up) and asks for the `followUp` to be removed, so a known-red list
 * only ever shrinks by hand; it does not fail the run, because a measurement that differs by host (fonts) must not turn a green law red.
 */

/** The kinds a measure may name (contract.yaml mustKeep.measureFields.kind). */
export const DNA_KINDS = ["box", "style", "attr", "relation", "uniform", "count", "seams", "a11y", "text", "tokens", "interaction", "source"] as const

/** One kind. */
export type DnaKind = (typeof DNA_KINDS)[number]

/** The comparison operators (contract.yaml mustKeep.measureFields.op). */
export const DNA_OPS = ["=", "!=", "<", "<=", ">", ">=", "set", "matches"] as const

/** One operator. */
export type DnaOp = (typeof DNA_OPS)[number]

/** A literal a value may be. */
export type DnaLiteral = string | number | boolean

/** A value as the contract writes it, before the page resolves it. */
export type DnaValue =
    | DnaLiteral
    | { readonly token: string }
    | { readonly threshold: string }
    | { readonly vendor: { readonly component: string; readonly props: Readonly<Record<string, DnaLiteral>>; readonly metric: string | readonly string[] } }
    | { readonly self: string; readonly times: number }
    | { readonly count: string; readonly offset?: number | undefined }
    | { readonly rows: number }
    | { readonly oneOf: readonly DnaValue[] }
    | { readonly before: true }
    | { readonly fixture: string }

const literalSchema = z.union([z.string(), z.number(), z.boolean()])

const valueSchema: z.ZodType<DnaValue> = z.lazy(() =>
    z.union([
        literalSchema,
        z.strictObject({ token: z.string().regex(/^--[\w-]+$/) }),
        z.strictObject({ threshold: z.string().min(1) }),
        z.strictObject({ vendor: z.strictObject({ component: z.string().min(1), props: z.record(z.string(), literalSchema), metric: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]) }) }),
        z.strictObject({ self: z.string().min(1), times: z.number() }),
        z.strictObject({ count: z.string().min(1), offset: z.number().optional() }),
        z.strictObject({ rows: z.number() }),
        z.strictObject({ oneOf: z.array(valueSchema).min(1) }),
        z.strictObject({ before: z.literal(true) }),
        z.strictObject({ fixture: z.string().min(1) }),
    ]),
)

const metricSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1), z.strictObject({ contract: z.string().min(1) })])
const opSchema = z.enum(DNA_OPS)

const checkSchema = z.strictObject({ metric: metricSchema, op: opSchema, value: valueSchema })

const contextSchema = z.strictObject({
    pointer: z.enum(["coarse", "fine"]).optional(),
    viewport: z.string().regex(/^\d+x\d+$/).optional(),
    theme: z.enum(["light", "dark"]).optional(),
    forcedColors: z.literal("active").optional(),
    reducedMotion: z.literal("reduce").optional(),
    state: z.enum(["hover", "pressed", "focus-visible"]).optional(),
})

const refSchema = z.strictObject({
    within: z.string().min(1),
    select: z.string().min(1),
    metric: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    offset: z.union([z.string(), z.number()]).optional(),
})

const caseSchema = z.strictObject({ select: z.string().min(1), metric: metricSchema.optional(), value: valueSchema.optional() })

/** The fields every measure and the `then` of an interaction share. */
const measureFields = {
    select: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    target: z.literal("painted-box").optional(),
    pseudo: z.string().min(1).optional(),
    metric: metricSchema.optional(),
    op: opSchema.optional(),
    value: valueSchema.optional(),
    checks: z.array(checkSchema).min(1).optional(),
    cases: z.array(caseSchema).min(1).optional(),
    where: checkSchema.optional(),
    context: contextSchema.optional(),
    tolerance: z.number().min(0).optional(),
    ref: refSchema.optional(),
    rows: z.string().min(1).optional(),
}

const thenSchema = z.strictObject({ kind: z.enum(DNA_KINDS).optional(), ...measureFields })

const measureSchema = z.strictObject({
    kind: z.enum(DNA_KINDS),
    ...measureFields,
    act: z.array(z.string().min(1)).min(1).optional(),
    then: thenSchema.optional(),
    check: z.string().min(1).optional(),
})

const entrySchema = z.strictObject({
    id: z.string().regex(/^DNA-[A-Z0-9]+(?:-[A-Z0-9]+)+$/, "an id is DNA-<SCOPE>-<NAME> in upper case"),
    role: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    law: z.string().min(1),
    measure: measureSchema,
    owner: z.string().min(1),
    followUp: z.string().min(1).optional(),
})

/** The `then` of an interaction, flat: the measure on the same match (or on `select`) after the steps ran. */
export interface DnaThen {
    readonly kind: DnaKind
    readonly select: string | null
    readonly metrics: readonly string[]
    readonly op: DnaOp
    readonly value: DnaValue | undefined
    readonly where: DnaWhere | null
    readonly scope: string | null
    readonly pseudo: string | null
}

/** A filter on the matches of a count or a style variant: the match is kept when its metric holds. */
export interface DnaWhere {
    readonly metric: string
    readonly op: DnaOp
    readonly value: DnaValue
}

/** What a page must be set up as before a variant is measured. */
export interface DnaContext {
    readonly pointer: "coarse" | "fine" | null
    readonly viewport: { readonly width: number; readonly height: number } | null
    readonly theme: "light" | "dark" | null
    readonly forcedColors: boolean
    readonly reducedMotion: boolean
    readonly state: "hover" | "pressed" | "focus-visible" | null
}

/** One fully specified measurement: one select, one metric list, one operator, one value. */
export interface DnaVariant {
    readonly kind: DnaKind
    readonly select: string
    readonly scope: string | null
    readonly target: "painted-box" | null
    readonly pseudo: string | null
    readonly metrics: readonly string[]
    readonly op: DnaOp
    readonly value: DnaValue | undefined
    readonly where: DnaWhere | null
    readonly context: DnaContext
    readonly tolerance: number | null
    readonly ref: { readonly within: string; readonly select: string; readonly metrics: readonly string[]; readonly offset: string | number | undefined } | null
    readonly rows: string | null
    readonly act: readonly string[]
    readonly then: DnaThen | null
    /** source: the named check. */
    readonly check: string | null
}

/** One measured law with the grammars it binds, as the gate loads it. */
export interface DnaEntry {
    readonly id: string
    readonly law: string
    readonly roles: readonly string[]
    readonly owner: string
    /** The grammars it binds: every grammar of the contract for a `common` law, else the one grammar. */
    readonly families: readonly string[]
    readonly followUp: string | null
    readonly variants: readonly DnaVariant[]
}

/** The measured laws of a contract and the grammars it names. */
export interface DnaContract {
    readonly file: string
    readonly grammars: readonly string[]
    readonly entries: readonly DnaEntry[]
}

/** The grammar contract this harness ships: contexts/grammars/contract.yaml. */
export const defaultContractFile = (): string => join(runtimeRoot(), "contexts", "grammars", "contract.yaml")

/** The thresholds this contract reads, beside it in contexts/ui/proof (contract.yaml: ../ui/proof/thresholds.yaml). */
export const thresholdsFileOf = (contractFile: string): string => resolve(dirname(contractFile), "..", "ui", "proof", "thresholds.yaml")

const DOCUMENTATION_KEYS: ReadonlySet<string> = new Set(["shape", "measureFields"])

const contractShape = z.looseObject({
    grammars: z.array(z.string().min(1)).min(1),
    mustKeep: z.record(z.string(), z.unknown()),
})

/** A dotted path read from a parsed YAML tree; undefined when a step is missing. */
const pathOf = (tree: unknown, path: string): unknown => {
    let at: unknown = tree
    for (const step of path.split(".")) {
        if (typeof at !== "object" || at === null || !(step in at)) return undefined
        at = (at as Record<string, unknown>)[step]
    }
    return at
}

/** The number a `{ threshold: key }` reads: the scalar at the key, else the `min` (a floor) or `max` (a ceiling) of the object there. */
export const thresholdValue = (thresholds: unknown, key: string, op: DnaOp): number => {
    const found = pathOf(thresholds, key)
    if (typeof found === "number") return found
    if (typeof found === "object" && found !== null) {
        const record = found as Record<string, unknown>
        const wantsFloor = op === ">=" || op === ">"
        const picked = wantsFloor ? record.min : op === "<=" || op === "<" ? record.max : (record.max ?? record.min)
        if (typeof picked === "number") return picked
    }
    throw new Refusal("DNA_CONTRACT_INVALID", `{ threshold: ${key} } reads no number in thresholds.yaml for the operator ${op}`)
}

interface Sources {
    readonly contract: unknown
    readonly thresholds: unknown
    readonly file: string
}

/** A value with its { threshold } read from the thresholds file; the rest is the page's to resolve. */
const resolveValue = (value: DnaValue | undefined, op: DnaOp, sources: Sources): DnaValue | undefined => {
    if (value === undefined || typeof value !== "object") return value
    if ("threshold" in value) return thresholdValue(sources.thresholds, value.threshold, op)
    if ("oneOf" in value) return { oneOf: value.oneOf.map((item) => resolveValue(item, op, sources) ?? item) }
    return value
}

/** Metric names: a string, a list, or { contract: path } read from the contract (a list of token names, each `--name`). */
const metricsOf = (metric: z.infer<typeof metricSchema> | undefined, sources: Sources): string[] => {
    if (metric === undefined) return []
    if (typeof metric === "string") return [metric]
    if (Array.isArray(metric)) return metric
    const found = pathOf(sources.contract, metric.contract)
    if (!Array.isArray(found) || found.length === 0 || !found.every((item): item is string => typeof item === "string")) {
        throw new Refusal("DNA_CONTRACT_INVALID", `${sources.file}: { contract: ${metric.contract} } is not a list of names in the contract`)
    }
    return found.map((name) => (name.startsWith("--") ? name : `--${name}`))
}

const contextOf = (context: z.infer<typeof contextSchema> | undefined): DnaContext => {
    const parts = context?.viewport?.split("x").map(Number)
    return {
        pointer: context?.pointer ?? null,
        viewport: parts?.[0] === undefined || parts[1] === undefined ? null : { width: parts[0], height: parts[1] },
        theme: context?.theme ?? null,
        forcedColors: context?.forcedColors === "active",
        reducedMotion: context?.reducedMotion === "reduce",
        state: context?.state ?? null,
    }
}

const whereOf = (where: z.infer<typeof checkSchema> | undefined, sources: Sources): DnaWhere | null => {
    if (where === undefined) return null
    const [metric] = metricsOf(where.metric, sources)
    const value = resolveValue(where.value, where.op, sources)
    if (metric === undefined || value === undefined) return null
    return { metric, op: where.op, value }
}

const DEFAULT_OP: Readonly<Record<DnaKind, DnaOp>> = {
    box: "=",
    style: "=",
    attr: "=",
    relation: "=",
    uniform: "=",
    count: "=",
    seams: "=",
    a11y: "=",
    text: "=",
    tokens: "=",
    interaction: "=",
    source: "=",
}

/** The measure's fields, each case and each check one variant; a variant states everything the page needs. */
const variantsOf = (measure: z.infer<typeof measureSchema>, sources: Sources, id: string): DnaVariant[] => {
    const fail = (message: string): never => {
        throw new Refusal("DNA_CONTRACT_INVALID", `${sources.file}: ${id}: ${message}`)
    }
    if (measure.kind === "source") {
        if (measure.check === undefined) return fail("a source measure names its check")
        return [{ kind: "source", select: "", scope: null, target: null, pseudo: null, metrics: [], op: "=", value: undefined, where: null, context: contextOf(undefined), tolerance: null, ref: null, rows: null, act: [], then: null, check: measure.check }]
    }
    const base = {
        kind: measure.kind,
        scope: measure.scope ?? null,
        target: measure.target ?? null,
        pseudo: measure.pseudo ?? null,
        where: whereOf(measure.where, sources),
        context: contextOf(measure.context),
        tolerance: measure.tolerance ?? null,
        ref: measure.ref === undefined ? null : { within: measure.ref.within, select: measure.ref.select, metrics: metricsOf(measure.ref.metric, sources), offset: measure.ref.offset },
        rows: measure.rows ?? null,
        act: measure.act ?? [],
        check: null,
    }
    const thenOf = (): DnaThen | null => {
        const then = measure.then
        if (then === undefined) return null
        const op = then.op ?? DEFAULT_OP[then.kind ?? "style"]
        return {
            kind: then.kind ?? "style",
            select: then.select ?? null,
            metrics: metricsOf(then.metric, sources),
            op,
            value: resolveValue(then.value, op, sources),
            where: whereOf(then.where, sources),
            scope: then.scope ?? null,
            pseudo: then.pseudo ?? null,
        }
    }
    const make = (select: string | undefined, metric: z.infer<typeof metricSchema> | undefined, op: DnaOp | undefined, value: DnaValue | undefined): DnaVariant => {
        if (select === undefined && measure.kind !== "tokens") return fail("a measure names its select")
        const resolved = op ?? measure.op ?? DEFAULT_OP[measure.kind]
        return { ...base, select: select ?? "", metrics: metricsOf(metric, sources), op: resolved, value: resolveValue(value, resolved, sources), then: thenOf() }
    }
    if (measure.cases !== undefined) return measure.cases.map((one) => make(one.select, one.metric ?? measure.metric, measure.op, one.value ?? measure.value))
    if (measure.checks !== undefined) return measure.checks.map((one) => make(measure.select, one.metric, one.op, one.value))
    return [make(measure.select, measure.metric, measure.op, measure.value)]
}

const entryOf = (raw: unknown, group: string, grammars: readonly string[], sources: Sources): DnaEntry => {
    const parsed = entrySchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("DNA_CONTRACT_INVALID", `${sources.file}: a mustKeep.${group} entry is not a measured law: ${z.prettifyError(parsed.error)}`)
    const entry = parsed.data
    const scope = group === "common" ? "COMMON" : group.toUpperCase()
    if (!entry.id.startsWith(`DNA-${scope}-`)) throw new Refusal("DNA_CONTRACT_INVALID", `${sources.file}: ${entry.id} sits under mustKeep.${group}, so its id starts DNA-${scope}-`)
    return {
        id: entry.id,
        law: entry.law,
        roles: typeof entry.role === "string" ? [entry.role] : entry.role,
        owner: entry.owner,
        families: group === "common" ? grammars : [group],
        followUp: entry.followUp ?? null,
        variants: variantsOf(entry.measure, sources, entry.id),
    }
}

/**
 * Reads every measured law of a grammar contract; refuses a malformed entry, a group that is neither `common` nor a grammar of the
 * contract, a repeated id, and a role's `dna` list that names an id no group declares.
 */
export const loadDnaContract = (file: string = defaultContractFile()): DnaContract => {
    if (!existsSync(file)) throw new Refusal("DNA_CONTRACT_MISSING", `${file} does not exist`)
    const document: unknown = parse(readFileSync(file, "utf8"))
    const shape = contractShape.safeParse(document)
    if (!shape.success) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: ${z.prettifyError(shape.error)}`)
    const { grammars, mustKeep } = shape.data
    const thresholdsFile = thresholdsFileOf(file)
    if (!existsSync(thresholdsFile)) throw new Refusal("DNA_CONTRACT_INVALID", `${file} reads thresholds from ${thresholdsFile}, which does not exist`)
    const sources: Sources = { contract: document, thresholds: parse(readFileSync(thresholdsFile, "utf8")), file }
    const entries: DnaEntry[] = []
    for (const [group, items] of Object.entries(mustKeep)) {
        if (DOCUMENTATION_KEYS.has(group)) continue
        if (group !== "common" && !grammars.includes(group)) {
            throw new Refusal("DNA_CONTRACT_INVALID", `${file}: mustKeep.${group} is neither common nor one of the grammars (${grammars.join(", ")})`)
        }
        if (!Array.isArray(items)) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: mustKeep.${group} is a list of laws`)
        for (const raw of items) entries.push(entryOf(raw, group, grammars, sources))
    }
    const seen = new Set<string>()
    for (const entry of entries) {
        if (seen.has(entry.id)) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: the id ${entry.id} is declared twice`)
        seen.add(entry.id)
    }
    const roles = z.object({ roles: z.array(z.looseObject({ id: z.string(), dna: z.array(z.string()).optional() })).optional() }).safeParse(document)
    for (const role of roles.success ? (roles.data.roles ?? []) : []) {
        for (const id of role.dna ?? []) if (!seen.has(id)) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: role ${role.id} lists ${id}, which no mustKeep group declares`)
    }
    return { file, grammars, entries }
}

/** The measured laws that bind one grammar family. */
export const entriesFor = (contract: DnaContract, family: string): DnaEntry[] => contract.entries.filter((entry) => entry.families.includes(family))

/** A scalar the page read or resolved. */
export type DnaScalar = string | number | boolean | null

/** One condition of a sample: what was read for each metric, and what each must be. */
export interface DnaPart {
    readonly metric: string
    readonly op: DnaOp
    readonly measured: readonly DnaScalar[]
    /** The alternatives the measured values may equal: one list per alternative, broadcast over the metrics when it has one scalar. */
    readonly expected: readonly (readonly DnaScalar[])[]
    /** `matches`: whether `expected` is a pattern (a contract literal) or a plain value (a fixture), which is contained. */
    readonly pattern: boolean
    readonly tolerance: number
}

/** One element (or scope, or the root) the page measured, with its conditions. */
export interface DnaSample {
    readonly path: string
    readonly parts: readonly DnaPart[]
    /** Set when the page could not measure the element: the reason, which is a failure of the gate, not of the law. */
    readonly error?: string
}

/**
 * Whether one part keeps the law; `want` says what it should have been when it does not. It is one self-contained function, because
 * the page that measures runs the very same source (core/dna/measure.ts is handed `judgePart.toString()`): a number is read with its
 * unit stripped, a non-number compares as blank-normalised text, `set` wants a non-empty value and `matches` a pattern or a fact.
 */
export function judgePart(part: DnaPart): { readonly ok: boolean; readonly want: string } {
    const asNumber = (value: DnaScalar): number | null => {
        if (typeof value === "number") return value
        if (typeof value !== "string") return null
        const match = /^(-?\d+(?:\.\d+)?(?:e-?\d+)?)(?:px)?$/i.exec(value.trim())
        return match?.[1] === undefined ? null : Number(match[1])
    }
    const text = (value: DnaScalar): string => (value === null ? "" : String(value).trim().replace(/\s+/g, " "))
    const holds = (measured: DnaScalar, expected: DnaScalar | undefined): boolean => {
        if (part.op === "set") return measured !== null && text(measured) !== "" && text(measured) !== "none"
        if (expected === undefined) return false
        if (part.op === "matches") {
            try {
                return part.pattern ? new RegExp(text(expected)).test(text(measured)) : text(measured).includes(text(expected))
            } catch {
                return false
            }
        }
        const left = asNumber(measured)
        const right = asNumber(expected)
        if (left !== null && right !== null) {
            if (part.op === "=") return Math.abs(left - right) <= part.tolerance
            if (part.op === "!=") return Math.abs(left - right) > part.tolerance
            if (part.op === "<") return left < right
            if (part.op === "<=") return left <= right + part.tolerance
            if (part.op === ">") return left > right
            return left >= right - part.tolerance
        }
        if (part.op === "=") return text(measured) === text(expected)
        if (part.op === "!=") return text(measured) !== text(expected)
        return false
    }
    const alternatives = part.op === "set" ? [[]] : part.expected
    const ok = alternatives.some((alternative) => part.measured.every((measured, index) => holds(measured, alternative[index] ?? alternative[0])))
    const wanted = part.op === "set" ? "a non-empty value" : `${part.op} ${part.expected.map((alternative) => alternative.map((scalar) => JSON.stringify(scalar)).join(", ")).join(" or ")}`
    return { ok: ok && part.measured.length > 0, want: wanted }
}

/** One part that broke: its metric, what was measured and what it wanted. */
export interface DnaBreak {
    readonly metric: string
    readonly measured: string
    readonly want: string
}

/** The parts of a sample that break the law; empty when the sample holds. */
export const breaksOf = (sample: DnaSample): DnaBreak[] =>
    sample.parts.flatMap((part) => {
        const verdict = judgePart(part)
        return verdict.ok ? [] : [{ metric: part.metric, measured: part.measured.map((scalar) => JSON.stringify(scalar)).join(", "), want: verdict.want }]
    })
