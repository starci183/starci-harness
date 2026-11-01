"use client"

import { Button as HeroButton, Link as HeroLink, Spinner as HeroSpinner, Tooltip as HeroTooltip, buttonVariants, skeletonVariants } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { useButtonIntentVariant, type ButtonIntentProps } from "../../buttonIntent.js"
import { useOverlayContainer } from "../../overlayScope.js"
import { tooltipContentClassName } from "../../tooltipClassName.js"

/**
 * The vendor's own Button variants, one to one (HeroUI v3 `buttonVariants`: primary, secondary, tertiary,
 * outline, ghost, danger, danger-soft). `danger` / `danger-soft` are a destructive or failure-recovery action
 * (HeroUI's danger Alert carries a `danger` Button "Retry"); they paint the vendor `--danger` tokens.
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger" | "danger-soft"
export type ButtonSize = "sm" | "md" | "lg"
export type ButtonType = "button" | "submit" | "reset"
export type ButtonWidth = "content" | "fill"

type ButtonBase = {
    /** The visible action label. It remains present while the action is pending. */
    readonly children: string
    readonly size?: ButtonSize
    /** Decorative or explanatory content before the label. Product icon identity stays with the app. */
    readonly startContent?: ReactNode
    /** Directional or explanatory content after the label. */
    readonly endContent?: ReactNode
    readonly isDisabled?: boolean
    /**
     * Why the action is unavailable. A disabled Button shows these words in a Tooltip on hover and keyboard focus
     * and carries them as its accessible description. It has no effect while the Button is enabled.
     */
    readonly disabledReason?: string
    /**
     * Initial unresolved-content geometry. It is distinct from action-owned pending. Skeleton parity: the loading Button keeps
     * the ready box (control height, label and start/end content laid out as an unseen measured placeholder).
     */
    readonly isSkeleton?: boolean
    /** Pending belongs to the action that started the work and blocks duplicate presses. */
    readonly isPending?: boolean
    /**
     * How the action takes its inline space: to its own content, or filling its parent.
     *
     * `fill` forwards the vendor's own full-width variant and adds the part the vendor does not
     * own - a label that WRAPS onto a second line instead of overflowing, the box holding its size
     * step (md 40px) on one line and growing only with the wrapped label - from `.starci-core-button[data-width="fill"]` in the packaged
     * stylesheet. An app never has to reach through the boundary with a descendant width utility.
     */
    readonly width?: ButtonWidth
}

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
export type ButtonProps = ButtonBase & ButtonIntentProps & (DestinationButton | CommandButton)

const VARIANTS = {
    primary: "primary",
    secondary: "secondary",
    tertiary: "tertiary",
    outline: "outline",
    ghost: "ghost",
    danger: "danger",
    "danger-soft": "danger-soft",
} as const

const SIZES = { sm: "sm", md: "md", lg: "lg" } as const
const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base({
    className: "select-none text-transparent",
})

/** Button-shaped action: an anchor for a destination, the vendor button for a command. */
export const Button = (props: ButtonProps) => {
    const reasonId = useId()
    const reason = props.disabledReason
    const explained = props.isDisabled === true && reason !== undefined && reason !== ""
    const control = <ButtonControl {...props} {...(explained ? { reasonId } : {})} />
    if (!explained) return control
    return (
        <>
            <span id={reasonId} hidden>{reason}</span>
            <DisabledReason reason={reason} reasonId={reasonId}>{control}</DisabledReason>
        </>
    )
}

/**
 * The words a disabled Button gives for being unavailable, on hover and keyboard focus. The platform skips a disabled control,
 * so the vendor trigger around it carries the events. A leaf uses the vendor part, never the grammar Tooltip (a branch).
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

const ButtonControl = (props: ButtonProps & { readonly reasonId?: string }) => {
    const {
        children,
        size = "md",
        startContent,
        endContent,
        isDisabled = false,
        isSkeleton = false,
        isPending = false,
        width = "content",
        reasonId,
    } = props
    const variant = useButtonIntentVariant(props.intent, props.step, "button") ?? "secondary"
    const unavailable = isDisabled || isPending || isSkeleton
    // The side a glyph stands on takes the control's glyph padding (one step less): the glyph carries its own room.
    const glyphSides = {
        "data-grammar-button-start": (isPending && !isSkeleton) || startContent != null ? "glyph" : undefined,
        "data-grammar-button-end": !(isPending && !isSkeleton) && endContent != null ? "glyph" : undefined,
    }
    const content = (
        <>
            {isPending && !isSkeleton ? <HeroSpinner size="sm" color="current" aria-hidden="true" /> : startContent}
            <span aria-busy={isPending || undefined}>{children}</span>
            {isPending && !isSkeleton ? null : endContent}
        </>
    )

    if (props.href !== undefined) {
        const { href, target, rel, download, onFollow } = props
        return (
            <HeroLink
                data-tier="leaf"
                data-component="Button"
                data-size={size}
                {...glyphSides}
                data-element={unavailable ? "span" : "a"}
                data-loading={isSkeleton ? "true" : "false"}
                data-action-pending={isPending ? "true" : "false"}
                isDisabled={unavailable}
                {...(reasonId === undefined ? {} : { "aria-describedby": reasonId })}
                aria-busy={isPending || undefined}
                aria-hidden={isSkeleton || undefined}
                data-width={width}
                data-contract={width === "fill" ? "MEASURE-2" : undefined}
                className={buttonVariants({ variant: VARIANTS[variant], size: SIZES[size], fullWidth: width === "fill", className: isSkeleton ? `starci-core-button ${SKELETON_CLASS_NAME}` : "starci-core-button" })}
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
            data-size={size}
            {...glyphSides}
            data-element="button"
            data-loading={isSkeleton ? "true" : "false"}
            data-action-pending={isPending ? "true" : "false"}
            type={type}
            {...(form === undefined ? {} : { form })}
            variant={VARIANTS[variant]}
            size={SIZES[size]}
            isDisabled={unavailable}
            {...(reasonId === undefined ? {} : { "aria-describedby": reasonId })}
            isPending={isPending}
            data-width={width}
            data-contract={width === "fill" ? "MEASURE-2" : undefined}
            fullWidth={width === "fill"}
            {...(props["aria-pressed"] === undefined ? {} : { "aria-pressed": props["aria-pressed"] })}
            className={isSkeleton ? `starci-core-button ${SKELETON_CLASS_NAME}` : "starci-core-button"}
            {...(unavailable || onPress === undefined ? {} : { onPress })}
        >
            {content}
        </HeroButton>
    )
}
