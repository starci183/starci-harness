import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { slotRuleGaps } from "./anatomy-render.js"

/** The gaps an owner ruling may hold open: a slot naming a rule code no rule carries, a rule with no enforcer, a rule whose enforcers are all planned. */
export const PENDABLE_GAPS = ["slot-rule-unknown", "rule-no-enforcer", "rule-enforcer-planned"] as const

/** The finding code of each gap, and of the two ways a pending entry itself is wrong. */
export const GAP_CODES = {
    "slot-rule-unknown": "ANATOMY_SLOT_RULE_UNKNOWN",
    "rule-no-enforcer": "ANATOMY_RULE_NO_ENFORCER",
    "rule-enforcer-planned": "ANATOMY_RULE_ENFORCER_PLANNED",
    "enforcer-kind-unknown": "ANATOMY_ENFORCER_KIND_UNKNOWN",
    "law-path-unresolved": "ANATOMY_LAW_PATH_UNRESOLVED",
    "pending-unruled": "ANATOMY_PENDING_UNRULED",
    "pending-stale": "ANATOMY_PENDING_STALE",
} as const
type GapKind = keyof typeof GAP_CODES

/** One gap between a slot, a rule and its enforcers; `pending` names the dated owner ruling that holds it open. */
export interface Gap {
    readonly code: (typeof GAP_CODES)[GapKind]
    readonly kind: GapKind
    readonly subject: string
    readonly detail: string
    readonly pending?: { readonly since: string; readonly ruling: string }
}

/** The gate's answer: the gaps that make `--check` red, and the gaps a live owner ruling holds pending. */
export interface GateVerdict {
    readonly red: readonly Gap[]
    readonly pending: readonly Gap[]
}

const pendingSchema = z.strictObject({
    gap: z.enum(PENDABLE_GAPS),
    subject: z.string().min(1),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "since is a YYYY-MM-DD date"),
    ruling: z.string().min(1),
})
type Pending = z.infer<typeof pendingSchema>

const catalogSchema = z.object({
    enforcerKinds: z.record(z.string(), z.string()),
    rules: z.array(
        z.object({
            id: z.string(),
            code: z.string(),
            law: z.string().optional(),
            enforcers: z.array(z.object({ kind: z.string(), id: z.string(), status: z.literal("planned").optional() })).optional(),
        }),
    ),
    pending: z.array(pendingSchema).optional(),
})

const rulingsSchema = z.object({
    rulings: z.array(z.object({ id: z.string(), status: z.string(), covers: z.array(z.string()).optional() })),
})

const readParsed = <T>(file: string, schema: z.ZodType<T>): T => {
    if (!existsSync(file)) throw new Refusal("KNOWLEDGE_INVALID", `${file} does not exist`)
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("KNOWLEDGE_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const result = schema.safeParse(raw)
    if (!result.success) throw new Refusal("KNOWLEDGE_INVALID", `${file} is invalid: ${z.prettifyError(result.error)}`)
    return result.data
}

const gap = (kind: GapKind, subject: string, detail: string, pending?: Pending): Gap => ({
    code: GAP_CODES[kind],
    kind,
    subject,
    detail,
    ...(pending === undefined ? {} : { pending: { since: pending.since, ruling: pending.ruling } }),
})

// A path a law cites: under contexts/, packages/, policy/ or ops/ of the harness, with an optional `#anchor`.
const LAW_PATH = /\b((?:contexts|packages|policy|ops)\/[\w./-]*[\w/])(#[\w-]+)?/g

/** The paths a rule's law cites, as written (`contexts/stack/pins.yaml#peers`). */
const lawPaths = (law: string): string[] => [...new Set([...law.matchAll(LAW_PATH)].map((match) => match[0]))]

/** A GitHub-style heading anchor. */
const slug = (heading: string): string =>
    heading
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, "-")

/**
 * Why a cited path does not resolve, or undefined when it does: a `contexts/` path is read in the knowledge folder, any other
 * in the runtime root; an anchor names a top-level key of a yaml file or a heading of a Markdown file.
 */
const unresolvedPath = (knowledge: string, cited: string): string | undefined => {
    const [path = "", anchor] = cited.split("#")
    const file = path.startsWith("contexts/") ? join(knowledge, path.slice("contexts/".length)) : join(runtimeRoot(), path)
    if (!existsSync(file)) return "does not exist"
    if (anchor === undefined) return undefined
    const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n")
    if (/\.ya?ml$/.test(path)) {
        const doc: unknown = parse(text)
        return typeof doc === "object" && doc !== null && anchor in doc ? undefined : `has no top-level key ${anchor}`
    }
    const headings = text.split("\n").flatMap((line) => /^#{1,6}\s+(.*)$/.exec(line)?.[1] ?? [])
    return headings.some((heading) => slug(heading) === anchor) ? undefined : `has no heading #${anchor}`
}

/** The pendable gaps of the catalog and the slots, before any pending entry is applied. */
const openGaps = (knowledge: string, catalog: z.infer<typeof catalogSchema>): { readonly pendable: readonly Gap[]; readonly hard: readonly Gap[] } => {
    const pendable: Gap[] = []
    const hard: Gap[] = []
    for (const [code, slots] of slotRuleGaps(knowledge)) {
        const named = slots.length === 1 ? `slot ${slots.join("")} names` : `slots ${slots.join(", ")} name`
        pendable.push(gap("slot-rule-unknown", code, `${named} ${code}, which no rule of hfs/rules.yaml carries as its code or a failure code`))
    }
    for (const rule of catalog.rules) {
        const enforcers = rule.enforcers ?? []
        if (enforcers.length === 0) pendable.push(gap("rule-no-enforcer", rule.id, `${rule.id} (${rule.code}) names no enforcer`))
        else if (enforcers.every((enforcer) => enforcer.status === "planned")) {
            pendable.push(gap("rule-enforcer-planned", rule.id, `${rule.id} (${rule.code}) is judged only by planned enforcers: ${enforcers.map((enforcer) => `${enforcer.kind} ${enforcer.id}`).join(", ")}`))
        }
        for (const enforcer of enforcers.filter((item) => !(item.kind in catalog.enforcerKinds))) {
            hard.push(gap("enforcer-kind-unknown", rule.id, `${rule.id} names enforcer ${enforcer.id} of kind ${enforcer.kind}, which enforcerKinds does not declare`))
        }
        for (const cited of lawPaths(rule.law ?? "")) {
            const why = unresolvedPath(knowledge, cited)
            if (why !== undefined) hard.push(gap("law-path-unresolved", rule.id, `${rule.id}'s law cites ${cited}, which ${why}`))
        }
    }
    return { pendable, hard }
}

/**
 * The completeness gate of `contexts anatomy --check`: every slot rule code resolves to a rule, every rule names an enforcer,
 * and not only planned ones, of a declared kind, and every path its law cites resolves (never pendable). A gap stays pending (not red) only while a dated entry of rules.yaml's `pending` list holds it
 * and the live owner ruling that entry cites (contexts/decisions/rulings.yaml) lists it in `covers`; an entry with no such
 * ruling is ANATOMY_PENDING_UNRULED and one that holds no gap is ANATOMY_PENDING_STALE, so the list only shrinks.
 */
export const judgeAnatomy = (knowledge: string): GateVerdict => {
    const catalog = readParsed(join(knowledge, "hfs", "rules.yaml"), catalogSchema)
    const rulingsFile = join(knowledge, "decisions", "rulings.yaml")
    const declared = catalog.pending ?? []
    const rulings = declared.length === 0 ? [] : readParsed(rulingsFile, rulingsSchema).rulings
    const covered = (entry: Pending): boolean => rulings.some((ruling) => ruling.id === entry.ruling && ruling.status === "live" && (ruling.covers ?? []).includes(entry.subject))
    const { pendable, hard } = openGaps(knowledge, catalog)
    const red: Gap[] = [...hard]
    const pending: Gap[] = []
    const used = new Set<Pending>()
    for (const found of pendable) {
        const entry = declared.find((item) => item.gap === found.kind && item.subject === found.subject)
        if (entry === undefined) {
            red.push(found)
            continue
        }
        used.add(entry)
        if (covered(entry)) pending.push({ ...found, pending: { since: entry.since, ruling: entry.ruling } })
        else red.push(gap("pending-unruled", found.subject, `${found.detail}; its pending entry cites ${entry.ruling}, which is no live ruling of ${rulingsFile} listing ${found.subject} in covers`, entry))
    }
    for (const entry of declared.filter((item) => !used.has(item))) {
        red.push(gap("pending-stale", entry.subject, `the pending ${entry.gap} entry for ${entry.subject} holds no open gap: remove it from hfs/rules.yaml`, entry))
    }
    return { red, pending }
}
