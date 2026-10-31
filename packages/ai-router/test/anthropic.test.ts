import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider, PROVIDER_ERRORS } from "../src/fake.ts"
import { createRouter } from "../src/router.ts"
import type { ChatCompletionChunk, ChatCompletionRequest, ProviderConfig } from "../src/types.ts"
import { ANTHROPIC_DEFAULT_MAX_TOKENS, finishReason, fromAnthropicMessage, toAnthropicRequest, usageOf } from "../src/wire/anthropic.ts"
import { drain, record } from "./helpers.ts"

const claude: ProviderConfig = {
    id: "anthropic",
    kind: "anthropic",
    keys: [
        { alias: "a1", resolve: () => "sk-ant-test-1" },
        { alias: "a2", resolve: () => "sk-ant-test-2" },
    ],
    models: [{ id: "claude-sonnet-5-5", aliases: ["sonnet"] }],
}

function setup(providers: readonly ProviderConfig[] = [claude]): { fake: ReturnType<typeof createFakeProvider>; router: ReturnType<typeof createRouter> } {
    const fake = createFakeProvider()
    const router = createRouter({ providers, fetch: fake.fetch, random: () => 0.5, resilience: { backoff: { baseMs: 1, maxMs: 1 } } })
    return { fake, router }
}

describe("the Anthropic request", () => {
    test("system and developer messages become the system prompt; turns alternate; tool results ride in user turns", () => {
        const body = toAnthropicRequest(
            {
                messages: [
                    { role: "system", content: "Be brief." },
                    { role: "developer", content: [{ type: "text", text: "Use metric units." }] },
                    { role: "user", content: "Weather in Hanoi and Hue?" },
                    { role: "assistant", content: "Checking.", tool_calls: [{ id: "call_1", type: "function", function: { name: "weather", arguments: '{"city":"Hanoi"}' } }, { id: "call_2", type: "function", function: { name: "weather", arguments: "" } }] },
                    { role: "tool", tool_call_id: "call_1", content: "31C" },
                    { role: "tool", tool_call_id: "call_2", content: [{ type: "text", text: "29C" }] },
                    { role: "user", content: [{ type: "text", text: "Thanks" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, { type: "image_url", image_url: "https://x.test/a.png" }, { type: "text", text: "" }] },
                    { role: "assistant", content: "" },
                ],
                temperature: 0.2,
                stop: "END",
                user: "user-42",
                seed: 7,
                presence_penalty: 1,
            },
            "claude-sonnet-5-5",
            false,
            claude,
        )
        assert.deepEqual(body, {
            model: "claude-sonnet-5-5",
            max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
            messages: [
                { role: "user", content: [{ type: "text", text: "Weather in Hanoi and Hue?" }] },
                {
                    role: "assistant",
                    content: [
                        { type: "text", text: "Checking." },
                        { type: "tool_use", id: "call_1", name: "weather", input: { city: "Hanoi" } },
                        { type: "tool_use", id: "call_2", name: "weather", input: {} },
                    ],
                },
                {
                    role: "user",
                    content: [
                        { type: "tool_result", tool_use_id: "call_1", content: "31C" },
                        { type: "tool_result", tool_use_id: "call_2", content: "29C" },
                        { type: "text", text: "Thanks" },
                        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
                        { type: "image", source: { type: "url", url: "https://x.test/a.png" } },
                    ],
                },
            ],
            temperature: 0.2,
            system: "Be brief.\n\nUse metric units.",
            stop_sequences: ["END"],
            metadata: { user_id: "user-42" },
        })
    })

    test("tools, tool_choice, parallel tool calls, max tokens and structured output translate", () => {
        const tools = [{ type: "function", function: { name: "weather", description: "Weather by city", parameters: { type: "object", properties: { city: { type: "string" } } }, strict: true } }, { type: "function", function: { name: "now" } }, { type: "web_search_20250305", name: "web_search" }]
        const base = { messages: [{ role: "user", content: "hi" }], tools, max_completion_tokens: 300 }
        const auto = toAnthropicRequest({ ...base, tool_choice: "auto", parallel_tool_calls: false }, "m", true, { ...claude, defaultMaxTokens: 99 })
        assert.deepEqual(auto.tools, [
            { name: "weather", description: "Weather by city", input_schema: { type: "object", properties: { city: { type: "string" } } }, strict: true },
            { name: "now", input_schema: { type: "object", properties: {} } },
            { type: "web_search_20250305", name: "web_search" },
        ])
        assert.deepEqual(auto.tool_choice, { type: "auto", disable_parallel_tool_use: true })
        assert.equal(auto.max_tokens, 300)
        assert.equal(auto.stream, true)
        assert.deepEqual(toAnthropicRequest({ ...base, tool_choice: "required" }, "m", false, claude).tool_choice, { type: "any" })
        assert.deepEqual(toAnthropicRequest({ ...base, tool_choice: "none" }, "m", false, claude).tool_choice, { type: "none" })
        assert.deepEqual(toAnthropicRequest({ ...base, tool_choice: { type: "function", function: { name: "now" } } }, "m", false, claude).tool_choice, { type: "tool", name: "now" })
        assert.deepEqual(toAnthropicRequest({ messages: [], parallel_tool_calls: false }, "m", false, claude).tool_choice, { type: "auto", disable_parallel_tool_use: true })
        assert.equal(toAnthropicRequest({ messages: [] }, "m", false, { ...claude, defaultMaxTokens: 99 }).max_tokens, 99)
        const schema = { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false }
        assert.deepEqual(toAnthropicRequest({ messages: [], response_format: { type: "json_schema", json_schema: { name: "x", schema } } }, "m", false, claude).output_config, { format: { type: "json_schema", schema } })
        assert.equal(toAnthropicRequest({ messages: [{ role: "user", content: "x" }], response_format: { type: "json_object" } }, "m", false, claude).system, "Answer with one JSON object and nothing else.")
        assert.deepEqual(toAnthropicRequest({ messages: [], thinking: { type: "enabled", budget_tokens: 1024 }, top_k: 5 }, "m", false, claude), { model: "m", max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS, messages: [], thinking: { type: "enabled", budget_tokens: 1024 }, top_k: 5 })
    })

    test("what has no Anthropic counterpart is refused as an invalid request", () => {
        const refused = (body: Record<string, unknown>, pattern: RegExp): void => {
            assert.throws(() => toAnthropicRequest(body, "m", false, claude), (error: unknown) => error instanceof Error && pattern.test(error.message))
        }
        refused({ messages: [], n: 2 }, /n above 1/)
        refused({ messages: "hi" }, /must be a list/)
        refused({ messages: ["hi"] }, /must be an object/)
        refused({ messages: [{ role: "function", content: "x" }] }, /no Anthropic counterpart/)
        refused({ messages: [{ role: "tool", content: "x" }] }, /tool_call_id/)
        refused({ messages: [{ role: "user", content: 5 }] }, /string or a list/)
        refused({ messages: [{ role: "user", content: [{ type: "image_url", image_url: {} }] }] }, /no url/)
        refused({ messages: [{ role: "assistant", content: null, tool_calls: [{ id: "c", function: { name: "f", arguments: "{oops" } }] }] }, /not JSON/)
        refused({ messages: [{ role: "assistant", content: null, tool_calls: [{ id: "c", function: { name: "f", arguments: "[1]" } }] }] }, /JSON object/)
        refused({ messages: [{ role: "assistant", content: null, tool_calls: [{ function: { name: "f" } }] }] }, /id and a function name/)
    })
})

describe("the Anthropic answer", () => {
    test("text and tool_use blocks become an OpenAI message; usage counts the cache", () => {
        const answer = fromAnthropicMessage({
            id: "msg_1",
            model: "claude-sonnet-5-5",
            content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "Let me check." }, { type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Hue" } }],
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
        })
        assert.deepEqual(answer.choices, [{ index: 0, message: { role: "assistant", content: "Let me check.", tool_calls: [{ id: "toolu_1", type: "function", function: { name: "weather", arguments: '{"city":"Hue"}' } }] }, finish_reason: "tool_calls" }])
        assert.deepEqual(answer.usage, { prompt_tokens: 130, completion_tokens: 5, total_tokens: 135, prompt_tokens_details: { cached_tokens: 100 } })
        const bare = fromAnthropicMessage({ content: [{ type: "tool_use", id: "t", name: "n" }] })
        assert.equal(bare.id, "anthropic")
        assert.deepEqual(bare.choices, [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "t", type: "function", function: { name: "n", arguments: "{}" } }] }, finish_reason: null }])
        assert.equal(usageOf("none"), undefined)
    })

    test("stop reasons map to OpenAI finish reasons", () => {
        assert.deepEqual(
            ["end_turn", "stop_sequence", "pause_turn", "max_tokens", "model_context_window_exceeded", "tool_use", "refusal", "something_new", null].map(finishReason),
            ["stop", "stop", "stop", "length", "length", "tool_calls", "content_filter", "stop", null],
        )
    })
})

describe("chat through an Anthropic provider", () => {
    test("sends x-api-key and anthropic-version to /messages, never a bearer header, and answers in OpenAI shape", async () => {
        const { fake, router } = setup([{ ...claude, headers: { authorization: "Bearer leak", "x-api-key": "leak", "anthropic-beta": "feature-x" } }])
        const result = await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] }, { headers: { "X-Api-Key": "leak-too" } })
        const call = fake.calls[0]
        assert.ok(call !== undefined)
        assert.equal(call.path, "/v1/messages")
        assert.equal(call.url, "https://api.anthropic.com/v1/messages")
        assert.equal(call.headers["x-api-key"], "sk-ant-test-1")
        assert.equal(call.headers["anthropic-version"], "2023-06-01")
        assert.equal(call.headers["anthropic-beta"], "feature-x")
        assert.equal(call.headers.authorization, undefined)
        assert.equal(call.body.max_tokens, ANTHROPIC_DEFAULT_MAX_TOKENS)
        assert.equal(result.object, "chat.completion")
        assert.equal(result.choices[0]?.message.content, "ok")
        assert.equal(result.choices[0].finish_reason, "stop")
        assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 0 } })
        assert.equal(result.routing.provider, "anthropic")
    })

    test("a provider's anthropic-version header wins over the default", async () => {
        const { fake, router } = setup([{ ...claude, headers: { "Anthropic-Version": "2099-01-01" } }])
        await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })
        assert.equal(fake.calls[0]?.headers["anthropic-version"], "2099-01-01")
    })

    test("a tool call comes back as OpenAI tool_calls", async () => {
        const { fake, router } = setup()
        fake.on({}, { toolCalls: [{ id: "toolu_1", name: "weather", arguments: '{"city":"Hue"}' }] })
        const result = await router.chat({ model: "sonnet", messages: [{ role: "user", content: "weather?" }], tools: [{ type: "function", function: { name: "weather", parameters: { type: "object" } } }] })
        assert.deepEqual(result.choices[0]?.message.tool_calls, [{ id: "toolu_1", type: "function", function: { name: "weather", arguments: '{"city":"Hue"}' } }])
        assert.equal(result.choices[0].message.content, null)
        assert.equal(result.choices[0].finish_reason, "tool_calls")
    })

    test("Anthropic's error shapes classify per key: overloaded retries, a spent credit blacklists, a bad request stops", async () => {
        const { fake, router } = setup()
        const disabled = record(router, "key-disabled")
        fake.on({ key: "sk-ant-test-1" }, PROVIDER_ERRORS.anthropic.overloaded, {})
        assert.equal((await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })).routing.key, "a2")
        fake.on({ key: "sk-ant-test-2" }, PROVIDER_ERRORS.anthropic.quota_exhausted)
        fake.on({ key: "sk-ant-test-1" }, {})
        await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })
        await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })
        assert.deepEqual(disabled.map((event) => [event.key, event.reason, event.code]), [["a2", "quota", "billing_error"]])
        fake.on({}, PROVIDER_ERRORS.anthropic.bad_request)
        await assert.rejects(router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "invalid_request" && error.status === 400 && error.message.includes("prompt is too long"))
    })

    test("Anthropic rate-limit headers feed the lane's headroom", async () => {
        const { fake, router } = setup()
        const reset = new Date(Date.now() + 60_000).toISOString()
        fake.on({ key: "sk-ant-test-1" }, { headers: { "anthropic-ratelimit-requests-remaining": "0", "anthropic-ratelimit-requests-reset": reset, "anthropic-ratelimit-tokens-remaining": "5000" } })
        await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })
        const lane = (await router.health()).providers[0]?.keys[0]?.models[0]
        assert.equal(lane?.remainingRequests, 0)
        assert.equal(lane.remainingTokens, 5000)
        const before = fake.calls.length
        await router.chat({ model: "sonnet", messages: [{ role: "user", content: "hi" }] })
        assert.equal(fake.calls[before]?.key, "sk-ant-test-2")
    })

    test("embeddings are refused at config: Anthropic has no embeddings API", () => {
        assert.throws(() => createRouter({ providers: [{ ...claude, models: [{ id: "e", capabilities: ["embeddings"] }] }] }), /no embeddings API/)
    })
})

describe("streaming through an Anthropic provider", () => {
    const ask: ChatCompletionRequest = { model: "sonnet", messages: [{ role: "user", content: "hi" }] }

    function text(chunks: readonly ChatCompletionChunk[]): string {
        return chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("")
    }

    test("text deltas become OpenAI chunks, ending with the finish reason and a usage chunk", async () => {
        const { fake, router } = setup()
        fake.on({}, { stream: { chunks: ["Hello ", "world"] }, usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })
        const chunks = await drain(router.stream(ask))
        assert.equal(fake.calls[0]?.body.stream, true)
        assert.equal(fake.calls[0].headers.accept, "text/event-stream")
        assert.deepEqual(chunks[0]?.choices[0]?.delta, { role: "assistant", content: "" })
        assert.equal(chunks[0].id, "msg_fake")
        assert.equal(chunks[0].object, "chat.completion.chunk")
        assert.equal(text(chunks), "Hello world")
        assert.equal(chunks.at(-2)?.choices[0]?.finish_reason, "stop")
        assert.deepEqual(chunks.at(-1)?.choices, [])
        assert.deepEqual(chunks.at(-1)?.usage, { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 } })
    })

    test("a streamed tool_use block becomes tool_calls deltas with its arguments in pieces", async () => {
        const { fake, router } = setup()
        fake.on({}, { text: "One moment.", toolCalls: [{ id: "toolu_1", name: "weather", arguments: '{"city":"Hue"}', argumentChunks: ['{"ci', 'ty":"Hue"}'] }, { id: "toolu_2", name: "now", arguments: "{}" }] })
        const chunks = await drain(router.stream({ ...ask, tools: [{ type: "function", function: { name: "weather" } }] }))
        const calls = chunks.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? [])
        assert.deepEqual(calls, [
            { index: 0, id: "toolu_1", type: "function", function: { name: "weather", arguments: "" } },
            { index: 0, function: { arguments: '{"ci' } },
            { index: 0, function: { arguments: 'ty":"Hue"}' } },
            { index: 1, id: "toolu_2", type: "function", function: { name: "now", arguments: "" } },
            { index: 1, function: { arguments: "{}" } },
        ])
        assert.equal(text(chunks), "One moment.")
        assert.equal(chunks.find((chunk) => chunk.choices[0]?.finish_reason !== null && chunk.choices.length > 0)?.choices[0]?.finish_reason, "tool_calls")
    })

    test("an error event before the first token fails over to the next key", async () => {
        const { fake, router } = setup()
        fake.on({ key: "sk-ant-test-1" }, { stream: { chunks: ["a"], failAfter: 0, failWith: "error-event" } })
        fake.on({ key: "sk-ant-test-2" }, { stream: { chunks: ["fine"] } })
        const attempts = record(router, "attempt")
        const chunks = await drain(router.stream(ask))
        assert.equal(text(chunks), "fine")
        assert.deepEqual(attempts.map((event) => [event.key, event.errorClass]), [["a1", "transient"], ["a2", undefined]])
    })

    test("an error event after the first token ends the stream with afterFirstToken", async () => {
        const { fake, router } = setup()
        fake.on({}, { stream: { chunks: ["a", "b"], failAfter: 1, failWith: "error-event" } })
        const seen: string[] = []
        await assert.rejects(
            (async () => {
                for await (const chunk of router.stream(ask)) seen.push(chunk.choices[0]?.delta.content ?? "")
            })(),
            (error: unknown) => error instanceof AiRouterError && error.afterFirstToken && error.message.includes("Overloaded"),
        )
        assert.ok(seen.includes("a"))
    })

    test("a stream cut before message_stop is a failed attempt, retried", async () => {
        const fake = createFakeProvider()
        const cut = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"m","model":"x","usage":{"input_tokens":1}}}\n\nevent: ping\ndata: {"type":"ping"}\n\ndata: not json\n\n'))
                controller.close()
            },
        })
        let first = true
        const fetchOnce = (input: string, init: RequestInit): Promise<Response> => {
            if (!first) return fake.fetch(input, init)
            first = false
            return Promise.resolve(new Response(cut, { status: 200, headers: { "content-type": "text/event-stream" } }))
        }
        const router = createRouter({ providers: [claude], fetch: fetchOnce, random: () => 0.5, resilience: { backoff: { baseMs: 1, maxMs: 1 } } })
        const attempts = record(router, "attempt")
        await drain(router.stream(ask))
        assert.deepEqual(attempts.map((event) => event.errorClass), ["stream", undefined])
        // The same, without the malformed event: the missing message_stop alone fails the attempt.
        const silent = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"type":"message_start","message":{}}\n\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hi"}}\n\ndata: [1]\n\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"x"}}\n\ndata: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'))
                controller.close()
            },
        })
        const router2 = createRouter({ providers: [{ ...claude, keys: [{ alias: "only", resolve: () => "k" }] }], fetch: () => Promise.resolve(new Response(silent, { status: 200 })), random: () => 0.5 })
        await assert.rejects(drain(router2.stream(ask, { policy: { maxAttempts: 1 } })), (error: unknown) => error instanceof AiRouterError && error.afterFirstToken && error.message.includes("before message_stop"))
    })
})
