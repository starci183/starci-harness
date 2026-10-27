import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import { parseSse } from "../src/sse.ts"
import type { SseEvent } from "../src/sse.ts"
import type { ChatCompletionChunk } from "../src/types.ts"
import { ask, drain, provider, record, setup, sleep } from "./helpers.ts"

function bytes(parts: readonly string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    let index = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            const part = parts[index++]
            if (part === undefined) controller.close()
            else controller.enqueue(encoder.encode(part))
        },
    })
}

async function events(parts: readonly string[]): Promise<SseEvent[]> {
    const out: SseEvent[] = []
    for await (const event of parseSse(bytes(parts))) out.push(event)
    return out
}

function text(chunks: readonly ChatCompletionChunk[]): string {
    return chunks.map((chunk) => chunk.choices.map((choice) => choice.delta.content ?? "").join("")).join("")
}

describe("parseSse", () => {
    test("parses events split anywhere, CRLF, comments, names and multi-line data", async () => {
        const out = await events(["data: one\n", "\n: a comment\r\n", "event: up", "date\r\ndata: a\r", "\ndata: b\r\n\r\n", "data", "\n\nretry: 5\nid: 1\ndata: last"])
        assert.deepEqual(out, [
            { event: "message", data: "one" },
            { event: "update", data: "a\nb" },
            { event: "message", data: "" },
            { event: "message", data: "last" },
        ])
    })

    test("a lone carriage return ends a line", async () => {
        assert.deepEqual(await events(["data: x\r\rdata: y\r\r"]), [
            { event: "message", data: "x" },
            { event: "message", data: "y" },
        ])
    })

    test("decodes a multi-byte character split across chunks", async () => {
        const encoded = new TextEncoder().encode("data: é\n\n")
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoded.slice(0, 7))
                controller.enqueue(encoded.slice(7))
                controller.close()
            },
        })
        const out: SseEvent[] = []
        for await (const event of parseSse(body)) out.push(event)
        assert.deepEqual(out, [{ event: "message", data: "é" }])
    })

    test("pulls the body only as the consumer reads, and cancels it when the consumer stops", async () => {
        let pulls = 0
        let cancelled = false
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls++
                controller.enqueue(encoder.encode(`data: ${String(pulls)}\n\n`))
            },
            cancel() {
                cancelled = true
            },
        })
        let seen = 0
        for await (const event of parseSse(body)) {
            seen++
            if (event.data === "3") break
        }
        assert.equal(seen, 3)
        assert.ok(pulls <= 5, `pulled ${String(pulls)} chunks for 3 events`)
        assert.equal(cancelled, true)
    })
})

describe("stream", () => {
    test("yields OpenAI chunks and settles with usage", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1", cost: { input: 1_000_000, output: 1_000_000 } }])])
        fake.on({}, { text: "hello brave world", usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } })
        const attempts = record(router, "attempt")
        const stream = router.stream(ask(), { requestId: "s-1" })
        assert.equal(stream.requestId, "s-1")
        const chunks: ChatCompletionChunk[] = []
        for await (const chunk of stream) chunks.push(chunk)
        assert.equal(text(chunks), "hello brave world")
        assert.equal(chunks[0]?.choices[0]?.delta.role, "assistant")
        assert.equal(fake.calls[0]?.stream, true)
        assert.equal(fake.calls[0].headers.accept, "text/event-stream")
        assert.equal(attempts[0]?.outcome, "success")
        assert.deepEqual(attempts[0].usage, { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 })
        assert.equal(attempts[0].cost, 6)
    })

    test("fails over to another key when the stream breaks before the first token", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])])
        fake.on({ key: "sk-a-k1" }, { text: "never seen", stream: { failAfter: 0 } })
        fake.on({ key: "sk-a-k2" }, { text: "from two" })
        const chunks: ChatCompletionChunk[] = []
        for await (const chunk of router.stream(ask())) chunks.push(chunk)
        assert.equal(text(chunks), "from two")
        // The first attempt's role chunk was held back, never yielded: one role chunk in the output.
        assert.equal(chunks.filter((chunk) => chunk.choices[0]?.delta.role === "assistant").length, 1)
        assert.deepEqual(fake.calls.map((call) => call.key), ["sk-a-k1", "sk-a-k2"])
    })

    test("fails over on an HTTP error and an error event before the first token", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2", "k3"], [{ id: "m1" }])])
        fake.on({ key: "sk-a-k1" }, { status: 429 })
        fake.on({ key: "sk-a-k2" }, { stream: { failAfter: 0, failWith: "error-event" } })
        const attempts = record(router, "attempt")
        const chunks: ChatCompletionChunk[] = []
        for await (const chunk of router.stream(ask())) chunks.push(chunk)
        assert.equal(text(chunks), "ok")
        assert.deepEqual(attempts.map((event) => event.errorClass), ["rate_limit", "transient", undefined])
    })

    test("surfaces a failure after the first token instead of failing over", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])])
        fake.on({}, { stream: { chunks: ["a", "b", "c"], failAfter: 2 } })
        const chunks: ChatCompletionChunk[] = []
        await assert.rejects(
            (async () => {
                for await (const chunk of router.stream(ask())) chunks.push(chunk)
            })(),
            (error: unknown) => {
                assert.ok(error instanceof AiRouterError)
                assert.equal(error.afterFirstToken, true)
                assert.equal(error.errorClass, "network")
                return true
            },
        )
        assert.equal(text(chunks), "ab")
        assert.equal(fake.calls.length, 1)
    })

    test("an idle stream after the first token times out", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1" }])])
        fake.on({}, { stream: { chunks: ["a", "b"], stallAfter: 1, stallMs: 400 } })
        await assert.rejects(
            (async () => {
                await drain(router.stream(ask(), { policy: { timeoutMs: 120 } }))
            })(),
            (error: unknown) => error instanceof AiRouterError && error.errorClass === "timeout" && error.afterFirstToken,
        )
    })

    test("a consumer that stops early releases the lane and counts a success", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1" }])])
        fake.on({}, { stream: { chunks: ["a", "b", "c", "d"] } })
        const requests = record(router, "request")
        for await (const chunk of router.stream(ask())) {
            if (chunk.choices[0]?.delta.content === "b") break
        }
        assert.equal(requests[0]?.outcome, "success")
        const health = await router.health()
        assert.equal(health.providers[0]?.inflight, 0)
        assert.equal(router.stats().succeeded, 1)
    })

    test("a stream with no token still completes", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1" }])])
        fake.on({}, { stream: { chunks: [], includeUsage: false } })
        const chunks: ChatCompletionChunk[] = []
        for await (const chunk of router.stream(ask())) chunks.push(chunk)
        assert.equal(chunks.at(-1)?.choices[0]?.finish_reason, "stop")
    })

    test("a model without streaming is no candidate for a stream", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1", aliases: ["x"], capabilities: ["chat"] }, { id: "m2", aliases: ["x"] }])])
        await drain(router.stream(ask("hi", "x")))
        assert.equal(fake.calls[0]?.model, "m2")
    })

    test("a 400 on a stream is not retried and a deadline stops it", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])])
        fake.on({ key: "sk-a-k1" }, { status: 400 })
        await assert.rejects(
            (async () => {
                await drain(router.stream(ask()))
            })(),
            (error: unknown) => error instanceof AiRouterError && error.errorClass === "invalid_request",
        )
        fake.on({}, { latencyMs: 300 })
        await assert.rejects(
            (async () => {
                await drain(router.stream(ask(), { policy: { deadlineMs: 30 } }))
            })(),
            (error: unknown) => error instanceof AiRouterError && error.errorClass === "deadline",
        )
    })

    test("non-JSON stream data fails over before the first token", async () => {
        const fake = createFakeProvider()
        let first = true
        const mixed = async (input: string, init: RequestInit): Promise<Response> => {
            if (first) {
                first = false
                return new Response(bytes(["data: {not json\n\n"]), { status: 200 })
            }
            return fake.fetch(input, init)
        }
        const { router } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])], { fetch: mixed })
        const attempts = record(router, "attempt")
        await drain(router.stream(ask()))
        assert.equal(attempts[0]?.errorClass, "stream")
    })

    test("events that are not chunks are skipped", async () => {
        const chunk = JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m1", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })
        const custom = (): Promise<Response> => Promise.resolve(new Response(bytes(["data: 42\n\n", 'data: {"ping":true}\n\n', `data: ${chunk}\n\n`, "data: [DONE]\n\n"]), { status: 200 }))
        const { router } = setup([provider("a", ["k1"], [{ id: "m1" }])], { fetch: custom })
        const chunks: ChatCompletionChunk[] = []
        for await (const item of router.stream(ask())) chunks.push(item)
        assert.equal(text(chunks), "hi")
    })

    test("a response without a body fails over", async () => {
        const fake = createFakeProvider()
        let first = true
        const empty = async (input: string, init: RequestInit): Promise<Response> => {
            if (first) {
                first = false
                return new Response(null, { status: 200 })
            }
            return fake.fetch(input, init)
        }
        const { router } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])], { fetch: empty })
        const chunks: ChatCompletionChunk[] = []
        for await (const chunk of router.stream(ask())) chunks.push(chunk)
        assert.equal(text(chunks), "ok")
    })

    test("cancelling a stream mid-way surfaces cancelled", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1" }])])
        fake.on({}, { stream: { chunks: ["a", "b", "c"], delayMs: 30 } })
        const controller = new AbortController()
        await assert.rejects(
            (async () => {
                for await (const chunk of router.stream(ask(), { signal: controller.signal })) {
                    if (chunk.choices[0]?.delta.content === "a") controller.abort()
                }
            })(),
            (error: unknown) => error instanceof AiRouterError && error.errorClass === "cancelled",
        )
        await sleep(5)
        assert.equal((await router.health()).providers[0]?.inflight, 0)
    })
})
