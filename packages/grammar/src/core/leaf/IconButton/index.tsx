"use client"

import { HiddenSkeleton, withRegionInert } from "../../regionScope.js"
import { Button as HeroButton, Link as HeroLink, Spinner as HeroSpinner, buttonVariants, cn, skeletonVariants } from "@heroui/react"
import { Icon, type IconSource } from "../Icon/index.js"
import { glyphSource, type GlyphName } from "../Icon/glyphs.js"
import { BUTTON_VENDOR_VARIANT, type ButtonVariant } from "../Button/index.js"
import { DismissGlyph } from "./dismissGlyph.js"
import type { NoChildren } from "../../tier.js"

/**
 * The plate an icon-only action wears is one of the Button's three looks (owner, 2026-11-22), from `variant`, never from where it sits:
 * `border` (the default) the outline plate, for every icon action (a close, an overflow "...", a glyph action beside a card title, a toolbar);
 * `primary` the solid accent plate (one per view); `danger` the destructive one. With neither `source` nor `glyph` it draws the close glyph.
 */
type IconButtonGlyph =
    | {
        /** The close glyph is drawn by the grammar when no other is given. */
        readonly source?: IconSource
        readonly glyph?: never
    }
    | {
        /** A glyph of Grammar's own closed vocabulary (`more`, `send`, `panel-end`, `pencil`, `close`), for an app with no icon registry. */
        readonly glyph: GlyphName
        readonly source?: never
    }

export type IconButtonProps = NoChildren & {
    /** Required accessible name for the glyph-only action. */
    readonly label: string
    /** The look: `border` (default), `primary` or `danger`, as on `Button`. */
    readonly variant?: ButtonVariant
    /** `md` is the one control height (2.5rem, 40px: the default), `sm` (2rem) is for a control nested in an item or a dense toolbar, `lg` (3rem) is the landing hero step. */
    readonly size?: "sm" | "md" | "lg"
    /** Lifts the button with the overlay elevation, for an action floating over content (it owns no position). */
    readonly isFloating?: boolean
    readonly isActive?: boolean
    readonly isDisabled?: boolean
    readonly isLoading?: boolean
    /** The initiating action keeps its name and box while duplicate presses are blocked. */
    readonly isPending?: boolean
    readonly onPress?: () => void
    /** A real destination: renders an anchor wearing the icon-button appearance (R7: it takes the look of the command it stands for). */
    readonly href?: string
    /** Disclosure: the id of the region this button shows and hides (`aria-controls`). */
    readonly "aria-controls"?: string
    /** Disclosure: whether that region is open now (`aria-expanded`). */
    readonly "aria-expanded"?: boolean
    /** Largest number shown before it collapses to `n+`. Default 99. */
    readonly badgeMax?: number
} & IconButtonGlyph & (
    | {
        /**
         * A decorative count at the glyph's top end. `0` and empty draw nothing;
         * a number above `badgeMax` shows as `badgeMax+`. `badgeLabel` supplies the accessible count.
         */
        readonly badge: number | string
        /** Appended to the accessible name when a badge shows, e.g. "3 unread". */
        readonly badgeLabel: string
    }
    | { readonly badge?: never; readonly badgeLabel?: never }
)

/** What the badge plate prints: nothing for 0 / empty, the capped number, or the given text. */
export const iconButtonBadgeText = (badge: number | string | undefined, max = 99): string | null => {
    if (badge === undefined || badge === "" || badge === 0) return null
    if (typeof badge === "number") return badge > max ? `${max}+` : String(badge)
    return badge
}

/**
 * The pill corner is SHIPPED by `.starci-core-icon-button` in `src/common/styles.css`, for the
 * resolved action and its resting shimmer alike; only the shimmer itself comes from the vendor.
 */
const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base()

/** Circular glyph-only action with a mandatory accessible name (A11Y-2). */
const IconButtonInner = (props: IconButtonProps) => (props.isLoading === true ? <HiddenSkeleton><IconButtonFace {...props} /></HiddenSkeleton> : <IconButtonFace {...props} />)

const IconButtonFace = ({
    source: givenSource,
    glyph: givenGlyph,
    label,
    variant: look = "border",
    size = "md",
    isFloating = false,
    isActive = false,
    isDisabled = false,
    isLoading = false,
    isPending = false,
    onPress,
    href,
    "aria-controls": controls,
    "aria-expanded": expanded,
    badge,
    badgeLabel,
    badgeMax = 99,
}: IconButtonProps) => {
    const variant = BUTTON_VENDOR_VARIANT[look]
    const source = givenSource ?? (givenGlyph === undefined ? DismissGlyph : glyphSource(givenGlyph))
    const badgeText = isLoading ? null : iconButtonBadgeText(badge, badgeMax)
    const unavailable = isDisabled || isPending || isLoading
    const glyph = isLoading ? null : isPending ? <HeroSpinner size="sm" color="current" aria-hidden="true" /> : <Icon source={source} usage="leading" />
    if (href !== undefined) {
        return (
            <HeroLink
                data-tier="leaf"
                data-component="IconButton"
                data-contract="A11Y-2"
                data-active={isActive ? "true" : "false"}
                data-variant={look}
                data-size={size}
                data-floating={isFloating ? "true" : "false"}
                data-loading={isLoading ? "true" : "false"}
                data-action-pending={isPending ? "true" : "false"}
                aria-busy={isPending || undefined}
                aria-hidden={isLoading || undefined}
                data-element={unavailable ? "span" : "a"}
                data-grammar-icon-button-badge={badgeText === null ? "none" : "present"}
                isDisabled={unavailable}
                aria-label={badgeText !== null && badgeLabel !== undefined ? `${label}, ${badgeLabel}` : label}
                className={buttonVariants({ variant, size, isIconOnly: true, className: cn("starci-core-icon-button", isLoading ? SKELETON_CLASS_NAME : undefined) })}
                {...(unavailable ? {} : { href })}
            >
                {glyph}
                {badgeText === null ? null : <span aria-hidden className="starci-core-icon-button-badge" data-contract="TONE-2">{badgeText}</span>}
            </HeroLink>
        )
    }
    return (
    <HeroButton
        data-tier="leaf"
        data-component="IconButton"
        data-contract="A11Y-2"
        data-active={isActive ? "true" : "false"}
        data-variant={look}
        data-size={size}
        data-floating={isFloating ? "true" : "false"}
        data-loading={isLoading ? "true" : "false"}
        data-action-pending={isPending ? "true" : "false"}
        aria-busy={isPending || undefined}
        aria-hidden={isLoading || undefined}
        type="button"
        variant={variant}
        size={size}
        className={cn("starci-core-icon-button", isLoading ? SKELETON_CLASS_NAME : undefined) ?? "starci-core-icon-button"}
        isIconOnly
        isDisabled={unavailable}
        aria-label={badgeText !== null && badgeLabel !== undefined ? `${label}, ${badgeLabel}` : label}
        data-grammar-icon-button-badge={badgeText === null ? "none" : "present"}
        {...(controls === undefined ? {} : { "aria-controls": controls })}
        {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
        {...(unavailable || onPress === undefined ? {} : { onPress })}
    >
        {glyph}
        {badgeText === null ? null : <span aria-hidden className="starci-core-icon-button-badge" data-contract="TONE-2">{badgeText}</span>}
    </HeroButton>
    )
}

/** Circular glyph-only action with a mandatory accessible name (A11Y-2). */
export const IconButton = withRegionInert(IconButtonInner)
