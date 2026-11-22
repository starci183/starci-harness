"use client"

import { HiddenSkeleton, withRegionInert } from "../../regionScope.js"
import { Button as HeroButton, Link as HeroLink, Spinner as HeroSpinner, Tooltip as HeroTooltip, buttonVariants, skeletonVariants } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { useOverlayContainer } from "../../overlayScope.js"
import { tooltipContentClassName } from "../../tooltipClassName.js"
import { Icon } from "../Icon/index.js"
import { glyphSource, type GlyphName } from "../Icon/glyphs.js"

/**
 * THE THREE LOOKS (owner, 2026-11-22: "chỉ có danger, border, và primary thôi, k có tertiary nữa"). A Button is exactly one of:
 *
 *   - `primary`: solid, the ONE main action of a card or region (the CTA; lint `single-commit-per-render` counts it);
 *   - `border`: an outline, every secondary action (the default; a retry, a cancel, a row action, a head action);
 *   - `danger`: a destructive action (delete, disconnect, stop for good).
 *
 * Grammar maps them onto the vendor (HeroUI v3 `buttonVariants`) internally: primary is `primary`, border is `outline`, danger is `danger`.
 * There is no quiet, ghost, tertiary, secondary or soft-danger look. A text link is a `Link`, never a Button.
 */
export type ButtonVariant = "primary" | "border" | "danger"
export type ButtonSize = "sm" | "md" | "lg"
export type ButtonType = "button" | "submit" | "reset"
export type ButtonWidth = "content" | "fill" | "fill-narrow" | "wrap"
/** The colour a `primary` is filled with when it is not the accent (0.55.0): the action of a toned notice (an Alert's action wears its banner's tone). */
export type ButtonTone = "accent" | "info" | "success" | "warning"

/** The vendor variant each look draws with. */
export const BUTTON_VENDOR_VARIANT = Object.freeze({ primary: "primary", border: "outline", danger: "danger" } as const satisfies Record<ButtonVariant, string>)

/** The look of a Button: `border` by default. `tone` colours a `primary` only; it is not a fourth look. */
export type ButtonLook =
    | {
        readonly variant: "primary"
        /**
         * The colour of the solid fill (0.55.0, owner: "button phải là màu tương ứng, ko phải border"): `--<tone>` inked `--<tone>-foreground` (HeroUI ships
         * no success, warning or info variant, so Grammar paints its primary). Default: the accent. Not with `ground`.
         */
        readonly tone?: ButtonTone
    }
    | {
        /** `border` (default): an outline, any secondary action. `danger`: a destructive action. A computed look takes this branch, untoned. */
        readonly variant?: ButtonVariant
        readonly tone?: never
    }

type ButtonBase = {
    /** The visible action label. It remains present while the action is pending. */
    readonly children: string
    readonly size?: ButtonSize
    /** Explanatory content after the label (a count, a shortcut). Never an arrow: an arrow is `endArrow` (lint `button-arrow`). */
    readonly endContent?: ReactNode
    readonly isDisabled?: boolean
    /**
     * The ground the button stands on when it is not the page's (0.48.0): `accent` a band in the brand colour (a site's burgundy call-to-action band), `inverse` a
     * dark band (`--foreground` as the ground). The looks keep their rank and take that ground's contrast: `primary` is the ground's foreground filled with the
     * ground's colour as ink, `border` and `danger` the ground's foreground as an outline and its ink, so the label never sinks into the band. An app writes no class.
     */
    readonly ground?: "accent" | "inverse"
    /**
     * Why the action is unavailable. A disabled Button carries these words as its accessible description and shows them in a Tooltip on
     * hover and keyboard focus; where no pointer can hover (a touch phone, `(hover: none)` or `(pointer: coarse)`) it draws them as a
     * muted helper line under the button instead (0.43.1), since a tooltip cannot be reached there. It has no effect while the Button is enabled.
     */
    readonly disabledReason?: string
    /**
     * Initial unresolved-content geometry. It is distinct from action-owned pending. Skeleton parity: the loading Button keeps
     * the ready box (control height, label and start/end content laid out as an unseen measured placeholder).
     */
    readonly isLoading?: boolean
    /** Pending belongs to the action that started the work and blocks duplicate presses. */
    readonly isPending?: boolean
    /**
     * How the action takes its inline space: to its own content, or filling its parent.
     *
     * `fill` forwards the vendor's own full-width variant and adds the part the vendor does not
     * own - a label that WRAPS onto a second line instead of overflowing, the box holding its size
     * step (md 40px) on one line and growing only with the wrapped label - from `.starci-core-button[data-width="fill"]` in the packaged
     * stylesheet. An app never has to reach through the boundary with a descendant width utility.
     *
     * `fill-narrow`: content width on a wide screen and `fill` below 30rem (a phone), for a primary submit that is a short
     * button on a desktop form and a full-width thumb target on a phone. The box keeps the size step on one line and grows only
     * with a wrapped label, as `fill` does.
     *
     * `wrap`: content width, capped at the container. A short label is exactly `content`; a label longer than its container (a
     * suggestion pill carrying an agent's sentence) wraps inside the pill, keeping its radius and inline padding, the text at the
     * reading edge, and the box grows from its size step, so it never spills out of its row.
     */
    readonly width?: ButtonWidth
}

/**
 * THE BUTTON-ICON RULE (owner, 2026-11-09). Only the PRIMARY button (`variant="primary"`, the CTA) carries a leading icon: it may show what
 * it does at its start (`startGlyph`, or the app's own `startContent`). Every other Button (`border`, `danger`, a suggestion pill, a row
 * action) is text only, and the types refuse a start icon on it. A Button that LEADS somewhere ends with
 * Grammar's arrow (`endArrow`); the arrow is not an icon under this rule, so any look may use it, but a Button never carries the
 * arrow and a start icon together. `IconButton` (icon only, named by its label) is unaffected.
 * A `sm` Button is text only at every look (owner, 2026-11-09): the types refuse a start icon at `size="sm"`.
 * Both glyphs take the same inline gap (8) and the control's glyph padding on their side.
 */
type ButtonText = {
    readonly startContent?: never
    readonly startGlyph?: never
    /**
     * The label leads somewhere (a page, a tab, a next step): Grammar draws its arrow after the label, and the arrow slides toward the
     * reading end while the button is hovered or focused (still under reduced motion), mirrored right to left. `endContent` wins when
     * both are given. Any look may lead.
     */
    readonly endArrow?: boolean
}

type ButtonPrimaryDoes = {
    readonly variant: "primary"
    /** A leading icon is for the primary at `md` or `lg`: a `sm` Button never carries one, not even the primary. */
    readonly size?: "md" | "lg"
    /** Decorative or explanatory content before the label: what the action does. Product icon identity stays with the app. Primary only. */
    readonly startContent?: ReactNode
    /** A glyph of Grammar's own closed vocabulary at the start (`plus`, `upload`, `send`, `pencil`, ...); `startContent` wins when both are given. Primary only. */
    readonly startGlyph?: GlyphName
    readonly endArrow?: false
}

/** What a Button shows beside its label: nothing or the arrow of where it goes (any look), or, on the primary alone, the glyph of what it does. */
export type ButtonIcons = ButtonText | ButtonPrimaryDoes

/**
 * A real browser destination wearing the button appearance. It renders an anchor, so the platform
 * supplies middle-click, copy-link, and the `link` role. Pending or disabled uses the vendor's
 * unavailable link state and withholds the href.
 */
type DestinationButton = {
    readonly "aria-pressed"?: never
    readonly href: string
    readonly target?: "_blank" | "_self"
    readonly rel?: string
    readonly download?: boolean | string
    /** Runs alongside navigation. It cannot cancel the destination. */
    readonly onFollow?: () => void
    readonly onPress?: never
    readonly type?: never
    readonly form?: never
}

/** A same-document command. It renders the vendor button and may submit or reset a form, its own or the one `form` names. */
type CommandButton = {
    /** Controlled toggle state. Keep the action label unchanged between pressed and unpressed. */
    readonly "aria-pressed"?: boolean
    readonly onPress?: () => void
    readonly type?: ButtonType
    /**
     * The `id` of the form this button submits or resets from outside it: a `Drawer` or `Modal` footer button with
     * `type="submit"` and `form` naming the form in the overlay's body.
     */
    readonly form?: string
    readonly href?: never
    readonly target?: never
    readonly rel?: never
    readonly download?: never
    readonly onFollow?: never
}

/**
 * The button-shaped action. The element is decided by which of `href` or `onPress` is present, and
 * the type forbids both, so a destination cannot be written as a button by choosing the wrong leaf.
 */
export type ButtonProps = ButtonBase & ButtonLook & ButtonIcons & (DestinationButton | CommandButton)

const SIZES = { sm: "sm", md: "md", lg: "lg" } as const
const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "select-none text-transparent",
})

/** Button-shaped action: an anchor for a destination, the vendor button for a command. */
const ButtonInner = (props: ButtonProps) => {
    const reasonId = useId()
    const reason = props.disabledReason
    const explained = props.isDisabled === true && reason !== undefined && reason !== ""
    const control = <ButtonControl {...props} {...(explained ? { reasonId } : {})} />
    if (!explained) return control
    return <DisabledReason reason={reason} reasonId={reasonId}>{control}</DisabledReason>
}

/**
 * The words a disabled Button gives for being unavailable, on hover and keyboard focus. The platform skips a disabled control,
 * so the vendor trigger around it carries the events. A leaf uses the vendor part, never the grammar Tooltip (a branch).
 *
 * The words live in ONE element, the description both the trigger and the control point at, so a screen reader hears them once in
 * either mode. It is hidden from the reading order (`aria-hidden`: a description reference still reads it) and from sight where a
 * pointer can hover; where none can (`(hover: none)`, `(pointer: coarse)`), the packaged stylesheet shows it as the field-description
 * line under the button, since the tooltip never opens there. A media query, not a prop: the input decides, never the app.
 */
const DisabledReason = ({ reason, reasonId, children }: { readonly reason: string; readonly reasonId: string; readonly children: ReactNode }) => {
    const { anchor, container } = useOverlayContainer("Tooltip")
    return (
        <HeroTooltip>
            <HeroTooltip.Trigger
                className="starci-core-tooltip-disabled-trigger"
                data-grammar-tooltip-disabled-trigger="true"
                role="group"
                aria-describedby={reasonId}
            >
                {children}
                <span id={reasonId} className="starci-core-button-reason" data-grammar-button-reason="true" aria-hidden="true">{reason}</span>
            </HeroTooltip.Trigger>
            {anchor}
            {container === null ? null : (
                <HeroTooltip.Content
                    UNSTABLE_portalContainer={container}
                    placement="top"
                    className={tooltipContentClassName}
                    data-grammar-tooltip-content="true"
                >
                    {reason}
                </HeroTooltip.Content>
            )}
        </HeroTooltip>
    )
}

const ButtonControl = (props: ButtonProps & { readonly reasonId?: string }) => (props.isLoading === true ? <HiddenSkeleton><ButtonFace {...props} /></HiddenSkeleton> : <ButtonFace {...props} />)

const ButtonFace = (props: ButtonProps & { readonly reasonId?: string }) => {
    const {
        children,
        size = "md",
        startContent: givenStart,
        startGlyph,
        endContent: givenEnd,
        endArrow = false,
        isDisabled = false,
        isLoading = false,
        isPending = false,
        width = "content",
        reasonId,
    } = props
    const variant: ButtonVariant = props.variant ?? "border"
    const tone = props.ground === undefined && props.variant === "primary" ? props.tone : undefined
    const toneAttr = tone === undefined ? {} : { "data-grammar-button-tone": tone }
    const startContent = givenStart ?? (startGlyph === undefined ? undefined : <Icon source={glyphSource(startGlyph)} usage="leading" />)
    const endContent = givenEnd ?? (endArrow ? <span className="starci-core-button-arrow" data-grammar-button-arrow="true"><Icon source={glyphSource("arrow-end")} usage="leading" /></span> : undefined)
    const unavailable = isDisabled || isPending || isLoading
    // The side a glyph stands on takes the control's glyph padding (one step less): the glyph carries its own room.
    const glyphSides = {
        "data-grammar-button-start": (isPending && !isLoading) || startContent != null ? "glyph" : undefined,
        "data-grammar-button-end": !(isPending && !isLoading) && endContent != null ? "glyph" : undefined,
    }
    const content = (
        <>
            {isPending && !isLoading ? <HeroSpinner size="sm" color="current" aria-hidden="true" /> : startContent}
            <span data-grammar-button-label="true" aria-busy={isPending || undefined}>{children}</span>
            {isPending && !isLoading ? null : endContent}
        </>
    )

    if (props.href !== undefined) {
        const { href, target, rel, download, onFollow } = props
        return (
            <HeroLink
                data-tier="leaf"
                data-component="Button"
                data-grammar-variant={variant}
                {...(props.ground === undefined ? {} : { "data-grammar-button-ground": props.ground })}
                {...toneAttr}
                data-size={size}
                {...glyphSides}
                data-element={unavailable ? "span" : "a"}
                data-loading={isLoading ? "true" : "false"}
                data-action-pending={isPending ? "true" : "false"}
                isDisabled={unavailable}
                {...(reasonId === undefined ? {} : { "aria-describedby": reasonId })}
                aria-busy={isPending || undefined}
                aria-hidden={isLoading || undefined}
                data-width={width}
                data-contract={width === "fill" ? "MEASURE-2" : undefined}
                className={buttonVariants({ variant: BUTTON_VENDOR_VARIANT[variant], size: SIZES[size], fullWidth: width === "fill", className: isLoading ? `starci-core-button ${SKELETON_CLASS_NAME}` : "starci-core-button" })}
                {...(unavailable ? {} : { href })}
                {...(target === undefined ? {} : { target })}
                {...(rel === undefined ? target === "_blank" ? { rel: "noopener noreferrer" } : {} : { rel })}
                {...(download === undefined ? {} : { download })}
                {...(onFollow === undefined || unavailable ? {} : { onClick: onFollow })}
            >
                {content}
            </HeroLink>
        )
    }

    const { onPress, type = "button", form } = props
    return (
        <HeroButton
            data-tier="leaf"
            data-component="Button"
            data-grammar-variant={variant}
            {...(props.ground === undefined ? {} : { "data-grammar-button-ground": props.ground })}
            {...toneAttr}
            data-size={size}
            {...glyphSides}
            data-element="button"
            data-loading={isLoading ? "true" : "false"}
            data-action-pending={isPending ? "true" : "false"}
            type={type}
            {...(form === undefined ? {} : { form })}
            variant={BUTTON_VENDOR_VARIANT[variant]}
            size={SIZES[size]}
            isDisabled={unavailable}
            {...(reasonId === undefined ? {} : { "aria-describedby": reasonId })}
            isPending={isPending}
            data-width={width}
            data-contract={width === "fill" ? "MEASURE-2" : undefined}
            fullWidth={width === "fill"}
            {...(props["aria-pressed"] === undefined ? {} : { "aria-pressed": props["aria-pressed"] })}
            className={isLoading ? `starci-core-button ${SKELETON_CLASS_NAME}` : "starci-core-button"}
            {...(unavailable || onPress === undefined ? {} : { onPress })}
        >
            {content}
        </HeroButton>
    )
}

/** Button-shaped action: an anchor for a destination, the vendor button for a command. */
export const Button = withRegionInert(ButtonInner)
