import { isPlainRecord } from "@starci/common"
import { readUsage } from "../shapes.ts"
import type { SseEvent } from "../sse.ts"
import type { AnthropicStreamEvent, ModelConfig, ProviderConfig, Usage } from "../types.ts"
import { usageOf } from "./anthropic.ts"
import type { WireRequest } from "./wire.ts"

/**
 * The Anthropic Messages API as its own callers speak it (docs/design.md, "The native Anthropic route"): a request in
 * the Messages shape goes to an Anthropic provider untranslated, and its answer and stream events come back as they
 * are. Cache breakpoints, thinking blocks and anything the API adds later pass through; the router reads only what it
 * accounts for (usage, the first token, an error).
 */

/** What one item of a provider stream means to the router, whatever shape the caller reads it in. */
export type Streamed<T> =
    | { readonly kind: "item"; readonly item: T; /** True when the item carries content, so failover is over. */ readonly token: boolean; readonly usage: Usage | undefined }
    | { readonly kind: "error"; readonly body: unknown }
    | { readonly kind: "malformed" }
    | { readonly kind: "alive" }

/** A Messages request as the provider takes it: the lane's model, the caller's body. */
export function nativeRequest(body: Record<string, unknown>, model: ModelConfig, stream: boolean): WireRequest {
    const out: Record<string, unknown> = { ...body, model: model.id }
    if (stream) out.stream = true
    else delete out.stream
    return { path: "/messages", body: out }
}

/** The usage of a Messages answer in the router's shape, for accounting. */
export function nativeUsage(usage: unknown): Usage | undefined {
    return readUsage(usageOf(usage))
}

function defined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined))
}

/** A Messages stream, event by event as the provider sent it, each naming the lane that serves it. */
export async function* nativeItems(provider: ProviderConfig, model: ModelConfig, events: AsyncIterable<SseEvent>): AsyncGenerator<Streamed<AnthropicStreamEvent>, void, undefined> {
    // message_start carries the input and cache counts; each message_delta the cumulative counts so far.
    let usage: Record<string, unknown> = {}
    for await (const event of events) {
        let data: unknown
        try {
            data = JSON.parse(event.data)
        } catch {
            yield { kind: "malformed" }
            continue
        }
        if (!isPlainRecord(data)) continue
        const type = typeof data.type === "string" ? data.type : event.event
        if (type === "error") {
            yield { kind: "error", body: data }
            return
        }
        if (type === "message_start" && isPlainRecord(data.message) && isPlainRecord(data.message.usage)) usage = { ...data.message.usage }
        if (type === "message_delta" && isPlainRecord(data.usage)) usage = { ...usage, ...defined(data.usage) }
        const settled = type === "message_delta" || type === "message_stop"
        yield {
            kind: "item",
            item: { event: type, data: event.data, provider: provider.id, model: model.id },
            token: type === "content_block_delta",
            usage: settled ? nativeUsage(usage) : undefined,
        }
        if (type === "message_stop") return
    }
    // A stream that ends before message_stop was cut: the attempt failed.
    yield { kind: "error", body: { type: "error", error: { type: "api_error", message: "the stream ended before message_stop" } } }
}
