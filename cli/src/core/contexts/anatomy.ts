import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { judgeAnatomy } from "./anatomy-gate.js"
import type { Gap, GateVerdict } from "./anatomy-gate.js"
import { BEGIN_PREFIX, END_MARKER, SLICE_EDITIONS, SLICE_SIDES, renderAnatomy, renderSlice, sliceFile, spliceAnatomy } from "./anatomy-render.js"
import { INDEX_FILE, renderIndex } from "./index-render.js"
import { SECTIONED_DOCS } from "./sectioned-docs.js"
import { renderSections } from "./sections-render.js"

/** One generated file and how it compares with the generator. */
interface GeneratedFile {
    readonly file: string
    readonly verdict: "green" | "drift" | "written"
    readonly firstDifference: number | null
}

interface AnatomyData {
    readonly file: string
    readonly mode: "print" | "check" | "write"
    readonly verdict: "green" | "drift" | "gap" | "written" | "printed"
    readonly dangling: readonly string[]
    readonly firstDifference: number | null
    readonly files: readonly GeneratedFile[]
    /** The completeness gaps that make the dry run red: a slot rule code with no rule, a rule with no or only planned enforcers. */
    readonly gaps: readonly Gap[]
    /** The gaps a dated pending entry and its live owner ruling hold open. */
    readonly pending: readonly Gap[]
}

/** The knowledge folder: `<runtime root>/contexts`. */
export const knowledgeDir = (): string => join(runtimeRoot(), "contexts")

/** The gate's lines: one per red gap, then one naming the pending gaps and their rulings. */
const gateNote = (gate: GateVerdict): string => {
    const red = gate.red.map((item) => `${item.code}: ${item.detail}`)
    const rulings = [...new Set(gate.pending.map((item) => item.pending?.ruling ?? ""))].join(", ")
    const pending = gate.pending.length === 0 ? [] : [`pending by owner ruling ${rulings}: ${gate.pending.map((item) => item.subject).join(", ")}`]
    return [...red, ...pending].map((line) => `\n${line}`).join("")
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n")

const generatedOf = (text: string): string => {
    const begin = text.indexOf(BEGIN_PREFIX)
    const end = text.indexOf(END_MARKER)
    return begin < 0 || end < begin ? "" : text.slice(begin, end + END_MARKER.length)
}

/** The 1-based line where the file and the generator first disagree, or null when they agree. */
const firstDifference = (actual: string, expected: string): number | null => {
    if (actual === expected) return null
    const left = actual.split("\n")
    const right = expected.split("\n")
    const index = left.findIndex((line, at) => line !== right[at])
    return (index < 0 ? left.length : index) + 1
}

/** The whole-file outputs of the generator besides anatomy.md: one slice per edition and side, the contexts index, and the section index of each SECTIONED_DOCS source the tree holds. */
const wholeFiles = (knowledge: string): { readonly file: string; readonly text: string }[] => {
    return [
        ...SLICE_EDITIONS.flatMap((edition) => SLICE_SIDES.map((side) => ({ file: join(knowledge, "project", sliceFile(edition, side)), text: renderSlice(knowledge, edition, side) }))),
        { file: join(knowledge, INDEX_FILE), text: renderIndex(knowledge) },
        ...SECTIONED_DOCS.flatMap((doc) => {
            const text = renderSections(knowledge, doc)
            return text === undefined ? [] : [{ file: join(knowledge, doc.index), text }]
        }),
    ]
}

/** Compares (or, with `write`, rewrites) one whole generated file. */
const settleWhole = (target: { readonly file: string; readonly text: string }, write: boolean): GeneratedFile => {
    if (write) {
        writeFileSync(target.file, target.text)
        return { file: target.file, verdict: "written", firstDifference: null }
    }
    const difference = existsSync(target.file) ? firstDifference(lf(readFileSync(target.file, "utf8")), target.text) : 1
    return { file: target.file, verdict: difference === null ? "green" : "drift", firstDifference: difference }
}

/** The dry run's answer: green when anatomy.md's block (first differing at `difference`) and every whole generated file match. */
const checkAnatomy = (file: string, difference: number | null, whole: ReturnType<typeof wholeFiles>, dangling: readonly string[], gate: GateVerdict): VerbResult<AnatomyData> => {
    const files = whole.map((target) => settleWhole(target, false))
    const drifted = files.filter((item) => item.verdict === "drift")
    const note = gateNote(gate)
    const data = (verdict: AnatomyData["verdict"]): AnatomyData => ({ file, mode: "check", verdict, dangling, firstDifference: difference, files, gaps: gate.red, pending: gate.pending })
    if (difference !== null || drifted.length > 0) {
        const lines = [
            ...(difference === null ? [] : [`drift: ${file} differs from the generator at line ${String(difference)} of the generated block`]),
            ...drifted.map((item) => `drift: ${item.file} differs from the generator at line ${String(item.firstDifference)}`),
        ]
        return { data: data("drift"), message: `${lines.join("\n")}\nrun \`starci contexts anatomy --execute\`${note}`, exitCode: 1 }
    }
    const matched = `${file} and its ${String(files.length)} generated file(s) (slices, the contexts index, the section indexes) match the generator`
    if (gate.red.length > 0) return { data: data("gap"), message: `red: ${matched}; ${String(gate.red.length)} completeness gap(s)${note}`, exitCode: 1 }
    return { data: data("green"), message: `green: ${matched}${note}`, exitCode: 0 }
}

/**
 * `starci contexts anatomy`: renders contexts/project/anatomy.md's generated block from hfs/slots.yaml, rules.yaml and the
 * pattern front matter, its slices (`anatomy-<edition>-<side>.md`, the app root and one side, which op files read instead of
 * the whole anatomy), the contexts index (`project/index.md`, every file of the tree, which a Kernel opens instead of the
 * whole tree) and the section indexes of SECTIONED_DOCS (index-render.ts: each large document a seat loads by its index). Its
 * dry run (the default) exits 1 when any of them differs from the generator, or when a slot names a rule code no rule carries
 * or a rule names no enforcer or only planned ones (anatomy-gate.ts), unless a dated pending entry citing a live owner ruling
 * holds that gap; `--execute` rewrites them; `--slice` prints one slice. Runtime only (no edition): an app tree never sees it.
 */
export const contextsAnatomyVerb = defineVerb({
    path: ["contexts", "anatomy"],
    summary: "judge the project anatomy (slot tree per edition and side) rendered from hfs/slots.yaml, its per-side slices, the contexts index and the section indexes against the files (drift exits 1); --execute regenerates them, --slice prints one slice",
    editions: [],
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/contexts-anatomy@1",
    flags: {
        execute: { kind: "boolean", summary: "rewrite anatomy.md's generated block, the slices, the contexts index and the section indexes (default: a dry run that exits 1 when one differs from the generator, or a slot rule code, a rule or its enforcers leave a gap no owner ruling holds pending)" },
        slice: { kind: "boolean", summary: "print the slice of one edition and side (the app root plus that side), as a task reads it" },
        side: { kind: "string", summary: "the side of --slice: be or fe" },
        edition: { kind: "string", summary: "the edition of --slice: lite or full" },
    },
    run: (_context, flags) => {
        const knowledge = knowledgeDir()
        const file = join(knowledge, "project", "anatomy.md")
        if (!existsSync(join(knowledge, "hfs", "slots.yaml"))) throw new Refusal("CONTEXTS_NOT_FOUND", `no hfs/slots.yaml under ${knowledge}`)
        if (flags.slice) {
            if (flags.execute) throw new Refusal("FLAGS_EXCLUSIVE", "--slice prints one slice; --execute writes every slice")
            if (flags.side === undefined || flags.edition === undefined) throw new UsageError("--slice needs --side <be|fe> and --edition <lite|full>")
            const text = renderSlice(knowledge, flags.edition, flags.side)
            return Promise.resolve({ data: { file: join(knowledge, "project", sliceFile(flags.edition, flags.side)), mode: "print", verdict: "printed", dangling: [], firstDifference: null, files: [], gaps: [], pending: [] } satisfies AnatomyData, message: text })
        }
        const { block, dangling } = renderAnatomy(knowledge)
        const gate = judgeAnatomy(knowledge)
        const note = gateNote(gate)
        const judged = { gaps: gate.red, pending: gate.pending }
        if (!existsSync(file)) throw new Refusal("ANATOMY_NOT_FOUND", `${file} does not exist`)
        const text = lf(readFileSync(file, "utf8"))
        const whole = wholeFiles(knowledge)
        if (flags.execute) {
            writeFileSync(file, spliceAnatomy(text, block, file))
            const files = whole.map((target) => settleWhole(target, true))
            return Promise.resolve({
                data: { file, mode: "write", verdict: "written", dangling, firstDifference: null, files, ...judged } satisfies AnatomyData,
                message: `wrote ${file} and ${String(files.length)} generated file(s): ${files.map((item) => item.file).join(", ")}${note}`,
            })
        }
        spliceAnatomy(text, block, file)
        return Promise.resolve(checkAnatomy(file, firstDifference(generatedOf(text), block), whole, dangling, gate))
    },
})
