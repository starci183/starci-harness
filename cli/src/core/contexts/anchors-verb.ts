import { isAbsolute, join, resolve } from "node:path"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { EVAL_FILE, checkAnchors, loadAnchors, resolveAnchor } from "./anchors.js"
import type { AnchorReport, ResolvedAnchor } from "./anchors.js"

const SHOWN = 20

/** The corpus root a verb reads: `--cwd` against the caller's directory, else the harness's runtime root. */
export const corpusRoot = (cwd: string, flag: string | undefined): string => {
    if (flag === undefined || flag === "") return runtimeRoot()
    return isAbsolute(flag) ? flag : resolve(cwd, flag)
}

interface AnchorData {
    readonly mode: "resolve" | "check"
    readonly root: string
    readonly resolved?: ResolvedAnchor
    readonly report?: AnchorReport
}

const reportLines = (report: AnchorReport): string[] => [
    ...report.duplicates.slice(0, SHOWN).map((item) => `ANCHOR_DUPLICATE ${item.id}: ${item.places.join(", ")}`),
    ...report.dangling.slice(0, SHOWN).map((item) => `ANCHOR_DANGLING ${item.ref} (named at ${item.from}:${String(item.line)})`),
]

/**
 * `starci contexts anchor <id>`: resolves an anchor id (the first thing a search hit prints) to its text, file and line;
 * with no id it judges the corpus (its dry run): one place per id and no link or eval expectation naming nothing, exit 1 otherwise.
 */
export const contextsAnchorVerb = defineVerb({
    path: ["contexts", "anchor"],
    summary: "resolve an anchor id (tabs.choose, R12, DNA-..., <file>#<heading slug>) to its text and file; with no id, judge the anchors (exit 1 on a duplicate or dangling one)",
    editions: ["lite", "full"],
    effect: "read",
    roles: EVERYONE,
    schema: "starci/contexts-anchor@1",
    flags: {
        id: { kind: "string", positional: true, summary: "the anchor id to resolve (none: judge every anchor; exit 1 when an id names two places, or a link fragment or an eval expectation names none)" },
        cwd: { kind: "string", summary: "the tree to read instead of the harness's own (contexts/, ops/, policy/, skills/starci, docs)" },
    },
    run: (context, flags) => {
        const root = corpusRoot(context.cwd, flags.cwd)
        const table = loadAnchors(root)
        if (flags.id === undefined) {
            const report = checkAnchors(table, { file: join(root, EVAL_FILE), label: EVAL_FILE.replaceAll("\\", "/") })
            const red = report.duplicates.length + report.dangling.length
            const data: AnchorData = { mode: "check", root, report }
            const head = `${String(report.anchors)} anchors, ${String(report.ids)} ids under ${root}`
            const message = red === 0 ? `green: ${head}, each naming one place` : [`red: ${head}; ${String(report.duplicates.length)} duplicate(s), ${String(report.dangling.length)} dangling`, ...reportLines(report)].join("\n")
            return Promise.resolve({ data, message, exitCode: red === 0 ? 0 : 1 })
        }
        if (flags.id.trim() === "") throw new UsageError("contexts anchor needs an anchor id (or none, to judge every anchor)")
        const resolution = resolveAnchor(table, flags.id)
        if (resolution.kind === "unknown") {
            const hint = resolution.near.length === 0 ? "search for it with `starci contexts search`" : `near: ${resolution.near.join(", ")}`
            throw new Refusal("ANCHOR_UNKNOWN", `no anchor ${flags.id} under ${root}; ${hint}`)
        }
        if (resolution.kind === "ambiguous") throw new Refusal("ANCHOR_AMBIGUOUS", `${flags.id} names ${String(resolution.places.length)} places (${resolution.places.join(", ")}); \`contexts anchor\` with no id reports it`)
        const found = resolution.anchor
        const data: AnchorData = { mode: "resolve", root, resolved: found }
        const via = found.via === "alias" ? ` (alias of ${found.anchor})` : ""
        return Promise.resolve({ data, message: `${found.anchor}${via}  ${found.path}:${String(found.line)}\n${found.title}\n\n${found.text}` })
    },
})
