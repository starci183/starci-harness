"use client"

import type { ReactNode } from "react"
import { Button } from "../../leaf/Button/index.js"
import { Text } from "../../leaf/Text/index.js"
import { DescriptionList, type DescriptionListItem } from "../DescriptionList/index.js"
import { MessageBubble, type MessageBubbleGroupPosition, type MessageBubbleMeasure, type MessageReaction, type MessageReactionLabels } from "../MessageBubble/index.js"
import type { NoChildren } from "../../tier.js"

/**
 * One action of a message card. `primary` (at most one) stands first as the commit Button; `neutral` (default) actions follow;
 * `open` leads somewhere ("Mở ..."): a neutral Button ending in Grammar's arrow, always last. Give `onPress` or `href`.
 */
export type MessageCardAction = {
    readonly id: string
    readonly label: string
    readonly kind?: "primary" | "neutral" | "open"
    readonly onPress?: () => void
    readonly href?: string
    readonly isPending?: boolean
}

type MessageCardBody =
    | { readonly body?: ReactNode, readonly details?: undefined }
    | { readonly body?: undefined, readonly details: ReadonlyArray<DescriptionListItem> }

export type MessageCardProps = NoChildren & MessageCardBody & {
    /** Who wrote it, above the card (as `MessageBubble author`). */
    readonly author?: ReactNode
    /** An `Avatar` or `IconTile` at the start of the card. */
    readonly avatar?: ReactNode
    readonly title: string
    /** The status beside the title: one `Badge`. */
    readonly chip?: ReactNode
    /** The actions row; the primary first, an `open` action last. */
    readonly actions?: ReadonlyArray<MessageCardAction>
    /** The meta line under the card, muted at xs ("Sales · 04:38"). */
    readonly meta?: string
    /** The card's widest reach; `standard` (40rem or 85%) when omitted, `wide` (70%) for a chat stack that uses it. */
    readonly measure?: MessageBubbleMeasure
    readonly id?: string
    /** As `MessageBubble groupPosition`. */
    readonly groupPosition?: MessageBubbleGroupPosition
    /** As `MessageBubble reactions`, `onReact`, `onReply`, `onShare` and `reactionLabels`: the same lifted card, pill and toolbar. */
    readonly reactions?: ReadonlyArray<MessageReaction>
    readonly onReact?: (emoji: string) => void
    readonly onReply?: () => void
    readonly onShare?: () => void
    readonly reactionLabels?: MessageReactionLabels
}

const ORDER = { primary: 0, neutral: 1, open: 2 } as const

const ActionButton = ({ action }: { readonly action: MessageCardAction }) => {
    const kind = action.kind ?? "neutral"
    const destination = action.href === undefined ? (action.onPress === undefined ? {} : { onPress: action.onPress }) : { href: action.href }
    const shared = { intent: kind === "primary" ? "commit" as const : "neutral" as const, size: "sm" as const, isPending: action.isPending === true, ...destination }
    return kind === "open" ? <Button {...shared} endArrow>{action.label}</Button> : <Button {...shared}>{action.label}</Button>
}

/**
 * An agent's rich message as data: `MessageBubble content="card"` with a fixed order, the title with its chip, then the body (or a
 * nested key/value list through `details`), then the actions row (primary first, an `open` action with the arrow last), then the
 * meta line at xs. The card is capped at the bubble's measure with the avatar at the start, so an app needs no CSS of its own.
 */
export const MessageCard = ({ author, avatar, title, chip, body, details, actions, meta, measure, id, groupPosition, reactions, onReact, onReply, onShare, reactionLabels }: MessageCardProps) => {
    const ordered = actions === undefined ? [] : [...actions].sort((a, b) => ORDER[a.kind ?? "neutral"] - ORDER[b.kind ?? "neutral"])
    return (
        <MessageBubble
            content="card"
            {...(id === undefined ? {} : { id })}
            {...(author === undefined ? {} : { author })}
            {...(avatar === undefined ? {} : { avatar })}
            {...(measure === undefined ? {} : { measure })}
            {...(groupPosition === undefined ? {} : { groupPosition })}
            {...(reactions === undefined ? {} : { reactions })}
            {...(onReact === undefined ? {} : { onReact })}
            {...(onReply === undefined ? {} : { onReply })}
            {...(onShare === undefined ? {} : { onShare })}
            {...(reactionLabels === undefined ? {} : { reactionLabels })}
            body={
                <div className="starci-core-message-card" data-component="MessageCard" data-tier="composite" data-contract="GAP-2 PADDING-4">
                    <div className="starci-core-message-card-head">
                        <Text size="md" isStrong>{title}</Text>
                        {chip}
                    </div>
                    {body == null ? null : <div className="starci-core-message-card-body">{body}</div>}
                    {details === undefined ? null : <DescriptionList items={details} density="compact" layout="columns" />}
                    {ordered.length === 0 ? null : (
                        <div className="starci-core-message-card-actions" role="group" aria-label={title}>
                            {ordered.map((action) => <ActionButton key={action.id} action={action} />)}
                        </div>
                    )}
                    {meta === undefined ? null : <Text size="xs" tone="muted">{meta}</Text>}
                </div>
            }
        />
    )
}
