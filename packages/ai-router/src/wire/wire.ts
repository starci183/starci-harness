import type { SseEvent } from "../sse.ts"
import type { ProviderConfig } from "../types.ts"

/** A request in the provider's own wire format: the path under its base URL and the JSON body. */
export interface WireRequest {
    readonly path: string
    readonly body: Record<string, unknown>
}

/**
 * One item a provider stream yields, already in OpenAI's shape: a chunk (a `chat.completion.chunk` record), an error the
 * provider streamed (its raw error body, classified by the router), or an event that is not JSON.
 */
export type WireEvent = { readonly kind: "chunk"; readonly chunk: Record<string, unknown> } | { readonly kind: "error"; readonly body: unknown } | { readonly kind: "malformed" }

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
    chat(body: Record<string, unknown>, model: string, stream: boolean, provider: ProviderConfig): WireRequest
    /** An embeddings request. */
    embeddings(body: Record<string, unknown>, model: string): WireRequest
    /** A unary chat answer as an OpenAI `chat.completion` record. */
    chatResponse(json: Record<string, unknown>): Record<string, unknown>
    /** A provider stream as OpenAI chunks; the router stops at the end of the iterable. */
    chunks(events: AsyncIterable<SseEvent>): AsyncGenerator<WireEvent, void, undefined>
}

/** True for a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The OpenAI chat-completions and embeddings API with a bearer key, which every OpenAI-compatible provider speaks. */
export const openAiWire: Wire = {
    secretHeaders: ["authorization"],
    headers: (secret) => ({ authorization: `Bearer ${secret}` }),
    chat: (body, model, stream) => ({ path: "/chat/completions", body: { ...body, model, ...(stream ? { stream: true } : {}) } }),
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
            if (!isRecord(json)) continue
            // OpenRouter streams an error mid-stream as a chunk with a top-level error (and finish_reason "error").
            if (json.error !== undefined && json.error !== null) {
                yield { kind: "error", body: json }
                return
            }
            if (Array.isArray(json.choices)) yield { kind: "chunk", chunk: json }
        }
    },
}
