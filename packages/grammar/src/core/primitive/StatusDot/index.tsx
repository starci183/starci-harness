"use client"

import { Chip, Tooltip as HeroTooltip, skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"
import { useOverlayContainer } from "../../overlayScope.js"
import { tooltipContentClassName } from "../../branch/Tooltip/classNames.js"

export type StatusDotTone = "neutral" | "accent" | "success" | "warning" | "danger"
/** The same three sizes as HeroUI Chip; the text variant takes the Chip's padding, height and type scale. */
export type StatusDotSize = "sm" | "md" | "lg"

type StatusDotBase = {
    readonly tone?: StatusDotTone
    readonly size?: StatusDotSize
    /**
     * Initial unresolved status (knowledge STATE-8). Skeleton parity: the same anatomy at the same size, painted as one
     * Skeleton block, its dot and label kept as an unseen measured placeholder; `aria-hidden`, no Tooltip, nothing announced.
     */
    readonly isSkeleton?: boolean
}

/** With text: dot + text + light tinted background, shaped exactly like a HeroUI soft Chip of the same size. */
type StatusDotWithText = StatusDotBase & {
    readonly children: ReactNode
    /** Optional: the visible text already names the status. */
    readonly "aria-label"?: string
    readonly echo?: never
}

/** Dot only: static, or `echo` (a ring that expands and fades in the tone's light stop). Both need an accessible name. */
type StatusDotOnly = StatusDotBase & {
    readonly children?: undefined
    /** Required without children: the status in words, also shown in a Tooltip on hover and focus. */
    readonly "aria-label": string
    readonly echo?: boolean
}

export type StatusDotProps = StatusDotWithText | StatusDotOnly

const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base()

const CHIP_COLORS = {
    neutral: "default",
    accent: "accent",
    success: "success",
    warning: "warning",
    danger: "danger",
} as const

/** The label's first letter is always uppercase: a text node is capitalised here, any other node by `::first-letter`. */
export const capitaliseFirst = (children: ReactNode): ReactNode => {
    if (typeof children !== "string" || children.length === 0) return children
    return children.charAt(0).toLocaleUpperCase() + children.slice(1)
}

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

/**
 * The text anatomy, shared by `StatusDot` and `Badge isDot`: a soft HeroUI `Chip`, the dot, then the label.
 * `component` and `extra` let Badge keep its own `data-component` and attributes on the same anatomy.
 */
export const StatusDotChip = ({ tone, size, children, component = "StatusDot", extra, isSkeleton = false, ...aria }: {
    readonly tone: StatusDotTone
    readonly size: StatusDotSize
    readonly children: ReactNode
    readonly component?: string
    readonly extra?: Readonly<Record<string, string | undefined>>
    readonly isSkeleton?: boolean
    readonly "aria-label"?: string
}) => (
    <Chip
        data-tier="atom"
        data-component={component}
        data-variant="text"
        data-tone={tone}
        data-size={size}
        {...extra}
        color={CHIP_COLORS[tone]}
        variant="soft"
        size={size}
        className={isSkeleton ? `starci-core-status-dot starci-core-status-dot-chip ${SKELETON_CLASS_NAME}` : "starci-core-status-dot starci-core-status-dot-chip"}
        {...(isSkeleton ? { "data-loading": "true", "aria-hidden": true } : aria)}
    >
        <StatusDotMark tone={tone} />
        <span className="starci-core-status-dot-label">{capitaliseFirst(children)}</span>
    </Chip>
)

const DotOnly = ({ tone, size, echo, label }: { readonly tone: StatusDotTone; readonly size: StatusDotSize; readonly echo: boolean; readonly label: string }) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip delay={0}>
            <HeroTooltip.Trigger
                role="img"
                aria-label={label}
                className="starci-core-status-dot"
                data-tier="atom"
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
 * ATOM - `StatusDot`: a status as a coloured dot, in three variants that share one dot-size token and one tone set.
 *
 * - With `children`: dot + text on a soft tint, rendered through HeroUI's own `Chip` (`variant="soft"`, the same
 *   `size`), so padding and height are the Chip's by construction. The dot-to-text gap is gap-1 (0.25rem).
 * - `echo`: the dot alone with a ring that expands and fades in the tone's light stop; off under reduced motion.
 * - Default without text: the dot alone, no background, no echo.
 *
 * Both dot-only variants require `aria-label` and show it in a Tooltip on hover and focus.
 */
export const StatusDot = (props: StatusDotProps) => {
    const tone = props.tone ?? "neutral"
    const size = props.size ?? "md"
    if (props.isSkeleton === true) {
        if (props.children === undefined) {
            return (
                <span aria-hidden="true" className={`starci-core-status-dot ${SKELETON_CLASS_NAME}`} data-tier="atom" data-component="StatusDot" data-variant="static" data-tone={tone} data-size={size} data-loading="true">
                    <StatusDotMark tone={tone} />
                </span>
            )
        }
        return <StatusDotChip tone={tone} size={size} isSkeleton>{props.children}</StatusDotChip>
    }
    if (props.children === undefined) {
        return <DotOnly tone={tone} size={size} echo={props.echo === true} label={props["aria-label"] ?? "Status"} />
    }
    return (
        <StatusDotChip tone={tone} size={size} {...(props["aria-label"] === undefined ? {} : { "aria-label": props["aria-label"] })}>
            {props.children}
        </StatusDotChip>
    )
}
