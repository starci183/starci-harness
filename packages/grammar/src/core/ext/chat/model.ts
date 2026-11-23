import type { ThreadMessageLike } from "@assistant-ui/react"
import type { MarkState } from "../../statusMark.js"
import type { AiChatLabels, AiChatMessage, AiChatPart } from "./types.js"

type ToolCallPart = Extract<AiChatPart, { type: "tool-call" }>

/** The words of the jump-to-latest control when the app passes none. */
export const DEFAULT_AI_CHAT_LATEST = "Jump to latest"

/** A JSON value as assistant-ui carries a tool call's arguments: anything that is not plain JSON is written as its string. */
const toJson = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
    if (Array.isArray(value)) return value.map(toJson)
    if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toJson(item)]))
    return String(value)
}

/**
 * The app's message as assistant-ui's external store reads it (`convertMessage`): the same id and role, the text parts and the tool calls
 * (an `error` call is `isError`), and an assistant turn that stopped on a failure as `incomplete`. The status of every other turn is left to
 * the runtime, which derives it from `isRunning`.
 */
export const toThreadMessage = (message: AiChatMessage): ThreadMessageLike => ({
    id: message.id,
    role: message.role,
    content: message.parts.map((part) => part.type === "text"
        ? { type: "text" as const, text: part.text }
        : {
            type: "tool-call" as const,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: toJson(part.args) as Record<string, never>,
            ...(part.result === undefined ? {} : { result: part.result }),
            ...(part.status === "error" ? { isError: true } : {}),
        }),
    ...(message.createdAt === undefined || Number.isNaN(Date.parse(message.createdAt)) ? {} : { createdAt: new Date(message.createdAt) }),
    ...(message.role === "assistant" && message.status === "error" ? { status: { type: "incomplete" as const, reason: "error" as const } } : {}),
})

/** The words of a message as the reader would paste them: its text parts in order, one blank line between them. */
export const textOfMessage = (message: AiChatMessage): string =>
    message.parts.flatMap((part) => (part.type === "text" && part.text.trim() !== "" ? [part.text] : [])).join("\n\n")

/** True while a message has nothing to show yet: no words and no tool call. */
export const isEmptyMessage = (message: AiChatMessage | undefined): boolean =>
    message === undefined || message.parts.every((part) => part.type === "text" && part.text.trim() === "")

/** The id of the last assistant message, the one that carries the retry. */
export const lastAssistantId = (messages: readonly AiChatMessage[]): string | null => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message?.role === "assistant") return message.id
    }
    return null
}

/** Each tool call of the thread by its id, so the drawing of a part reads the app's own title and status. */
export const toolCallsById = (messages: readonly AiChatMessage[]): ReadonlyMap<string, ToolCallPart> =>
    new Map(messages.flatMap((message) => message.parts.flatMap((part) => (part.type === "tool-call" ? [[part.toolCallId, part] as const] : []))))

/** The status mark of a tool call and its words. */
export const toolStatusOf = (status: ToolCallPart["status"], labels: Pick<AiChatLabels, "toolRunning" | "toolDone" | "toolError">): { readonly state: MarkState; readonly label: string } =>
    status === "done" ? { state: "done", label: labels.toolDone } : status === "error" ? { state: "error", label: labels.toolError } : { state: "running", label: labels.toolRunning }

/** A value as the reader reads it: a string as it is, anything else as indented JSON. */
export const formatValue = (value: unknown): string => {
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2) ?? String(value)
    } catch {
        return String(value)
    }
}

/** The text a send would post, or null when there is nothing to send: blank text, an answer still running, or a closed composer. */
export const sendableText = (text: string, isRunning: boolean, isDisabled: boolean): string | null =>
    isRunning || isDisabled || text.trim() === "" ? null : text.trim()
