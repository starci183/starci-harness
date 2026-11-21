import { Skeleton as HeroSkeleton, skeletonVariants } from "@heroui/react"
import type { CSSProperties, ReactNode } from "react"
import type { NoChildren } from "../../tier.js"

/**
 * `text` lines of copy, `rect` media of an aspect, `circle` a round mark (an avatar). The box shapes take the exact box of what they stand for (0.53.0,
 * StarCi Next GRAMMAR-GAPS #16; owner, 2026-11-21: `isLoading ? <Skeleton /> : <Real />`, HeroUI's Skeleton as shipped, sized only by width, height and radius):
 * `box` any box (`width`, `height`, `radius`), `field` a 40px field, `button` a Button (`size` sm 32 / md 40), `switch` a Switch track (`kind` compact 32x18 /
 * toggle 72x40). Every shape is the same fill and shimmer, with no border or ring.
 */
export type SkeletonShape = "text" | "rect" | "circle" | "box" | "field" | "button" | "switch"
/** A box shape's corner: `none` square, `md` the control radius, `full` a pill or a circle. */
export type SkeletonRadius = "none" | "md" | "full"
export type SkeletonRatio = "square" | "landscape" | "wide"
export type SkeletonSize = "sm" | "md" | "lg"

export type SkeletonProps = NoChildren & {
    readonly shape?: SkeletonShape
    /** `text` only: how many lines the unresolved copy will take (1-12). The last line is shorter. */
    readonly lines?: number
    /** `rect` only: the aspect the resolved media or surface will take. */
    readonly ratio?: SkeletonRatio
    /** `circle`: avatar or glyph footprint. `button`: the Button size it stands for, `sm` 32 or `md` 40 (default `md`). */
    readonly size?: SkeletonSize
    /** `box`, `field`, `button`: the width, a CSS length (`8rem`, `60%`). `box` and `field` default to the full width, `button` to 6rem. */
    readonly width?: string
    /** `box` only: the height, a CSS length (`1rem`, `2.5rem`). Default 1rem. */
    readonly height?: string
    /** `box` only: the corner. Default `md`. */
    readonly radius?: SkeletonRadius
    /** `switch` only: the Switch kind it stands for, `compact` 32x18 (default) or `toggle` 72x40. */
    readonly kind?: "compact" | "toggle"
}

const clampLines = (lines: number) => Math.min(12, Math.max(1, Math.floor(Number.isFinite(lines) ? lines : 1)))

/**
 * LEAF - `Skeleton`: inert geometry for initial unresolved content.
 *
 * Always `aria-hidden`: the region that is loading owns `aria-busy`; a skeleton never announces.
 * Shape geometry and the reduced-motion rule (shimmer removed, static tint kept) are SHIPPED by
 * `.starci-core-skeleton` in `src/common/components-overlays.css`.
 */
export const Skeleton = ({ shape = "text", lines = 1, ratio = "landscape", size = "md", width, height, radius, kind = "compact" }: SkeletonProps) => {
    if (shape === "box" || shape === "field" || shape === "button" || shape === "switch") {
        // the geometry of the named shapes is the stylesheet's (ramps.css); a caller's width and height ride on custom properties, never a literal here
        const sized = {
            ...(width === undefined ? {} : { [shape === "button" ? "--starci-core-skeleton-button-width" : "--starci-core-skeleton-width"]: width }),
            ...(height === undefined ? {} : { "--starci-core-skeleton-height": height }),
        }
        return (
            <HeroSkeleton
                animationType="shimmer"
                data-tier="leaf"
                data-component="Skeleton"
                data-shape={shape}
                {...(shape === "box" ? { "data-radius": radius ?? "md" } : {})}
                {...(shape === "button" ? { "data-size": size === "sm" ? "sm" : "md" } : {})}
                {...(shape === "switch" ? { "data-kind": kind } : {})}
                aria-hidden="true"
                data-contract="STATE-2 MOTION-2"
                className="starci-core-skeleton"
                style={sized as CSSProperties}
            />
        )
    }
    if (shape === "text") {
        const count = clampLines(lines)
        return (
            <span
                data-tier="leaf"
                data-component="Skeleton"
                data-shape="text"
                data-lines={count}
                aria-hidden="true"
                data-contract="STATE-2"
                className="starci-core-skeleton-group"
            >
                {Array.from({ length: count }, (_, index) => (
                    <HeroSkeleton
                        key={index}
                        animationType="shimmer"
                        className="starci-core-skeleton"
                        data-contract="MOTION-2"
                        data-grammar-skeleton-line={index === count - 1 && count > 1 ? "last" : "line"}
                    />
                ))}
            </span>
        )
    }

    return (
        <HeroSkeleton
            animationType="shimmer"
            data-tier="leaf"
            data-component="Skeleton"
            data-shape={shape}
            {...(shape === "rect" ? { "data-ratio": ratio } : { "data-size": size })}
            aria-hidden="true"
            data-contract="STATE-2 MOTION-2"
            className="starci-core-skeleton"
        />
    )
}

const PLACEHOLDER_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({ className: "starci-core-skeleton-placeholder" })

/**
 * Internal - skeleton parity for a slot whose ready content is known while it loads (a title, an action, a leading mark).
 * The content is laid out exactly as the ready slot lays it out, unseen and inert, and the shimmer paints over its box,
 * so the loading slot has the ready slot's size by construction. `text` is a run of copy (one line box per line),
 * `block` a control or mark, `circle` a round mark, `region` a block-level body (a code block). Empty text takes a default bar width.
 */
export const SkeletonPlaceholder = ({ children, shape = "text" }: { readonly children?: ReactNode; readonly shape?: "text" | "block" | "circle" | "region" }) => {
    const Element = shape === "region" ? "div" : "span"
    return (
        <Element aria-hidden="true" inert className={PLACEHOLDER_CLASS_NAME} data-shape={shape} data-contract="STATE-2 MOTION-2">
            {children}
        </Element>
    )
}
