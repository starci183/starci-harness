"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { useEffect, useRef, useState } from "react"
import { Skeleton as HeroSkeleton } from "@heroui/react"
import { assetSlotAttributes, type AssetSlotProps } from "./assetSlot.js"
import { reportUnresolvedStatics, useMediaUrl, type MediaSourceRef } from "./mediaSource.js"
import { ImageLightbox } from "./ImageLightbox.js"
import { StateGlyph } from "./StateGlyph.js"
import type { NoChildren } from "../../tier.js"

export type { AssetSlotProps } from "./assetSlot.js"
export type { MediaSourceRef } from "./mediaSource.js"

/** The ratios of the box an image claims before its bytes arrive. `auto` keeps the picture's own ratio. */
export type ImageRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9" | "auto"
export type ImageLoadState = "loading" | "loaded" | "error"

/** One file of the same picture: its width (a `w` descriptor) or its pixel density (an `x` descriptor), never both. */
export type ImageRendition = MediaSourceRef & (
    | { readonly width: number; readonly density?: never }
    | { readonly density: number; readonly width?: never }
)

/** The names the open zoom needs: the control that opens it and the one that closes it. */
export type ImageZoom = { readonly openLabel: string; readonly closeLabel: string }

/** The facts a picture needs wherever it is drawn (a card poster takes exactly these). */
export type ImageFacts = {
    /** Required. Pass "" only for a purely decorative image. */
    readonly alt: string
    /** The files of this picture, smallest first. Drawn as `srcset`; the source stays the fallback of a browser that reads none. */
    readonly renditions?: readonly ImageRendition[]
    /** Which rendition the box needs at each width, as the `sizes` attribute: `(min-width: 64rem) 50vw, 100vw`. */
    readonly sizes?: string
    /** Offscreen images defer by default; above-the-fold art may be eager. */
    readonly loading?: "lazy" | "eager"
}

export type ImageProps = NoChildren & AssetSlotProps & ImageFacts & MediaSourceRef & {
    readonly ratio?: ImageRatio
    readonly fit?: "cover" | "contain"
    /** Intrinsic size in CSS pixels: a hint of the file's own size (and what a media `Link` sizes its box from). */
    readonly width?: number
    readonly height?: number
    /** A caption under the picture: the image becomes a `figure` with a `figcaption`. */
    readonly caption?: string
    /** Opt in: the picture opens larger in a lightbox over the page. */
    readonly zoom?: ImageZoom
    /** Unresolved picture (a first load of its record): the ready box under a shimmer. A region tells it. */
    readonly isLoading?: boolean
    readonly onLoadStateChange?: (state: ImageLoadState) => void
    /**
     * `default` paints the neutral loading plate behind the picture; `none` keeps the box transparent for cut-out art
     * (a mascot or logo with an alpha channel) that must sit directly on its surface.
     */
    readonly plate?: "default" | "none"
}

/** The `srcset` value of a list of renditions, with the URL each resolves to; renditions that resolve to nothing are left out. */
export const renditionSrcSet = (renditions: readonly ImageRendition[], urlOf: (source: MediaSourceRef) => string | null): string | undefined => {
    const parts = renditions.flatMap((rendition) => {
        const url = urlOf(rendition)
        if (url === null) return []
        return [`${url} ${rendition.width === undefined ? `${rendition.density}x` : `${rendition.width}w`}`]
    })
    return parts.length === 0 ? undefined : parts.join(", ")
}

/**
 * A reserved-ratio picture with its loading, loaded and error states.
 *
 * The box claims its ratio before the bytes arrive, so a lazy image never shifts the page; a shimmer stands in the box
 * until the picture decodes, and a neutral glyph on the plate stands in it when the file fails. `renditions` and `sizes`
 * become `srcset` and `sizes`, so a phone fetches the small file and a wide screen the large one. The picture is lazy and
 * async-decoded by default. `alt` is required by type; `""` marks it decorative. The corner is the Grammar's one radius.
 * Contract: img MOTION-2 (load choreography preserves the final frame under reduced motion).
 */
const ImageInner = ({
    src,
    staticsKey,
    alt,
    ratio = "auto",
    fit = "cover",
    width,
    height,
    renditions,
    sizes,
    loading = "lazy",
    caption,
    zoom,
    onLoadStateChange,
    plate = "default",
    ...assetSlot
}: ImageProps) => {
    const urlOf = useMediaUrl()
    const source = (staticsKey === undefined ? { src: src ?? "" } : { staticsKey }) as MediaSourceRef
    const url = urlOf(source)
    const srcSet = renditions === undefined ? undefined : renditionSrcSet(renditions, urlOf)
    const [state, setState] = useState<ImageLoadState>(url === null ? "error" : "loading")
    const [isZoomOpen, setZoomOpen] = useState(false)
    const imageRef = useRef<HTMLImageElement>(null)
    const report = (next: ImageLoadState) => {
        setState(next)
        onLoadStateChange?.(next)
    }
    useEffect(() => {
        if (url === null) {
            reportUnresolvedStatics("Image", source)
            report("error")
            return
        }
        setState("loading")
        // A cached image can finish before hydration attaches onLoad.
        const image = imageRef.current
        if (image !== null && image.complete && image.naturalWidth > 0) report("loaded")
    }, [url])

    const failed = state === "error"
    const box = (
        <span
            className="starci-core-image"
            {...(caption === undefined ? { "data-component": "Image", "data-tier": "leaf" } : {})}
            data-grammar-image-ratio={ratio}
            data-grammar-image-fit={fit}
            data-grammar-image-state={state}
            data-grammar-image-plate={plate}
            {...(caption === undefined ? assetSlotAttributes(assetSlot) : {})}
        >
            {failed ? (
                <span
                    className="starci-core-image-fallback"
                    data-grammar-image-fallback="true"
                    {...(alt === "" ? { "aria-hidden": true } : { role: "img", "aria-label": alt })}
                ><StateGlyph /></span>
            ) : (
                <>
                    <img
                        ref={imageRef}
                        alt={alt}
                        className="starci-core-image-element"
                        data-contract="MOTION-2"
                        decoding="async"
                        loading={loading}
                        src={url ?? undefined}
                        {...(srcSet === undefined ? {} : { srcSet })}
                        {...(sizes === undefined || srcSet === undefined ? {} : { sizes })}
                        {...(width === undefined ? {} : { width })}
                        {...(height === undefined ? {} : { height })}
                        onError={() => report("error")}
                        onLoad={() => report("loaded")}
                    />
                    {state === "loading" ? <HeroSkeleton animationType="shimmer" aria-hidden="true" className="starci-core-skeleton starci-core-image-skeleton" data-contract="STATE-2 MOTION-2" /> : null}
                </>
            )}
            {zoom === undefined || failed ? null : (
                <button type="button" className="starci-core-image-zoom" aria-label={zoom.openLabel} aria-haspopup="dialog" onClick={() => setZoomOpen(true)} />
            )}
            {zoom === undefined || failed ? null : (
                <ImageLightbox isOpen={isZoomOpen} onOpenChange={setZoomOpen} title={alt === "" ? zoom.openLabel : alt} closeLabel={zoom.closeLabel} src={url ?? ""} srcSet={srcSet} alt={alt} {...(sizes === undefined ? {} : { sizes })} />
            )}
        </span>
    )
    if (caption === undefined) return box
    return (
        <figure className="starci-core-image-figure" data-component="Image" data-tier="leaf" {...assetSlotAttributes(assetSlot)}>
            {box}
            <figcaption className="starci-core-media-caption" data-contract="FLOW-3">{caption}</figcaption>
        </figure>
    )
}

export const Image = withRegionGeometry(ImageInner)
