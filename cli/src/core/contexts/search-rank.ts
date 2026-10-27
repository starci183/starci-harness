import type { Chunk } from "./search-corpus.js"

const STOPWORDS = new Set(
    "a an and are as at be by can do does for from has have how i in is it its my of on or the that this to was what when where which who why with without".split(" "),
)

// A doubled final consonant left by a stripped ending (`logg` of logging, `runn` of running); l, s and z stay doubled.
const DOUBLED = /([b-df-hj-km-np-rtv-y])\1$/

/** Drops the doubled consonant an -ing or -ed ending leaves behind, so `logging` and `log` meet. */
const undouble = (word: string): string => (DOUBLED.test(word) ? word.slice(0, -1) : word)

/** A light English stemmer: plural and -ing/-ed endings only, so ids and code names stay recognisable. */
const stem = (word: string): string => {
    if (/\d/.test(word) || word.length <= 3) return word
    if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`
    if (word.endsWith("sses")) return word.slice(0, -2)
    if (word.endsWith("ing") && word.length > 5) return undouble(word.slice(0, -3))
    if (word.endsWith("ed") && word.length > 4) return undouble(word.slice(0, -2))
    if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1)
    return word
}

const RAW = /[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]|[A-Za-z0-9]/g

/**
 * The terms of a text: every id-like token kept whole (`fe-ui-1`, `r321`, `be.feature.application`, `use-swr`) and also split
 * into its parts and camelCase words, lower-cased and lightly stemmed; stopwords dropped.
 */
export const tokenize = (text: string): string[] => {
    const terms: string[] = []
    for (const raw of text.match(RAW) ?? []) {
        const whole = raw.toLowerCase()
        const parts = raw
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((part) => part !== "")
        if (parts.length > 1) terms.push(whole)
        for (const part of parts) if (!STOPWORDS.has(part)) terms.push(stem(part))
    }
    return terms
}

/**
 * The words the tree writes for a phrase a question uses: ids say `FE` for the front end, a clock answers "time", a missing
 * list is an empty state, a status with no text is a glyph or dot. Each match appends the tree's words to the query.
 */
const QUERY_WORDS: readonly (readonly [RegExp, string])[] = [
    [/\bfront[ -]?end\b/i, "fe"],
    [/\b(?:time|now|today|timestamp)\b/i, "clock"],
    [/\b(?:no data|no items|no results|nothing to show)\b/i, "empty"],
    [/\b(?:no|without) (?:text|label|words)\b/i, "glyph dot icon"],
    [/\blog(?:s|ging)?\b/i, "logger"],
]

/** The query with the tree's words appended for each phrase it uses. */
export const expandQuery = (query: string): string => [query, ...QUERY_WORDS.flatMap(([phrase, words]) => (phrase.test(query) ? [words] : []))].join(" ")

/** The words of a raw query that may name an id exactly, lower-cased. */
export const idTokens = (text: string): Set<string> => new Set((text.match(RAW) ?? []).map((token) => token.toLowerCase()))

/**
 * The words a section heading stands for: a `Choose` section answers "when to use", "which" and "or" questions, so its
 * title carries those words too.
 */
const HEADING_TERMS: Readonly<Record<string, readonly string[]>> = {
    choose: ["use", "choose", "choice", "pick", "instead"],
}

/** The extra title words of a chunk, from its own heading (the last part of its title). */
const headingTerms = (chunk: Chunk): readonly string[] => {
    const own = chunk.title.split(" › ").at(-1)?.trim().toLowerCase() ?? ""
    return HEADING_TERMS[own] ?? []
}

/** The ids of a chunk a query can name word for word: its anchor and aliases that are not a `<file>#<slug>` fallback. */
const namedIds = (chunk: Chunk): string[] => [chunk.anchor, ...chunk.aliases].filter((id) => !id.includes("#"))

const K1 = 1.2
const B = 0.75
// The title (file path and headings above the chunk) counts this many times over its body.
const TITLE_WEIGHT = 3

/** A BM25 model over a set of chunks, built once per process. */
export interface Bm25 {
    readonly score: (query: string, allowed: (index: number) => boolean) => { readonly index: number; readonly score: number }[]
}

/** Builds the BM25 model of the chunks: title terms weighted over body terms, and a chunk whose id the query names exactly ranks first. */
export const bm25 = (chunks: readonly Chunk[]): Bm25 => {
    const frequencies: Map<string, number>[] = []
    const lengths: number[] = []
    const documents = new Map<string, number>()
    for (const chunk of chunks) {
        const counts = new Map<string, number>()
        const add = (term: string, weight: number): void => {
            counts.set(term, (counts.get(term) ?? 0) + weight)
        }
        for (const term of tokenize(`${chunk.title} ${namedIds(chunk).join(" ")} ${headingTerms(chunk).join(" ")}`)) add(term, TITLE_WEIGHT)
        let length = 0
        for (const term of tokenize(chunk.text)) {
            add(term, 1)
            length += 1
        }
        for (const term of counts.keys()) documents.set(term, (documents.get(term) ?? 0) + 1)
        frequencies.push(counts)
        lengths.push(length)
    }
    const average = lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, lengths.length)
    const total = chunks.length
    const idf = (term: string): number => {
        const count = documents.get(term) ?? 0
        return Math.log(1 + (total - count + 0.5) / (count + 0.5))
    }
    const ids = chunks.map((chunk) => namedIds(chunk).map((id) => id.toLowerCase()))
    return {
        score: (query, allowed) => {
            const terms = [...new Set(tokenize(expandQuery(query)))]
            const named = idTokens(query)
            const scored: { index: number; score: number }[] = []
            for (const [index, counts] of frequencies.entries()) {
                if (!allowed(index)) continue
                let score = 0
                const length = lengths[index] ?? 0
                for (const term of terms) {
                    const frequency = counts.get(term)
                    if (frequency === undefined) continue
                    score += (idf(term) * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / average))
                }
                if (score > 0) scored.push({ index, score })
            }
            const top = Math.max(0, ...scored.map((item) => item.score))
            for (const item of scored) if ((ids[item.index] ?? []).some((id) => named.has(id))) item.score += top + 1
            return scored.sort((left, right) => right.score - left.score)
        },
    }
}

/** Cosine similarity of a query vector with every allowed chunk vector (all unit length), best first. */
export const cosineRank = (query: Float32Array, vectors: readonly Float32Array[], allowed: (index: number) => boolean): { readonly index: number; readonly score: number }[] => {
    const scored: { index: number; score: number }[] = []
    for (const [index, vector] of vectors.entries()) {
        if (!allowed(index)) continue
        let dot = 0
        for (let at = 0; at < vector.length; at += 1) dot += (vector[at] ?? 0) * (query[at] ?? 0)
        scored.push({ index, score: dot })
    }
    return scored.sort((left, right) => right.score - left.score)
}

/** The reciprocal rank fusion constant: a lower value lets each list's top ranks weigh more. */
export const RRF_K = 60

/** Reciprocal rank fusion of ranked lists (each best first), over the first `depth` entries of each. */
export const fuse = (lists: readonly (readonly { readonly index: number }[])[], depth: number, k = RRF_K): { readonly index: number; readonly score: number }[] => {
    const scores = new Map<number, number>()
    for (const list of lists) for (const [rank, item] of list.slice(0, depth).entries()) scores.set(item.index, (scores.get(item.index) ?? 0) + 1 / (k + rank + 1))
    return [...scores].map(([index, score]) => ({ index, score })).sort((left, right) => right.score - left.score || left.index - right.index)
}
