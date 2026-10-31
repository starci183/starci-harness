import type { ChatChoice, ChatCompletionBody, ChatCompletionChunk, EmbeddingData, EmbeddingsBody, ToolCall, ToolCallDelta, Usage } from "./types.ts"

/**
 * Reads provider answers into the router's typed shapes, field by field. A provider's extra fields (DeepSeek's
 * `reasoning_content`, a `refusal`, `system_fingerprint`) ride along; a body without the fields the router reads is
 * refused (undefined), and the attempt fails as a malformed answer.
 */

const ASSISTANT = "assistant"

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function number(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/** The usage of an answer, when it reports prompt tokens. */
export function readUsage(value: unknown): Usage | undefined {
    if (!isRecord(value) || typeof value.prompt_tokens !== "number") return undefined
    const completion = typeof value.completion_tokens === "number" ? { completion_tokens: value.completion_tokens } : {}
    return { ...value, prompt_tokens: value.prompt_tokens, ...completion, total_tokens: number(value.total_tokens, value.prompt_tokens + number(value.completion_tokens)) }
}

function toolCall(value: unknown): ToolCall | undefined {
    if (!isRecord(value) || !isRecord(value.function) || typeof value.id !== "string" || typeof value.function.name !== "string") return undefined
    return { id: value.id, type: "function", function: { name: value.function.name, arguments: text(value.function.arguments, "{}") } }
}

function choice(value: unknown, at: number): ChatChoice | undefined {
    if (!isRecord(value) || !isRecord(value.message)) return undefined
    const message = value.message
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(toolCall).filter((call): call is ToolCall => call !== undefined) : []
    return {
        index: number(value.index, at),
        message: { ...message, role: "assistant", content: typeof message.content === "string" ? message.content : null, ...(calls.length > 0 ? { tool_calls: calls } : {}) },
        finish_reason: typeof value.finish_reason === "string" ? value.finish_reason : null,
    }
}

/** A chat completion, or undefined when the body has no readable choices. */
export function readCompletion(json: Record<string, unknown>): ChatCompletionBody | undefined {
    if (!Array.isArray(json.choices)) return undefined
    const choices = json.choices.map(choice)
    if (choices.some((entry) => entry === undefined)) return undefined
    const usage = readUsage(json.usage)
    return {
        ...json,
        id: text(json.id),
        object: "chat.completion",
        created: number(json.created),
        model: text(json.model),
        choices: choices.filter((entry): entry is ChatChoice => entry !== undefined),
        ...(usage === undefined ? {} : { usage }),
    }
}

function toolDelta(value: unknown, at: number): ToolCallDelta | undefined {
    if (!isRecord(value)) return undefined
    const fn = isRecord(value.function) ? value.function : undefined
    return {
        index: number(value.index, at),
        ...(typeof value.id === "string" ? { id: value.id } : {}),
        ...(value.type === "function" ? { type: "function" } : {}),
        ...(fn === undefined
            ? {}
            : { function: { ...(typeof fn.name === "string" ? { name: fn.name } : {}), ...(typeof fn.arguments === "string" ? { arguments: fn.arguments } : {}) } }),
    }
}

/** A stream chunk, or undefined when it has no list of choices. */
export function readChunk(json: Record<string, unknown>): ChatCompletionChunk | undefined {
    if (!Array.isArray(json.choices)) return undefined
    const choices: ChatCompletionChunk["choices"][number][] = []
    for (const [at, entry] of json.choices.entries()) {
        if (!isRecord(entry)) return undefined
        const delta = isRecord(entry.delta) ? entry.delta : {}
        const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls.map(toolDelta).filter((call): call is ToolCallDelta => call !== undefined) : undefined
        const { role, content } = delta
        const rest = Object.fromEntries(Object.entries(delta).filter(([field]) => field !== "role" && field !== "content" && field !== "tool_calls"))
        choices.push({
            index: number(entry.index, at),
            delta: {
                ...rest,
                ...(role === ASSISTANT ? { role: ASSISTANT } : {}),
                ...(typeof content === "string" || content === null ? { content } : {}),
                ...(calls === undefined ? {} : { tool_calls: calls }),
            },
            finish_reason: typeof entry.finish_reason === "string" ? entry.finish_reason : null,
        })
    }
    const usage = json.usage === null ? null : readUsage(json.usage)
    return {
        ...json,
        id: text(json.id),
        object: "chat.completion.chunk",
        created: number(json.created),
        model: text(json.model),
        choices,
        ...(usage === undefined ? {} : { usage }),
    }
}

/** The length of one vector: its numbers, or the float32 values of a base64 string. */
export function vectorLength(embedding: readonly number[] | string): number {
    return typeof embedding === "string" ? Buffer.from(embedding, "base64").length / 4 : embedding.length
}

/** An embeddings response, or undefined when its data is not a list of vectors. */
export function readEmbeddings(json: Record<string, unknown>): EmbeddingsBody | undefined {
    if (!Array.isArray(json.data)) return undefined
    const data: EmbeddingData[] = []
    for (const [at, entry] of json.data.entries()) {
        if (!isRecord(entry)) return undefined
        const vector = entry.embedding
        const numbers = Array.isArray(vector) ? vector.filter((value): value is number => typeof value === "number") : undefined
        if (typeof vector !== "string" && (numbers === undefined || !Array.isArray(vector) || numbers.length !== vector.length)) return undefined
        data.push({ object: "embedding", index: number(entry.index, at), embedding: typeof vector === "string" ? vector : (numbers ?? []) })
    }
    const usage = readUsage(json.usage)
    return { object: "list", data, model: text(json.model), ...(usage === undefined ? {} : { usage }) }
}
