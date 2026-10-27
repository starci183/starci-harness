import { existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { judgeShapes } from "../../harness/shapes.js"
import type { StoriesFinding } from "../../harness/shapes.js"
import { loadTypeScript, readAppShapes } from "../../harness/shapes-parse.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** What the check read in one front-end app. */
interface AppSummary {
    readonly root: string
    readonly unions: number
    readonly shapes: number
    readonly bases: number
    readonly slots: number
    readonly stories: number
    readonly findings: readonly StoriesFinding[]
}

interface StoriesData {
    readonly apps: readonly AppSummary[]
    readonly findings: number
    readonly verdict: "green" | "red"
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The front-end app folders an app's hfs.json declares: `fe/apps/<name>` per `sides.fe.apps[].name`. */
const declaredFrontEnds = (treeRoot: string | undefined): string[] => {
    const file = treeRoot === undefined ? undefined : join(treeRoot, "hfs.json")
    if (treeRoot === undefined || file === undefined || !existsSync(file)) throw new Refusal("STORIES_NOT_APP", "run this inside an app (an hfs.json with sides.fe.apps), or name the front-end app with --path")
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    const sides = isRecord(parsed) && isRecord(parsed.sides) ? parsed.sides : {}
    const apps = isRecord(sides.fe) && Array.isArray(sides.fe.apps) ? sides.fe.apps : []
    const names = apps.flatMap((app) => (isRecord(app) && typeof app.name === "string" ? [app.name] : []))
    if (names.length === 0) throw new Refusal("STORIES_NO_FRONT_END", `${file} declares no front-end app (sides.fe.apps); the runtime and a back-end-only app have no stories to check`)
    return names.map((name) => join(treeRoot, "fe", "apps", name))
}

const summarise = (root: string): AppSummary => {
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Refusal("STORIES_APP_MISSING", `${root} is not a folder; hfs.json names a front-end app that does not exist`)
    const app = readAppShapes(loadTypeScript(root), root)
    return {
        root,
        unions: app.unions.length,
        shapes: app.unions.reduce((sum, union) => sum + union.members.length, 0),
        bases: app.bases.length,
        slots: app.bases.reduce((sum, base) => sum + base.slots.length, 0),
        stories: app.stories.length,
        findings: judgeShapes(app),
    }
}

const describe = (app: AppSummary): string[] => [
    `${app.findings.length === 0 ? "green" : "red  "} ${app.root}: ${String(app.shapes)} shape(s) in ${String(app.unions)} XShape union(s), ${String(app.slots)} slot(s) in ${String(app.bases)} XBaseProps, ${String(app.stories)} story export(s)`,
    ...app.findings.map((finding) => `  ${finding.file}:${String(finding.line)} ${finding.code} ${finding.message}`),
]

/**
 * `starci check stories`: the shape-slot law across a front end's files. Every member of an `XShape` union (a pure half's
 * component.tsx or modules/types) has a story setting `shape` to it, every `DataSlot` of a pure half's props is drawn loading
 * by a story (the skeleton story), no story names a shape its unit's union lacks, and the retired `state` / `XState` names are
 * red (owner ruling 2026-10-28). Stories are the `*.stories.ts(x)`
 * files anywhere under the app; a story belongs to the unit its meta's `component` names (`XBase` draws X).
 */
export const checkStoriesVerb = defineVerb({
    path: ["check", "stories"],
    summary: "red when an XShape member has no story, a pure half's DataSlot has no skeleton (loading) story, a story names a shape its union lacks, or the retired state/XState names remain",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-stories@1",
    flags: {
        path: { kind: "string", summary: "the front-end app folder to check (default: every fe/apps/<name> hfs.json sides.fe.apps declares)" },
    },
    run: (context, flags) => {
        const roots = flags.path === undefined ? declaredFrontEnds(context.treeRoot) : [resolve(context.cwd, flags.path)]
        const apps = roots.map(summarise)
        const findings = apps.reduce((sum, app) => sum + app.findings.length, 0)
        const verdict = findings === 0 ? "green" : "red"
        const data: StoriesData = { apps, findings, verdict }
        return Promise.resolve({ data, message: [...apps.flatMap(describe), `verdict: ${verdict}`].join("\n"), exitCode: verdict === "red" ? 1 : 0 })
    },
})
