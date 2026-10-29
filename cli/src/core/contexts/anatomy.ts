import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { judgeAnatomy } from "./anatomy-gate.js"
import type { Gap, GateVerdict } from "./anatomy-gate.js"
import { BEGIN_MARKER, END_MARKER, SLICE_EDITIONS, SLICE_SIDES, renderAnatomy, renderSlice, sliceFile, spliceAnatomy } from "./anatomy-render.js"
import { INDEX_FILE, SECTIONS_FILE, renderIndex } from "./index-render.js"
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
    /** The completeness gaps that make --check red: a slot rule code with no rule, a rule with no or only planned enforcers. */
    readonly gaps: readonly Gap[]
    /** The gaps a dated pending entry and its live owner ruling hold open. */
    readonly pending: readonly Gap[]
}

/** Overrides the knowledge folder the generator reads and writes (default `<runtime root>/contexts`): the bench points it at a fixture. */
export const CONTEXTS_DIR_ENV = "STARCI_CONTEXTS_DIR"

/** The knowledge folder: STARCI_CONTEXTS_DIR, else `<runtime root>/contexts`. */
export const knowledgeDir = (): string => {
    const dir = process.env[CONTEXTS_DIR_ENV]
    return dir === undefined || dir === "" ? join(runtimeRoot(), "contexts") : dir
}

/** The gate's lines: one per red gap, then one naming the pending gaps and their rulings. */
const gateNote = (gate: GateVerdict): string => {
    const red = gate.red.map((item) => `${item.code}: ${item.detail}`)
    const rulings = [...new Set(gate.pending.map((item) => item.pending?.ruling ?? ""))].join(", ")
    const pending = gate.pending.length === 0 ? [] : [`pending by owner ruling ${rulings}: ${gate.pending.map((item) => item.subject).join(", ")}`]
    return [...red, ...pending].map((line) => `\n${line}`).join("")
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n")

const generatedOf = (text: string): string => {
    const begin = text.indexOf(BEGIN_MARKER)
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

/** The whole-file outputs of the generator besides anatomy.md: one slice per edition and side, the contexts index, and the CLI section index where cli/README.md is beside contexts/. */
const wholeFiles = (knowledge: string): { readonly file: string; readonly text: string }[] => {
    const sections = renderSections(knowledge)
    return [
        ...SLICE_EDITIONS.flatMap((edition) => SLICE_SIDES.map((side) => ({ file: join(knowledge, "project", sliceFile(edition, side)), text: renderSlice(knowledge, edition, side) }))),
        { file: join(knowledge, INDEX_FILE), text: renderIndex(knowledge) },
        ...(sections === undefined ? [] : [{ file: join(knowledge, SECTIONS_FILE), text: sections }]),
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

/** The `--check` answer: green when anatomy.md's block (first differing at `difference`) and every whole generated file match. */
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
        return { data: data("drift"), message: `${lines.join("\n")}\nrun \`starci contexts anatomy --write\`${note}`, exitCode: 1 }
    }
    const matched = `${file} and its ${String(files.length)} generated file(s) (slices, the contexts index, the CLI section index) match the generator`
    if (gate.red.length > 0) return { data: data("gap"), message: `red: ${matched}; ${String(gate.red.length)} completeness gap(s)${note}`, exitCode: 1 }
    return { data: data("green"), message: `green: ${matched}${note}`, exitCode: 0 }
}

/**
 * `starci contexts anatomy`: renders contexts/project/anatomy.md's generated block from hfs/slots.yaml, rules.yaml and the
 * pattern front matter, its slices (`anatomy-<edition>-<side>.md`, the app root and one side, which op files read instead of
 * the whole anatomy), the contexts index (`project/index.md`, the file a Kernel reads instead of the whole tree) and the CLI
 * section index (`harness/cli-sections.md`, the sections of cli/README.md a harness task reads instead of the whole file). `--check`
 * exits 1 when any of them differs from the generator, or when a slot names a rule code no rule carries or a rule names no
 * enforcer or only planned ones (anatomy-gate.ts), unless a dated pending entry citing a live owner ruling holds that gap;
 * `--write` rewrites them; `--slice` prints one slice. Runtime only (no edition): an app tree never sees it.
 */
export const contextsAnatomyVerb = defineVerb({
    path: ["contexts", "anatomy"],
    summary: "render the project anatomy (slot tree per edition and side) from hfs/slots.yaml, its per-side slices, the contexts index and the CLI section index; --check fails on drift, --write regenerates, --slice prints one slice",
    editions: [],
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/contexts-anatomy@1",
    flags: {
        check: { kind: "boolean", summary: "exit 1 when anatomy.md, a slice, the contexts index or the CLI section index differs from what the generator writes, or a slot rule code, a rule or its enforcers leave a gap no owner ruling holds pending" },
        write: { kind: "boolean", summary: "rewrite anatomy.md's generated block, the slices, the contexts index and the CLI section index" },
        slice: { kind: "boolean", summary: "print the slice of one edition and side (the app root plus that side), as a task reads it" },
        side: { kind: "string", summary: "the side of --slice: be or fe" },
        edition: { kind: "string", summary: "the edition of --slice: lite or full" },
    },
    run: (_context, flags) => {
        if (flags.check && flags.write) throw new Refusal("FLAGS_EXCLUSIVE", "pass --check or --write, not both")
        const knowledge = knowledgeDir()
        const file = join(knowledge, "project", "anatomy.md")
        if (!existsSync(join(knowledge, "hfs", "slots.yaml"))) throw new Refusal("CONTEXTS_NOT_FOUND", `no hfs/slots.yaml under ${knowledge}`)
        if (flags.slice) {
            if (flags.check || flags.write) throw new Refusal("FLAGS_EXCLUSIVE", "--slice prints one slice; --check and --write cover every slice")
            if (flags.side === undefined || flags.edition === undefined) throw new UsageError("--slice needs --side <be|fe> and --edition <lite|full>")
            const text = renderSlice(knowledge, flags.edition, flags.side)
            return Promise.resolve({ data: { file: join(knowledge, "project", sliceFile(flags.edition, flags.side)), mode: "print", verdict: "printed", dangling: [], firstDifference: null, files: [], gaps: [], pending: [] } satisfies AnatomyData, message: text })
        }
        const { block, dangling } = renderAnatomy(knowledge)
        const gate = judgeAnatomy(knowledge)
        const note = gateNote(gate)
        const judged = { gaps: gate.red, pending: gate.pending }
        if (!flags.check && !flags.write) {
            return Promise.resolve({ data: { file, mode: "print", verdict: "printed", dangling, firstDifference: null, files: [], ...judged } satisfies AnatomyData, message: block + note })
        }
        if (!existsSync(file)) throw new Refusal("ANATOMY_NOT_FOUND", `${file} does not exist`)
        const text = lf(readFileSync(file, "utf8"))
        const whole = wholeFiles(knowledge)
        if (flags.write) {
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
