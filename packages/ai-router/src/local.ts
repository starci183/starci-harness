import { isPlainRecord } from "@starci/common"
import { classifyFailure } from "./classify.ts"
import { keysOf } from "./config.ts"
import { AiRouterError } from "./errors.ts"
import { baseUrlOf, PROVIDER_PRESETS } from "./providers.ts"
import { resolveSecret } from "./secrets.ts"
import type { ErrorClass, FetchLike, ModelConfig, ProviderConfig } from "./types.ts"

/**
 * The self-hosted models this package declares by id for a `local` provider. Sources, read 2026-11-17:
 *
 * - https://ollama.com/library/qwen3-embedding : tag `8b` (4.7 GB download), supports output sizes from 32 to 4096, 4096 at
 *   most. A server loads it with its own context (Ollama's default is 4096 tokens), so that is the window declared.
 * - https://ollama.com/library/nomic-embed-text : 274 MB, 2K context. 768 dimensions is the model card's, not the page's.
 * - https://ollama.com/library/bge-m3 : 1.2 GB, 8K context, more than 100 languages. 1024 dimensions is the model card's.
 * - https://ollama.com/library/qwen2.5 : tags `7b` (4.7 GB) and `3b` (1.9 GB), 32K context, tools.
 *
 * Sizes are the download; the loaded model takes more (a 4.7 GB Q4 model measured 6.9 GB resident with its context).
 */
export interface LocalModel {
    readonly id: string
    readonly kind: "chat" | "embedding"
    readonly label: string
    /** The window a default server loads the model with. */
    readonly contextWindow: number
    /** An embedding model's native vector length. */
    readonly dimensions?: number
    /** True when a vector cut to a smaller size is a valid embedding (Matryoshka training): `truncate: "mrl"` applies. */
    readonly mrl?: boolean
}

export const LOCAL_MODELS: readonly LocalModel[] = Object.freeze([
    { id: "qwen3-embedding:8b", kind: "embedding", label: "Qwen3 Embedding 8B", contextWindow: 4096, dimensions: 4096, mrl: true },
    { id: "nomic-embed-text", kind: "embedding", label: "Nomic Embed Text v1.5", contextWindow: 2048, dimensions: 768 },
    { id: "bge-m3", kind: "embedding", label: "BGE-M3", contextWindow: 8192, dimensions: 1024 },
    { id: "qwen2.5:7b", kind: "chat", label: "Qwen2.5 7B", contextWindow: 32_768 },
    { id: "qwen2.5:3b", kind: "chat", label: "Qwen2.5 3B", contextWindow: 32_768 },
] satisfies LocalModel[])

export interface LocalModelOptions {
    /** An embedding model's output length. A model trained for it (`mrl`) is cut to it; default its native length. */
    readonly dimensions?: number
}

/**
 * The `ModelConfig` of a local model by id, priced at 0. An embedding model with `dimensions` below its native length
 * and trained for it is cut to that length and L2-normalized (`truncate: "mrl"`); a model not in the list is a chat model
 * with the default chat capabilities.
 */
export function localModel(id: string, options: LocalModelOptions = {}): ModelConfig {
    const known = LOCAL_MODELS.find((model) => model.id === id)
    const cost = { input: 0, output: 0 }
    if (known?.kind === "embedding") {
        const native = known.dimensions ?? 0
        const cut = known.mrl === true && options.dimensions !== undefined && options.dimensions < native
        return {
            id,
            capabilities: ["embeddings"],
            contextWindow: known.contextWindow,
            cost,
            dimensions: cut ? (options.dimensions ?? native) : native,
            // An MRL model always truncates, so a call's own `dimensions` can ask for a shorter vector than the declared one.
            ...(known.mrl === true ? { truncate: "mrl" as const } : {}),
        }
    }
    return { id, cost, ...(known === undefined ? {} : { contextWindow: known.contextWindow }) }
}

/** One model a server reports. */
export interface LocalModelInfo {
    readonly id: string
    readonly sizeBytes?: number
}

/** What a reachable server reports: where it was asked and which models it holds. */
export interface LocalProbe {
    readonly baseUrl: string
    /** The endpoint that answered: the OpenAI `/v1/models`, or Ollama's own `/api/tags` when the first is absent. */
    readonly source: "/v1/models" | "/api/tags"
    readonly models: readonly LocalModelInfo[]
}

export interface LocalProbeOptions {
    /** Default: the `local` kind's, `http://localhost:11434/v1`. */
    readonly baseUrl?: string
    /** Sent as a bearer token when given; a keyless server needs none. */
    readonly apiKey?: string
    readonly fetch?: FetchLike
    /** Default 5000. */
    readonly timeoutMs?: number
}

function fail(errorClass: ErrorClass, message: string, status?: number): AiRouterError {
    return new AiRouterError({ errorClass, message, ...(status === undefined ? {} : { status }) })
}

async function get(url: string, options: LocalProbeOptions): Promise<Response> {
    const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? 5000
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs)
    try {
        return await fetchImpl(url, { method: "GET", headers: options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }, signal: controller.signal })
    } catch (error) {
        // The same classes a call's attempt gets: a server that does not answer is `network` (retryable), one that answers too late `timeout`.
        if (controller.signal.aborted) throw fail("timeout", `${url} did not answer within ${String(timeoutMs)} ms`)
        throw fail("network", `${url} is not reachable: ${error instanceof Error ? error.message : "the request failed"}`)
    } finally {
        clearTimeout(timer)
    }
}

async function failureOf(url: string, response: Response): Promise<AiRouterError> {
    let body: unknown = ""
    try {
        const text = (await response.text()).slice(0, 4096)
        body = text
        body = JSON.parse(text)
    } catch {
        // Not JSON: the status decides.
    }
    return fail(classifyFailure("local", response.status, body).errorClass, `${url} answered HTTP ${String(response.status)}`, response.status)
}

/**
 * Asks a self-hosted server which models it holds, which is also its health check: `GET /v1/models`, and when that path
 * is absent (404) Ollama's `GET /api/tags`. A server that does not answer throws an `AiRouterError` of class `network` (or
 * `timeout`), the class a call's attempt gets, so a caller retries or falls back by class; any other refusal is classified by
 * the same table as a call's (`classifyFailure`).
 */
export async function probeLocal(options: LocalProbeOptions = {}): Promise<LocalProbe> {
    const base = (options.baseUrl ?? PROVIDER_PRESETS.local.baseUrl ?? "").replace(/\/+$/, "")
    const openAi = `${base}/models`
    const first = await get(openAi, options)
    if (first.ok) {
        const json: unknown = await first.json().catch(() => undefined)
        const data = isPlainRecord(json) && Array.isArray(json.data) ? json.data : []
        return { baseUrl: base, source: "/v1/models", models: data.filter(isPlainRecord).flatMap((entry) => (typeof entry.id === "string" ? [{ id: entry.id }] : [])) }
    }
    if (first.status !== 404) throw await failureOf(openAi, first)
    await first.body?.cancel().catch(() => undefined)
    const tags = `${base.replace(/\/v1$/, "")}/api/tags`
    const second = await get(tags, options)
    if (!second.ok) throw await failureOf(tags, second)
    const json: unknown = await second.json().catch(() => undefined)
    const models = isPlainRecord(json) && Array.isArray(json.models) ? json.models : []
    return {
        baseUrl: base,
        source: "/api/tags",
        models: models.filter(isPlainRecord).flatMap((entry) => {
            const id = typeof entry.name === "string" ? entry.name : typeof entry.model === "string" ? entry.model : undefined
            return id === undefined ? [] : [{ id, ...(typeof entry.size === "number" ? { sizeBytes: entry.size } : {}) }]
        }),
    }
}

/** Probes the server a `local` provider points at, with its key when one is set. */
export async function probeLocalProvider(provider: ProviderConfig, options: Pick<LocalProbeOptions, "fetch" | "timeoutMs"> = {}): Promise<LocalProbe> {
    const secret = await resolveSecret(keysOf(provider)[0] ?? { alias: "none", resolve: () => undefined })
    return probeLocal({ baseUrl: baseUrlOf(provider), ...(secret === undefined ? {} : { apiKey: secret }), ...options })
}

/** True when the probe lists the model: by its exact id, or by its name alone for a tag-less id (`nomic-embed-text` is held as `nomic-embed-text:latest`). */
export function holdsModel(probe: LocalProbe, id: string): boolean {
    return probe.models.some((model) => model.id === id || (!id.includes(":") && model.id === `${id}:latest`))
}
