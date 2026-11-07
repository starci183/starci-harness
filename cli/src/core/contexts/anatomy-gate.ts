import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { slotRuleGaps } from "./anatomy-render.js"
import { grammarSourceDir, judgeRemovedVocabulary, judgeRuleDocs, judgeRulingHistory, judgeShippedVocabulary, judgeVendorWrappers } from "./knowledge-gates.js"
import type { KnowledgeFinding } from "./knowledge-gates.js"

/** The finding code of each gap. */
export const GAP_CODES = {
    "slot-rule-unknown": "ANATOMY_SLOT_RULE_UNKNOWN",
    "rule-no-enforcer": "ANATOMY_RULE_NO_ENFORCER",
    "enforcer-kind-unknown": "ANATOMY_ENFORCER_KIND_UNKNOWN",
    "law-path-unresolved": "ANATOMY_LAW_PATH_UNRESOLVED",
    "rule-no-doc": "ANATOMY_RULE_NO_DOC",
    "removed-vocabulary-used": "ANATOMY_REMOVED_VOCABULARY_USED",
    "wrapper-stale": "ANATOMY_WRAPPER_STALE",
    "wrapper-undeclared": "ANATOMY_WRAPPER_UNDECLARED",
    "wrapper-wraps-drift": "ANATOMY_WRAPPER_WRAPS_DRIFT",
    "wrapper-pin-drift": "ANATOMY_WRAPPER_PIN_DRIFT",
    "wrapper-rule-unknown": "ANATOMY_WRAPPER_RULE_UNKNOWN",
    "ruling-history": "ANATOMY_RULING_HISTORY",
} as const
type GapKind = keyof typeof GAP_CODES

/** One gap between a slot, a rule and its enforcers. */
export interface Gap {
    readonly code: (typeof GAP_CODES)[GapKind]
    readonly kind: GapKind
    readonly subject: string
    readonly detail: string
}

/** A rule judged only by enforcers still owed (`status: planned`): listed, never red, until its check ships. */
export interface PlannedRule {
    readonly id: string
    readonly code: string
    readonly enforcers: readonly string[]
}

/** The gate's answer: the gaps that make its dry run red, and the rules judged only by planned enforcers. */
export interface GateVerdict {
    readonly red: readonly Gap[]
    readonly planned: readonly PlannedRule[]
}

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

const gap = (kind: GapKind, subject: string, detail: string): Gap => ({ code: GAP_CODES[kind], kind, subject, detail })

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
    // The text after the `#` run and one blank; slug trims the rest.
    const headings = text.split("\n").flatMap((line) => /^#{1,6}\s(.*)$/.exec(line)?.[1] ?? [])
    return headings.some((heading) => slug(heading) === anchor) ? undefined : `has no heading #${anchor}`
}

/**
 * The completeness gate of `contexts anatomy` (its dry run): every slot rule code resolves to a rule, every rule names an enforcer
 * of a declared kind and every path its law cites resolves, every rule is named by a page of the living knowledge, no removed
 * spelling is written as code there, vendor/wrappers.yaml matches the Grammar source and its pin, and no governed file cites
 * decision history instead of the rule (ANATOMY_RULING_HISTORY). A rule whose every
 * enforcer is `status: planned` is not a gap: it is listed in `planned` until its check ships.
 */
export const judgeAnatomy = (knowledge: string): GateVerdict => {
    const catalog = readParsed(join(knowledge, "hfs", "rules.yaml"), catalogSchema)
    const red: Gap[] = []
    const planned: PlannedRule[] = []
    for (const [code, slots] of slotRuleGaps(knowledge)) {
        const named = slots.length === 1 ? `slot ${slots.join("")} names` : `slots ${slots.join(", ")} name`
        red.push(gap("slot-rule-unknown", code, `${named} ${code}, which no rule of hfs/rules.yaml carries as its code or a failure code`))
    }
    for (const rule of catalog.rules) {
        const enforcers = rule.enforcers ?? []
        if (enforcers.length === 0) red.push(gap("rule-no-enforcer", rule.id, `${rule.id} (${rule.code}) names no enforcer`))
        else if (enforcers.every((enforcer) => enforcer.status === "planned")) planned.push({ id: rule.id, code: rule.code, enforcers: enforcers.map((enforcer) => `${enforcer.kind} ${enforcer.id}`) })
        for (const enforcer of enforcers.filter((item) => !(item.kind in catalog.enforcerKinds))) {
            red.push(gap("enforcer-kind-unknown", rule.id, `${rule.id} names enforcer ${enforcer.id} of kind ${enforcer.kind}, which enforcerKinds does not declare`))
        }
        for (const cited of lawPaths(rule.law ?? "")) {
            const why = unresolvedPath(knowledge, cited)
            if (why !== undefined) red.push(gap("law-path-unresolved", rule.id, `${rule.id}'s law cites ${cited}, which ${why}`))
        }
    }
    const knowledgeFindings: KnowledgeFinding[] = [...judgeRuleDocs(knowledge), ...judgeRemovedVocabulary(knowledge), ...judgeShippedVocabulary(knowledge), ...judgeVendorWrappers(knowledge, grammarSourceDir()), ...judgeRulingHistory(join(knowledge, ".."))]
    red.push(...knowledgeFindings.map((finding) => gap(finding.kind, finding.subject, finding.detail)))
    return { red, planned }
}
