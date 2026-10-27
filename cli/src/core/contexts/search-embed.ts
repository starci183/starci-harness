import { createHash } from "node:crypto"
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runtimeRoot } from "../../harness/ledger.js"

/** One pinned local embedding model: the Hugging Face repository, its commit, the ONNX file and that file's sha256 (its LFS oid). */
export interface EmbedModel {
    readonly name: string
    readonly repo: string
    readonly revision: string
    readonly file: string
    readonly sha256: string
    readonly dtype: "q8"
    readonly pooling: "cls" | "mean"
    readonly queryPrefix: string
    readonly passagePrefix: string
}

/** The models a build may embed with; the default is the one the search eval measured best. */
export const EMBED_MODELS: readonly EmbedModel[] = [
    {
        name: "bge-small-en-v1.5",
        repo: "Xenova/bge-small-en-v1.5",
        revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
        file: "onnx/model_quantized.onnx",
        sha256: "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4",
        dtype: "q8",
        pooling: "cls",
        queryPrefix: "Represent this sentence for searching relevant passages: ",
        passagePrefix: "",
    },
    {
        name: "multilingual-e5-small",
        repo: "Xenova/multilingual-e5-small",
        revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
        file: "onnx/model_quantized.onnx",
        sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
        dtype: "q8",
        pooling: "mean",
        queryPrefix: "query: ",
        passagePrefix: "passage: ",
    },
]

/** The environment variable naming the model a build embeds with (a name of EMBED_MODELS), or `off` for a lexical-only index. */
export const EMBED_MODEL_ENV = "STARCI_SEARCH_MODEL"
/** The environment variable that moves the model cache; it defaults to `<runtime root>/.runtime/models` (git-ignored). */
export const MODEL_CACHE_ENV = "STARCI_MODEL_CACHE"
const DEFAULT_MODEL = "bge-small-en-v1.5"

/** The model a build embeds with, or undefined when the environment turns embeddings off. */
export const chosenModel = (): EmbedModel | undefined => {
    const name = process.env[EMBED_MODEL_ENV] ?? DEFAULT_MODEL
    if (name === "off") return undefined
    const model = EMBED_MODELS.find((item) => item.name === name)
    if (model === undefined) throw new Error(`${EMBED_MODEL_ENV}=${name} names no model; use one of ${EMBED_MODELS.map((item) => item.name).join(", ")} or off`)
    return model
}

/** Where model weights are cached: downloaded once at build, read offline at query time, never committed. */
export const modelCache = (): string => process.env[MODEL_CACHE_ENV] ?? join(runtimeRoot(), ".runtime", "models")

const modelDir = (model: EmbedModel): string => join(modelCache(), model.repo, model.revision)

interface Tensor {
    readonly data: Float32Array
    readonly dims: readonly number[]
}
type Extractor = (texts: string[], options: { readonly pooling: "cls" | "mean"; readonly normalize: boolean }) => Promise<Tensor>
interface Transformers {
    readonly env: { allowRemoteModels: boolean; allowLocalModels: boolean; useFSCache: boolean; cacheDir: string | null }
    readonly pipeline: (task: string, model: string, options: Readonly<Record<string, unknown>>) => Promise<Extractor>
}

/** An embedder ready to use, or the reason none is. */
export type Embedder = { readonly ok: true; readonly embed: (texts: readonly string[], kind: "query" | "passage") => Promise<Float32Array[]> } | { readonly ok: false; readonly reason: string }

const LIBRARY = "@huggingface/transformers"

const importLibrary = async (): Promise<Transformers | string> => {
    try {
        const specifier: string = LIBRARY
        return (await import(specifier)) as Transformers
    } catch {
        return `${LIBRARY} is not installed (an optional dependency of starci-harness)`
    }
}

const sha256Of = (file: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const hash = createHash("sha256")
        createReadStream(file)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", () => {
                resolve(hash.digest("hex"))
            })
            .on("error", reject)
    })

/** True when the cached ONNX file hashes to the pinned sha256; a stamp of size and mtime spares rehashing an unchanged file. */
const verified = async (model: EmbedModel): Promise<boolean> => {
    const file = join(modelDir(model), model.file)
    if (!existsSync(file)) return false
    const stat = statSync(file)
    const stamp = join(modelDir(model), ".starci-verified")
    const expected = `${String(stat.size)} ${String(stat.mtimeMs)} ${model.sha256}`
    if (existsSync(stamp) && readFileSync(stamp, "utf8") === expected) return true
    if ((await sha256Of(file)) !== model.sha256) return false
    writeFileSync(stamp, expected)
    return true
}

/**
 * Loads the model on CPU in process. With `download`, a missing model is fetched once at its pinned revision into the model
 * cache; without it nothing touches the network. Either way the ONNX file must hash to the pinned sha256 before it is used.
 */
export const loadEmbedder = async (model: EmbedModel, download: boolean): Promise<Embedder> => {
    const library = await importLibrary()
    if (typeof library === "string") return { ok: false, reason: library }
    try {
        if (download && !(await verified(model))) {
            library.env.allowRemoteModels = true
            library.env.useFSCache = true
            library.env.cacheDir = modelCache()
            await library.pipeline("feature-extraction", model.repo, { revision: model.revision, dtype: model.dtype })
        }
        if (!(await verified(model))) {
            const where = join(modelDir(model), model.file)
            return { ok: false, reason: existsSync(where) ? `${where} does not hash to the pinned sha256 ${model.sha256}` : `model ${model.name} is not in ${modelCache()} (run npm run build online once)` }
        }
        library.env.allowRemoteModels = false
        library.env.allowLocalModels = true
        library.env.useFSCache = false
        const extract = await library.pipeline("feature-extraction", modelDir(model), { dtype: model.dtype })
        const embed = async (texts: readonly string[], kind: "query" | "passage"): Promise<Float32Array[]> => {
            const prefix = kind === "query" ? model.queryPrefix : model.passagePrefix
            const tensor = await extract(
                texts.map((text) => prefix + text),
                { pooling: model.pooling, normalize: true },
            )
            const width = tensor.dims.at(-1) ?? 0
            return texts.map((_text, row) => tensor.data.slice(row * width, (row + 1) * width))
        }
        return { ok: true, embed }
    } catch (error: unknown) {
        return { ok: false, reason: `model ${model.name} could not load: ${error instanceof Error ? error.message : String(error)}` }
    }
}

/** Packs unit vectors as int8 with one float scale per vector, base64; a quarter of float32 at a negligible cosine error. */
export const packVectors = (vectors: readonly Float32Array[]): { readonly values: string; readonly scales: string } => {
    const width = vectors[0]?.length ?? 0
    const values = new Int8Array(vectors.length * width)
    const scales = new Float32Array(vectors.length)
    for (const [row, vector] of vectors.entries()) {
        const scale = Math.max(1e-12, ...Array.from(vector, Math.abs)) / 127
        scales[row] = scale
        for (let at = 0; at < width; at += 1) values[row * width + at] = Math.round((vector[at] ?? 0) / scale)
    }
    return { values: Buffer.from(values.buffer).toString("base64"), scales: Buffer.from(scales.buffer).toString("base64") }
}

/** Unpacks vectors written by packVectors, each renormalised to unit length. */
export const unpackVectors = (packed: { readonly values: string; readonly scales: string }, width: number): Float32Array[] => {
    const valueBytes = Buffer.from(packed.values, "base64")
    const scaleBytes = Buffer.from(packed.scales, "base64")
    const values = new Int8Array(valueBytes.buffer, valueBytes.byteOffset, valueBytes.byteLength)
    const scales = new Float32Array(scaleBytes.buffer.slice(scaleBytes.byteOffset, scaleBytes.byteOffset + scaleBytes.byteLength))
    return Array.from(scales, (scale, row) => {
        const vector = Float32Array.from(values.subarray(row * width, (row + 1) * width), (value) => value * scale)
        const norm = Math.hypot(...vector) || 1
        return vector.map((value) => value / norm)
    })
}
