"use client"

import { forwardRef, type ComponentProps, type ReactNode } from "react"
import { cn } from "@heroui/react"
import { HorizontalScrollFrame } from "../../HorizontalScrollFrame.js"
import { scrollRegionFocusProps } from "../VerticalScrollRegion/index.js"

/**
 * Which overflow answer this region gives for its one axis.
 *
 * `always` is the region standing on its own: the axis scrolls, full stop (OVERFLOW-3). `needed` is
 * the same one axis scrolling only where the content actually overflows (OVERFLOW-4) - the answer a
 * peer strip gives. The region is the node that carries the stamp, so the owner has to be able to
 * say which of the two it is; passing `data-contract` in was silently replaced by this element's own.
 */
export type HorizontalScrollRegionOverflow = "always" | "needed"

export type HorizontalScrollRegionProps = Omit<ComponentProps<"div">, "children" | "className"> & {
    readonly children: ReactNode
    /** Uses the ScrollShadow-owned no-chrome treatment while retaining horizontal reachability. */
    readonly hideScrollBar?: boolean
    /** The region's own overflow answer; the stamp and the render both follow it. */
    readonly overflow?: HorizontalScrollRegionOverflow
    /** Directional page controls, shown only at edges with more content. Default `true`. */
    readonly carets?: boolean
    /** Localized accessible names for the previous and next page controls. */
    readonly scrollPreviousLabel?: string
    readonly scrollNextLabel?: string
    /**
     * Keyboard reachability (WCAG 2.1.1). Default `true`: the region is a Tab stop and, when named,
     * a `role="region"`. Pass `false` when every scrolled item is itself focusable (tabs, OTP slots).
     */
    readonly isFocusable?: boolean
}

/** What a Grammar frame passes when it draws a scroll region inside its own anatomy; an app's `HorizontalScrollRegion` takes neither. */
export type HorizontalScrollRegionPartProps = HorizontalScrollRegionProps & { readonly className?: string | undefined }

/** Preserve intrinsic inline content and expose HeroUI's horizontal overflow affordance, with the class a frame's stylesheet names. */
export const HorizontalScrollRegionPart = forwardRef<HTMLDivElement, HorizontalScrollRegionPartProps>((props, ref) => {
    const { className, hideScrollBar = true, overflow = "always", isFocusable = true, carets = true, scrollPreviousLabel = "Scroll left", scrollNextLabel = "Scroll right", ...regionProps } = props
    const contract = overflow === "needed"
        ? "PADDING-1 MEASURE-3 OVERFLOW-4 OVERFLOW-5"
        : "PADDING-1 MEASURE-3 OVERFLOW-3 OVERFLOW-5"
    return (
        <HorizontalScrollFrame
            carets={carets}
            scrollPreviousLabel={scrollPreviousLabel}
            scrollNextLabel={scrollNextLabel}
            data-component="HorizontalScrollRegion"
            data-tier="frame"
            {...regionProps}
            {...scrollRegionFocusProps(regionProps, isFocusable)}
            ref={ref}
            className={cn("starci-core-horizontal-scroll-region", className)}
            data-contract={contract}
            data-grammar-overflow={overflow}
            hideScrollBar={hideScrollBar}
            orientation="horizontal"
        />
    )
})

HorizontalScrollRegionPart.displayName = "HorizontalScrollRegionPart"

/** Preserve intrinsic inline content and expose HeroUI's horizontal overflow affordance. */
export const HorizontalScrollRegion = forwardRef<HTMLDivElement, HorizontalScrollRegionProps>((props, ref) => <HorizontalScrollRegionPart {...props} ref={ref} />)

HorizontalScrollRegion.displayName = "HorizontalScrollRegion"
