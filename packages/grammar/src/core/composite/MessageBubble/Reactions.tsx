"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"

/** The six reactions of the picker, in order. */
export const REACTION_EMOJI = ["❤️", "👍", "😆", "😮", "😢", "😡"] as const

/**
 * One emoji on a message: `count` is everyone's total, `mine` is what the viewer sent (`true` is one, a number is how many
 * times; Zalo-style, the same person may tap many times and the count grows). Pure presentation: the app persists.
 */
export type MessageReaction = {
    readonly emoji: string
    readonly count: number
    readonly mine: boolean | number
}

/** The words of the reaction parts; the defaults are Vietnamese. */
export type MessageReactionLabels = {
    /** The accessible name of the picker toolbar. */
    readonly toolbar: string
    readonly reply: string
    readonly share: string
    /** The name of one emoji button (by emoji), e.g. `Thả ❤️`. */
    readonly react: (emoji: string) => string
    /** The pill's accessible name from its summary ("❤️ 5") and how many the viewer sent. */
    readonly pill: (summary: string, mine: number) => string
}

export const DEFAULT_REACTION_LABELS: MessageReactionLabels = {
    toolbar: "Thao tác với tin nhắn",
    reply: "Trả lời",
    share: "Chuyển tiếp",
    react: (emoji) => `Thả ${emoji}`,
    pill: (summary, mine) => (mine > 0 ? `${summary}, bạn đã thả ${mine}` : summary),
}

export const mineCount = (reaction: MessageReaction): number => (typeof reaction.mine === "number" ? reaction.mine : reaction.mine ? 1 : 0)

/** The viewer's top reaction (most sent by the viewer), else the most used one. */
export const topReaction = (reactions: ReadonlyArray<MessageReaction>): string | undefined => {
    const mine = reactions.filter((reaction) => mineCount(reaction) > 0).sort((a, b) => mineCount(b) - mineCount(a))
    return (mine[0] ?? [...reactions].sort((a, b) => b.count - a.count)[0])?.emoji
}

const ReplyMark = () => (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 5 3.5 9.5 8 14" />
        <path d="M4 9.5h7a5 5 0 0 1 5 5V16" />
    </svg>
)

const ShareMark = () => (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5l4.5 4.5L12 14" />
        <path d="M16 9.5H9a5 5 0 0 0-5 5V16" />
    </svg>
)

type ReactionBarProps = {
    readonly labels: MessageReactionLabels
    readonly onReact: ((emoji: string) => void) | undefined
    readonly onReply: (() => void) | undefined
    readonly onShare: (() => void) | undefined
}

/**
 * The bubble's hover toolbar: the six reactions, then reply and share. A labelled group (`role="toolbar"`) with arrow-key
 * navigation (one tab stop; Home and End jump); a hovered emoji scales up.
 */
export const ReactionBar = ({ labels, onReact, onReply, onShare }: ReactionBarProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const buttons = items()
        const index = buttons.findIndex((button) => button === document.activeElement)
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
        const forward = rtl ? "ArrowLeft" : "ArrowRight"
        const backward = rtl ? "ArrowRight" : "ArrowLeft"
        const target = event.key === forward ? (index + 1) % buttons.length : event.key === backward ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : undefined
        if (target === undefined) return
        event.preventDefault()
        buttons[target]?.focus()
    }
    return (
        <div ref={ref} className="starci-core-reaction-bar" role="toolbar" aria-label={labels.toolbar} aria-orientation="horizontal" data-grammar-reaction-bar="true" onKeyDown={onKeyDown}>
            {onReact === undefined ? null : REACTION_EMOJI.map((emoji, index) => (
                <button key={emoji} type="button" className="starci-core-reaction-bar-emoji" aria-label={labels.react(emoji)} tabIndex={index === 0 ? 0 : -1} onClick={() => onReact?.(emoji)} onFocus={(event) => { items().forEach((button) => { button.tabIndex = button === event.currentTarget ? 0 : -1 }) }}>
                    <span aria-hidden="true">{emoji}</span>
                </button>
            ))}
            {onReply === undefined ? null : <button type="button" className="starci-core-reaction-bar-action" aria-label={labels.reply} tabIndex={onReact === undefined ? 0 : -1} onClick={() => onReply()}><ReplyMark /></button>}
            {onShare === undefined ? null : <button type="button" className="starci-core-reaction-bar-action" aria-label={labels.share} tabIndex={onReact === undefined && onReply === undefined ? 0 : -1} onClick={() => onShare()}><ShareMark /></button>}
        </div>
    )
}

type ReactionPillProps = {
    readonly reactions: ReadonlyArray<MessageReaction>
    readonly labels: MessageReactionLabels
    readonly onPress: () => void
}

/** The pill that overlaps the bubble's bottom corner: up to three emoji (most used first) and the total; pressing it adds one more of the viewer's top reaction. */
export const ReactionPill = ({ reactions, labels, onPress }: ReactionPillProps) => {
    const ordered = [...reactions].filter((reaction) => reaction.count > 0).sort((a, b) => b.count - a.count)
    if (ordered.length === 0) return null
    const total = ordered.reduce((sum, reaction) => sum + reaction.count, 0)
    const shown = ordered.slice(0, 3).map((reaction) => reaction.emoji)
    const mine = reactions.reduce((sum, reaction) => sum + mineCount(reaction), 0)
    return (
        <button type="button" className="starci-core-reaction-pill" aria-label={labels.pill(`${shown.join(" ")} ${total}`, mine)} data-grammar-reaction-pill="true" data-grammar-reaction-mine={mine > 0 ? "true" : "false"} onClick={onPress}>
            <span aria-hidden="true" className="starci-core-reaction-pill-emoji">{shown.join("")}</span>
            <span aria-hidden="true" className="starci-core-reaction-pill-count">{total}</span>
        </button>
    )
}

type Burst = { readonly id: number, readonly emoji: string, readonly drift: number, readonly turn: number }

/** The floating emoji of the burst effect (about 1s, rises and fades; transform and opacity only). None under `prefers-reduced-motion`. */
export const useReactionBursts = (): { readonly layer: ReactNode, readonly burst: (emoji: string) => void } => {
    const [bursts, setBursts] = useState<ReadonlyArray<Burst>>([])
    const next = useRef(0)
    const mounted = useRef(true)
    useEffect(() => () => { mounted.current = false }, [])
    const burst = useCallback((emoji: string) => {
        if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
        const id = next.current++
        setBursts((current) => [...current.slice(-11), { id, emoji, drift: Math.round((Math.random() - 0.5) * 56), turn: Math.round((Math.random() - 0.5) * 36) }])
    }, [])
    const done = (id: number) => { if (mounted.current) setBursts((current) => current.filter((item) => item.id !== id)) }
    const layer = (
        <span className="starci-core-reaction-burst-layer" aria-hidden="true" data-grammar-reaction-burst-layer="true">
            {bursts.map((item) => (
                <span key={item.id} className="starci-core-reaction-burst" style={{ "--starci-reaction-drift": `${item.drift}px`, "--starci-reaction-turn": `${item.turn}deg` } as CSSProperties} onAnimationEnd={() => done(item.id)}>{item.emoji}</span>
            ))}
        </span>
    )
    return { layer, burst }
}
