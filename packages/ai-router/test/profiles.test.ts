import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider, PROVIDER_ERRORS } from "../src/fake.ts"
import { createRouter } from "../src/router.ts"
import type { FakeProvider } from "../src/fake.ts"
import type { AiRouter, ChatCompletionRequest, ModelConfig, PoolConfig, ProviderConfig } from "../src/types.ts"
import { errorOf, harness, http } from "./fixtures/gateway-helpers.ts"
import { record, tally } from "./helpers.ts"

/** The pool an app declares: work across Anthropic, OpenRouter and DeepSeek; embed pinned to one embeddings model at OpenAI and OpenRouter. */
function providers(): ProviderConfig[] {
    const keys = (id: string, aliases: readonly string[]): ProviderConfig["keys"] => aliases.map((alias) => ({ alias, resolve: () => `sk-${id}-${alias}` }))
    return [
        { id: "anthropic", kind: "anthropic", keys: keys("anthropic", ["a1"]), models: [{ id: "claude-sonnet-5-5" }] },
        {
            id: "openrouter",
            kind: "openrouter",
            keys: keys("openrouter", ["o1"]),
            models: [{ id: "anthropic/claude-sonnet-5-5" }, { id: "openai/text-embedding-3-small", identity: "text-embedding-3-small", dimensions: 3, capabilities: ["embeddings"] }],
        },
        { id: "deepseek", kind: "deepseek", keys: keys("deepseek", ["d1"]), models: [{ id: "deepseek-v4-pro" }] },
        {
            id: "openai",
            kind: "openai",
            keys: keys("openai", ["k1", "k2"]),
            models: [{ id: "text-embedding-3-small", dimensions: 3, capabilities: ["embeddings"] }, { id: "text-embedding-3-large", dimensions: 3, capabilities: ["embeddings"] }],
        },
    ]
}

const profiles = {
    work: {
        candidates: [
            [
                { provider: "anthropic", model: "claude-sonnet-5-5", weight: 3 },
                { provider: "openrouter", model: "anthropic/claude-sonnet-5-5", weight: 1 },
            ],
            { provider: "deepseek", model: "deepseek-v4-pro" },
        ],
    },
    embed: { pinned: true, candidates: [[{ model: "text-embedding-3-small" }, { model: "openai/text-embedding-3-small" }]] },
}

function setup(extra: Partial<PoolConfig> = {}): { fake: FakeProvider; router: AiRouter } {
    const fake = createFakeProvider()
    const router = createRouter({ providers: providers(), profiles, fetch: fake.fetch, random: () => 0.5, resilience: { backoff: { baseMs: 1, maxMs: 1 } }, ...extra })
    return { fake, router }
}

const chat: ChatCompletionRequest = { messages: [{ role: "user", content: "hi" }] }

describe("the work profile", () => {
    test("shares its first tier by weight across providers", async () => {
        const { router } = setup()
        const used: string[] = []
        for (let index = 0; index < 8; index++) used.push((await router.chat(chat, { profile: "work" })).routing.provider)
        assert.deepEqual(tally(used), { anthropic: 6, openrouter: 2 })
    })

    test("falls back across providers and models when its first tier has no usable key", async () => {
        const { fake, router } = setup()
        fake.on({ key: "sk-anthropic-a1" }, PROVIDER_ERRORS.anthropic.quota_exhausted)
        fake.on({ key: "sk-openrouter-o1" }, PROVIDER_ERRORS.openrouter.quota_exhausted)
        const result = await router.chat(chat, { profile: "work" })
        assert.equal(result.routing.provider, "deepseek")
        assert.equal(result.routing.model, "deepseek-v4-pro")
        assert.deepEqual(router.catalog().profiles.find((profile) => profile.name === "work"), { name: "work", model: "claude-sonnet-5-5", fallbacks: ["anthropic/claude-sonnet-5-5", "deepseek-v4-pro"], pinned: false, serves: ["chat"] })
    })

    test("allowFallback false keeps it on its first tier", async () => {
        const { fake, router } = setup()
        fake.on({ path: "/messages" }, { status: 500 })
        fake.on({ key: "sk-openrouter-o1" }, { status: 500 })
        await assert.rejects(router.chat(chat, { profile: "work", policy: { allowFallback: false } }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "transient")
        assert.ok(fake.calls.every((call) => !call.url.includes("deepseek")))
    })

    test("a call's own model overrides the candidates of an unpinned profile", async () => {
        const { router } = setup()
        assert.equal((await router.chat(chat, { profile: "work", policy: { model: "deepseek-v4-pro" } })).routing.provider, "deepseek")
        assert.equal((await router.chat(chat, { profile: "work", policy: { candidates: [{ model: "deepseek-v4-pro" }] } })).routing.provider, "deepseek")
    })
})

describe("the pinned embed profile", () => {
    test("rotates keys and providers of one model identity, never another model", async () => {
        const { fake, router } = setup()
        const used: string[] = []
        for (let index = 0; index < 6; index++) {
            const result = await router.embeddings({ input: ["a", "b"] }, { profile: "embed" })
            assert.equal(result.data.length, 2)
            used.push(`${result.routing.provider}/${result.routing.key}`)
        }
        assert.deepEqual(Object.keys(tally(used)).sort(), ["openai/k1", "openai/k2", "openrouter/o1"])
        assert.ok(fake.calls.every((call) => call.model !== "text-embedding-3-large"))
        assert.equal(router.catalog().profiles.find((profile) => profile.name === "embed")?.pinned, true)
    })

    test("keeps serving while keys fail, and when every lane of the identity is gone it fails instead of switching model", async () => {
        const { fake, router } = setup()
        fake.on({ key: "sk-openai-k1" }, PROVIDER_ERRORS.openai.invalid_key)
        fake.on({ key: "sk-openai-k2" }, PROVIDER_ERRORS.openai.quota_exhausted)
        assert.equal((await router.embeddings({ input: "a" }, { profile: "embed" })).routing.provider, "openrouter")
        fake.on({ key: "sk-openrouter-o1" }, PROVIDER_ERRORS.openrouter.quota_exhausted)
        await assert.rejects(router.embeddings({ input: "a" }, { profile: "embed" }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "quota")
        assert.ok(fake.calls.every((call) => call.model !== "text-embedding-3-large"))
    })

    test("a call cannot name another model for a pinned profile", async () => {
        const { router } = setup()
        await assert.rejects(router.embeddings({ input: "a" }, { profile: "embed", policy: { model: "text-embedding-3-large" } }), /pinned/)
        await assert.rejects(router.embeddings({ input: "a" }, { profile: "embed", policy: { fallbacks: ["text-embedding-3-large"] } }), /pinned/)
    })

    test("a vector of the wrong length fails the lane and is never returned", async () => {
        const { fake, router } = setup()
        const attempts = record(router, "attempt")
        fake.on({ key: "sk-openai-k1" }, { embedding: [1, 2, 3, 4] })
        fake.on({ key: "sk-openai-k2" }, { embedding: [1, 2, 3, 4] })
        const result = await router.embeddings({ input: "a" }, { profile: "embed" })
        assert.equal(result.routing.provider, "openrouter")
        assert.ok(attempts.some((event) => event.outcome === "failure" && event.errorClass === "transient"))
        assert.equal(result.data[0]?.embedding.length, 3)
    })

    test("a base64 vector is measured too, and a request for other dimensions finds no candidate", async () => {
        const { fake, router } = setup()
        fake.on({}, { body: { object: "list", data: [{ object: "embedding", index: 0, embedding: Buffer.from(new Float32Array([1, 2, 3]).buffer).toString("base64") }], model: "x" } })
        const result = await router.embeddings({ input: "a", encoding_format: "base64" }, { profile: "embed" })
        assert.equal(typeof result.data[0]?.embedding, "string")
        await assert.rejects(router.embeddings({ input: "a", dimensions: 1536 }, { profile: "embed" }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "no_candidate" && error.message.includes("1536 dimensions"))
    })

    test("an embeddings call without a profile stays on the first model's identity, never a fallback of another", async () => {
        const { fake, router } = setup({ defaults: { fallbacks: ["text-embedding-3-large"] } })
        fake.on({ model: "text-embedding-3-small" }, { status: 500 })
        await assert.rejects(router.embeddings({ model: "text-embedding-3-small", input: "a" }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "transient")
        assert.ok(fake.calls.every((call) => call.model !== "text-embedding-3-large"))
    })

    test("a malformed embeddings body is a failed attempt", async () => {
        const { fake, router } = setup()
        fake.on({ key: "sk-openai-k1" }, { body: { data: [{ embedding: ["x"] }] } })
        fake.on({ key: "sk-openai-k2" }, { body: { data: "nope" } })
        fake.on({ key: "sk-openrouter-o1" }, { body: { data: [5] } })
        await assert.rejects(router.embeddings({ input: "a" }, { profile: "embed" }), (error: unknown) => error instanceof AiRouterError && error.message.includes("without a list of vectors"))
    })

    test("a pinned profile is refused at config when its candidates are different models or lengths", () => {
        const base = { providers: providers() }
        assert.throws(() => createRouter({ ...base, profiles: { embed: { pinned: true, candidates: [{ model: "text-embedding-3-small" }, { model: "text-embedding-3-large" }] } } }), /different models/)
        const nine: ModelConfig = { id: "openai/text-embedding-3-small", identity: "text-embedding-3-small", dimensions: 9, capabilities: ["embeddings"] }
        const lengths = providers().map((entry) => (entry.id === "openrouter" ? { ...entry, models: entry.models.map((model) => (model.id === nine.id ? nine : model)) } : entry))
        assert.throws(() => createRouter({ providers: lengths, profiles }), /different lengths/)
        assert.throws(() => createRouter({ ...base, profiles: { embed: { pinned: true } } }), /names no model/)
        assert.throws(() => createRouter({ ...base, defaults: { pinned: true, model: "text-embedding-3-small" } }), /defaults cannot be pinned/)
    })
})

describe("candidate validation", () => {
    const base = { providers: providers() }
    test("refuses empty, unknown, mixed and badly weighted candidates", () => {
        assert.throws(() => createRouter({ ...base, profiles: { p: { candidates: [] } } }), /candidates is empty/)
        assert.throws(() => createRouter({ ...base, profiles: { p: { candidates: [[]] } } }), /empty tier/)
        assert.throws(() => createRouter({ ...base, profiles: { p: { candidates: [{ model: "nope" }] } } }), /does not serve/)
        assert.throws(() => createRouter({ ...base, profiles: { p: { candidates: [{ model: "deepseek-v4-pro", provider: "openai" }] } } }), /on provider "openai"/)
        assert.throws(() => createRouter({ ...base, profiles: { p: { candidates: [{ model: "deepseek-v4-pro", provider: "ghost" }] } } }), /provider "ghost"/)
        assert.throws(() => createRouter({ ...base, profiles: { p: { candidates: [{ model: "deepseek-v4-pro", weight: 0 }] } } }), /weight/)
        assert.throws(() => createRouter({ ...base, profiles: { p: { model: "deepseek-v4-pro", candidates: [{ model: "deepseek-v4-pro" }] } } }), /one or the other/)
    })

    test("refuses a bad kind, a missing base URL, bad dimensions and a negative budget", () => {
        const one = (provider: Partial<ProviderConfig>): PoolConfig => ({ providers: [{ id: "x", keys: [{ alias: "k", resolve: () => "s" }], models: [{ id: "m" }], ...provider }] })
        assert.throws(() => createRouter(one({ kind: "openai-compatible" })), /needs a baseUrl/)
        assert.throws(() => createRouter(one({ kind: "openai", models: [{ id: "m", dimensions: 1.5 }] })), /dimensions/)
        assert.throws(() => createRouter(one({ kind: "openai", budget: { costPerDay: -1 } })), /budget/)
        assert.throws(() => createRouter({ ...one({ kind: "openai" }), resilience: { quotaBlacklistMs: 0 } }), /quotaBlacklistMs/)
        assert.equal(createRouter(one({ kind: "deepseek" })).catalog().models[0]?.id, "m")
    })
})

describe("virtual key scopes at the gateway", () => {
    async function scoped(): Promise<Awaited<ReturnType<typeof harness>>> {
        return harness({}, (fake) => ({ providers: providers(), profiles, fetch: fake.fetch, random: () => 0.5, resilience: { backoff: { baseMs: 1, maxMs: 1 } } }))
    }

    test("a key bound to work and embed calls them by profile name; /v1/models lists only those", async () => {
        const h = await scoped()
        const key = await h.key({ profiles: ["work", "embed"], models: [] })
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: { model: "work", messages: [{ role: "user", content: "hi" }] } })).status, 200)
        const embed = await http(h.url, "/v1/embeddings", { key, body: { model: "embed", input: ["a"] } })
        assert.equal(embed.status, 200)
        assert.ok(!embed.text.includes("routing"))
        const models = await http(h.url, "/v1/models", { key })
        assert.deepEqual(
            (models.json.data as { id: string }[]).map((entry) => entry.id),
            ["work", "embed"],
        )
        await h.close()
    })

    test("a model the key does not allowlist is refused 403, never remapped; an allowlisted one goes through the pool", async () => {
        const h = await scoped()
        const plain = await h.key({ profiles: ["work"], models: [] })
        const refused = await http(h.url, "/v1/chat/completions", { key: plain, body: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] } })
        assert.equal(refused.status, 403)
        assert.equal(errorOf(refused).code, "model_not_allowed")
        assert.equal((await http(h.url, "/v1/embeddings", { key: plain, body: { model: "embed", input: "a" } })).status, 403)
        const pinned = await h.key({ profiles: ["work"], models: ["deepseek-v4-pro"] })
        const allowed = await http(h.url, "/v1/chat/completions", { key: pinned, body: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] } })
        assert.equal(allowed.status, 200)
        assert.equal(allowed.headers.get("x-ai-router-model"), "deepseek-v4-pro")
        await h.close()
    })

    test("a chat profile on /v1/embeddings and the embed profile on chat are refused 400", async () => {
        const h = await scoped()
        const key = await h.key({ profiles: ["work", "embed"], models: [] })
        const wrong = await http(h.url, "/v1/embeddings", { key, body: { model: "work", input: "a" } })
        assert.equal(wrong.status, 400)
        assert.equal(errorOf(wrong).code, "model_not_supported")
        assert.equal((await http(h.url, "/v1/chat/completions", { key, body: { model: "embed", messages: [{ role: "user", content: "x" }] } })).status, 400)
        await h.close()
    })

    test("a direct embeddings model never falls back to another model", async () => {
        const h = await harness({}, (fake) => ({ providers: providers(), defaults: { fallbacks: ["text-embedding-3-large"] }, fetch: fake.fetch, random: () => 0.5, resilience: { backoff: { baseMs: 1, maxMs: 1 } } }))
        const key = await h.key({ profiles: [], models: ["text-embedding-3-small", "text-embedding-3-large"] })
        h.fake.on({ model: "text-embedding-3-small" }, { status: 500 })
        h.fake.on({ model: "openai/text-embedding-3-small" }, { status: 500 })
        const reply = await http(h.url, "/v1/embeddings", { key, body: { model: "text-embedding-3-small", input: "a" } })
        assert.equal(reply.status, 502)
        assert.ok(h.fake.calls.every((call) => call.model !== "text-embedding-3-large"))
        await h.close()
    })
})
