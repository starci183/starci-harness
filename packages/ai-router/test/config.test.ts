import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { validateConfig } from "../src/config.ts"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import { createRouter } from "../src/router.ts"
import type { PoolConfig, ProviderConfig } from "../src/types.ts"
import { ask, provider, setup, standardProviders } from "./helpers.ts"

function refuses(config: PoolConfig, pattern: RegExp): void {
    assert.throws(
        () => {
            validateConfig(config)
        },
        (error: unknown) => error instanceof AiRouterError && error.errorClass === "config" && pattern.test(error.message),
    )
}

describe("pool validation", () => {
    const one = (extra: Partial<ProviderConfig> = {}): ProviderConfig => provider("a", ["k1"], [{ id: "m1" }], extra)

    test("refuses a pool that cannot route", () => {
        refuses({ providers: [] }, /no providers/)
        refuses({ providers: [one(), one()] }, /declared twice/)
        refuses({ providers: [one({ id: "a/b" })] }, /without "\/"/)
        refuses({ providers: [one({ baseUrl: "not a url" })] }, /invalid baseUrl/)
        refuses({ providers: [one({ baseUrl: "ftp://x.test" })] }, /http or https/)
        refuses({ providers: [one({ keys: [] })] }, /no keys/)
        refuses({ providers: [one({ models: [] })] }, /no models/)
        refuses({ providers: [one({ weight: 0 })] }, /weight must be a positive number/)
        refuses({ providers: [one({ models: [{ id: "m1" }, { id: "m1" }] })] }, /declares model "m1" twice/)
        refuses({ providers: [one({ models: [{ id: "" }] })] }, /empty id/)
        refuses({ providers: [one({ models: [{ id: "m", contextWindow: -1 }] })] }, /contextWindow/)
        refuses({ providers: [one({ keys: [{ alias: "", env: "X" }] })] }, /key alias/)
        refuses({ providers: [one({ keys: [{ alias: "k", env: "X" }, { alias: "k", env: "Y" }] })] }, /declares key "k" twice/)
        refuses({ providers: [one({ keys: [{ alias: "k", env: "X", resolve: () => "v" }] })] }, /exactly one of env or resolve/)
        refuses({ providers: [one({ keys: [{ alias: "k", env: "X", maxConcurrency: 0 }] })] }, /maxConcurrency/)
        refuses({ providers: [one()], defaults: { model: "nope" } }, /no provider serves/)
        refuses({ providers: [one()], profiles: { p: { fallbacks: ["nope"] } } }, /profile "p" names model "nope"/)
        refuses({ providers: [one()], profiles: { p: { providers: ["zz"] } } }, /provider "zz"/)
        refuses({ providers: [one()], defaults: { maxAttempts: 0 } }, /maxAttempts/)
    })

    test("createRouter validates at once", () => {
        assert.throws(() => createRouter({ providers: [] }), AiRouterError)
    })

    test("a call refuses an unknown model, profile or policy", async () => {
        const { router } = setup()
        await assert.rejects(router.chat(ask("x", "nope")), /not served by any provider/)
        await assert.rejects(router.chat({ messages: [{ role: "user", content: "x" }] }), /no model/)
        await assert.rejects(router.chat(ask(), { profile: "missing" }), /profile "missing" is not configured/)
        await assert.rejects(router.chat(ask(), { policy: { fallbacks: ["nope"] } }), /policy names model "nope"/)
        assert.throws(() => router.stream(ask("x", "nope")), /not served/)
    })
})

describe("policies", () => {
    test("the policy model beats the profile, the profile beats the request, the request beats the defaults", async () => {
        const fake = createFakeProvider()
        const router = createRouter({
            providers: [provider("a", ["k1"], [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }])],
            fetch: fake.fetch,
            defaults: { model: "m4" },
            profiles: { p: { model: "m2" } },
        })
        assert.equal((await router.chat(ask("x", "m1"), { profile: "p", policy: { model: "m3" } })).routing.model, "m3")
        assert.equal((await router.chat(ask("x", "m1"), { profile: "p" })).routing.model, "m2")
        assert.equal((await router.chat(ask("x", "m1"))).routing.model, "m1")
        assert.equal((await router.chat({ messages: [{ role: "user", content: "x" }] })).routing.model, "m4")
    })

    test("an alias reaches every provider that names the model so", async () => {
        const { router, fake } = setup()
        const result = await router.chat(ask("x", "fast"))
        assert.equal(result.routing.model, "m1")
        assert.equal(fake.calls[0]?.model, "m1")
    })

    test("providers restricts the candidates", async () => {
        const { router } = setup()
        for (let index = 0; index < 4; index++) {
            assert.equal((await router.chat(ask(), { policy: { providers: ["b"] } })).routing.provider, "b")
        }
    })
})

describe("the spec pools", () => {
    test("the standard providers are valid", () => {
        validateConfig({ providers: standardProviders() })
    })
})

describe("the catalog", () => {
    test("lists the defaults, every profile with its resolved model and fallbacks, and each model id once", () => {
        const { router } = setup(standardProviders(), {
            defaults: { model: "m1", fallbacks: ["m2"] },
            profiles: { quick: { model: "fast" }, pinned: { model: "m2", allowFallback: false } },
        })
        const catalog = router.catalog()
        assert.deepEqual(catalog.defaults, { model: "m1", fallbacks: ["m2"] })
        assert.deepEqual(catalog.profiles, [
            { name: "quick", model: "fast", fallbacks: ["m2"], pinned: false, serves: ["chat"] },
            { name: "pinned", model: "m2", fallbacks: [], pinned: false, serves: ["chat"] },
        ])
        assert.deepEqual(
            catalog.models.map((model) => [model.id, model.aliases, model.providers]),
            [
                ["m1", ["fast"], ["a", "b"]],
                ["m2", [], ["a"]],
            ],
        )
        assert.deepEqual(setup(standardProviders()).router.catalog().defaults, { fallbacks: [] })
    })
})
