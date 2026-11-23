"use client"

import {
    AssistantRuntimeProvider,
    MessagePrimitive,
    ThreadPrimitive,
    useExternalStoreRuntime,
    useThreadViewport,
    useThreadViewportStore,
    type AppendMessage,
    type TextMessagePartProps,
    type ToolCallMessagePartProps,
} from "@assistant-ui/react"
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react"
import { Textarea } from "../../branch/Textarea/index.js"
import { MessageBubble } from "../../composite/MessageBubble/index.js"
import { DEFAULT_AI_CHAT_LATEST, isEmptyMessage, lastAssistantId, sendableText, textOfMessage, toolCallsById, toThreadMessage } from "./model.js"
import { AiChatEmpty, AiChatJumpToLatest, AiChatMessageActions, AiChatPreviewCard, AiChatText, AiChatThinking, AiChatToolCard, AiChatUserText } from "./parts.js"
import type { AiChatLabels, AiChatMessage, AiChatPart, AiChatThreadProps } from "./types.js"

type ToolCallPart = Extract<AiChatPart, { type: "tool-call" }>

/** What the drawing of a message reads beside assistant-ui's state: the app's own messages, tool calls and words. */
type ThreadScope = {
    readonly byId: ReadonlyMap<string, AiChatMessage>
    readonly tools: ReadonlyMap<string, ToolCallPart>
    readonly labels: AiChatLabels
    readonly isRunning: boolean
    readonly retryId: string | null
    readonly retry: () => void
}

const ThreadScopeContext = createContext<ThreadScope | null>(null)

const useThreadScope = (): ThreadScope => {
    const scope = useContext(ThreadScopeContext)
    if (scope === null) throw new Error("AiChatThread: a message is drawn outside its thread")
    return scope
}

/** The words of a text part, as assistant-ui streams them: each new token re-renders the growing text. */
const TextPart = ({ text }: TextMessagePartProps) => <AiChatText text={text} copy={useThreadScope().labels.copy} />

/** A tool call, drawn from the app's own part (its title and status) when it has one, else from what assistant-ui carries. */
const ToolPart = ({ toolCallId, toolName, args, result, isError }: ToolCallMessagePartProps) => {
    const { tools, labels } = useThreadScope()
    const part: ToolCallPart = tools.get(toolCallId) ?? {
        type: "tool-call", toolCallId, toolName, title: toolName, args: { ...args }, ...(result === undefined ? {} : { result }), status: isError === true ? "error" : result === undefined ? "running" : "done",
    }
    return <AiChatToolCard part={part} labels={labels} />
}

const PART_COMPONENTS = { Text: TextPart, tools: { Fallback: ToolPart } }

/** The reader's turn: the brand bubble at the end side. */
const UserTurn = ({ message }: { readonly message: AiChatMessage | undefined }) => (
    <MessagePrimitive.Root className="starci-ai-chat-turn" data-grammar-ai-chat-role="user">
        <MessageBubble side="outgoing" body={<AiChatUserText text={message === undefined ? "" : textOfMessage(message)} />} />
    </MessagePrimitive.Root>
)

/**
 * An assistant turn: plain words across the column (no bubble), its tool calls in order, the thinking mark while it has nothing yet, and under
 * it copy and, on the last one, retry.
 */
const AssistantTurn = ({ id, message, isLast }: { readonly id: string; readonly message: AiChatMessage | undefined; readonly isLast: boolean }) => {
    const { labels, isRunning, retryId, retry } = useThreadScope()
    const isStreaming = isLast && isRunning
    const thinking = isStreaming && isEmptyMessage(message)
    const text = message === undefined ? "" : textOfMessage(message)
    return (
        <MessagePrimitive.Root className="starci-ai-chat-turn" data-grammar-ai-chat-role="assistant" {...(message?.status === undefined ? {} : { "data-grammar-ai-chat-status": message.status })}>
            <div className="starci-ai-chat-answer">
                <MessagePrimitive.Parts components={PART_COMPONENTS} />
                {thinking ? <AiChatThinking label={labels.thinking} /> : null}
            </div>
            {isStreaming ? null : <AiChatMessageActions text={text} labels={labels} onRetry={retryId === id ? retry : undefined} />}
        </MessagePrimitive.Root>
    )
}

/** Shown while the reader is scrolled up from the newest message; it scrolls the viewport back down. */
const JumpToLatest = ({ label }: { readonly label: string }) => {
    const isAtBottom = useThreadViewport((state) => state.isAtBottom)
    const store = useThreadViewportStore()
    if (isAtBottom) return null
    return <AiChatJumpToLatest label={label} onPress={() => store.getState().scrollToBottom({ behavior: "smooth" })} />
}

const appendedText = (message: AppendMessage): string =>
    message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

/**
 * EXT - `AiChatThread` (`@starci/grammar/core/ext/chat`): a whole chat with an assistant, the way Claude and Codex draw one. Built on
 * assistant-ui's headless primitives over its EXTERNAL STORE runtime (`useExternalStoreRuntime`): the app owns the messages and the run, and
 * every send, stop and retry goes through the runtime to the app's callbacks; assistant-ui keeps the viewport (it follows a streaming answer
 * while the reader is at the foot and stops when the reader scrolls up). Everything it draws is Grammar: the reader's turns are brand
 * `MessageBubble`s at the end side, an assistant turn is plain markdown across a centred reading column (the core's `Markdown`, fences in the
 * code palette), a tool call is a folded row with its status mark, the proposed result a card whose approve is the region's one primary, and
 * the composer is the core's chat composer (Enter sends, Shift+Enter breaks the line, 1 to 6 lines), its send turning into stop while an
 * answer runs. The frame is the chat frame: head, thread and composer on `--background`, hairlines between them, only the thread scrolls.
 */
export const AiChatThread = ({ messages, isRunning, onSend, onStop, onRetry, preview, onApprove, onRevise, labels, header, disabled = false, className }: AiChatThreadProps) => {
    const [draft, setDraft] = useState("")
    const composerId = `ai-chat-composer-${useId()}`
    const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
    const tools = useMemo(() => toolCallsById(messages), [messages])
    const retryId = onRetry === undefined || isRunning ? null : lastAssistantId(messages)
    const runtime = useExternalStoreRuntime<AiChatMessage>({
        messages,
        isRunning,
        isDisabled: disabled,
        convertMessage: toThreadMessage,
        onNew: async (message) => { await onSend(appendedText(message)) },
        ...(onStop === undefined ? {} : { onCancel: async () => { onStop() } }),
        ...(onRetry === undefined ? {} : { onReload: async () => { onRetry() } }),
    })
    const retry = () => {
        const index = messages.findIndex((message) => message.id === retryId)
        runtime.thread.startRun({ parentId: index > 0 ? messages[index - 1]?.id ?? null : null })
    }
    const scope = useMemo<ThreadScope>(() => ({ byId, tools, labels, isRunning, retryId, retry }), [byId, tools, labels, isRunning, retryId, runtime])
    const send = () => {
        const text = sendableText(draft, isRunning, disabled)
        if (text === null) return
        setDraft("")
        runtime.thread.append({ role: "user", content: [{ type: "text", text }] })
    }
    const stop = () => { runtime.thread.cancelRun() }
    const revise = () => {
        onRevise?.()
        const composer = typeof document === "undefined" ? null : document.getElementById(composerId)
        if (composer instanceof HTMLTextAreaElement) composer.focus()
    }
    const canStop = isRunning && onStop !== undefined
    const renderMessage = ({ message }: { readonly message: { readonly id: string; readonly role: string; readonly isLast: boolean } }): ReactNode =>
        message.role === "user"
            ? <UserTurn message={byId.get(message.id)} />
            : <AssistantTurn id={message.id} message={byId.get(message.id)} isLast={message.isLast} />
    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <ThreadScopeContext.Provider value={scope}>
                <ThreadPrimitive.Root
                    className={className === undefined ? "starci-ai-chat" : `starci-ai-chat ${className}`}
                    data-component="AiChatThread"
                    data-tier="ext"
                    data-contract="A11Y-1 A11Y-2 FEEDBACK-1"
                    data-grammar-ai-chat-running={isRunning ? "true" : "false"}
                >
                    {header === undefined || header === null ? null : <div className="starci-ai-chat-head">{header}</div>}
                    <ThreadPrimitive.Viewport className="starci-ai-chat-viewport" data-grammar-ai-chat-viewport="true">
                        <div className="starci-ai-chat-column" aria-busy={isRunning}>
                            {messages.length === 0 && !isRunning && labels.empty !== undefined ? <AiChatEmpty message={labels.empty} /> : null}
                            <ThreadPrimitive.Messages>{renderMessage}</ThreadPrimitive.Messages>
                            {preview === undefined || preview === null ? null : <AiChatPreviewCard preview={preview} onApprove={onApprove} onRevise={onRevise === undefined ? undefined : revise} />}
                        </div>
                        <JumpToLatest label={labels.latest ?? DEFAULT_AI_CHAT_LATEST} />
                    </ThreadPrimitive.Viewport>
                    <div className="starci-ai-chat-composer">
                        <div className="starci-ai-chat-column">
                            <Textarea
                                id={composerId}
                                label={labels.placeholder}
                                isLabelHidden
                                placeholder={labels.placeholder}
                                value={draft}
                                onValueChange={setDraft}
                                onSubmitShortcut={send}
                                isReadOnly={disabled}
                                send={canStop
                                    ? { label: labels.stop, glyph: "stop", onPress: stop }
                                    : { label: labels.send, onPress: send, isDisabled: disabled || isRunning || draft.trim() === "" }}
                            />
                        </div>
                    </div>
                </ThreadPrimitive.Root>
            </ThreadScopeContext.Provider>
        </AssistantRuntimeProvider>
    )
}
