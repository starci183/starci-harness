"use client"

import { withRegionInert } from "../../regionScope.js"
import { Link as HeroLink } from "@heroui/react"
import type { CSSProperties } from "react"
import type { ReactNode } from "react"
import { Image, type ImageProps } from "../Image/index.js"
import { ExternalGlyph } from "../Icon/glyphs.js"
import type { NoChildren } from "../../tier.js"

export type LinkKind = "internal" | "external"
/**
 * The type size of a text link. `inherit` (default): an inline link takes the size and leading of the Text, the head or the cell
 * around it, so a link never changes the line it sits in. `sm` / `md` name a step for a link that stands alone (a directory).
 */
export type LinkSize = "inherit" | "sm" | "md"

type TextLinkContent = {
    readonly children: string
    readonly media?: never
    readonly label?: never
}

type MediaLinkContent = NoChildren & {
    /** The image that is the destination's whole visible target; Image owns its data and load states. */
    readonly media: ImageProps
    /** Required destination name, independent of whether the image is decorative or fails to load. */
    readonly label: string
}

export type LinkProps = (TextLinkContent | MediaLinkContent) & {
    readonly href: string
    /** `external` leaves the app in a new browsing context with `noopener noreferrer`. */
    readonly kind?: LinkKind
    /** Marks the destination the reader is on now (`aria-current="page"`). */
    readonly isCurrent?: boolean
    /** Visited destinations keep a distinct tint unless the surrounding list must stay uniform. */
    readonly visited?: "distinct" | "uniform"
    /** App-owned assistive text appended to an external link, e.g. that it opens a new tab. */
    readonly externalHint?: string
    /** The glyph after an external label; decorative only. Default: Grammar's `external` glyph (a box with an arrow out). */
    readonly externalIcon?: ReactNode
    /** Default `inherit`: the size of the text around the link. */
    readonly size?: LinkSize
    readonly isDisabled?: boolean
    /** Runs alongside navigation. It cannot cancel the destination. */
    readonly onFollow?: () => void
}

/**
 * A destination carried by text or one image.
 *
 * It is always a real anchor (middle-click, copy-link and the `link` role come from the platform).
 * `TextAction` owns action-shaped links; `Link` owns prose and directory links, including the
 * visited and current destination states that action chrome does not draw.
 * Contract: anchor ACTION-3 (always a destination) FOCUS-1, external glyph A11Y-2.
 */
const LinkInner = ({
    children,
    media,
    label,
    href,
    kind = "internal",
    isCurrent = false,
    visited = "distinct",
    externalHint,
    externalIcon,
    size = "inherit",
    isDisabled = false,
    onFollow,
}: LinkProps) => {
    const external = kind === "external"
    // A media link keeps the box it is given: the image fills the link's width and height instead of its container's.
    const mediaSize = media === undefined || (media.width === undefined && media.height === undefined) ? undefined : {
        kind: media.width !== undefined && media.height !== undefined ? "both" : media.width !== undefined ? "width" : "height",
        style: {
            ...(media.width === undefined ? {} : { "--starci-core-link-media-width": `${media.width}px` }),
            ...(media.height === undefined ? {} : { "--starci-core-link-media-height": `${media.height}px` }),
        } as CSSProperties,
    }
    const destinationLabel = media === undefined ? undefined : external && externalHint !== undefined ? `${label} ${externalHint}` : label
    return (
        <HeroLink
            {...(destinationLabel === undefined ? {} : { "aria-label": destinationLabel })}
            aria-current={isCurrent ? "page" : undefined}
            className="starci-core-link"
            data-component="Link"
            data-contract="ACTION-3 FOCUS-1"
            data-tier="leaf"
            data-grammar-link-kind={kind}
            data-grammar-link-content={media === undefined ? "text" : "media"}
            data-grammar-link-size={size}
            {...(mediaSize === undefined ? {} : { "data-grammar-link-media-size": mediaSize.kind, style: mediaSize.style })}
            data-grammar-link-visited={visited}
            data-grammar-current={isCurrent ? "true" : "false"}
            isDisabled={isDisabled}
            {...(isDisabled ? { "aria-disabled": true } : { href })}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            {...(onFollow === undefined ? {} : { onPress: () => onFollow() })}
        >
            {media === undefined ? children : <Image {...media} />}
            {external && media === undefined ? <span aria-hidden="true" className="starci-core-link-external-icon" data-contract="A11Y-2" data-grammar-link-external-icon="true">{externalIcon ?? <ExternalGlyph aria-hidden focusable="false" />}</span> : null}
            {external && externalHint !== undefined ? <span className="starci-core-nav-visually-hidden">{` ${externalHint}`}</span> : null}
        </HeroLink>
    )
}

/**
 * A destination carried by text or one image.
 *
 * It is always a real anchor (middle-click, copy-link and the `link` role come from the platform).
 * `TextAction` owns action-shaped links; `Link` owns prose and directory links, including the
 * visited and current destination states that action chrome does not draw.
 * Contract: anchor ACTION-3 (always a destination) FOCUS-1, external glyph A11Y-2.
 */
export const Link = withRegionInert(LinkInner)
