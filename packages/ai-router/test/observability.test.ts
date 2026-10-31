import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import { createRouter } from "../src/router.ts"
import { EMPTY_RECORD, MemoryStateStore } from "../src/store.ts"
import type { HealthRecord, StateStore } from "../src/store.ts"
import { ask, provider, record, setup, standardProviders } from "./helpers.ts"

const SECRET_PROMPT = "my private prompt 7f3a"

describe("embeddings", () => {
    test("route only to embedding models and report usage and cost", async () => {
        const { router, fake } = setup([
            provider("a", ["k1"], [
                { id: "chat", aliases: ["emb"] },
                { id: "embed-small", aliases: ["emb"], capabilities: ["embeddings"], cost: { input: 20, output: 0 } },
            ]),
        ])
        fake.on({ path: "/embeddings" }, { embedding: [1, 2], usage: { prompt_tokens: 50_000, total_tokens: 50_000 } })
        const result = await router.embeddings({ model: "emb", input: ["a", "b"] })
        assert.equal(result.data.length, 2)
        assert.deepEqual(result.data[1]?.embedding, [1, 2])
        assert.equal(result.routing.model, "embed-small")
        assert.equal(result.routing.cost, 1)
        assert.equal(fake.calls[0]?.path, "/v1/embeddings")
        const single = await router.embeddings({ model: "emb", input: "one" })
        assert.equal(single.data.length, 1)
    })

    test("fail over like chat", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "e", capabilities: ["embeddings"] }])])
        fake.on({ key: "sk-a-k1" }, { status: 500 })
        const result = await router.embeddings({ model: "e", input: "x" })
        assert.equal(result.routing.key, "k2")
        await assert.rejects(router.embeddings({ model: "e", input: "x" }, { policy: { require: ["vision"] } }), /no provider serves/)
    })
})

describe("telemetry", () => {
    test("events carry aliases and numbers, never key values or content", async () => {
        const { router, fake } = setup()
        fake.on({ key: "sk-a-k1" }, { status: 500, body: { error: { message: "bad key sk-a-k1 for my private prompt 7f3a" } } })
        const seen: unknown[] = []
        for (const name of ["attempt", "breaker", "key-disabled", "request"] as const) router.on(name, (event) => seen.push(event))
        const result = await router.chat(ask(SECRET_PROMPT))
        const text = JSON.stringify(seen)
        assert.ok(seen.length >= 3)
        assert.ok(!text.includes("sk-a-"), "no key value")
        assert.ok(!text.includes(SECRET_PROMPT), "no prompt")
        assert.ok(!JSON.stringify(result.routing).includes("sk-"))
        assert.ok(text.includes('"key":"k1"'))
    })

    test("an error message never carries the key value a provider echoed", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1" }])])
        fake.on({}, { status: 400, body: { error: { message: "the request echoed sk-a-k1 back" } } })
        await assert.rejects(router.chat(ask()), (error: unknown) => {
            assert.ok(error instanceof AiRouterError)
            assert.ok(!error.message.includes("sk-a-k1"), error.message)
            assert.ok(error.message.includes("[redacted]"))
            assert.ok(!JSON.stringify(error.attempts).includes("sk-a-k1"))
            return true
        })
    })

    test("an error object inside a 200 body is scrubbed too", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1" }])])
        fake.on({}, { body: { error: { message: "context too long for sk-a-k1", code: "context_length_exceeded" } } })
        await assert.rejects(router.chat(ask()), (error: unknown) => error instanceof AiRouterError && error.errorClass === "invalid_request" && !error.message.includes("sk-a-k1"))
    })

    test("non-JSON and message-only error bodies still make a message", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])])
        fake.on({ key: "sk-a-k1" }, { status: 400, body: { message: "plain message" } })
        await assert.rejects(router.chat(ask()), /plain message/)
        const raw = (): Promise<Response> => Promise.resolve(new Response("upstream exploded", { status: 400, statusText: "Bad" }))
        const other = setup([provider("a", ["k1"], [{ id: "m1" }])], { fetch: raw })
        await assert.rejects(other.router.chat(ask()), /HTTP 400: upstream exploded/)
    })

    test("includeContent opts the request and response into attempt events", async () => {
        const { router } = setup(standardProviders(), { telemetry: { includeContent: true } })
        const attempts = record(router, "attempt")
        await router.chat(ask(SECRET_PROMPT))
        assert.ok(JSON.stringify(attempts[0]?.content).includes(SECRET_PROMPT))
        assert.ok(JSON.stringify(attempts[0]?.content?.response).includes("chat.completion"))
    })

    test("a throwing handler is isolated and unsubscribe stops delivery", async () => {
        const { router } = setup()
        let calls = 0
        router.on("attempt", () => {
            throw new Error("observer bug")
        })
        const off = router.on("request", () => {
            calls++
        })
        await router.chat(ask())
        off()
        await router.chat(ask())
        assert.equal(calls, 1)
    })

    test("stats count requests, attempts, failures and tokens per lane", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1", cost: { input: 1_000_000, output: 2_000_000 } }])])
        fake.on({ key: "sk-a-k1" }, { status: 429 })
        await router.chat(ask())
        const stats = router.stats()
        assert.equal(stats.requests, 1)
        assert.equal(stats.succeeded, 1)
        assert.equal(stats.attempts, 2)
        const k1 = stats.lanes.find((lane) => lane.key === "k1")
        const k2 = stats.lanes.find((lane) => lane.key === "k2")
        assert.deepEqual(k1?.failures, { rate_limit: 1 })
        assert.equal(k2?.successes, 1)
        assert.equal(k2.promptTokens, 10)
        assert.equal(k2.completionTokens, 2)
        assert.equal(k2.cost, 14)
        assert.equal(k2.model, "m1")
    })

    test("a reply without usage has no cost", async () => {
        const { router, fake } = setup([provider("a", ["k1"], [{ id: "m1", cost: { input: 1, output: 1 } }])])
        fake.on({}, { body: { id: "x", object: "chat.completion", created: 0, model: "m1", choices: [] } })
        const result = await router.chat(ask())
        assert.equal(result.routing.cost, undefined)
    })
})

describe("state store", () => {
    test("two routers sharing a store see each other's breakers and disabled keys", async () => {
        const store = new MemoryStateStore()
        const fake = createFakeProvider()
        const options = { providers: [provider("a", ["k1", "k2"], [{ id: "m1" }])], fetch: fake.fetch, store, resilience: { keyBreaker: { failureThreshold: 1, cooldownMs: 60_000 } } }
        const first = createRouter(options)
        const second = createRouter(options)
        fake.on({ key: "sk-a-k1" }, { status: 500 })
        await first.chat(ask())
        const health = await second.health()
        assert.equal(health.providers[0]?.keys[0]?.breaker, "open")
        const before = fake.calls.length
        await second.chat(ask())
        await second.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-a-k2"))
    })

    test("an async adapter works and namespaces keep pools apart", async () => {
        const map = new Map<string, HealthRecord>()
        const leases = new Map<string, number>()
        const adapter: StateStore = {
            get: (key) => Promise.resolve(map.get(key)),
            set: (key, value) => {
                map.set(key, value)
                return Promise.resolve()
            },
            delete: (key) => {
                map.delete(key)
                return Promise.resolve()
            },
            keys: (prefix) => Promise.resolve([...map.keys()].filter((key) => key.startsWith(prefix))),
            lease: (key, ttlMs) => {
                const held = leases.get(key)
                if (held !== undefined && held > Date.now()) return Promise.resolve(false)
                leases.set(key, Date.now() + ttlMs)
                return Promise.resolve(true)
            },
            release: (key) => {
                leases.delete(key)
                return Promise.resolve()
            },
        }
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }])], { store: adapter, storeNamespace: "pool-x" })
        fake.on({ key: "sk-a-k1" }, { status: 401 })
        await router.chat(ask())
        assert.ok([...map.keys()].every((key) => key.startsWith("pool-x:")))
        assert.equal(map.get("pool-x:key:a/k1")?.disabledReason, "auth")
        await router.reset({ provider: "a", key: "k1" })
        assert.equal(map.get("pool-x:key:a/k1"), undefined)
    })

    test("the memory store leases exclusively until release or expiry", async () => {
        const store = new MemoryStateStore()
        assert.equal(store.lease("x", 30), true)
        assert.equal(store.lease("x", 30), false)
        store.release("x")
        assert.equal(store.lease("x", 1), true)
        await new Promise((resolve) => setTimeout(resolve, 5))
        assert.equal(store.lease("x", 30), true)
        store.set("r", EMPTY_RECORD)
        assert.deepEqual(store.keys("r"), ["r"])
        store.delete("r")
        assert.equal(store.get("r"), undefined)
    })
})
