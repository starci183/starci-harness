import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { slotRuleGaps } from "./anatomy-render.js"
import { CAPABILITIES_FILE, capabilityGaps } from "./capability-owners.js"
import { judgeRuleDocs } from "./knowledge-gates.js"
import type { KnowledgeFinding } from "./knowledge-gates.js"

/** The finding code of each gap. */
export const GAP_CODES = {
    "slot-rule-unknown": "ANATOMY_SLOT_RULE_UNKNOWN",
    "enforcer-kind-unknown": "ANATOMY_ENFORCER_KIND_UNKNOWN",
    "law-path-unresolved": "ANATOMY_LAW_PATH_UNRESOLVED",
    "rule-no-doc": "ANATOMY_RULE_NO_DOC",
    "rule-covers-missing": "ANATOMY_RULE_COVERS_MISSING",
    "rule-covers-duplicate": "ANATOMY_RULE_COVERS_DUPLICATE",
    "rule-engine-mismatch": "ANATOMY_RULE_ENGINE_MISMATCH",
    "code-two-rules": "ANATOMY_CODE_TWO_RULES",
    "enforcer-two-rules": "ANATOMY_ENFORCER_TWO_RULES",
    "catalog-drift": "ANATOMY_CATALOG_DRIFT",
    "capability-reimplemented": "ANATOMY_CAPABILITY_REIMPLEMENTED",
    "capability-known-stale": "ANATOMY_CAPABILITY_KNOWN_STALE",
} as const
type GapKind = keyof typeof GAP_CODES

/** One gap between a slot, a rule and its enforcers. */
export interface Gap {
    readonly code: (typeof GAP_CODES)[GapKind]
    readonly kind: GapKind
    readonly subject: string
    readonly detail: string
}

/** A rule judged only by enforcers marked `status: planned`: listed for information, never red; it is held by review until a check ships. */
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
    sharedEnforcers: z.record(z.string(), z.string()).optional(),
    rules: z.array(
        z.object({
            id: z.string(),
            code: z.string(),
            law: z.string().optional(),
            failureCodes: z.array(z.string()).optional(),
            covers: z.string().optional(),
            split: z.string().optional(),
            enforcers: z.array(z.object({ kind: z.string(), id: z.string(), status: z.literal("planned").optional() })).optional(),
        }),
    ),
})
type Catalog = z.infer<typeof catalogSchema>
type CatalogRule = Catalog["rules"][number]

/** The runtime's own rule catalog, as far as the one-owner gate compares it: ids, codes and enforcers. */
const runtimeCatalogSchema = z.object({
    enforcerKinds: z.record(z.string(), z.unknown()).optional(),
    rules: z.array(z.object({ id: z.string(), code: z.string(), failureCodes: z.array(z.string()).optional(), enforcers: z.array(z.object({ kind: z.string(), id: z.string() })).optional() })),
})

/** The runtime catalog, beside the knowledge folder in the harness checkout (absent in a bare knowledge tree). */
export const RUNTIME_CATALOG = join("packages", "hfs", "runtime", "knowledge", "hfs", "rules.yaml")

/** The engine of an enforcer kind: the lint engines judge code inside one file, hfs and the machine the repository, Sonar its gate. */
const engineOf = (kind: string): "code" | "repo" | "quality" => (/^(?:eslint-|stylelint$|grammar-lint$)/.test(kind) ? "code" : kind === "sonar" ? "quality" : "repo")

/** The engine a rule's enforcers make it: `review` with none, `split` when a lint engine and hfs or the machine both judge it. */
export const engineOfRule = (rule: Pick<CatalogRule, "enforcers">): string => {
    const engines = new Set((rule.enforcers ?? []).map((enforcer) => engineOf(enforcer.kind)))
    if (engines.size === 0) return "review"
    if (engines.has("code") && engines.has("repo")) return "split"
    return [...engines].sort().join("+")
}

/**
 * The one-owner gaps of the catalog (contexts/project/lint.md PROJECT-LINT-7): every rule declares the condition it covers and the engine that
 * owns it, no two rules cover one condition or carry one failure code, a rule two engines judge says how they split it, and an enforcer serves
 * one rule unless `sharedEnforcers` says why it serves several.
 */
export const oneOwnerGaps = (catalog: Pick<Catalog, "rules" | "sharedEnforcers">): Gap[] => {
    const red: Gap[] = []
    const covers = new Map<string, string>()
    const codes = new Map<string, string>()
    const enforcers = new Map<string, string[]>()
    for (const rule of catalog.rules) {
        if (rule.covers === undefined || rule.covers.trim() === "") red.push(gap("rule-covers-missing", rule.id, `${rule.id} declares no covers: name the condition it owns as <engine>/<condition>`))
        else {
            const owner = covers.get(rule.covers)
            if (owner !== undefined) red.push(gap("rule-covers-duplicate", rule.id, `${rule.id} and ${owner} both cover ${rule.covers}: one condition has one rule; merge them and keep the better-placed check`))
            else covers.set(rule.covers, rule.id)
            const engine = engineOfRule(rule)
            const declared = rule.covers.split("/")[0]
            if (declared !== engine) red.push(gap("rule-engine-mismatch", rule.id, `${rule.id} covers ${rule.covers}, but its enforcers make it ${engine}: correct covers or move the check to the engine that owns the condition`))
            if (engine === "split" && (rule.split ?? "").trim() === "") red.push(gap("rule-engine-mismatch", rule.id, `${rule.id} is judged by a lint engine and by hfs or the machine and its split says nothing: say what each reads, or keep one`))
        }
        for (const code of new Set([rule.code, ...(rule.failureCodes ?? [])])) {
            const owner = codes.get(code)
            if (owner !== undefined && owner !== rule.id) red.push(gap("code-two-rules", code, `${code} is carried by ${owner} and ${rule.id}: a failure code belongs to one rule`))
            else codes.set(code, rule.id)
        }
        for (const enforcer of rule.enforcers ?? []) {
            const key = `${enforcer.kind}:${enforcer.id}`
            enforcers.set(key, [...(enforcers.get(key) ?? []), rule.id])
        }
    }
    for (const [key, rules] of enforcers) {
        const distinct = [...new Set(rules)]
        if (distinct.length > 1 && catalog.sharedEnforcers?.[key] === undefined) red.push(gap("enforcer-two-rules", key, `${key} is an enforcer of ${distinct.join(", ")}: one check judges one condition; keep it under one rule, or say in sharedEnforcers why one module reports several rules' codes`))
    }
    for (const key of Object.keys(catalog.sharedEnforcers ?? {})) {
        if ((enforcers.get(key)?.length ?? 0) < 2) red.push(gap("enforcer-two-rules", key, `sharedEnforcers names ${key}, which no longer serves two rules: delete the entry`))
    }
    return red
}

const sortedSet = (values: readonly string[]): string => [...new Set(values)].sort().join(", ")

/**
 * Where this catalog and the runtime's disagree: a rule only one of them holds (the runtime's rules judged only by runtime-only kinds aside),
 * its code, its failure codes, or its lint enforcers. Two hand-kept catalogs that drift let a removed check live on in one of them.
 */
export const catalogDrift = (catalog: Pick<Catalog, "rules" | "enforcerKinds">, runtime: z.infer<typeof runtimeCatalogSchema>): Gap[] => {
    const red: Gap[] = []
    const ours = new Map(catalog.rules.map((rule) => [rule.id, rule]))
    const theirs = new Map(runtime.rules.map((rule) => [rule.id, rule]))
    const judgedHere = (kind: string): boolean => kind in catalog.enforcerKinds
    // A lint kind only one catalog declares (the Grammar package's own lint is the contexts catalog's) is compared by neither.
    const judgedByBoth = (kind: string): boolean => judgedHere(kind) && (runtime.enforcerKinds === undefined || kind in runtime.enforcerKinds)
    const lint = (list: readonly { readonly kind: string; readonly id: string }[] | undefined): string => sortedSet((list ?? []).filter((one) => judgedByBoth(one.kind) && engineOf(one.kind) === "code").map((one) => `${one.kind}:${one.id}`))
    for (const [id, rule] of theirs) {
        const enforcers = rule.enforcers ?? []
        const runtimeOnly = enforcers.length > 0 && enforcers.every((one) => !judgedHere(one.kind))
        if (!ours.has(id) && !runtimeOnly) red.push(gap("catalog-drift", id, `${id} (${rule.code}) is in the runtime catalog and not in hfs/rules.yaml`))
    }
    for (const [id, rule] of ours) {
        const other = theirs.get(id)
        if (other === undefined) {
            red.push(gap("catalog-drift", id, `${id} (${rule.code}) is in hfs/rules.yaml and not in the runtime catalog`))
            continue
        }
        if (other.code !== rule.code) red.push(gap("catalog-drift", id, `${id} is ${rule.code} here and ${other.code} in the runtime catalog`))
        if (sortedSet([rule.code, ...(rule.failureCodes ?? [])]) !== sortedSet([other.code, ...(other.failureCodes ?? [])])) red.push(gap("catalog-drift", id, `${id}'s failure codes differ: [${sortedSet(rule.failureCodes ?? [])}] here, [${sortedSet(other.failureCodes ?? [])}] in the runtime catalog`))
        if (lint(rule.enforcers) !== lint(other.enforcers)) red.push(gap("catalog-drift", id, `${id}'s lint enforcers differ: [${lint(rule.enforcers)}] here, [${lint(other.enforcers)}] in the runtime catalog`))
    }
    return red
}

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
    const file = path.startsWith("contexts/") ? join(knowledge, path.slice("contexts/".length)) : join(knowledge, "..", path)
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
 * The completeness gate of `contexts anatomy` (its dry run): every slot rule code resolves to a rule, every enforcer a rule names is of
 * a declared kind and every path its law cites resolves, and every rule is named by a page of the living knowledge. A rule may name no
 * enforcer (it is held by review); a rule whose every enforcer is `status: planned` is not a gap either: it is listed in `planned`.
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
        if (enforcers.length > 0 && enforcers.every((enforcer) => enforcer.status === "planned")) planned.push({ id: rule.id, code: rule.code, enforcers: enforcers.map((enforcer) => `${enforcer.kind} ${enforcer.id}`) })
        for (const enforcer of enforcers.filter((item) => !(item.kind in catalog.enforcerKinds))) {
            red.push(gap("enforcer-kind-unknown", rule.id, `${rule.id} names enforcer ${enforcer.id} of kind ${enforcer.kind}, which enforcerKinds does not declare`))
        }
        for (const cited of lawPaths(rule.law ?? "")) {
            const why = unresolvedPath(knowledge, cited)
            if (why !== undefined) red.push(gap("law-path-unresolved", rule.id, `${rule.id}'s law cites ${cited}, which ${why}`))
        }
    }
    red.push(...oneOwnerGaps(catalog))
    const runtimeFile = join(knowledge, "..", RUNTIME_CATALOG)
    if (existsSync(runtimeFile)) red.push(...catalogDrift(catalog, readParsed(runtimeFile, runtimeCatalogSchema)))
    red.push(...capabilityGaps(join(knowledge, ".."), join(knowledge, CAPABILITIES_FILE)).map((found) => gap(found.kind, found.subject, found.detail)))
    const knowledgeFindings: KnowledgeFinding[] = judgeRuleDocs(knowledge)
    red.push(...knowledgeFindings.map((finding) => gap(finding.kind, finding.subject, finding.detail)))
    return { red, planned }
}
