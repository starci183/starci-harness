"use client"

import { Card } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { SurfaceNesting, useSurfaceNesting } from "../../surfaceContext.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { assertPresentationState, treatmentFor, type PresentationState } from "../../state.js"
import { VerticalScrollRegion } from "../../composite/VerticalScrollRegion/index.js"
import { DEFAULT_SURFACE_HEADING_LEVEL, Label, type SurfaceHeadingLevel } from "../../primitive/Label/index.js"
import { surfaceFactClassName } from "../SurfaceListCard/classNames.js"
import {
    getSurfaceCardClassName,
    getSurfaceContentClassName,
    surfaceClassName,
    surfaceHighlightClassName,
    surfaceHighlightSweepClassName,
    surfaceLabelClassName,
    surfaceArtworkClassName,
    surfaceOrbitClassName,
    type SurfaceCardHeight,
    type SurfaceCardMeasure,
    type SurfaceCardMotif,
    type SurfaceCardTreatment,
} from "./classNames.js"

export type WholeCardAction =
    | {
        readonly kind: "link"
        readonly href: string
        readonly label: string
    }
    | {
        readonly kind: "button"
        readonly press: () => void
        readonly label: string
    }

type LabelledSurfaceCard = {
    readonly label: string
    readonly ariaLabel?: string
}

type SelfNamedSurfaceCard = {
    readonly label?: undefined
    /** Optional when the surrounding semantic owner already names this purely visual boundary. */
    readonly ariaLabel?: string
}

/** The ordinary light surface: no artwork slot, no motif. */
type PlainSurfaceCard = {
    readonly treatment?: "surface"
    readonly artwork?: undefined
    readonly motif?: undefined
}

/**
 * Decorative art (a `Mascot`, or an `Image` / `MediaFrame`, carrying its `assetSlot`). The slot is `aria-hidden`,
 * inert to the pointer, sits behind the content and may bleed off the card's top and inline-end edges; below a
 * 48rem card it drops into the head zone in flow, so it never covers text.
 */
type SurfaceCardArtwork = ReactNode

/**
 * The soft card: the brand's light tint as ground (the family's `accentSoft`) under the default foreground, for a
 * card the product deliberately raises (SURFACE-4), such as a first-run welcome. It rebinds the surface pair onto
 * the tint and may carry copy and controls; it keeps the artwork slot and has no motif.
 */
type SoftSurfaceCard = {
    readonly treatment: "soft"
    readonly artwork?: SurfaceCardArtwork
    readonly motif?: undefined
}

/**
 * The ink band: the page's one signature overview moment (DISCIPLINE-3), painted on the family's brand
 * ink (Core: the accent fill and its foreground; Offset Pop: its ink and canvas). Its content re-binds
 * the surface pair (surface, foreground, muted, separator) and the soft tone pairs onto the ink, so grammar
 * children keep their own anatomy and stay AA.
 */
type InkSurfaceCard = {
    readonly treatment: "ink"
    readonly artwork?: SurfaceCardArtwork
    /** Decorative motif in the artwork zone: `orbit` draws thin rings with nodes (static SVG, low contrast). */
    readonly motif?: SurfaceCardMotif
}

export type SurfaceCardProps = (LabelledSurfaceCard | SelfNamedSurfaceCard) & (PlainSurfaceCard | SoftSurfaceCard | InkSurfaceCard) & {
    readonly children: ReactNode
    readonly fact?: string
    /** Optional content at the end of the external label row. It takes the fact's single place. */
    readonly labelEnd?: ReactNode
    /**
     * Outline rank of the visible `label` (default 3). Pick the rank below the nearest heading
     * above this surface so the page never skips a level.
     */
    readonly headingLevel?: SurfaceHeadingLevel
    readonly state?: PresentationState
    readonly wholeAction?: WholeCardAction
    /** Contained content has exactly one internal scroll owner. */
    readonly scroll?: "page" | "contained"
    /** Convenience capability: make the content region a HeroUI Vertical ScrollShadow. */
    readonly isScrollable?: boolean
    /** One inset block or multiple touching child faces separated inside the card. */
    readonly composition?: "single" | "joined"
    /** Grammar-owned width contract for ordinary content or compact form surfaces. */
    readonly measure?: SurfaceCardMeasure
    /** Let a peer grid stretch the complete surface anatomy without consumer descendant selectors. */
    readonly height?: SurfaceCardHeight
    /** Draw one accent sweep behind this surface; use for one featured card only. */
    readonly isHighlight?: boolean
    /**
     * How the card sits in the layout. `floating` (default): a card among other content in the page flow. `panel`: the card
     * IS a docked panel or full-height region of the layout (a side column such as a chat details pane). The family decides
     * where each places a visible `label` (ruling card-label-placement-per-grammar): Core keeps a floating label outside,
     * as an unpainted row above the material, and carries a panel title inside, as the card header; Offset Pop keeps both
     * outside. Stamped as `data-grammar-surface-placement`.
     */
    readonly placement?: SurfaceCardPlacement
}

export type SurfaceCardPlacement = "floating" | "panel"

/**
 * The orbit motif: three thin concentric rings with five small nodes, one static SVG. It is drawn in the
 * artwork zone only (never behind body copy), in the ink band's orbit colour (the ink foreground at 20%),
 * and never animates, so reduced motion has nothing to stop.
 */
const OrbitMotif = () => (
    <svg
        aria-hidden="true"
        className={surfaceOrbitClassName}
        data-grammar-surface-orbit="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 0 480 320"
    >
        <ellipse cx="264" cy="168" rx="216" ry="118" />
        <ellipse cx="264" cy="168" rx="150" ry="80" />
        <ellipse cx="264" cy="168" rx="84" ry="44" />
        <circle cx="48" cy="168" r="4" />
        <circle cx="420" cy="86" r="3.5" />
        <circle cx="160" cy="236" r="3.5" />
        <circle cx="370" cy="226" r="3" />
        <circle cx="196" cy="140" r="2.5" />
    </svg>
)

export const SurfaceCard = (props: SurfaceCardProps) => {
    const {
        label,
        ariaLabel,
        children,
        fact,
        labelEnd,
        headingLevel = DEFAULT_SURFACE_HEADING_LEVEL,
        state = "neutral",
        wholeAction,
        scroll = "page",
        isScrollable = false,
        composition = "single",
        measure = "content",
        height = "auto",
        isHighlight = false,
        placement = "floating",
    } = props
    const depth = useSurfaceNesting() ? "nested" : "top"
    const treatment: SurfaceCardTreatment = props.treatment ?? "surface"
    const motif: SurfaceCardMotif = props.treatment === "ink" ? props.motif ?? "none" : "none"
    const artwork = props.treatment === "ink" || props.treatment === "soft" ? props.artwork : undefined
    assertPresentationState(state)
    const headingId = useId()
    const stateTreatment = treatmentFor(state)
    const disabled = state === "unavailable" || state === "pending"
    const accessibleName = ariaLabel ?? label
    const contained = isScrollable || scroll === "contained"

    // The painted frame owns elevation; its content owns the inset and joined composition.
    const compositionContract = composition === "joined" ? "GAP-0 PADDING-0" : "PADDING-4"
    const contentContract = [
        "SURFACE-2",
        "OVERFLOW-2",
        depth === "nested" ? "BOUNDARY-5" : "BOUNDARY-6",
    ].join(" ")
    const rootContract = wholeAction === undefined ? undefined : "SURFACE-4"

    const action = wholeAction?.kind === "link" ? (
        <a
            aria-disabled={disabled || undefined}
            aria-label={wholeAction.label}
            data-grammar-whole-action="link"
            href={disabled ? undefined : wholeAction.href}
            tabIndex={disabled ? -1 : undefined}
        />
    ) : wholeAction?.kind === "button" ? (
        <button
            aria-label={wholeAction.label}
            data-grammar-whole-action="button"
            disabled={disabled}
            onClick={wholeAction.press}
            type="button"
        />
    ) : null

    const surface = (
        <Card.Content
            aria-label={label === undefined ? accessibleName : undefined}
            aria-labelledby={label === undefined ? undefined : headingId}
            className={surfaceClassName}
            data-contract={contentContract}
            data-grammar-frame="bounded"
            data-grammar-surface-composition={composition}
            data-grammar-surface-height={height}
            data-grammar-scroll={contained ? "contained" : "page"}
            data-grammar-state={state}
            data-grammar-surface-depth={depth}
            data-grammar-treatment={stateTreatment.tone}
            data-grammar-surface-treatment={treatment}
            data-grammar-surface-artwork={artwork !== undefined ? "art" : motif !== "none" ? "motif" : "none"}
        >
            {artwork !== undefined || motif !== "none" ? (
                <div
                    aria-hidden="true"
                    className={surfaceArtworkClassName}
                    data-grammar-surface-artwork={artwork === undefined ? "none" : "art"}
                    data-grammar-surface-motif={motif}
                >
                    {motif === "orbit" ? <OrbitMotif /> : null}
                    {artwork}
                </div>
            ) : null}
            <VerticalScrollRegion
                className={getSurfaceContentClassName(measure, contained)}
                data-contract={compositionContract}
                data-grammar-surface-content="true"
                data-grammar-surface-composition={composition}
                isScrollable={contained}
                {...(contained ? (label === undefined ? (accessibleName === undefined ? {} : { "aria-label": accessibleName }) : { "aria-labelledby": headingId }) : {})}
            >
                {children}
            </VerticalScrollRegion>
            {action}
        </Card.Content>
    )
    const highlightedSurface = isHighlight && state !== "pending" ? (
        <div className={surfaceHighlightClassName} data-grammar-highlight="true">
            <div aria-hidden className={surfaceHighlightSweepClassName} />
            {surface}
        </div>
    ) : surface

    const content = (
        <Card.Root
            className={getSurfaceCardClassName(measure) ?? ""}
            data-contract={rootContract}
            data-grammar-frame="bounded"
            data-grammar-surface-composition={composition}
            data-grammar-surface-height={height}
            data-grammar-interaction={wholeAction === undefined ? "static" : "whole-action"}
            data-grammar-surface-labelled={label === undefined ? "false" : "true"}
            data-grammar-surface-placement={placement}
            data-grammar-surface-card="true"
            data-grammar-nesting="surface"
            data-grammar-surface-treatment={treatment}
            data-component="SurfaceCard"
            data-tier="branch"
            render={(cardProps) => <section {...cardProps} />}
            variant="transparent"
        >
            {label === undefined ? null : (
                <Card.Header className={surfaceLabelClassName ?? ""} data-contract="GAP-2" data-grammar-surface-label="true">
                    <Label as={`h${headingLevel}`} id={headingId}>{label}</Label>
                    <ButtonPlacementProvider placement="chrome">{labelEnd ?? (fact === undefined ? null : (
                        <span className={surfaceFactClassName} data-grammar-surface-depth={depth} data-contract={`TONE-2 ${depth === "nested" ? "FONT-1" : "FONT-2"}`}>{fact}</span>
                    ))}</ButtonPlacementProvider>
                </Card.Header>
            )}
            {highlightedSurface}
        </Card.Root>
    )
    return <SurfaceNesting>{content}</SurfaceNesting>
}
