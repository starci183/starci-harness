import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { runtimeRoot } from "../../harness/ledger.js"
import { readCorpus } from "./search-corpus.js"
import type { Chunk, Corpus } from "./search-corpus.js"

/**
 * The anchor table: the one owner of resolving an anchor id to its text and file. `contexts anchor` and `contexts search`
 * read it, and so does any check that accepts a citation (an agent cites the anchor a search printed first). The syntax an
 * anchor is declared with lives in anchors-parse.ts.
 */

/** Where an id led: the chunk it names, and whether it named the chunk's anchor or one of its aliases. */
export interface ResolvedAnchor {
    readonly id: string
    /** The chunk's own anchor: what a citation of `id` should read as. */
    readonly anchor: string
    readonly via: "anchor" | "alias"
    readonly aliases: readonly string[]
    readonly citable: boolean
    readonly path: string
    readonly line: number
    readonly title: string
    readonly text: string
}

/** The answer to one lookup: found, unknown (with near ids), or ambiguous (a duplicate the check reports red). */
export type Resolution =
    | { readonly kind: "found"; readonly anchor: ResolvedAnchor }
    | { readonly kind: "unknown"; readonly id: string; readonly near: readonly string[] }
    | { readonly kind: "ambiguous"; readonly id: string; readonly places: readonly string[] }

/** Every id (anchor or alias) of the corpus and the chunks it names. */
export interface AnchorTable {
    readonly corpus: Corpus
    readonly ids: ReadonlyMap<string, readonly Chunk[]>
}

/** Builds the table of a corpus: each chunk under its anchor and each alias. */
export const anchorTable = (corpus: Corpus): AnchorTable => {
    const ids = new Map<string, Chunk[]>()
    for (const chunk of corpus.chunks) {
        for (const id of [chunk.anchor, ...chunk.aliases]) {
            const named = ids.get(id) ?? []
            if (!named.includes(chunk)) named.push(chunk)
            ids.set(id, named)
        }
    }
    return { corpus, ids }
}

const tables = new Map<string, AnchorTable>()

/** The anchor table of the corpus under `root` (default the harness's runtime root), read once per process. */
export const loadAnchors = (root: string = runtimeRoot()): AnchorTable => {
    const cached = tables.get(root)
    if (cached !== undefined) return cached
    const table = anchorTable(readCorpus(root))
    tables.set(root, table)
    return table
}

const NEAR_SHOWN = 5

const near = (table: AnchorTable, id: string): string[] => {
    const wanted = id.toLowerCase()
    return [...table.ids.keys()].filter((known) => known.toLowerCase().includes(wanted) || wanted.includes(known.toLowerCase())).slice(0, NEAR_SHOWN)
}

/** Resolves one id (an anchor or an alias, case as written) to its chunk. */
export const resolveAnchor = (table: AnchorTable, id: string): Resolution => {
    const named = table.ids.get(id.trim()) ?? []
    const chunk = named[0]
    if (chunk === undefined) return { kind: "unknown", id, near: near(table, id.trim()) }
    if (named.length > 1) return { kind: "ambiguous", id, places: named.map((item) => `${item.path}:${String(item.line)}`) }
    return {
        kind: "found",
        anchor: { id, anchor: chunk.anchor, via: chunk.anchor === id.trim() ? "anchor" : "alias", aliases: chunk.aliases, citable: chunk.citable, path: chunk.path, line: chunk.line, title: chunk.title, text: chunk.text },
    }
}

/** One id named by more than one chunk. */
export interface DuplicateAnchor {
    readonly code: "ANCHOR_DUPLICATE"
    readonly id: string
    readonly places: readonly string[]
}

/** One reference that names no anchor: a link fragment, or an id the search eval expects. */
export interface DanglingAnchor {
    readonly code: "ANCHOR_DANGLING"
    readonly ref: string
    readonly from: string
    readonly line: number
}

/** The verdict of the anchors check. */
export interface AnchorReport {
    readonly anchors: number
    readonly ids: number
    readonly duplicates: readonly DuplicateAnchor[]
    readonly dangling: readonly DanglingAnchor[]
}

// GitHub resolves a line fragment (`#L12`, `#L12-L20`) in any file.
const LINE_FRAGMENT = /^L\d+(?:-L\d+)?$/

/** True when a link's fragment names something in its target: an anchor or alias of that file, or a slug GitHub renders there. */
const linkResolves = (table: AnchorTable, target: string, fragment: string): boolean => {
    if (LINE_FRAGMENT.test(fragment)) return true
    const qualified = `${target}#${fragment}`
    if (table.corpus.renderedSlugs.has(qualified) || table.ids.has(qualified)) return true
    return (table.ids.get(fragment) ?? []).some((chunk) => chunk.path === target)
}

/** The search eval's file beside the search verb's source; absent from a published package. */
export const EVAL_FILE = join("cli", "src", "core", "contexts", "search-eval.json")

const evalExpectations = z.object({ questions: z.array(z.object({ expect: z.array(z.string()) })) })

/** The expected ids of an eval file, each with its line, as references the check holds to the table. */
const evalRefs = (file: string, label: string): DanglingAnchor[] => {
    if (!existsSync(file)) return []
    const text = readFileSync(file, "utf8")
    const lines = text.split("\n")
    const ids = evalExpectations.parse(JSON.parse(text)).questions.flatMap((question) => question.expect)
    return [...new Set(ids)].map((ref) => ({ code: "ANCHOR_DANGLING" as const, ref, from: label, line: lines.findIndex((line) => line.includes(JSON.stringify(ref))) + 1 }))
}

/**
 * The anchors check: red when an id names more than one chunk (a citation of it would be ambiguous), when a Markdown link's
 * fragment into a corpus file names nothing there, or when the search eval expects an id the tree does not declare.
 */
export const checkAnchors = (table: AnchorTable, evalFile?: { readonly file: string; readonly label: string }): AnchorReport => {
    const duplicates = [...table.ids.entries()]
        .filter(([, chunks]) => chunks.length > 1)
        .map(([id, chunks]) => ({ code: "ANCHOR_DUPLICATE" as const, id, places: chunks.map((chunk) => `${chunk.path}:${String(chunk.line)}`) }))
    const files = new Set(table.corpus.files)
    const links = table.corpus.links
        .filter((link) => files.has(link.target) && !linkResolves(table, link.target, link.fragment))
        .map((link) => ({ code: "ANCHOR_DANGLING" as const, ref: `${link.target}#${link.fragment}`, from: link.from, line: link.line }))
    const expected = evalFile === undefined ? [] : evalRefs(evalFile.file, evalFile.label).filter((item) => !table.ids.has(item.ref))
    return { anchors: table.corpus.chunks.length, ids: table.ids.size, duplicates, dangling: [...links, ...expected] }
}
