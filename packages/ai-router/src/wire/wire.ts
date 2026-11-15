import { isPlainRecord } from "@starci/common"
import { takesCacheControl, withoutCacheControl, withPartCacheControl } from "../cache.ts"
import type { SseEvent } from "../sse.ts"
import type { ModelConfig, ProviderConfig } from "../types.ts"

/** A request in the provider's own wire format: the path under its base URL and the JSON body. */
export interface WireRequest {
    readonly path: string
    readonly body: Record<string, unknown>
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
