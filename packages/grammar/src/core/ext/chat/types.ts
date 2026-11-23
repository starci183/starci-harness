import type { ReactNode } from "react"

/**
 * One part of a message: its words (markdown, drawn with the core's `Markdown`) or one tool call the assistant made, with its own title in the
 * app's words, the arguments it was called with, its result once there is one, and where it stands.
 */
export type AiChatPart =
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; title: string; args: Record<string, unknown>; result?: unknown; status: "running" | "done" | "error" }

/** One turn of the conversation. The app owns the list: it appends the reader's turn on `onSend` and grows the assistant's as it streams. */
export interface AiChatMessage {
    id: string
    role: "user" | "assistant"
    parts: AiChatPart[]
    /** An assistant turn: `running` while it streams, `complete`, or `error` when it stopped on a failure (the retry stays offered). */
    status?: "running" | "complete" | "error"
    /** ISO 8601. */
    createdAt?: string
}

/** One fact of the proposed result: its name and its value, which may be long text over several lines. */
export interface AiChatResultRow { label: string; value: string }

/** The proposed final result the assistant arrived at, shown after the last message for the reader to approve or keep revising. */
export interface AiChatResultPreview {
    title: string
    rows: AiChatResultRow[]
    /** The one primary of the card ("Đúng ý, làm tiếp"). */
    approveLabel: string
    /** The border action that sends the reader back to the composer ("Sửa tiếp"). */
    reviseLabel: string
    /** The approval is in flight: the approve action keeps its name and blocks a second press. */
    approving?: boolean
    /** The reader approved it: the actions give way to the approve words marked done. */
    approved?: boolean
}

/** Every word the thread speaks, in the app's language: Grammar writes none of its own (bar the English default of `latest`). */
export interface AiChatLabels {
    placeholder: string
    send: string
    stop: string
    retry: string
    copy: string
    thinking: string
    toolRunning: string
    toolDone: string
    toolError: string
    empty?: string
    /** The name of the control that jumps back to the newest message after the reader scrolled up; "Jump to latest" when omitted. */
    latest?: string
}

export interface AiChatThreadProps {
    messages: AiChatMessage[]
    /** An assistant answer is streaming or pending. */
    isRunning: boolean
    onSend: (text: string) => void | Promise<void>
    /** Stops the running answer; without it the composer's action stays a disabled send while an answer runs. */
    onStop?: () => void
    /** Regenerates the last assistant answer (offered on the last assistant message when nothing runs). */
    onRetry?: () => void
    /** The proposed final result, shown after the last message. */
    preview?: AiChatResultPreview | null
    /** The ONE primary of the preview region. */
    onApprove?: () => void
    /** The border action of the preview; the composer takes the focus after it. */
    onRevise?: () => void
    labels: AiChatLabels
    /** A slot above the thread (the app's title, a back link). */
    header?: ReactNode
    /** The composer is read-only (the session is closed). */
    disabled?: boolean
    className?: string
}
