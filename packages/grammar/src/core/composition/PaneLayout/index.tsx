"use client"

import { cn, Drawer } from "@heroui/react"
import {
    useEffect,
    useSyncExternalStore,
    type ComponentPropsWithoutRef,
    type ReactNode,
} from "react"
import { Rail } from "../../branch/Rail/index.js"
import { VerticalScrollRegion } from "../../composite/VerticalScrollRegion/index.js"
import { SurfaceNesting } from "../../surfaceContext.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import {
    paneLayoutClassName,
    paneLayoutComposerClassName,
    paneLayoutConversationClassName,
    paneLayoutDrawerBodyClassName,
    paneLayoutDrawerCloseClassName,
    paneLayoutDrawerContentClassName,
    paneLayoutDrawerDialogClassName,
    paneLayoutHeaderClassName,
    paneLayoutInlineRailClassName,
    paneLayoutOverlayRailClassName,
    paneLayoutPrimaryClassName,
    paneLayoutRailTriggerBoundaryClassName,
    paneLayoutRailTriggerClassName,
    getPaneLayoutLayoutClassName,
} from "./classNames.js"

const compactRailQuery = "(max-width: 47.999rem)"

const subscribeToCompactRail = (onStoreChange: () => void) => {
    if (typeof window === "undefined") return () => undefined
    const query = window.matchMedia(compactRailQuery)
    query.addEventListener("change", onStoreChange)
    return () => query.removeEventListener("change", onStoreChange)
}

const getCompactRailSnapshot = () => (
    typeof window === "undefined" ? false : window.matchMedia(compactRailQuery).matches
)

const getCompactRailServerSnapshot = () => false

type PaneLayoutBaseProps = Omit<ComponentPropsWithoutRef<"section">, "aria-label" | "children"> & {
    /** Accessible name for the complete workspace landmark. */
    readonly label: string
    /** Optional non-scrolling workspace heading or toolbar. */
    readonly header?: ReactNode
    /** Caller-owned task content. Grammar supplies no message or business-state semantics. */
    readonly conversation: ReactNode
    /** Accessible name for the independently scrollable task region. */
    readonly conversationLabel: string
    /** Caller-owned input/action region pinned after the conversation scroll owner. */
    readonly composer: ReactNode
}

type PaneLayoutWithRailProps = {
    /** Caller-owned supporting content; Grammar supplies only layout and overlay mechanics. */
    readonly rail: ReactNode
    /** Accessible name shared by the persistent rail and compact drawer. */
    readonly railLabel: string
    /** Visible and accessible label for the compact drawer trigger. */
    readonly railOpenLabel: string
    /** Accessible label for the compact drawer close control. */
    readonly railCloseLabel: string
    /** Controlled compact drawer state. Ignored while the persistent rail is active. */
    readonly isRailOpen: boolean
    /** Receives trigger, backdrop, close-control, Escape, and breakpoint closure changes. */
    readonly onRailOpenChange: (isOpen: boolean) => void
    readonly railWidth?: "compact" | "standard" | "wide"
}

type PaneLayoutWithoutRailProps = {
    readonly rail?: undefined
    readonly railLabel?: never
    readonly railOpenLabel?: never
    readonly railCloseLabel?: never
    readonly isRailOpen?: never
    readonly onRailOpenChange?: never
    readonly railWidth?: never
}

/**
 * Generic bounded multi-pane layout: a header, a scrolling main region with a pinned bottom bar, and an optional side rail.
 *
 * The host supplies a height. PaneLayout owns the remaining height chain,
 * keeps the composer outside the conversation scroll owner, and transforms one
 * optional persistent supporting rail into a controlled compact drawer.
 */
export type PaneLayoutProps = PaneLayoutBaseProps & (
    PaneLayoutWithRailProps | PaneLayoutWithoutRailProps
)

export const PaneLayout = (props: PaneLayoutProps) => {
    const {
        className,
        composer,
        conversation,
        conversationLabel,
        header,
        label,
        rail,
        railCloseLabel,
        railLabel,
        railOpenLabel,
        railWidth: requestedRailWidth,
        isRailOpen: requestedRailOpen,
        onRailOpenChange: requestedRailOpenChange,
        ...sectionProps
    } = props
    const isCompactRail = useSyncExternalStore(
        subscribeToCompactRail,
        getCompactRailSnapshot,
        getCompactRailServerSnapshot,
    )
    const railConfig = rail === undefined ? undefined : {
        content: rail,
        label: railLabel ?? "",
        openLabel: railOpenLabel ?? "",
        closeLabel: railCloseLabel ?? "",
        isOpen: requestedRailOpen ?? false,
        onOpenChange: requestedRailOpenChange,
        width: requestedRailWidth ?? "standard",
    }
    const hasRail = railConfig !== undefined
    const railWidth = railConfig?.width ?? "standard"
    const isRailOpen = railConfig?.isOpen ?? false
    const onRailOpenChange = railConfig?.onOpenChange

    useEffect(() => {
        if (hasRail && !isCompactRail && isRailOpen) onRailOpenChange?.(false)
    }, [hasRail, isCompactRail, isRailOpen, onRailOpenChange])

    return (
        <section
            {...sectionProps}
            aria-label={label}
            className={cn(paneLayoutClassName, className)}
            data-grammar-pane-layout="true"
            data-component="PaneLayout"
            data-tier="composition"
            data-grammar-pane-layout-rail={hasRail ? "present" : "absent"}
        >
            {header === undefined ? null : (
                <header
                    className={paneLayoutHeaderClassName}
                    data-grammar-pane-layout-slot="header"
                >
                    <ButtonPlacementProvider placement="chrome">{header}</ButtonPlacementProvider>
                </header>
            )}

            {hasRail && isCompactRail ? (
                <Drawer
                    isOpen={railConfig.isOpen}
                    onOpenChange={railConfig.onOpenChange}
                >
                    <div className={paneLayoutRailTriggerBoundaryClassName} data-contract="BOUNDARY-1 PADDING-4 PADDING-2">
                        <Drawer.Trigger className={paneLayoutRailTriggerClassName} data-contract="PADDING-3 SURFACE-2 FONT-2 TONE-1">
                            {railConfig.openLabel}
                        </Drawer.Trigger>
                    </div>
                    <Drawer.Backdrop>
                        <Drawer.Content
                            className={paneLayoutDrawerContentClassName}
                            placement="right"
                        >
                            <Drawer.Dialog className={paneLayoutDrawerDialogClassName} data-grammar-nesting="surface">
                                <SurfaceNesting>
                                    <Drawer.Header>
                                        <Drawer.Heading>{railConfig.label}</Drawer.Heading>
                                    </Drawer.Header>
                                    <Drawer.CloseTrigger
                                        aria-label={railConfig.closeLabel}
                                        className={paneLayoutDrawerCloseClassName}
                                        data-contract="SURFACE-2 TONE-1"
                                    />
                                    <Drawer.Body className={paneLayoutDrawerBodyClassName} data-contract="OVERFLOW-2 PADDING-0">
                                        <VerticalScrollRegion
                                            aria-label={railConfig.label}
                                            className={paneLayoutOverlayRailClassName}
                                            data-contract="OVERFLOW-4 OVERFLOW-5 PADDING-4"
                                            data-grammar-pane-layout-rail-presentation="overlay"
                                            data-grammar-pane-layout-slot="rail"
                                            isScrollable
                                            role="region"
                                            tabIndex={0}
                                        >
                                            {railConfig.content}
                                        </VerticalScrollRegion>
                                    </Drawer.Body>
                                </SurfaceNesting>
                            </Drawer.Dialog>
                        </Drawer.Content>
                    </Drawer.Backdrop>
                </Drawer>
            ) : null}

            <div
                className={getPaneLayoutLayoutClassName(railWidth, hasRail)}
                data-contract="GAP-5"
                data-grammar-pane-layout-layout="true"
                data-grammar-pane-layout-rail-width={hasRail ? railWidth : undefined}
            >
                <div className={paneLayoutPrimaryClassName} data-grammar-pane-layout-slot="primary">
                    <VerticalScrollRegion
                        aria-label={conversationLabel}
                        className={paneLayoutConversationClassName}
                        data-contract="OVERFLOW-4 OVERFLOW-5"
                        data-grammar-pane-layout-scroll-owner="conversation"
                        data-grammar-pane-layout-slot="conversation"
                        isScrollable
                        role="region"
                        tabIndex={0}
                    >
                        {conversation}
                    </VerticalScrollRegion>
                    <div
                        className={paneLayoutComposerClassName}
                        data-contract="BOUNDARY-1"
                        data-grammar-pane-layout-slot="composer"
                    >
                        {composer}
                    </div>
                </div>

                {hasRail && !isCompactRail ? (
                    <div className={paneLayoutInlineRailClassName}>
                        <Rail
                            height="fill"
                            inset="none"
                            isLabelHidden
                            label={railConfig.label}
                            mode="flow"
                            width={railWidth}
                        >
                            <VerticalScrollRegion
                                aria-label={railConfig.label}
                                className={paneLayoutOverlayRailClassName}
                                data-contract="OVERFLOW-4 OVERFLOW-5 PADDING-4"
                                data-grammar-pane-layout-rail-presentation="inline"
                                data-grammar-pane-layout-slot="rail"
                                isScrollable
                                role="region"
                                tabIndex={0}
                            >
                                {railConfig.content}
                            </VerticalScrollRegion>
                        </Rail>
                    </div>
                ) : null}
            </div>
        </section>
    )
}
