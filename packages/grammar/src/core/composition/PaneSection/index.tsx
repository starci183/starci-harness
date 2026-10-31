"use client"

import { createElement, useEffect, type ReactNode, type Ref } from "react"
import { VerticalScrollRegion } from "../../composite/VerticalScrollRegion/index.js"
import { usePaneContext } from "../../paneContext.js"

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
    }
    /** Head band centred in a shared grid row. Default `start`. */
    readonly align?: "start" | "center"
    /** `inline`: the one horizontal scroller in it reaches both pane edges and takes the inset as scroll padding. */
    readonly bleed?: "inline"
    /** Gap between its own children. Default `row`. */
    readonly gap?: "inline" | "row" | "section"
    readonly as?: "div" | "header" | "footer"
}

/**
 * One band of a Pane: it pads inline by the pane's inset, the sections of a pane stack with the row gap between them,
 * the first takes the pane's block-start inset and the last its block-end inset. With `scroll` the band is its own
 * full-bleed scroll owner and the inset sits on its content, so the scrollbar stays on the pane edge. A section outside
 * a Pane throws `PANE_SECTION_OUTSIDE_PANE`.
 */
export const PaneSection = ({ children, grow = false, scroll, align = "start", bleed, gap = "row", as = "div" }: PaneSectionProps) => {
    const pane = usePaneContext()
    useEffect(() => pane?.register(), [pane])
    if (pane === undefined) throw new Error("PANE_SECTION_OUTSIDE_PANE")
    const shared = {
        "data-component": "PaneSection",
        "data-tier": "composition",
        "data-grammar-pane-section-align": align,
        "data-grammar-pane-section-gap": gap,
        "data-grammar-pane-section-bleed": bleed,
        "data-grammar-pane-section-grow": grow || scroll !== undefined ? "true" : undefined,
    }
    const contract = "PADDING-4 GAP-3"
    if (scroll === undefined) {
        return createElement(as, { ...shared, className: "starci-core-pane-section", "data-contract": contract }, children)
    }
    return (
        <VerticalScrollRegion
            {...shared}
            aria-label={scroll.label}
            className="starci-core-pane-section"
            data-grammar-pane-section-scroll="true"
            isScrollable
            {...(scroll.role === undefined ? {} : { role: scroll.role })}
            {...(scroll.tone === undefined ? {} : { tone: scroll.tone })}
            {...(scroll.scrollRef === undefined ? {} : { ref: scroll.scrollRef })}
        >
            {createElement(as, { className: "starci-core-pane-section-content", "data-contract": contract }, children)}
        </VerticalScrollRegion>
    )
}
