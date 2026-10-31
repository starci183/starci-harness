import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider } from "../src/fake.ts"
import { ask, provider, record, setup, sleep } from "./helpers.ts"

function routerError(errorClass: string): (error: unknown) => boolean {
    return (error: unknown) => {
        assert.ok(error instanceof AiRouterError, "an AiRouterError")
        assert.equal(error.errorClass, errorClass)
        return true
    }
}

const oneProvider = (aliases: readonly string[] = ["k1", "k2"]): ReturnType<typeof provider>[] => [provider("a", aliases, [{ id: "m1" }, { id: "m2" }])]

describe("retries", () => {
    test("a transient failure retries on a different key with the same request id", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { status: 503 })
        const attempts = record(router, "attempt")
        const result = await router.chat(ask(), { requestId: "req-1" })
        assert.deepEqual(fake.calls.map((call) => call.key), ["sk-a-k1", "sk-a-k2"])
        assert.equal(result.routing.attempts, 2)
        assert.equal(result.routing.key, "k2")
        assert.deepEqual(attempts.map((event) => [event.outcome, event.errorClass, event.status]), [["failure", "transient", 503], ["success", undefined, undefined]])
        for (const call of fake.calls) {
            assert.equal(call.headers["x-request-id"], "req-1")
            assert.equal(call.headers["idempotency-key"], "req-1")
        }
    })

    test("a network failure and a body that is not JSON are transient", async () => {
        const { router, fake } = setup(oneProvider(["k1", "k2", "k3"]))
        fake.on({ key: "sk-a-k1" }, { error: "network" })
        fake.on({ key: "sk-a-k2" }, { body: "not an object" })
        const attempts = record(router, "attempt")
        const result = await router.chat(ask())
        assert.equal(result.routing.key, "k3")
        assert.deepEqual(attempts.map((event) => event.errorClass), ["network", "transient", undefined])
    })

    test("an error object inside a 200 body is classified", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { body: { error: { message: "slow down", type: "rate_limit_exceeded" } } })
        const attempts = record(router, "attempt")
        await router.chat(ask())
        assert.equal(attempts[0]?.errorClass, "rate_limit")
    })

    test("a 400 is not retried", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({}, { status: 400 })
        await assert.rejects(router.chat(ask()), (error: unknown) => {
            routerError("invalid_request")(error)
            assert.ok(error instanceof AiRouterError && error.status === 400 && !error.retryable && error.message.includes('fake 400'))
            return true
        })
        assert.equal(fake.calls.length, 1)
    })

    test("maxAttempts bounds the retries and the error lists every attempt", async () => {
        const { router, fake } = setup(oneProvider(["k1", "k2", "k3"]))
        fake.on({}, { status: 500 })
        await assert.rejects(router.chat(ask(), { policy: { maxAttempts: 2 } }), (error: unknown) => {
            routerError("transient")(error)
            assert.ok(error instanceof AiRouterError)
            assert.deepEqual(error.attempts.map((attempt) => attempt.key), ["k1", "k2"])
            return true
        })
        assert.equal(fake.calls.length, 2)
        assert.deepEqual(router.stats().failed, 1)
    })

    test("transient failures back off with jitter; rate and auth failures do not", async () => {
        const slow = setup(oneProvider(["k1", "k2", "k3"]), { resilience: { backoff: { baseMs: 40, factor: 2, maxMs: 1000 } } })
        slow.fake.on({ key: "sk-a-k1" }, { status: 500 })
        slow.fake.on({ key: "sk-a-k2" }, { status: 500 })
        let started = Date.now()
        await slow.router.chat(ask())
        // random() is 0.5, so each delay is 0.75 of 40 then 80 ms.
        assert.ok(Date.now() - started >= 85, `backed off ${String(Date.now() - started)} ms`)
        const quick = setup(oneProvider(["k1", "k2", "k3"]), { resilience: { backoff: { baseMs: 400, maxMs: 1000 } } })
        quick.fake.on({ key: "sk-a-k1" }, { status: 429 })
        quick.fake.on({ key: "sk-a-k2" }, { status: 401 })
        started = Date.now()
        await quick.router.chat(ask())
        assert.ok(Date.now() - started < 300)
    })
})

describe("keys", () => {
    test("a 401 disables the key until reset", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { status: 401 }, {})
        const disabled = record(router, "key-disabled")
        await router.chat(ask())
        assert.deepEqual(disabled, [{ type: "key-disabled", provider: "a", key: "k1", reason: "auth", until: null, code: "fake_error" }])
        const before = fake.calls.length
        for (let index = 0; index < 4; index++) await router.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-a-k2"))
        const health = await router.health()
        const k1 = health.providers[0]?.keys[0]
        assert.equal(k1?.disabled, true)
        assert.equal(k1.disabledReason, "auth")
        await router.reset({ provider: "a", key: "k1" })
        const after = fake.calls.length
        await router.chat(ask())
        await router.chat(ask())
        assert.ok(fake.calls.slice(after).some((call) => call.key === "sk-a-k1"))
    })

    test("authDisableMs re-enables a key after its time", async () => {
        const { router, fake } = setup(oneProvider(), { resilience: { authDisableMs: 30 } })
        fake.on({ key: "sk-a-k1" }, { status: 403 }, {})
        const disabled = record(router, "key-disabled")
        await router.chat(ask())
        assert.equal(typeof disabled[0]?.until, "number")
        await sleep(40)
        assert.equal((await router.health()).providers[0]?.keys[0]?.disabled, false)
    })

    test("a key whose env var is unset is disabled as missing and never sent", async () => {
        const fake = createFakeProvider()
        const { router } = setup([{ ...provider("a", ["k2"], [{ id: "m1" }]), keys: [{ alias: "k1", env: "AI_ROUTER_UNSET_FOR_TEST" }, { alias: "k2", resolve: () => " sk-a-k2 " }] }], { fetch: fake.fetch })
        const disabled = record(router, "key-disabled")
        const result = await router.chat(ask())
        assert.equal(result.routing.key, "k2")
        assert.equal(disabled[0]?.reason, "missing")
        assert.deepEqual(fake.calls.map((call) => call.key), ["sk-a-k2"])
    })

    test("a resolver that throws disables its key as missing", async () => {
        const { router } = setup([
            {
                ...provider("a", [], [{ id: "m1" }]),
                keys: [
                    {
                        alias: "vault",
                        resolve: () => Promise.reject(new Error("vault down")),
                    },
                    { alias: "k2", resolve: () => "sk-a-k2" },
                ],
            },
        ])
        const disabled = record(router, "key-disabled")
        assert.equal((await router.chat(ask())).routing.key, "k2")
        assert.equal(disabled[0]?.key, "vault")
        assert.equal(disabled[0].reason, "missing")
    })

    test("an env key is read at each attempt", async () => {
        const fake = createFakeProvider()
        process.env.AI_ROUTER_TEST_ENV_KEY = "sk-from-env"
        const { router } = setup([{ ...provider("a", [], [{ id: "m1" }]), keys: [{ alias: "env", env: "AI_ROUTER_TEST_ENV_KEY" }] }], { fetch: fake.fetch })
        await router.chat(ask())
        delete process.env.AI_ROUTER_TEST_ENV_KEY
        assert.equal(fake.calls[0]?.key, "sk-from-env")
    })

    test("every key blacklisted fails fast with the blacklist reason", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({}, { status: 401 })
        await assert.rejects(router.chat(ask()), routerError("auth"))
        // Nothing is sent: every key is out until its secret changes, and the call says so.
        await assert.rejects(router.chat(ask()), (error: unknown) => routerError("auth")(error) && error instanceof AiRouterError && error.message.includes("blacklisted") && error.retryAt === undefined)
        assert.equal(fake.calls.length, 2)
    })
})

describe("rate limits", () => {
    test("a 429 cools the key and model down for retry-after; another key takes the call", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { status: 429, headers: { "retry-after": "5" } }, {})
        const result = await router.chat(ask())
        assert.equal(result.routing.key, "k2")
        const lane = (await router.health()).providers[0]?.keys[0]?.models[0]
        assert.ok((lane?.cooldownUntil ?? 0) > Date.now() + 4000)
        const before = fake.calls.length
        for (let index = 0; index < 3; index++) await router.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-a-k2"))
        // The cooldown is per model: m2 on k1 is still a candidate.
        const other = await router.chat(ask("x", "m2"))
        assert.equal(other.routing.key, "k1")
    })

    test("x-ratelimit-remaining-requests 0 keeps the lane out until its reset", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { headers: { "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "10s", "x-ratelimit-remaining-tokens": "900" } })
        await router.chat(ask())
        const lane = (await router.health()).providers[0]?.keys[0]?.models[0]
        assert.equal(lane?.remainingRequests, 0)
        assert.equal(lane.remainingTokens, 900)
        const before = fake.calls.length
        for (let index = 0; index < 3; index++) await router.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-a-k2"))
    })

    test("too few remaining tokens keep a lane out; low headroom demotes it", async () => {
        const { router, fake } = setup(oneProvider(["k1", "k2", "k3"]))
        fake.on({ key: "sk-a-k1" }, { headers: { "x-ratelimit-remaining-tokens": "10", "x-ratelimit-reset-tokens": "1m" } })
        fake.on({ key: "sk-a-k2" }, { headers: { "x-ratelimit-remaining-requests": "1", "x-ratelimit-reset-requests": "1m" } })
        await router.chat(ask())
        await router.chat(ask())
        const before = fake.calls.length
        for (let index = 0; index < 3; index++) await router.chat({ ...ask("x".repeat(200)), max_tokens: 50 })
        assert.ok(fake.calls.slice(before).every((call) => call.key === "sk-a-k3"))
    })

    test("a single key waits for a short retry-after within the deadline", async () => {
        const { router, fake } = setup(oneProvider(["k1"]))
        fake.on({}, { status: 429, headers: { "retry-after-ms": "40" } }, {})
        const started = Date.now()
        const result = await router.chat(ask())
        assert.ok(Date.now() - started >= 35)
        assert.equal(result.routing.attempts, 2)
    })

    test("a retry-after beyond the deadline fails at once with retryAt", async () => {
        const { router, fake } = setup(oneProvider(["k1"]))
        fake.on({}, { status: 429, headers: { "retry-after": "30" } })
        const started = Date.now()
        await assert.rejects(router.chat(ask(), { policy: { deadlineMs: 5000 } }), (error: unknown) => {
            routerError("rate_limit")(error)
            assert.ok(error instanceof AiRouterError && (error.retryAt ?? 0) > Date.now() + 20_000)
            return true
        })
        assert.ok(Date.now() - started < 1000)
    })

    test("a 429 without retry-after uses the default cooldown", async () => {
        const { router, fake } = setup(oneProvider(), { resilience: { rateLimitCooldownMs: 30_000 } })
        fake.on({ key: "sk-a-k1" }, { status: 429 })
        await router.chat(ask())
        const lane = (await router.health()).providers[0]?.keys[0]?.models[0]
        assert.ok((lane?.cooldownUntil ?? 0) > Date.now() + 25_000)
    })
})

describe("circuit breakers", () => {
    test("a key breaker opens, admits one probe when half-open, and closes on success", async () => {
        const { router, fake } = setup(oneProvider(["k1"]), { resilience: { keyBreaker: { failureThreshold: 2, cooldownMs: 40 } } })
        fake.on({}, { status: 500 }, { status: 500 }, {})
        const breakers = record(router, "breaker")
        await assert.rejects(router.chat(ask(), { policy: { maxAttempts: 2 } }), routerError("transient"))
        assert.deepEqual(breakers.map((event) => [event.scope, event.from, event.to]), [["key", "closed", "open"]])
        assert.equal((await router.health()).providers[0]?.keys[0]?.breaker, "open")
        await sleep(45)
        assert.equal((await router.health()).providers[0]?.keys[0]?.breaker, "half-open")
        const result = await router.chat(ask())
        assert.equal(result.routing.attempts, 1)
        assert.deepEqual(breakers.at(-1), { type: "breaker", scope: "key", provider: "a", key: "k1", from: "half-open", to: "closed" })
    })

    test("a failed probe reopens the breaker with a doubled cooldown", async () => {
        const { router, fake } = setup(oneProvider(["k1"]), { resilience: { keyBreaker: { failureThreshold: 1, cooldownMs: 30, maxCooldownMs: 1000 } } })
        fake.on({}, { status: 500 }, { status: 500 }, {})
        const breakers = record(router, "breaker")
        await assert.rejects(router.chat(ask(), { policy: { maxAttempts: 1 } }), routerError("transient"))
        await sleep(35)
        await assert.rejects(router.chat(ask(), { policy: { maxAttempts: 1 } }), routerError("transient"))
        assert.deepEqual(breakers.map((event) => `${event.from}>${event.to}`), ["closed>open", "half-open>open"])
        // The reopened cooldown is 60 ms: the call waits for it, probes, and closes the breaker.
        const started = Date.now()
        await router.chat(ask())
        assert.ok(Date.now() - started >= 40)
        assert.equal(breakers.at(-1)?.to, "closed")
    })

    test("a half-open breaker lets exactly one probe through", async () => {
        const fake = createFakeProvider()
        const starts: number[] = []
        const timed = (input: string, init: RequestInit): Promise<Response> => {
            starts.push(Date.now())
            return fake.fetch(input, init)
        }
        const { router } = setup(oneProvider(["k1"]), { fetch: timed, resilience: { keyBreaker: { failureThreshold: 1, cooldownMs: 20 } } })
        fake.on({}, { status: 500 }, { latencyMs: 40 })
        await assert.rejects(router.chat(ask(), { policy: { maxAttempts: 1 } }), routerError("transient"))
        await sleep(25)
        starts.length = 0
        await Promise.all([router.chat(ask()), router.chat(ask()), router.chat(ask())])
        // The probe goes alone; the other two start only once it has closed the breaker.
        const [probe = 0, ...rest] = starts
        assert.equal(rest.length, 2)
        assert.ok(rest.every((start) => start - probe >= 35), `starts ${starts.map((start) => String(start - probe)).join(",")}`)
    })

    test("a provider breaker opens on failures across its keys and steers calls to another provider", async () => {
        const { router, fake } = setup([provider("a", ["k1", "k2"], [{ id: "m1" }]), provider("b", ["k1"], [{ id: "m1" }], { weight: 1 })], {
            resilience: { providerBreaker: { failureThreshold: 2, cooldownMs: 10_000 }, keyBreaker: { failureThreshold: 5 } },
        })
        fake.on({ baseUrl: "https://a.test" }, { status: 502 })
        const breakers = record(router, "breaker")
        await router.chat(ask(), { policy: { providers: ["a", "b"] } })
        await router.chat(ask())
        await router.chat(ask())
        assert.ok(breakers.some((event) => event.scope === "provider" && event.provider === "a" && event.to === "open"))
        const health = await router.health()
        assert.equal(health.providers[0]?.breaker, "open")
        const before = fake.calls.length
        for (let index = 0; index < 3; index++) await router.chat(ask())
        assert.ok(fake.calls.slice(before).every((call) => call.url.startsWith("https://b.test")))
        await router.reset({ provider: "a" })
        assert.equal((await router.health()).providers[0]?.breaker, "closed")
        await router.reset()
    })

    test("a 503 retry-after holds the lane even before the breaker opens", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { status: 503, headers: { "retry-after": "20" } })
        await router.chat(ask())
        const lane = (await router.health()).providers[0]?.keys[0]?.models[0]
        assert.ok((lane?.cooldownUntil ?? 0) > Date.now() + 15_000)
    })
})

describe("model fallback", () => {
    test("moves to the fallback model once the preferred one has no healthy lane", async () => {
        const { router, fake } = setup()
        fake.on({ model: "m1" }, { status: 500 })
        const result = await router.chat(ask(), { policy: { fallbacks: ["m2"], maxAttempts: 5 } })
        assert.equal(result.routing.model, "m2")
        // Every m1 lane (a/k1, a/k2, b/k1) is tried once before m2.
        assert.deepEqual(fake.calls.map((call) => call.model), ["m1", "m1", "m1", "m2"])
        assert.notEqual(fake.calls[0]?.url.slice(0, 14), fake.calls[1]?.url.slice(0, 14))
    })

    test("allowFallback false keeps the call on the preferred model", async () => {
        const { router, fake } = setup()
        fake.on({ model: "m1" }, { status: 500 })
        await assert.rejects(router.chat(ask(), { policy: { fallbacks: ["m2"], allowFallback: false, maxAttempts: 5 } }), routerError("transient"))
        assert.ok(fake.calls.every((call) => call.model === "m1"))
        assert.equal(fake.calls.length, 5)
    })
})

describe("deadline and cancellation", () => {
    test("the deadline bounds the whole call", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({}, { latencyMs: 500 })
        const started = Date.now()
        await assert.rejects(router.chat(ask(), { policy: { deadlineMs: 40 } }), routerError("deadline"))
        assert.ok(Date.now() - started < 300)
    })

    test("an attempt timeout is retried on another key", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({ key: "sk-a-k1" }, { latencyMs: 500 })
        const attempts = record(router, "attempt")
        const result = await router.chat(ask(), { policy: { timeoutMs: 30 } })
        assert.equal(result.routing.key, "k2")
        assert.equal(attempts[0]?.errorClass, "timeout")
    })

    test("an abort signal cancels the call in flight", async () => {
        const { router, fake } = setup(oneProvider())
        fake.on({}, { latencyMs: 500 })
        const controller = new AbortController()
        setTimeout(() => {
            controller.abort()
        }, 20)
        const requests = record(router, "request")
        await assert.rejects(router.chat(ask(), { signal: controller.signal }), routerError("cancelled"))
        assert.equal(requests[0]?.errorClass, "cancelled")
        assert.equal(fake.calls.length, 1)
    })

    test("an aborted signal sends nothing", async () => {
        const { router, fake } = setup(oneProvider())
        const controller = new AbortController()
        controller.abort()
        await assert.rejects(router.chat(ask(), { signal: controller.signal }), routerError("cancelled"))
        assert.equal(fake.calls.length, 0)
    })

    test("an abort while waiting for a cooldown cancels the wait", async () => {
        const { router, fake } = setup(oneProvider(["k1"]))
        fake.on({}, { status: 429, headers: { "retry-after": "2" } })
        const controller = new AbortController()
        setTimeout(() => {
            controller.abort()
        }, 30)
        const started = Date.now()
        await assert.rejects(router.chat(ask(), { signal: controller.signal }), routerError("cancelled"))
        assert.ok(Date.now() - started < 1000)
    })

    test("an abort during backoff cancels the call", async () => {
        const { router, fake } = setup(oneProvider(), { resilience: { backoff: { baseMs: 2000, maxMs: 2000 } } })
        fake.on({}, { status: 500 })
        const controller = new AbortController()
        setTimeout(() => {
            controller.abort()
        }, 30)
        const started = Date.now()
        await assert.rejects(router.chat(ask(), { signal: controller.signal }), routerError("cancelled"))
        assert.ok(Date.now() - started < 1000)
    })
})
