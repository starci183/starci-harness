"use client"

import { useContext, useEffect, type CSSProperties } from "react"
import { PaneOpenerContext } from "../../paneContext.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import type { NoChildren } from "../../tier.js"

export type PaneDrawerOpenerProps = NoChildren & {
    /** The `area` of a pane of the same PaneGrid that has `collapse="drawer"` and `trigger="head"`. */
    readonly pane: string
    /** The button's glyph. */
    readonly icon: IconSource
    /** The button's accessible name. */
    readonly label: string
}

/**
 * COMPOSITE - `PaneDrawerOpener`: the icon button that opens the drawer of a pane of the same PaneGrid, shown only where that pane's
 * area is not arranged (below its collapse width). `PaneHeader drawerOpener` draws it inside the pane head; use this where the
 * opener stands elsewhere in the grid (a card head, a toolbar, a section action). The grid owns the open state.
 */
export const PaneDrawerOpener = ({ pane, icon, label }: PaneDrawerOpenerProps) => {
    const opener = useContext(PaneOpenerContext)
    useEffect(() => {
        if (process.env.NODE_ENV !== "production" && opener?.has(pane) !== true) console.error(`PANE_OPENER_WITHOUT_DRAWER: ${pane}`)
    }, [pane, opener])
    const displays = opener?.displays(pane)
    if (opener === undefined || displays === undefined) return null
    return (
        <span
            className="starci-core-pane-header-opener"
            data-component="PaneDrawerOpener"
            data-tier="composite"
            data-grammar-pane-opener={pane}
            style={{ "--starci-core-pane-opener-base": displays.base, "--starci-core-pane-opener-medium": displays.medium, "--starci-core-pane-opener-wide": displays.wide } as CSSProperties}
        >
            <IconButton intent="neutral" source={icon} label={label} onPress={() => opener.open(pane)} />
        </span>
    )
}
