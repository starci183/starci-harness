import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, test } from "node:test"
import { keysFromEnv, poolFromEnv, providersFromEnv, virtualKeyFromEnv } from "../src/env.ts"
import type { EnvPoolSpec } from "../src/env.ts"
import { createFakeProvider, PROVIDER_ERRORS } from "../src/fake.ts"
import { parseGatewayConfig } from "../src/gateway/config-file.ts"
import { serveGateway } from "../src/gateway/serve.ts"
import { createRouter } from "../src/router.ts"
import { resolveSecret } from "../src/secrets.ts"
import type { KeyConfig } from "../src/types.ts"
import { ask } from "./helpers.ts"

async function secrets(keys: readonly KeyConfig[]): Promise<(string | undefined)[]> {
    return Promise.all(keys.map((key) => resolveSecret(key)))
}

describe("keys from env", () => {
    test("P_API_KEY, P_API_KEY_<n>, their _FILE twins and the P_API_KEYS list, in order, as references", async () => {
        const dir = mkdtempSync(join(tmpdir(), "ai-router-env-"))
        try {
            const file = join(dir, "key3")
            writeFileSync(file, "sk-from-file\nignored second line\n")
            const env: Record<string, string> = { OPENROUTER_API_KEY: "sk-1", OPENROUTER_API_KEY_9: "sk-9", OPENROUTER_API_KEY_2: " sk-2 ", OPENROUTER_API_KEY_3_FILE: file, OPENROUTER_API_KEY_4: "  ", OPENROUTER_API_KEYS: "sk-a, sk-b\nsk-c", OPENAI_API_KEY: "other" }
            const keys = keysFromEnv("OPENROUTER", "openrouter", env, 4)
            assert.deepEqual(keys.map((key) => key.alias), ["openrouter-1", "openrouter-2", "openrouter-3", "openrouter-9", "openrouter-list-1", "openrouter-list-2", "openrouter-list-3"])
            assert.ok(keys.every((key) => key.maxConcurrency === 4 && "resolve" in key))
            assert.deepEqual(await secrets(keys), ["sk-1", "sk-2", "sk-from-file", "sk-9", "sk-a", "sk-b", "sk-c"])
            // A rotated variable is read at the next attempt.
            env.OPENROUTER_API_KEY = "sk-rotated"
            assert.equal(await resolveSecret(keys[0] ?? { alias: "x", env: "X" }), "sk-rotated")
            rmSync(file)
            assert.equal(await resolveSecret(keys[2] ?? { alias: "x", env: "X" }), undefined)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test("refuses a key set twice, a _1 suffix and a bad prefix", () => {
        assert.throws(() => keysFromEnv("GROQ", "groq", { GROQ_API_KEY_2: "a", GROQ_API_KEY_2_FILE: "/x" }), /both as a variable and as a _FILE/)
        assert.throws(() => keysFromEnv("GROQ", "groq", { GROQ_API_KEY_1: "a" }), /number keys from 2/)
        assert.throws(() => providersFromEnv([{ kind: "openai-compatible", envPrefix: "local", id: "x", models: [{ id: "m" }] }], {}), /upper-case/)
        assert.throws(() => providersFromEnv([{ kind: "openai-compatible", models: [{ id: "m" }] }], {}), /needs envPrefix/)
        assert.throws(() => providersFromEnv([{ kind: "openai-compatible", envPrefix: "OLLAMA", models: [{ id: "m" }] }], { OLLAMA_API_KEY: "x" }), /needs an id/)
    })
})

describe("a pool from env", () => {
    const spec: EnvPoolSpec<"work" | "embed"> = {
        providers: [
            { kind: "anthropic", models: [{ id: "claude-sonnet-5-5" }], defaultMaxTokens: 2048 },
            { kind: "openrouter", models: [{ id: "anthropic/claude-sonnet-5-5" }, { id: "openai/text-embedding-3-small", identity: "text-embedding-3-small", capabilities: ["embeddings"] }], headers: { "X-Title": "app" }, weight: 2, maxConcurrency: 8, budget: { costPerDay: 5 } },
            { kind: "qwen", models: [{ id: "qwen3.8-max" }] },
            { kind: "openai", models: [{ id: "text-embedding-3-small", capabilities: ["embeddings"] }] },
            { kind: "openai-compatible", id: "ollama", envPrefix: "OLLAMA", baseUrl: "http://127.0.0.1:11434/v1", models: [{ id: "llama3" }] },
        ],
        defaults: { model: "claude-sonnet-5-5", fallbacks: ["qwen3.8-max"] },
        profiles: {
            work: { candidates: [[{ provider: "anthropic", model: "claude-sonnet-5-5" }, { provider: "openrouter", model: "anthropic/claude-sonnet-5-5" }], { model: "qwen3.8-max" }] },
            embed: { pinned: true, candidates: [[{ model: "text-embedding-3-small" }, { model: "openai/text-embedding-3-small" }]] },
        },
    }

    test("keeps the providers that have keys, under their canonical prefixes, with the base URL from env", () => {
        const providers = providersFromEnv(spec.providers, { ANTHROPIC_API_KEY: "a", DASHSCOPE_API_KEY_2: "q", DASHSCOPE_BASE_URL: "https://ws.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", OLLAMA_API_KEY: "local" })
        assert.deepEqual(providers.map((provider) => [provider.id, provider.kind, provider.keys.map((key) => key.alias)]), [["anthropic", "anthropic", ["anthropic-1"]], ["qwen", "qwen", ["qwen-2"]], ["ollama", "openai-compatible", ["ollama-1"]]])
        assert.equal(providers[0]?.defaultMaxTokens, 2048)
        assert.equal(providers[1]?.baseUrl, "https://ws.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")
        assert.equal(providers[2]?.baseUrl, "http://127.0.0.1:11434/v1")
        const full = providersFromEnv(spec.providers, { OPENROUTER_API_KEY: "o" })[0]
        assert.deepEqual([full?.headers, full?.weight, full?.maxConcurrency, full?.budget], [{ "X-Title": "app" }, 2, 8, { costPerDay: 5 }])
    })

    test("cuts every profile down to the candidates the present providers serve, and routes", async () => {
        const fake = createFakeProvider()
        const pool = poolFromEnv(spec, { OPENROUTER_API_KEY: "sk-or", OPENROUTER_API_KEY_2: "sk-or-2" })
        assert.deepEqual(pool.profiles?.work.candidates, [[{ provider: "openrouter", model: "anthropic/claude-sonnet-5-5" }]])
        assert.deepEqual(pool.profiles.embed.candidates, [[{ model: "openai/text-embedding-3-small" }]])
        assert.equal(pool.defaults, undefined, "a default whose model and fallbacks have no key is dropped")
        const router = createRouter({ ...pool, fetch: fake.fetch })
        assert.equal((await router.chat(ask(), { profile: "work" })).routing.key, "openrouter-1")
        fake.on({ key: "sk-or" }, PROVIDER_ERRORS.openrouter.quota_exhausted)
        await router.embeddings({ input: "a" }, { profile: "embed" })
        assert.equal((await router.embeddings({ input: "a" }, { profile: "embed" })).routing.key, "openrouter-2")
    })

    test("a default whose model has no key leads with its first served fallback", () => {
        const pool = poolFromEnv(spec, { DASHSCOPE_API_KEY: "q", OPENAI_API_KEY: "e" })
        assert.deepEqual(pool.defaults, { model: "qwen3.8-max", fallbacks: [] })
        assert.deepEqual(pool.profiles?.work.candidates, [{ model: "qwen3.8-max" }])
        assert.deepEqual(poolFromEnv({ providers: spec.providers, defaults: { model: "qwen3.8-max", fallbacks: ["llama3", "claude-sonnet-5-5"] } }, { DASHSCOPE_API_KEY: "q", OLLAMA_API_KEY: "l" }).defaults, { model: "qwen3.8-max", fallbacks: ["llama3"] })
        assert.equal(poolFromEnv({ providers: spec.providers }, { OLLAMA_API_KEY: "l" }).profiles, undefined)
    })

    test("refuses a pool with no key at all, and a profile left with no candidate, naming the variables", () => {
        assert.throws(() => poolFromEnv(spec, {}), /set one of ANTHROPIC_API_KEY, OPENROUTER_API_KEY, DASHSCOPE_API_KEY, OPENAI_API_KEY, OLLAMA_API_KEY/)
        assert.throws(() => poolFromEnv(spec, { ANTHROPIC_API_KEY: "a" }), /profile "embed" has no candidate/)
        assert.throws(() => poolFromEnv({ providers: spec.providers, profiles: { p: { model: "text-embedding-3-small", pinned: true, fallbacks: ["llama3"] } } }, { OLLAMA_API_KEY: "l" }), /profile "p" has no candidate/)
    })
})

describe("the app's virtual key from env", () => {
    test("reads STARCI_AI_KEY, else its _FILE twin, bound to work and embed by default", async () => {
        const secret = "sk-starci-app-0123456789abcdef0123456789abcdef"
        assert.deepEqual(await virtualKeyFromEnv({ label: "app" }, { STARCI_AI_KEY: ` ${secret} ` }), { label: "app", secret, profiles: ["work", "embed"], models: [] })
        const dir = mkdtempSync(join(tmpdir(), "ai-router-vk-"))
        try {
            const file = join(dir, "key")
            writeFileSync(file, `${secret}\n`)
            const mounted = await virtualKeyFromEnv({ label: "app", variable: "APP_AI_KEY", profiles: ["work"], models: ["deepseek-v4-pro"], quota: { costPerMonth: 20 }, owner: "app" }, { APP_AI_KEY_FILE: file })
            assert.deepEqual(mounted, { label: "app", secret, profiles: ["work"], models: ["deepseek-v4-pro"], quota: { costPerMonth: 20 }, owner: "app" })
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
        await assert.rejects(virtualKeyFromEnv({ label: "app" }, {}), /STARCI_AI_KEY \(or STARCI_AI_KEY_FILE\) is not set/)
        await assert.rejects(virtualKeyFromEnv({ label: "app" }, { STARCI_AI_KEY_FILE: join(tmpdir(), "missing-ai-router-key") }), /is not set/)
    })
})

describe("the config file", () => {
    test("takes provider kinds, keys from env, candidates, pinned profiles and a state store", () => {
        const file = parseGatewayConfig(
            {
                stateStore: { type: "sqlite", path: "state.sqlite" },
                providers: [
                    { id: "anthropic", kind: "anthropic", keysFromEnv: "ANTHROPIC", models: [{ id: "claude-sonnet-5-5" }], defaultMaxTokens: 1000, budget: { costPerMonth: 50 } },
                    { id: "openai", kind: "openai", keys: [{ alias: "main", env: "OPENAI_KEY" }], models: [{ id: "text-embedding-3-small", identity: "te3s", dimensions: 1536, capabilities: ["embeddings"] }] },
                ],
                profiles: { work: { candidates: [[{ provider: "anthropic", model: "claude-sonnet-5-5", weight: 2 }], { model: "claude-sonnet-5-5" }] }, embed: { pinned: true, model: "text-embedding-3-small" } },
                resilience: { quotaBlacklistMs: 3_600_000 },
            },
            "/srv/ai",
            { ANTHROPIC_API_KEY: "a", ANTHROPIC_API_KEY_2: "b" },
        )
        assert.deepEqual(file.stateStore, { type: "sqlite", path: resolve("/srv/ai", "state.sqlite") })
        assert.deepEqual(file.pool.providers[0]?.keys.map((key) => key.alias), ["anthropic-1", "anthropic-2"])
        assert.equal("keysFromEnv" in file.pool.providers[0], false)
        const router = createRouter(file.pool)
        assert.equal(router.catalog().profiles.find((profile) => profile.name === "embed")?.pinned, true)
        assert.deepEqual(parseGatewayConfig({ providers: [{ id: "x", baseUrl: "https://x.test", keys: [{ alias: "k", env: "K" }], models: [{ id: "m" }] }], stateStore: { type: "memory" } }).stateStore, { type: "memory" })
    })

    test("refuses a provider without keys, a bad kind, a bad candidate and a sqlite state store without a path", () => {
        const one = (provider: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({ providers: [{ id: "x", baseUrl: "https://x.test", models: [{ id: "m" }], ...provider }], ...extra })
        assert.throws(() => parseGatewayConfig(one({})), /needs keys or keysFromEnv/)
        assert.throws(() => parseGatewayConfig(one({ kind: "mystery", keys: [{ alias: "k", env: "K" }] })), /must be one of/)
        assert.throws(() => parseGatewayConfig(one({ keys: [{ alias: "k", env: "K" }] }, { profiles: { p: { candidates: [{ provider: "x" }] } } })), /model is required/)
        assert.throws(() => parseGatewayConfig(one({ keys: [{ alias: "k", env: "K" }] }, { stateStore: { type: "sqlite" } })), /stateStore.path is required/)
    })

    test("serve opens the SQLite state store, so a blacklist outlives the process", async () => {
        const dir = mkdtempSync(join(tmpdir(), "ai-router-serve-"))
        try {
            const config = join(dir, "pool.json")
            writeFileSync(
                config,
                JSON.stringify({
                    stateStore: { type: "sqlite", path: "state.sqlite" },
                    gateway: { keyStore: { type: "memory" } },
                    providers: [{ id: "openai", kind: "openai", keysFromEnv: "OPENAI", models: [{ id: "m1" }] }],
                }),
            )
            const env = { OPENAI_API_KEY: "sk-one", OPENAI_API_KEY_2: "sk-two" }
            const fake = createFakeProvider()
            fake.on({ key: "sk-one" }, PROVIDER_ERRORS.openai.quota_exhausted)
            const first = await serveGateway({ config, port: 0, env, fetch: fake.fetch })
            const router = first.gateway
            const key = await router.admin.create({ label: "t", models: ["*"] })
            await fetch(`${first.url}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "m1", messages: [{ role: "user", content: "hi" }] }) })
            await first.close()
            const second = await serveGateway({ config, port: 0, env, fetch: fake.fetch })
            const again = await second.gateway.admin.create({ label: "t", models: ["*"] })
            const before = fake.calls.length
            const reply = await fetch(`${second.url}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${again.secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "m1", messages: [{ role: "user", content: "hi" }] }) })
            assert.equal(reply.status, 200)
            assert.deepEqual(fake.calls.slice(before).map((call) => call.key), ["sk-two"])
            await second.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
