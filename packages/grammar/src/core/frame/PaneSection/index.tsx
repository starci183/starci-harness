"use client"

import { createElement, useCallback, useEffect, useRef, type ReactNode, type Ref } from "react"
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
        /** `log`: a chat thread. A thread is always drawn on the page tone (`--background`, law DNA-COMMON-CHAT-SURFACES), so `tone` is ignored with `log`. */
        readonly role?: "log" | "region"
        /** The ground of a `region` band; a `log` band is always `background`. */
        readonly tone?: "surface" | "background"
        /**
         * The thread's scroller. In a chat frame (0.37.33, DNA-COMMON-CHAT-FRAME-SCROLL) the thread is the only scroller between the fixed head and the fixed
         * composer, so this is the element that scrolls. A `log` band opens at its newest message and follows new ones while the reader is at the foot.
         */
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
    /**
     * Gap between its own children. Default `inline` (`row` before 0.27): the bands of a pane stand a row step apart, so a band's
     * children stand one step closer (the proximity law). `row` and `section` are for a band alone in its pane.
     */
    readonly gap?: "inline" | "row" | "section"
    readonly as?: "div" | "header" | "footer"
    /** `start`: a hairline on the block-start edge, for a pinned decision bar or footer that the content above must not run into. */
    readonly rule?: "start"
    /**
     * The first read of this band has no data yet (knowledge STATE-8). The band is `aria-busy` and tells every Grammar component
     * inside it (`Section`, `SurfaceCard`, `ListBox`, `Timeline`, `DataTable`, `MessageBubble`) to draw its loading structure, so
     * one flag covers the band. A refresh that has data is not loading.
     */
    readonly isLoading?: boolean
    /** The read failed: this takes the place of the band's content. Loading comes first, then error. */
    readonly error?: ErrorData
}

/** How near the foot (px) a reader counts as reading the newest message, so a new one keeps the thread at the foot. */
const FOOT_SLACK = 48

/** Hands one element to the caller's ref (a callback or an object). */
const assignRef = (ref: Ref<HTMLDivElement> | undefined, element: HTMLDivElement | null): void => {
    if (typeof ref === "function") ref(element)
    else if (ref !== null && ref !== undefined) (ref as { current: HTMLDivElement | null }).current = element
}

/**
 * A chat thread opens at its newest message and follows new ones (0.37.33): on mount the scroller goes to its foot, and whenever its content grows while the
 * reader was at the foot it goes there again; a reader who scrolled up to older messages stays where they are.
 */
const useFollowNewest = (isLog: boolean, scrollRef: Ref<HTMLDivElement> | undefined) => {
    const observer = useRef<ResizeObserver | null>(null)
    return useCallback((element: HTMLDivElement | null) => {
        assignRef(scrollRef, element)
        observer.current?.disconnect()
        observer.current = null
        if (!isLog || element === null) return
        let atFoot = true
        const toFoot = () => { element.scrollTop = element.scrollHeight }
        element.addEventListener("scroll", () => { atFoot = element.scrollHeight - element.scrollTop - element.clientHeight <= FOOT_SLACK }, { passive: true })
        toFoot()
        if (typeof ResizeObserver === "undefined") return
        observer.current = new ResizeObserver(() => { if (atFoot) toFoot() })
        observer.current.observe(element)
        const content = element.firstElementChild
        if (content !== null) observer.current.observe(content)
    }, [isLog, scrollRef])
}

/**
 * One band of a Pane: it pads inline by the pane's inset, the sections of a pane stack with the row gap between them,
 * the first takes the pane's block-start inset and the last its block-end inset. With `scroll` the band is its own
 * full-bleed scroll owner and the inset sits on its content, so the scrollbar stays on the pane edge. A section outside
 * a Pane throws `PANE_SECTION_OUTSIDE_PANE`.
 */
export const PaneSection = ({ children: content, grow = false, scroll, align = "start", bleed, gap = "inline", as = "div", rule, isLoading: ownLoading, error }: PaneSectionProps) => {
    const pane = usePaneContext()
    const isLoading = useIsLoading(ownLoading)
    const scrollerRef = useFollowNewest(scroll?.role === "log", scroll?.scrollRef)
    const children = !isLoading && error !== undefined ? <ErrorView error={error} /> : <LoadingScope isLoading={isLoading}>{content}</LoadingScope>
    useEffect(() => pane?.register(), [pane])
    if (pane === undefined) throw new Error("PANE_SECTION_OUTSIDE_PANE")
    const shared = {
        "data-component": "PaneSection",
        "data-tier": "frame",
        "data-grammar-pane-section-align": align,
        "data-grammar-pane-section-gap": gap,
        "data-grammar-pane-section-bleed": bleed,
        "data-grammar-pane-section-rule": rule,
        "data-grammar-pane-section-grow": grow || scroll !== undefined ? "true" : undefined,
        "aria-busy": isLoading ? true : undefined,
        "data-grammar-loading-region": isLoading ? "true" : undefined,
    }
    // A chat thread is always on the page tone (0.37.31, the owner's chat surfaces law): incoming bubbles are the flat white surface on it.
    const tone = scroll?.role === "log" ? "background" : scroll?.tone
    const contract = gap === "row" ? "PADDING-4 GAP-3" : gap === "section" ? "PADDING-4 GAP-4" : "PADDING-4 GAP-2"
    if (scroll === undefined) {
        return createElement(as, { ...shared, className: "starci-core-pane-section", "data-contract": contract }, children)
    }
    return (
        <VerticalScrollRegionPart
            {...shared}
            aria-label={scroll.label}
            className="starci-core-pane-section"
            data-grammar-pane-section-scroll="true"
            {...(scroll.role === "log" ? { "data-grammar-pane-section-thread": "true" } : {})}
            {...(scroll.align === undefined || scroll.align === "start" ? {} : { "data-grammar-pane-section-scroll-align": scroll.align })}
            isScrollable
            {...(scroll.role === undefined ? {} : { role: scroll.role })}
            {...(tone === undefined ? {} : { tone })}
            ref={scrollerRef}
        >
            {createElement(as, { className: "starci-core-pane-section-content", "data-contract": contract }, children)}
        </VerticalScrollRegionPart>
    )
}
