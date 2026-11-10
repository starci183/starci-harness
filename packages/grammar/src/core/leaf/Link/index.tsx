"use client"

import { withRegionInert } from "../../regionScope.js"
import { Link as HeroLink } from "@heroui/react"
import type { CSSProperties } from "react"
import { Icon } from "../Icon/index.js"
import { glyphSource } from "../Icon/glyphs.js"
import { Image, type ImageProps } from "../Image/index.js"
import type { NoChildren } from "../../tier.js"

export type LinkKind = "internal" | "external"
/**
 * `inline` (default): a text link in prose and meta, the accent colour, underlined on hover. It ends in the anchor icon `↗` ONLY when it is `kind="external"` (0.37.14): an internal
 * destination never draws it. `plain` (0.37.14): a destination named by its label where the surrounding component owns the affordance (a navigation list row, the brand in a shell,
 * a nav entry): the text colour, no underline, no icon; a row draws its own chevron. `head`: the section-head navigation (0.36.0): the label
 * ends in the outline arrow-right icon (16px, currentColor; never the typed glyph) that slides about 3px toward the end on hover, with the hover underline and the inherited size. A `Section` head's `action`
 * takes this variant for its one navigation command (lint `section-head-action`).
 */
export type LinkVariant = "inline" | "head" | "plain"
/*
 * A Link has no size (owner, 2026-11-09): it is HeroUI v3's own link (the underline on hover only, the primary colour, the anchor icon
 * `Link.Icon` at the end of its label) and its type size and
 * leading are INHERITED from the text around it (14 in a body, 12 inside meta or caption text). The packaged sheet never sets a
 * size on it; lint `no-link-size` refuses a size prop or a class on a Link.
 */

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
    /** `inline` (default) is a prose link, with the anchor icon `↗` only when `kind="external"`; `head` is the section-head link that ends in a sliding arrow `→`; `plain` is a destination with no colour, underline or icon (a navigation row's title, a brand). Text links only. */
    readonly variant?: LinkVariant
    /** `external` leaves the app in a new browsing context with `noopener noreferrer`. */
    readonly kind?: LinkKind
    /** Marks the destination the reader is on now (`aria-current="page"`). */
    readonly isCurrent?: boolean
    /** Visited destinations keep a distinct tint unless the surrounding list must stay uniform. */
    readonly visited?: "distinct" | "uniform"
    /** App-owned assistive text appended to an external link, e.g. that it opens a new tab. */
    readonly externalHint?: string
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
    variant = "inline",
    kind = "internal",
    isCurrent = false,
    visited = "distinct",
    externalHint,
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
            data-grammar-link-variant={media === undefined ? variant : "inline"}
            data-grammar-link-content={media === undefined ? "text" : "media"}
            data-grammar-link-size="inherit"
            {...(mediaSize === undefined ? {} : { "data-grammar-link-media-size": mediaSize.kind, style: mediaSize.style })}
            data-grammar-link-visited={visited}
            data-grammar-current={isCurrent ? "true" : "false"}
            isDisabled={isDisabled}
            {...(isDisabled ? { "aria-disabled": true } : { href })}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            {...(onFollow === undefined ? {} : { onPress: () => onFollow() })}
        >
            {media === undefined ? children : <Image {...media} />}
            {media === undefined && variant === "head" ? <span aria-hidden="true" className="starci-core-link-arrow" data-grammar-link-arrow="true"><Icon source={glyphSource("arrow-end")} usage="leading" /></span> : null}
            {media === undefined && variant === "inline" && external ? <HeroLink.Icon aria-hidden="true" data-grammar-link-icon="true" /> : null}
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
