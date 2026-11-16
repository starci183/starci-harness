import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { AttemptError } from "../src/attempt.ts"
import { poolFromEnv } from "../src/env.ts"
import { AiRouterError } from "../src/errors.ts"
import { holdsModel, localModel, LOCAL_MODELS, probeLocal } from "../src/local.ts"
import { LOCAL_DEADLINE_MS } from "../src/providers.ts"
import { resolvePolicy, validateConfig } from "../src/config.ts"
import { createRouter } from "../src/router.ts"
import { truncateVector } from "../src/vectors.ts"
import type { AiRouter, ModelConfig, PoolConfig, ProviderConfig } from "../src/types.ts"
import { closedBaseUrl, startLocalServer, vectorOf } from "./fixtures/local-server.ts"
import type { LocalServer } from "./fixtures/local-server.ts"
import { drain } from "./helpers.ts"

const chat: ModelConfig = { id: "m-chat" }
const embed: ModelConfig = { id: "m-embed", capabilities: ["embeddings"], dimensions: 8 }
const ASK = { model: "m-chat", messages: [{ role: "user" as const, content: "hi" }] }

function local(baseUrl: string, extra: Partial<ProviderConfig> = {}): ProviderConfig {
    return { id: "gpu", kind: "local", baseUrl, keys: [], models: [chat, embed], ...extra }
}

function hosted(): ProviderConfig {
    return { id: "paid", kind: "openai", keys: [{ alias: "k", resolve: () => "sk-paid" }], models: [{ id: "gpt-x" }, { id: "m-chat" }] }
}

function routerOf(providers: readonly ProviderConfig[], extra: Partial<PoolConfig> = {}): AiRouter {
    return createRouter({ providers, random: () => 0.5, ...extra, resilience: { backoff: { baseMs: 1, maxMs: 2 }, ...extra.resilience } })
}

function norm(vector: readonly number[] | string): number {
    assert.ok(typeof vector !== "string")
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

describe("a keyless local server", () => {
    let server: LocalServer
    before(async () => {
        server = await startLocalServer()
    })
    after(async () => {
        await server.close()
    })

    test("chat goes out with no credentials, costs 0 and is never blacklisted", async () => {
        const router = routerOf([local(server.baseUrl)])
        const answer = await router.chat(ASK)
        assert.equal(answer.choices[0]?.message.content, "Hello")
        assert.equal(answer.routing.provider, "gpu")
        assert.equal(answer.routing.cost, 0)
        assert.equal(server.seen.at(-1)?.authorization, undefined)
        assert.equal(router.stats().lanes[0]?.cost, 0)
        assert.equal(router.stats().lanes[0]?.promptTokens, 5)
        const health = await router.health()
        assert.equal(health.providers[0]?.keys[0]?.disabled, false)
    })

    test("an optional key that is not set sends no credentials; one that is set is sent as a bearer token", async () => {
        const name = "LOCAL_TEST_GPU_KEY"
        const router = routerOf([local(server.baseUrl, { keys: [{ ref: name, optional: true }] })])
        Reflect.deleteProperty(process.env, name)
        await router.chat(ASK)
        assert.equal(server.seen.at(-1)?.authorization, undefined)
        assert.equal((await router.health()).providers[0]?.keys[0]?.alias, name)
        process.env[name] = "local-secret"
        try {
            await router.chat(ASK)
            assert.equal(server.seen.at(-1)?.authorization, "Bearer local-secret")
        } finally {
            Reflect.deleteProperty(process.env, name)
        }
    })

    test("a stream arrives as chunks and counts its usage at cost 0", async () => {
        const router = routerOf([local(server.baseUrl)])
        const chunks = await drain(router.stream({ ...ASK, stream_options: { include_usage: true } }))
        assert.equal(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join(""), "Hello")
        assert.equal(router.stats().lanes[0]?.completionTokens, 2)
        assert.equal(router.stats().lanes[0]?.cost, 0)
    })

    test("embeddings answer from /v1/embeddings", async () => {
        const router = routerOf([local(server.baseUrl)])
        const answer = await router.embeddings({ model: "m-embed", input: ["a", "b"] })
        assert.equal(answer.data.length, 2)
        assert.deepEqual(answer.data[0]?.embedding, vectorOf(8))
        assert.equal(answer.routing.cost, 0)
    })

    test("a model the server does not hold is its own class, and a call to it is not retried", async () => {
        const router = routerOf([local(server.baseUrl, { models: [{ id: "absent" }] })])
        const before = server.seen.length
        const error = await router.chat({ ...ASK, model: "absent" }).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        assert.ok(error instanceof AiRouterError)
        assert.equal(error.errorClass, "model_not_found")
        assert.equal(error.code, "AI_ROUTER_MODEL_NOT_FOUND")
        assert.equal(error.retryable, false)
        assert.equal(error.status, 404)
        assert.equal(server.seen.length - before, 1)
    })

    test("a first answer that takes longer than the policy timeout is waited for on a local provider, and only up to its own limit", async () => {
        const slow = await startLocalServer({ delayMs: 200 })
        try {
            const patient = routerOf([local(slow.baseUrl, { firstTokenTimeoutMs: 2000 })])
            assert.equal((await patient.chat(ASK, { policy: { timeoutMs: 50 } })).routing.provider, "gpu")
            const impatient = routerOf([local(slow.baseUrl, { firstTokenTimeoutMs: 60 })])
            const error = await impatient.chat(ASK, { policy: { timeoutMs: 50, maxAttempts: 1 } }).then(
                () => undefined,
                (caught: unknown) => caught,
            )
            assert.ok(error instanceof AiRouterError)
            assert.equal(error.errorClass, "timeout")
        } finally {
            await slow.close()
        }
    })
})

describe("embeddings of an MRL model", () => {
    let server: LocalServer
    before(async () => {
        server = await startLocalServer({ dimensions: 64, models: ["qwen3-embedding:8b"] })
    })
    after(async () => {
        await server.close()
    })

    const provider = (baseUrl: string, dimensions?: number): ProviderConfig => ({
        id: "gpu",
        kind: "local",
        baseUrl,
        keys: [],
        models: [{ ...localModel("qwen3-embedding:8b", dimensions === undefined ? {} : { dimensions }), dimensions: dimensions ?? 64 }],
    })

    test("the declared length cuts the vector and scales it to unit length", async () => {
        const router = routerOf([provider(server.baseUrl, 16)])
        const answer = await router.embeddings({ model: "qwen3-embedding:8b", input: "x" })
        const vector = answer.data[0]?.embedding
        assert.ok(Array.isArray(vector))
        assert.equal(vector.length, 16)
        assert.ok(Math.abs(norm(vector) - 1) < 1e-9)
        assert.equal(server.seen.at(-1)?.body.dimensions, undefined, "the endpoint is never asked to cut")
    })

    test("a smaller size asked by the call is a prefix of a larger one, each at unit length", async () => {
        const router = routerOf([provider(server.baseUrl)])
        const big = (await router.embeddings({ model: "qwen3-embedding:8b", input: "x", dimensions: 32 })).data[0]?.embedding
        const small = (await router.embeddings({ model: "qwen3-embedding:8b", input: "x", dimensions: 8 })).data[0]?.embedding
        assert.ok(Array.isArray(big) && Array.isArray(small))
        assert.equal(big.length, 32)
        assert.equal(small.length, 8)
        assert.ok(Math.abs(norm(big) - 1) < 1e-9 && Math.abs(norm(small) - 1) < 1e-9)
        // The same direction on the shared prefix: the ratio of the two is one constant.
        const ratio = (big[0] ?? 1) / (small[0] ?? 1)
        small.forEach((value, index) => { assert.ok(Math.abs((big[index] ?? 0) - value * ratio) < 1e-9); })
        // And the prefix of the raw vector, scaled: what the model's own smaller size would be.
        assert.deepEqual(small, truncateVector(vectorOf(64), 8))
    })

    test("more dimensions than the model answers, or a size that is not a positive integer, is the caller's mistake", async () => {
        const router = routerOf([provider(server.baseUrl)])
        const tooBig = await router.embeddings({ model: "qwen3-embedding:8b", input: "x", dimensions: 128 }).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        assert.ok(tooBig instanceof AiRouterError)
        assert.equal(tooBig.errorClass, "invalid_request")
        for (const bad of [0, -3, 1.5]) {
            const error = await router.embeddings({ model: "qwen3-embedding:8b", input: "x", dimensions: bad }).then(
                () => undefined,
                (caught: unknown) => caught,
            )
            assert.ok(error instanceof AiRouterError)
            assert.equal(error.errorClass, "invalid_request")
        }
    })

    test("the catalog declares qwen3-embedding:8b as a 4096-dimension MRL model, cut to what the app asks", () => {
        const model = localModel("qwen3-embedding:8b", { dimensions: 1024 })
        assert.equal(model.dimensions, 1024)
        assert.equal(model.truncate, "mrl")
        assert.deepEqual(model.cost, { input: 0, output: 0 })
        assert.equal(LOCAL_MODELS.find((entry) => entry.id === "qwen3-embedding:8b")?.dimensions, 4096)
        assert.equal(localModel("nomic-embed-text").truncate, undefined)
        assert.equal(localModel("some-chat:1b").capabilities, undefined)
    })

    test("a vector shorter than the cut, or in base64, cannot be cut", () => {
        assert.throws(() => truncateVector([1, 2], 4), (error: unknown) => error instanceof AttemptError && error.errorClass === "invalid_request")
        assert.throws(() => truncateVector("AAAA", 1), (error: unknown) => error instanceof AttemptError && error.errorClass === "invalid_request")
        assert.deepEqual(truncateVector([3, 4], 2), [3, 4])
        assert.deepEqual(truncateVector([3, 4, 9], 2), [0.6, 0.8])
        assert.deepEqual(truncateVector([0, 0, 9], 2), [0, 0])
    })

    test("a base64 request cannot be asked of a truncating model", async () => {
        const router = routerOf([provider(server.baseUrl)])
        const error = await router.embeddings({ model: "qwen3-embedding:8b", input: "x", encoding_format: "base64" }).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        assert.ok(error instanceof AiRouterError)
        assert.equal(error.errorClass, "invalid_request")
    })
})

describe("the embeddings fallback to the server's own API", () => {
    test("a server without /v1/embeddings is asked at /api/embed, and the answer is the same list", async () => {
        const server = await startLocalServer({ v1Embeddings: false })
        try {
            const router = routerOf([local(server.baseUrl)])
            const answer = await router.embeddings({ model: "m-embed", input: ["a", "b"] })
            assert.equal(answer.data.length, 2)
            assert.deepEqual(answer.data[1]?.embedding, vectorOf(8))
            assert.equal(answer.usage?.prompt_tokens, 3)
            assert.deepEqual(
                server.seen.filter((entry) => entry.method === "POST").map((entry) => entry.path),
                ["/v1/embeddings", "/api/embed"],
            )
            assert.deepEqual(server.seen.at(-1)?.body, { model: "m-embed", input: ["a", "b"] })
        } finally {
            await server.close()
        }
    })

    test("a model that is not pulled answers 404 on both paths and is model_not_found", async () => {
        const server = await startLocalServer({ v1Embeddings: false, models: [] })
        try {
            const router = routerOf([local(server.baseUrl)])
            const error = await router.embeddings({ model: "m-embed", input: "a" }).then(
                () => undefined,
                (caught: unknown) => caught,
            )
            assert.ok(error instanceof AiRouterError)
            assert.equal(error.errorClass, "model_not_found")
        } finally {
            await server.close()
        }
    })

    test("a base URL with no /v1 still reaches /api/embed", async () => {
        const server = await startLocalServer({ v1Embeddings: false })
        try {
            const router = routerOf([local(server.origin)])
            await router.embeddings({ model: "m-embed", input: "a" })
            assert.equal(server.seen.at(-1)?.path, "/api/embed")
        } finally {
            await server.close()
        }
    })
})

describe("an unreachable server", () => {
    test("is a network failure the router retries by class, then reports with every attempt", async () => {
        const router = routerOf([local(await closedBaseUrl())])
        const error = await router.chat(ASK, { policy: { maxAttempts: 3 } }).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        assert.ok(error instanceof AiRouterError)
        assert.equal(error.errorClass, "network")
        assert.equal(error.retryable, true)
        assert.equal(error.attempts.length, 3)
        assert.ok(error.attempts.every((attempt) => attempt.errorClass === "network"))
    })

    test("feeds the provider's breaker like any transport failure", async () => {
        const router = routerOf([local(await closedBaseUrl())], { resilience: { providerBreaker: { failureThreshold: 2, cooldownMs: 60_000 } } })
        await router.chat(ASK, { policy: { maxAttempts: 2 } }).catch(() => undefined)
        assert.equal((await router.health()).providers[0]?.breaker, "open")
    })
})

describe("model discovery and health", () => {
    test("/v1/models lists what the server holds", async () => {
        const server = await startLocalServer({ models: ["qwen3-embedding:8b", "nomic-embed-text:latest"] })
        try {
            const probe = await probeLocal({ baseUrl: server.baseUrl })
            assert.equal(probe.source, "/v1/models")
            assert.deepEqual(probe.models.map((model) => model.id), ["qwen3-embedding:8b", "nomic-embed-text:latest"])
            assert.ok(holdsModel(probe, "qwen3-embedding:8b"))
            assert.ok(holdsModel(probe, "nomic-embed-text"))
            assert.ok(!holdsModel(probe, "bge-m3"))
        } finally {
            await server.close()
        }
    })

    test("falls back to /api/tags when /v1/models is absent", async () => {
        const server = await startLocalServer({ v1Models: false, models: ["qwen3-embedding:8b"] })
        try {
            const probe = await probeLocal({ baseUrl: server.baseUrl })
            assert.equal(probe.source, "/api/tags")
            assert.equal(probe.models[0]?.sizeBytes, 1_000_000)
            assert.ok(holdsModel(probe, "qwen3-embedding:8b"))
        } finally {
            await server.close()
        }
    })

    test("sends the key when it has one, and reports a refusal by the call table", async () => {
        const server = await startLocalServer({ requireKey: "k1" })
        try {
            const refused = await probeLocal({ baseUrl: server.baseUrl }).then(
                () => undefined,
                (caught: unknown) => caught,
            )
            assert.ok(refused instanceof AiRouterError)
            assert.equal(refused.errorClass, "auth")
            assert.equal((await probeLocal({ baseUrl: server.baseUrl, apiKey: "k1" })).models.length, 2)
        } finally {
            await server.close()
        }
    })

    test("an endpoint that does not answer is a network failure, and one that answers late a timeout", async () => {
        const down = await probeLocal({ baseUrl: await closedBaseUrl() }).then(
            () => undefined,
            (caught: unknown) => caught,
        )
        assert.ok(down instanceof AiRouterError)
        assert.equal(down.errorClass, "network")
        assert.equal(down.retryable, true)
        const slow = await startLocalServer({ delayMs: 300 })
        try {
            const late = await probeLocal({ baseUrl: slow.baseUrl, timeoutMs: 50 }).then(
                () => undefined,
                (caught: unknown) => caught,
            )
            assert.ok(late instanceof AiRouterError)
            assert.equal(late.errorClass, "timeout")
        } finally {
            await slow.close()
        }
    })
})

describe("isolation of local and hosted providers", () => {
    const base = "http://127.0.0.1:1/v1"

    test("a profile of model names that mixes them is refused at load", () => {
        const config: PoolConfig = { providers: [local(base), hosted()], profiles: { mixed: { model: "m-chat", fallbacks: ["gpt-x"] } } }
        assert.throws(() => { validateConfig(config); }, /mixes a local provider with a hosted one|which both a local and a hosted provider serve/)
    })

    test("a name both kinds serve is refused unless the candidate names its provider", () => {
        const config: PoolConfig = { providers: [local(base), hosted()], profiles: { onlyName: { model: "m-chat" } } }
        assert.throws(() => { validateConfig(config); }, /which both a local and a hosted provider serve/)
        assert.doesNotThrow(() => { validateConfig({ providers: config.providers, profiles: { pinned: { candidates: [{ model: "m-chat", provider: "gpu" }] } } }); })
    })

    test("the defaults cannot be the bridge: a hosted default with a local fallback is refused", () => {
        const config: PoolConfig = { providers: [local(base), hosted()], defaults: { model: "gpt-x", fallbacks: ["m-embed"] } }
        assert.throws(() => { validateConfig(config); }, /defaults mixes a local provider with a hosted one/)
    })

    test("a profile that lists both with their providers is the explicit way, and a profile of one kind is fine", () => {
        const config: PoolConfig = {
            providers: [local(base), hosted()],
            profiles: {
                both: { candidates: [{ model: "m-chat", provider: "gpu" }, { model: "gpt-x", provider: "paid" }] },
                offline: { model: "m-chat", providers: ["gpu"] },
                paid: { model: "gpt-x" },
            },
        }
        assert.doesNotThrow(() => { validateConfig(config); })
    })

    test("a call cannot mix them by naming a model beside a profile's fallbacks", () => {
        const config: PoolConfig = { providers: [local(base), hosted()], profiles: { offline: { model: "m-embed", fallbacks: ["m-chat"], providers: ["gpu"] } } }
        validateConfig(config)
        // The call drops the provider restriction and brings a hosted model: the chain would cross.
        assert.throws(() => resolvePolicy(config, { profile: "offline", policy: { model: "gpt-x", providers: ["gpu", "paid"] } }, undefined), /both a local and a hosted provider serve|mixes a local provider/)
        assert.doesNotThrow(() => resolvePolicy(config, { profile: "offline" }, undefined))
    })

    test("a pool with no local provider is judged as before", () => {
        assert.doesNotThrow(() => { validateConfig({ providers: [hosted()], profiles: { p: { model: "gpt-x", fallbacks: ["m-chat"] } } }); })
    })

    test("a local-only call gets the longer deadline, a hosted call the usual one", () => {
        const config: PoolConfig = { providers: [local(base), hosted()] }
        assert.equal(resolvePolicy(config, { policy: { model: "m-embed" } }, undefined).deadlineMs, LOCAL_DEADLINE_MS)
        assert.equal(resolvePolicy(config, { policy: { model: "gpt-x" } }, undefined).deadlineMs, 120_000)
        assert.equal(resolvePolicy(config, { policy: { model: "m-embed", deadlineMs: 9000 } }, undefined).deadlineMs, 9000)
    })
})

describe("config of a local provider", () => {
    test("needs no keys, but a hosted provider still does", () => {
        assert.doesNotThrow(() => { validateConfig({ providers: [local("http://localhost:11434/v1")] }); })
        assert.throws(() => { validateConfig({ providers: [{ ...hosted(), keys: [] }] }); }, /has no keys/)
    })

    test("its base URL defaults to Ollama's", () => {
        assert.doesNotThrow(() => { validateConfig({ providers: [{ id: "gpu", kind: "local", keys: [], models: [chat] }] }); })
    })

    test("an optional key is refused on a hosted provider, truncate needs dimensions and embeddings", () => {
        assert.throws(() => { validateConfig({ providers: [{ ...hosted(), keys: [{ ref: "X", optional: true }] }] }); }, /optional, which only a local provider/)
        assert.throws(() => { validateConfig({ providers: [local("http://x/v1", { models: [{ id: "e", capabilities: ["embeddings"], truncate: "mrl" }] })] }); }, /declare them/)
        assert.throws(() => { validateConfig({ providers: [local("http://x/v1", { models: [{ id: "e", dimensions: 4, truncate: "mrl" }] })] }); }, /embeddings capability/)
        assert.throws(() => { validateConfig({ providers: [local("http://x/v1", { firstTokenTimeoutMs: 0 })] }); }, /firstTokenTimeoutMs/)
    })

    test("poolFromEnv keeps a local provider whose base URL is set, and leaves it out when it is not", () => {
        const spec = { providers: [{ kind: "local" as const, id: "gpu", models: [chat] }, { kind: "openai" as const, models: [{ id: "gpt-x" }] }] }
        const withUrl = poolFromEnv(spec, { OPENAI_API_KEY: "sk-1", LOCAL_AI_BASE_URL: "http://localhost:11434/v1" })
        assert.deepEqual(withUrl.providers.map((entry) => entry.id), ["gpu", "openai"])
        assert.deepEqual(withUrl.providers[0]?.keys, [])
        const without = poolFromEnv(spec, { OPENAI_API_KEY: "sk-1" })
        assert.deepEqual(without.providers.map((entry) => entry.id), ["openai"])
        assert.throws(() => poolFromEnv(spec, {}), /LOCAL_AI_BASE_URL, OPENAI_API_KEY/)
        const keyed = poolFromEnv(spec, { LOCAL_AI_API_KEY: "k", OPENAI_API_KEY: "sk-1" })
        assert.equal(keyed.providers[0]?.keys.length, 1)
    })
})
