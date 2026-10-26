import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { BEGIN_MARKER, END_MARKER, renderAnatomy, spliceAnatomy } from "./anatomy-render.js"

interface AnatomyData {
    readonly file: string
    readonly mode: "print" | "check" | "write"
    readonly verdict: "green" | "drift" | "written" | "printed"
    readonly dangling: readonly string[]
    readonly firstDifference: number | null
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n")

const generatedOf = (text: string): string => {
    const begin = text.indexOf(BEGIN_MARKER)
    const end = text.indexOf(END_MARKER)
    return begin < 0 || end < begin ? "" : text.slice(begin, end + END_MARKER.length)
}

/** The 1-based line of the block where the file and the generator first disagree, or null when they agree. */
const firstDifference = (actual: string, expected: string): number | null => {
    if (actual === expected) return null
    const left = actual.split("\n")
    const right = expected.split("\n")
    const index = left.findIndex((line, at) => line !== right[at])
    return (index < 0 ? left.length : index) + 1
}

/**
 * `starci knowledge anatomy`: renders knowledge/project/anatomy.md's generated block from hfs/slots.yaml, rules.yaml and the
 * pattern front matter. `--check` exits 1 when the file differs from the generator; `--write` rewrites the block. Runtime only
 * (no edition): an app tree never sees it.
 */
export const knowledgeAnatomyVerb = defineVerb({
    path: ["knowledge", "anatomy"],
    summary: "render the project anatomy (slot tree per edition and side) from hfs/slots.yaml; --check fails on drift, --write regenerates",
    editions: [],
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/knowledge-anatomy@1",
    flags: {
        check: { kind: "boolean", summary: "exit 1 when knowledge/project/anatomy.md differs from what the generator writes" },
        write: { kind: "boolean", summary: "rewrite the generated block of knowledge/project/anatomy.md" },
    },
    run: (_context, flags) => {
        if (flags.check && flags.write) throw new Refusal("FLAGS_EXCLUSIVE", "pass --check or --write, not both")
        const knowledge = join(runtimeRoot(), "knowledge")
        const file = join(knowledge, "project", "anatomy.md")
        if (!existsSync(join(knowledge, "hfs", "slots.yaml"))) throw new Refusal("KNOWLEDGE_NOT_FOUND", `no knowledge/hfs/slots.yaml under ${runtimeRoot()}`)
        const { block, dangling } = renderAnatomy(knowledge)
        const note = dangling.length === 0 ? "" : `\nslot rule codes with no rule in hfs/rules.yaml: ${dangling.join(", ")}`
        if (!flags.check && !flags.write) {
            return Promise.resolve({ data: { file, mode: "print", verdict: "printed", dangling, firstDifference: null } satisfies AnatomyData, message: block + note })
        }
        if (!existsSync(file)) throw new Refusal("ANATOMY_NOT_FOUND", `${file} does not exist`)
        const text = lf(readFileSync(file, "utf8"))
        if (flags.write) {
            writeFileSync(file, spliceAnatomy(text, block, file))
            return Promise.resolve({ data: { file, mode: "write", verdict: "written", dangling, firstDifference: null } satisfies AnatomyData, message: `wrote ${file}${note}` })
        }
        spliceAnatomy(text, block, file)
        const difference = firstDifference(generatedOf(text), block)
        const data: AnatomyData = { file, mode: "check", verdict: difference === null ? "green" : "drift", dangling, firstDifference: difference }
        const message =
            difference === null
                ? `green: ${file} matches hfs/slots.yaml${note}`
                : `drift: ${file} differs from the generator at line ${String(difference)} of the generated block; run \`starci knowledge anatomy --write\`${note}`
        return Promise.resolve({ data, message, exitCode: difference === null ? 0 : 1 })
    },
})
