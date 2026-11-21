import { skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"

export type TextAs = "div" | "p" | "span"
export type TextTone = "default" | "muted"
/** `figure` is the leading value of a region (FONT-5): a price, a total, a count read first, in tabular figures. */
export type TextSize = "xs" | "sm" | "md" | "figure"
/**
 * The type roles (0.54.0, owner 2026-11-21): ten roles, each one size, line height and weight from `ramps.css`
 * (`--grammar-type-<role>-size|line|weight`, dots as dashes). `label.field`, `label.group` and `caption` are muted;
 * `badge` takes its tone from the badge around it; `code` is set in the mono stack.
 */
export type TextRole =
    | "figure"
    | "title.page"
    | "title.section"
    | "label.item"
    | "body"
    | "label.field"
    | "label.group"
    | "caption"
    | "badge"
    | "code"
export type TextLive = "off" | "polite" | "assertive"
export type TextOverflow = "wrap" | "truncate" | "clamp-2"

export type TextProps = {
    /** Select the semantic line owner without exposing styling hooks. */
    readonly as?: TextAs
    readonly id?: string
    readonly children?: ReactNode
    /** App-owned glyph or other inline meaning placed before the copy. */
    readonly startContent?: ReactNode
    /** The type role of the line: its size, line height, weight and (for the muted roles) its tone. Wins over `size`. */
    readonly role?: TextRole
    /** @deprecated Use `role`: `xs` is `caption`, `md` and `sm` are `body`, `figure` is `figure`. `size` keeps working. */
    readonly size?: TextSize
    readonly tone?: TextTone
    /** One stronger weight for a value or a term inside a line (never a title: a title comes from the frame that owns it). */
    readonly isStrong?: boolean
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
    readonly isLoading?: boolean
    readonly isSuperseded?: boolean
}

/**
 * Copy geometry and paint are SHIPPED.
 *
 * `.starci-core-text` in `src/common/styles.css` reads the `data-size`, `data-tone`, `data-strong`,
 * `data-start-content`, `data-superseded` and `data-loading` attributes this
 * element already emits, so a consumer gets the scale without scanning this package with Tailwind.
 */
const TEXT_CLASS_NAME = "starci-core-text"

/** Every type role, in the owner's order. */
export const TEXT_ROLES: readonly TextRole[] = Object.freeze([
    "figure",
    "title.page",
    "title.section",
    "label.item",
    "body",
    "label.field",
    "label.group",
    "caption",
    "badge",
    "code",
])

/** The public class of a role, dots as dashes (`label.item` is `starci-type-label-item`): an app moves a raw size utility onto it. */
export const typeRoleClassName = (role: TextRole): string => `starci-type-${role.replace(".", "-")}`

/** The roles drawn in the muted tone. */
const MUTED_ROLES: ReadonlySet<TextRole> = new Set(["label.field", "label.group", "caption"])

/** The font rank a role claims (font.md `## Scale`). */
const FONT_RULE_BY_ROLE: Record<TextRole, string> = {
    figure: "FONT-5",
    "title.page": "FONT-4",
    "title.section": "FONT-3",
    "label.item": "FONT-3",
    body: "FONT-3",
    "label.field": "FONT-2",
    "label.group": "FONT-1",
    caption: "FONT-1",
    badge: "FONT-1",
    code: "FONT-1",
}

const FONT_RULE_BY_SIZE: Record<TextSize, string> = {
    xs: "FONT-1",
    sm: "FONT-2",
    md: "FONT-3",
    figure: "FONT-5",
}

const TONE_RULE_BY_RESOLVED_TONE: Record<TextTone, string> = {
    default: "TONE-1",
    muted: "TONE-2",
}

/**
 * Rule ids this element can claim from its resolved size and tone.
 * `role` (or the deprecated `size`) selects the exact scale row in font.md `## Scale` (FONT-1 to 5); the
 * resolved tone (forced `muted` at `size="xs"` and for the muted roles) selects the exact row in
 * tone.md `## Scale` (TONE-1/2/3). the 0.5rem inline gap fires only while `startContent`
 * is shown, matching the `Text` with `startContent` row in gap.md's
 * "Gaps Common already owns" table (GAP-2). The strong weight carries no rule
 * id here and stays unclaimed.
 */
const getTextContract = (font: string, resolvedTone: TextTone, showsStartContent: boolean) => {
    const ids = [font, TONE_RULE_BY_RESOLVED_TONE[resolvedTone]]
    if (showsStartContent) ids.push("GAP-2")
    return ids.join(" ")
}

/**
 * The skeleton keeps the size geometry (its FONT id alone) but its copy is
 * transparent, so no tone is actually visible to claim.
 *
 * Skeleton parity: a loading Text is the same element with the same `as`, size, overflow and start content, so its box is
 * the ready line's box. Its copy (when passed) stays laid out as a measured placeholder inside a shimmer bar and is not
 * painted; with no copy the bar takes the size's default width. The start content keeps its place, unpainted.
 */

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
    role,
    size = "md",
    tone,
    isStrong = false,
    live = "off",
    overflow,
    mono = false,
    tabular = false,
    isLoading = false,
    isSuperseded = false,
}: TextProps) => {
    const resolvedTone = role === undefined ? (size === "xs" ? "muted" : tone ?? "default") : MUTED_ROLES.has(role) ? "muted" : tone ?? "default"
    const showsStartContent = startContent != null
    const font = role === undefined ? FONT_RULE_BY_SIZE[size] : FONT_RULE_BY_ROLE[role]

    return (
        <Element
            id={id}
            data-tier="leaf"
            data-component="Text"
            data-size={role === undefined ? size : undefined}
            data-role={role}
            data-tone={resolvedTone}
            data-strong={isStrong ? "true" : undefined}
            data-start-content={showsStartContent ? "true" : "false"}
            data-superseded={isSuperseded ? "true" : "false"}
            data-live={live}
            data-overflow={overflow}
            data-mono={mono ? "true" : undefined}
            data-tabular={tabular ? "true" : undefined}
            data-loading={isLoading ? "true" : "false"}
            data-contract={isLoading ? font : getTextContract(font, resolvedTone, showsStartContent)}
            aria-live={isLoading || live === "off" ? undefined : live}
            aria-atomic={isLoading || live === "off" ? undefined : true}
            aria-hidden={isLoading || undefined}
            className={role === undefined ? TEXT_CLASS_NAME : `${TEXT_CLASS_NAME} ${typeRoleClassName(role)}`}
        >
            {showsStartContent ? startContent : null}
            {isLoading ? <span className={SKELETON_BAR_CLASS_NAME} data-empty={children == null ? "true" : undefined}>{children ?? "\u00a0"}</span> : children}
        </Element>
    )
}
