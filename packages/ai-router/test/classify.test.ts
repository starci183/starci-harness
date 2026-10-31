import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { classifyFailure, nextMidnight, readProviderError, windowEnd } from "../src/classify.ts"
import { classifyStatus } from "../src/errors.ts"
import { PROVIDER_ERRORS } from "../src/fake.ts"
import type { FakeReply } from "../src/fake.ts"
import type { ErrorClass, ProviderKind } from "../src/types.ts"

/** What every provider's scripted error must classify as: the classification table of docs/design.md. */
const EXPECTED: Readonly<Record<ProviderKind, Readonly<Record<string, ErrorClass>>>> = {
    openai: { rate_limited: "rate_limit", quota_exhausted: "quota", credit_exhausted: "quota", usage_limit: "quota", invalid_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
    anthropic: { rate_limited: "rate_limit", quota_exhausted: "quota", spend_cap: "quota", usage_limit: "quota", invalid_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
    openrouter: {
        rate_limited: "rate_limit",
        quota_exhausted: "quota",
        key_limit: "quota",
        in_flight_budget: "rate_limit",
        free_daily: "quota",
        invalid_key: "auth",
        overloaded: "transient",
        moderation: "invalid_request",
        bad_request: "invalid_request",
        in_body: "transient",
    },
    qwen: { rate_limited: "rate_limit", token_rate: "rate_limit", quota_exhausted: "quota", free_tier: "quota", invalid_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
    deepseek: { rate_limited: "rate_limit", quota_exhausted: "quota", invalid_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
    gemini: { rate_limited: "rate_limit", quota_exhausted: "quota", prepay: "quota", invalid_key: "auth", leaked_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
    groq: { rate_limited: "rate_limit", quota_exhausted: "quota", invalid_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
    "openai-compatible": { rate_limited: "rate_limit", quota_exhausted: "quota", invalid_key: "auth", overloaded: "transient", bad_request: "invalid_request" },
}

const KINDS: readonly ProviderKind[] = ["openai", "anthropic", "openrouter", "qwen", "deepseek", "gemini", "groq", "openai-compatible"]

describe("the classification table", () => {
    for (const kind of KINDS) {
        const cases = EXPECTED[kind]
        test(`${kind}: every documented error shape lands in its class`, () => {
            const scripted = Object.entries<FakeReply>(PROVIDER_ERRORS[kind])
            assert.deepEqual(scripted.map(([name]) => name).sort(), Object.keys(cases).sort(), "every scripted case has an expectation")
            for (const [name, reply] of scripted) {
                const expected = cases[name]
                // An error inside a 200 body is classified without its status, as the router does.
                const status = reply.status === 200 ? undefined : reply.status
                assert.equal(classifyFailure(kind, status, reply.body).errorClass, expected, `${kind} ${name}`)
            }
        })
    }

    test("the provider's most specific code is kept for telemetry", () => {
        assert.equal(classifyFailure("openai", 429, PROVIDER_ERRORS.openai.quota_exhausted.body).code, "insufficient_quota")
        assert.equal(classifyFailure("anthropic", 429, PROVIDER_ERRORS.anthropic.spend_cap.body).code, "enforced_spend_limit_reached")
        assert.equal(classifyFailure("openrouter", 402, PROVIDER_ERRORS.openrouter.quota_exhausted.body).code, "openrouter_credits")
        assert.equal(classifyFailure("qwen", 400, PROVIDER_ERRORS.qwen.quota_exhausted.body).code, "Arrearage")
        assert.equal(classifyFailure("openai-compatible", 500, "plain text").code, undefined)
    })

    test("a status alone classifies as before, with 402 a quota and 498 and 529 transient", () => {
        assert.equal(classifyStatus(402), "quota")
        assert.equal(classifyStatus(498), "transient")
        assert.equal(classifyStatus(529), "transient")
        assert.equal(classifyStatus(422), "invalid_request")
        assert.equal(classifyFailure("openai-compatible", undefined, { error: { type: "weird" } }).errorClass, "transient")
        assert.equal(classifyFailure("openai-compatible", undefined, { error: { code: "context_length_exceeded" } }).errorClass, "invalid_request")
        assert.equal(classifyFailure("openai-compatible", undefined, { error: { code: "something_invalid" } }).errorClass, "invalid_request")
        assert.equal(classifyFailure("openai-compatible", undefined, { error: { type: "overloaded_error" } }).errorClass, "transient")
        assert.equal(classifyFailure("openai-compatible", undefined, { error: { type: "rate_limit_error" } }).errorClass, "rate_limit")
        assert.equal(classifyFailure("gemini", 400, { error: { code: "failed_precondition", message: "Billing is not enabled for this project." } }).errorClass, "quota")
    })
})

describe("error shapes", () => {
    test("reads OpenAI, Anthropic, OpenRouter, Gemini list and DashScope top-level shapes", () => {
        assert.deepEqual(readProviderError(PROVIDER_ERRORS.openai.quota_exhausted.body, 429), { status: 429, type: "insufficient_quota", code: "insufficient_quota", detail: "", message: "You exceeded your current quota, please check your plan and billing details." })
        assert.equal(readProviderError(PROVIDER_ERRORS.anthropic.spend_cap.body, 429).detail, "enforced_spend_limit_reached")
        assert.equal(readProviderError(PROVIDER_ERRORS.openrouter.in_body.body, undefined).status, 502)
        assert.equal(readProviderError(PROVIDER_ERRORS.gemini.rate_limited.body, 429).type, "RESOURCE_EXHAUSTED")
        assert.equal(readProviderError({ code: "Arrearage", message: "overdue" }, 400).code, "Arrearage")
        assert.deepEqual(readProviderError("bad gateway", 502), { status: 502, type: "", code: "", detail: "", message: "bad gateway" })
        assert.equal(readProviderError(42, undefined).message, "")
    })
})

describe("quota windows", () => {
    const now = Date.UTC(2026, 9, 31, 15, 30, 0)

    test("Anthropic's spend cap and OpenAI's monthly limits end at the next UTC month", () => {
        const cases: { kind: ProviderKind; body: unknown }[] = [
            { kind: "anthropic", body: PROVIDER_ERRORS.anthropic.spend_cap.body },
            { kind: "openai", body: PROVIDER_ERRORS.openai.usage_limit.body },
        ]
        for (const { kind, body } of cases) {
            const window = classifyFailure(kind, 429, body).window
            assert.ok(window !== undefined)
            assert.equal(windowEnd(window, now), Date.UTC(2026, 10, 1))
        }
    })

    test("Gemini's daily quota ends at midnight Pacific, OpenRouter's free daily cap at midnight UTC", () => {
        const gemini = classifyFailure("gemini", 429, PROVIDER_ERRORS.gemini.quota_exhausted.body).window
        assert.deepEqual(gemini, { kind: "day", timeZone: "America/Los_Angeles" })
        // 15:30 UTC on 31 October is 08:30 PDT; Pacific midnight is 07:00 UTC on 1 November.
        assert.equal(windowEnd(gemini, now), Date.UTC(2026, 10, 1, 7))
        const openrouter = classifyFailure("openrouter", 429, PROVIDER_ERRORS.openrouter.free_daily.body).window
        assert.ok(openrouter !== undefined)
        assert.equal(windowEnd(openrouter, now), Date.UTC(2026, 10, 1))
    })

    test("a credit that is simply spent has no window: the pool's TTL applies", () => {
        assert.equal(classifyFailure("openai", 429, PROVIDER_ERRORS.openai.credit_exhausted.body).window, undefined)
        assert.equal(classifyFailure("deepseek", 402, PROVIDER_ERRORS.deepseek.quota_exhausted.body).window, undefined)
    })

    test("the next midnight in a zone is exact across a DST change", () => {
        // 2026-11-01 is the end of US daylight time: Pacific midnight of 2 November is 08:00 UTC, not 07:00.
        assert.equal(nextMidnight(Date.UTC(2026, 10, 1, 12), "America/Los_Angeles"), Date.UTC(2026, 10, 2, 8))
        // 2026-03-08 starts it: midnight of 9 March is 07:00 UTC.
        assert.equal(nextMidnight(Date.UTC(2026, 2, 8, 12), "America/Los_Angeles"), Date.UTC(2026, 2, 9, 7))
        assert.equal(nextMidnight(Date.UTC(2026, 9, 31, 23, 59, 59), "UTC"), Date.UTC(2026, 10, 1))
    })
})
