"use client"

import { ScrollShadow, cn } from "@heroui/react"
import { forwardRef, useCallback, useRef, type ComponentProps } from "react"
import { IconButton } from "./primitive/IconButton/index.js"
import type { IconSourceProps } from "./primitive/Icon/index.js"

/** HeroUI's horizontal chevron geometry, shared by both directional controls. */
const ScrollChevron = (props: IconSourceProps) => <svg {...props} viewBox="0 0 16 16" fill="none">
    <path d="M10.53 2.97a.75.75 0 0 1 0 1.06L6.56 8l3.97 3.97a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 0" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
</svg>

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
            <IconButton source={ScrollChevron} label={scrollPreviousLabel} variant="ghost" size="sm" onPress={() => scrollPage(-1)} />
        </span>
        <span className="starci-horizontal-scroll-next">
            <IconButton source={ScrollChevron} label={scrollNextLabel} variant="ghost" size="sm" onPress={() => scrollPage(1)} />
        </span>
    </div>
})

HorizontalScrollFrame.displayName = "HorizontalScrollFrame"
