import { AttemptError } from "../attempt.ts"
import type { ProviderConfig } from "../types.ts"
import { isRecord } from "./wire.ts"
import type { Wire, WireEvent } from "./wire.ts"

/**
 * The Anthropic Messages API (`POST /v1/messages`, read 2026-10-31 at platform.claude.com/docs/en/api/messages and
 * /build-with-claude/streaming) behind the OpenAI chat-completions shape. docs/design.md, "The Anthropic adapter", maps
 * every field; what has no counterpart is refused (`n` above 1) or dropped (seed, penalties, logprobs).
 */

/** The `anthropic-version` sent unless the provider's headers set one. */
export const ANTHROPIC_VERSION = "2023-06-01"
/** The `max_tokens` sent when neither the request nor the provider's `defaultMaxTokens` gives one: Anthropic requires it. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096
/** Fields an OpenAI caller may send that Anthropic takes as they are. */
const PASSTHROUGH: readonly string[] = ["temperature", "top_p", "top_k", "thinking", "output_config", "service_tier"]

type Block = Record<string, unknown>

interface AnthropicMessage {
    role: "user" | "assistant"
    content: Block[]
}

function refuse(message: string): AttemptError {
    return new AttemptError("invalid_request", `anthropic: ${message}`)
}

function textOf(content: unknown): string {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return ""
    return content.map((part: unknown) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("")
}

/** An OpenAI `image_url` part as an Anthropic image block: a data URL becomes base64, anything else a URL source. */
function imageBlock(part: Record<string, unknown>): Block {
    const image = isRecord(part.image_url) ? part.image_url.url : part.image_url
    if (typeof image !== "string") throw refuse("an image_url part has no url")
    const data = /^data:([^;,]+);base64,(.*)$/s.exec(image)
    if (data !== null) return { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } }
    return { type: "image", source: { type: "url", url: image } }
}

/** OpenAI message content as Anthropic blocks; an empty text is left out (Anthropic refuses it). Other block types pass as they are. */
function blocks(content: unknown): Block[] {
    if (content === null || content === undefined) return []
    if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }]
    if (!Array.isArray(content)) throw refuse("message content must be a string or a list of parts")
    const out: Block[] = []
    for (const part of content) {
        if (!isRecord(part)) continue
        if (part.type === "text") {
            if (typeof part.text === "string" && part.text !== "") out.push({ type: "text", text: part.text })
        } else if (part.type === "image_url") out.push(imageBlock(part))
        else out.push(part)
    }
    return out
}

function toolUse(call: unknown): Block {
    if (!isRecord(call) || !isRecord(call.function) || typeof call.id !== "string" || typeof call.function.name !== "string") throw refuse("a tool call needs an id and a function name")
    const raw = call.function.arguments
    let input: unknown = {}
    if (typeof raw === "string" && raw.trim() !== "") {
        try {
            input = JSON.parse(raw)
        } catch {
            throw refuse(`the arguments of tool call ${call.id} are not JSON`)
        }
    }
    if (!isRecord(input)) throw refuse(`the arguments of tool call ${call.id} must be a JSON object`)
    return { type: "tool_use", id: call.id, name: call.function.name, input }
}

/** OpenAI messages as Anthropic's system text and alternating user/assistant turns; tool results ride in user turns. */
function conversation(messages: unknown): { system: string[]; turns: AnthropicMessage[] } {
    if (!Array.isArray(messages)) throw refuse("messages must be a list")
    const system: string[] = []
    const turns: AnthropicMessage[] = []
    const push = (role: AnthropicMessage["role"], content: Block[]): void => {
        if (content.length === 0) return
        const last = turns.at(-1)
        // Anthropic wants turns to alternate: consecutive turns of one role (several tool results) merge into one.
        if (last?.role === role) last.content.push(...content)
        else turns.push({ role, content })
    }
    for (const message of messages) {
        if (!isRecord(message)) throw refuse("every message must be an object")
        const role = message.role
        if (role === "system" || role === "developer") {
            const text = textOf(message.content)
            if (text !== "") system.push(text)
        } else if (role === "user") push("user", blocks(message.content))
        else if (role === "assistant") {
            const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(toolUse) : []
            push("assistant", [...blocks(message.content), ...calls])
        } else if (role === "tool") {
            if (typeof message.tool_call_id !== "string") throw refuse("a tool message needs tool_call_id")
            push("user", [{ type: "tool_result", tool_use_id: message.tool_call_id, content: textOf(message.content) }])
        } else throw refuse(`the message role ${String(role)} has no Anthropic counterpart`)
    }
    return { system, turns }
}

function tools(list: unknown): unknown[] | undefined {
    if (!Array.isArray(list) || list.length === 0) return undefined
    return list.map((tool: unknown) => {
        if (!isRecord(tool) || tool.type !== "function" || !isRecord(tool.function)) return tool
        const fn = tool.function
        return {
            name: fn.name,
            ...(typeof fn.description === "string" ? { description: fn.description } : {}),
            input_schema: isRecord(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
            ...(fn.strict === true ? { strict: true } : {}),
        }
    })
}

function toolChoice(choice: unknown, parallel: unknown): Record<string, unknown> | undefined {
    let out: Record<string, unknown> | undefined
    if (choice === "auto") out = { type: "auto" }
    else if (choice === "none") out = { type: "none" }
    else if (choice === "required") out = { type: "any" }
    else if (isRecord(choice) && isRecord(choice.function) && typeof choice.function.name === "string") out = { type: "tool", name: choice.function.name }
    if (parallel === false) out = { ...(out ?? { type: "auto" }), disable_parallel_tool_use: true }
    return out
}

/** Builds the Anthropic Messages body of an OpenAI chat request. */
export function toAnthropicRequest(body: Record<string, unknown>, model: string, stream: boolean, provider: ProviderConfig): Record<string, unknown> {
    if (typeof body.n === "number" && body.n > 1) throw refuse("n above 1 is not supported")
    const { system, turns } = conversation(body.messages)
    const format = body.response_format
    let outputConfig: unknown = body.output_config
    if (isRecord(format) && format.type === "json_object") system.push("Answer with one JSON object and nothing else.")
    if (isRecord(format) && format.type === "json_schema" && isRecord(format.json_schema) && isRecord(format.json_schema.schema)) {
        outputConfig = { ...(isRecord(outputConfig) ? outputConfig : {}), format: { type: "json_schema", schema: format.json_schema.schema } }
    }
    const maxTokens = [body.max_completion_tokens, body.max_tokens].find((value) => typeof value === "number") ?? provider.defaultMaxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS
    const stop = typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? body.stop : undefined
    const out: Record<string, unknown> = { model, max_tokens: maxTokens, messages: turns }
    for (const field of PASSTHROUGH) if (body[field] !== undefined) out[field] = body[field]
    if (outputConfig !== undefined) out.output_config = outputConfig
    if (system.length > 0) out.system = system.join("\n\n")
    if (stop !== undefined) out.stop_sequences = stop
    const mapped = tools(body.tools)
    if (mapped !== undefined) out.tools = mapped
    const choice = toolChoice(body.tool_choice, body.parallel_tool_calls)
    if (choice !== undefined) out.tool_choice = choice
    if (typeof body.user === "string") out.metadata = { user_id: body.user }
    if (stream) out.stream = true
    return out
}

/** Anthropic's stop reason as OpenAI's finish reason. */
export function finishReason(reason: unknown): string | null {
    switch (reason) {
        case "end_turn":
        case "stop_sequence":
        case "pause_turn":
            return "stop"
        case "max_tokens":
        case "model_context_window_exceeded":
            return "length"
        case "tool_use":
            return "tool_calls"
        case "refusal":
            return "content_filter"
        default:
            return reason === null || reason === undefined ? null : "stop"
    }
}

function count(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** Anthropic usage as OpenAI usage: the prompt counts the cache reads and writes, which Anthropic lists apart. */
export function usageOf(usage: unknown, outputOverride?: number): Record<string, unknown> | undefined {
    if (!isRecord(usage)) return undefined
    const cached = count(usage.cache_read_input_tokens)
    const prompt = count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + cached
    const completion = outputOverride ?? count(usage.output_tokens)
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_tokens_details: { cached_tokens: cached } }
}

/** An Anthropic message as an OpenAI `chat.completion`. */
export function fromAnthropicMessage(json: Record<string, unknown>): Record<string, unknown> {
    const content = Array.isArray(json.content) ? json.content.filter(isRecord) : []
    const text = content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => String(block.text))
        .join("")
    const calls = content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({ id: String(block.id), type: "function", function: { name: String(block.name), arguments: JSON.stringify(block.input ?? {}) } }))
    const usage = usageOf(json.usage)
    return {
        id: typeof json.id === "string" ? json.id : "anthropic",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: typeof json.model === "string" ? json.model : "",
        choices: [{ index: 0, message: { role: "assistant", content: text === "" && calls.length > 0 ? null : text, ...(calls.length > 0 ? { tool_calls: calls } : {}) }, finish_reason: finishReason(json.stop_reason) }],
        ...(usage === undefined ? {} : { usage }),
    }
}

/** The Anthropic Messages API behind the OpenAI shape: `x-api-key` auth, `/messages`, and its SSE events as OpenAI chunks. */
export const anthropicWire: Wire = {
    secretHeaders: ["x-api-key", "authorization"],
    headers: (secret, provider) => {
        const version = Object.entries(provider.headers ?? {}).find(([name]) => name.toLowerCase() === "anthropic-version")
        return { "x-api-key": secret, "anthropic-version": version?.[1] ?? ANTHROPIC_VERSION }
    },
    chat: (body, model, stream, provider) => ({ path: "/messages", body: toAnthropicRequest(body, model, stream, provider) }),
    embeddings: () => {
        throw refuse("Anthropic has no embeddings API")
    },
    chatResponse: fromAnthropicMessage,
    async *chunks(events) {
        let id = "anthropic"
        let model = ""
        let inputUsage: unknown = undefined
        let output = 0
        const created = Math.floor(Date.now() / 1000)
        // Anthropic numbers content blocks; OpenAI numbers tool calls. A tool_use block's index maps to its tool call's.
        const toolIndex = new Map<number, number>()
        const chunk = (delta: Record<string, unknown>, finish: string | null = null): WireEvent => ({ kind: "chunk", chunk: { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] } })
        for await (const event of events) {
            let data: unknown
            try {
                data = JSON.parse(event.data)
            } catch {
                yield { kind: "malformed" }
                continue
            }
            if (!isRecord(data)) continue
            switch (data.type) {
                case "message_start": {
                    const message = isRecord(data.message) ? data.message : {}
                    if (typeof message.id === "string") id = message.id
                    if (typeof message.model === "string") model = message.model
                    inputUsage = message.usage
                    if (isRecord(message.usage)) output = count(message.usage.output_tokens)
                    yield chunk({ role: "assistant", content: "" })
                    break
                }
                case "content_block_start": {
                    const block = isRecord(data.content_block) ? data.content_block : {}
                    const index = count(data.index)
                    if (block.type === "tool_use") {
                        const call = toolIndex.size
                        toolIndex.set(index, call)
                        yield chunk({ tool_calls: [{ index: call, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] })
                    } else if (block.type === "text" && typeof block.text === "string" && block.text !== "") yield chunk({ content: block.text })
                    break
                }
                case "content_block_delta": {
                    const delta = isRecord(data.delta) ? data.delta : {}
                    if (delta.type === "text_delta" && typeof delta.text === "string") yield chunk({ content: delta.text })
                    else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
                        const call = toolIndex.get(count(data.index))
                        if (call !== undefined) yield chunk({ tool_calls: [{ index: call, function: { arguments: delta.partial_json } }] })
                    }
                    break
                }
                case "message_delta": {
                    const delta = isRecord(data.delta) ? data.delta : {}
                    // message_delta's usage is cumulative: the last one is the total.
                    if (isRecord(data.usage) && typeof data.usage.output_tokens === "number") output = data.usage.output_tokens
                    yield chunk({}, finishReason(delta.stop_reason))
                    break
                }
                case "message_stop": {
                    const usage = usageOf(inputUsage ?? {}, output)
                    yield { kind: "chunk", chunk: { id, object: "chat.completion.chunk", created, model, choices: [], usage } }
                    return
                }
                case "error":
                    yield { kind: "error", body: data }
                    return
                default:
                    // ping, content_block_stop, and event types Anthropic adds later are tolerated, as its docs ask.
                    break
            }
        }
        // A stream that ends before message_stop was cut: the attempt failed.
        yield { kind: "error", body: { type: "error", error: { type: "api_error", message: "the stream ended before message_stop" } } }
    },
}
