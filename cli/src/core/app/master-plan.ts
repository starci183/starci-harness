import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { parse } from "yaml"
import { MASTER_PLAN_FILE, readMasterPlan } from "../../harness/master-plan.js"
import type { MasterPlanLayerId } from "../../harness/master-plan.js"
import { loadOps } from "../../harness/ops.js"
import { locateWorkRoot } from "../../harness/work.js"
import { Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"

/** The rule catalog of the installed @starci/hfs, the one the app check judges with. */
const CATALOG = "@starci/hfs/runtime/knowledge/hfs/rules.yaml"

/**
 * How a rule of the plan is held. `enforced`: it names machines only, an hfs rule with a built enforcer or a check preset; `partial`:
 * a machine holds a named part and `review` beside it holds the rest; `planned`: every hfs rule it names has its enforcers still
 * owed; `review`: a reviewer holds it and no machine does; `unenforced`: it names nothing; `unknown`: a name resolves to no rule
 * and no preset.
 */
export type RuleEnforcement = "enforced" | "partial" | "planned" | "review" | "unenforced" | "unknown"

interface RuleRow {
    readonly id: string
    readonly layer: MasterPlanLayerId
    readonly kind: "always" | "never"
    readonly text: string
    readonly enforcedBy: readonly string[]
    readonly status: RuleEnforcement
    /** Each name and what it resolved to. */
    readonly resolved: readonly { readonly name: string; readonly as: "hfs-rule" | "planned-hfs-rule" | "preset" | "review" | "unknown"; readonly detail: string }[]
}

interface AppMasterPlanData {
    readonly file: string | null
    readonly project: string | null
    readonly catalog: { readonly file: string; readonly version: string | null }
    readonly rules: readonly RuleRow[]
    readonly counts: Readonly<Record<RuleEnforcement, number>>
}

interface CatalogRule {
    readonly law: string
    readonly built: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** The installed catalog file: the app's own @starci/hfs (the pin its app check runs), else the CLI's. */
const catalogFile = (appRoot: string): string => {
    const own = join(appRoot, "node_modules", ...CATALOG.split("/"))
    if (existsSync(own)) return own
    try {
        return createRequire(import.meta.url).resolve(CATALOG)
    } catch {
        throw new Refusal("HFS_NOT_INSTALLED", `${CATALOG} resolves neither from the app nor from the CLI; run npm ci in the app or reinstall starci-harness`)
    }
}

/** The rules of a catalog file by id, with whether any enforcer of each is built (not `status: planned`). */
const readCatalog = (file: string): { readonly version: string | null; readonly rules: ReadonlyMap<string, CatalogRule> } => {
    const parsed: unknown = parse(readFileSync(file, "utf8"))
    const list = isRecord(parsed) && Array.isArray(parsed.rules) ? parsed.rules : []
    const rules = new Map<string, CatalogRule>()
    for (const rule of list) {
        if (!isRecord(rule) || typeof rule.id !== "string") continue
        const enforcers = Array.isArray(rule.enforcers) ? rule.enforcers.filter(isRecord) : []
        rules.set(rule.id, { law: typeof rule.law === "string" ? rule.law : "", built: enforcers.some((enforcer) => enforcer.status !== "planned") })
    }
    return { version: isRecord(parsed) && typeof parsed.version === "string" ? parsed.version : null, rules }
}

const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, width - 1)}…`)

/** The status of one rule from what each of its names resolved to. */
const statusOf = (resolved: RuleRow["resolved"]): RuleEnforcement => {
    if (resolved.length === 0) return "unenforced"
    if (resolved.some((entry) => entry.as === "unknown")) return "unknown"
    const machines = resolved.filter((entry) => entry.as !== "review")
    if (machines.length === 0) return "review"
    if (machines.every((entry) => entry.as === "planned-hfs-rule")) return "planned"
    return machines.length < resolved.length ? "partial" : "enforced"
}

/** `starci app master-plan`: each rule of the project's Master Plan and what holds it, so the plan shows which always/never rules a gate enforces. */
export const appMasterPlanVerb = defineVerb({
    path: ["app", "master-plan"],
    summary:
        "list each rule of the project's Master Plan (.starciwork/master-plan.yaml, PROJECT-MASTER-PLAN-3) with what holds it: enforced (its enforcedBy names only machines, each an hfs rule of the installed catalog with a built enforcer or a check preset of ops/checks.yaml), partial (a named machine holds a part and review the rest), planned (an hfs rule whose enforcers are all still owed), review (a reviewer only), unenforced (it names nothing) or unknown (a name that resolves to nothing, which exits 1); a malformed plan is refused MASTER_PLAN_INVALID and a project without one MASTER_PLAN_MISSING",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/app-master-plan@1",
    flags: {},
    run: async (context) => {
        const appRoot = context.treeRoot ?? context.cwd
        const workRoot = (await locateWorkRoot(context.cwd)).root
        const found = readMasterPlan(workRoot)
        if (found === undefined) throw new Refusal("MASTER_PLAN_MISSING", `${join(workRoot, MASTER_PLAN_FILE)} does not exist: write the project's Master Plan (contexts/project/master-plan-record.md PROJECT-MASTER-PLAN-1; the app scaffold writes the skeleton)`)
        const file = catalogFile(appRoot)
        const catalog = readCatalog(file)
        const presets = loadOps().presets
        const rules: RuleRow[] = found.plan.layers.flatMap((layer) =>
            layer.rules.map((rule) => {
                const names = rule.enforcedBy ?? []
                const resolved = names.map((name): RuleRow["resolved"][number] => {
                    if (name === "review") return { name, as: "review", detail: "held by review" }
                    const hfs = catalog.rules.get(name)
                    if (hfs !== undefined) return { name, as: hfs.built ? "hfs-rule" : "planned-hfs-rule", detail: clip(hfs.law, 160) }
                    const preset = presets[name]
                    if (preset !== undefined) return { name, as: "preset", detail: preset.summary }
                    return { name, as: "unknown", detail: /^R\d+$/.test(name) ? `no rule ${name} in ${file}` : `no hfs rule and no check preset ${name}` }
                })
                return { id: rule.id, layer: layer.id, kind: rule.kind, text: rule.text, enforcedBy: names, status: statusOf(resolved), resolved }
            }),
        )
        const counts: Record<RuleEnforcement, number> = { enforced: 0, partial: 0, planned: 0, review: 0, unenforced: 0, unknown: 0 }
        for (const row of rules) counts[row.status] += 1
        const data: AppMasterPlanData = { file: found.file, project: found.plan.project ?? null, catalog: { file, version: catalog.version }, rules, counts }
        const table = formatTable([
            ["LAYER", "RULE", "KIND", "STATUS", "BY", "TEXT"],
            ...rules.map((row) => [row.layer, row.id, row.kind, row.status, row.enforcedBy.join(", ") || "-", clip(row.text, 70)]),
        ])
        const unknown = rules.filter((row) => row.status === "unknown")
        const message = [
            `${found.file.replaceAll("\\", "/")}: ${String(rules.length)} rules against hfs rules ${catalog.version ?? "(unversioned)"} and ${String(Object.keys(presets).length)} check presets`,
            rules.length === 0 ? "no rule is written yet" : table,
            (Object.keys(counts) as RuleEnforcement[]).map((status) => `${status} ${String(counts[status])}`).join(", "),
            ...unknown.flatMap((row) => row.resolved.filter((entry) => entry.as === "unknown").map((entry) => `${row.id}: ${entry.detail}`)),
        ].join("\n")
        return { data, message, ...(unknown.length === 0 ? {} : { exitCode: 1 }) }
    },
})
