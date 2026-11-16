import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import { poolFromEnv } from "../src/env.ts"
import { createFakeProvider } from "../src/fake.ts"
import { availableModels, clearOpenRouterCatalogCache, defaultProviderSpecs, fetchOpenRouterModels, KNOWN_MODELS, knownModelConfigs, withAutoProfiles } from "../src/known-models.ts"
import { createRouter } from "../src/router.ts"
import type { FetchLike } from "../src/types.ts"
import { ask } from "./helpers.ts"

const OPENROUTER_BODY = {
    data: [
        { id: "vendor/seer", context_length: 128000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools", "temperature"] },
        { id: "vendor/plain", architecture: { output_modalities: ["text"] } },
        { id: "vendor/painter", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
        { name: "no id" },
    ],
}

function catalogFetch(): { fetch: FetchLike; calls: string[] } {
    const calls: string[] = []
    return {
        calls,
        fetch: (input) => {
            calls.push(input)
            return Promise.resolve(new Response(JSON.stringify(OPENROUTER_BODY), { status: 200, headers: { "content-type": "application/json" } }))
        },
    }
}

beforeEach(() => { clearOpenRouterCatalogCache(); })

describe("known models", () => {
    test("the four Claude 5 ids and the OpenAI ids are known, with only the facts the vendors state", () => {
        const ids = KNOWN_MODELS.map((model) => model.id)
        for (const id of ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]) assert.ok(ids.includes(id), id)
        const claude = knownModelConfigs("anthropic")
        assert.ok(claude.every((model) => model.contextWindow === 1_000_000 && model.capabilities?.includes("vision") && model.capabilities.includes("tools")))
        assert.equal(claude.find((model) => model.id === "claude-haiku-5-5")?.cost, undefined, "Haiku is priced 'from', so no cost is declared")
        assert.deepEqual(claude.find((model) => model.id === "claude-opus-5-5")?.cost, { input: 4, output: 20, cacheRead: 0.2 })
        assert.equal(claude.find((model) => model.id === "claude-sonnet-5-5")?.forcedToolUse, false)
        assert.ok(knownModelConfigs("openai").every((model) => model.contextWindow === 1_050_000 && model.cost === undefined))
    })
})

describe("providers present only with a key", () => {
    test("no key: the provider and its models are absent; a key brings its models", () => {
        const specs = defaultProviderSpecs({ openRouterModels: [{ id: "vendor/seer", aliases: ["openrouter/vendor/seer"] }] })
        const only = poolFromEnv({ providers: specs }, { OPENAI_API_KEY: "sk-o" })
        assert.deepEqual(only.providers.map((entry) => entry.id), ["openai"])
        const all = poolFromEnv({ providers: specs }, { OPENAI_API_KEY: "sk-o", ANTHROPIC_API_KEY: "sk-a", OPENROUTER_API_KEY: "sk-r" })
        assert.deepEqual(all.providers.map((entry) => entry.id), ["anthropic", "openai", "openrouter"])
        assert.equal(all.providers[2]?.kind, "openrouter")
    })

    test("availableModels lists the configured providers' chat models with vision, tools and context", () => {
        const pool = poolFromEnv({ providers: defaultProviderSpecs({ openRouterModels: [{ id: "vendor/seer", aliases: ["openrouter/vendor/seer"], contextWindow: 128000, capabilities: ["chat", "tools"] }, { id: "e/embed", capabilities: ["embeddings"] }] }) }, { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "r" })
        const listed = availableModels(pool)
        assert.equal(listed.filter((model) => model.provider === "anthropic").length, 4)
        assert.ok(!listed.some((model) => model.provider === "openai"))
        assert.ok(!listed.some((model) => model.id.includes("embed")))
        assert.deepEqual(listed.find((model) => model.id === "claude-fable-5-2"), { id: "claude-fable-5-2", provider: "anthropic", label: "Claude Fable 5.2", vision: true, tools: true, contextTokens: 1_000_000 })
        assert.deepEqual(listed.find((model) => model.provider === "openrouter"), { id: "openrouter/vendor/seer", provider: "openrouter", label: "vendor/seer", vision: false, tools: true, contextTokens: 128000 })
        assert.deepEqual(createRouter(pool).availableModels(), listed)
    })
})

describe("OpenRouter", () => {
    test("the catalog is fetched from the models endpoint once, then cached", async () => {
        const { fetch, calls } = catalogFetch()
        let clock = 0
        const first = await fetchOpenRouterModels({ fetch, apiKey: "k", now: () => clock })
        assert.deepEqual(calls, ["https://openrouter.ai/api/v1/models"])
        assert.deepEqual(first.map((model) => model.id), ["vendor/seer", "vendor/plain"])
        assert.deepEqual(first[0], { id: "vendor/seer", aliases: ["openrouter/vendor/seer"], capabilities: ["chat", "streaming", "json", "tools", "vision"], contextWindow: 128000 })
        assert.deepEqual(first[1]?.capabilities, ["chat", "streaming", "json"])
        assert.equal(first[1].contextWindow, undefined)
        clock = 1000
        assert.equal(await fetchOpenRouterModels({ fetch, now: () => clock }), first)
        assert.equal(calls.length, 1)
        clock = 3_600_001
        await fetchOpenRouterModels({ fetch, now: () => clock })
        assert.equal(calls.length, 2)
    })

    test("a failing catalog is an error, not a cached empty list", async () => {
        const failing: FetchLike = () => Promise.resolve(new Response("{}", { status: 503 }))
        await assert.rejects(() => fetchOpenRouterModels({ fetch: failing }), /answered 503/)
    })

    test("a call to openrouter/<vendor>/<model> reaches OpenRouter with <vendor>/<model>", async () => {
        const fake = createFakeProvider()
        const pool = poolFromEnv({ providers: defaultProviderSpecs({ openRouterModels: await fetchOpenRouterModels({ fetch: catalogFetch().fetch }) }) }, { OPENROUTER_API_KEY: "sk-r" })
        const router = createRouter({ ...pool, fetch: fake.fetch })
        await router.chat(ask("hi", "openrouter/vendor/seer"))
        assert.equal(fake.calls[0]?.url.startsWith("https://openrouter.ai/api/v1"), true)
        assert.equal(fake.calls[0].model, "vendor/seer")
        assert.equal(fake.calls[0].key, "sk-r")
    })
})

describe("auto profiles", () => {
    const fromEnv = (env: Record<string, string>): ReturnType<typeof withAutoProfiles> => withAutoProfiles(poolFromEnv({ providers: defaultProviderSpecs() }, env))

    test("each effort tier starts at its own model and stays within the providers with keys", () => {
        const pool = fromEnv({ ANTHROPIC_API_KEY: "a" })
        assert.deepEqual(pool.profiles?.["auto-max"], { candidates: [[{ model: "claude-fable-5-2" }], [{ model: "claude-opus-5-5" }], [{ model: "claude-sonnet-5-5" }], [{ model: "claude-haiku-5-5" }]] })
        assert.deepEqual(pool.profiles["auto-low"], { candidates: [[{ model: "claude-haiku-5-5" }], [{ model: "claude-sonnet-5-5" }], [{ model: "claude-opus-5-5" }], [{ model: "claude-fable-5-2" }]] })
        assert.deepEqual(pool.profiles.auto, pool.profiles["auto-medium"])
        assert.equal(JSON.stringify(pool.profiles).includes("gpt-"), false)
    })

    test("two providers share a tier, and a pool with no known model gets no auto profile", () => {
        const both = fromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })
        assert.deepEqual(both.profiles?.["auto-high"]?.candidates?.[0], [{ model: "claude-opus-5-5" }, { model: "gpt-6.1-sol" }])
        const none = withAutoProfiles(poolFromEnv({ providers: [{ kind: "openrouter", models: [{ id: "vendor/seer" }] }] }, { OPENROUTER_API_KEY: "r" }))
        assert.equal(none.profiles?.auto, undefined)
    })

    test("a profile the app declares is kept, and an auto profile routes", async () => {
        const base = poolFromEnv({ providers: defaultProviderSpecs(), profiles: { auto: { model: "claude-haiku-5-5" } } }, { ANTHROPIC_API_KEY: "a" })
        assert.deepEqual(withAutoProfiles(base).profiles?.auto, { model: "claude-haiku-5-5" })
        const fake = createFakeProvider()
        const router = createRouter({ ...fromEnv({ ANTHROPIC_API_KEY: "a" }), fetch: fake.fetch })
        await router.chat({ messages: ask().messages }, { profile: "auto-high" })
        assert.equal(fake.calls[0]?.model, "claude-opus-5-5")
    })
})
