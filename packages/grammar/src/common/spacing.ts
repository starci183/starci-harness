/**
 * The one spacing scale of every visual family: 0 4 8 12 16 24 32 (px at a 16px rem). There is no other spacing value.
 * A container holds its content one row step in (12); 16 is written once, as the card's own inset (`--grammar-inset-card`), so a
 * card's body clears its radius; a Button with a glyph reads that token for the vendor's inline padding. It is never a gap: separation beyond an inset is the parent's gap.
 */
export const COMMON_SPACING_SCALE = Object.freeze({
    0: "0",
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    6: "1.5rem",
    8: "2rem",
} as const)

/** The same steps in px at a 16px rem, for the places that draw in canvas units (a graph edge, an SVG label). */
export const COMMON_SPACING_PX = Object.freeze({
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
    8: 32,
} as const)

export type CommonSpacingStep = keyof typeof COMMON_SPACING_SCALE
export type CommonSpacingValue = (typeof COMMON_SPACING_SCALE)[CommonSpacingStep]

/**
 * The gap roles, by the relation between two siblings, each one step of the scale, strictly increasing:
 * seam (a line already divides them), identity (one reading cluster), inline (companions in one unit), row (peers in a
 * row or group), section (blocks under one heading), region (regions with their own heading).
 */
export const COMMON_GAP_ROLES = Object.freeze({
    seam: 0,
    identity: 1,
    inline: 2,
    row: 3,
    section: 6,
    region: 8,
} as const satisfies Readonly<Record<string, CommonSpacingStep>>)

export type CommonGapRole = keyof typeof COMMON_GAP_ROLES
/** The gap roles an app names on a layout frame (`Stack`, `Cluster`); `seam` belongs to dividers and joined faces. */
export type GapRole = Exclude<CommonGapRole, "seam">

/** The root custom properties that carry the scale, by role. A value is read from here, never written twice. */
export const COMMON_SPACING_TOKENS = Object.freeze({
    identity: "--grammar-identity-gap",
    inline: "--grammar-inline-gap",
    row: "--grammar-row-gap",
    section: "--grammar-section-gap",
    region: "--grammar-region-gap",
    inset: "--grammar-inset",
    insetNested: "--grammar-inset-nested",
    insetOpen: "--grammar-inset-open",
    insetCard: "--grammar-inset-card",
    pageInset: "--grammar-page-inset",
    cardPaddingInline: "--grammar-card-padding-inline",
    cardPaddingBlock: "--grammar-card-padding-block",
    overlayInset: "--grammar-overlay-inset",
    paneInsetInline: "--grammar-pane-inset-inline",
    paneInsetBlockStart: "--grammar-pane-inset-block-start",
    paneInsetBlockEndOuter: "--grammar-pane-inset-block-end-outer",
    paneInsetBlockEndDivider: "--grammar-pane-inset-block-end-divider",
} as const)
