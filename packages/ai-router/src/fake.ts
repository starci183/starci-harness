import type { FetchLike, ProviderKind, Usage } from "./types.ts"

/** How a scripted stream behaves. */
export interface FakeStream {
    /** The content pieces, one chunk each. Default: the reply text split at spaces. */
    readonly chunks?: readonly string[]
    /** The pause before each chunk. Default 0. */
    readonly delayMs?: number
    /** Fails after this many content chunks (0: before the first token). */
    readonly failAfter?: number
    /** Goes silent for `stallMs` after this many content chunks (an idle provider). */
    readonly stallAfter?: number
    readonly stallMs?: number
    /** `network` breaks the body; `error-event` streams the provider's error object. Default `network`. */
    readonly failWith?: "network" | "error-event"
    /** Ends with a chunk that carries usage. Default true. */
    readonly includeUsage?: boolean
}

/** One tool call a scripted reply makes; `arguments` is the JSON text, streamed in `argumentChunks` pieces when given. */
export interface FakeToolCall {
    readonly id: string
    readonly name: string
    readonly arguments: string
    readonly argumentChunks?: readonly string[]
}

/** One scripted answer. Everything is optional: the default is a 200 chat reply `ok`. */
export interface FakeReply {
    readonly status?: number
    readonly headers?: Readonly<Record<string, string>>
    /** The pause before the response headers; an abort during it rejects like `fetch`. */
    readonly latencyMs?: number
    /** `network` rejects like `fetch` does when the connection fails. */
    readonly error?: "network"
    /** The chat reply text. Default `ok`. */
    readonly text?: string
    /** Tool calls the reply makes (OpenAI `tool_calls`, Anthropic `tool_use` blocks). */
    readonly toolCalls?: readonly FakeToolCall[]
    readonly usage?: Usage
    /** The vector of every embedding. Default `[0.1, 0.2, 0.3]`. */
    readonly embedding?: readonly number[]
    /** Replaces the whole JSON body. */
    readonly body?: unknown
    readonly stream?: FakeStream
}

/** Which requests a script applies to; an absent field matches anything. */
export interface FakeMatch {
    /** The provider's base URL the request starts with. */
    readonly baseUrl?: string
    /** The key value sent as a bearer token or as `x-api-key` (a test value). */
    readonly key?: string
    readonly model?: string
    readonly path?: string
}

/** One request the fake received. */
export interface FakeCall {
    readonly url: string
    readonly path: string
    /** The key value sent (a test value), from `authorization: Bearer` or `x-api-key`. */
    readonly key: string
    readonly model: string
    readonly stream: boolean
    /** `anthropic` for a request to `/messages`, else `openai`. */
    readonly protocol: "openai" | "anthropic"
    readonly headers: Readonly<Record<string, string>>
    readonly body: Readonly<Record<string, unknown>>
}

/** A scriptable provider that answers in process, OpenAI-compatible and Anthropic Messages alike, for consumers' tests. */
export interface FakeProvider {
    /** Pass as `PoolConfig.fetch`. */
    readonly fetch: FetchLike
    /** Every request received, in order. */
    readonly calls: readonly FakeCall[]
    /** Adds a script: matching requests get the replies in order, and the last one repeats. A later script wins. */
    on(match: FakeMatch, ...replies: FakeReply[]): FakeProvider
    /** Forgets every script and call. */
    reset(): void
}

/** The failure cases every provider's fake errors cover. */
export type FakeErrorCase = "rate_limited" | "quota_exhausted" | "invalid_key" | "overloaded" | "bad_request"

/**
 * Each provider's real error answers (status, body, headers) as its docs showed them on 2026-10-31 (docs/design.md,
 * the classification table), for a spec to script with `fake.on(match, PROVIDER_ERRORS.anthropic.quota_exhausted)`.
 * Extra cases name a provider's second shape of one class (Anthropic's monthly spend cap, OpenRouter's free daily cap).
 */
export const PROVIDER_ERRORS = Object.freeze({
    openai: {
        rate_limited: { status: 429, headers: { "retry-after": "2", "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "2s" }, body: { error: { message: "Rate limit reached for requests", type: "requests", param: null, code: "rate_limit_exceeded" } } },
        quota_exhausted: { status: 429, body: { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", param: null, code: "insufficient_quota" } } },
        credit_exhausted: { status: 429, body: { error: { message: "Your credit balance is exhausted.", type: "insufficient_quota", param: null, code: "credit_balance_exhausted" } } },
        usage_limit: { status: 429, body: { error: { message: "Your organization reached its monthly usage limit.", type: "insufficient_quota", param: null, code: "organization_usage_limit_exceeded" } } },
        invalid_key: { status: 401, body: { error: { message: "Incorrect API key provided: sk-proj-****abcd.", type: "invalid_request_error", param: null, code: "invalid_api_key" } } },
        overloaded: { status: 503, headers: { "retry-after": "1" }, body: { error: { message: "The server is overloaded.", type: "server_error", param: null, code: "server_is_overloaded" } } },
        bad_request: { status: 400, body: { error: { message: "This model's maximum context length is 128000 tokens.", type: "invalid_request_error", param: "messages", code: "context_length_exceeded" } } },
    },
    anthropic: {
        rate_limited: { status: 429, headers: { "retry-after": "3", "anthropic-ratelimit-requests-remaining": "0", "anthropic-ratelimit-requests-reset": "2026-10-31T12:00:03Z" }, body: { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" }, request_id: "req_fake" } },
        quota_exhausted: { status: 402, body: { type: "error", error: { type: "billing_error", message: "Your credit balance is too low to access the Anthropic API." }, request_id: "req_fake" } },
        spend_cap: { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "You have reached your monthly spend limit.", details: { error_code: "enforced_spend_limit_reached" } }, request_id: "req_fake" } },
        usage_limit: { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." }, request_id: "req_fake" } },
        invalid_key: { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" }, request_id: "req_fake" } },
        overloaded: { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" }, request_id: "req_fake" } },
        bad_request: { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 1000001 tokens > 1000000 maximum" }, request_id: "req_fake" } },
    },
    openrouter: {
        rate_limited: { status: 429, headers: { "X-RateLimit-Limit": "20", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1961913600000" }, body: { error: { code: 429, message: "Rate limit exceeded", metadata: {} } } },
        quota_exhausted: { status: 402, body: { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/credits", metadata: { limit_source: "openrouter_credits" } } } },
        key_limit: { status: 402, body: { error: { code: 402, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } } } },
        in_flight_budget: { status: 402, headers: { "retry-after": "1" }, body: { error: { code: 402, message: "In-flight budget exceeded", metadata: { limit_source: "openrouter_in_flight_budget" } } } },
        free_daily: { status: 429, body: { error: { code: 429, message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", metadata: {} } } },
        invalid_key: { status: 401, body: { error: { code: 401, message: "User not found.", metadata: {} } } },
        overloaded: { status: 502, body: { error: { code: 502, message: "Provider returned error", metadata: { provider_name: "upstream", raw: "overloaded" } } } },
        moderation: { status: 403, body: { error: { code: 403, message: "Input was flagged by moderation", metadata: { reasons: ["harassment"] } } } },
        bad_request: { status: 400, body: { error: { code: 400, message: "Invalid request: messages is required", metadata: {} } } },
        in_body: { status: 200, body: { error: { code: 502, message: "Upstream provider failed", metadata: { error_type: "provider_error" } } } },
    },
    qwen: {
        rate_limited: { status: 429, body: { error: { code: "Throttling.RateQuota", message: "Requests rate limit exceeded, please try again later.", type: "Throttling.RateQuota" } } },
        token_rate: { status: 429, body: { error: { code: "Throttling.AllocationQuota", message: "Allocated quota exceeded, please increase your quota limit.", type: "Throttling.AllocationQuota" } } },
        quota_exhausted: { status: 400, body: { error: { code: "Arrearage", message: "Access denied, please make sure your account is in good standing.", type: "Arrearage" } } },
        free_tier: { status: 403, body: { error: { code: "AllocationQuota.FreeTierOnly", message: "The free tier of the model has been exhausted.", type: "AllocationQuota.FreeTierOnly" } } },
        invalid_key: { status: 401, body: { error: { code: "invalid_api_key", message: "Incorrect API key provided.", type: "invalid_request_error" } } },
        overloaded: { status: 500, body: { error: { code: "InternalError", message: "An internal error has occured, please try again later.", type: "InternalError" } } },
        bad_request: { status: 400, body: { error: { code: "InvalidParameter", message: "Range of input length should be [1, 30720]", type: "InvalidParameter" } } },
    },
    deepseek: {
        rate_limited: { status: 429, body: { error: { message: "Rate Limit Reached", type: "rate_limit_reached_error", param: null, code: "rate_limit_reached" } } },
        quota_exhausted: { status: 402, body: { error: { message: "Insufficient Balance", type: "unknown_error", param: null, code: "invalid_request_error" } } },
        invalid_key: { status: 401, body: { error: { message: "Authentication Fails, Your api key: ****abcd is invalid", type: "authentication_error", param: null, code: "invalid_request_error" } } },
        overloaded: { status: 503, body: { error: { message: "Server Overloaded", type: "server_error", param: null, code: "server_overloaded" } } },
        bad_request: { status: 422, body: { error: { message: "Invalid Parameters", type: "invalid_request_error", param: null, code: "invalid_request_error" } } },
    },
    gemini: {
        rate_limited: { status: 429, body: [{ error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_content_free_tier_requests, limit: 15 per minute", status: "RESOURCE_EXHAUSTED" } }] },
        quota_exhausted: { status: 429, body: { error: { code: "quota_exceeded", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 1500 per day" } } },
        prepay: { status: 402, body: { error: { code: "payment_required", message: "Your Prepay credit balance is depleted." } } },
        invalid_key: { status: 400, body: [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }] },
        leaked_key: { status: 403, body: { error: { code: "permission_denied", message: "Your API key was reported as leaked. Please use another API key." } } },
        overloaded: { status: 503, body: { error: { code: "service_unavailable", message: "The model is overloaded. Please try again later." } } },
        bad_request: { status: 400, body: { error: { code: "invalid_request", message: "Request contains an invalid argument." } } },
    },
    groq: {
        rate_limited: { status: 429, headers: { "retry-after": "2", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "7.66s" }, body: { error: { message: "Rate limit reached for model on tokens per minute (TPM)", type: "tokens", code: "rate_limit_exceeded" } } },
        quota_exhausted: { status: 429, headers: { "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "2m59.56s" }, body: { error: { message: "Rate limit reached for model on requests per day (RPD)", type: "requests", code: "rate_limit_exceeded" } } },
        invalid_key: { status: 401, body: { error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } } },
        overloaded: { status: 498, body: { error: { message: "Flex tier capacity exceeded", type: "capacity_exceeded" } } },
        bad_request: { status: 400, body: { error: { message: "'messages.0.name' : property 'name' is unsupported", type: "invalid_request_error" } } },
    },
    "openai-compatible": {
        rate_limited: { status: 429, body: { error: { message: "too many requests", type: "rate_limit_error" } } },
        quota_exhausted: { status: 402, body: { error: { message: "payment required", type: "payment_required" } } },
        invalid_key: { status: 401, body: { error: { message: "invalid api key", type: "authentication_error" } } },
        overloaded: { status: 503, body: { error: { message: "no backend available", type: "server_error" } } },
        bad_request: { status: 400, body: { error: { message: "bad request", type: "invalid_request_error" } } },
    },
} satisfies Readonly<Record<ProviderKind, Readonly<Record<FakeErrorCase, FakeReply> & Record<string, FakeReply>>>>)

interface Script {
    readonly match: FakeMatch
    readonly replies: FakeReply[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        const aborted = (): Error => (signal?.reason instanceof Error ? signal.reason : new Error("aborted"))
        if (signal?.aborted === true) {
            reject(aborted())
            return
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", stop)
            resolve()
        }, ms)
        const stop = (): void => {
            clearTimeout(timer)
            reject(aborted())
        }
        signal?.addEventListener("abort", stop, { once: true })
    })
}

function matches(match: FakeMatch, call: FakeCall): boolean {
    return (
        (match.baseUrl === undefined || call.url.startsWith(match.baseUrl)) &&
        (match.key === undefined || match.key === call.key) &&
        (match.model === undefined || match.model === call.model) &&
        (match.path === undefined || call.path.endsWith(match.path))
    )
}

function headerRecord(init: RequestInit): Record<string, string> {
    const out: Record<string, string> = {}
    new Headers(init.headers).forEach((value, name) => {
        out[name] = value
    })
    return out
}

/** One frame of a scripted stream: an SSE event to send, a stall, or the scripted failure. */
type Frame = { readonly event?: string; readonly data: string } | "stall" | "fail"

function openAiFrames(reply: FakeReply, model: string, pieces: readonly string[]): Frame[] {
    const options = reply.stream ?? {}
    const base = { id: "fake-stream", object: "chat.completion.chunk", created: 0, model }
    const frame = (delta: Record<string, unknown>, finish: string | null = null): Frame => ({ data: JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] }) })
    const frames: Frame[] = [frame({ role: "assistant" })]
    pieces.forEach((piece, index) => {
        if (options.stallAfter === index) frames.push("stall")
        if (options.failAfter === index) frames.push("fail")
        frames.push(frame({ content: piece }))
    })
    if (options.failAfter !== undefined && options.failAfter >= pieces.length) frames.push("fail")
    ;(reply.toolCalls ?? []).forEach((call, index) => {
        frames.push(frame({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.name, arguments: "" } }] }))
        for (const part of call.argumentChunks ?? [call.arguments]) frames.push(frame({ tool_calls: [{ index, function: { arguments: part } }] }))
    })
    frames.push(frame({}, reply.toolCalls === undefined ? "stop" : "tool_calls"))
    if (options.includeUsage !== false) {
        const usage = reply.usage ?? { prompt_tokens: 10, completion_tokens: pieces.length, total_tokens: 10 + pieces.length }
        frames.push({ data: JSON.stringify({ ...base, choices: [], usage }) })
    }
    frames.push({ data: "[DONE]" })
    return frames
}

function anthropicFrames(reply: FakeReply, model: string, pieces: readonly string[]): Frame[] {
    const options = reply.stream ?? {}
    const event = (name: string, data: Record<string, unknown>): Frame => ({ event: name, data: JSON.stringify({ type: name, ...data }) })
    const input = reply.usage?.prompt_tokens ?? 10
    const frames: Frame[] = [event("message_start", { message: { id: "msg_fake", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: input, output_tokens: 1 } } }), event("ping", {})]
    let block = 0
    if (pieces.length > 0) {
        frames.push(event("content_block_start", { index: block, content_block: { type: "text", text: "" } }))
        pieces.forEach((piece, index) => {
            if (options.stallAfter === index) frames.push("stall")
            if (options.failAfter === index) frames.push("fail")
            frames.push(event("content_block_delta", { index: block, delta: { type: "text_delta", text: piece } }))
        })
        frames.push(event("content_block_stop", { index: block }))
        block++
    }
    if (options.failAfter !== undefined && options.failAfter >= pieces.length) frames.push("fail")
    for (const call of reply.toolCalls ?? []) {
        frames.push(event("content_block_start", { index: block, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } }))
        for (const part of call.argumentChunks ?? [call.arguments]) frames.push(event("content_block_delta", { index: block, delta: { type: "input_json_delta", partial_json: part } }))
        frames.push(event("content_block_stop", { index: block }))
        block++
    }
    const output = reply.usage?.completion_tokens ?? pieces.length
    frames.push(event("message_delta", { delta: { stop_reason: reply.toolCalls === undefined ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: output } }))
    frames.push(event("message_stop", {}))
    return frames
}

function streamBody(reply: FakeReply, call: FakeCall, signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
    const options = reply.stream ?? {}
    const pieces = options.chunks ?? (reply.toolCalls !== undefined && reply.text === undefined ? [] : (reply.text ?? "ok").split(/(?<= )/))
    const frames = call.protocol === "anthropic" ? anthropicFrames(reply, call.model, pieces) : openAiFrames(reply, call.model, pieces)
    const failure =
        call.protocol === "anthropic"
            ? `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`
            : `data: ${JSON.stringify({ error: { message: "fake stream error", type: "server_error" } })}\n\n`
    const encoder = new TextEncoder()
    let index = 0
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            let frame = frames[index++]
            try {
                if (frame === "stall") {
                    await wait(options.stallMs ?? 1000, signal)
                    frame = frames[index++]
                }
                if (options.delayMs !== undefined && options.delayMs > 0) await wait(options.delayMs, signal)
            } catch (error) {
                controller.error(error)
                return
            }
            if (frame === undefined) {
                controller.close()
                return
            }
            if (frame !== "fail" && frame !== "stall") {
                controller.enqueue(encoder.encode(`${frame.event === undefined ? "" : `event: ${frame.event}\n`}data: ${frame.data}\n\n`))
                return
            }
            if (options.failWith === "error-event") {
                controller.enqueue(encoder.encode(failure))
                index = frames.length
                return
            }
            controller.error(new TypeError("terminated"))
        },
    })
}

function errorBody(status: number, protocol: FakeCall["protocol"]): unknown {
    const type = status === 429 ? "rate_limit_exceeded" : "fake_error"
    if (protocol === "anthropic") return { type: "error", error: { type: status === 429 ? "rate_limit_error" : type, message: `fake ${String(status)}` } }
    return { error: { message: `fake ${String(status)}`, type } }
}

function toolUseBlock(tool: FakeToolCall): Record<string, unknown> {
    const input: unknown = JSON.parse(tool.arguments)
    return { type: "tool_use", id: tool.id, name: tool.name, input }
}

function jsonBody(reply: FakeReply, call: FakeCall): unknown {
    if (reply.body !== undefined) return reply.body
    const status = reply.status ?? 200
    if (status >= 400) return errorBody(status, call.protocol)
    if (call.path.endsWith("/embeddings")) {
        const input = call.body.input
        const count = Array.isArray(input) ? input.length : 1
        return {
            object: "list",
            data: Array.from({ length: count }, (_, index) => ({ object: "embedding", index, embedding: reply.embedding ?? [0.1, 0.2, 0.3] })),
            model: call.model,
            usage: reply.usage ?? { prompt_tokens: 4 * count, total_tokens: 4 * count },
        }
    }
    const text = reply.text ?? (reply.toolCalls === undefined ? "ok" : "")
    const usage = reply.usage ?? { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
    if (call.protocol === "anthropic") {
        const content = [
            ...(text === "" ? [] : [{ type: "text", text }]),
            ...(reply.toolCalls ?? []).map(toolUseBlock),
        ]
        return {
            id: "msg_fake",
            type: "message",
            role: "assistant",
            model: call.model,
            content,
            stop_reason: reply.toolCalls === undefined ? "end_turn" : "tool_use",
            stop_sequence: null,
            usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens ?? 0 },
        }
    }
    const calls = (reply.toolCalls ?? []).map((tool) => ({ id: tool.id, type: "function", function: { name: tool.name, arguments: tool.arguments } }))
    return {
        id: `fake-${String(Date.now())}`,
        object: "chat.completion",
        created: 0,
        model: call.model,
        choices: [{ index: 0, message: { role: "assistant", content: text === "" && calls.length > 0 ? null : text, ...(calls.length > 0 ? { tool_calls: calls } : {}) }, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }],
        usage,
    }
}

/** Creates a fake provider: deterministic replies, latency, errors, 429s and streams by script, in either protocol. */
export function createFakeProvider(): FakeProvider {
    let scripts: Script[] = []
    const calls: FakeCall[] = []
    const fake: FakeProvider = {
        calls,
        on(match, ...replies) {
            scripts.unshift({ match, replies: replies.length === 0 ? [{}] : [...replies] })
            return fake
        },
        reset() {
            scripts = []
            calls.length = 0
        },
        async fetch(input, init) {
            const url = new URL(input)
            const headers = headerRecord(init)
            const parsed: unknown = typeof init.body === "string" ? JSON.parse(init.body) : {}
            const body = isRecord(parsed) ? parsed : {}
            const call: FakeCall = {
                url: input,
                path: url.pathname,
                key: headers["x-api-key"] ?? (headers.authorization ?? "").replace(/^Bearer /, ""),
                model: typeof body.model === "string" ? body.model : "",
                stream: body.stream === true,
                protocol: url.pathname.endsWith("/messages") ? "anthropic" : "openai",
                headers,
                body,
            }
            calls.push(call)
            const script = scripts.find((candidate) => matches(candidate.match, call))
            const reply: FakeReply = (script === undefined ? undefined : script.replies.length > 1 ? script.replies.shift() : script.replies[0]) ?? {}
            if (reply.latencyMs !== undefined && reply.latencyMs > 0) await wait(reply.latencyMs, init.signal)
            if (reply.error === "network") throw new TypeError("fetch failed")
            const status = reply.status ?? 200
            if (call.stream && status < 400 && reply.body === undefined) {
                return new Response(streamBody(reply, call, init.signal), { status, headers: { "content-type": "text/event-stream", ...reply.headers } })
            }
            return new Response(JSON.stringify(jsonBody(reply, call)), { status, headers: { "content-type": "application/json", ...reply.headers } })
        },
    }
    return fake
}
