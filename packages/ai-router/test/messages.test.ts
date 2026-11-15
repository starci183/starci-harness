import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { AiRouterError } from "../src/errors.ts"
import { createFakeProvider, PROVIDER_ERRORS } from "../src/fake.ts"
import { createRouter } from "../src/router.ts"
import type { AnthropicMessagesRequest } from "../src/types.ts"
import { chatBody, errorOf, events, harness, http } from "./fixtures/gateway-helpers.ts"
import type { Harness, Reply } from "./fixtures/gateway-helpers.ts"
import { mixedPool } from "./fixtures/mixed-pool.ts"
import { drain, record } from "./helpers.ts"

/** A request as an Anthropic client writes it: breakpoints, thinking blocks and tool results in the Messages shape. */
const native: AnthropicMessagesRequest = {
    model: "sonnet",
    max_tokens: 2000,
    temperature: 0.3,
    system: [{ type: "text", text: "L1 craft", cache_control: { type: "ephemeral", ttl: "1h" } }],
    tools: [{ name: "weather", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "any" },
    thinking: { type: "adaptive", display: "summarized" },
    messages: [
        { role: "user", content: "Weather in Hue?" },
        { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig_1" }, { type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Hue" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "31C", cache_control: { type: "ephemeral" } }] },
    ],
}

/** The request without one of its fields. */
function without(field: string): AnthropicMessagesRequest {
    return { ...Object.fromEntries(Object.entries(native).filter(([name]) => name !== field)), messages: native.messages }
}

function pool(): { fake: ReturnType<typeof createFakeProvider>; router: ReturnType<typeof createRouter> } {
    const fake = createFakeProvider()
    return { fake, router: createRouter(mixedPool(fake)) }
}

describe("a request in the Anthropic Messages shape", () => {
    test("reaches an Anthropic provider untranslated, but for the lane's model id and the model's own shape", async () => {
        const { fake, router } = pool()
        fake.on({}, { text: "31C in Hue.", thinking: [{ text: "It is hot.", signature: "sig_2" }], usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 }, cache: { read: 700, write: 200 }, reasoningTokens: 20 })
        const result = await router.messages(native)
        const call = fake.calls[0]
        assert.ok(call !== undefined)
        assert.equal(call.url, "https://api.anthropic.com/v1/messages")
        assert.equal(call.headers["x-api-key"], "sk-ant-test-1")
        // The model refuses sampling parameters and a forced tool choice: both are its config, applied in Anthropic's shape.
        assert.deepEqual(call.body, {
            ...without("temperature"),
            model: "claude-sonnet-5-5",
            tool_choice: { type: "auto" },
            system: [{ type: "text", text: "L1 craft", cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "text", text: "You must call one of the provided tools in this response." }],
        })
        assert.deepEqual(call.cacheBreakpoints, ["system.0", "tools.0", "messages.2.content.0"])
        // The answer is the provider's own: thinking blocks with their signatures, Anthropic's usage.
        assert.deepEqual(result.message.content, [{ type: "thinking", thinking: "It is hot.", signature: "sig_2" }, { type: "text", text: "31C in Hue." }])
        assert.deepEqual(result.message.usage, { input_tokens: 100, cache_read_input_tokens: 700, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 }, output_tokens: 50, output_tokens_details: { thinking_tokens: 20 } })
        assert.deepEqual(result.usage, { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 700, cache_write_tokens: 200, cache_write_1h_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 20 } })
        assert.deepEqual([result.routing.provider, result.routing.model, result.routing.key], ["anthropic", "claude-sonnet-5-5", "a1"])
        assert.ok(Math.abs((result.routing.cost ?? 0) - (100 * 2 + 700 * 0.1 + 200 * 2.5 + 50 * 10) / 1_000_000) < 1e-12)
    })

    test("is served by Anthropic providers only: a profile is narrowed to them, and a model no Anthropic provider serves has no candidate", async () => {
        const { fake, router } = pool()
        await router.messages(without("model"), { profile: "auto-light" })
        assert.equal(fake.calls[0]?.protocol, "anthropic")
        await assert.rejects(router.messages({ ...native, model: "deepseek" }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "no_candidate")
        await assert.rejects(router.messages(native, { policy: { providers: ["openrouter"] } }), (error: unknown) => error instanceof AiRouterError && error.errorClass === "no_candidate")
        assert.equal(fake.calls.length, 1)
    })

    test("fails over between the provider's keys, and an answer that is no message is a failed attempt", async () => {
        const { fake, router } = pool()
        const attempts = record(router, "attempt")
        fake.on({ key: "sk-ant-test-1" }, PROVIDER_ERRORS.anthropic.overloaded)
        fake.on({ key: "sk-ant-test-2" }, { body: { type: "ping" } }, {})
        const result = await router.messages(native, { policy: { maxAttempts: 4 } })
        assert.equal(result.routing.attempts > 1, true)
        assert.equal(attempts.at(-1)?.outcome, "success")
        assert.ok(attempts.some((event) => event.errorClass === "transient" && event.key === "a2"))
        fake.on({}, PROVIDER_ERRORS.anthropic.bad_request)
        await assert.rejects(router.messages(native), (error: unknown) => error instanceof AiRouterError && error.errorClass === "invalid_request" && error.status === 400)
    })

    test("streams the provider's own events, each naming the lane, and reads usage for the attempt", async () => {
        const { fake, router } = pool()
        const attempts = record(router, "attempt")
        fake.on({}, { thinking: [{ text: "", signature: "sig_3" }], stream: { chunks: ["31C ", "in Hue."] }, usage: { prompt_tokens: 400, completion_tokens: 9, total_tokens: 409 }, cache: { read: 300 }, reasoningTokens: 4 })
        const stream = router.messagesStream(native)
        assert.match(stream.requestId, /^[0-9a-f-]{36}$/)
        const seen = await drain(stream)
        assert.equal(fake.calls[0]?.body.stream, true)
        assert.deepEqual(seen.map((event) => event.event), ["message_start", "ping", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"])
        assert.ok(seen.every((event) => event.provider === "anthropic" && event.model === "claude-sonnet-5-5"))
        assert.deepEqual(JSON.parse(seen[4]?.data ?? "{}"), { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_3" } })
        assert.deepEqual(attempts[0]?.usage, { prompt_tokens: 400, completion_tokens: 9, total_tokens: 409, prompt_tokens_details: { cached_tokens: 300, cache_write_tokens: 0, cache_write_1h_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 4 } })
    })

    test("a stream fails over before its first content, and after it the error reaches the caller", async () => {
        const { fake, router } = pool()
        fake.on({ key: "sk-ant-test-1" }, { stream: { chunks: ["a"], failAfter: 0, failWith: "error-event" } })
        fake.on({ key: "sk-ant-test-2" }, { stream: { chunks: ["fine"] } })
        const seen = await drain(router.messagesStream(native))
        assert.equal(seen.filter((event) => event.event === "message_start").length, 1)
        assert.equal(fake.calls.length, 2)
        fake.on({}, { stream: { chunks: ["a", "b"], failAfter: 1, failWith: "error-event" } })
        await assert.rejects(drain(router.messagesStream(native)), (error: unknown) => error instanceof AiRouterError && error.afterFirstToken && error.message.includes("Overloaded"))
    })

    test("a stream cut before message_stop, or one that is not JSON, is a failed attempt", async () => {
        const fake = createFakeProvider()
        const bodies = ['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\ndata: [1]\n\n', "data: not json\n\n"]
        const router = createRouter({
            ...mixedPool(fake),
            fetch: () => {
                const text = bodies.shift() ?? ""
                return Promise.resolve(
                    new Response(
                        new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(new TextEncoder().encode(text))
                                controller.close()
                            },
                        }),
                        { status: 200 },
                    ),
                )
            },
        })
        const attempts = record(router, "attempt")
        await assert.rejects(drain(router.messagesStream(native, { policy: { maxAttempts: 2 } })))
        assert.deepEqual(attempts.map((event) => event.errorClass), ["transient", "stream"])
    })
})

describe("POST /v1/messages on the gateway", () => {
    let h: Harness
    let key = ""

    before(async () => {
        h = await harness({}, mixedPool)
        key = await h.key()
    })
    after(() => h.close())

    function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
        return fetch(`${h.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...headers }, body: JSON.stringify(body) })
    }

    test("takes the virtual key as x-api-key and answers Anthropic's message with the lane inside usage", async () => {
        h.fake.reset()
        h.fake.on({}, { text: "31C", usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 }, cache: { read: 40 } })
        const response = await post(native, { "anthropic-beta": "thinking-display-updates-2026-08-18", "x-request-id": "run-7.step-2" })
        assert.equal(response.status, 200)
        const body = (await response.json()) as { type: string; content: unknown; usage: Record<string, unknown> }
        assert.equal(body.type, "message")
        assert.deepEqual(body.content, [{ type: "text", text: "31C" }])
        assert.equal(body.usage.input_tokens, 10)
        assert.equal(body.usage.cache_read_input_tokens, 40)
        assert.deepEqual(body.usage.served, { provider: "anthropic", model: "claude-sonnet-5-5", attempts: 1, cost: (10 * 2 + 40 * 0.1 + 5 * 10) / 1_000_000 })
        assert.equal(response.headers.get("x-ai-router-provider"), "anthropic")
        assert.equal(response.headers.get("x-ai-router-model"), "claude-sonnet-5-5")
        // A well-formed request id of the client names the call, for an app that matches its calls to the router's events.
        assert.equal(response.headers.get("x-request-id"), "run-7.step-2")
        const upstream = h.fake.calls[0]
        assert.equal(upstream?.headers["anthropic-beta"], "thinking-display-updates-2026-08-18")
        assert.equal(upstream.headers["x-request-id"], "run-7.step-2")
        assert.equal(upstream.headers["x-api-key"], "sk-ant-test-1")
        assert.equal(JSON.stringify(upstream.body).includes(key), false)
        const usage = await h.admin.usage((await h.admin.list())[0]?.id ?? "")
        assert.equal(usage.totals.promptTokens, 50)
    })

    test("streams Anthropic's events as they are; the first one names the lane", async () => {
        h.fake.reset()
        h.fake.on({}, { stream: { chunks: ["31C ", "in Hue."] }, usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } })
        const response = await post({ ...native, stream: true })
        assert.equal(response.status, 200)
        assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
        assert.equal(response.headers.get("x-ai-router-provider"), "anthropic")
        const text = await response.text()
        assert.match(text, /^event: message_start\ndata: /)
        const data = text
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
        assert.deepEqual((data[0]?.message as { usage: unknown }).usage, { input_tokens: 50, output_tokens: 1, served: { provider: "anthropic", model: "claude-sonnet-5-5", attempts: 1 } })
        assert.equal(data.at(-1)?.type, "message_stop")
        assert.equal(text.includes("[DONE]"), false)
    })

    test("refuses in Anthropic's error shape: a missing key, a model only an OpenAI-protocol provider serves, a failing pool", async () => {
        const anonymous = await fetch(`${h.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(native) })
        assert.equal(anonymous.status, 401)
        assert.deepEqual(((await anonymous.json()) as { type: string; error: { type: string; code: string } }).error.code, "missing_api_key")
        const other = await post({ ...native, model: "deepseek" })
        assert.equal(other.status, 400)
        const refusal = (await other.json()) as { type: string; error: { type: string; message: string; code: string } }
        assert.equal(refusal.type, "error")
        assert.equal(refusal.error.code, "model_not_supported")
        assert.match(refusal.error.message, /not served through the anthropic protocol: call it at \/v1\/chat\/completions/)
        assert.equal((await post({ ...native, model: "embed" })).status, 400)
        assert.equal((await fetch(`${h.url}/v1/messages`, { headers: { "x-api-key": key } })).status, 405)
        h.fake.reset()
        h.fake.on({}, PROVIDER_ERRORS.anthropic.bad_request)
        const bad = await post(native)
        assert.equal(bad.status, 400)
        assert.match(((await bad.json()) as { error: { message: string } }).error.message, /prompt is too long/)
        const streamed = await post({ ...native, stream: true })
        assert.equal(streamed.status, 400)
        h.fake.reset()
        h.fake.on({}, { stream: { chunks: ["a", "b"], failAfter: 1, failWith: "error-event" } })
        const cut = await (await post({ ...native, stream: true })).text()
        assert.match(cut, /event: error\ndata: \{"type":"error"/)
    })

    test("a profile of two protocols serves each route from its own providers; the kind header keeps a chat call on one", async () => {
        h.fake.reset()
        await post({ ...native, model: "auto-light" })
        assert.equal(h.fake.calls[0]?.protocol, "anthropic")
        const open = async (headers: Record<string, string>): Promise<Reply & { protocol: string | undefined }> => {
            h.fake.reset()
            const response = await fetch(`${h.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...headers }, body: JSON.stringify(chatBody("auto-heavy")) })
            const text = await response.text()
            return { status: response.status, headers: response.headers, text, json: JSON.parse(text) as Record<string, unknown>, protocol: h.fake.calls[0]?.protocol }
        }
        // Unnarrowed, the profile's first candidate answers through the adapter; narrowed, only its OpenAI-protocol lanes do.
        assert.equal((await open({})).protocol, "anthropic")
        const narrowed = await open({ "x-ai-router-kind": "openai" })
        assert.equal(narrowed.protocol, "openai")
        assert.deepEqual((narrowed.json.usage as { served: unknown }).served, { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", attempts: 1, cost: (10 * 0.2 + 2 * 0.8) / 1_000_000 })
        assert.equal(narrowed.headers.get("x-ai-router-provider"), "openrouter")
        assert.equal((await open({ "x-ai-router-kind": "anthropic" })).protocol, "anthropic")
        assert.equal(errorOf(await open({ "x-ai-router-kind": "gemini" })).code, "invalid_request")
        h.fake.reset()
        const wrong = await fetch(`${h.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-ai-router-kind": "openai" }, body: JSON.stringify(chatBody("sonnet")) })
        assert.equal(wrong.status, 400)
        assert.match(((await wrong.json()) as { error: { message: string } }).error.message, /call it at \/v1\/messages/)
    })

    test("a streamed chat completion names the lane inside its usage chunk, and a request id in use is not taken twice", async () => {
        h.fake.reset()
        const response = await fetch(`${h.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-request-id": "bad id!" }, body: JSON.stringify(chatBody("deepseek", { stream: true, stream_options: { include_usage: true } })) })
        assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/)
        const data = events(await response.text())
        const last = JSON.parse(data.at(-2) ?? "{}") as { choices: unknown[]; usage: { served: unknown } }
        assert.deepEqual(last.choices, [])
        assert.deepEqual(last.usage.served, { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", attempts: 1, cost: (10 * 0.2 + 1 * 0.8) / 1_000_000 })
        assert.equal(data.at(-1), "[DONE]")
    })

    test("GET /v1/models says through which protocols each name is served, and an embeddings name its vector length", async () => {
        const listed = (await http(h.url, "/v1/models", { key })).json.data as { id: string; kind: string; kinds: string[]; serves: string[]; dimensions?: number }[]
        const by = (id: string): unknown => {
            const entry = listed.find((model) => model.id === id)
            return entry === undefined ? undefined : [entry.kind, entry.kinds, entry.serves, entry.dimensions]
        }
        assert.deepEqual(by("auto-heavy"), ["anthropic", ["anthropic", "openai"], ["chat"], undefined])
        assert.deepEqual(by("auto-light"), ["openai", ["openai", "anthropic"], ["chat"], undefined])
        assert.deepEqual(by("sonnet"), ["anthropic", ["anthropic"], ["chat"], undefined])
        assert.deepEqual(by("deepseek"), ["openai", ["openai"], ["chat"], undefined])
        assert.deepEqual(by("embed"), ["openai", ["openai"], ["embeddings"], 3])
        assert.deepEqual(by("openai/text-embedding-3-small"), ["openai", ["openai"], ["embeddings"], 3])
        assert.deepEqual(h.router.catalog().providers, [{ id: "anthropic", kind: "anthropic", protocol: "anthropic" }, { id: "openrouter", kind: "openrouter", protocol: "openai" }])
    })
})
