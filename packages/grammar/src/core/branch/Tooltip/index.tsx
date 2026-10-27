"use client"

import { Tooltip as HeroTooltip } from "@heroui/react"
import type { ReactElement, ReactNode } from "react"
import { useOverlayContainer } from "../../overlayScope.js"
import { tooltipContentClassName } from "./classNames.js"

/** Where the tooltip sits relative to its trigger. */
export type TooltipPlacement = "top" | "bottom"

/** Props for {@link Tooltip}. */
export type TooltipProps = {
    /** The already-resolved words shown on hover or focus. */
    readonly content: ReactNode
    /**
     * One React Aria-compatible focusable control, such as a Grammar Button or IconButton.
     * Native elements and custom controls must participate in React Aria's trigger context;
     * merely having a tabIndex does not register hover/focus events with the tooltip.
     */
    readonly children: ReactElement
    readonly placement?: TooltipPlacement
}

/** Hover/focus annotation with HeroUI's positioning, dismissal and accessible trigger relationship. */
export const Tooltip = ({ content, children, placement = "top" }: TooltipProps) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip delay={0}>
            {children}
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
        <HeroTooltip isOpen={isOpen && target !== null} delay={0}>
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
