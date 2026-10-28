import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, describe, test } from "node:test"
import { createFakeProvider } from "../src/fake.ts"
import { createGateway } from "../src/gateway/gateway.ts"
import { MemoryKeyStore } from "../src/gateway/keys.ts"
import { createRouter } from "../src/router.ts"
import { ADMIN_TOKEN, chatBody, errorOf, events, gatewayPool, harness, http, UPSTREAM_SECRET } from "./fixtures/gateway-helpers.ts"
import type { Harness } from "./fixtures/gateway-helpers.ts"

describe("the OpenAI-compatible routes", () => {
    let h: Harness
    let key = ""

    before(async () => {
        h = await harness()
        key = await h.key()
    })
    after(() => h.close())

    test("POST /v1/chat/completions routes a profile and answers the OpenAI completion without routing", async () => {
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        assert.equal(reply.status, 200)
        assert.equal(reply.json.object, "chat.completion")
        assert.equal((reply.json.choices as { message: { content: string } }[])[0]?.message.content, "ok")
        assert.equal(reply.json.routing, undefined)
        assert.match(reply.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/)
        assert.equal(reply.headers.get("x-ai-router-model"), "m1")
        const upstream = h.fake.calls.at(-1)
        assert.equal(upstream?.model, "m1")
        assert.equal(upstream.key, UPSTREAM_SECRET)
        assert.equal(upstream.body.stream, undefined)
    })

    test("a pool model is routed by its id or alias", async () => {
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("fast") })
        assert.equal(reply.status, 200)
        assert.equal(h.fake.calls.at(-1)?.model, "m1")
    })

    test("stream: true answers OpenAI chunks over SSE, ends with [DONE] and keeps the usage chunk unless asked", async () => {
        h.fake.on({ model: "m1" }, { stream: { chunks: ["Hel", "lo"] } })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson", { stream: true }) })
        assert.equal(reply.status, 200)
        assert.match(reply.headers.get("content-type") ?? "", /^text\/event-stream/)
        const data = events(reply.text)
        assert.equal(data.at(-1), "[DONE]")
        const chunks = data.slice(0, -1).map((item) => JSON.parse(item) as { object: string; choices: { delta: { content?: string } }[]; usage?: unknown })
        assert.ok(chunks.every((chunk) => chunk.object === "chat.completion.chunk" && chunk.usage === undefined))
        assert.equal(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join(""), "Hello")
        assert.deepEqual(h.fake.calls.at(-1)?.body.stream_options, { include_usage: true })
    })

    test("a stream that asked for usage gets the usage chunk", async () => {
        h.fake.on({ model: "m1" }, { stream: { chunks: ["a"] } })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson", { stream: true, stream_options: { include_usage: true } }) })
        const chunks = events(reply.text)
            .slice(0, -1)
            .map((item) => JSON.parse(item) as { choices: unknown[]; usage?: { total_tokens: number } })
        assert.equal(chunks.at(-1)?.usage?.total_tokens, 11)
    })

    test("POST /v1/embeddings routes an embeddings model", async () => {
        const reply = await http(h.url, "/v1/embeddings", { key, body: { model: "e1", input: ["a", "b"] } })
        assert.equal(reply.status, 200)
        assert.equal(reply.json.object, "list")
        assert.equal((reply.json.data as unknown[]).length, 2)
        assert.equal(reply.json.routing, undefined)
    })

    test("GET /health answers ok, and the pool detail only to the admin", async () => {
        const open = await http(h.url, "/health")
        assert.deepEqual(open.json, { status: "ok" })
        const admin = await http(h.url, "/health", { key: ADMIN_TOKEN })
        assert.equal(admin.json.status, "ok")
        assert.ok(Array.isArray((admin.json.pool as { providers: unknown[] }).providers))
    })
})

describe("GET /v1/models lists what the calling key may use", () => {
    let h: Harness

    before(async () => {
        h = await harness()
    })
    after(() => h.close())

    test("a key bound to a profile and a model sees those, with the model's aliases", async () => {
        const key = await h.key({ profiles: ["lesson"], models: ["m1"] })
        const reply = await http(h.url, "/v1/models", { key })
        assert.equal(reply.json.object, "list")
        const ids = (reply.json.data as { id: string; object: string; owned_by: string }[]).map((model) => model.id)
        assert.deepEqual(ids.sort(), ["fast", "lesson", "m1"])
        const one = await http(h.url, "/v1/models/lesson", { key })
        assert.deepEqual(one.json, { id: "lesson", object: "model", created: 0, owned_by: "profile" })
        assert.equal((await http(h.url, "/v1/models/quiz", { key })).status, 404)
    })

    test("a wildcard key sees every profile and model", async () => {
        const key = await h.key()
        const ids = ((await http(h.url, "/v1/models", { key })).json.data as { id: string }[]).map((model) => model.id)
        assert.deepEqual(ids.sort(), ["e1", "fast", "lesson", "m1", "m2", "quiz"])
    })
})

describe("error statuses in the OpenAI error shape", () => {
    let h: Harness
    let key = ""

    before(async () => {
        h = await harness({ maxBodyBytes: 2048 })
        key = await h.key({ profiles: ["lesson"], models: ["m1", "e1"] })
    })
    after(() => h.close())

    test("401 without a key and with a wrong key", async () => {
        const none = await http(h.url, "/v1/chat/completions", { body: chatBody("lesson") })
        assert.equal(none.status, 401)
        assert.deepEqual(Object.keys(none.json.error as object).sort(), ["code", "message", "param", "type"])
        assert.equal(errorOf(none).type, "authentication_error")
        const wrong = await http(h.url, "/v1/chat/completions", { key: "sk-starci-test-nope", body: chatBody("lesson") })
        assert.equal(wrong.status, 401)
        assert.equal(errorOf(wrong).code, "invalid_api_key")
        assert.equal((await http(h.url, "/v1/models", { key: "not-a-starci-key" })).status, 401)
    })

    test("403 for a profile or model the key may not call, 404 for one the pool does not have", async () => {
        const profile = await http(h.url, "/v1/chat/completions", { key, body: chatBody("quiz") })
        assert.equal(profile.status, 403)
        assert.equal(errorOf(profile).code, "model_not_allowed")
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("m2") })).status, 403)
        const missing = await http(h.url, "/v1/chat/completions", { key, body: chatBody("gpt-9") })
        assert.equal(missing.status, 404)
        assert.equal(errorOf(missing).code, "model_not_found")
    })

    test("400 for a body that is not JSON, not an object, or lacks model, messages or input; 413 past the size limit", async () => {
        assert.equal(errorOf(await http(h.url, "/v1/chat/completions", { key, body: "{nope" })).code, "invalid_json")
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: "[]" })).status, 400)
        assert.equal(errorOf(await http(h.url, "/v1/chat/completions", { key, body: { messages: [] } })).code, "missing_model")
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: { model: "lesson" } })).status, 400)
        assert.equal((await http(h.url, "/v1/embeddings", { key, body: { model: "e1" } })).status, 400)
        assert.equal(errorOf(await http(h.url, "/v1/embeddings", { key, body: { model: "m1", input: "x" } })).code, "model_not_supported")
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson", { pad: "x".repeat(4096) }) })).status, 413)
    })

    test("404 for an unknown route, 405 for a wrong method", async () => {
        assert.equal((await http(h.url, "/v2/anything", { key })).status, 404)
        assert.equal((await http(h.url, "/v1/chat/completions", { key })).status, 405)
        assert.equal((await http(h.url, "/health", { method: "POST", body: {} })).status, 405)
    })

    test("502 when every attempt fails upstream, with no upstream detail beyond the scrubbed message", async () => {
        h.fake.on({ model: "m1" }, { status: 500 })
        h.fake.on({ model: "m2" }, { status: 500 })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        assert.equal(reply.status, 502)
        assert.equal(errorOf(reply).code, "upstream_error")
        assert.equal(errorOf(reply).type, "api_error")
        h.fake.reset()
    })

    test("503 with Retry-After when the pool is rate limited past the deadline", async () => {
        h.fake.on({}, { status: 429, headers: { "retry-after": "600" } })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })
        assert.equal(reply.status, 503)
        assert.equal(errorOf(reply).code, "pool_rate_limited")
        assert.ok(Number(reply.headers.get("retry-after")) > 0)
        const again = await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })
        assert.equal(again.status, 503)
        await h.router.reset()
        h.fake.reset()
    })

    test("an upstream 4xx passes its status and message through", async () => {
        h.fake.on({}, { status: 422, body: { error: { message: "context too long", type: "invalid_request_error" } } })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })
        assert.equal(reply.status, 422)
        assert.equal(errorOf(reply).code, "upstream_invalid_request")
        assert.match(errorOf(reply).message, /context too long/)
        h.fake.reset()
    })

    test("a stream that fails before its first token is an ordinary error response", async () => {
        h.fake.on({ model: "m1" }, { status: 500 })
        h.fake.on({ model: "m2" }, { status: 500 })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson", { stream: true }) })
        assert.equal(reply.status, 502)
        assert.equal(errorOf(reply).code, "upstream_error")
        h.fake.reset()
    })

    test("a stream that fails after its first token ends with an OpenAI error event", async () => {
        h.fake.on({ model: "m1" }, { stream: { chunks: ["a", "b", "c"], failAfter: 2, failWith: "error-event" } })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson", { stream: true }) })
        assert.equal(reply.status, 200)
        const data = events(reply.text)
        assert.notEqual(data.at(-1), "[DONE]")
        const last = JSON.parse(data.at(-1) ?? "{}") as { error?: { code: string } }
        assert.equal(last.error?.code, "upstream_error")
        h.fake.reset()
    })
})

describe("the upstream key never leaves the gateway", () => {
    test("an upstream error that echoes the key is scrubbed, and no reply carries it", async () => {
        const h = await harness()
        const key = await h.key()
        h.fake.on({}, { status: 400, body: { error: { message: `invalid request for key ${UPSTREAM_SECRET}` } } })
        const failed = await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") })
        assert.equal(failed.status, 400)
        assert.ok(!failed.text.includes(UPSTREAM_SECRET))
        assert.match(failed.text, /\[redacted\]/)
        h.fake.reset()
        for (const reply of [
            await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1") }),
            await http(h.url, "/v1/chat/completions", { key, body: chatBody("m1", { stream: true }) }),
            await http(h.url, "/v1/models", { key }),
            await http(h.url, "/health", { key: ADMIN_TOKEN }),
        ]) {
            assert.ok(!reply.text.includes(UPSTREAM_SECRET))
            reply.headers.forEach((value) => {
                assert.ok(!value.includes(UPSTREAM_SECRET))
            })
        }
        await h.close()
    })
})

describe("profile and model routing under a key's fallback binding", () => {
    let h: Harness

    before(async () => {
        h = await harness()
    })
    after(() => h.close())

    test("a profile falls back to its fallback model", async () => {
        const key = await h.key({ profiles: ["lesson"], models: [] })
        h.fake.on({ model: "m1" }, { status: 500 })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        assert.equal(reply.status, 200)
        assert.equal(reply.headers.get("x-ai-router-model"), "m2")
        h.fake.reset()
    })

    test("a key that may not fall back stays on the profile's model", async () => {
        const key = await h.key({ profiles: ["lesson"], models: [], allowFallback: false })
        h.fake.reset()
        await h.router.reset()
        h.fake.on({ model: "m1" }, { status: 500 })
        const reply = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        assert.equal(reply.status, 502)
        assert.ok(h.fake.calls.every((call) => call.model === "m1"))
        h.fake.reset()
    })

    test("a direct model falls back only to default fallbacks the key may call", async () => {
        const narrow = await h.key({ profiles: [], models: ["m1"] })
        h.fake.reset()
        await h.router.reset()
        h.fake.on({ model: "m1" }, { status: 500 })
        assert.equal((await http(h.url, "/v1/chat/completions", { key: narrow, body: chatBody("m1") })).status, 502)
        assert.ok(h.fake.calls.every((call) => call.model === "m1"))
        const wide = await h.key({ profiles: [], models: ["m1", "m2"] })
        const reply = await http(h.url, "/v1/chat/completions", { key: wide, body: chatBody("m1") })
        assert.equal(reply.status, 200)
        assert.equal(reply.headers.get("x-ai-router-model"), "m2")
        h.fake.reset()
    })
})

describe("a gateway mounted on another server", () => {
    test("handle uses a body a framework already parsed", async () => {
        const fake = createFakeProvider()
        const router = createRouter(gatewayPool(fake))
        const gateway = createGateway(router, { keys: new MemoryKeyStore() })
        const { secret } = await gateway.admin.create({ label: "mounted", profiles: ["lesson"] })
        const server = createServer((request, response) => {
            let raw = ""
            request.on("data", (chunk: Buffer) => {
                raw += chunk.toString("utf8")
            })
            request.on("end", () => {
                if (raw !== "") Object.assign(request, { body: JSON.parse(raw) as unknown })
                void gateway.handle(request, response)
            })
        })
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
        const reply = await http(url, "/v1/chat/completions", { key: secret, body: chatBody("lesson") })
        assert.equal(reply.status, 200)
        assert.equal((await http(url, "/admin/keys", { key: "anything" })).status, 403)
        server.close()
        await gateway.close()
    })
})
