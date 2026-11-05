"use client"

import { useContext, useEffect, type CSSProperties, type ReactNode } from "react"
import { ArrowLeftIcon } from "@heroicons/react/20/solid"
import { PaneOpenerContext } from "../../paneContext.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import { Heading } from "../../leaf/Heading/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { Text } from "../../leaf/Text/index.js"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

export type PaneHeaderProps = NoChildren & {
    /** The pane's name: the subject it shows (a list's name, the opened item's name). Text, one line, truncated. */
    readonly title: string
    /** `1` when this pane holds the page's subject (the opened item), `2` for a list or a side panel. Default `2`. */
    readonly headingLevel?: 1 | 2
    /** The one muted supporting line under the title (a channel and a time, a count). */
    readonly description?: string
    /** The identity mark left of the title: an `Avatar` or an `IconTile`. */
    readonly mark?: ReactNode
    /** Settled facts beside the title: one `Badge` or `StatusDot`. */
    readonly status?: ReactNode
    /** The pane's commands at the trailing end, never shrunk: icon buttons and at most one `Button`. */
    readonly actions?: ReactNode
    /**
     * The way back to the list, for a pane the phone shows alone. Drawn only where the pane grid shows one pane at a time
     * (below 48rem); a wider grid shows the list beside it, so the control is absent there.
     */
    readonly back?: { readonly label: string; readonly onPress: () => void; readonly placement?: "narrow" | "always" }
    /**
     * Opens the drawer of a pane of the same PaneGrid (`<Pane area="rail" collapse="drawer" trigger="head" ...>`): an icon button at the
     * trailing end, shown only where that pane's area is not arranged (below its collapse width). The grid owns the open state, so a
     * server page needs none. `icon` is the button's glyph, `label` its accessible name.
     */
    readonly drawerOpener?: { readonly pane: string; readonly icon: IconSource; readonly label: string }
    /** The subject is unresolved (STATE-8): `title`, `description`, `mark`, `status` and `actions` lay out unseen under a shimmer. */
    readonly isLoading?: boolean
}

/**
 * The head band of one pane: the back control of a phone, the identity mark, the title with its status and one supporting
 * line, and the pane's commands, in one row as tall as a touch target so that heads side by side across a PaneGrid row
 * share one height. It is the content of a `PaneSection align="center"`; it takes no padding of its own (the section
 * applies the pane inset) and draws no surface or rule (the grid draws the dividers).
 */
export const PaneHeader = ({ title, headingLevel = 2, description, mark, status, actions, back, drawerOpener, isLoading: ownLoading }: PaneHeaderProps) => {
    const isLoading = useIsLoading(ownLoading)
    const opener = useContext(PaneOpenerContext)
    const openerPane = drawerOpener?.pane
    useEffect(() => {
        if (openerPane !== undefined && process.env.NODE_ENV !== "production" && opener?.has(openerPane) !== true) {
            console.error(`PANE_OPENER_WITHOUT_DRAWER: ${openerPane}`)
        }
    }, [openerPane, opener])
    const openerDisplays = drawerOpener === undefined || opener === undefined ? undefined : opener.displays(drawerOpener.pane)
    const openerButton = drawerOpener === undefined || openerDisplays === undefined ? null : (
        <span
            className="starci-core-pane-header-opener"
            data-grammar-pane-opener={drawerOpener.pane}
            style={{ "--starci-core-pane-opener-base": openerDisplays.base, "--starci-core-pane-opener-medium": openerDisplays.medium, "--starci-core-pane-opener-wide": openerDisplays.wide } as CSSProperties}
        >
            <IconButton intent="neutral" source={drawerOpener.icon} label={drawerOpener.label} onPress={() => opener?.open(drawerOpener.pane)} />
        </span>
    )
    return (
        <div
            data-tier="composite"
            data-component="PaneHeader"
            data-contract="GAP-3"
            className="starci-core-pane-header"
            {...(isLoading ? { "data-loading": "true", "aria-busy": true } : {})}
        >
            {back === undefined ? null : (
                <span className="starci-core-pane-header-back" data-grammar-back-placement={back.placement ?? "narrow"}>
                    <IconButton intent="dismiss" source={ArrowLeftIcon} label={back.label} onPress={back.onPress} />
                </span>
            )}
            {mark === undefined ? null : <span className="starci-core-pane-header-mark" aria-hidden={isLoading || undefined}>{isLoading ? <SkeletonPlaceholder shape="block">{mark}</SkeletonPlaceholder> : mark}</span>}
            <div className="starci-core-pane-header-copy" data-contract="GAP-1">
                <div className="starci-core-pane-header-title-line" data-contract="GAP-2">
                    <div className="starci-core-pane-header-title">
                        <Heading level={headingLevel} isLoading={isLoading}>{title}</Heading>
                    </div>
                    {status === undefined ? null : <span className="starci-core-pane-header-status" aria-hidden={isLoading || undefined}>{isLoading ? <SkeletonPlaceholder>{status}</SkeletonPlaceholder> : status}</span>}
                </div>
                {description === undefined ? null : <Text size="xs" tone="muted" isLoading={isLoading}>{description}</Text>}
            </div>
            {actions === undefined && openerButton === null ? null : (
                <span className="starci-core-pane-header-actions" data-contract="GAP-2" aria-hidden={isLoading || undefined}>
                    {actions === undefined ? null : isLoading ? <SkeletonPlaceholder shape="block">{actions}</SkeletonPlaceholder> : actions}
                    {isLoading ? null : openerButton}
                </span>
            )}
        </div>
    )
}
