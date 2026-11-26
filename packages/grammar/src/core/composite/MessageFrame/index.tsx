"use client"

import type { ReactNode } from "react"
import type { StatusDotTone } from "../../leaf/StatusDot/index.js"
import type { NoChildren } from "../../tier.js"
import { MessageBubble, type MessageBubbleGroupPosition, type MessageBubbleMeasure, type MessageBubbleSide } from "../MessageBubble/index.js"
import { MessageCard, type MessageCardAction } from "../MessageCard/index.js"

/** The most actions a frame's card draws (owner 2026-11-26): the first is the card's one primary, the next two are secondary. A fourth is not drawn. */
export const MESSAGE_FRAME_MAX_ACTIONS = 3

/** One action of a frame card: a label and a destination (`href`) or a press. The first of the list is the primary one, whatever the others are. */
export type MessageFrameAction = {
    readonly id: string
    readonly label: string
    readonly onPress?: () => void
    readonly href?: string
    readonly isPending?: boolean
}

/** One field of a frame card: what it is, and its value. Both are words in the app's language. */
export type MessageFrameField = {
    readonly id?: string
    readonly label: string
    readonly value: ReactNode
}

/**
 * What a structured chat frame says, as plain data the app builds from its own frame (a new lead, a contact that is overdue, a booking made, a job cancelled, a system
 * message): the title, a status only when the subject is really in a state, the field and value rows, at most three actions and a muted meta line. Grammar draws the
 * one card from it; it knows no kind of frame and no copy.
 */
export type MessageFrameCard = {
    readonly title: string
    /** A real state (overdue, cancelled, paused, failed) as a dot with its words; omit it for a card that only informs. */
    readonly status?: { readonly tone: StatusDotTone; readonly label: string }
    readonly fields?: ReadonlyArray<MessageFrameField>
    /** At most three are drawn; the first is the primary action of the card. */
    readonly actions?: ReadonlyArray<MessageFrameAction>
    /** The muted line under the card ("14:16"). */
    readonly meta?: string
}

export type MessageFrameProps = NoChildren & {
    /** The frame's kind as the sender wrote it (`lead.new`, `job.cancelled`...); it names the frame in the markup and decides nothing else. */
    readonly kind: string
    /**
     * The card for a kind the app knows, built from the frame's data. A kind the app does not know (an older app, a newer sender) passes no card, or one that is not
     * valid (no title), and the frame falls back to its `text` line, so a message is never lost and never blank.
     */
    readonly card?: MessageFrameCard | null
    /** The text line of the frame: the whole message of a plain frame, the fallback of a frame whose kind has no card. A plain frame reads it as safe Markdown. */
    readonly text: string
    /** How `text` is read: `markdown` (default, safe Markdown) or `plain`. */
    readonly format?: "plain" | "markdown"
    readonly author?: ReactNode
    readonly isAgent?: boolean
    readonly agentLabel?: string
    readonly avatar?: ReactNode
    readonly side?: MessageBubbleSide
    readonly meta?: ReactNode
    readonly measure?: MessageBubbleMeasure
    readonly id?: string
    readonly groupPosition?: MessageBubbleGroupPosition
}

/** A card that can be drawn: a title with words, fields with a label, actions with a label. Anything less is a frame the sender built badly: it falls back to its text. */
const drawable = (card: MessageFrameCard | null | undefined): card is MessageFrameCard =>
    card !== null && card !== undefined && typeof card.title === "string" && card.title.trim() !== ""

const cardActions = (actions: ReadonlyArray<MessageFrameAction> | undefined): ReadonlyArray<MessageCardAction> =>
    (actions ?? [])
        .filter((action) => action.label.trim() !== "")
        .slice(0, MESSAGE_FRAME_MAX_ACTIONS)
        .map((action, index) => ({
            id: action.id,
            label: action.label,
            kind: index === 0 ? "primary" as const : "neutral" as const,
            ...(action.onPress === undefined ? {} : { onPress: action.onPress }),
            ...(action.href === undefined ? {} : { href: action.href }),
            ...(action.isPending === undefined ? {} : { isPending: action.isPending }),
        }))

/**
 * The one chat card for a structured message frame (owner 2026-11-26: "thông báo cũng làm card đẹp chứ không chat suông"). One shared anatomy for every kind of frame:
 * the title (with a status dot only for a real state), the field and value rows, up to three actions (the first is the primary of the card), the meta line, in the compact
 * density. A frame with no card, or an invalid one, is its text line in a bubble, read as safe Markdown, so an unknown kind degrades to words and never breaks the thread.
 * It sets `data-grammar-frame-kind` and `data-grammar-frame="card" | "text"` on its message so an app and a test can tell which it drew.
 */
export const MessageFrame = ({ kind, card, text, format = "markdown", author, isAgent, agentLabel, avatar, side, meta, measure, id, groupPosition }: MessageFrameProps) => {
    if (drawable(card)) {
        const fields = (card.fields ?? []).filter((field) => field.label.trim() !== "")
        const actions = cardActions(card.actions)
        return (
            <div className="starci-core-message-frame" data-component="MessageFrame" data-tier="composite" data-grammar-frame="card" data-grammar-frame-kind={kind}>
                <MessageCard
                    title={card.title}
                    density="compact"
                    {...(card.status === undefined ? {} : { status: card.status })}
                    {...(fields.length === 0 ? {} : { details: fields.map((field, index) => ({ id: field.id ?? `${index}`, term: field.label, description: field.value })) })}
                    {...(actions.length === 0 ? {} : { actions })}
                    {...(card.meta === undefined ? {} : { meta: card.meta })}
                    {...(author === undefined ? {} : { author })}
                    {...(avatar === undefined ? {} : { avatar })}
                    {...(measure === undefined ? {} : { measure })}
                    {...(id === undefined ? {} : { id })}
                    {...(groupPosition === undefined ? {} : { groupPosition })}
                />
            </div>
        )
    }
    return (
        <div className="starci-core-message-frame" data-component="MessageFrame" data-tier="composite" data-grammar-frame="text" data-grammar-frame-kind={kind}>
            <MessageBubble
                body={text}
                format={format}
                {...(side === undefined ? {} : { side })}
                {...(author === undefined ? {} : { author })}
                {...(isAgent === undefined ? {} : { isAgent })}
                {...(agentLabel === undefined ? {} : { agentLabel })}
                {...(avatar === undefined ? {} : { avatar })}
                {...(meta === undefined ? {} : { meta })}
                {...(measure === undefined ? {} : { measure })}
                {...(id === undefined ? {} : { id })}
                {...(groupPosition === undefined ? {} : { groupPosition })}
            />
        </div>
    )
}
