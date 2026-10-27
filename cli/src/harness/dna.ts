import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { runtimeRoot } from "./ledger.js"

/*
 * The DNA measurement: the one owner of the shape a machine-checkable `mustKeep` entry of contexts/grammars/contract.yaml takes.
 *
 * A Grammar's DNA constraints are facts, not taste ("sai là sai"): the label sits outside the card, the divider is flush with the
 * surface edge, no surface sits inside a surface, a control is 40px tall. A `mustKeep` item is either prose (a string, judged by
 * the reviewer) or an entry the gate measures on the rendered page (`starci dna check`):
 *
 *   mustKeep:
 *     - one card is one subject                    # prose: never measured
 *     - id: card.label-outside                     # unique across the contract
 *       law: the card label sits outside the painted surface
 *       families: [core]                           # optional: the grammars it binds (default every grammar of the contract)
 *       measure:
 *         selector: "[data-grammar-surface-label]" # every element it matches inside a Grammar root of a bound family
 *         metric: outside                          # what is measured on each (DNA_METRICS)
 *         ref: "[data-grammar-surface]"            # the other element the metric compares with
 *         scope: "[data-grammar-surface-card]"     # where `ref` is looked up for `outside` (default the Grammar root)
 *         expected: { equals: true }
 *
 * Entries sit under a role's `mustKeep` or under the contract's top-level `mustKeep` (laws across roles, such as no surface in a
 * surface). Metrics, each read from the live layout (getBoundingClientRect, getComputedStyle):
 *
 *   height, width   the border box in CSS px                                     expected: equals (+tolerance, default 0.5) | min | max
 *   css             the computed value of `property`; a px value is a number     expected: equals | min | max | var (a custom property
 *                                                                                  resolved the same way, e.g. var: --surface for a colour)
 *   attribute       the value of the attribute `property` (null when absent)     expected: equals
 *   inset           the largest distance from the element's border box to the padding box of its nearest `ref` ancestor, on
 *                   `edges` (default left and right): 0 is flush                 expected: equals 0
 *   outside         true when no `ref` inside the scope contains or overlaps the element                    expected: equals true
 *   ancestors       how many ancestors (up to the Grammar root) match `ref`                                expected: equals 0 | max
 *   share           the element's width over the content width of its nearest `ref` ancestor             expected: min (0.95)
 *   skeleton-parity the shape-slot loading law: the unit `selector` matches renders twice, once loading (isSkeleton, a slot's
 *                   isLoading) and once ready with the same shape; the unit's box and the box of every leaf under it (an element
 *                   matching `leaf`, default any element, with no element child) match within `max` px (1). Leaves pair by their
 *                   child-index path under the unit, so a skeleton block standing in for a text span is the same leaf. A leaf
 *                   present in one render and missing in the other, or moved, is red with its path.      expected: max
 *
 * Pairing the two renders. In a Storybook (owner ruling 2026-10-28: a pure half's input is `{ shape?, props, on? }`), the loading
 * story carries `parameters: { dna: { pair: "<key>", phase: "loading" } }` and, when the unit has more than one drawn shape, the
 * `shape` arg of the shape it stands in for. Its ready twin is the story not in phase "loading" whose id is `<key>` or whose own
 * `parameters.dna.pair` is `<key>`, with the same `shape` arg when the loading story sets one. The gate reads these from the
 * rendered preview (`__STORYBOOK_PREVIEW__.currentRender.story`), since index.json carries no parameters; a story id's spelling
 * never pairs it. For routes and files (no Storybook), the name pairs them (SKELETON_SUFFIX): `card-skeleton.html` (or
 * `/card-skeleton`) is the loading render of `card.html` (`/card`). Both renders are opened by the same check; a loading render
 * whose ready twin is not opened is a problem (DNA_SKELETON_UNPAIRED), never skipped. The units pair in document order.
 *
 * An element without a box (display none) is not measured. The Grammar root is the nearest `[data-grammar-family]` ancestor; its
 * value picks the entries that bind the element.
 */

/** The metrics a measurement may name; core/dna/measure.ts reads each one in the page. */
export const DNA_METRICS = ["height", "width", "css", "attribute", "inset", "outside", "ancestors", "share", "skeleton-parity"] as const

/** One metric. */
export type DnaMetric = (typeof DNA_METRICS)[number]

/** The box edges an `inset` measurement reads. */
export const DNA_EDGES = ["top", "right", "bottom", "left"] as const

const NEEDS_PROPERTY: ReadonlySet<DnaMetric> = new Set(["css", "attribute"])
const NEEDS_REF: ReadonlySet<DnaMetric> = new Set(["inset", "outside", "ancestors", "share"])

/** What a measured value must be: one of equals (with a tolerance for numbers), a range, or a custom property's value. */
export const dnaExpectedSchema = z
    .strictObject({
        equals: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
        tolerance: z.number().min(0).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        var: z.string().regex(/^--[\w-]+$/).optional(),
    })
    .refine((expected) => expected.equals !== undefined || expected.min !== undefined || expected.max !== undefined || expected.var !== undefined, {
        message: "expected names equals, min, max or var",
    })

/** The expectation of one measurement. */
export type DnaExpected = z.infer<typeof dnaExpectedSchema>

/** One measurement: which elements, what is read on each, and what it must be. */
export const dnaMeasurementSchema = z
    .strictObject({
        selector: z.string().min(1),
        metric: z.enum(DNA_METRICS),
        property: z.string().min(1).optional(),
        ref: z.string().min(1).optional(),
        scope: z.string().min(1).optional(),
        edges: z.array(z.enum(DNA_EDGES)).min(1).optional(),
        leaf: z.string().min(1).optional(),
        expected: dnaExpectedSchema,
    })
    .superRefine((measure, context) => {
        if (NEEDS_PROPERTY.has(measure.metric) && measure.property === undefined) context.addIssue({ code: "custom", message: `metric ${measure.metric} needs property` })
        if (NEEDS_REF.has(measure.metric) && measure.ref === undefined) context.addIssue({ code: "custom", message: `metric ${measure.metric} needs ref` })
        if (measure.metric === "skeleton-parity" && measure.expected.max === undefined) context.addIssue({ code: "custom", message: "metric skeleton-parity needs expected.max (px)" })
        if (measure.leaf !== undefined && measure.metric !== "skeleton-parity") context.addIssue({ code: "custom", message: "leaf is read for metric skeleton-parity only" })
        if (measure.expected.var !== undefined && measure.metric !== "css") context.addIssue({ code: "custom", message: "expected.var is read for metric css only" })
    })

/** One measurement as the contract declares it. */
export type DnaMeasurement = z.infer<typeof dnaMeasurementSchema>

/** A machine-checkable mustKeep entry. */
export const dnaEntrySchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/, "an id is lower-case words joined by . or -"),
    law: z.string().min(1),
    families: z.array(z.string().min(1)).min(1).optional(),
    measure: dnaMeasurementSchema,
})

/** One measured law with the grammars it binds, as the gate loads it. */
export interface DnaEntry {
    readonly id: string
    readonly law: string
    readonly role: string | null
    readonly families: readonly string[]
    readonly measure: DnaMeasurement
}

/** The measured laws of a contract and the grammars it names. */
export interface DnaContract {
    readonly file: string
    readonly grammars: readonly string[]
    readonly entries: readonly DnaEntry[]
}

/** The grammar contract this harness ships: contexts/grammars/contract.yaml. */
export const defaultContractFile = (): string => join(runtimeRoot(), "contexts", "grammars", "contract.yaml")

const contractShape = z.looseObject({
    grammars: z.array(z.string().min(1)).min(1),
    mustKeep: z.array(z.unknown()).optional(),
    roles: z.array(z.looseObject({ id: z.string(), mustKeep: z.array(z.unknown()).optional() })).optional(),
})

const entryOf = (raw: unknown, role: string | null, grammars: readonly string[], file: string): DnaEntry | null => {
    if (typeof raw === "string") return null
    const where = role === null ? "mustKeep" : `role ${role} mustKeep`
    const parsed = dnaEntrySchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: a ${where} entry is neither prose nor a measured law: ${z.prettifyError(parsed.error)}`)
    const unknown = (parsed.data.families ?? []).filter((family) => !grammars.includes(family))
    if (unknown.length > 0) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: ${parsed.data.id} binds ${unknown.join(", ")}, which the contract's grammars (${grammars.join(", ")}) do not name`)
    return { id: parsed.data.id, law: parsed.data.law, role, families: parsed.data.families ?? grammars, measure: parsed.data.measure }
}

/** Reads every measured law of a grammar contract (prose items are skipped); refuses a malformed entry or a repeated id. */
export const loadDnaContract = (file: string = defaultContractFile()): DnaContract => {
    if (!existsSync(file)) throw new Refusal("DNA_CONTRACT_MISSING", `${file} does not exist`)
    const shape = contractShape.safeParse(parse(readFileSync(file, "utf8")))
    if (!shape.success) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: ${z.prettifyError(shape.error)}`)
    const { grammars } = shape.data
    const entries = [
        ...(shape.data.mustKeep ?? []).map((raw) => entryOf(raw, null, grammars, file)),
        ...(shape.data.roles ?? []).flatMap((role) => (role.mustKeep ?? []).map((raw) => entryOf(raw, role.id, grammars, file))),
    ].filter((entry): entry is DnaEntry => entry !== null)
    const seen = new Set<string>()
    for (const entry of entries) {
        if (seen.has(entry.id)) throw new Refusal("DNA_CONTRACT_INVALID", `${file}: the id ${entry.id} is declared twice`)
        seen.add(entry.id)
    }
    return { file, grammars, entries }
}

/** The measured laws that bind one grammar family. */
export const entriesFor = (contract: DnaContract, family: string): DnaEntry[] => contract.entries.filter((entry) => entry.families.includes(family))

/** One value a page measured on one element, with the expected value resolved in the page when the law names a custom property. */
export interface DnaSample {
    readonly path: string
    readonly measured: number | string | boolean | null
    readonly resolvedVar?: string
    /** skeleton-parity: the unit's box (key "") and each leaf's, keyed by its child-index path under the unit. */
    readonly boxes?: readonly DnaBox[]
}

/** One box a skeleton-parity sample carries: the key pairs it across the two renders, the path names it in a report. */
export interface DnaBox {
    readonly key: string
    readonly path: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** The suffix that marks a page or story as the loading (skeleton) render of the page named without it. */
export const SKELETON_SUFFIX = "-skeleton"

/** The ready twin of a skeleton page's name (story id, route or file), or null when the name is not a skeleton render's. */
export const readyTwinOf = (name: string): string | null => {
    const match = /^(.+?)-skeleton((?:\.[a-z0-9]+)?(?:[?#].*)?)$/i.exec(name)
    return match?.[1] === undefined ? null : `${match[1]}${match[2] ?? ""}`
}

/** One leaf (or the unit itself) whose box differs between the two renders: missing from one, or moved by more than the law allows. */
export interface ParityBreak {
    readonly path: string
    readonly measured: string
}

const shapeOf = (box: DnaBox): string => `${String(box.x)},${String(box.y)} ${String(box.width)}x${String(box.height)}`

/** Compares a unit's loading and ready samples: every box key of either must be in both and agree within `max` px. */
export const judgeParity = (max: number, skeleton: DnaSample, ready: DnaSample): ParityBreak[] => {
    const loading = new Map((skeleton.boxes ?? []).map((box) => [box.key, box]))
    const settled = new Map((ready.boxes ?? []).map((box) => [box.key, box]))
    const breaks: ParityBreak[] = []
    for (const [key, box] of settled) {
        const twin = loading.get(key)
        if (twin === undefined) {
            breaks.push({ path: box.path, measured: "missing in the skeleton render" })
            continue
        }
        const delta = Math.max(Math.abs(box.x - twin.x), Math.abs(box.y - twin.y), Math.abs(box.width - twin.width), Math.abs(box.height - twin.height))
        if (delta > max) breaks.push({ path: box.path, measured: `moved ${String(Math.round(delta * 100) / 100)}px: skeleton ${shapeOf(twin)}, ready ${shapeOf(box)}` })
    }
    for (const [key, box] of loading) if (!settled.has(key)) breaks.push({ path: box.path, measured: "missing in the ready render" })
    return breaks
}

const DEFAULT_TOLERANCE = 0.5

const asNumber = (value: DnaSample["measured"]): number | null => {
    if (typeof value === "number") return value
    if (typeof value !== "string") return null
    const match = /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim())
    return match?.[1] === undefined ? null : Number(match[1])
}

const normalise = (value: string): string => value.trim().replace(/\s+/g, " ")

/** Whether a measured value keeps the law; the reason names what it should have been when it does not. */
export const judgeSample = (expected: DnaExpected, sample: DnaSample): { readonly ok: boolean; readonly want: string } => {
    const { measured } = sample
    if (expected.var !== undefined) {
        const want = sample.resolvedVar ?? ""
        return { ok: typeof measured === "string" && want !== "" && normalise(measured) === normalise(want), want: `var(${expected.var}) = ${want === "" ? "unset" : want}` }
    }
    const wants: string[] = []
    let ok = true
    if (expected.equals !== undefined) {
        const target = expected.equals
        if (typeof target === "number") {
            const tolerance = expected.tolerance ?? DEFAULT_TOLERANCE
            const value = asNumber(measured)
            ok &&= value !== null && Math.abs(value - target) <= tolerance
            wants.push(`${String(target)} ±${String(tolerance)}`)
        } else if (typeof target === "string") {
            ok &&= typeof measured === "string" && normalise(measured) === normalise(target)
            wants.push(JSON.stringify(target))
        } else {
            ok &&= measured === target
            wants.push(String(target))
        }
    }
    if (expected.min !== undefined || expected.max !== undefined) {
        const value = asNumber(measured)
        if (expected.min !== undefined) {
            ok &&= value !== null && value >= expected.min
            wants.push(`>= ${String(expected.min)}`)
        }
        if (expected.max !== undefined) {
            ok &&= value !== null && value <= expected.max
            wants.push(`<= ${String(expected.max)}`)
        }
    }
    return { ok, want: wants.join(" and ") }
}
