"use client"

import { createElement, useEffect, type ReactNode, type Ref } from "react"
import { VerticalScrollRegionPart } from "../VerticalScrollRegion/index.js"
import { usePaneContext } from "../../paneContext.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"

export type PaneSectionProps = {
    readonly children: ReactNode
    /** Takes the remaining block size of the pane (min-height 0). */
    readonly grow?: boolean
    /** Its own vertical scroll owner (OVERFLOW-4/5) with the inset inside the scroller. Implies grow. */
    readonly scroll?: {
        readonly label: string
        readonly role?: "log" | "region"
        readonly tone?: "surface" | "background"
        readonly scrollRef?: Ref<HTMLDivElement>
        /**
         * Where the content stands when it is shorter than the band. `start` (default): at the top. `end`: at the foot, so a thread ends
         * beside its composer. `center`: in the middle of the free space (an empty thread's greeting). The content is at least as tall as
         * the band and scrolls once it is taller; nothing above the first line is ever unreachable.
         */
        readonly align?: "start" | "center" | "end"
    }
    /** Head band centred in a shared grid row. Default `start`. */
    readonly align?: "start" | "center"
    /** `inline`: the one horizontal scroller in it reaches both pane edges and takes the inset as scroll padding. */
    readonly bleed?: "inline"
    /** Gap between its own children. Default `row`. */
    readonly gap?: "inline" | "row" | "section"
    readonly as?: "div" | "header" | "footer"
    /**
     * The first read of this band has no data yet (knowledge STATE-8). The band is `aria-busy` and tells every Grammar component
     * inside it (`Section`, `SurfaceCard`, `ListBox`, `Timeline`, `DataTable`, `MessageBubble`) to draw its loading structure, so
     * one flag covers the band. A refresh that has data is not loading.
     */
    readonly isLoading?: boolean
    /** The read failed: this takes the place of the band's content. Loading comes first, then error. */
    readonly error?: ErrorData
}

/**
 * One band of a Pane: it pads inline by the pane's inset, the sections of a pane stack with the row gap between them,
 * the first takes the pane's block-start inset and the last its block-end inset. With `scroll` the band is its own
 * full-bleed scroll owner and the inset sits on its content, so the scrollbar stays on the pane edge. A section outside
 * a Pane throws `PANE_SECTION_OUTSIDE_PANE`.
 */
export const PaneSection = ({ children: content, grow = false, scroll, align = "start", bleed, gap = "row", as = "div", isLoading: ownLoading, error }: PaneSectionProps) => {
    const pane = usePaneContext()
    const isLoading = useIsLoading(ownLoading)
    const children = !isLoading && error !== undefined ? <ErrorView error={error} /> : <LoadingScope isLoading={isLoading}>{content}</LoadingScope>
    useEffect(() => pane?.register(), [pane])
    if (pane === undefined) throw new Error("PANE_SECTION_OUTSIDE_PANE")
    const shared = {
        "data-component": "PaneSection",
        "data-tier": "frame",
        "data-grammar-pane-section-align": align,
        "data-grammar-pane-section-gap": gap,
        "data-grammar-pane-section-bleed": bleed,
        "data-grammar-pane-section-grow": grow || scroll !== undefined ? "true" : undefined,
        "aria-busy": isLoading ? true : undefined,
        "data-grammar-loading-region": isLoading ? "true" : undefined,
    }
    const contract = "PADDING-4 GAP-3"
    if (scroll === undefined) {
        return createElement(as, { ...shared, className: "starci-core-pane-section", "data-contract": contract }, children)
    }
    return (
        <VerticalScrollRegionPart
            {...shared}
            aria-label={scroll.label}
            className="starci-core-pane-section"
            data-grammar-pane-section-scroll="true"
            {...(scroll.align === undefined || scroll.align === "start" ? {} : { "data-grammar-pane-section-scroll-align": scroll.align })}
            isScrollable
            {...(scroll.role === undefined ? {} : { role: scroll.role })}
            {...(scroll.tone === undefined ? {} : { tone: scroll.tone })}
            {...(scroll.scrollRef === undefined ? {} : { ref: scroll.scrollRef })}
        >
            {createElement(as, { className: "starci-core-pane-section-content", "data-contract": contract }, children)}
        </VerticalScrollRegionPart>
    )
}
