"use client"

import { LoadingScope } from "../../regionScope.js"
import { Drawer as HeroDrawer } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { SurfaceNesting } from "../../surfaceContext.js"
import { overlayOpenProps, resolveTriggerlessOpenProps, useOverlayContainer, type OverlayOpenState } from "../../overlayScope.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import type { OverlayFooter } from "../Dialog/index.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"

/** Edge the sheet slides from. `bottom` is the mobile bottom sheet. */
export type DrawerPlacement = "left" | "right" | "top" | "bottom"

export type DrawerProps = OverlayOpenState & {
    /** Visible heading; the drawer dialog's accessible name. */
    readonly title: string
    readonly description?: ReactNode
    /** A mark before the title (the avatar or logo of what the drawer is about), aligned with the title block. */
    readonly leading?: ReactNode
    readonly children?: ReactNode
    /** The body is still loading: every component in it draws as the geometry of its ready box, inert, with real labels. */
    readonly isLoading?: boolean
    readonly footer?: OverlayFooter
    /** A Common `Button`/`IconButton` (any React Aria pressable) that opens the drawer. */
    readonly trigger?: ReactNode
    readonly closeLabel?: string
    readonly placement?: DrawerPlacement
    /**
     * A side sheet's width: `standard` (default) 24rem for a short secondary task; `wide` 32rem for a guided task whose steps are
     * labelled across the top (a connection wizard). Ignored for `top` and `bottom` sheets.
     */
    readonly width?: "standard" | "wide"
    /**
     * Draw the grab handle. Default: shown for `bottom` sheets only. The handle is decorative
     * (`aria-hidden`); dragging it past the threshold dismisses, the close button and Escape remain the
     * accessible ways out.
     */
    readonly showHandle?: boolean
    /** Close on an outside press (and allow drag-to-dismiss). Default `true`. */
    readonly isDismissable?: boolean
    readonly isKeyboardDismissDisabled?: boolean
}

/**
 * FRAME - `Drawer`: a side sheet or mobile bottom sheet holding a secondary task.
 *
 * Same modal rules as `Dialog` (focus trap and return, Escape/outside dismiss, scroll lock, inert
 * page, scoped portal). Placement is echoed on `data-placement` so anatomy and families can shape the
 * sheet edge; the slide motion is removed under reduced motion.
 * Contract: surface FOCUS-3 LAYOUT-4 BOUNDARY-6 (as `Dialog`); sliding content MOTION-2.
 */
export const Drawer = ({
    title,
    description,
    leading,
    children,
    isLoading = false,
    footer,
    trigger,
    closeLabel,
    placement = "right",
    showHandle,
    width = "standard",
    isDismissable = true,
    isKeyboardDismissDisabled = false,
    ...openState
}: DrawerProps) => {
    const { anchor, container } = useOverlayContainer("Drawer")
    const descriptionId = useId()
    const hasHandle = showHandle ?? placement === "bottom"

    const surface = container === null ? null : (
        <HeroDrawer.Backdrop
            UNSTABLE_portalContainer={container}
            isDismissable={isDismissable}
            isKeyboardDismissDisabled={isKeyboardDismissDisabled}
            data-grammar-overlay-backdrop="Drawer"
            className="starci-core-overlay-backdrop starci-core-drawer-backdrop"
            {...resolveTriggerlessOpenProps(trigger, openState)}
        >
            <HeroDrawer.Content placement={placement} data-contract="MOTION-2" data-grammar-drawer-width={width} className="starci-core-drawer-content">
                <HeroDrawer.Dialog
                    data-tier="frame"
                    data-component="Drawer"
                    data-placement={placement}
                    data-grammar-overlay-surface="drawer"
                    data-grammar-nesting="surface"
                    data-contract="FOCUS-3 LAYOUT-4 BOUNDARY-6"
                    {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
                    className="starci-core-drawer"
                >
                    {({ close }) => (
                        <ButtonPlacementProvider placement="decision">
                        <LoadingScope isLoading={false}><SurfaceNesting host="overlay">
                            {hasHandle ? <HeroDrawer.Handle data-grammar-drawer-handle="true" className="starci-core-drawer-handle" /> : null}
                            <HeroDrawer.Header className="starci-core-overlay-header">
                                {leading === undefined ? null : <span className="starci-core-overlay-leading" data-grammar-overlay-leading="true">{leading}</span>}
                                <div className="starci-core-overlay-heading-group">
                                    <HeroDrawer.Heading className="starci-core-overlay-title">{title}</HeroDrawer.Heading>
                                    {description === undefined ? null : (
                                        <p id={descriptionId} className="starci-core-overlay-description">{description}</p>
                                    )}
                                </div>
                                {closeLabel === undefined ? null : <IconButton intent="dismiss" label={closeLabel} onPress={close} />}
                            </HeroDrawer.Header>
                            {children === undefined ? null : (
                                <HeroDrawer.Body className="starci-core-overlay-body" {...(isLoading ? { "aria-busy": true, "data-grammar-loading-region": "true" } : {})}><LoadingScope isLoading={isLoading}>{children}</LoadingScope></HeroDrawer.Body>
                            )}
                            {footer === undefined ? null : (
                                <HeroDrawer.Footer className="starci-core-overlay-footer">
                                    {typeof footer === "function" ? footer(close) : footer}
                                </HeroDrawer.Footer>
                            )}
                        </SurfaceNesting></LoadingScope>
                        </ButtonPlacementProvider>
                    )}
                </HeroDrawer.Dialog>
            </HeroDrawer.Content>
        </HeroDrawer.Backdrop>
    )

    // With no trigger there is no `DialogTrigger` root (its PressResponder has no pressable child):
    // the Backdrop, React Aria's `ModalOverlay`, owns the open state itself (see `resolveTriggerlessOpenProps`).
    return trigger === undefined ? (
        <>
            {anchor}
            {surface}
        </>
    ) : (
        <HeroDrawer {...overlayOpenProps(openState)}>
            {trigger}
            {anchor}
            {surface}
        </HeroDrawer>
    )
}
