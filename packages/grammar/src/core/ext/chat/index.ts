"use client"

/**
 * `@starci/grammar/core/ext/chat`: the AI chat extension of the core grammar. `AiChatThread` is a whole chat with an assistant (Claude or
 * Codex style) over assistant-ui's headless primitives and its external store runtime: the app owns the messages, Grammar draws every part.
 * An app never imports `@assistant-ui/react` itself (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY); it is an optional peer dependency, installed only
 * by an app that shows this chat. The ext imports core's components and tokens; core never imports it. Import `@starci/grammar/core/ext/chat.css`
 * after the Grammar's styles.
 */
export { AiChatThread } from "./AiChatThread.js"
export type { AiChatLabels, AiChatMessage, AiChatPart, AiChatResultPreview, AiChatResultRow, AiChatThreadProps } from "./types.js"
export { DEFAULT_AI_CHAT_LATEST, formatValue, sendableText, textOfMessage, toolStatusOf, toThreadMessage } from "./model.js"
