"use client"

import { Button as HeroButton, Link as HeroLink, buttonVariants, cn, skeletonVariants } from "@heroui/react"
import { Icon, type IconSource } from "../Icon/index.js"
import { useButtonIntentVariant, type ButtonIntentProps } from "../../buttonIntent.js"
import type { ButtonVariant } from "../Button/index.js"

/**
 * HeroUI Button variants an icon-only action wears: `tertiary` (default) is the filled round plate;
 * `ghost` is the quiet bare glyph with no fill at rest (HeroUI's ghost: a fill only on hover/press) -
 * for an overflow "..." menu or a secondary glyph action beside a card title. `primary` is the accent-filled plate for the
 * one glyph action that must stand out (a floating assistant or compose button); one per view, like a primary Button.
 * `danger-soft` is the danger tone's soft tint plate (`--danger-soft` ground, `--danger-soft-foreground` glyph, one step
 * stronger on hover): use it for a reversible or row-level destructive action, such as a trash glyph that deletes a row.
 * A confirmed destructive action inside an AlertDialog uses the solid `danger` Button instead.
 */
export type IconButtonVariant = ButtonVariant

export type IconButtonProps = {
    readonly source: IconSource
    /** Required accessible name for the glyph-only action. */
    readonly label: string
    /** Grammar internals and stories may select paint directly; applications declare intent. */
    readonly variant?: IconButtonVariant
    /** `md` and `control` are the one control height (2.5rem, 40px: the default), `sm` (2rem) is for a control nested in an item or a dense toolbar, `lg` (3rem) is the landing hero step. */
    readonly size?: "sm" | "md" | "lg" | "control"
    /** Lifts the button with the overlay elevation, for an action floating over content (it owns no position). */
    readonly isFloating?: boolean
    readonly isActive?: boolean
    readonly isDisabled?: boolean
    readonly isSkeleton?: boolean
    readonly onPress?: () => void
    /** A real destination: renders an anchor wearing the icon-button appearance (R7: it takes the intent of the command it stands for). */
    readonly href?: string
    /** Disclosure: the id of the region this button shows and hides (`aria-controls`). */
    readonly "aria-controls"?: string
    /** Disclosure: whether that region is open now (`aria-expanded`). */
    readonly "aria-expanded"?: boolean
    /** Largest number shown before it collapses to `n+`. Default 99. */
    readonly badgeMax?: number
} & ButtonIntentProps & (
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
export const IconButton = ({
    source,
    label,
    intent,
    step,
    variant: legacyVariant = "tertiary",
    size = "md",
    isFloating = false,
    isActive = false,
    isDisabled = false,
    isSkeleton = false,
    onPress,
    href,
    "aria-controls": controls,
    "aria-expanded": expanded,
    badge,
    badgeLabel,
    badgeMax = 99,
}: IconButtonProps) => {
    const variant = useButtonIntentVariant(intent, step, "iconButton") ?? legacyVariant
    const badgeText = isSkeleton ? null : iconButtonBadgeText(badge, badgeMax)
    if (href !== undefined) {
        const unavailable = isDisabled || isSkeleton
        return (
            <HeroLink
                data-tier="atom"
                data-component="IconButton"
                data-contract="A11Y-2"
                data-active={isActive ? "true" : "false"}
                data-variant={variant}
                data-size={size}
                data-grammar-control-size={size === "control" ? "control" : undefined}
                data-floating={isFloating ? "true" : "false"}
                data-loading={isSkeleton ? "true" : "false"}
                data-element={unavailable ? "span" : "a"}
                data-grammar-icon-button-badge={badgeText === null ? "none" : "present"}
                isDisabled={unavailable}
                aria-label={badgeText !== null && badgeLabel !== undefined ? `${label}, ${badgeLabel}` : label}
                className={buttonVariants({ variant, isIconOnly: true, className: cn("starci-core-icon-button", isSkeleton ? SKELETON_CLASS_NAME : undefined) })}
                {...(unavailable ? {} : { href })}
            >
                {isSkeleton ? null : <Icon source={source} usage="leading" />}
                {badgeText === null ? null : <span aria-hidden className="starci-core-icon-button-badge" data-contract="TONE-2">{badgeText}</span>}
            </HeroLink>
        )
    }
    return (
    <HeroButton
        data-tier="atom"
        data-component="IconButton"
        data-contract="A11Y-2"
        data-active={isActive ? "true" : "false"}
        data-variant={variant}
        data-size={size}
        data-grammar-control-size={size === "control" ? "control" : undefined}
        data-floating={isFloating ? "true" : "false"}
        data-loading={isSkeleton ? "true" : "false"}
        type="button"
        variant={variant}
        className={cn("starci-core-icon-button", isSkeleton ? SKELETON_CLASS_NAME : undefined) ?? "starci-core-icon-button"}
        isIconOnly
        isDisabled={isDisabled || isSkeleton}
        aria-label={badgeText !== null && badgeLabel !== undefined ? `${label}, ${badgeLabel}` : label}
        data-grammar-icon-button-badge={badgeText === null ? "none" : "present"}
        {...(controls === undefined ? {} : { "aria-controls": controls })}
        {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
        {...(isDisabled || isSkeleton || onPress === undefined ? {} : { onPress })}
    >
        {isSkeleton ? null : <Icon source={source} usage="leading" />}
        {badgeText === null ? null : <span aria-hidden className="starci-core-icon-button-badge" data-contract="TONE-2">{badgeText}</span>}
    </HeroButton>
    )
}
