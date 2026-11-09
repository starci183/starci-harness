"use client"

import { ScrollShadow, cn } from "@heroui/react"
import { forwardRef, useCallback, useRef, type ComponentProps } from "react"
import { ButtonPlacementProvider } from "./buttonIntent.js"
import { IconButton } from "./leaf/IconButton/index.js"
import { glyphSource } from "./leaf/Icon/glyphs.js"

/** The outline chevron of both directional controls (the vocabulary's `chevron-start`; the next control mirrors it in CSS). */
const ScrollChevron = glyphSource("chevron-start")

type HorizontalScrollFrameProps = ComponentProps<typeof ScrollShadow> & {
    readonly carets?: boolean
    readonly appearance?: "region" | "tabs"
    readonly scrollPreviousLabel: string
    readonly scrollNextLabel: string
}

/** One horizontal scroller, with HeroUI's fading edges and directional page controls. */
export const HorizontalScrollFrame = forwardRef<HTMLDivElement, HorizontalScrollFrameProps>(({
    carets = true,
    appearance = "region",
    scrollPreviousLabel,
    scrollNextLabel,
    className,
    ...props
}, forwardedRef) => {
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const setRef = useCallback((node: HTMLDivElement | null) => {
        scrollerRef.current = node
        if (typeof forwardedRef === "function") forwardedRef(node)
        else if (forwardedRef !== null) forwardedRef.current = node
    }, [forwardedRef])
    const scrollPage = (direction: number) => {
        const node = scrollerRef.current
        if (node === null) return
        const rtl = getComputedStyle(node).direction === "rtl"
        const maximum = Math.max(0, node.scrollWidth - node.clientWidth)
        const target = node.scrollLeft + direction * node.clientWidth * 0.8 * (rtl ? -1 : 1)
        node.scrollTo({
            left: Math.min(rtl ? 0 : maximum, Math.max(rtl ? -maximum : 0, target)),
            behavior: "smooth",
        })
    }
    const scroller = <ScrollShadow {...props} ref={setRef} orientation="horizontal" className={cn(className, appearance === "tabs" ? "tabs__list-container__scroller" : undefined)} />
    if (!carets) return scroller
    return <div className={cn("starci-horizontal-scroll-frame", appearance === "tabs" ? "tabs__list-container" : undefined)} data-scroll-appearance={appearance}>
        {scroller}
        <span className="starci-horizontal-scroll-prev">
            <ButtonPlacementProvider placement="chrome"><IconButton source={ScrollChevron} label={scrollPreviousLabel} intent="neutral" size="sm" onPress={() => scrollPage(-1)} /></ButtonPlacementProvider>
        </span>
        <span className="starci-horizontal-scroll-next">
            <ButtonPlacementProvider placement="chrome"><IconButton source={ScrollChevron} label={scrollNextLabel} intent="neutral" size="sm" onPress={() => scrollPage(1)} /></ButtonPlacementProvider>
        </span>
    </div>
})

HorizontalScrollFrame.displayName = "HorizontalScrollFrame"
