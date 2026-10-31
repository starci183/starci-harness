import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider, PROVIDER_ERRORS } from "../src/fake.ts"
import { BLACKLISTED_RETRY_AFTER_S } from "../src/gateway/gateway.ts"
import { createRouter } from "../src/router.ts"
import { openSqliteStateStore, redisStateStore } from "../src/state-stores.ts"
import type { RedisLike } from "../src/state-stores.ts"
import { EMPTY_RECORD, parseHealthRecord, toHealthRecord } from "../src/store.ts"
import type { StateStore } from "../src/store.ts"
import type { PoolConfig, ProviderConfig, ProviderKind } from "../src/types.ts"
import { chatBody, errorOf, harness, http } from "./fixtures/gateway-helpers.ts"
import { ask, record } from "./helpers.ts"

/** A provider of a kind whose keys answer `sk-<id>-<alias>`, unless a secrets map overrides one. */
function kinded(kind: ProviderKind, aliases: readonly string[], secrets: Record<string, string> = {}, extra: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: kind,
        kind,
        ...(kind === "openai-compatible" ? { baseUrl: "https://local.test/v1" } : {}),
        keys: aliases.map((alias) => ({ alias, resolve: () => secrets[alias] ?? `sk-${kind}-${alias}` })),
        models: [{ id: "m1" }],
        ...extra,
    }
}

function pool(providers: readonly ProviderConfig[], extra: Partial<PoolConfig> = {}): { fake: ReturnType<typeof createFakeProvider>; config: PoolConfig } {
    const fake = createFakeProvider()
    return { fake, config: { providers, fetch: fake.fetch, random: () => 0.5, resilience: { backoff: { baseMs: 1, maxMs: 1 } }, ...extra } }
}

describe("a spent quota blacklists the key", () => {
    test("the next key serves at once, and the spent key is not sent again until its window ends", async () => {
        const { fake, config } = pool([kinded("openai", ["k1", "k2"])])
        const router = createRouter(config)
        const disabled = record(router, "key-disabled")
        fake.on({ key: "sk-openai-k1" }, PROVIDER_ERRORS.openai.quota_exhausted)
        const started = Date.now()
        const result = await router.chat(ask())
        assert.equal(result.routing.key, "k2")
        assert.equal(disabled.length, 1)
        assert.equal(disabled[0]?.reason, "quota")
        assert.equal(disabled[0].code, "insufficient_quota")
        // No window in the answer: the default TTL of 6 hours.
        assert.ok((disabled[0].until ?? 0) >= started + 6 * 3_600_000 - 1000)
        const before = fake.calls.length
        for (let index = 0; index < 4; index++) await router.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-openai-k2"))
        const health = (await router.health()).providers[0]?.keys[0]
        assert.equal(health?.disabled, true)
        assert.equal(health.disabledReason, "quota")
        assert.equal(health.disabledUntil, disabled[0].until)
    })

    test("a provider's window sets the until: Anthropic's spend cap lasts to the next UTC month", async () => {
        const { fake, config } = pool([kinded("anthropic", ["a1", "a2"])])
        const router = createRouter(config)
        const disabled = record(router, "key-disabled")
        fake.on({ key: "sk-anthropic-a1" }, PROVIDER_ERRORS.anthropic.spend_cap)
        await router.chat(ask())
        const now = new Date()
        assert.equal(disabled[0]?.until, Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        assert.equal(disabled[0].code, "enforced_spend_limit_reached")
    })

    test("quotaBlacklistMs sets the TTL, and Groq's daily request reset header beats it", async () => {
        const { fake, config } = pool([kinded("openai", ["k1", "k2"]), kinded("groq", ["g1", "g2"])], { resilience: { quotaBlacklistMs: 60_000, backoff: { baseMs: 1, maxMs: 1 } } })
        const router = createRouter(config)
        const disabled = record(router, "key-disabled")
        fake.on({ key: "sk-openai-k1" }, PROVIDER_ERRORS.openai.credit_exhausted)
        fake.on({ key: "sk-groq-g1" }, PROVIDER_ERRORS.groq.quota_exhausted)
        const started = Date.now()
        await router.chat(ask(), { policy: { providers: ["openai"] } })
        await router.chat(ask(), { policy: { providers: ["groq"] } })
        const [openai, groq] = disabled
        assert.ok(openai?.until !== undefined && openai.until !== null && openai.until >= started + 60_000 && openai.until < started + 70_000)
        // x-ratelimit-reset-requests: 2m59.56s
        assert.ok(groq?.until !== undefined && groq.until !== null && groq.until >= started + 179_000 && groq.until < started + 190_000)
    })

    test("OpenRouter's in-flight budget is a short wait, not a blacklist", async () => {
        const { fake, config } = pool([kinded("openrouter", ["o1", "o2"])])
        const router = createRouter(config)
        const disabled = record(router, "key-disabled")
        fake.on({ key: "sk-openrouter-o1" }, PROVIDER_ERRORS.openrouter.in_flight_budget, {})
        assert.equal((await router.chat(ask())).routing.key, "o2")
        assert.equal(disabled.length, 0)
        assert.ok(((await router.health()).providers[0]?.keys[0]?.models[0]?.cooldownUntil ?? 0) > Date.now())
    })

    test("a blacklist shorter than the deadline is waited out, and an expired one lets the key back in by itself", async () => {
        const { fake, config } = pool([kinded("openai", ["k1"])], { resilience: { quotaBlacklistMs: 20, backoff: { baseMs: 1, maxMs: 1 } } })
        const router = createRouter(config)
        fake.on({}, PROVIDER_ERRORS.openai.credit_exhausted, {})
        const started = Date.now()
        assert.equal((await router.chat(ask())).routing.key, "k1")
        assert.ok(Date.now() - started >= 15)
        assert.equal(fake.calls.length, 2)
    })
})

describe("a refused secret blacklists the key until the secret changes", () => {
    test("a new secret lifts the blacklist at once and says so on key-restored", async () => {
        const secrets: Record<string, string> = { k1: "sk-old" }
        const { fake, config } = pool([kinded("openai", ["k1", "k2"], secrets)])
        const router = createRouter(config)
        const restored = record(router, "key-restored")
        fake.on({ key: "sk-old" }, PROVIDER_ERRORS.openai.invalid_key)
        await router.chat(ask())
        const before = fake.calls.length
        for (let index = 0; index < 3; index++) await router.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-openai-k2"))
        secrets.k1 = "sk-new"
        const after = fake.calls.length
        await router.chat(ask())
        await router.chat(ask())
        assert.ok(fake.calls.slice(after).some((call) => call.key === "sk-new"))
        assert.deepEqual(restored, [{ type: "key-restored", provider: "openai", key: "k1", was: "auth", reason: "secret_changed" }])
    })

    test("a missing secret that is set later comes back; a spent quota lifts on a new secret too", async () => {
        const secrets: Record<string, string> = { k1: "", k2: "sk-spent" }
        const { fake, config } = pool([kinded("openai", ["k1", "k2", "k3"], secrets)])
        const router = createRouter(config)
        const restored = record(router, "key-restored")
        fake.on({ key: "sk-spent" }, PROVIDER_ERRORS.openai.quota_exhausted)
        await router.chat(ask())
        await router.chat(ask())
        const disabled = (await router.health()).providers[0]?.keys.map((key) => key.disabledReason)
        assert.deepEqual(disabled, ["missing", "quota", null])
        secrets.k1 = "sk-now-set"
        secrets.k2 = "sk-topped-up"
        await router.chat(ask())
        assert.deepEqual(restored.map((event) => [event.key, event.was]).sort(), [["k1", "missing"], ["k2", "quota"]])
    })

    test("the record keeps a fingerprint of the refused secret, never the secret", async () => {
        const records = new Map<string, unknown>()
        const store: StateStore = {
            get: (key) => toHealthRecord(records.get(key)),
            set: (key, value) => {
                records.set(key, value)
            },
            delete: (key) => {
                records.delete(key)
            },
            keys: (prefix) => [...records.keys()].filter((key) => key.startsWith(prefix)),
            lease: () => true,
            release: () => undefined,
        }
        const { fake, config } = pool([kinded("openai", ["k1", "k2"], { k1: "sk-very-secret-value" })], { store })
        const router = createRouter(config)
        fake.on({ key: "sk-very-secret-value" }, PROVIDER_ERRORS.openai.invalid_key)
        await router.chat(ask())
        const text = JSON.stringify([...records.values()])
        assert.ok(!text.includes("sk-very-secret-value"))
        assert.match(text, /"fingerprint":"[0-9a-f]{16}"/)
    })
})

describe("every key blacklisted", () => {
    test("the router fails at once with class quota and the earliest return as retryAt", async () => {
        const { fake, config } = pool([kinded("openai", ["k1", "k2"])], { resilience: { quotaBlacklistMs: 600_000, backoff: { baseMs: 1, maxMs: 1 } } })
        const router = createRouter(config)
        fake.on({}, PROVIDER_ERRORS.openai.credit_exhausted)
        await assert.rejects(router.chat(ask()), (error: unknown) => error instanceof AiRouterError && error.errorClass === "quota")
        const sent = fake.calls.length
        await assert.rejects(router.chat(ask()), (error: unknown) => {
            assert.ok(error instanceof AiRouterError)
            assert.equal(error.errorClass, "quota")
            assert.match(error.message, /blacklisted.*openai\/k1, openai\/k2/)
            assert.ok(error.retryAt !== undefined && error.retryAt > Date.now() + 500_000)
            return true
        })
        assert.equal(fake.calls.length, sent, "nothing is sent to a blacklisted key")
    })

    test("the gateway answers 503 pool_quota_exhausted with Retry-After, and 503 pool_auth_failed when every secret is refused", async () => {
        const h = await harness()
        const key = await h.key()
        h.fake.on({}, PROVIDER_ERRORS.openai.credit_exhausted)
        await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        const quota = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        assert.equal(quota.status, 503)
        assert.equal(errorOf(quota).code, "pool_quota_exhausted")
        assert.ok(Number(quota.headers.get("retry-after")) > 6 * 3600 - 60)
        assert.ok(!quota.text.includes("sk-upstream"))
        await h.router.reset()
        h.fake.reset()
        h.fake.on({}, PROVIDER_ERRORS.openai.invalid_key)
        const auth = await http(h.url, "/v1/chat/completions", { key, body: chatBody("lesson") })
        assert.equal(auth.status, 503)
        assert.equal(errorOf(auth).code, "pool_auth_failed")
        assert.equal(auth.headers.get("retry-after"), String(BLACKLISTED_RETRY_AFTER_S))
        await h.close()
    })
})

describe("the blacklist survives a restart in a durable state store", () => {
    test("a new router over the same SQLite file sends nothing to the dead key", async () => {
        const dir = mkdtempSync(join(tmpdir(), "ai-router-state-"))
        const path = join(dir, "state.sqlite")
        try {
            const first = await openSqliteStateStore(path)
            const one = pool([kinded("openai", ["k1", "k2"])], { store: first })
            one.fake.on({ key: "sk-openai-k1" }, PROVIDER_ERRORS.openai.quota_exhausted)
            await createRouter(one.config).chat(ask())
            first.close()
            const second = await openSqliteStateStore(path)
            const two = pool([kinded("openai", ["k1", "k2"])], { store: second })
            const router = createRouter(two.config)
            for (let index = 0; index < 3; index++) await router.chat(ask())
            assert.ok(two.fake.calls.every((call) => call.key === "sk-openai-k2"))
            assert.equal((await router.health()).providers[0]?.keys[0]?.disabledReason, "quota")
            await router.reset({ provider: "openai", key: "k1" })
            assert.deepEqual(second.keys("ai-router:key:openai/k1"), [])
            second.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test("the SQLite store leases atomically, scans prefixes literally and reads old or broken records safely", async () => {
        const store = await openSqliteStateStore(":memory:")
        assert.equal(store.lease("p", 1000), true)
        assert.equal(store.lease("p", 1000), false)
        store.release("p")
        assert.equal(store.lease("p", 1), true)
        await new Promise((resolve) => setTimeout(resolve, 5))
        assert.equal(store.lease("p", 1000), true)
        store.set("a_%:x", EMPTY_RECORD)
        store.set("abc", { ...EMPTY_RECORD, failures: 2 })
        assert.deepEqual(store.keys("a_%"), ["a_%:x"])
        assert.equal(store.get("abc")?.failures, 2)
        store.delete("abc")
        assert.equal(store.get("abc"), undefined)
        store.close()
        assert.equal(parseHealthRecord("not json"), undefined)
        assert.equal(parseHealthRecord(null), undefined)
        assert.equal(toHealthRecord([1]), undefined)
        assert.deepEqual(toHealthRecord({ breaker: "open", disabledReason: "nonsense", failures: "x" }), { ...EMPTY_RECORD, breaker: "open" })
    })

    test("the Redis adapter keeps records as JSON and leases with SET NX PX", async () => {
        const data = new Map<string, { value: string; expires: number }>()
        const client: RedisLike = {
            get: (key) => Promise.resolve(data.get(key)?.value ?? null),
            set: (key, value) => {
                data.set(key, { value, expires: Infinity })
                return Promise.resolve("OK")
            },
            setIfAbsent: (key, value, ttlMs) => {
                const held = data.get(key)
                if (held !== undefined && held.expires > Date.now()) return Promise.resolve(false)
                data.set(key, { value, expires: Date.now() + ttlMs })
                return Promise.resolve(true)
            },
            del: (key) => Promise.resolve(data.delete(key)),
            keys: (pattern) => {
                const literal = pattern.slice(0, -1).replace(/\\(.)/g, "$1")
                return Promise.resolve([...data.keys()].filter((key) => key.startsWith(literal)))
            },
        }
        const store = redisStateStore(client)
        const { fake, config } = pool([kinded("openai", ["k1", "k2"])], { store })
        const router = createRouter(config)
        fake.on({ key: "sk-openai-k1" }, PROVIDER_ERRORS.openai.invalid_key)
        await router.chat(ask())
        assert.ok(data.has("state:ai-router:key:openai/k1"))
        assert.equal((await store.get("ai-router:key:openai/k1"))?.disabledReason, "auth")
        assert.deepEqual(await store.keys("ai-router:key:"), ["ai-router:key:openai/k1"])
        assert.equal(await store.lease("x", 1000), true)
        assert.equal(await store.lease("x", 1000), false)
        await store.release("x")
        assert.equal(await store.lease("x", 1000), true)
        await store.delete("ai-router:key:openai/k1")
        assert.equal(await store.get("ai-router:key:openai/k1"), undefined)
    })

    test("a record an older version stored, without the new fields, reads as enabled", async () => {
        const legacy = { breaker: "closed", failures: 0, openUntil: 0, cooldownMs: 0, disabledUntil: 0, disabledReason: null, remainingRequests: null, requestsResetAt: 0, remainingTokens: null, tokensResetAt: 0, cooldownUntil: 0 }
        const records = new Map<string, unknown>([["ai-router:key:openai/k1", legacy]])
        const store: StateStore = {
            get: (key) => {
                const value = records.get(key)
                return value === undefined ? undefined : { ...EMPTY_RECORD, ...toHealthRecord(value) }
            },
            set: (key, value) => {
                records.set(key, value)
            },
            delete: (key) => {
                records.delete(key)
            },
            keys: () => [],
            lease: () => true,
            release: () => undefined,
        }
        const { config } = pool([kinded("openai", ["k1"])], { store })
        assert.equal((await createRouter(config).chat(ask())).routing.key, "k1")
    })
})

describe("provider budgets", () => {
    test("a provider past its daily budget is no candidate; the call moves to another provider, then fails as quota", async () => {
        const priced = { models: [{ id: "m1", cost: { input: 1_000_000, output: 0 } }] }
        const { fake, config } = pool([kinded("openai", ["k1"], {}, { ...priced, budget: { costPerDay: 15 } }), kinded("deepseek", ["d1"], {}, { ...priced, budget: { costPerMonth: 10 } })])
        const router = createRouter(config)
        fake.on({}, { usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 } })
        const providers: string[] = []
        // Ten a call: openai spends 10 then 20 (past 15 a day), deepseek 10 (at its 10 a month).
        for (let index = 0; index < 3; index++) providers.push((await router.chat(ask())).routing.provider)
        assert.deepEqual(providers.sort(), ["deepseek", "openai", "openai"])
        const health = await router.health()
        assert.deepEqual(health.providers.map((entry) => entry.spend), [{ day: 20, month: 20 }, { day: 10, month: 10 }])
        await assert.rejects(router.chat(ask()), (error: unknown) => error instanceof AiRouterError && error.errorClass === "quota" && error.message.includes("budget of openai, deepseek") && error.retryAt !== undefined)
    })
})
