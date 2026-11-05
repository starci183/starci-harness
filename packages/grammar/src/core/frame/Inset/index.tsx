"use client"

import { useId, type ReactNode } from "react"
import { LoadingScope, useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"

export type InsetProps = {
    /** What stands on the ground: rows, a figure, a short form. Anything but a surface (a card in an inset is refused like a card in a card). */
    readonly children: ReactNode
    /** A short muted word above the content (the approver panel's "Waiting for you"); it also names the group. */
    readonly label?: string
    /**
     * The content is still arriving: the inset is a loading region (its children draw the geometry of their ready boxes, inert) and
     * carries the one `aria-busy`. Inside a loading region it follows the region.
     */
    readonly isLoading?: boolean
}

/**
 * FRAME - `Inset`: the quiet ground a `Quote` stands on, around anything else. A tinted box at the nested inset, one radius below
 * the surface that hosts it: not a surface (no shadow, outline or action), so it stands in a pane, a card or a drawer without
 * nesting a surface in a surface. Use it to set a group of rows or a block apart inside a surface; it never replaces a card.
 */
export const Inset = ({ children, label, isLoading: ownLoading }: InsetProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    const labelId = useId()
    return (
        <div
            className="starci-core-inset"
            data-component="Inset"
            data-tier="frame"
            data-contract="INSET-NESTED STATE-8"
            role="group"
            {...(label === undefined ? {} : { "aria-labelledby": labelId })}
            {...(isLoading && !ownsBusy ? { "aria-busy": true, "data-grammar-loading-region": "true" } : {})}
        >
            {label === undefined ? null : <span id={labelId} className="starci-core-inset-label">{label}</span>}
            <LoadingScope isLoading={isLoading}>{children}</LoadingScope>
        </div>
    )
}
