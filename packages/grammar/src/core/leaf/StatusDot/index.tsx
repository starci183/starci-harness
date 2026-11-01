"use client"

import { Tooltip as HeroTooltip, skeletonVariants } from "@heroui/react"
import { useOverlayContainer } from "../../overlayScope.js"
import { tooltipContentClassName } from "../../tooltipClassName.js"
import type { NoChildren } from "../../tier.js"

export type StatusDotTone = "neutral" | "accent" | "success" | "warning" | "danger"
/** The same three sizes as HeroUI Chip, which the dot's hit area follows. */
export type StatusDotSize = "sm" | "md" | "lg"

export type StatusDotProps = NoChildren & {
    readonly tone?: StatusDotTone
    readonly size?: StatusDotSize
    /** Required: the status in words, also shown in a Tooltip on hover and focus. A status with words beside it is `Badge isDot`. */
    readonly "aria-label": string
    /** A ring that expands and fades in the tone's light stop, for a status that is live; off under reduced motion. */
    readonly echo?: boolean
    /**
     * Initial unresolved status (knowledge STATE-8). Skeleton parity: the same anatomy at the same size, painted as one
     * Skeleton block; `aria-hidden`, no Tooltip, nothing announced.
     */
    readonly isSkeleton?: boolean
}

const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base()

/** The one dot: size from the shared `--starci-core-status-dot-size` token, colour from the tone. */
export const StatusDotMark = ({ tone, echo = false }: { readonly tone: StatusDotTone; readonly echo?: boolean }) => (
    <span
        aria-hidden="true"
        className="starci-core-status-dot-mark"
        data-slot="status-dot-mark"
        data-tone={tone}
        data-echo={echo ? "true" : "false"}
    />
)

const DotOnly = ({ tone, size, echo, label }: { readonly tone: StatusDotTone; readonly size: StatusDotSize; readonly echo: boolean; readonly label: string }) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip>
            <HeroTooltip.Trigger
                role="img"
                aria-label={label}
                className="starci-core-status-dot"
                data-tier="leaf"
                data-component="StatusDot"
                data-variant={echo ? "echo" : "static"}
                data-tone={tone}
                data-size={size}
            >
                <StatusDotMark tone={tone} echo={echo} />
            </HeroTooltip.Trigger>
            {anchor}
            {container === null ? null : (
                <HeroTooltip.Content
                    UNSTABLE_portalContainer={container}
                    placement="top"
                    className={tooltipContentClassName}
                    data-grammar-tooltip-content="true"
                >
                    {label}
                </HeroTooltip.Content>
            )}
        </HeroTooltip>
    )
}

/**
 * LEAF - `StatusDot`: a status as a coloured dot alone, with its name in a Tooltip on hover and focus. `echo` adds a ring that
 * expands and fades in the tone's light stop. The dot and the dot-size token are shared with `Badge isDot`, which is the form
 * with words.
 */
export const StatusDot = ({ tone = "neutral", size = "md", "aria-label": label, echo = false, isSkeleton = false }: StatusDotProps) => {
    if (isSkeleton) {
        return (
            <span aria-hidden="true" className={`starci-core-status-dot ${SKELETON_CLASS_NAME}`} data-tier="leaf" data-component="StatusDot" data-variant="static" data-tone={tone} data-size={size} data-loading="true">
                <StatusDotMark tone={tone} />
            </span>
        )
    }
    return <DotOnly tone={tone} size={size} echo={echo} label={label} />
}
