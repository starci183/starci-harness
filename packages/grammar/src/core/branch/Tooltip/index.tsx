"use client"

import { Tooltip as HeroTooltip } from "@heroui/react"
import type { ReactElement, ReactNode } from "react"
import { useOverlayContainer } from "../../overlayScope.js"
import type { NoChildren } from "../../tier.js"
import { tooltipContentClassName } from "../../tooltipClassName.js"

/** Where the tooltip sits relative to its trigger. */
export type TooltipPlacement = "top" | "bottom"

/** Props for {@link Tooltip}. */
export type TooltipProps = NoChildren & {
    /** The already-resolved words shown on hover or focus. */
    readonly content: string
    /**
     * One React Aria-compatible focusable control, such as a Grammar Button or IconButton. A native element or a custom control
     * must take part in React Aria's trigger context; merely having a tabIndex does not register hover or focus with the tooltip.
     * A disabled Button explains itself through `disabledReason`, so no tooltip wraps it.
     */
    readonly trigger: ReactElement
    readonly placement?: TooltipPlacement
}

/** Hover/focus annotation with HeroUI's positioning, dismissal and accessible trigger relationship. */
export const Tooltip = ({ content, trigger, placement = "top" }: TooltipProps) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip>
            {trigger}
            {anchor}
            {container === null ? null : (
                <HeroTooltip.Content
                    UNSTABLE_portalContainer={container}
                    placement={placement}
                    className={tooltipContentClassName}
                    data-grammar-tooltip="true"
                    data-component="Tooltip"
                    data-tier="branch"
                    data-grammar-tooltip-content="true"
                >
                    {content}
                </HeroTooltip.Content>
            )}
        </HeroTooltip>
    )
}

type AnchoredTooltipProps = {
    readonly id: string
    readonly target: Element | null
    readonly content: ReactNode
    readonly isOpen: boolean
}

/** A collection owns its trigger events; HeroUI positions the controlled annotation beside that item. */
export const AnchoredTooltip = ({ id, target, content, isOpen }: AnchoredTooltipProps) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip isOpen={isOpen && target !== null}>
            {anchor}
            {container === null ? null : (
                <HeroTooltip.Content
                    triggerRef={{ current: target }}
                    UNSTABLE_portalContainer={container}
                    placement="right"
                    offset={8}
                    className={tooltipContentClassName}
                    data-grammar-tooltip-content="true"
                    data-grammar-tooltip-annotation="true"
                >
                    <span id={id}>{content}</span>
                </HeroTooltip.Content>
            )}
        </HeroTooltip>
    )
}
