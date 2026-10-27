import { Chip, skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"
import { StatusDotChip } from "../StatusDot/index.js"

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted"

export type BadgeProps = {
    readonly children?: ReactNode
    /** App-owned status glyph or artwork. */
    readonly startContent?: ReactNode
    /** `muted` is the quiet tone: no fill, muted ink. */
    readonly tone?: BadgeTone
    /**
     * A leading status dot, rendered through the `StatusDot` text anatomy (a soft HeroUI Chip, the shared dot-size
     * token, a gap-1 dot-to-text gap, an uppercase first letter), so a dot chip matches StatusDot everywhere.
     * `muted` has no dot tone and draws a neutral dot.
     */
    readonly isDot?: boolean
    readonly isSkeleton?: boolean
}

const TONE_COLORS = {
    muted: "default",
    neutral: "default",
    accent: "accent",
    success: "success",
    warning: "warning",
    danger: "danger",
} as const

const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "select-none text-transparent",
})

/**
 * Compact semantic status or figure; product glyph identity remains app-owned. `isDot` renders through
 * `StatusDotChip`, the same anatomy as `StatusDot` with text. `muted` uses HeroUI's tertiary Chip (transparent
 * fill) with the muted ink on its content, so no vendor rule is overridden.
 *
 * The glyph and its words share one status owner. Contract: TRUTH-1 (the tone is stated, never
 * inferred, and defaults to neutral).
 */
export const Badge = ({ children, startContent, tone = "neutral", isDot = false, isSkeleton = false }: BadgeProps) => {
    if (isDot) {
        return (
            <StatusDotChip
                component="Badge"
                tone={tone === "muted" ? "neutral" : tone}
                size="sm"
                extra={{ "data-contract": "TRUTH-1", "data-grammar-badge-dot": "true", "data-loading": isSkeleton ? "true" : "false", "data-badge-tone": tone }}
                isSkeleton={isSkeleton}
            >
                {startContent === undefined ? children ?? " " : <>{startContent}{children}</>}
            </StatusDotChip>
        )
    }
    // Skeleton parity: the start content stays laid out as an unseen measured placeholder, so the chip keeps its width.
    const content = startContent
    return (
        <Chip
            data-tier="atom"
            data-component="Badge"
            data-contract="TRUTH-1"
            data-tone={tone}
            data-loading={isSkeleton ? "true" : "false"}
            color={TONE_COLORS[tone]}
            variant={tone === "muted" ? "tertiary" : "soft"}
            size="sm"
            {...(isSkeleton ? { "aria-hidden": true, className: SKELETON_CLASS_NAME } : {})}
        >
            {tone === "muted" && !isSkeleton ? (
                <span className="starci-core-badge-muted">{content}{children ?? " "}</span>
            ) : (
                <>
                    {content}
                    {children ?? " "}
                </>
            )}
        </Chip>
    )
}
