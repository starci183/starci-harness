"use client"

import type { ReactNode } from "react"
import { useFillMeasure } from "./useFillMeasure.js"

export { bottomChromeHeight } from "./useFillMeasure.js"

/** The smallest height the region keeps on a short window, so a chat or board never collapses to a sliver. */
export type FillViewportMinHeight = "none" | "sm" | "md" | "lg"

/** Space kept free below the region: `none` reaches the viewport edge, `page` leaves the page inset (1.5rem). */
export type FillViewportBottomInset = "none" | "page"

export type FillViewportProps = {
    readonly children: ReactNode
    /** `sm` 20rem, `md` 28rem (default), `lg` 36rem, `none` no floor. */
    readonly minHeight?: FillViewportMinHeight
    readonly bottomInset?: FillViewportBottomInset
    /** Accessible name when the region is a landmark (e.g. the conversation pane). Omit for a plain layout box. */
    readonly label?: string
}

/**
 * Makes its child fill the viewport height left below whatever chrome sits above it (top bar, page header, tabs), and
 * keeps that true when the chrome or the window changes. It measures its own top edge in document coordinates into
 * `--starci-core-fill-top` and any Grammar bottom chrome (a phone navigation bar) into `--starci-core-fill-bottom`; CSS
 * does the rest (`100dvh` minus both minus the bottom inset), so the server
 * render already has a sensible full-height fallback. Children fill it (a SurfaceCard with `height="fill"`, a
 * PaneGrid).
 */
export const FillViewport = ({ children, minHeight = "md", bottomInset = "page", label }: FillViewportProps) => {
    const ref = useFillMeasure()

    return (
        <div
            ref={ref}
            className="starci-core-fill-viewport"
            data-component="FillViewport"
            data-tier="composite"
            data-contract="LAYOUT-1 OVERFLOW-1"
            data-grammar-fill-min={minHeight}
            data-grammar-fill-inset={bottomInset}
            {...(label === undefined ? {} : { role: "region", "aria-label": label })}
        >
            {children}
        </div>
    )
}
