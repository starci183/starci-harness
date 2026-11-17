import { cn } from "@heroui/react"
import { formCompactSurfaceClassName, formSurfaceClassName } from "../../classNames.js"

export type SurfaceCardMeasure = "content" | "narrow" | "formCompact"
export type SurfaceCardHeight = "auto" | "fill"

/**
 * Surface-card geometry is SHIPPED.
 *
 * Every name below hooks a `.starci-core-*` rule in `src/common/styles.css`. The card, its header
 * and its content region are HeroUI `Card` parts, so the sheet re-states their box in the
 * `starci-grammar-common` layer with `!important` where the vendor's `components` layer sets the
 * same property.
 */

/** `measure="narrow"`: the card is capped at 30rem (an order card in a chat bubble). */
export const surfaceNarrowClassName = cn("starci-core-surface-card--narrow") ?? "starci-core-surface-card--narrow"
/** Identifies the outer labelled surface-card anatomy. */
export const surfaceCardClassName = cn("starci-core-surface-card") ?? "starci-core-surface-card"
/**
 * Selects an owned measure contract without exposing structural class hooks to consumers. Height is not a class: the fill form is
 * drawn by `[data-grammar-surface-height="fill"]` on the same root.
 */
export const getSurfaceCardClassName = (measure: SurfaceCardMeasure) => cn(
    surfaceCardClassName,
    measure === "formCompact" ? formSurfaceClassName : undefined,
    measure === "formCompact" ? formCompactSurfaceClassName : undefined,
    measure === "narrow" ? surfaceNarrowClassName : undefined,
)
/** Identifies the external label row of a surface card. */
export const surfaceLabelClassName = cn("starci-core-surface-label") ?? "starci-core-surface-label"
/** Identifies the bounded surface content shell. */
export const surfaceClassName = cn("starci-core-surface") ?? "starci-core-surface"
/** Identifies the content region inside a surface. */
export const surfaceContentClassName = cn("starci-core-surface-content") ?? "starci-core-surface-content"
/** Keeps the peer fact at the same visual level as its owning label. */
export const surfaceFactClassName = cn("starci-core-surface-fact") ?? "starci-core-surface-fact"
/** Identifies the optional note region: a small muted line under the card. */
export const surfaceNoteClassName = cn("starci-core-surface-note") ?? "starci-core-surface-note"
/** The one band of commands at the foot of an object card, under a hairline. */
export const surfaceActionsClassName = cn("starci-core-surface-actions") ?? "starci-core-surface-actions"
/** Identifies a tile's anatomy: mark, name, copy and the foot row. */
export const tileClassName = cn("starci-core-tile") ?? "starci-core-tile"
