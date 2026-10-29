import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { ruleIdsIn } from "../../harness/contract.js"
import { SLICE_EDITIONS, SLICE_SIDES, sliceFile } from "./anatomy-render.js"
import { choiceIds, headingAnchors, isAnchorId, linkFragments, parseHeading, slug } from "./anchors-parse.js"
import type { LinkFragment } from "./anchors-parse.js"
import { INDEX_FILE } from "./index-render.js"

/** The scopes a search can be narrowed to: a folder of contexts/, or `harness` for the harness's own documents and data. */
export const SEARCH_SCOPES = ["ui", "grammars", "vendor", "code", "hfs", "stack", "decisions", "project", "harness"] as const
/** One search scope. */
export type SearchScope = (typeof SEARCH_SCOPES)[number]

/** Bumped whenever chunking changes, so an index built by another chunker reads as stale. */
export const CHUNKER_VERSION = 4

/** One searchable piece of the corpus: a Markdown section or a yaml entry, named by the anchor a worker cites. */
export interface Chunk {
    /**
     * The stable anchor id: an explicit anchor (`tabs.choose`), a rule or decision id (`R12`, `DNA-CORE-LABEL-OUTSIDE`,
     * `two-grammars`), else the fallback `<path>#<heading slug or yaml key>`. Unique over the corpus (`contexts anchor --check`).
     */
    readonly anchor: string
    /** The other forms the chunk resolves by: the fallback beside an explicit or rule id, a rule id beside an explicit anchor. */
    readonly aliases: readonly string[]
    /** True when the rules-cited trace accepts `anchor` from the file that holds it. */
    readonly citable: boolean
    readonly path: string
    readonly line: number
    readonly scope: SearchScope
    /** The headings (or yaml keys) above the chunk and its own, joined by " › ". */
    readonly title: string
    readonly text: string
}

/** A link fragment of one corpus file. */
export interface CorpusLink extends LinkFragment {
    readonly from: string
}

/** The corpus: every searched file with its content hash, the chunks, the link fragments and one hash over all of it. */
export interface Corpus {
    readonly hash: string
    readonly files: readonly string[]
    /** Each file's sha256, so a stale index names the files that changed. */
    readonly fileHashes: Readonly<Record<string, string>>
    readonly chunks: readonly Chunk[]
    /** Every Markdown link with a fragment into a corpus file, for the dangling-anchor check. */
    readonly links: readonly CorpusLink[]
    /** Every heading slug GitHub would render, `<path>#<slug>`, so a link GitHub resolves is never called dangling. */
    readonly renderedSlugs: ReadonlySet<string>
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

interface Section {
    /** The heading as written. */
    readonly raw: string
    /** The heading without its explicit anchor. */
    readonly heading: string
    readonly explicit: string | undefined
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
    const sections: Section[] = [{ raw: "", heading: "", explicit: undefined, level: 0, line: 1, body: lines.slice(0, start).filter((line) => line !== "---") }]
    let fenced = false
    for (const [offset, line] of lines.slice(start).entries()) {
        if (FENCE.test(line)) fenced = !fenced
        const match = fenced ? null : HEADING.exec(line)
        if (match?.[1] === undefined) {
            sections.at(-1)?.body.push(line)
            continue
        }
        const raw = headingText(line.slice(match[0].length))
        const parsed = parseHeading(raw, lines[start + offset - 1] ?? "")
        sections.push({ raw, heading: parsed.text, explicit: parsed.explicit, level: match[1].length, line: start + offset + 1, body: [] })
    }
    return sections
}

/** A counter of the slugs a file has used: the first use keeps a slug, the n-th repeat gets `-n`, as GitHub numbers them. */
const slugCounter = (): ((base: string) => string) => {
    const seen = new Map<string, number>()
    return (base) => {
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        return count === 0 ? base : base + "-" + String(count)
    }
}

/** The GitHub slugs of a Markdown file's headings as written (an explicit `{#id}` included), each deduplicated as GitHub does. */
const renderedSlugsOf = (path: string, sections: readonly Section[]): string[] => {
    const numbered = slugCounter()
    return sections.filter((section) => section.level > 0).map((section) => `${path}#${numbered(slug(section.raw))}`)
}

/** The chunk of the text before a file's first heading (its front matter included), named `<path>#top`. */
const topChunk = (path: string, text: string, anchor: string): Chunk => ({ anchor, aliases: [], citable: false, path, line: 1, scope: scopeOf(path), title: path, text })

/** The chunk of one heading's section: its anchor and the Choice ids its body declares, under the headings above it. */
const headingChunk = (path: string, section: Section, text: string, fallback: string, parents: readonly string[]): Chunk => {
    const named = headingAnchors(path, { text: section.heading, explicit: section.explicit }, fallback)
    return {
        anchor: named.anchor,
        aliases: [...new Set([...named.aliases, ...choiceIds(text)])],
        citable: ruleIdsIn(`# ${section.raw}`).has(named.anchor),
        path,
        line: section.line,
        scope: scopeOf(path),
        title: [path, ...parents.filter((item) => item !== "")].join(" › "),
        text: `${"#".repeat(section.level)} ${section.heading}\n${text}`.trim(),
    }
}

const markdownChunks = (path: string, sections: readonly Section[]): Chunk[] => {
    const numbered = slugCounter()
    const parents: string[] = []
    const chunks: Chunk[] = []
    for (const section of sections) {
        const text = section.body.join("\n").trim()
        if (section.level === 0) {
            if (text !== "") chunks.push(topChunk(path, text, `${path}#${numbered("top")}`))
            continue
        }
        parents.length = Math.min(parents.length, section.level - 1)
        parents[section.level - 1] = section.heading
        chunks.push(headingChunk(path, section, text, numbered(slug(section.heading)), parents))
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

/** A yaml cut's anchor: a rule or decision id stands alone (isAnchorId); a record key (`button-group`) or a key is qualified by the file. */
const yamlAnchors = (path: string, cut: Cut): { readonly anchor: string; readonly aliases: readonly string[]; readonly citable: boolean } => {
    if (cut.id === undefined) return { anchor: `${path}#${cut.key}`, aliases: [], citable: false }
    const qualified = `${path}#${cut.key}.${cut.id}`
    return isAnchorId(cut.id, scopeOf(path) === "decisions") ? { anchor: cut.id, aliases: [qualified], citable: true } : { anchor: qualified, aliases: [], citable: false }
}

const COMMENT = /^(\s*)#/

/**
 * The first line of a cut's text: the comment block written directly above its key line, at the key's indent, documents
 * that key and belongs to its chunk, not to the one above. The file's leading comment block stays its header.
 */
const yamlStart = (lines: readonly string[], cut: Cut): number => {
    const indent = /^\s*/.exec(lines[cut.line] ?? "")?.[0].length ?? 0
    let start = cut.line
    while (start > 0 && COMMENT.exec(lines[start - 1] ?? "")?.[1]?.length === indent) start -= 1
    return start === 0 ? cut.line : start
}

const yamlChunks = (path: string, lines: readonly string[]): Chunk[] => {
    const scope = scopeOf(path)
    const cuts = yamlCuts(lines)
    const starts = cuts.map((cut) => yamlStart(lines, cut))
    const chunks: Chunk[] = []
    const header = lines.slice(0, starts[0] ?? lines.length).join("\n").trim()
    if (header !== "") chunks.push(topChunk(path, header, `${path}#top`))
    for (const [at, cut] of cuts.entries()) {
        const text = lines.slice(starts[at], starts[at + 1] ?? lines.length).join("\n").trim()
        chunks.push({
            ...yamlAnchors(path, cut),
            path,
            line: cut.line + 1,
            scope,
            title: [path, cut.key, ...(cut.id === undefined ? [] : [cut.id])].join(" › "),
            text,
        })
    }
    return chunks
}

/** One file read: its chunks, its link fragments and the slugs GitHub renders for it. */
interface FileRead {
    readonly chunks: Chunk[]
    readonly links: CorpusLink[]
    readonly slugs: string[]
}

const readFile = (path: string, text: string): FileRead => {
    const lines = text.replaceAll("\r\n", "\n").split("\n")
    if (!path.endsWith(".md")) return { chunks: yamlChunks(path, lines), links: [], slugs: [] }
    const sections = markdownSections(lines)
    return { chunks: markdownChunks(path, sections), links: linkFragments(path, lines).map((link) => ({ ...link, from: path })), slugs: renderedSlugsOf(path, sections) }
}

/** The chunks of one file of the corpus. */
export const chunksOf = (path: string, text: string): Chunk[] => readFile(path, text).chunks

/** Reads and chunks the corpus under `root`; the hash covers the chunker version, every path and every byte. */
export const readCorpus = (root: string): Corpus => {
    const files = corpusFiles(root)
    const hash = createHash("sha256").update(`chunker ${String(CHUNKER_VERSION)}\n`)
    const fileHashes: Record<string, string> = {}
    const chunks: Chunk[] = []
    const links: CorpusLink[] = []
    const renderedSlugs = new Set<string>()
    for (const path of files) {
        const text = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n")
        hash.update(`${path}\u0000${text}\u0000`)
        fileHashes[path] = createHash("sha256").update(text).digest("hex")
        const read = readFile(path, text)
        chunks.push(...read.chunks)
        links.push(...read.links)
        for (const item of read.slugs) renderedSlugs.add(item)
    }
    return { hash: hash.digest("hex"), files, fileHashes, chunks, links, renderedSlugs }
}
