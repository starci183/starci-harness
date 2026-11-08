"use client"

import { ErrorView, type ErrorData } from "../../loadingState.js"
import { withRegionLoading } from "../../regionScope.js"
import type { ReactNode } from "react"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import type { NoChildren } from "../../tier.js"

/** `incoming`: someone else wrote it (start side, the surface and its foreground). `outgoing`: the reader's own message (end side, the brand fill `--accent` with `--accent-foreground`). */
export type MessageBubbleSide = "incoming" | "outgoing"

/**
 * `brand`: the solid brand fill (`--accent` with `--accent-foreground`), the reader's own words. `soft`: the brand's tint (`--accent-soft`
 * with `--accent-soft-foreground`), for an agent speaking on the reader's behalf (an AI's reply the reader may approve) so it reads as
 * a second voice, not as the reader's own. It only changes the face of an `outgoing` bubble.
 */
export type MessageBubbleTone = "brand" | "soft"

/**
 * Where the message actions sit. `floating` (the default): a small bordered toolbar outside the bubble, over the thread.
 * `inline`: a bare toolbar in the message row itself, on the reading end of the bubble, with no border, fill or shadow.
 */
export type MessageBubbleActionsPlacement = "floating" | "inline"

/** How far a bubble reaches across its row. `standard` (the default): a reading measure, at most 40rem and 85% of the row. `wide`: 70% of the row, for a chat stack that fills its column. */
export type MessageBubbleMeasure = "standard" | "wide"

/** A resolved message. */
type MessageBubbleMessage = {
    readonly isLoading?: false
    readonly error?: never
    /** The message body. Plain text keeps its line breaks. */
    readonly body: ReactNode
    readonly side?: MessageBubbleSide
    /** The face of an outgoing bubble; the brand fill when omitted. Never set on an incoming bubble. */
    readonly tone?: MessageBubbleTone
    /** Who wrote it, shown above the body. Omit on consecutive messages from the same author. */
    readonly author?: ReactNode
    /** An `Avatar` or `IconTile` beside the bubble. Omit (or pass the same width of nothing) on grouped follow-ups. */
    readonly avatar?: ReactNode
    /** The time or delivery state, muted after the author. */
    readonly meta?: ReactNode
    /** A short marker beside the author, e.g. a neutral `Badge` "AI". */
    readonly status?: ReactNode
    /**
     * Message actions (copy, reply, open): `IconButton`s (each with a `Tooltip`) drawn as a small floating toolbar beside the bubble on a
     * bordered surface, revealed on hover and keyboard focus inside the message. They take `chrome` placement (neutral = ghost).
     */
    readonly actions?: ReactNode
    /** Where `actions` sit; `floating` when omitted. `inline` draws them as a bare hover and focus toolbar in the row, beside the bubble on its reading end. Keyboard focus inside the message shows them in both. */
    readonly actionsPlacement?: MessageBubbleActionsPlacement
    /** The bubble's widest reach; `standard` when omitted. */
    readonly measure?: MessageBubbleMeasure
    /**
     * `text` (default): the body is words in the bubble face. `card`: the body is a structured card (what `MessageCard` renders): the face
     * is the surface card, its own padding and line breaks, capped at the same measure as a text bubble with the avatar at the start.
     */
    readonly content?: "text" | "card"
    /** Content under the body that is not part of the message text: an attachment, an approval card, a reaction row. */
    readonly footer?: ReactNode
    /** Draws the focus ring around the bubble, e.g. when a link jumps to this message. */
    readonly isHighlight?: boolean
    /** Anchor for links that jump to this message. */
    readonly id?: string
    readonly hasAvatar?: never
}

/**
 * One unresolved message (knowledge STATE-8): with a `side`, the bubble face on that side with two Skeleton text lines in the
 * body and, only with `hasAvatar`, a Skeleton circle in its column. No author, meta, status, actions or footer are drawn, so no
 * control exists. The bubble is `aria-hidden`.
 */
type MessageBubbleSkeleton = {
    readonly isLoading: true
    readonly side: MessageBubbleSide
    readonly hasAvatar?: boolean
    readonly error?: never
}

/**
 * A conversation whose messages have not been read (knowledge STATE-8): without a `side`, one `aria-busy` thread of bubbles that
 * alternate incoming and outgoing, the way a list of `MessageBubble` reads. The Grammar chooses how many. Place it as the
 * conversation content of a `PaneGrid` (or any scroll owner). `hasAvatar` gives each incoming bubble a Skeleton circle.
 */
type MessageBubbleSkeletonThread = {
    readonly isLoading: true
    readonly hasAvatar?: boolean
    readonly side?: never
    readonly error?: never
}

/** A conversation whose read failed: the failure in the place of the messages, never an empty thread. */
type MessageBubbleFailed = {
    readonly isLoading?: false
    readonly error: ErrorData
    readonly side?: never
    readonly hasAvatar?: never
}

export type MessageBubbleProps = NoChildren & (MessageBubbleMessage | MessageBubbleSkeleton | MessageBubbleSkeletonThread | MessageBubbleFailed)

const SKELETON_CONTRACT = "SURFACE-3 SURFACE-4 RADIUS-6 STATE-8"
const THREAD_LINES = [2, 1, 3] as const

const SkeletonBubble = ({ side, hasAvatar, lines = 2 }: { readonly side: MessageBubbleSide, readonly hasAvatar: boolean, readonly lines?: number }) => (
    <div
        aria-hidden="true"
        className="starci-core-message-bubble"
        data-component="MessageBubble"
        data-tier="composite"
        data-contract={SKELETON_CONTRACT}
        data-grammar-bubble-side={side}
        data-grammar-bubble-highlight="false"
        data-grammar-bubble-footer="false"
        data-grammar-skeleton="true"
    >
        {hasAvatar ? <div className="starci-core-message-bubble-avatar"><Skeleton shape="circle" size="sm" /></div> : null}
        <div className="starci-core-message-bubble-stack">
            <div className="starci-core-message-bubble-body starci-core-message-bubble-skeleton-body"><Skeleton shape="text" lines={lines} /></div>
        </div>
    </div>
)

/**
 * One message of a conversation. The app owns the thread (order, grouping, day dividers with `Divider label`, scroll with
 * `VerticalScrollRegion`); this owns the anatomy of a single message: avatar column, author line, the bubble face and its
 * actions. Faces follow SURFACE-2 (incoming, the surface pair) and the brand fill (outgoing, the accent pair; inline content inherits its foreground); the corner on
 * the author's side tightens to point at the avatar (RADIUS-6). With `isLoading` it draws inert geometry instead, one bubble or a
 * whole loading thread; with `error` the failure.
 */
const MessageBubbleInner = (props: MessageBubbleProps) => {
    if (props.isLoading === true) {
        if (props.side === undefined) {
            return (
                <div className="starci-core-message-bubble-thread" data-grammar-message-skeleton-thread="true" data-loading="true" aria-busy="true">
                    {THREAD_LINES.map((lines, index) => (
                        <SkeletonBubble key={index} side={index % 2 === 0 ? "incoming" : "outgoing"} hasAvatar={props.hasAvatar === true && index % 2 === 0} lines={lines} />
                    ))}
                </div>
            )
        }
        return <SkeletonBubble side={props.side} hasAvatar={props.hasAvatar === true} />
    }
    if (props.error !== undefined) return <div className="starci-core-message-bubble-thread" data-grammar-message-error="true"><ErrorView error={props.error} /></div>
    const { body, side = "incoming", tone = "brand", author, avatar, meta, status, actions, actionsPlacement = "floating", measure = "standard", content = "text", footer, isHighlight = false, id } = props
    const actionsToolbar = actions == null ? null : <div className="starci-core-message-bubble-actions" data-grammar-bubble-actions="toolbar"><ButtonPlacementProvider placement="chrome">{actions}</ButtonPlacementProvider></div>
    const hasHead = author != null || meta != null || status != null
    return (
        <div
            {...(id === undefined ? {} : { id })}
            className="starci-core-message-bubble"
            data-component="MessageBubble"
            data-tier="composite"
            data-contract="SURFACE-3 SURFACE-4 RADIUS-6"
            data-grammar-bubble-side={side}
            data-grammar-bubble-tone={side === "outgoing" ? tone : "brand"}
            data-grammar-bubble-highlight={isHighlight ? "true" : "false"}
            data-grammar-bubble-footer={footer == null ? "false" : "true"}
            data-grammar-bubble-measure={measure}
            data-grammar-bubble-content={content === "card" ? "card" : undefined}
            data-grammar-bubble-actions-placement={actions == null ? undefined : actionsPlacement}
        >
            {avatar == null ? null : <div className="starci-core-message-bubble-avatar">{avatar}</div>}
            <div className="starci-core-message-bubble-stack">
                {hasHead ? (
                    <div className="starci-core-message-bubble-head">
                        {author == null ? null : <span className="starci-core-message-bubble-author">{author}</span>}
                        {status}
                        {meta == null ? null : <span className="starci-core-message-bubble-meta">{meta}</span>}
                    </div>
                ) : null}
                <div className="starci-core-message-bubble-body">{body}</div>
                {footer == null ? null : <div className="starci-core-message-bubble-footer">{footer}</div>}
                {actions == null || actionsPlacement === "inline" ? null : actionsToolbar}
            </div>
            {actions == null || actionsPlacement !== "inline" ? null : actionsToolbar}
        </div>
    )
}

/**
 * One message of a conversation. The app owns the thread (order, grouping, day dividers with `Divider label`, scroll with
 * `VerticalScrollRegion`); this owns the anatomy of a single message: avatar column, author line, the bubble face and its
 * actions. Faces follow SURFACE-2 (incoming, the surface pair) and the brand fill (outgoing, the accent pair; inline content inherits its foreground); the corner on
 * the author's side tightens to point at the avatar (RADIUS-6). With `isLoading` it draws inert geometry instead, one bubble or a
 * whole loading thread; with `error` the failure.
 */
export const MessageBubble = withRegionLoading(MessageBubbleInner)
