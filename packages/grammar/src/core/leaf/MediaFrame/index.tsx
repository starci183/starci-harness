import type { ReactNode } from "react"
import { assetSlotAttributes, type AssetSlotProps } from "../Image/assetSlot.js"
import type { AccentCorner } from "../../accentCorner.js"
import type { NoChildren } from "../../tier.js"

export type MediaFrameProps = NoChildren & AssetSlotProps & {
    /** The image, video or illustration the frame holds. */
    readonly media: ReactNode
    readonly caption?: ReactNode
    readonly aspect?: "landscape" | "portrait" | "square" | "auto"
    readonly fit?: "cover" | "contain"
    readonly treatment?: "framed" | "plain"
    /** One logical corner of the viewport at the Common accent radius (`--grammar-accent-corner`), as on SurfaceCard. */
    readonly accentCorner?: AccentCorner
}

/**
 * Product-family frame for an approved illustration, photograph or generated bitmap.
 * Asset purpose and generation authority stay with the consuming product workflow.
 */
export const MediaFrame = ({
    media,
    caption,
    aspect = "landscape",
    fit = "cover",
    treatment = "framed",
    accentCorner,
    ...assetSlot
}: MediaFrameProps) => (
    <figure
        className="starci-core-media-frame"
        data-component="MediaFrame"
        data-tier="leaf"
        {...assetSlotAttributes(assetSlot)}
        data-contract="GAP-2 MARGIN-0"
        data-grammar-media-aspect={aspect}
        data-grammar-media-fit={fit}
        data-grammar-media-treatment={treatment}
    >
        <div
            className="starci-core-media-viewport"
            data-contract={treatment === "plain" ? "OVERFLOW-2 SURFACE-1" : "OVERFLOW-2 BOUNDARY-5 SURFACE-3"}
            data-grammar-accent-corner={accentCorner}
            data-grammar-media="true"
        >{media}</div>
        {caption === undefined ? null : <figcaption className="starci-core-media-caption" data-contract="FLOW-3">{caption}</figcaption>}
    </figure>
)
