import type { ReactNode } from "react"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import type { NoChildren } from "../../tier.js"

/** `incoming`: someone else wrote it (start side, the surface and its foreground). `outgoing`: the reader's own message (end side, the brand fill `--accent` with `--accent-foreground`). */
export type MessageBubbleSide = "incoming" | "outgoing"

/** A resolved message. */
type MessageBubbleMessage = {
    readonly isSkeleton?: false
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
    /** Draws the focus ring around the bubble, e.g. when a link jumps to this message. */
    readonly isHighlight?: boolean
    /** Anchor for links that jump to this message. */
    readonly id?: string
    readonly rows?: never
    readonly hasAvatar?: never
}

/**
 * One unresolved message (knowledge STATE-8): the bubble face on its `side`, with two Skeleton text lines in the body and, only
 * with `hasAvatar`, a Skeleton circle in its column. No author, meta, status, actions or footer are drawn, so no control exists.
 * The bubble is `aria-hidden`.
 */
type MessageBubbleSkeleton = {
    readonly isSkeleton: true
    readonly side?: MessageBubbleSide
    readonly hasAvatar?: boolean
    readonly rows?: undefined
}

/**
 * A loading conversation (knowledge STATE-8): `rows` skeleton bubbles (1 to 12) that alternate incoming and outgoing, starting with
 * `incoming`, inside one `aria-busy` thread. Place it as the conversation content of a `PaneGrid` (or any scroll owner) while the
 * messages are unresolved. `hasAvatar` gives each incoming bubble a Skeleton circle.
 */
type MessageBubbleSkeletonThread = {
    readonly isSkeleton: true
    readonly rows: number
    readonly hasAvatar?: boolean
    readonly side?: never
}

export type MessageBubbleProps = NoChildren & (MessageBubbleMessage | MessageBubbleSkeleton | MessageBubbleSkeletonThread)

const SKELETON_CONTRACT = "SURFACE-3 SURFACE-4 RADIUS-6 STATE-8"
const THREAD_MAX = 12

const SkeletonBubble = ({ side, hasAvatar }: { readonly side: MessageBubbleSide, readonly hasAvatar: boolean }) => (
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
            <div className="starci-core-message-bubble-body starci-core-message-bubble-skeleton-body"><Skeleton shape="text" lines={2} /></div>
        </div>
    </div>
)

/**
 * One message of a conversation. The app owns the thread (order, grouping, day dividers with `Divider label`, scroll with
 * `VerticalScrollRegion`); this owns the anatomy of a single message: avatar column, author line, the bubble face and its
 * actions. Faces follow SURFACE-2 (incoming, the surface pair) and the brand fill (outgoing, the accent pair; inline content inherits its foreground); the corner on
 * the author's side tightens to point at the avatar (RADIUS-6). With `isSkeleton` it draws inert geometry instead, one bubble or a
 * whole loading thread (`rows`).
 */
export const MessageBubble = (props: MessageBubbleProps) => {
    if (props.isSkeleton === true) {
        if (props.rows !== undefined) {
            const count = Math.min(THREAD_MAX, Math.max(1, Math.floor(Number.isFinite(props.rows) ? props.rows : 1)))
            return (
                <div className="starci-core-message-bubble-thread" data-grammar-message-skeleton-thread="true" data-loading="true" aria-busy="true">
                    {Array.from({ length: count }, (_, index) => (
                        <SkeletonBubble key={index} side={index % 2 === 0 ? "incoming" : "outgoing"} hasAvatar={props.hasAvatar === true && index % 2 === 0} />
                    ))}
                </div>
            )
        }
        return <SkeletonBubble side={props.side ?? "incoming"} hasAvatar={props.hasAvatar === true} />
    }
    const { body, side = "incoming", author, avatar, meta, status, actions, footer, isHighlight = false, id } = props
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
                {actions == null ? null : <div className="starci-core-message-bubble-actions" data-grammar-bubble-actions="toolbar"><ButtonPlacementProvider placement="chrome">{actions}</ButtonPlacementProvider></div>}
            </div>
        </div>
    )
}
