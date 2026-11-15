import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { shapeRequest } from "../src/model-request.ts"
import type { ChatCompletionRequest, ChatMessage, ProviderConfig } from "../src/types.ts"
import { ANTHROPIC_DEFAULT_MAX_TOKENS, fromAnthropicMessage } from "../src/wire/anthropic.ts"
import { digest, memoryOf, ThinkingMemory } from "../src/wire/thinking-memory.ts"
import { drain, setup } from "./helpers.ts"

const keys = [{ alias: "k1", resolve: (): string => "sk-test" }]

function claude(extra: Partial<ProviderConfig> = {}): ProviderConfig {
    return { id: "anthropic", kind: "anthropic", keys, models: [{ id: "claude-sonnet-5-5", aliases: ["sonnet"] }], ...extra }
}

const tools = [{ type: "function", function: { name: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }]
const question: ChatMessage = { role: "user", content: "Weather in Hue?" }
const first: ChatCompletionRequest = { model: "sonnet", messages: [{ role: "system", content: "Be brief." }, question], tools }
const thought = [{ text: "", signature: "sig_1" }, { text: "Checking the weather tool.", signature: "sig_2" }]
const toolCall = { id: "toolu_1", name: "weather", arguments: '{"city":"Hue"}' }

/** The second request of a tool loop as an OpenAI client builds it: the assistant turn has only what the OpenAI shape holds. */
function second(system = "Be brief."): ChatCompletionRequest {
    return {
        ...first,
        messages: [
            { role: "system", content: system },
            question,
            { role: "assistant", content: "One moment.", tool_calls: [{ id: "toolu_1", type: "function", function: { name: "weather", arguments: '{"city":"Hue"}' } }] },
            { role: "tool", tool_call_id: "toolu_1", content: "31C" },
        ],
    }
}

const echoed = [
    { type: "thinking", thinking: "", signature: "sig_1" },
    { type: "thinking", thinking: "Checking the weather tool.", signature: "sig_2" },
    { type: "text", text: "One moment." },
    { type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Hue" } },
]
const rebuilt = [
    { type: "text", text: "One moment." },
    { type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Hue" } },
]

function assistantTurn(body: Readonly<Record<string, unknown>> | undefined): unknown {
    return (body?.messages as { role: string; content: unknown }[] | undefined)?.find((message) => message.role === "assistant")?.content
}

describe("thinking with tools through an Anthropic provider", () => {
    test("by default thinking is never sent back: the next request carries the turn without it, and its text reaches the caller as reasoning_content", async () => {
        const { fake, router } = setup([claude()])
        fake.on({}, { text: "One moment.", thinking: thought, toolCalls: [toolCall] }, { text: "31C in Hue." })
        const answer = await router.chat(first)
        assert.equal(answer.choices[0]?.message.reasoning_content, "Checking the weather tool.")
        assert.equal(answer.choices[0].message.content, "One moment.")
        assert.equal(memoryOf(claude()), null)
        await router.chat(second())
        assert.deepEqual(assistantTurn(fake.calls[1]?.body), rebuilt)
        assert.equal(fake.calls[0]?.body.max_tokens, ANTHROPIC_DEFAULT_MAX_TOKENS)
        assert.equal(fake.calls[0].body.thinking, undefined)
    })

    test("with thinking: replay the turn goes back exactly as it was received, whatever the client above forwarded", async () => {
        const { fake, router } = setup([claude({ thinking: "replay" })])
        fake.on({}, { text: "One moment.", thinking: thought, toolCalls: [toolCall] }, { text: "31C in Hue." })
        await router.chat(first)
        await router.chat({ ...second(), messages: [...second().messages.slice(0, 3), { role: "tool", tool_call_id: "toolu_1", content: "31C", cache_control: { type: "ephemeral" } }] })
        assert.deepEqual(assistantTurn(fake.calls[1]?.body), echoed)
        // A moved breakpoint is no edit of the conversation: the turn is still replayed.
        assert.deepEqual(fake.calls[1]?.cacheBreakpoints, ["messages.2.content.0"])
    })

    test("a streamed turn is put back together and replayed the same; the client's breakpoint moves to its last block", async () => {
        const { fake, router } = setup([claude({ thinking: "replay" })])
        fake.on({}, { text: "One moment.", thinking: thought, toolCalls: [{ ...toolCall, argumentChunks: ['{"ci', 'ty":"Hue"}'] }] }, { text: "31C in Hue." })
        const chunks = await drain(router.stream(first))
        assert.equal(chunks.map((chunk) => chunk.choices[0]?.delta.reasoning_content).filter((piece) => typeof piece === "string").join(""), "Checking the weather tool.")
        const marked = second()
        const turn = marked.messages[2]
        assert.ok(turn !== undefined)
        await drain(router.stream({ ...marked, messages: [...marked.messages.slice(0, 2), { ...turn, cache_control: { type: "ephemeral", ttl: "1h" } }, ...marked.messages.slice(3)] }))
        assert.deepEqual(assistantTurn(fake.calls[1]?.body), [...echoed.slice(0, 3), { ...echoed[3], cache_control: { type: "ephemeral", ttl: "1h" } }])
    })

    test("a turn is not replayed once the conversation before it changed: the API binds thinking to its prefix", async () => {
        const { fake, router } = setup([claude({ thinking: "replay" })])
        fake.on({}, { text: "One moment.", thinking: thought, toolCalls: [toolCall] }, { text: "ok" })
        await router.chat(first)
        await router.chat(second("Be thorough."))
        assert.deepEqual(assistantTurn(fake.calls[1]?.body), rebuilt)
        // The same turn after two assistant messages merged into one is no longer the answer that was remembered.
        const merged = second()
        await router.chat({ ...merged, messages: [...merged.messages.slice(0, 2), { role: "assistant", content: "Hm." }, ...merged.messages.slice(2)] })
        assert.deepEqual(assistantTurn(fake.calls[2]?.body), [{ type: "text", text: "Hm." }, ...rebuilt])
        // Unchanged again, it is replayed again: nothing was forgotten.
        await router.chat(second())
        assert.deepEqual(assistantTurn(fake.calls[3]?.body), echoed)
    })

    test("only a turn that thought and called tools is remembered; a stream it cannot rebuild exactly is not", async () => {
        const provider = claude({ thinking: "replay" })
        const { fake, router } = setup([provider])
        fake.on({}, { text: "No tool.", thinking: thought }, { toolCalls: [toolCall] }, { text: "x", thinking: thought, toolCalls: [{ ...toolCall, id: "toolu_2", argumentChunks: ["{oops"] }] })
        await router.chat(first)
        await router.chat(first)
        await drain(router.stream(first))
        assert.equal(memoryOf(provider)?.size, 0)
    })

    test("the memory forgets its least recently used turn past its limit, and a digest ignores key order and breakpoints", () => {
        const memory = new ThinkingMemory(2)
        memory.set("a", { content: [], prefix: "1" })
        memory.set("b", { content: [], prefix: "2" })
        assert.equal(memory.get("a")?.prefix, "1")
        memory.set("c", { content: [], prefix: "3" })
        assert.equal(memory.get("b"), undefined)
        assert.equal(memory.size, 2)
        assert.equal(digest("p", { a: 1, b: [{ c: 2, cache_control: { type: "ephemeral" } }] }), digest("p", { b: [{ c: 2 }], a: 1 }))
        assert.notEqual(digest("p", { a: 1 }), digest("q", { a: 1 }))
        assert.notEqual(digest("p", { a: 1 }), digest("p", { a: 2 }))
    })

    test("a provider that is thinking with nothing to show keeps its attempt alive past the idle timeout", async () => {
        const { fake, router } = setup([claude()])
        // Hidden thinking streams pings, an empty thinking delta and a signature: about 320 ms before the first text here.
        fake.on({}, { thinking: [{ text: "" }], stream: { chunks: ["done"], delayMs: 40 } })
        const chunks = await drain(router.stream({ model: "sonnet", messages: [question] }, { policy: { timeoutMs: 150, maxAttempts: 1 } }))
        assert.equal(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join(""), "done")
    })

    test("a refusal names its reason on the message", () => {
        const refused = fromAnthropicMessage({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } })
        assert.deepEqual(refused.choices, [{ index: 0, message: { role: "assistant", content: "", refusal: "cyber" }, finish_reason: "content_filter" }])
        assert.equal((fromAnthropicMessage({ content: [], stop_reason: "refusal" }).choices as { message: { refusal: string } }[])[0]?.message.refusal, "refusal")
    })
})

describe("a model's own request shape", () => {
    const sonnet = { id: "claude-sonnet-5-5", aliases: ["sonnet"], params: { max_tokens: 32_000, output_config: { effort: "medium" } }, omit: ["temperature", "top_p"], forcedToolUse: false }
    const pool: ProviderConfig[] = [
        claude({ models: [sonnet] }),
        { id: "openrouter", kind: "openrouter", keys, models: [{ id: "deepseek/deepseek-v4.1-flash", aliases: ["deepseek"] }, { id: "anthropic/claude-sonnet-5-5", omit: ["temperature"], forcedToolUse: false }] },
    ]
    const forced: ChatCompletionRequest = { messages: [{ role: "system", content: "Be brief." }, question], tools, temperature: 0, top_p: 0.9, tool_choice: { type: "function", function: { name: "weather" } } }

    test("params are sent when the request sets none, omit removes what the model refuses, and a forced tool choice becomes auto with an instruction", async () => {
        const { fake, router } = setup(pool)
        await router.chat({ ...forced, model: "sonnet" })
        const body = fake.calls[0]?.body
        assert.equal(body?.max_tokens, 32_000)
        assert.deepEqual(body.output_config, { effort: "medium" })
        assert.equal(body.temperature, undefined)
        assert.equal(body.top_p, undefined)
        assert.deepEqual(body.tool_choice, { type: "auto" })
        assert.equal(body.system, 'Be brief.\n\nYou must call the tool "weather" in this response.')
        await router.chat({ ...forced, model: "sonnet", max_tokens: 500, tool_choice: "required", output_config: { effort: "low" } })
        assert.equal(fake.calls[1]?.body.max_tokens, 500)
        assert.deepEqual(fake.calls[1].body.output_config, { effort: "low" })
        assert.match(String(fake.calls[1].body.system), /You must call one of the provided tools/)
    })

    test("the same request reaches another model as it was written: the shape is the lane's, never the app's", async () => {
        const { fake, router } = setup(pool)
        await router.chat({ ...forced, model: "deepseek" })
        const body = fake.calls[0]?.body
        assert.equal(body?.temperature, 0)
        assert.deepEqual(body.tool_choice, forced.tool_choice)
        assert.equal(body.max_tokens, undefined)
        assert.equal((body.messages as unknown[]).length, 2)
        await router.chat({ ...forced, model: "anthropic/claude-sonnet-5-5" })
        const routed = fake.calls[1]?.body
        assert.equal(routed?.tool_choice, "auto")
        assert.equal(routed.temperature, undefined)
        assert.equal(routed.top_p, 0.9)
        assert.deepEqual((routed.messages as unknown[])[1], { role: "system", content: 'You must call the tool "weather" in this response.' })
    })

    test("a choice that forces nothing is left alone, and a request of only system messages gets its instruction last", () => {
        const model = { id: "m", forcedToolUse: false }
        const auto = { messages: [question], tool_choice: "auto" }
        assert.deepEqual(shapeRequest(auto, model), auto)
        assert.equal(shapeRequest(auto, { id: "m" }), auto)
        assert.deepEqual(shapeRequest({ messages: [{ role: "developer", content: "d" }], tool_choice: "required" }, model).messages, [{ role: "developer", content: "d" }, { role: "system", content: "You must call one of the provided tools in this response." }])
        assert.deepEqual(shapeRequest({ tool_choice: "required" }, model).messages, [{ role: "system", content: "You must call one of the provided tools in this response." }])
        // A request in the Anthropic shape is unforced in that shape: the instruction ends its system prompt.
        const any = "You must call one of the provided tools in this response."
        assert.deepEqual(shapeRequest({ tool_choice: { type: "any" }, temperature: 1 }, { ...model, omit: ["temperature"], params: { max_tokens: 9 } }, true), { max_tokens: 9, tool_choice: { type: "auto" }, system: any })
        assert.deepEqual(shapeRequest({ tool_choice: { type: "tool", name: "weather", disable_parallel_tool_use: true }, system: "Be brief." }, model, true), { tool_choice: { type: "auto", disable_parallel_tool_use: true }, system: 'Be brief.\n\nYou must call the tool "weather" in this response.' })
        assert.deepEqual(shapeRequest({ tool_choice: { type: "any" }, system: [{ type: "text", text: "L1", cache_control: { type: "ephemeral" } }] }, model, true).system, [{ type: "text", text: "L1", cache_control: { type: "ephemeral" } }, { type: "text", text: any }])
        for (const choice of [{ type: "auto" }, { type: "none" }, { type: "tool" }, "auto", undefined]) assert.equal(shapeRequest({ tool_choice: choice }, model, true).system, undefined)
        assert.deepEqual(shapeRequest({ tool_choice: { type: "any" } }, { id: "m", params: { max_tokens: 9 } }, true), { max_tokens: 9, tool_choice: { type: "any" } })
    })
})
