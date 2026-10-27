import { skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"

export type TextAs = "div" | "p" | "span"
export type TextTone = "default" | "muted" | "accent"
export type TextSize = "xs" | "sm" | "md" | "metric-lead"
export type TextWeight = "normal" | "medium" | "semibold"
export type TextLive = "off" | "polite" | "assertive"
export type TextOverflow = "wrap" | "truncate" | "clamp-2"

export type TextProps = {
    /** Select the semantic line owner without exposing styling hooks. */
    readonly as?: TextAs
    readonly id?: string
    readonly children?: ReactNode
    /** App-owned glyph or other inline meaning placed before the copy. */
    readonly startContent?: ReactNode
    readonly size?: TextSize
    readonly tone?: TextTone
    readonly weight?: TextWeight
    /** Announce the complete copy through aria-live without changing its text element or typography. */
    readonly live?: TextLive
    /**
     * How the line answers copy longer than its box: wrap it, cut it with an ellipsis, or clamp it
     * to two lines. Shipped by `.starci-core-text[data-overflow]`, so no consumer has to reach
     * through the boundary with a descendant selector on `[data-size]` to force one.
     */
    readonly overflow?: TextOverflow
    /** Set the copy in the monospace stack: identifiers, hashes, paths, figures that line up. */
    readonly mono?: boolean
    /** Tabular figures (`tabular-nums`): digits of equal width, so a column or a counter does not jitter. */
    readonly tabular?: boolean
    readonly isSkeleton?: boolean
    readonly isSuperseded?: boolean
    /** Opt into the shared selected-parent accent treatment. */
    readonly parentEmphasis?: "accent-soft"
}

/**
 * Copy geometry and paint are SHIPPED.
 *
 * `.starci-core-text` in `src/common/styles.css` reads the `data-size`, `data-tone`, `data-weight`,
 * `data-start-content`, `data-superseded`, `data-parent-emphasis` and `data-loading` attributes this
 * element already emits, so a consumer gets the scale without scanning this package with Tailwind.
 */
const TEXT_CLASS_NAME = "starci-core-text"

const FONT_RULE_BY_SIZE: Record<TextSize, string> = {
    xs: "FONT-1",
    sm: "FONT-2",
    md: "FONT-3",
    "metric-lead": "FONT-5",
}

const TONE_RULE_BY_RESOLVED_TONE: Record<TextTone, string> = {
    default: "TONE-1",
    muted: "TONE-2",
    accent: "TONE-3",
}

/**
 * Rule ids this element can claim from its resolved size and tone.
 * `size` selects the exact scale row in font.md `## Scale` (FONT-1/2/3/5); the
 * resolved tone (forced `muted` at `size="xs"`) selects the exact row in
 * tone.md `## Scale` (TONE-1/2/3). the 0.5rem inline gap fires only while `startContent`
 * is shown, matching the `Text` with `startContent` row in gap.md's
 * "Gaps Common already owns" table (GAP-2). Weight classes (`font-medium`,
 * `font-semibold`) and the `parentEmphasis` accent-soft variant carry no rule
 * id here and stay unclaimed.
 */
const getTextContract = (size: TextSize, resolvedTone: TextTone, showsStartContent: boolean) => {
    const ids = [FONT_RULE_BY_SIZE[size], TONE_RULE_BY_RESOLVED_TONE[resolvedTone]]
    if (showsStartContent) ids.push("GAP-2")
    return ids.join(" ")
}

/**
 * The skeleton keeps the size geometry (FONT-1/2/3/5) but its copy is
 * transparent, so no tone is actually visible to claim.
 *
 * Skeleton parity: a loading Text is the same element with the same `as`, size, overflow and start content, so its box is
 * the ready line's box. Its copy (when passed) stays laid out as a measured placeholder inside a shimmer bar and is not
 * painted; with no copy the bar takes the size's default width. The start content keeps its place, unpainted.
 */
const getTextSkeletonContract = (size: TextSize) => FONT_RULE_BY_SIZE[size]

/** The shimmer bar inside a loading line: it wraps the copy (or a default width) and never sets the line's own box. */
const SKELETON_BAR_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "starci-core-text-skeleton",
})

/** One resolved line of copy with explicit semantics, hierarchy and announcement behavior. */
export const Text = ({
    as: Element = "div",
    id,
    children,
    startContent,
    size = "md",
    tone,
    weight = "normal",
    live = "off",
    overflow,
    mono = false,
    tabular = false,
    isSkeleton = false,
    isSuperseded = false,
    parentEmphasis,
}: TextProps) => {
    const resolvedTone = size === "xs" ? "muted" : tone ?? "default"
    const showsStartContent = startContent != null

    return (
        <Element
            id={id}
            data-tier="atom"
            data-component="Text"
            data-size={size}
            data-tone={resolvedTone}
            data-weight={weight}
            data-start-content={showsStartContent ? "true" : "false"}
            data-superseded={isSuperseded ? "true" : "false"}
            data-parent-emphasis={parentEmphasis}
            data-live={live}
            data-overflow={overflow}
            data-mono={mono ? "true" : undefined}
            data-tabular={tabular ? "true" : undefined}
            data-loading={isSkeleton ? "true" : "false"}
            data-contract={isSkeleton ? getTextSkeletonContract(size) : getTextContract(size, resolvedTone, showsStartContent)}
            aria-live={isSkeleton || live === "off" ? undefined : live}
            aria-atomic={isSkeleton || live === "off" ? undefined : true}
            aria-hidden={isSkeleton || undefined}
            className={TEXT_CLASS_NAME}
        >
            {showsStartContent ? startContent : null}
            {isSkeleton ? <span className={SKELETON_BAR_CLASS_NAME} data-empty={children == null ? "true" : undefined}>{children ?? "\u00a0"}</span> : children}
        </Element>
    )
}
