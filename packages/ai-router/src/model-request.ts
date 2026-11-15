import { isPlainRecord } from "@starci/common"
import type { ModelConfig } from "./types.ts"

/**
 * What one model needs of a chat request and another would refuse, applied from the model's own config just before the
 * request is sent to its provider: default fields (`params`), fields never sent (`omit`) and a forced tool choice the
 * model refuses (`forcedToolUse: false`). The app above sends one request shape whatever lane serves it.
 */

const ANY_TOOL = "You must call one of the provided tools in this response."

function namedTool(name: string): string {
    return `You must call the tool "${name}" in this response.`
}

function isSystem(message: unknown): boolean {
    return isPlainRecord(message) && (message.role === "system" || message.role === "developer")
}

/** An OpenAI request's forced tool choice as `auto` plus a system instruction, placed after the leading system messages. */
function unforced(body: Record<string, unknown>): Record<string, unknown> {
    const choice = body.tool_choice
    const text = choice === "required" ? ANY_TOOL : isPlainRecord(choice) && isPlainRecord(choice.function) && typeof choice.function.name === "string" ? namedTool(choice.function.name) : undefined
    if (text === undefined) return body
    const messages: unknown[] = Array.isArray(body.messages) ? body.messages : []
    const lead = messages.findIndex((message) => !isSystem(message))
    const at = lead === -1 ? messages.length : lead
    return { ...body, tool_choice: "auto", messages: [...messages.slice(0, at), { role: "system", content: text }, ...messages.slice(at)] }
}

/** An Anthropic request's forced tool choice (`any`, `tool`) as `auto` plus an instruction at the end of its system prompt. */
function unforcedNative(body: Record<string, unknown>): Record<string, unknown> {
    const choice = body.tool_choice
    if (!isPlainRecord(choice)) return body
    const text = choice.type === "any" ? ANY_TOOL : choice.type === "tool" && typeof choice.name === "string" ? namedTool(choice.name) : undefined
    if (text === undefined) return body
    const system: unknown = body.system
    const block = { type: "text", text }
    return {
        ...body,
        tool_choice: { type: "auto", ...(choice.disable_parallel_tool_use === true ? { disable_parallel_tool_use: true } : {}) },
        system: Array.isArray(system) ? [...(system as unknown[]), block] : typeof system === "string" && system !== "" ? `${system}\n\n${text}` : text,
    }
}

/**
 * The chat request a model is sent: its `params` under the request's own fields, without its `omit`, its tool choice
 * unforced when it refuses one. A `native` request is in the Anthropic Messages shape: `params` and `omit` name its
 * fields, and its forced choice is unforced in that shape.
 */
export function shapeRequest(body: Record<string, unknown>, model: ModelConfig, native = false): Record<string, unknown> {
    if (model.params === undefined && model.omit === undefined && model.forcedToolUse !== false) return body
    const omitted = new Set(model.omit ?? [])
    const out: Record<string, unknown> = Object.fromEntries(Object.entries({ ...model.params, ...body }).filter(([field]) => !omitted.has(field)))
    if (model.forcedToolUse !== false) return out
    return native ? unforcedNative(out) : unforced(out)
}
