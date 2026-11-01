import { Popover as HeroPopover } from "@heroui/react"
import type { ReactNode } from "react"
import { SurfaceNesting } from "./surfaceContext.js"
import { overlayOpenProps, useOverlayContainer, type OverlayOpenState } from "./overlayScope.js"

/** Side of the trigger the panel opens on; it flips when the viewport has no room. */
export type PopoverPlacement = "top" | "bottom" | "start" | "end"

type PopoverBase = OverlayOpenState & {
    /** A Common `Button`/`IconButton` (any React Aria pressable) that toggles the panel. */
    readonly trigger: ReactNode
    readonly children: ReactNode
    readonly placement?: PopoverPlacement
    /** Draw the pointer arrow toward the trigger. Default `false`. */
    readonly showArrow?: boolean
}

/** A popover is a non-modal dialog, so it needs a name: a visible title or an accessible label. */
type TitledPopover = { readonly title: string; readonly label?: never }
type LabelledPopover = { readonly label: string; readonly title?: never }

export type PopoverProps = PopoverBase & (TitledPopover | LabelledPopover)

/** The popover as a part a composite may draw (a tier imports nothing above it); the frame `Popover` stamps its tier on it. */
export type PopoverPartProps = PopoverProps & { readonly stamp?: "frame" }

/**
 * `Popover` (a frame) and the popover a composite draws: rich, interactive content anchored to a trigger.
 *
 * Unlike `Tooltip` (a description), a popover holds focusable content. React Aria moves focus into
 * the panel, contains Tab while open, dismisses on Escape or an outside press, and returns focus to
 * the trigger. The panel portals into the nearest Grammar root so the family scope still applies.
 * Contract: panel LAYOUT-4 BOUNDARY-6 MOTION-2 (portal, shadow, reduced motion); dialog FOCUS-3.
 */
export const PopoverPart = ({
    trigger,
    children,
    placement = "bottom",
    showArrow = false,
    title,
    label,
    stamp,
    ...openState
}: PopoverPartProps) => {
    const { anchor, container } = useOverlayContainer("Popover")

    return (
        <HeroPopover {...overlayOpenProps(openState)}>
            {trigger}
            {anchor}
            {container === null ? null : (
                <HeroPopover.Content
                    UNSTABLE_portalContainer={container}
                    placement={placement}
                    offset={8}
                    data-grammar-overlay-surface="popover"
                    data-grammar-nesting="surface"
                    data-contract="LAYOUT-4 BOUNDARY-6 MOTION-2"
                    className="starci-core-popover"
                >
                    <SurfaceNesting host="overlay">
                        {showArrow ? (
                            <HeroPopover.Arrow className="starci-core-popover-arrow" data-grammar-popover-arrow="true" />
                        ) : null}
                        <HeroPopover.Dialog
                            {...(stamp === undefined ? {} : { "data-tier": stamp })}
                            data-component="Popover"
                            data-contract="FOCUS-3"
                            {...(label === undefined ? {} : { "aria-label": label })}
                            className="starci-core-popover-dialog"
                        >
                            {title === undefined ? null : (
                                <HeroPopover.Heading className="starci-core-overlay-title">{title}</HeroPopover.Heading>
                            )}
                            <div className="starci-core-popover-body">{children}</div>
                        </HeroPopover.Dialog>
                    </SurfaceNesting>
                </HeroPopover.Content>
            )}
        </HeroPopover>
    )
}
