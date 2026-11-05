import { withRegionLoading } from "../../regionScope.js"
import { Chip, skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"
import { StatusDotMark } from "../StatusDot/index.js"

export type BadgeTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger" | "muted"

type BadgeBase = {
    readonly children?: string
    /** App-owned status glyph or artwork. */
    readonly startContent?: ReactNode
    /** `muted` is the quiet tone: no fill, muted ink. */
    readonly tone?: BadgeTone
    readonly isLoading?: boolean
}

type BadgePlain = BadgeBase & {
    readonly isDot?: false
    readonly isLive?: never
}

type BadgeDot = BadgeBase & {
    /**
     * A leading status dot (the shared dot-size token, a gap-1 dot-to-text gap, an uppercase first letter): a status with its words.
     * `muted` has no dot tone and draws a neutral dot.
     */
    readonly isDot: true
    /**
     * The status is a live feed (server-sent events, a socket): the dot echoes (off under reduced motion) and the badge is a polite
     * live region, so a change of its words is spoken without moving focus. The words carry the state, never the colour alone.
     */
    readonly isLive?: boolean
}

export type BadgeProps = BadgePlain | BadgeDot

const TONE_COLORS = {
    muted: "default",
    neutral: "default",
    accent: "accent",
    info: "accent",
    success: "success",
    warning: "warning",
    danger: "danger",
} as const

const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "select-none text-transparent",
})

/** The label's first letter is always uppercase: a text node is capitalised here, any other node by `::first-letter`. */
const capitaliseFirst = (children: ReactNode): ReactNode => {
    if (typeof children !== "string" || children.length === 0) return children
    return children.charAt(0).toLocaleUpperCase() + children.slice(1)
}

/**
 * Compact semantic status or figure; product glyph identity remains app-owned. `isDot` draws the dot and then the words on a soft
 * HeroUI `Chip`, and `isLive` makes it the state of a live feed. `muted` uses HeroUI's tertiary Chip (transparent
 * fill) with the muted ink on its content, so no vendor rule is overridden.
 *
 * The glyph and its words share one status owner. Contract: TRUTH-1 (the tone is stated, never
 * inferred, and defaults to neutral).
 */
const BadgeInner = (props: BadgeProps) => {
    const { children, startContent, tone = "neutral", isLoading = false } = props
    if (props.isDot === true) {
        const isLive = props.isLive === true
        const dotTone = tone === "muted" ? "neutral" : tone === "info" ? "accent" : tone
        return (
            <Chip
                data-tier="leaf"
                data-component="Badge"
                data-contract="TRUTH-1"
                data-grammar-badge-dot="true"
                data-grammar-badge-live={isLive ? "true" : undefined}
                data-tone={dotTone}
                data-badge-tone={tone}
                data-loading={isLoading ? "true" : "false"}
                color={TONE_COLORS[dotTone]}
                variant="soft"
                size="sm"
                className={isLoading ? `starci-core-badge-dot ${SKELETON_CLASS_NAME}` : "starci-core-badge-dot"}
                {...(isLoading ? { "aria-hidden": true } : isLive ? { role: "status", "aria-live": "polite" as const } : {})}
            >
                <StatusDotMark tone={dotTone} echo={isLive} />
                <span className="starci-core-badge-dot-label">{capitaliseFirst(startContent === undefined ? children ?? " " : <>{startContent}{children}</>)}</span>
            </Chip>
        )
    }
    // Skeleton parity: the start content stays laid out as an unseen measured placeholder, so the chip keeps its width.
    const content = startContent
    return (
        <Chip
            data-tier="leaf"
            data-component="Badge"
            data-contract="TRUTH-1"
            data-tone={tone}
            data-loading={isLoading ? "true" : "false"}
            color={TONE_COLORS[tone]}
            variant={tone === "muted" ? "tertiary" : "soft"}
            size="sm"
            {...(isLoading ? { "aria-hidden": true, className: SKELETON_CLASS_NAME } : {})}
        >
            {tone === "muted" && !isLoading ? (
                <span className="starci-core-badge-muted">{content}{children ?? " "}</span>
            ) : (
                <>
                    {content}
                    {children ?? " "}
                </>
            )}
        </Chip>
    )
}

/**
 * Compact semantic status or figure; product glyph identity remains app-owned. `isDot` draws the dot and then the words on a soft
 * HeroUI `Chip`, and `isLive` makes it the state of a live feed. `muted` uses HeroUI's tertiary Chip (transparent
 * fill) with the muted ink on its content, so no vendor rule is overridden.
 *
 * The glyph and its words share one status owner. Contract: TRUTH-1 (the tone is stated, never
 * inferred, and defaults to neutral).
 */
export const Badge = withRegionLoading(BadgeInner)
