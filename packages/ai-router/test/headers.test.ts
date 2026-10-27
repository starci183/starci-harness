import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { classifyStatus, parseDuration, readRateLimit } from "../src/index.ts"

describe("rate-limit headers", () => {
    test("parseDuration reads OpenAI durations and plain seconds", () => {
        assert.equal(parseDuration("1s"), 1000)
        assert.equal(parseDuration("6m0s"), 360_000)
        assert.equal(parseDuration("20ms"), 20)
        assert.equal(parseDuration("1h2m3.5s"), 3_723_500)
        assert.equal(parseDuration("2"), 2000)
        assert.equal(parseDuration("0.5"), 500)
        assert.equal(parseDuration(""), null)
        assert.equal(parseDuration("soon"), null)
    })

    test("readRateLimit reads OpenAI, generic and IETF headers", () => {
        const now = 1_000_000
        const openai = readRateLimit(
            new Headers({
                "x-ratelimit-remaining-requests": "12",
                "x-ratelimit-reset-requests": "2s",
                "x-ratelimit-remaining-tokens": "4000",
                "x-ratelimit-reset-tokens": "1m",
            }),
            now,
        )
        assert.deepEqual(openai, { remainingRequests: 12, requestsResetAt: now + 2000, remainingTokens: 4000, tokensResetAt: now + 60_000, retryAt: 0 })
        const generic = readRateLimit(new Headers({ "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1900000000" }), now)
        assert.equal(generic.remainingRequests, 3)
        assert.equal(generic.requestsResetAt, 1_900_000_000_000)
        const ietf = readRateLimit(new Headers({ "ratelimit-remaining": "0", "ratelimit-reset": "7" }), now)
        assert.equal(ietf.remainingRequests, 0)
        assert.equal(ietf.requestsResetAt, now + 7000)
        const junk = readRateLimit(new Headers({ "x-ratelimit-remaining-requests": "lots", "x-ratelimit-reset-requests": "later" }), now)
        assert.equal(junk.remainingRequests, null)
        assert.equal(junk.requestsResetAt, 0)
    })

    test("retry-after reads milliseconds, seconds and HTTP dates", () => {
        const now = Date.parse("2026-10-27T00:00:00Z")
        assert.equal(readRateLimit(new Headers({ "retry-after-ms": "250" }), now).retryAt, now + 250)
        assert.equal(readRateLimit(new Headers({ "retry-after": "3" }), now).retryAt, now + 3000)
        assert.equal(readRateLimit(new Headers({ "retry-after": "Tue, 27 Oct 2026 00:00:10 GMT" }), now).retryAt, now + 10_000)
        assert.equal(readRateLimit(new Headers({ "retry-after": "whenever" }), now).retryAt, 0)
    })

    test("statuses are classified", () => {
        assert.equal(classifyStatus(429), "rate_limit")
        assert.equal(classifyStatus(401), "auth")
        assert.equal(classifyStatus(403), "auth")
        assert.equal(classifyStatus(408), "transient")
        assert.equal(classifyStatus(503), "transient")
        assert.equal(classifyStatus(400), "invalid_request")
        assert.equal(classifyStatus(404), "invalid_request")
    })
})
