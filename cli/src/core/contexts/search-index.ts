import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { CHUNKER_VERSION, SEARCH_SCOPES, readCorpus } from "./search-corpus.js"
import type { Chunk, Corpus, SearchScope } from "./search-corpus.js"
import { EMBED_MODELS, chosenModel, loadEmbedder, modelCache, packVectors, unpackVectors } from "./search-embed.js"
import type { EmbedModel } from "./search-embed.js"
import { bm25, cosineRank, fuse } from "./search-rank.js"
import type { Bm25 } from "./search-rank.js"

/** The built index: cli/dist/contexts-search.json, written by `npm run build`, never committed. */
export const INDEX_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contexts-search.json")

const chunkSchema = z.object({
    anchor: z.string(),
    aliases: z.array(z.string()).readonly(),
    citable: z.boolean(),
    path: z.string(),
    line: z.number(),
    scope: z.enum(SEARCH_SCOPES),
    title: z.string(),
    text: z.string(),
})

const embeddingSchema = z.object({
    model: z.string(),
    repo: z.string(),
    revision: z.string(),
    sha256: z.string(),
    dims: z.number(),
    values: z.string(),
    scales: z.string(),
})

const indexSchema = z.object({
    schema: z.literal("starci/contexts-search-index@2"),
    corpusHash: z.string(),
    fileHashes: z.record(z.string(), z.string()),
    chunker: z.number(),
    files: z.number(),
    chunks: z.array(chunkSchema),
    embedding: embeddingSchema.nullable(),
    embeddingNote: z.string(),
})

/** The index as stored. */
export type SearchIndexFile = z.infer<typeof indexSchema>

// A passage longer than this is cut before embedding; the model reads 512 tokens at most.
const PASSAGE_CHARS = 2000
const BATCH = 16

const passageOf = (chunk: Chunk): string => `${chunk.title}\n${chunk.text}`.slice(0, PASSAGE_CHARS)

const textKey = (model: EmbedModel, text: string): string => createHash("sha256").update(`${model.name}@${model.revision}\u0000${text}`).digest("hex")

/** Embeds every chunk, reusing vectors cached by passage hash beside the model so a rebuild embeds only changed chunks. */
const embedChunks = async (model: EmbedModel, chunks: readonly Chunk[], progress: (line: string) => void): Promise<{ readonly vectors: Float32Array[] } | { readonly reason: string }> => {
    const embedder = await loadEmbedder(model, true)
    if (!embedder.ok) return { reason: embedder.reason }
    const cacheFile = join(modelCache(), `${model.name}-${model.revision}.vectors.json`)
    const cached = new Map<string, string>(existsSync(cacheFile) ? Object.entries(z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(cacheFile, "utf8")))) : [])
    const passages = chunks.map(passageOf)
    const keys = passages.map((text) => textKey(model, text))
    const missing = keys.flatMap((key, index) => (cached.has(key) ? [] : [index]))
    const starts = Array.from({ length: Math.ceil(missing.length / BATCH) }, (_, batchIndex) => batchIndex * BATCH)
    await inOrder(starts, async (start) => {
        const batch = missing.slice(start, start + BATCH)
        const vectors = await embedder.embed(
            batch.map((index) => passages[index] ?? ""),
            "passage",
        )
        for (const [at, index] of batch.entries()) cached.set(keys[index] ?? "", Buffer.from((vectors[at] ?? new Float32Array()).buffer).toString("base64"))
        if (start % (BATCH * 20) === 0) progress(`embedded ${String(Math.min(start + BATCH, missing.length))}/${String(missing.length)} changed chunk(s)`)
    })
    const kept = Object.fromEntries(keys.map((key) => [key, cached.get(key) ?? ""]))
    mkdirSync(modelCache(), { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(kept))
    return {
        vectors: keys.map((key) => {
            const bytes = Buffer.from(kept[key] ?? "", "base64")
            return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        }),
    }
}

/** Builds the index of the corpus under `root`: chunks always, vectors when the chosen local model loads (else the note says why). */
export const buildIndex = async (root: string, progress: (line: string) => void): Promise<SearchIndexFile> => {
    const corpus = readCorpus(root)
    const base = { schema: "starci/contexts-search-index@2" as const, corpusHash: corpus.hash, fileHashes: { ...corpus.fileHashes }, chunker: CHUNKER_VERSION, files: corpus.files.length, chunks: [...corpus.chunks] }
    const model = chosenModel()
    if (model === undefined) return { ...base, embedding: null, embeddingNote: "embeddings turned off (STARCI_SEARCH_MODEL=off)" }
    const embedded = await embedChunks(model, corpus.chunks, progress)
    if ("reason" in embedded) return { ...base, embedding: null, embeddingNote: embedded.reason }
    const dims = embedded.vectors[0]?.length ?? 0
    return {
        ...base,
        embedding: { model: model.name, repo: model.repo, revision: model.revision, sha256: model.sha256, dims, ...packVectors(embedded.vectors) },
        embeddingNote: `${model.name}@${model.revision.slice(0, 12)}, ${String(dims)} dims`,
    }
}

/** Writes the index file. */
export const writeIndex = (index: SearchIndexFile, file = INDEX_PATH): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(index))
}

/** The loaded index with its ranking models, built once per process. */
export interface LoadedIndex {
    readonly file: SearchIndexFile
    readonly lexical: Bm25
    readonly vectors: readonly Float32Array[] | null
}

let loaded: LoadedIndex | undefined

/** Reads the index once per process; undefined when no index was built. */
export const loadIndex = (file = INDEX_PATH): LoadedIndex | undefined => {
    if (loaded !== undefined) return loaded
    if (!existsSync(file)) return undefined
    const read = indexSchema.safeParse(JSON.parse(readFileSync(file, "utf8")))
    if (!read.success) throw new Refusal("SEARCH_INDEX_STALE", `${file} was built by another CLI version (${read.error.issues[0]?.message ?? "schema"}); run \`npm run build\` in cli/`)
    const parsed = read.data
    loaded = {
        file: parsed,
        lexical: bm25(parsed.chunks),
        vectors: parsed.embedding === null ? null : unpackVectors(parsed.embedding, parsed.embedding.dims),
    }
    return loaded
}

// A stale verdict names this many changed files and counts the rest.
const CHANGED_SHOWN = 8

/** The files whose bytes differ between the index and the corpus: changed, added (in the tree only) and removed (in the index only). */
export const changedFiles = (index: SearchIndexFile, corpus: Corpus): string[] => {
    const paths = [...new Set([...Object.keys(index.fileHashes), ...corpus.files])].sort()
    return paths.flatMap((path) => {
        const built = index.fileHashes[path]
        const now = corpus.fileHashes[path]
        if (built === now) return []
        if (built === undefined) return [`${path} (added)`]
        return now === undefined ? [`${path} (removed)`] : [`${path} (changed)`]
    })
}

/** Whether the index matches the corpus (and the chunker) it claims to cover; when stale, the files that differ. */
export const staleness = (index: SearchIndexFile, corpus: Corpus): string | undefined => {
    if (index.chunker !== CHUNKER_VERSION) return `index built by chunker ${String(index.chunker)}, this CLI chunks with ${String(CHUNKER_VERSION)}`
    if (index.corpusHash === corpus.hash) return undefined
    const changed = changedFiles(index, corpus)
    const more = changed.length > CHANGED_SHOWN ? ` and ${String(changed.length - CHANGED_SHOWN)} more` : ""
    const named = changed.length === 0 ? "the file list or order differs" : `${changed.slice(0, CHANGED_SHOWN).join(", ")}${more}`
    return `index covers corpus ${index.corpusHash.slice(0, 12)}, the tree is ${corpus.hash.slice(0, 12)}: ${named}`
}

/** One search hit. */
export interface SearchHit {
    /** The anchor to cite, first: `contexts anchor <anchor>` resolves it. */
    readonly anchor: string
    readonly aliases: readonly string[]
    readonly citable: boolean
    readonly path: string
    readonly line: number
    readonly scope: SearchScope
    readonly title: string
    readonly score: number
    readonly text: string
}

/** How a search ranked: `hybrid` (BM25 and cosine fused), or `lexical` with the reason the vectors were not used. */
export interface SearchRanking {
    readonly mode: "hybrid" | "lexical"
    readonly fallback: string | undefined
    readonly hits: readonly SearchHit[]
}

// Each ranked list contributes this many entries to the fusion.
const FUSION_DEPTH = 50

type QueryEmbedder = (query: string) => Promise<Float32Array | string>

let queryEmbedder: QueryEmbedder | undefined

/** The query embedder of the index's model, loaded offline once per process; a string is why it cannot embed. */
const embedderFor = (index: SearchIndexFile): QueryEmbedder => {
    if (queryEmbedder !== undefined) return queryEmbedder
    const pinned = index.embedding
    const model = EMBED_MODELS.find((item) => item.name === pinned?.model && item.revision === pinned.revision && item.sha256 === pinned.sha256)
    let ready: Promise<Awaited<ReturnType<typeof loadEmbedder>> | undefined> | undefined
    queryEmbedder = async (query) => {
        if (pinned === null) return index.embeddingNote
        if (model === undefined) return `the index was embedded with ${pinned.model}@${pinned.revision}, which this CLI does not pin`
        ready ??= loadEmbedder(model, false)
        const embedder = await ready
        if (embedder === undefined) return "no embedder"
        if (!embedder.ok) return embedder.reason
        return (await embedder.embed([query], "query"))[0] ?? "the model returned no vector"
    }
    return queryEmbedder
}

/** The question's vector, or why the ranking stays lexical (asked so, the index carries no vectors, the model does not load). */
const queryVector = async (index: LoadedIndex, query: string, lexicalOnly: boolean): Promise<Float32Array | string> => {
    if (lexicalOnly) return "lexical ranking asked"
    if (index.vectors === null) return index.file.embeddingNote
    return embedderFor(index.file)(query)
}

/** Ranks the index for a question: hybrid when the index carries vectors and the pinned model loads offline, else BM25. */
export const search = async (
    index: LoadedIndex,
    query: string,
    options: { readonly scopes: readonly SearchScope[]; readonly limit: number; readonly lexicalOnly: boolean },
): Promise<SearchRanking> => {
    const chunks = index.file.chunks
    const allowed = options.scopes.length === 0 ? () => true : (at: number) => options.scopes.includes(chunks[at]?.scope ?? "harness")
    const lexical = index.lexical.score(query, allowed)
    const vector = await queryVector(index, query, options.lexicalOnly)
    const vectors = index.vectors
    const ranked = typeof vector === "string" || vectors === null ? lexical : fuse([lexical, cosineRank(vector, vectors, allowed)], FUSION_DEPTH)
    const hits = ranked.slice(0, options.limit).flatMap(({ index: at, score }) => {
        const chunk = chunks[at]
        return chunk === undefined ? [] : [{ ...chunk, score: Number(score.toFixed(4)) }]
    })
    return typeof vector === "string" || vectors === null ? { mode: "lexical", fallback: typeof vector === "string" ? vector : undefined, hits } : { mode: "hybrid", fallback: undefined, hits }
}

/** Forgets the loaded index and embedder (the eval loads one per mode). */
export const resetLoaded = (): void => {
    loaded = undefined
    queryEmbedder = undefined
}
