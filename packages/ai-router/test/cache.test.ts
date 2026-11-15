import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { markerOf, tokenParts, withoutCacheControl, withPartCacheControl } from "../src/cache.ts"
import { parseGatewayConfig } from "../src/gateway/config-file.ts"
import { costOf } from "../src/pool.ts"
import { createRouter } from "../src/router.ts"
import type { ChatCompletionRequest, ModelConfig, ProviderConfig, Usage } from "../src/types.ts"
import { toAnthropicRequest } from "../src/wire/anthropic.ts"
import { drain, setup } from "./helpers.ts"

const EPHEMERAL = { type: "ephemeral" } as const
const HOUR = { type: "ephemeral", ttl: "1h" } as const

const keys = [{ alias: "k1", resolve: (): string => "sk-test" }]
const sonnet: ModelConfig = { id: "claude-sonnet-5-5", aliases: ["sonnet"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } }
const claude: ProviderConfig = { id: "anthropic", kind: "anthropic", keys, models: [sonnet] }
const openrouter: ProviderConfig = { id: "openrouter", kind: "openrouter", keys, models: [{ id: "anthropic/claude-sonnet-5-5" }, { id: "deepseek/deepseek-v4.1-flash" }, { id: "google/gemini-3-pro", cacheControl: true }] }
const deepseek: ProviderConfig = { id: "deepseek", kind: "deepseek", keys, models: [{ id: "deepseek-v4-pro", cost: { input: 1, output: 2, cacheRead: 0.1 } }] }

/** The four layers of a prompt, each ending in a breakpoint: tools and craft, shop rules, the step, then the conversation. */
const layered: ChatCompletionRequest = {
    messages: [
        {
            role: "system",
            content: [
                { type: "text", text: "L1 craft", cache_control: HOUR },
                { type: "text", text: "L2 shop rules", cache_control: EPHEMERAL },
                { type: "text", text: "L3 step goal", cache_control: EPHEMERAL },
            ],
        },
        { role: "user", content: [{ type: "text", text: "L4 the customer's message" }] },
    ],
    tools: [
        { type: "function", function: { name: "lookup", parameters: { type: "object" } } },
        { type: "function", function: { name: "send", parameters: { type: "object" } }, cache_control: HOUR },
    ],
}

describe("cache breakpoints in an Anthropic request", () => {
    test("marked system parts become system blocks, a marked tool keeps its breakpoint, and the TTL passes", () => {
        const body = toAnthropicRequest({ ...layered }, "claude-sonnet-5-5", false, claude)
        assert.deepEqual(body.system, [
            { type: "text", text: "L1 craft", cache_control: HOUR },
            { type: "text", text: "L2 shop rules", cache_control: EPHEMERAL },
            { type: "text", text: "L3 step goal", cache_control: EPHEMERAL },
        ])
        assert.deepEqual(body.tools, [
            { name: "lookup", input_schema: { type: "object" } },
            { name: "send", input_schema: { type: "object" }, cache_control: HOUR },
        ])
        assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "L4 the customer's message" }] }])
    })

    test("a system prompt without a breakpoint stays one string, and a marked message marks its last block", () => {
        const body = toAnthropicRequest(
            {
                messages: [
                    { role: "system", content: "Be brief." },
                    { role: "system", content: [{ type: "text", text: "Use " }, { type: "text", text: "metric." }] },
                    { role: "user", content: "hello", cache_control: EPHEMERAL },
                    { role: "assistant", content: "hi", tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: "{}" } }], cache_control: EPHEMERAL },
                    { role: "tool", tool_call_id: "c1", content: "found", cache_control: EPHEMERAL },
                    { role: "user", content: [{ type: "text", text: "and this", cache_control: EPHEMERAL }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
                ],
            },
            "m",
            false,
            claude,
        )
        assert.equal(body.system, "Be brief.\n\nUse metric.")
        assert.deepEqual(body.messages, [
            { role: "user", content: [{ type: "text", text: "hello", cache_control: EPHEMERAL }] },
            { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "c1", name: "lookup", input: {}, cache_control: EPHEMERAL }] },
            {
                role: "user",
                content: [
                    { type: "tool_result", tool_use_id: "c1", content: "found", cache_control: EPHEMERAL },
                    { type: "text", text: "and this", cache_control: EPHEMERAL },
                    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
                ],
            },
        ])
    })

    test("a marked system message is one marked block; a tool message takes its last marked part's breakpoint; json_object adds its block last", () => {
        const body = toAnthropicRequest(
            {
                messages: [
                    { role: "developer", content: "The whole prompt.", cache_control: EPHEMERAL },
                    { role: "system", content: [{ type: "text", text: "" }, { type: "text", text: "A", cache_control: EPHEMERAL }, { type: "text", text: "B" }], cache_control: HOUR },
                    { role: "user", content: "go" },
                    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
                    { role: "tool", tool_call_id: "c1", content: [{ type: "text", text: "re", cache_control: EPHEMERAL }, { type: "text", text: "sult" }] },
                ],
                response_format: { type: "json_object" },
                cache_control: "nonsense",
            },
            "m",
            false,
            claude,
        )
        assert.deepEqual(body.system, [
            { type: "text", text: "The whole prompt.", cache_control: EPHEMERAL },
            { type: "text", text: "A", cache_control: EPHEMERAL },
            { type: "text", text: "B", cache_control: HOUR },
            { type: "text", text: "Answer with one JSON object and nothing else." },
        ])
        assert.deepEqual((body.messages as { content: unknown[] }[])[2]?.content, [{ type: "tool_result", tool_use_id: "c1", content: "result", cache_control: EPHEMERAL }])
        assert.equal(body.cache_control, undefined)
    })

    test("the top-level breakpoint asks for automatic caching and counts toward the limit of four", () => {
        const automatic = toAnthropicRequest({ messages: [{ role: "user", content: "hi" }], cache_control: HOUR }, "m", false, claude)
        assert.deepEqual(automatic.cache_control, HOUR)
        assert.equal(automatic.system, undefined)
        // Three system breakpoints and one tool breakpoint are four; a fifth, wherever it sits, is refused before it is sent.
        assert.throws(() => toAnthropicRequest({ ...layered, cache_control: EPHEMERAL }, "m", false, claude), /marks 5 cache breakpoints.*at most 4/)
        assert.throws(() => toAnthropicRequest({ ...layered, messages: [...layered.messages, { role: "user", content: "more", cache_control: EPHEMERAL }] }, "m", false, claude), /5 cache breakpoints/)
    })
})

describe("cache breakpoints by provider", () => {
    async function sent(providers: readonly ProviderConfig[], model: string, request: ChatCompletionRequest = layered): Promise<{ breakpoints: readonly string[]; body: Readonly<Record<string, unknown>> }> {
        const { fake, router } = setup(providers)
        await router.chat({ ...request, model })
        const call = fake.calls[0]
        assert.ok(call !== undefined)
        return { breakpoints: call.cacheBreakpoints, body: call.body }
    }

    test("an Anthropic provider receives every breakpoint in its own shape", async () => {
        const { breakpoints } = await sent([claude], "sonnet", layered)
        assert.deepEqual(breakpoints, ["system.0", "system.1", "system.2", "tools.1"])
        assert.deepEqual((await sent([claude], "sonnet", { messages: [{ role: "user", content: "hi" }], cache_control: EPHEMERAL })).breakpoints, ["top"])
    })

    test("a provider that caches on its own receives none, and the request is otherwise untouched", async () => {
        const { breakpoints, body } = await sent([deepseek], "deepseek-v4-pro", { ...layered, cache_control: EPHEMERAL, messages: [...layered.messages, { role: "user", content: "more", cache_control: EPHEMERAL }] })
        assert.deepEqual(breakpoints, [])
        assert.equal(JSON.stringify(body).includes("cache_control"), false)
        assert.deepEqual((body.messages as unknown[])[0], { role: "system", content: [{ type: "text", text: "L1 craft" }, { type: "text", text: "L2 shop rules" }, { type: "text", text: "L3 step goal" }] })
        assert.deepEqual((await sent([openrouter], "deepseek/deepseek-v4.1-flash")).breakpoints, [])
    })

    test("anthropic/* on OpenRouter keeps part and top-level breakpoints; a message's moves to its last part; a tool's is removed", async () => {
        const request: ChatCompletionRequest = {
            ...layered,
            cache_control: EPHEMERAL,
            messages: [layered.messages[0] ?? { role: "system", content: "" }, { role: "user", content: "plain", cache_control: EPHEMERAL }, { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], cache_control: HOUR }],
        }
        const { breakpoints, body } = await sent([openrouter], "anthropic/claude-sonnet-5-5", request)
        assert.deepEqual(breakpoints, ["top", "messages.0.content.0", "messages.0.content.1", "messages.0.content.2", "messages.1.content.0", "messages.2.content.1"])
        assert.deepEqual((body.messages as unknown[])[1], { role: "user", content: [{ type: "text", text: "plain", cache_control: EPHEMERAL }] })
    })

    test("a model's own cacheControl decides against its provider's default, either way", async () => {
        assert.deepEqual((await sent([openrouter], "google/gemini-3-pro")).breakpoints, ["messages.0.content.0", "messages.0.content.1", "messages.0.content.2"])
        const off: ProviderConfig = { ...claude, models: [{ id: "claude-sonnet-5-5", aliases: ["sonnet"], cacheControl: false }] }
        const { breakpoints, body } = await sent([off], "sonnet", { ...layered, cache_control: EPHEMERAL })
        assert.deepEqual(breakpoints, [])
        assert.equal(body.system, "L1 craftL2 shop rulesL3 step goal")
    })

    test("the marker helpers leave what carries no marker as it is", () => {
        assert.equal(markerOf({ cache_control: "x" }), undefined)
        assert.equal(markerOf({ cache_control: { ttl: "1h" } }), undefined)
        const plain = { messages: [{ role: "user", content: "hi" }, "odd"], tools: "odd" }
        assert.deepEqual(withoutCacheControl(plain), plain)
        assert.deepEqual(withoutCacheControl({ model: "m" }), { model: "m" })
        assert.deepEqual(withPartCacheControl({ model: "m" }), { model: "m" })
        assert.deepEqual(
            withPartCacheControl({
                messages: [
                    { role: "user", content: "", cache_control: EPHEMERAL },
                    { role: "user", content: [], cache_control: EPHEMERAL },
                    { role: "user", content: ["odd"], cache_control: EPHEMERAL },
                    { role: "user", content: "kept", cache_control: "nonsense" },
                    { role: "assistant", content: null, cache_control: EPHEMERAL },
                ],
            }),
            { messages: [{ role: "user", content: "" }, { role: "user", content: [] }, { role: "user", content: ["odd"] }, { role: "user", content: "kept" }, { role: "assistant", content: null }] },
        )
    })
})

describe("cache and thinking tokens in usage and cost", () => {
    test("an Anthropic answer lists cache reads, cache writes by lifetime and thinking tokens apart, and the cost prices each", async () => {
        const { fake, router } = setup([claude])
        fake.on({}, { usage: { prompt_tokens: 10_000, completion_tokens: 500, total_tokens: 10_500 }, cache: { read: 6000, write: 3000, write1h: 1000 }, reasoningTokens: 200 })
        const result = await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })
        assert.deepEqual(result.usage, {
            prompt_tokens: 10_000,
            completion_tokens: 500,
            total_tokens: 10_500,
            prompt_tokens_details: { cached_tokens: 6000, cache_write_tokens: 3000, cache_write_1h_tokens: 1000 },
            completion_tokens_details: { reasoning_tokens: 200 },
        })
        // 1000 plain at 2, 6000 read at 0.1, 2000 written for five minutes at 2.5, 1000 for an hour at 4, 500 out at 10.
        const expected = (1000 * 2 + 6000 * 0.1 + 2000 * 2.5 + 1000 * 4 + 500 * 10) / 1_000_000
        assert.ok(Math.abs((result.routing.cost ?? 0) - expected) < 1e-12)
        const lane = router.stats().lanes[0]
        assert.deepEqual([lane?.promptTokens, lane?.cachedTokens, lane?.cacheWriteTokens, lane?.completionTokens, lane?.reasoningTokens], [10_000, 6000, 3000, 500, 200])
    })

    test("a streamed Anthropic answer reports the same counts on its usage chunk", async () => {
        const { fake, router } = setup([claude])
        fake.on({}, { stream: { chunks: ["a"] }, usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 }, cache: { read: 800, write: 50 }, reasoningTokens: 30 })
        const chunks = await drain(router.stream({ model: "sonnet", messages: [{ role: "user", content: "hi" }] }))
        assert.deepEqual(chunks.at(-1)?.usage, {
            prompt_tokens: 900,
            completion_tokens: 40,
            total_tokens: 940,
            prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 50, cache_write_1h_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 30 },
        })
    })

    test("an OpenAI-compatible answer's cached tokens are priced at cacheRead, and a price left out is the input price", async () => {
        const { fake, router } = setup([deepseek])
        fake.on({}, { usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }, cache: { read: 900, write: 50 }, reasoningTokens: 10, thinking: [{ text: "let me see" }] })
        const result = await router.chat({ model: "deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] })
        assert.deepEqual(result.usage?.prompt_tokens_details, { cached_tokens: 900, cache_write_tokens: 50 })
        assert.equal(result.choices[0]?.message.reasoning_content, "let me see")
        assert.ok(Math.abs((result.routing.cost ?? 0) - (50 * 1 + 900 * 0.1 + 50 * 1 + 100 * 2) / 1_000_000) < 1e-12)
        fake.on({}, { stream: { chunks: ["a"] }, cache: { read: 4, write: 2, write1h: 1 }, thinking: [{ text: "hm" }] })
        const chunks = await drain(router.stream({ model: "deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] }))
        assert.deepEqual(chunks.at(-1)?.usage?.prompt_tokens_details, { cached_tokens: 4, cache_write_tokens: 2, cache_write_1h_tokens: 1 })
        assert.equal(chunks.find((chunk) => chunk.choices[0]?.delta.reasoning_content !== undefined)?.choices[0]?.delta.reasoning_content, "hm")
    })

    test("the parts of a usage never exceed the totals they are parts of, and a usage without details has none", () => {
        assert.deepEqual(tokenParts(undefined), { cached: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 })
        assert.deepEqual(tokenParts({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 50, cache_write_1h_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 50 } }), { cached: 10, cacheWrite: 0, cacheWrite1h: 0, reasoning: 3 })
        assert.deepEqual(tokenParts({ prompt_tokens: 10, total_tokens: 10, prompt_tokens_details: { cached_tokens: -1, cache_write_tokens: "x" } } as unknown as Usage), { cached: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 })
        assert.equal(costOf({ id: "m" }, { prompt_tokens: 1, total_tokens: 1 }), undefined)
        assert.equal(costOf(sonnet, undefined), undefined)
        assert.equal(costOf({ id: "m", cost: { input: 1_000_000, output: 0 } }, { prompt_tokens: 3, total_tokens: 3, prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 } }), 3)
    })

    test("a cache price below zero, an omit of messages and thinking on a provider without it are refused at config", () => {
        const model = (extra: Partial<ModelConfig>): ProviderConfig => ({ ...claude, models: [{ id: "m", ...extra }] })
        assert.throws(() => createRouter({ providers: [model({ cost: { input: 1, output: 1, cacheRead: -1 } })] }), /cost\.cacheRead must be a positive number/)
        assert.throws(() => createRouter({ providers: [model({ omit: ["messages"] })] }), /cannot omit "messages"/)
        assert.throws(() => createRouter({ providers: [{ ...deepseek, thinking: "replay" }] }), /only an anthropic provider/)
        assert.doesNotThrow(() => createRouter({ providers: [{ ...claude, thinking: "replay" }] }))
        assert.doesNotThrow(() => createRouter({ providers: [model({ omit: ["temperature"], cost: { input: 0, output: 0, cacheWrite1h: 0 } })] }))
    })

    test("the config file takes the cache prices and the model's request shaping", () => {
        const parsed = parseGatewayConfig({
            providers: [
                {
                    id: "anthropic",
                    kind: "anthropic",
                    thinking: "replay",
                    keys: [{ alias: "k", env: "ANTHROPIC_API_KEY" }],
                    models: [{ id: "claude-sonnet-5-5", cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 }, params: { max_tokens: 32_000, output_config: { effort: "medium" } }, omit: ["temperature"], forcedToolUse: false, cacheControl: true }],
                },
            ],
        })
        const provider = parsed.pool.providers[0]
        assert.equal(provider?.thinking, "replay")
        assert.deepEqual(provider.models[0], { id: "claude-sonnet-5-5", cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 }, params: { max_tokens: 32_000, output_config: { effort: "medium" } }, omit: ["temperature"], forcedToolUse: false, cacheControl: true })
        assert.throws(() => parseGatewayConfig({ providers: [{ id: "a", kind: "anthropic", thinking: "keep", keys: [{ alias: "k", env: "A" }], models: [{ id: "m" }] }] }), /must be one of drop, replay/)
        assert.throws(() => parseGatewayConfig({ providers: [{ id: "a", baseUrl: "https://a.test", keys: [{ alias: "k", env: "A" }], models: [{ id: "m", params: ["x"] }] }] }), /params must be a mapping/)
    })
})
