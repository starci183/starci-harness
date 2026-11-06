import { cn } from "@heroui/react"
import {
    formCompactSurfaceClassName,
    formScrollViewportClassName,
    formSurfaceClassName,
} from "../../classNames.js"

export type SurfaceCardMeasure = "content" | "form" | "formCompact"
export type SurfaceCardHeight = "auto" | "fill"

/**
 * Surface-card geometry is SHIPPED.
 *
 * Every name below hooks a `.starci-core-*` rule in `src/common/styles.css`. The card, its header
 * and its content region are HeroUI `Card` parts, so the sheet re-states their box in the
 * `starci-grammar-common` layer with `!important` where the vendor's `components` layer sets the
 * same property.
 */

/** Identifies the outer labelled surface-card anatomy. */
export const surfaceCardClassName = cn("starci-core-surface-card") ?? "starci-core-surface-card"
/**
 * Selects an owned measure contract without exposing structural class hooks to consumers.
 *
 * Height is not a class: the fill form is drawn by `[data-grammar-surface-height="fill"]` on the same
 * root, so the old `starci-core-surface-card--fill` modifier (which no sheet ever selected) is gone.
 */
export const getSurfaceCardClassName = (measure: SurfaceCardMeasure) => cn(
    surfaceCardClassName,
    measure === "form" || measure === "formCompact" ? formSurfaceClassName : undefined,
    measure === "formCompact" ? formCompactSurfaceClassName : undefined,
)
/** Identifies the external label row of a surface card. */
export const surfaceLabelClassName = cn("starci-core-surface-label") ?? "starci-core-surface-label"
/** Identifies the bounded surface content shell. */
export const surfaceClassName = cn("starci-core-surface") ?? "starci-core-surface"
/** Identifies the content region inside a surface. */
export const surfaceContentClassName = cn("starci-core-surface-content") ?? "starci-core-surface-content"
/** Binds the form-scroll measure to the Grammar-owned scroll viewport only when it exists. */
export const getSurfaceContentClassName = (measure: SurfaceCardMeasure, contained: boolean) => cn(
    surfaceContentClassName,
    contained && (measure === "form" || measure === "formCompact") ? formScrollViewportClassName : undefined,
)
/** Anchor the singular continuation highlight at the surface boundary. */
export const surfaceHighlightClassName = cn("starci-core-surface-highlight") ?? "starci-core-surface-highlight"
/** Decorative sweep layer painted behind the highlighted surface. */
export const surfaceHighlightSweepClassName = cn("starci-core-surface-highlight-sweep") ?? "starci-core-surface-highlight-sweep"

/**
 * `surface` is the ordinary face; `soft` is the brand's light tint (the family's `accentSoft`) under the default
 * foreground; `ink` is the one signature band painted on the family's brand ink.
 */
export type SurfaceCardTreatment = "surface" | "soft" | "ink"
/**
 * The one logical corner drawn at the Common accent radius (`--grammar-accent-corner`); the other corners keep the
 * family's surface radius. Logical, so it follows the writing direction.
 */
export type AccentCorner = "start-start" | "start-end" | "end-start" | "end-end"
/** Decorative motif of the ink band's artwork zone. */
export type SurfaceCardMotif = "none" | "orbit"

/** Decorative, `aria-hidden` artwork zone of a painted treatment (art slot, and the ink band's motif); it may bleed off the card edge. */
export const surfaceArtworkClassName = cn("starci-core-surface-artwork") ?? "starci-core-surface-artwork"
/** The static orbit motif SVG inside the artwork zone. */
export const surfaceOrbitClassName = cn("starci-core-surface-orbit") ?? "starci-core-surface-orbit"

/** Keeps the peer fact at the same visual level as its owning label. */
export const surfaceFactClassName = cn("starci-core-surface-fact") ?? "starci-core-surface-fact"
/** Identifies the optional note region: a small muted line under the card. */
export const surfaceNoteClassName = cn("starci-core-surface-note") ?? "starci-core-surface-note"
/** Identifies the collection region of a list, shared by verdict and ordinary lists. */
export const collectionClassName = cn("starci-core-owned-collection") ?? "starci-core-owned-collection"
/** Identifies a tile's anatomy: mark, name, copy and the foot row. */
export const tileClassName = cn("starci-core-tile") ?? "starci-core-tile"
/** One typed zone above or below a card's body (filter, search, toolbar, figures, more, paging, custom). */
export const surfaceZoneClassName = cn("starci-core-surface-zone") ?? "starci-core-surface-zone"
/** The row of a toolbar zone: the filter tabs lead, the search trails. */
export const surfaceZoneRowClassName = cn("starci-core-surface-zone-row") ?? "starci-core-surface-zone-row"
/** The compact search field of a toolbar zone, drawn from its wide width. */
export const surfaceZoneSearchWideClassName = cn("starci-core-surface-zone-search-wide") ?? "starci-core-surface-zone-search-wide"
/** The search button of a toolbar zone, drawn below its wide width. */
export const surfaceZoneSearchToggleClassName = cn("starci-core-surface-zone-search-toggle") ?? "starci-core-surface-zone-search-toggle"
/** The search row a toolbar's search button opens (narrow widths only). */
export const surfaceZoneSearchOpenClassName = cn("starci-core-surface-zone-search-open") ?? "starci-core-surface-zone-search-open"
/** The body between the header and footer zones of a card. */
export const surfaceMainClassName = cn("starci-core-surface-main") ?? "starci-core-surface-main"
