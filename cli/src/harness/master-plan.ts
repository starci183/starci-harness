import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"

/**
 * The Master Plan of a project (contexts/project/master-plan-record.md PROJECT-MASTER-PLAN-1): `.starciwork/master-plan.yaml` at its Work
 * root, nine layers in a fixed order, each with its decisions, its reason, its always/never rules and an optional roadmap. A brief
 * carries the layers its op names (`masterPlan` of the op front matter); `starci app master-plan` reports what enforces each rule.
 * The app check judges the same shape (R449, `@starci/hfs` rules/master-plan.mts); this reader refuses what that check refuses.
 */
export const MASTER_PLAN_FILE = ".starciwork/master-plan.yaml"

/** The schema tag of a Master Plan. */
export const MASTER_PLAN_SCHEMA = "starci/master-plan@1"

/** The nine layers, in the order the file holds them: a later layer never contradicts an earlier one. */
export const MASTER_PLAN_LAYERS = ["business", "tech", "patterns", "ui", "data", "testing", "security", "observability", "domains"] as const

/** One layer id. */
export type MasterPlanLayerId = (typeof MASTER_PLAN_LAYERS)[number]

/** A layer id, as an op's front matter names it. */
export const masterPlanLayerSchema = z.enum(MASTER_PLAN_LAYERS)

const text = z.string().trim().min(1)

/** What may enforce a rule: an hfs rule id (`R<n>`), a check preset of ops/checks.yaml, or `review`. */
const enforcerName = z.string().regex(/^(?:R\d+|review|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/, "an hfs rule id R<n>, a check preset name or review")

const ruleSchema = z.strictObject({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/, "an id of letters, digits and dashes"),
    kind: z.enum(["always", "never"]),
    text,
    enforcedBy: z.union([enforcerName.transform((name) => [name]), z.array(enforcerName).min(1)]).optional(),
})

/** One rule of a layer. */
export type MasterPlanRule = z.output<typeof ruleSchema>

const layerSchema = z.strictObject({
    id: masterPlanLayerSchema,
    title: text.optional(),
    decisions: z.array(text),
    reason: z.string(),
    rules: z.array(ruleSchema),
    roadmap: z.array(text).optional(),
})

/** One layer of a Master Plan. */
export type MasterPlanLayer = z.output<typeof layerSchema>

const planSchema = z
    .strictObject({
        schema: z.literal(MASTER_PLAN_SCHEMA),
        project: text.optional(),
        layers: z.array(layerSchema).length(MASTER_PLAN_LAYERS.length),
    })
    .superRefine((plan, context) => {
        plan.layers.forEach((layer, index) => {
            const expected = MASTER_PLAN_LAYERS[index]
            if (layer.id !== expected) context.addIssue({ code: "custom", path: ["layers", index, "id"], message: `layer ${String(index + 1)} is ${String(expected)} (the order is ${MASTER_PLAN_LAYERS.join(", ")})` })
        })
        const seen = new Set<string>()
        plan.layers.forEach((layer, index) => {
            layer.rules.forEach((rule, at) => {
                if (seen.has(rule.id)) context.addIssue({ code: "custom", path: ["layers", index, "rules", at, "id"], message: `${rule.id} is used by another rule` })
                seen.add(rule.id)
            })
        })
    })

/** A parsed Master Plan. */
export type MasterPlan = z.output<typeof planSchema>

/** Parses a Master Plan's text; refuses MASTER_PLAN_INVALID with every problem. */
export const parseMasterPlan = (source: string, where: string): MasterPlan => {
    let raw: unknown
    try {
        raw = parse(source)
    } catch (error: unknown) {
        throw new Refusal("MASTER_PLAN_INVALID", `${where} is not YAML: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = planSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("MASTER_PLAN_INVALID", `${where} breaks ${MASTER_PLAN_SCHEMA} (contexts/project/master-plan-record.md PROJECT-MASTER-PLAN-1):\n${z.prettifyError(parsed.error)}`)
    return parsed.data
}

/** The Work root a side repository's hfs.json names (`work.root`, relative to it), or undefined; read leniently, since work.ts owns its refusals. */
const declaredWorkRoot = (dir: string): string | undefined => {
    try {
        const declared: unknown = JSON.parse(readFileSync(join(dir, "hfs.json"), "utf8"))
        const root = (declared as { readonly work?: { readonly root?: unknown } } | null)?.work?.root
        return typeof root === "string" && root !== "" ? resolve(dir, root) : undefined
    } catch {
        return undefined
    }
}

/**
 * The Master Plan of the first of `roots` that holds one, each root tried itself and then the Work root its hfs.json names (a side
 * repository's plan lives in its app root), with its file; undefined when none does.
 */
export const readMasterPlan = (...dirs: readonly string[]): { readonly file: string; readonly plan: MasterPlan } | undefined => {
    const roots = dirs.flatMap((dir) => [dir, ...[declaredWorkRoot(dir)].filter((root): root is string => root !== undefined)])
    for (const root of roots) {
        const file = join(root, MASTER_PLAN_FILE)
        if (existsSync(file)) return { file, plan: parseMasterPlan(readFileSync(file, "utf8"), file) }
    }
    return undefined
}

const code = (value: string): string => `\`${value}\``

/** One layer in words: its decisions, reason, rules (with what enforces each) and roadmap. */
const layerText = (layer: MasterPlanLayer): string => {
    const heading = `#### ${layer.title === undefined ? layer.id : `${layer.id}: ${layer.title}`}`
    const parts = [heading]
    if (layer.decisions.length === 0 && layer.rules.length === 0 && layer.reason.trim() === "") return [heading, "Nothing is decided in this layer yet."].join("\n\n")
    if (layer.decisions.length > 0) parts.push(`Decisions:\n${layer.decisions.map((decision) => `- ${decision}`).join("\n")}`)
    if (layer.reason.trim() !== "") parts.push(`Reason: ${layer.reason.trim()}`)
    if (layer.rules.length > 0) {
        const rules = layer.rules.map((rule) => {
            const by = rule.enforcedBy === undefined ? "" : ` (enforced by ${rule.enforcedBy.join(", ")})`
            return `- ${rule.id}, ${rule.kind}: ${rule.text}${by}`
        })
        parts.push(`Rules:\n${rules.join("\n")}`)
    }
    if (layer.roadmap !== undefined && layer.roadmap.length > 0) parts.push(`Roadmap (not decided for now, never built ahead):\n${layer.roadmap.map((item) => `- ${item}`).join("\n")}`)
    return parts.join("\n\n")
}

/**
 * The "Master Plan" section of a brief: the layers `layers` of the plan, in plan order, and the stop-and-ask procedure; a line saying
 * the project keeps none when `found` is undefined.
 */
export const masterPlanSection = (found: { readonly file: string; readonly plan: MasterPlan } | undefined, layers: readonly MasterPlanLayerId[], label: string): string => {
    const names = layers.map(code).join(", ")
    if (found === undefined) return `This project keeps no Master Plan (${code(MASTER_PLAN_FILE)}), so no layer ${names} binds this ${label} task beyond its contract and the files it reads.`
    const wanted = new Set<string>(layers)
    const chosen = found.plan.layers.filter((layer) => wanted.has(layer.id))
    return [
        `The project's Master Plan (${code(found.file.replaceAll("\\", "/"))}): the layers a ${label} task holds, ${names}. Its decisions and rules bind your work as the contract does. A task that contradicts one of them stops and asks: change nothing it contradicts, file \`blocked\` with a \`question\` that names the rule id (or the decision) and the contradiction, and give the change of the plan you propose as \`default\`. The plan changes first, then the code.`,
        ...chosen.map(layerText),
    ].join("\n\n")
}
