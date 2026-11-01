"use client"

import type { ReactNode } from "react"
import { CheckIcon } from "@heroicons/react/16/solid"
import { CheckCircleIcon } from "@heroicons/react/24/outline"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { Icon } from "../../leaf/Icon/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import type { NoChildren } from "../../tier.js"
import { AvatarGroup } from "../AvatarGroup/index.js"

/** `incoming`: someone else wrote it (start side, the surface and its foreground). `outgoing`: the reader's own message (end side, the brand fill `--accent` with `--accent-foreground`). */
export type MessageBubbleSide = "incoming" | "outgoing"

/** People authority reports have read the message; the app supplies localized overflow copy. */
export type MessageBubbleReaders = {
    readonly items: ReadonlyArray<{ readonly id: string; readonly name: string; readonly src?: string }>
    /** Accessible copy for readers beyond the visible avatars. */
    readonly overflowLabel: string
    /** Additional readers outside the supplied list, already formatted by the app. */
    readonly moreLabel?: string
}

/** A persisted send, delivery or read receipt; only a read receipt can name readers. */
export type MessageBubbleReceipt = { readonly label: string } & (
    | { readonly kind: "sent" | "delivered"; readonly readers?: never }
    | { readonly kind: "seen"; readonly readers?: MessageBubbleReaders }
)

/** The transport's known delivery state; unknown requires reconciliation rather than an automatic resend. */
export type MessageBubbleDelivery = {
    readonly kind: "queued" | "sent" | "failed" | "unknown"
    /** Localized authority-owned copy, including the recovery guidance when the result is unknown. */
    readonly label: string
}

/** A resolved message. */
type MessageBubbleMessage = {
    readonly isLoading?: false
    readonly error?: never
    /** The message body. Plain text keeps its line breaks. */
    readonly body: ReactNode
    readonly side?: MessageBubbleSide
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
    /** Content under the body that is not part of the message text: an attachment, an approval card, a reaction row. */
    readonly footer?: ReactNode
    /** The persisted receipt under this message, with native marks and any known readers. */
    readonly receipt?: MessageBubbleReceipt
    /** A transport delivery note after attachments; its state chooses the native treatment. */
    readonly delivery?: MessageBubbleDelivery
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
const RECEIPT_READERS_SHOWN = 3

const Receipt = ({ receipt }: { readonly receipt: MessageBubbleReceipt }) => {
    const readers = receipt.kind === "seen" ? receipt.readers : undefined
    return (
        <div className="starci-core-message-bubble-receipt" data-grammar-message-receipt={receipt.kind}>
            <span className="starci-core-message-bubble-receipt-label" aria-live="polite" aria-atomic="true">
                <Icon source={receipt.kind === "delivered" ? CheckCircleIcon : CheckIcon} usage="chip" />
                {receipt.kind === "seen" ? <Icon source={CheckIcon} usage="chip" /> : null}
                {receipt.label}
            </span>
            {readers === undefined || readers.items.length === 0 ? null : (
                <AvatarGroup label={receipt.label} size="sm" max={RECEIPT_READERS_SHOWN}
                    items={readers.items.map((reader) => ({ ...reader, seed: reader.id }))}
                    overflowLabel={() => readers.overflowLabel} />
            )}
            {readers?.moreLabel === undefined ? null : <span className="starci-core-message-bubble-more-readers">{readers.moreLabel}</span>}
        </div>
    )
}

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
export const MessageBubble = (props: MessageBubbleProps) => {
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
    const { body, side = "incoming", author, avatar, meta, status, actions, footer, receipt, delivery, isHighlight = false, id } = props
    const hasHead = author != null || meta != null || status != null
    return (
        <div
            {...(id === undefined ? {} : { id })}
            className="starci-core-message-bubble"
            data-component="MessageBubble"
            data-tier="composite"
            data-contract="SURFACE-3 SURFACE-4 RADIUS-6"
            data-grammar-bubble-side={side}
            data-grammar-bubble-highlight={isHighlight ? "true" : "false"}
            data-grammar-bubble-footer={footer == null ? "false" : "true"}
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
                {delivery === undefined ? null : <div className="starci-core-message-bubble-delivery" data-grammar-message-delivery={delivery.kind} aria-live="polite" aria-atomic="true">{delivery.label}</div>}
                {receipt === undefined ? null : <Receipt receipt={receipt} />}
                {actions == null ? null : <div className="starci-core-message-bubble-actions" data-grammar-bubble-actions="toolbar"><ButtonPlacementProvider placement="chrome">{actions}</ButtonPlacementProvider></div>}
            </div>
        </div>
    )
}
