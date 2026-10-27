import type { FetchLike, Usage } from "./types.ts"

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
    /** `network` breaks the body; `error-event` streams an OpenAI error object. Default `network`. */
    readonly failWith?: "network" | "error-event"
    /** Ends with a chunk that carries usage. Default true. */
    readonly includeUsage?: boolean
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
    /** The bearer key value (a test value). */
    readonly key?: string
    readonly model?: string
    readonly path?: string
}

/** One request the fake received. */
export interface FakeCall {
    readonly url: string
    readonly path: string
    /** The bearer key value sent (a test value). */
    readonly key: string
    readonly model: string
    readonly stream: boolean
    readonly headers: Readonly<Record<string, string>>
    readonly body: Readonly<Record<string, unknown>>
}

/** A scriptable OpenAI-compatible provider that answers in process, for consumers' tests. */
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

interface Script {
    readonly match: FakeMatch
    readonly replies: FakeReply[]
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(signal.reason as Error)
            return
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", stop)
            resolve()
        }, ms)
        const stop = (): void => {
            clearTimeout(timer)
            reject(signal?.reason as Error)
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

function streamBody(reply: FakeReply, model: string, signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
    const options = reply.stream ?? {}
    const pieces = options.chunks ?? (reply.text ?? "ok").split(/(?<= )/)
    const encoder = new TextEncoder()
    const base = { id: "fake-stream", object: "chat.completion.chunk", created: 0, model }
    const frames: string[] = [JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })]
    pieces.forEach((piece, index) => {
        if (options.stallAfter === index) frames.push("stall")
        if (options.failAfter === index) frames.push("fail")
        frames.push(JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }))
    })
    if (options.failAfter !== undefined && options.failAfter >= pieces.length) frames.push("fail")
    frames.push(JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }))
    if (options.includeUsage !== false) {
        const usage = reply.usage ?? { prompt_tokens: 10, completion_tokens: pieces.length, total_tokens: 10 + pieces.length }
        frames.push(JSON.stringify({ ...base, choices: [], usage }))
    }
    frames.push("[DONE]")
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
            if (frame !== "fail") {
                controller.enqueue(encoder.encode(`data: ${frame}\n\n`))
                return
            }
            if (options.failWith === "error-event") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: "fake stream error", type: "server_error" } })}\n\n`))
                index = frames.length
                return
            }
            controller.error(new TypeError("terminated"))
        },
    })
}

function jsonBody(reply: FakeReply, call: FakeCall): unknown {
    if (reply.body !== undefined) return reply.body
    const status = reply.status ?? 200
    if (status >= 400) return { error: { message: `fake ${String(status)}`, type: status === 429 ? "rate_limit_exceeded" : "fake_error" } }
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
    const text = reply.text ?? "ok"
    return {
        id: `fake-${String(Date.now())}`,
        object: "chat.completion",
        created: 0,
        model: call.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: reply.usage ?? { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }
}

/** Creates a fake OpenAI-compatible provider: deterministic replies, latency, errors, 429s and streams by script. */
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
            const body = (typeof init.body === "string" ? JSON.parse(init.body) : {}) as Record<string, unknown>
            const call: FakeCall = {
                url: input,
                path: url.pathname,
                key: (headers.authorization ?? "").replace(/^Bearer /, ""),
                model: typeof body.model === "string" ? body.model : "",
                stream: body.stream === true,
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
                return new Response(streamBody(reply, call.model, init.signal), { status, headers: { "content-type": "text/event-stream", ...reply.headers } })
            }
            return new Response(JSON.stringify(jsonBody(reply, call)), { status, headers: { "content-type": "application/json", ...reply.headers } })
        },
    }
    return fake
}
