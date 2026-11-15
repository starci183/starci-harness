import { isPlainRecord } from "@starci/common"
import { AttemptError } from "../attempt.ts"
import { markerOf, MAX_CACHE_BREAKPOINTS, takesCacheControl, withoutCacheControl } from "../cache.ts"
import type { ModelConfig, ProviderConfig } from "../types.ts"
import { digest, memoryOf } from "./thinking-memory.ts"
import type { RememberedTurn, ThinkingMemory } from "./thinking-memory.ts"
import type { Wire, WireEvent } from "./wire.ts"

/**
 * The Anthropic Messages API (`POST /v1/messages`) behind the OpenAI chat-completions shape. Read at
 * platform.claude.com/docs/en: /api/messages and /build-with-claude/streaming on 2026-10-31; /build-with-claude/
 * prompt-caching, /thinking, /thinking-tool-workflows and /preserved-thinking on 2026-11-10. docs/design.md, "The
 * Anthropic adapter", maps every field; what has no counterpart is refused (`n` above 1) or dropped (seed, penalties,
 * logprobs).
 */

/** The `anthropic-version` sent unless the provider's headers set one. */
export const ANTHROPIC_VERSION = "2023-06-01"
/**
 * The `max_tokens` sent when neither the request nor the provider's `defaultMaxTokens` gives one: Anthropic requires it,
 * and on current models thinking counts toward it, so a low cap cuts an answer before its first visible token.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000
/** Fields an OpenAI caller may send that Anthropic takes as they are. */
const PASSTHROUGH: readonly string[] = ["temperature", "top_p", "top_k", "thinking", "output_config", "service_tier"]

type Block = Record<string, unknown>

interface AnthropicMessage {
    role: "user" | "assistant"
    content: Block[]
}

/** A turn while the conversation is built: an assistant turn may have the answer it once was, to replay. */
interface Turn extends AnthropicMessage {
    replay?: RememberedTurn | undefined
}

/** What reading an answer needs of its request when the provider replays thinking: where to remember it, and its prefix. */
class ReplayContext {
    readonly memory: ThinkingMemory
    readonly prefix: string

    constructor(memory: ThinkingMemory, prefix: string) {
        this.memory = memory
        this.prefix = prefix
    }
}

function refuse(message: string): AttemptError {
    return new AttemptError("invalid_request", `anthropic: ${message}`)
}

function textOf(content: unknown): string {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return ""
    return content.map((part: unknown) => (isPlainRecord(part) && typeof part.text === "string" ? part.text : "")).join("")
}

/** A block with the cache breakpoint its OpenAI part or message carries, when it carries one. */
function marked(block: Block, holder: Record<string, unknown>): Block {
    const marker = markerOf(holder)
    return marker === undefined ? block : { ...block, cache_control: marker }
}

/** Puts a message's own breakpoint on its last block. */
function markLast(list: Block[], message: Record<string, unknown>): Block[] {
    const last = list.at(-1)
    if (last !== undefined) list[list.length - 1] = marked(last, message)
    return list
}

/** An OpenAI `image_url` part as an Anthropic image block: a data URL becomes base64, anything else a URL source. */
function imageBlock(part: Record<string, unknown>): Block {
    const image = isPlainRecord(part.image_url) ? part.image_url.url : part.image_url
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
        if (!isPlainRecord(part)) continue
        if (part.type === "text") {
            if (typeof part.text === "string" && part.text !== "") out.push(marked({ type: "text", text: part.text }, part))
        } else if (part.type === "image_url") out.push(marked(imageBlock(part), part))
        else out.push(part)
    }
    return out
}

/** A system or developer message as system blocks: one block, or one per text part when a part marks a breakpoint. */
function systemBlocks(message: Record<string, unknown>): Block[] {
    const content = message.content
    const parts = Array.isArray(content) ? content.filter(isPlainRecord) : []
    if (!parts.some((part) => markerOf(part) !== undefined)) {
        const text = textOf(content)
        return text === "" ? [] : [marked({ type: "text", text }, message)]
    }
    return markLast(
        parts.filter((part) => typeof part.text === "string" && part.text !== "").map((part) => marked({ type: "text", text: part.text }, part)),
        message,
    )
}

/** A tool message as a `tool_result` block; its breakpoint is the message's own, else its last marked part's. */
function toolResult(message: Record<string, unknown>): Block {
    if (typeof message.tool_call_id !== "string") throw refuse("a tool message needs tool_call_id")
    const parts = Array.isArray(message.content) ? message.content.filter(isPlainRecord) : []
    const holder = markerOf(message) === undefined ? (parts.findLast((part) => markerOf(part) !== undefined) ?? {}) : message
    return marked({ type: "tool_result", tool_use_id: message.tool_call_id, content: textOf(message.content) }, holder)
}

function toolUse(call: unknown): Block {
    if (!isPlainRecord(call) || !isPlainRecord(call.function) || typeof call.id !== "string" || typeof call.function.name !== "string") throw refuse("a tool call needs an id and a function name")
    const raw = call.function.arguments
    let input: unknown = {}
    if (typeof raw === "string" && raw.trim() !== "") {
        try {
            input = JSON.parse(raw)
        } catch {
            throw refuse(`the arguments of tool call ${call.id} are not JSON`)
        }
    }
    if (!isPlainRecord(input)) throw refuse(`the arguments of tool call ${call.id} must be a JSON object`)
    return { type: "tool_use", id: call.id, name: call.function.name, input }
}

/** The key a turn is remembered by: the ids of the tool calls it made, in order. */
function turnKey(content: readonly Block[]): string {
    return content
        .filter((block) => block.type === "tool_use")
        .map((block) => String(block.id))
        .join(",")
}

/** OpenAI messages as Anthropic's system blocks and alternating user/assistant turns; tool results ride in user turns. */
function conversation(messages: unknown, memory: ThinkingMemory | null): { system: Block[]; turns: Turn[] } {
    if (!Array.isArray(messages)) throw refuse("messages must be a list")
    const system: Block[] = []
    const turns: Turn[] = []
    const push = (role: AnthropicMessage["role"], content: Block[], replay?: RememberedTurn): void => {
        if (content.length === 0) return
        const last = turns.at(-1)
        // Anthropic wants turns to alternate: consecutive turns of one role (several tool results) merge into one.
        if (last?.role === role) {
            last.content.push(...content)
            // A turn merged from two messages is no longer the answer that was remembered.
            last.replay = undefined
        } else turns.push({ role, content, replay })
    }
    for (const message of messages) {
        if (!isPlainRecord(message)) throw refuse("every message must be an object")
        const role = message.role
        if (role === "system" || role === "developer") system.push(...systemBlocks(message))
        else if (role === "user") push("user", markLast(blocks(message.content), message))
        else if (role === "assistant") {
            const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(toolUse) : []
            push("assistant", markLast([...blocks(message.content), ...calls], message), calls.length === 0 ? undefined : memory?.get(turnKey(calls)))
        } else if (role === "tool") push("user", [toolResult(message)])
        else throw refuse(`the message role ${String(role)} has no Anthropic counterpart`)
    }
    return { system, turns }
}

/**
 * The turns as they are sent, with the digest of the whole request. A remembered turn replaces its rebuilt one, thinking
 * included, only while the request up to it is the request that produced it; else the rebuilt turn goes, without thinking.
 */
function settle(turns: readonly Turn[], head: unknown, memory: ThinkingMemory | null): { messages: AnthropicMessage[]; prefix: string } {
    if (memory === null) return { messages: turns.map(({ role, content }) => ({ role, content })), prefix: "" }
    let prefix = digest("", head)
    const messages = turns.map((turn) => {
        let content = turn.content
        if (turn.replay?.prefix === prefix) {
            const kept = turn.content.at(-1)
            // The client's breakpoint on the turn's last block moves to the last block of the replayed turn.
            content = markLast([...turn.replay.content], kept ?? {})
        }
        prefix = digest(prefix, { role: turn.role, content })
        return { role: turn.role, content }
    })
    return { messages, prefix }
}

function tools(list: unknown): unknown[] | undefined {
    if (!Array.isArray(list) || list.length === 0) return undefined
    return list.map((tool: unknown) => {
        if (!isPlainRecord(tool) || tool.type !== "function" || !isPlainRecord(tool.function)) return tool
        const fn = tool.function
        return marked(
            {
                name: fn.name,
                ...(typeof fn.description === "string" ? { description: fn.description } : {}),
                input_schema: isPlainRecord(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
                ...(fn.strict === true ? { strict: true } : {}),
            },
            tool,
        )
    })
}

function toolChoice(choice: unknown, parallel: unknown): Record<string, unknown> | undefined {
    let out: Record<string, unknown> | undefined
    if (choice === "auto") out = { type: "auto" }
    else if (choice === "none") out = { type: "none" }
    else if (choice === "required") out = { type: "any" }
    else if (isPlainRecord(choice) && isPlainRecord(choice.function) && typeof choice.function.name === "string") out = { type: "tool", name: choice.function.name }
    if (parallel === false) out = { ...(out ?? { type: "auto" }), disable_parallel_tool_use: true }
    return out
}

function breakpoints(list: readonly unknown[]): number {
    return list.filter((item) => isPlainRecord(item) && markerOf(item) !== undefined).length
}

/** Builds the Anthropic Messages body of an OpenAI chat request, with the digest of its prefix when thinking is replayed. */
function anthropicRequest(body: Record<string, unknown>, model: string, stream: boolean, provider: ProviderConfig): { body: Record<string, unknown>; prefix: string } {
    if (typeof body.n === "number" && body.n > 1) throw refuse("n above 1 is not supported")
    const memory = memoryOf(provider)
    const { system, turns } = conversation(body.messages, memory)
    const format = body.response_format
    let outputConfig: unknown = body.output_config
    if (isPlainRecord(format) && format.type === "json_object") system.push({ type: "text", text: "Answer with one JSON object and nothing else." })
    if (isPlainRecord(format) && format.type === "json_schema" && isPlainRecord(format.json_schema) && isPlainRecord(format.json_schema.schema)) {
        outputConfig = { ...(isPlainRecord(outputConfig) ? outputConfig : {}), format: { type: "json_schema", schema: format.json_schema.schema } }
    }
    const maxTokens = [body.max_completion_tokens, body.max_tokens].find((value) => typeof value === "number") ?? provider.defaultMaxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS
    const stop = typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? body.stop : undefined
    const mapped = tools(body.tools)
    // One string as before when nothing marks a breakpoint; blocks when a breakpoint needs one to sit on.
    const systemField = system.length === 0 ? undefined : breakpoints(system) === 0 ? system.map((block) => String(block.text)).join("\n\n") : system
    const { messages, prefix } = settle(turns, { system: systemField, tools: mapped }, memory)
    const automatic = markerOf(body)
    const marks = breakpoints(system) + breakpoints(mapped ?? []) + messages.reduce((sum, message) => sum + breakpoints(message.content), 0) + (automatic === undefined ? 0 : 1)
    if (marks > MAX_CACHE_BREAKPOINTS) throw refuse(`the request marks ${String(marks)} cache breakpoints, the top-level one included; at most ${String(MAX_CACHE_BREAKPOINTS)} are taken`)
    const out: Record<string, unknown> = { model, max_tokens: maxTokens, messages }
    for (const field of PASSTHROUGH) if (body[field] !== undefined) out[field] = body[field]
    if (outputConfig !== undefined) out.output_config = outputConfig
    if (systemField !== undefined) out.system = systemField
    if (automatic !== undefined) out.cache_control = automatic
    if (stop !== undefined) out.stop_sequences = stop
    if (mapped !== undefined) out.tools = mapped
    const choice = toolChoice(body.tool_choice, body.parallel_tool_calls)
    if (choice !== undefined) out.tool_choice = choice
    if (typeof body.user === "string") out.metadata = { user_id: body.user }
    if (stream) out.stream = true
    return { body: out, prefix }
}

/** Builds the Anthropic Messages body of an OpenAI chat request. */
export function toAnthropicRequest(body: Record<string, unknown>, model: string, stream: boolean, provider: ProviderConfig): Record<string, unknown> {
    return anthropicRequest(body, model, stream, provider).body
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

/**
 * Anthropic usage as OpenAI usage. Anthropic lists the uncached input, the cache reads and the cache writes apart; the
 * prompt here is their sum, with the reads and writes named in `prompt_tokens_details` (`cached_tokens`,
 * `cache_write_tokens`, and `cache_write_1h_tokens` when the answer splits writes by lifetime). Thinking tokens, when
 * the answer counts them, are `completion_tokens_details.reasoning_tokens`.
 */
export function usageOf(usage: unknown): Record<string, unknown> | undefined {
    if (!isPlainRecord(usage)) return undefined
    const cached = count(usage.cache_read_input_tokens)
    const written = count(usage.cache_creation_input_tokens)
    const prompt = count(usage.input_tokens) + written + cached
    const completion = count(usage.output_tokens)
    const lifetimes = isPlainRecord(usage.cache_creation) ? { cache_write_1h_tokens: count(usage.cache_creation.ephemeral_1h_input_tokens) } : {}
    const thinking = isPlainRecord(usage.output_tokens_details) ? usage.output_tokens_details.thinking_tokens : undefined
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
        prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: written, ...lifetimes },
        ...(typeof thinking === "number" ? { completion_tokens_details: { reasoning_tokens: thinking } } : {}),
    }
}

function isThinking(block: Block): boolean {
    return block.type === "thinking" || block.type === "redacted_thinking"
}

/** Remembers an answer that thought and then called tools, so the next request of the loop can send it back whole. */
function remember(context: unknown, content: readonly Block[]): void {
    if (!(context instanceof ReplayContext)) return
    const key = turnKey(content)
    if (key !== "" && content.some(isThinking)) context.memory.set(key, { content, prefix: context.prefix })
}

/** An Anthropic message as an OpenAI `chat.completion`. */
export function fromAnthropicMessage(json: Record<string, unknown>, context?: unknown): Record<string, unknown> {
    const content = Array.isArray(json.content) ? json.content.filter(isPlainRecord) : []
    remember(context, content)
    const text = content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => String(block.text))
        .join("")
    // Thinking text is a summary or a progress note, present only when the request asked to see it.
    const reasoning = content
        .filter((block) => block.type === "thinking" && typeof block.thinking === "string" && block.thinking !== "")
        .map((block) => String(block.thinking))
        .join("\n\n")
    const calls = content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({ id: String(block.id), type: "function", function: { name: String(block.name), arguments: JSON.stringify(block.input ?? {}) } }))
    const usage = usageOf(json.usage)
    const details = isPlainRecord(json.stop_details) ? json.stop_details : {}
    const refusal = json.stop_reason === "refusal" ? { refusal: [details.explanation, details.category].find((value) => typeof value === "string") ?? "refusal" } : {}
    return {
        id: typeof json.id === "string" ? json.id : "anthropic",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: typeof json.model === "string" ? json.model : "",
        choices: [
            {
                index: 0,
                message: { role: "assistant", content: text === "" && calls.length > 0 ? null : text, ...(reasoning === "" ? {} : { reasoning_content: reasoning }), ...(calls.length > 0 ? { tool_calls: calls } : {}), ...refusal },
                finish_reason: finishReason(json.stop_reason),
            },
        ],
        ...(usage === undefined ? {} : { usage }),
    }
}

/** The content blocks of a streamed answer, put back together to be remembered; `whole` turns false when a piece cannot be. */
class StreamedTurn {
    readonly #blocks = new Map<number, Block>()
    readonly #json = new Map<number, string>()
    #whole = true

    start(index: number, block: Block): void {
        this.#blocks.set(index, { ...block })
    }

    delta(index: number, delta: Block): void {
        const block = this.#blocks.get(index)
        if (block === undefined) this.#whole = false
        else if (delta.type === "text_delta") block.text = `${typeof block.text === "string" ? block.text : ""}${String(delta.text)}`
        else if (delta.type === "thinking_delta") block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${String(delta.thinking)}`
        else if (delta.type === "signature_delta") block.signature = delta.signature
        else if (delta.type === "input_json_delta") this.#json.set(index, `${this.#json.get(index) ?? ""}${String(delta.partial_json)}`)
        // A delta this adapter does not know (citations, a later addition) leaves a block it cannot echo exactly.
        else this.#whole = false
    }

    /** The blocks in order, or undefined when the turn could not be rebuilt exactly. */
    content(): Block[] | undefined {
        for (const [index, json] of this.#json) {
            const block = this.#blocks.get(index)
            if (block === undefined || json.trim() === "") continue
            try {
                block.input = JSON.parse(json)
            } catch {
                return undefined
            }
        }
        return this.#whole ? [...this.#blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block) : undefined
    }
}

const ALIVE: WireEvent = { kind: "alive" }

/** The Anthropic Messages API behind the OpenAI shape: `x-api-key` auth, `/messages`, and its SSE events as OpenAI chunks. */
export const anthropicWire: Wire = {
    secretHeaders: ["x-api-key", "authorization"],
    headers: (secret, provider) => {
        const version = Object.entries(provider.headers ?? {}).find(([name]) => name.toLowerCase() === "anthropic-version")
        return { "x-api-key": secret, "anthropic-version": version?.[1] ?? ANTHROPIC_VERSION }
    },
    chat: (body: Record<string, unknown>, model: ModelConfig, stream, provider) => {
        const request = anthropicRequest(takesCacheControl(provider, model) ? body : withoutCacheControl(body), model.id, stream, provider)
        const memory = memoryOf(provider)
        return { path: "/messages", body: request.body, ...(memory === null ? {} : { context: new ReplayContext(memory, request.prefix) }) }
    },
    embeddings: () => {
        throw refuse("Anthropic has no embeddings API")
    },
    chatResponse: fromAnthropicMessage,
    async *chunks(events, context) {
        let id = "anthropic"
        let model = ""
        // message_start carries the input and cache counts; each message_delta the cumulative counts so far.
        let usage: Record<string, unknown> = {}
        const turn = context instanceof ReplayContext ? new StreamedTurn() : null
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
            if (!isPlainRecord(data)) continue
            switch (data.type) {
                case "message_start": {
                    const message = isPlainRecord(data.message) ? data.message : {}
                    if (typeof message.id === "string") id = message.id
                    if (typeof message.model === "string") model = message.model
                    if (isPlainRecord(message.usage)) usage = { ...message.usage }
                    yield chunk({ role: "assistant", content: "" })
                    break
                }
                case "content_block_start": {
                    const block = isPlainRecord(data.content_block) ? data.content_block : {}
                    const index = count(data.index)
                    turn?.start(index, block)
                    if (block.type === "tool_use") {
                        const call = toolIndex.size
                        toolIndex.set(index, call)
                        yield chunk({ tool_calls: [{ index: call, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] })
                    } else if (block.type === "text" && typeof block.text === "string" && block.text !== "") yield chunk({ content: block.text })
                    else yield ALIVE
                    break
                }
                case "content_block_delta": {
                    const delta = isPlainRecord(data.delta) ? data.delta : {}
                    turn?.delta(count(data.index), delta)
                    const call = delta.type === "input_json_delta" && typeof delta.partial_json === "string" ? toolIndex.get(count(data.index)) : undefined
                    if (delta.type === "text_delta" && typeof delta.text === "string") yield chunk({ content: delta.text })
                    else if (call !== undefined) yield chunk({ tool_calls: [{ index: call, function: { arguments: delta.partial_json } }] })
                    // Thinking text is a summary or a progress note, streamed only when the request asked to see it.
                    else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking !== "") yield chunk({ reasoning_content: delta.thinking })
                    else yield ALIVE
                    break
                }
                case "message_delta": {
                    const delta = isPlainRecord(data.delta) ? data.delta : {}
                    if (isPlainRecord(data.usage)) usage = { ...usage, ...Object.fromEntries(Object.entries(data.usage).filter(([, value]) => value !== null && value !== undefined)) }
                    yield chunk({}, finishReason(delta.stop_reason))
                    break
                }
                case "message_stop": {
                    const content = turn?.content()
                    if (content !== undefined) remember(context, content)
                    yield { kind: "chunk", chunk: { id, object: "chat.completion.chunk", created, model, choices: [], usage: usageOf(usage) } }
                    return
                }
                case "error":
                    yield { kind: "error", body: data }
                    return
                default:
                    // ping, content_block_stop, and event types Anthropic adds later are tolerated, as its docs ask.
                    yield ALIVE
                    break
            }
        }
        // A stream that ends before message_stop was cut: the attempt failed.
        yield { kind: "error", body: { type: "error", error: { type: "api_error", message: "the stream ended before message_stop" } } }
    },
}
