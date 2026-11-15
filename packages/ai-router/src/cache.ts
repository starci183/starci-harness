import { isPlainRecord } from "@starci/common"
import { presetOf } from "./providers.ts"
import type { ModelConfig, ProviderConfig, Usage } from "./types.ts"

/**
 * Prompt-cache breakpoints in the OpenAI shape (docs/design.md, "Prompt caching"). A request marks one with
 * `cache_control: { type: "ephemeral", ttl? }` on a content part, on a message (it then sits on the message's last
 * part), on a tool, or at the top level (automatic caching). A provider that caches a prefix on its own never sees a
 * marker: it would be an unknown field there.
 */

/** The most breakpoints one request may carry, the top-level one included (Anthropic's limit, read 2026-11-10). */
export const MAX_CACHE_BREAKPOINTS = 4

const MARKER = "cache_control"

/** Whether a model's provider takes `cache_control` markers: the model's own `cacheControl`, else by provider kind. */
export function takesCacheControl(provider: ProviderConfig, model: ModelConfig): boolean {
    if (model.cacheControl !== undefined) return model.cacheControl
    const kind = presetOf(provider).kind
    return kind === "anthropic" || (kind === "openrouter" && model.id.startsWith("anthropic/"))
}

/** A marker a request carries, or undefined: anything that is not an object with a `type` is no marker. */
export function markerOf(holder: Record<string, unknown>): Record<string, unknown> | undefined {
    const marker = holder[MARKER]
    return isPlainRecord(marker) && typeof marker.type === "string" ? marker : undefined
}

function without(record: Record<string, unknown>): Record<string, unknown> {
    return MARKER in record ? Object.fromEntries(Object.entries(record).filter(([field]) => field !== MARKER)) : record
}

function mapList(value: unknown, each: (item: Record<string, unknown>) => Record<string, unknown>): unknown {
    return Array.isArray(value) ? value.map((item: unknown) => (isPlainRecord(item) ? each(item) : item)) : value
}

/** An OpenAI chat request without any `cache_control`: top level, messages, content parts and tools. */
export function withoutCacheControl(body: Record<string, unknown>): Record<string, unknown> {
    const out = without(body)
    const messages = mapList(body.messages, (message) => ({ ...without(message), ...(Array.isArray(message.content) ? { content: mapList(message.content, without) } : {}) }))
    const tools = mapList(body.tools, without)
    return { ...out, ...(body.messages === undefined ? {} : { messages }), ...(body.tools === undefined ? {} : { tools }) }
}

/**
 * An OpenAI chat request in the shape an OpenAI-compatible provider that takes breakpoints documents (OpenRouter,
 * openrouter.ai/docs/guides/best-practices/prompt-caching, read 2026-11-10): markers on content parts and at the top
 * level stay; a marker on a message moves to its last part (a string content becomes one text part); a marker on a
 * tool is removed, since tools render before the system prompt and a system breakpoint covers them.
 */
export function withPartCacheControl(body: Record<string, unknown>): Record<string, unknown> {
    const messages = mapList(body.messages, (message) => {
        const marker = markerOf(message)
        if (!(MARKER in message)) return message
        const rest = without(message)
        if (marker === undefined) return rest
        const content = rest.content
        if (typeof content === "string") return content === "" ? rest : { ...rest, content: [{ type: "text", text: content, [MARKER]: marker }] }
        const parts: unknown[] = Array.isArray(content) ? content : []
        const last = parts.at(-1)
        return isPlainRecord(last) ? { ...rest, content: [...parts.slice(0, -1), { ...last, [MARKER]: marker }] } : rest
    })
    return { ...body, ...(body.messages === undefined ? {} : { messages }), ...(body.tools === undefined ? {} : { tools: mapList(body.tools, without) }) }
}

function count(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

/** The parts of a usage the cache and thinking account for; zero where the provider reported none. */
export interface TokenParts {
    /** Prompt tokens read from the cache. */
    readonly cached: number
    /** Prompt tokens written to the cache, the one-hour ones included. */
    readonly cacheWrite: number
    /** Prompt tokens written to a one-hour cache. */
    readonly cacheWrite1h: number
    /** Completion tokens spent thinking. */
    readonly reasoning: number
}

/** Reads the cache and thinking parts of a usage, bounded by the totals they are parts of. */
export function tokenParts(usage: Usage | undefined): TokenParts {
    const prompt = isPlainRecord(usage?.prompt_tokens_details) ? usage.prompt_tokens_details : {}
    const completion = isPlainRecord(usage?.completion_tokens_details) ? usage.completion_tokens_details : {}
    const total = count(usage?.prompt_tokens)
    const cached = Math.min(count(prompt.cached_tokens), total)
    const cacheWrite = Math.min(count(prompt.cache_write_tokens), total - cached)
    return {
        cached,
        cacheWrite,
        cacheWrite1h: Math.min(count(prompt.cache_write_1h_tokens), cacheWrite),
        reasoning: Math.min(count(completion.reasoning_tokens), count(usage?.completion_tokens)),
    }
}
