import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { IncomingMessage, Server } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createRouter } from "../src/router.ts"
import type { AiRouter, ChatCompletionChunk } from "../src/types.ts"
import { ask } from "./helpers.ts"

interface Seen {
    readonly path: string
    readonly authorization: string
    readonly headers: IncomingMessage["headers"]
    readonly body: Record<string, unknown>
}

describe("over real HTTP (global fetch, node:http)", () => {
    const seen: Seen[] = []
    let server: Server
    let router: AiRouter
    let base = ""

    before(async () => {
        server = createServer((request, response) => {
            let raw = ""
            request.on("data", (chunk: Buffer) => {
                raw += chunk.toString("utf8")
            })
            request.on("end", () => {
                const body = JSON.parse(raw) as Record<string, unknown>
                const authorization = request.headers.authorization ?? ""
                seen.push({ path: request.url ?? "", authorization, headers: request.headers, body })
                if (authorization === "Bearer sk-limited") {
                    response.writeHead(429, { "content-type": "application/json", "retry-after": "60", "x-ratelimit-remaining-requests": "0" })
                    response.end(JSON.stringify({ error: { message: "Rate limit reached", type: "requests" } }))
                    return
                }
                if (request.url?.endsWith("/embeddings") === true) {
                    response.writeHead(200, { "content-type": "application/json" })
                    response.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: [0.5] }], model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }))
                    return
                }
                if (body.stream === true) {
                    response.writeHead(200, { "content-type": "text/event-stream", "x-ratelimit-remaining-requests": "99" })
                    const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: body.model }
                    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\r\n\r\n`)
                    response.write(": keep-alive\n\n")
                    for (const piece of ["Hel", "lo"]) response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`)
                    response.end("data: [DONE]\n\n")
                    return
                }
                response.writeHead(200, { "content-type": "application/json", "x-ratelimit-remaining-requests": "42", "x-ratelimit-reset-requests": "1s" })
                response.end(
                    JSON.stringify({
                        id: "c1",
                        object: "chat.completion",
                        created: 1,
                        model: body.model,
                        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
                        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
                    }),
                )
            })
        })
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1/`
        router = createRouter({
            providers: [
                {
                    id: "local",
                    baseUrl: base,
                    headers: { "x-team": "core", Authorization: "Bearer must-not-win" },
                    keys: [
                        { alias: "limited", resolve: () => "sk-limited" },
                        { alias: "good", resolve: () => Promise.resolve("sk-good") },
                    ],
                    models: [{ id: "gpt-local", aliases: ["local"] }, { id: "embed-local", capabilities: ["embeddings"] }],
                },
            ],
            resilience: { backoff: { baseMs: 1, maxMs: 1 } },
        })
    })

    after(() => {
        server.close()
    })

    test("chat fails over a real 429 and reads real rate-limit headers", async () => {
        const result = await router.chat(ask("hi", "local"), { headers: { "x-trace": "t1", authorization: "Bearer nope" } })
        assert.equal(result.choices[0]?.message.content, "Hello")
        assert.equal(result.routing.key, "good")
        assert.equal(result.routing.attempts, 2)
        const last = seen.at(-1)
        assert.equal(last?.path, "/v1/chat/completions")
        assert.equal(last.authorization, "Bearer sk-good")
        assert.equal(last.headers["x-team"], "core")
        assert.equal(last.headers["x-trace"], "t1")
        assert.equal(last.headers["x-request-id"], result.routing.requestId)
        assert.equal(last.body.model, "gpt-local")
        const health = await router.health()
        const [limited, good] = health.providers[0]?.keys ?? []
        assert.ok((limited?.models[0]?.cooldownUntil ?? 0) > Date.now())
        assert.equal(good?.models[0]?.remainingRequests, 42)
    })

    test("stream parses real SSE", async () => {
        const chunks: ChatCompletionChunk[] = []
        for await (const chunk of router.stream(ask("hi", "local"))) chunks.push(chunk)
        assert.equal(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join(""), "Hello")
        assert.equal(seen.at(-1)?.body.stream, true)
    })

    test("embeddings over HTTP", async () => {
        const result = await router.embeddings({ model: "embed-local", input: "x" })
        assert.deepEqual(result.data[0]?.embedding, [0.5])
    })

    test("a refused connection is a network error", async () => {
        const dead = createRouter({
            providers: [{ id: "dead", baseUrl: "http://127.0.0.1:9/v1", keys: [{ alias: "k", resolve: () => "sk" }], models: [{ id: "m" }] }],
            resilience: { backoff: { baseMs: 1, maxMs: 1 } },
        })
        await assert.rejects(dead.chat(ask("x", "m"), { policy: { maxAttempts: 2 } }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "network")
    })
})
