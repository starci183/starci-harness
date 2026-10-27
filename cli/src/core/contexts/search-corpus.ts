import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { isRuleId } from "../../harness/contract.js"
import { SLICE_EDITIONS, SLICE_SIDES, sliceFile } from "./anatomy-render.js"
import { INDEX_FILE } from "./index-render.js"

/** The scopes a search can be narrowed to: a folder of contexts/, or `harness` for the harness's own documents and data. */
export const SEARCH_SCOPES = ["ui", "grammars", "vendor", "code", "hfs", "stack", "decisions", "project", "harness"] as const
/** One search scope. */
export type SearchScope = (typeof SEARCH_SCOPES)[number]

/** Bumped whenever chunking changes, so an index built by another chunker reads as stale. */
export const CHUNKER_VERSION = 1

/** One searchable piece of the corpus: a Markdown section or a yaml entry, with the id a worker cites. */
export interface Chunk {
    /** A rule or record id (a heading token or a yaml `id:` value) when `citable`, else `<path>#<anchor>`. */
    readonly id: string
    /** True when the rules-cited trace accepts `id` from the file that holds it. */
    readonly citable: boolean
    readonly path: string
    readonly line: number
    readonly scope: SearchScope
    /** The headings (or yaml keys) above the chunk and its own, joined by " › ". */
    readonly title: string
    readonly text: string
}

/** The corpus: every searched file with its content hash, the chunks and one hash over all of it. */
export interface Corpus {
    readonly hash: string
    readonly files: readonly string[]
    readonly chunks: readonly Chunk[]
}

const byCodeUnit = (left: string, right: string): number => Number(left > right) - Number(left < right)

const filesUnder = (root: string, dir: string, pattern: RegExp): string[] =>
    existsSync(join(root, dir))
        ? readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
              .filter((entry) => entry.isFile() && pattern.test(entry.name))
              .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
        : []

/** Generated files that repeat another file of the tree: the contexts index and the anatomy slices. */
const repeated = (): Set<string> =>
    new Set([`contexts/${INDEX_FILE}`, ...SLICE_EDITIONS.flatMap((edition) => SLICE_SIDES.map((side) => `contexts/project/${sliceFile(edition, side)}`))])

/** The files searched, relative to the runtime root: contexts/, the op files and ops data, policy/, the starci skill and the harness documents. */
export const corpusFiles = (root: string): string[] => {
    const skip = repeated()
    const docs = ["README.md", "CONTRIBUTING.md", "cli/README.md", "packages/README.md"].filter((file) => existsSync(join(root, file)))
    return [
        ...filesUnder(root, "contexts", /\.(md|ya?ml)$/),
        ...filesUnder(root, "ops", /\.(md|ya?ml)$/),
        ...filesUnder(root, "policy", /\.(md|ya?ml)$/),
        ...filesUnder(root, "skills/starci", /\.md$/),
        ...docs,
    ]
        .filter((file) => !skip.has(file))
        .sort(byCodeUnit)
}

/** The scope of a corpus file. */
export const scopeOf = (path: string): SearchScope => {
    const folder = /^contexts\/([^/]+)\//.exec(path)?.[1]
    const scope = SEARCH_SCOPES.find((item) => item === folder)
    return scope ?? "harness"
}

/** A GitHub-style heading anchor. */
const slug = (heading: string): string =>
    heading
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, "-")

/** The rule id a heading carries: its first token with a digit, else an upper-case id (`FE-ROUTE`) the heading opens with. */
const headingId = (heading: string): string | undefined => {
    const tokens = heading.split(/[^A-Za-z0-9._-]+/).filter(isRuleId)
    const first = tokens[0]
    return tokens.find((token) => /\d/.test(token)) ?? (first !== undefined && heading.startsWith(first) && /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(first) ? first : undefined)
}

interface Section {
    readonly heading: string
    readonly level: number
    readonly line: number
    readonly body: string[]
}

const FENCE = /^\s{0,3}(```|~~~)/
const HEADING = /^ {0,3}(#{1,6})\s+/

/** A heading's text: what follows its `#` run, without a closing `#` run and the blanks around it. */
const headingText = (rest: string): string => {
    let text = rest.trimEnd()
    while (text.endsWith("#")) text = text.slice(0, -1)
    return text.trimEnd()
}

/** Splits a Markdown file at its headings (outside code fences); the front matter and text before the first heading are a section of level 0. */
const markdownSections = (lines: readonly string[]): Section[] => {
    const start = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0
    const sections: Section[] = [{ heading: "", level: 0, line: 1, body: lines.slice(0, start).filter((line) => line !== "---") }]
    let fenced = false
    for (const [offset, line] of lines.slice(start).entries()) {
        if (FENCE.test(line)) fenced = !fenced
        const match = fenced ? null : HEADING.exec(line)
        if (match?.[1] !== undefined) sections.push({ heading: headingText(line.slice(match[0].length)), level: match[1].length, line: start + offset + 1, body: [] })
        else sections.at(-1)?.body.push(line)
    }
    return sections
}

const markdownChunks = (path: string, lines: readonly string[]): Chunk[] => {
    const scope = scopeOf(path)
    const anchors = new Map<string, number>()
    const parents: string[] = []
    const chunks: Chunk[] = []
    for (const section of markdownSections(lines)) {
        if (section.level > 0) {
            parents.length = Math.min(parents.length, section.level - 1)
            parents[section.level - 1] = section.heading
        }
        const text = section.body.join("\n").trim()
        if (section.level === 0 && text === "") continue
        const id = section.level === 0 ? undefined : headingId(section.heading)
        const base = section.level === 0 ? "top" : slug(section.heading)
        const seen = anchors.get(base) ?? 0
        anchors.set(base, seen + 1)
        const title = [path, ...parents.filter((item) => item !== "")].join(" › ")
        const anchor = seen === 0 ? base : base + "-" + String(seen)
        chunks.push({
            id: id ?? `${path}#${anchor}`,
            citable: id !== undefined,
            path,
            line: section.line,
            scope,
            title,
            text: section.level === 0 ? text : `${"#".repeat(section.level)} ${section.heading}\n${text}`.trim(),
        })
    }
    return chunks
}

const TOP_KEY = /^([A-Za-z_][\w.-]*):/
const ID_ITEM = /^(\s*)-\s+id:\s*["']?([^"'\s#]+)/
const SUB_KEY = /^ {2}([A-Za-z_][\w.@/-]*):/
// A top-level yaml block without id entries is split at its second-level keys once it is longer than this.
const SPLIT_CHARS = 2500

interface Cut {
    readonly line: number
    readonly key: string
    readonly id?: string
}

/** The second-level keys of a long top-level block, each a cut. */
const subKeyCuts = (block: readonly string[], top: { readonly line: number; readonly key: string }): Cut[] =>
    block.flatMap((line, offset) => {
        const sub = SUB_KEY.exec(line)?.[1]
        return sub === undefined ? [] : [{ line: top.line + offset, key: `${top.key}.${sub}` }]
    })

/** The lines where a yaml file is cut: each top-level key, each id entry at the shallowest id indent of its block, the sub-keys of a long block. */
const yamlCuts = (lines: readonly string[]): Cut[] => {
    const tops = lines.flatMap((line, index) => {
        const key = TOP_KEY.exec(line)?.[1]
        return key === undefined ? [] : [{ line: index, key }]
    })
    const cuts: Cut[] = []
    for (const [at, top] of tops.entries()) {
        const end = tops[at + 1]?.line ?? lines.length
        const block = lines.slice(top.line, end)
        const items = block.flatMap((line, offset) => {
            const match = ID_ITEM.exec(line)
            return match?.[1] === undefined || match[2] === undefined ? [] : [{ indent: match[1].length, line: top.line + offset, id: match[2] }]
        })
        // A one-line scalar (schema, version) stays with the chunk above it.
        if (end - top.line > 1) cuts.push({ line: top.line, key: top.key })
        if (items.length > 0) {
            const shallowest = Math.min(...items.map((item) => item.indent))
            for (const item of items.filter((entry) => entry.indent === shallowest)) cuts.push({ line: item.line, key: top.key, id: item.id })
        } else if (block.join("\n").length > SPLIT_CHARS) cuts.push(...subKeyCuts(block, top))
    }
    return cuts
}

const yamlChunks = (path: string, lines: readonly string[]): Chunk[] => {
    const scope = scopeOf(path)
    const cuts = yamlCuts(lines)
    const chunks: Chunk[] = []
    const header = lines.slice(0, cuts[0]?.line ?? lines.length).join("\n").trim()
    if (header !== "") chunks.push({ id: `${path}#top`, citable: false, path, line: 1, scope, title: path, text: header })
    for (const [at, cut] of cuts.entries()) {
        const text = lines.slice(cut.line, cuts[at + 1]?.line ?? lines.length).join("\n").trim()
        chunks.push({
            id: cut.id ?? `${path}#${cut.key}`,
            citable: cut.id !== undefined,
            path,
            line: cut.line + 1,
            scope,
            title: [path, cut.key, ...(cut.id === undefined ? [] : [cut.id])].join(" › "),
            text,
        })
    }
    return chunks
}

/** The chunks of one file of the corpus. */
export const chunksOf = (path: string, text: string): Chunk[] => {
    const lines = text.replaceAll("\r\n", "\n").split("\n")
    return path.endsWith(".md") ? markdownChunks(path, lines) : yamlChunks(path, lines)
}

/** Reads and chunks the corpus under the runtime root; the hash covers the chunker version, every path and every byte. */
export const readCorpus = (root: string): Corpus => {
    const files = corpusFiles(root)
    const hash = createHash("sha256").update(`chunker ${String(CHUNKER_VERSION)}\n`)
    const chunks: Chunk[] = []
    for (const path of files) {
        const text = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n")
        hash.update(`${path}\u0000${text}\u0000`)
        chunks.push(...chunksOf(path, text))
    }
    return { hash: hash.digest("hex"), files, chunks }
}
