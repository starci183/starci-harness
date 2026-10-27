import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import { ask, provider, record, setup, tally } from "./helpers.ts"

describe("selection", () => {
    test("equal candidates share calls by round-robin", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2", "k3"], [{ id: "m1" }])])
        for (let index = 0; index < 9; index++) await router.chat(ask())
        assert.deepEqual(tally(fake.calls.map((call) => call.key)), { "sk-a-k1": 3, "sk-a-k2": 3, "sk-a-k3": 3 })
        // Round-robin, not random: no key serves twice in a row.
        for (let index = 1; index < fake.calls.length; index++) assert.notEqual(fake.calls[index]?.key, fake.calls[index - 1]?.key)
    })

    test("weights skew the share: key 3, provider 1", async () => {
        const { router, fake } = setup([
            { ...provider("a", [], [{ id: "m1" }]), keys: [{ alias: "heavy", weight: 3, resolve: () => "sk-heavy" }, { alias: "light", resolve: () => "sk-light" }] },
        ])
        for (let index = 0; index < 8; index++) await router.chat(ask())
        assert.deepEqual(tally(fake.calls.map((call) => call.key)), { "sk-heavy": 6, "sk-light": 2 })
    })

    test("concurrent calls spread to the least-loaded key", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2", "k3", "k4"], [{ id: "m1" }])])
        fake.on({}, { latencyMs: 30 })
        await Promise.all(Array.from({ length: 4 }, () => router.chat(ask())))
        assert.equal(new Set(fake.calls.map((call) => call.key)).size, 4)
    })

    test("a per-key concurrency cap queues calls instead of overloading the key", async () => {
        const fake = createFakeProvider().on({}, { latencyMs: 20 })
        let inflight = 0
        let peak = 0
        const counting = async (input: string, init: RequestInit): Promise<Response> => {
            inflight++
            peak = Math.max(peak, inflight)
            try {
                return await fake.fetch(input, init)
            } finally {
                inflight--
            }
        }
        const { router } = setup([{ ...provider("a", [], [{ id: "m1" }]), keys: [{ alias: "only", maxConcurrency: 1, resolve: () => "sk-only" }] }], { fetch: counting })
        const results = await Promise.all([router.chat(ask()), router.chat(ask()), router.chat(ask())])
        assert.equal(results.length, 3)
        assert.equal(peak, 1)
        assert.equal(fake.calls.length, 3)
    })

    test("a provider concurrency cap holds across its keys", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }], { maxConcurrency: 1 })])
        fake.on({}, { latencyMs: 15 })
        const started = Date.now()
        await Promise.all([router.chat(ask()), router.chat(ask())])
        assert.ok(Date.now() - started >= 28, "the second call waited for the first")
    })

    test("a slow key loses most turns once its latency EWMA passes the tolerance, and is never starved", async () => {
        const { router, fake } = setup([provider("a", ["slow", "quick"], [{ id: "m1" }])])
        fake.on({ key: "sk-a-slow" }, { latencyMs: 120 })
        fake.on({ key: "sk-a-quick" }, { latencyMs: 1 })
        // Three samples each before latency ranks a key: round-robin until then.
        for (let index = 0; index < 6; index++) await router.chat(ask())
        assert.deepEqual(tally(fake.calls.map((call) => call.key)), { "sk-a-slow": 3, "sk-a-quick": 3 })
        const before = fake.calls.length
        for (let index = 0; index < 12; index++) await router.chat(ask())
        const after = tally(fake.calls.slice(before).map((call) => call.key))
        assert.ok((after["sk-a-quick"] ?? 0) >= 10, JSON.stringify(after))
        // Left out, its EWMA drifts toward the best, so it is tried again rather than dropped for good.
        assert.ok((after["sk-a-slow"] ?? 0) >= 1, JSON.stringify(after))
    })

    test("capabilities, the context window and the budget filter models", async () => {
        const { router, fake } = setup([
            provider("a", ["k1"], [
                { id: "plain", aliases: ["any"], capabilities: ["chat"] },
                { id: "tooled", aliases: ["any"], capabilities: ["chat", "tools", "streaming"] },
                { id: "small", aliases: ["ctx"], contextWindow: 10 },
                { id: "large", aliases: ["ctx"], contextWindow: 100_000 },
                { id: "dear", aliases: ["cost"], cost: { input: 1_000_000, output: 1_000_000 } },
                { id: "cheap", aliases: ["cost"], cost: { input: 1, output: 1 } },
            ]),
        ])
        const tools = await router.chat({ ...ask("x", "any"), tools: [{ type: "function", function: { name: "f" } }] })
        assert.equal(tools.routing.model, "tooled")
        const long = await router.chat(ask("y".repeat(200), "ctx"))
        assert.equal(long.routing.model, "large")
        const budgeted = await router.chat({ ...ask("z", "cost"), max_tokens: 100 }, { policy: { budget: { maxCost: 0.01 } } })
        assert.equal(budgeted.routing.model, "cheap")
        assert.ok(fake.calls.every((call) => !["plain", "small", "dear"].includes(call.model)))
        await assert.rejects(router.chat(ask("x", "plain"), { policy: { require: ["json"] } }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "no_candidate")
        await assert.rejects(router.chat({ ...ask("x", "plain"), response_format: { type: "json_object" } }), /no provider serves plain/)
    })

    test("the request event names the lane that answered", async () => {
        const { router } = setup()
        const requests = record(router, "request")
        const result = await router.chat(ask())
        assert.equal(requests.length, 1)
        assert.equal(requests[0]?.outcome, "success")
        assert.equal(requests[0].provider, result.routing.provider)
        assert.equal(requests[0].key, result.routing.key)
    })
})
