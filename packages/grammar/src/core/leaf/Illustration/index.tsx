"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { useEffect, useRef, useState } from "react"
import { Skeleton as HeroSkeleton } from "@heroui/react"
import { assetSlotAttributes, type AssetSlotProps } from "../Image/assetSlot.js"
import { reportUnresolvedStatics, useMediaUrl, type MediaSourceRef } from "../Image/mediaSource.js"
import type { ImageLoadState } from "../Image/index.js"
import type { NoChildren } from "../../tier.js"

/** Below 48rem (767.98px): the compact breakpoint the Mascot step-down and the crop of an Illustration share. */
const COMPACT_MAX_PX = 767.98
const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_PX}px)`

/** `fill` takes the whole box of its host (an `EntryFrame` art pane, a hero band); the others claim a ratio of the host's width. */
export type IllustrationRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9" | "fill"

/** The crop drawn below the compact breakpoint (48rem): another file, and a ratio of its own when the crop's shape differs. */
export type IllustrationCompact = MediaSourceRef & { readonly ratio?: IllustrationRatio }

export type IllustrationProps = NoChildren & AssetSlotProps & MediaSourceRef & {
    /** Decorative by default: `""` hides the art from assistive technology. A non-empty alt makes it meaningful and names it. */
    readonly alt?: string
    readonly ratio?: IllustrationRatio
    /** Art direction: below 48rem the browser draws this file (and ratio) instead, through a `picture` source. */
    readonly compact?: IllustrationCompact
    readonly fit?: "cover" | "contain"
    /** Offscreen art defers by default; the first screen's art may be eager. */
    readonly loading?: "lazy" | "eager"
    /** Unresolved art (a first load): the ready box under a shimmer. A region tells it. */
    readonly isLoading?: boolean
}

/**
 * A decorative image region for hero and marketing art and for empty states: art that says nothing the words beside it do
 * not. The box claims its ratio, a shimmer stands in it until the art decodes, and a failed file leaves the plate with no
 * mark (the art is never the only way to read the page). Below 48rem a `compact` file and ratio may replace the wide crop
 * (art direction), so a banner crop does not shrink to a smudge on a phone. Decorative unless `alt` names it (A11Y-2).
 */
const IllustrationInner = ({
    src,
    staticsKey,
    alt = "",
    ratio = "4:3",
    compact,
    fit = "cover",
    loading = "lazy",
    ...assetSlot
}: IllustrationProps) => {
    const urlOf = useMediaUrl()
    const source = (staticsKey === undefined ? { src: src ?? "" } : { staticsKey }) as MediaSourceRef
    const url = urlOf(source)
    const compactUrl = compact === undefined ? null : urlOf(compact)
    const [state, setState] = useState<ImageLoadState>(url === null ? "error" : "loading")
    const imageRef = useRef<HTMLImageElement>(null)
    useEffect(() => {
        if (url === null) {
            reportUnresolvedStatics("Illustration", source)
            setState("error")
            return
        }
        setState("loading")
        const image = imageRef.current
        if (image !== null && image.complete && image.naturalWidth > 0) setState("loaded")
    }, [url, compactUrl])

    return (
        <span
            className="starci-core-illustration"
            data-component="Illustration"
            data-tier="leaf"
            data-contract="A11Y-2"
            data-grammar-illustration-ratio={ratio}
            data-grammar-illustration-compact-ratio={compact?.ratio}
            data-grammar-illustration-fit={fit}
            data-grammar-illustration-state={state}
            {...(alt === "" ? { "aria-hidden": true } : {})}
            {...assetSlotAttributes(assetSlot)}
        >
            {state === "error" ? null : (
                <picture className="starci-core-illustration-picture">
                    {compactUrl === null ? null : <source media={COMPACT_QUERY} srcSet={compactUrl} />}
                    <img
                        ref={imageRef}
                        alt={alt}
                        className="starci-core-illustration-element"
                        data-contract="MOTION-2"
                        decoding="async"
                        loading={loading}
                        src={url ?? undefined}
                        onError={() => setState("error")}
                        onLoad={() => setState("loaded")}
                    />
                </picture>
            )}
            {state === "loading" ? <HeroSkeleton animationType="shimmer" aria-hidden="true" className="starci-core-skeleton starci-core-illustration-skeleton" data-contract="STATE-2 MOTION-2" /> : null}
        </span>
    )
}

export const Illustration = withRegionGeometry(IllustrationInner)
