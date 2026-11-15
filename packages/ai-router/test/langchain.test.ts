import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { ChatAnthropic } from "@langchain/anthropic"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import type { AIMessageChunk } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"
import { PROVIDER_ERRORS } from "../src/fake.ts"
import { createRoutedModels, registerChatKind, ROUTED_ANTHROPIC_MAX_TOKENS, RoutedModelsError, usageOf } from "../src/langchain/index.ts"
import type { RoutedChat, RoutedFetch } from "../src/langchain/index.ts"
import { harness } from "./fixtures/gateway-helpers.ts"
import type { Harness } from "./fixtures/gateway-helpers.ts"
import { mixedPool } from "./fixtures/mixed-pool.ts"

const weather = { type: "function" as const, function: { name: "weather", description: "Weather by city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }

function refused(code: string): (error: unknown) => boolean {
    return (error) => error instanceof RoutedModelsError && error.code === code
}

/** Every chunk of a stream added up, as LangChain's own callers do. */
async function streamed(picked: RoutedChat, input: string): Promise<AIMessageChunk> {
    let whole: AIMessageChunk | undefined
    for await (const chunk of await picked.model.stream(input)) whole = whole === undefined ? chunk : whole.concat(chunk)
    assert.ok(whole !== undefined)
    return whole
}

describe("LangChain clients over the gateway", () => {
    let h: Harness
    let key = ""
    let requests = 0
    const counted: RoutedFetch = (input, init) => {
        requests++
        return fetch(input, init)
    }

    before(async () => {
        h = await harness({}, mixedPool)
        key = await h.key()
    })
    after(() => h.close())

    test("a name served through the Anthropic protocol is a ChatAnthropic on the gateway's /v1/messages, with one usage shape", async () => {
        const ai = createRoutedModels({ gatewayUrl: `${h.url}/v1/`, virtualKey: key, fetch: counted })
        const picked = await ai.chat("sonnet")
        assert.equal(picked.kind, "anthropic")
        assert.ok(picked.model instanceof ChatAnthropic)
        assert.deepEqual(picked.fallbacks, [])
        h.fake.reset()
        h.fake.on({}, { text: "31C in Hue.", thinking: [{ text: "", signature: "sig_1" }], usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 }, cache: { read: 700, write: 200 }, reasoningTokens: 20 })
        const reply = await picked.model.invoke([new SystemMessage({ content: [{ type: "text", text: "L1 craft", cache_control: { type: "ephemeral", ttl: "1h" } }] }), new HumanMessage("Weather in Hue?")], { cache_control: { type: "ephemeral" } })
        const upstream = h.fake.calls[0]
        assert.equal(upstream?.url, "https://api.anthropic.com/v1/messages")
        assert.equal(upstream.body.model, "claude-sonnet-5-5")
        assert.equal(upstream.body.max_tokens, ROUTED_ANTHROPIC_MAX_TOKENS)
        // Thinking is the model's own default unless the app sets it: `disabled` would be refused by current models.
        assert.equal(upstream.body.thinking, undefined)
        assert.deepEqual(upstream.cacheBreakpoints, ["top", "system.0"])
        assert.equal(upstream.headers["x-api-key"], "sk-ant-test-1")
        assert.deepEqual(usageOf(reply), { inputTokens: 100, cacheReadTokens: 700, cacheWriteTokens: 200, outputTokens: 50, reasoningTokens: 20, model: "claude-sonnet-5-5", provider: "anthropic", cost: (100 * 2 + 700 * 0.1 + 200 * 2.5 + 50 * 10) / 1_000_000 })
        assert.ok(requests >= 2)
    })

    test("a name served through the OpenAI protocol is a ChatOpenAI on /v1/chat/completions, with the same usage shape", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        const picked = await ai.chat("deepseek", { timeoutMs: 30_000, maxTokens: 900, fields: { openai: { temperature: 0 } } })
        assert.equal(picked.kind, "openai")
        assert.ok(picked.model instanceof ChatOpenAI)
        h.fake.reset()
        h.fake.on({}, { text: "31C in Hue.", usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 }, cache: { read: 700, write: 0 }, reasoningTokens: 20 })
        const reply = await picked.model.invoke([new SystemMessage({ content: [{ type: "text", text: "L1 craft", cache_control: { type: "ephemeral" } }] }), new HumanMessage("Weather in Hue?")])
        const upstream = h.fake.calls[0]
        assert.equal(upstream?.url, "https://openrouter.ai/api/v1/chat/completions")
        assert.equal(upstream.body.model, "deepseek/deepseek-v4.1-flash")
        assert.equal(upstream.body.temperature, 0)
        assert.equal(upstream.body.max_tokens ?? upstream.body.max_completion_tokens, 900)
        // DeepSeek caches a prefix on its own: the breakpoint the app marked never reaches it.
        assert.deepEqual(upstream.cacheBreakpoints, [])
        assert.deepEqual(usageOf(reply), { inputTokens: 300, cacheReadTokens: 700, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 20, model: "deepseek/deepseek-v4.1-flash", provider: "openrouter", cost: (300 * 0.2 + 700 * 0.02 + 50 * 0.8) / 1_000_000 })
    })

    test("a stream of either kind adds up to the same usage and the lane that answered", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        h.fake.reset()
        h.fake.on({}, { stream: { chunks: ["31C ", "in Hue."] }, thinking: [{ text: "", signature: "sig_1" }], usage: { prompt_tokens: 400, completion_tokens: 9, total_tokens: 409 }, cache: { read: 300, write: 50 }, reasoningTokens: 4 })
        const claude = await streamed(await ai.chat("sonnet"), "Weather in Hue?")
        assert.equal(claude.text, "31C in Hue.")
        assert.deepEqual(usageOf(claude), { inputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 50, outputTokens: 9, reasoningTokens: 4, model: "claude-sonnet-5-5", provider: "anthropic", cost: undefined })
        const cheap = await streamed(await ai.chat("deepseek"), "Weather in Hue?")
        assert.equal(cheap.content, "31C in Hue.")
        assert.deepEqual(usageOf(cheap), { inputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 50, outputTokens: 9, reasoningTokens: 4, model: "deepseek/deepseek-v4.1-flash", provider: "openrouter", cost: (50 * 0.2 + 300 * 0.02 + 50 * 0.2 + 9 * 0.8) / 1_000_000 })
    })

    test("a profile of two protocols is its first candidate's client, with the other protocol's client as its fallback", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        const heavy = await ai.chat("auto-heavy")
        assert.deepEqual([heavy.kind, heavy.name, heavy.fallbacks.map((fallback) => [fallback.kind, fallback.name])], ["anthropic", "auto-heavy", [["openai", "auto-heavy"]]])
        const light = await ai.chat("auto-light")
        assert.deepEqual([light.kind, light.fallbacks.map((fallback) => fallback.kind)], ["openai", ["anthropic"]])
        h.fake.reset()
        assert.equal(usageOf(await heavy.model.invoke("hi")).provider, "anthropic")
        // The fallback stays on its own protocol's providers: the app's retry moves to the cheap model, never back to Claude.
        const fallback = heavy.fallbacks[0]
        assert.ok(fallback !== undefined)
        assert.equal(usageOf(await fallback.model.invoke("hi")).provider, "openrouter")
        assert.deepEqual(h.fake.calls.map((call) => call.protocol), ["anthropic", "openai"])
        assert.equal(usageOf(await light.model.invoke("hi")).model, "deepseek/deepseek-v4.1-flash")
    })

    test("the common path never reads the kind: tools bind and a tool call comes back the same from both", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        for (const name of ["sonnet", "deepseek"]) {
            const picked = await ai.chat(name)
            h.fake.reset()
            h.fake.on({}, { toolCalls: [{ id: "call_1", name: "weather", arguments: '{"city":"Hue"}' }] })
            const reply = await picked.model.bindTools([weather]).invoke("Weather in Hue?")
            assert.deepEqual(reply.tool_calls?.map((call) => [call.name, call.args]), [["weather", { city: "Hue" }]])
            assert.equal(Array.isArray(h.fake.calls[0]?.body.tools), true)
        }
    })

    test("a forced tool choice reaches each model in the shape it takes: the app forces the same way for both", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        const forced = async (name: string): Promise<Readonly<Record<string, unknown>>> => {
            const picked = await ai.chat(name)
            h.fake.reset()
            h.fake.on({}, { toolCalls: [{ id: "call_1", name: "weather", arguments: '{"city":"Hue"}' }] })
            await picked.model.bindTools([weather], { tool_choice: "weather" }).invoke("Weather in Hue?")
            return h.fake.calls[0]?.body ?? {}
        }
        // Claude Sonnet 5.5 refuses a forced choice (the pool says so): it gets `auto` and the instruction.
        const claude = await forced("sonnet")
        assert.deepEqual(claude.tool_choice, { type: "auto" })
        assert.equal(claude.system, 'You must call the tool "weather" in this response.')
        assert.deepEqual((await forced("deepseek")).tool_choice, { type: "function", function: { name: "weather" } })
    })

    test("the clients never retry: a refused request reaches the app after one call, in the kind's own error", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        for (const [name, errors] of [["sonnet", PROVIDER_ERRORS.anthropic], ["deepseek", PROVIDER_ERRORS.openrouter]] as const) {
            const picked = await ai.chat(name)
            h.fake.reset()
            h.fake.on({}, errors.bad_request)
            await assert.rejects(picked.model.invoke("hi"), (error: unknown) => error instanceof Error && error.message.includes("400"))
            assert.equal(h.fake.calls.length, 1)
        }
    })

    test("embeddings come from the pinned profile, with the vector length the pool declares", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key, timeoutMs: 30_000 })
        const embed = await ai.embeddings("embed")
        assert.deepEqual([embed.kind, embed.name, embed.dimensions], ["openai", "embed", 3])
        h.fake.reset()
        const vector = await embed.embeddings.embedQuery("a chunk of a document")
        assert.equal(vector.length, 3)
        assert.equal(h.fake.calls[0]?.body.model, "openai/text-embedding-3-small")
        await assert.rejects(ai.embeddings("sonnet"), refused("ROUTED_NOT_EMBEDDINGS"))
        await assert.rejects(ai.chat("embed"), refused("ROUTED_NOT_CHAT"))
    })

    test("a name the key may not use, an unreachable gateway and a protocol with no registered kind are refused by name", async () => {
        const ai = createRoutedModels({ gatewayUrl: h.url, virtualKey: key })
        await assert.rejects(ai.chat("gpt-9"), refused("ROUTED_NAME_UNKNOWN"))
        await ai.refresh()
        await assert.rejects(createRoutedModels({ gatewayUrl: h.url, virtualKey: "sk-starci-wrong" }).chat("sonnet"), refused("ROUTED_CATALOG_UNAVAILABLE"))
        const listing = (data: unknown): RoutedFetch => () => Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }))
        const other = createRoutedModels({ gatewayUrl: "http://gateway.test", virtualKey: key, fetch: listing({ object: "list", data: [{ id: "g", kinds: ["gemini"], serves: ["chat"] }, { id: "none", kinds: [], serves: ["chat"] }, { id: "two", kinds: ["openai", "gemini"], serves: ["chat"] }, "odd", { kinds: [] }] }) })
        await assert.rejects(other.chat("g"), refused("ROUTED_KIND_UNSUPPORTED"))
        await assert.rejects(other.chat("none"), refused("ROUTED_KIND_UNSUPPORTED"))
        // A fallback protocol nobody registered is left out; the first one still serves.
        assert.deepEqual((await other.chat("two")).fallbacks, [])
        assert.equal((await createRoutedModels({ gatewayUrl: "http://gateway.test", virtualKey: key, fetch: listing("odd") }).chat("x").catch((error: unknown) => (error instanceof RoutedModelsError ? error.code : ""))), "ROUTED_NAME_UNKNOWN")
        // A new kind is one registration: its factory builds whatever client speaks that protocol.
        const marker = new ChatOpenAI({ model: "g", apiKey: "sk-test" })
        registerChatKind("gemini" as "openai", (context) => {
            assert.deepEqual([context.name, context.gatewayUrl, context.headers["x-ai-router-kind"]], ["g", "http://gateway.test", "gemini"])
            return Promise.resolve(marker)
        })
        assert.equal((await other.chat("g")).model, marker)
    })

    test("usageOf reads an answer without usage as zeros and no lane", () => {
        assert.deepEqual(usageOf({}), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, model: undefined, provider: undefined, cost: undefined })
        assert.deepEqual(usageOf({ usage_metadata: { input_tokens: 5, output_tokens: 2, input_token_details: { cache_read: 9 } }, response_metadata: { usage: { completion_tokens_details: { reasoning_tokens: 1 }, served: { provider: 1 } } } }), { inputTokens: 0, cacheReadTokens: 9, cacheWriteTokens: 0, outputTokens: 2, reasoningTokens: 1, model: undefined, provider: undefined, cost: undefined })
    })
})
