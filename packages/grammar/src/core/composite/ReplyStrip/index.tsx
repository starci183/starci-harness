"use client"

import type { NoChildren } from "../../tier.js"
import type { AgentTone } from "../../leaf/Avatar/identity.js"

export type ReplyStripProps = NoChildren & {
    /** Who wrote the message this one answers, drawn after the reply glyph in the medium weight. */
    readonly author: string
    /** The words of that message: ONE muted line, cut with an ellipsis. */
    readonly text: string
    /** The accessible name, in the app's language ("Trả lời tin của Lan Nguyễn: chào em"). The visible parts are not read on their own. */
    readonly label: string
    /**
     * The tone of the edge bar: the replied author's agent tone (`agentToneOf(key)`), so an agent is told by its colour; `neutral` (default) for a person.
     */
    readonly tone?: AgentTone | "neutral"
    /** Pressing the strip (click, Enter, Space): the thread scrolls to the original message and highlights it. Omitted, the strip is static. */
    readonly onPress?: () => void
}

/** The reply glyph at 1em of the strip's text (a caret-like mark beside words takes the words' size). */
const ReplyGlyph = () => (
    <svg aria-hidden="true" className="starci-core-reply-strip-glyph" viewBox="0 0 20 20" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 5 3.5 9.5 8 14" />
        <path d="M4 9.5h7a5 5 0 0 1 5 5V16" />
    </svg>
)

/**
 * COMPOSITE - `ReplyStrip`: the message an answer replies to, as ONE compact line at the top inside the answer's bubble (Zalo, Messenger): a soft neutral ground,
 * a bar on its start edge in the replied author's tone (an agent's own tone, a person's neutral), the reply glyph at 1em and the author's name, then the original
 * words muted and ellipsized. No label with a colon, no quotation marks, no box in a box. With `onPress` it is a button that takes the reader to the original
 * (the thread scrolls there and rings it); its accessible name is the app's `label`. The thread decides when it shows: an answer to the message right above it
 * needs none.
 * Contract: A11Y-2 (the glyph is decorative; the label names the strip), FOCUS-1 (a visible focus ring when it is a button).
 */
export const ReplyStrip = ({ author, text, label, tone = "neutral", onPress }: ReplyStripProps) => {
    const parts = (
        <>
            <ReplyGlyph />
            <span className="starci-core-reply-strip-author">{author}</span>
            <span className="starci-core-reply-strip-text">{text}</span>
        </>
    )
    const common = {
        className: "starci-core-reply-strip",
        "data-component": "ReplyStrip",
        "data-contract": "A11Y-2 FOCUS-1",
        "data-tier": "composite",
        "aria-label": label,
        title: `${author}: ${text}`,
        ...(tone === "neutral" ? {} : { "data-grammar-agent-tone": tone }),
    } as const
    if (onPress === undefined) {
        return (
            <div {...common} role="group">
                {parts}
            </div>
        )
    }
    return (
        <button {...common} type="button" onClick={() => onPress()}>
            {parts}
        </button>
    )
}
