import { isPlainRecord } from "@starci/common"
import { takesCacheControl, withoutCacheControl, withPartCacheControl } from "../cache.ts"
import type { SseEvent } from "../sse.ts"
import type { ModelConfig, ProviderConfig } from "../types.ts"

/** A request in the provider's own wire format: the path under its base URL and the JSON body. */
export interface WireRequest {
    readonly path: string
    readonly body: Record<string, unknown>
    /** True: `path` hangs from the server root (the base URL without its `/v1`), for a server's own API beside its OpenAI one. */
    readonly native?: boolean
    /** What the adapter needs again to read this request's answer; the router hands it back untouched. */
    readonly context?: unknown
}

/**
 * One item a provider stream yields, already in OpenAI's shape: a chunk (a `chat.completion.chunk` record), an error the
 * provider streamed (its raw error body, classified by the router), an event that is not JSON, or a sign of life that
 * carries nothing for the caller (a ping, a hidden thinking delta): it restarts the attempt's idle timeout.
 */
export type WireEvent = { readonly kind: "chunk"; readonly chunk: Record<string, unknown> } | { readonly kind: "error"; readonly body: unknown } | { readonly kind: "malformed" } | { readonly kind: "alive" }

/**
 * A protocol adapter: it turns the router's OpenAI chat-completions and embeddings requests into a provider's own and
 * its answers back, so callers above the gateway speak OpenAI whatever the provider below speaks.
 */
export interface Wire {
    /** The headers that carry the secret; caller and provider headers can never set them. */
    readonly secretHeaders: readonly string[]
    /** The auth and protocol headers of one attempt. */
    headers(secret: string, provider: ProviderConfig): Record<string, string>
    /** A chat request; throws an `AttemptError` (`invalid_request`) when the request cannot be expressed. */
    chat(body: Record<string, unknown>, model: ModelConfig, stream: boolean, provider: ProviderConfig): WireRequest
    /** An embeddings request. */
    embeddings(body: Record<string, unknown>, model: string): WireRequest
    /** The request to send when the first embeddings path answers 404 (the endpoint is absent), in the server's own API; absent: no second path. */
    embeddingsFallback?(body: Record<string, unknown>, model: string): WireRequest
    /** An embeddings answer as an OpenAI `list` record; `context` is the request's. Absent: the answer already is one. */
    embeddingsResponse?(json: Record<string, unknown>, context?: unknown): Record<string, unknown>
    /** A unary chat answer as an OpenAI `chat.completion` record; `context` is the request's. */
    chatResponse(json: Record<string, unknown>, context?: unknown): Record<string, unknown>
    /** A provider stream as OpenAI chunks; the router stops at the end of the iterable. `context` is the request's. */
    chunks(events: AsyncIterable<SseEvent>, context?: unknown): AsyncGenerator<WireEvent, void, undefined>
}

/**
 * The cache breakpoints of a request as an OpenAI-compatible provider takes them: none where the provider caches a
 * prefix on its own (DeepSeek, OpenAI, Gemini, Groq and most others would meet an unknown field), on content parts and
 * at the top level where it documents them (OpenRouter for `anthropic/*`, or a model that sets `cacheControl`).
 */
function cacheShape(body: Record<string, unknown>, model: ModelConfig, provider: ProviderConfig): Record<string, unknown> {
    return takesCacheControl(provider, model) ? withPartCacheControl(body) : withoutCacheControl(body)
}

/** The OpenAI chat-completions and embeddings API with a bearer key, which every OpenAI-compatible provider speaks. */
export const openAiWire: Wire = {
    secretHeaders: ["authorization"],
    headers: (secret) => ({ authorization: `Bearer ${secret}` }),
    chat: (body, model, stream, provider) => ({ path: "/chat/completions", body: { ...cacheShape(body, model, provider), model: model.id, ...(stream ? { stream: true } : {}) } }),
    embeddings: (body, model) => ({ path: "/embeddings", body: { ...body, model } }),
    chatResponse: (json) => json,
    async *chunks(events) {
        for await (const event of events) {
            if (event.data === "[DONE]") return
            let json: unknown
            try {
                json = JSON.parse(event.data)
            } catch {
                yield { kind: "malformed" }
                continue
            }
            if (!isPlainRecord(json)) continue
            // OpenRouter streams an error mid-stream as a chunk with a top-level error (and finish_reason "error").
            if (json.error !== undefined && json.error !== null) {
                yield { kind: "error", body: json }
                return
            }
            if (Array.isArray(json.choices)) yield { kind: "chunk", chunk: json }
        }
    },
}

/**
 * A self-hosted server's wire (Ollama, vLLM, llama.cpp): the OpenAI one, with the server's own embeddings API as the
 * second path. Ollama's `POST /api/embed` takes `{ model, input }` and answers `{ model, embeddings: number[][],
 * prompt_eval_count }`; it exists on every Ollama build that has embeddings at all, and `/v1/embeddings` on newer ones.
 */
export const localWire: Wire = {
    ...openAiWire,
    embeddingsFallback: (body, model) => ({ path: "/api/embed", native: true, body: { model, input: body.input }, context: { native: true } }),
    embeddingsResponse: (json, context) => {
        if (!isPlainRecord(context) || context.native !== true || !Array.isArray(json.embeddings)) return json
        const prompt = typeof json.prompt_eval_count === "number" ? json.prompt_eval_count : 0
        return {
            object: "list",
            model: typeof json.model === "string" ? json.model : "",
            data: json.embeddings.map((embedding: unknown, index: number) => ({ object: "embedding", index, embedding })),
            usage: { prompt_tokens: prompt, total_tokens: prompt },
        }
    },
}
