"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { useId, type ReactNode } from "react"
import { Avatar, avatarAccessibleName, type AvatarKind, type AvatarProps, type AvatarSize } from "../Avatar/index.js"
import { PlainPressable } from "../../PlainPressable.js"
import { navigationClassName } from "../../navigationClassNames.js"
import { StatusDotMark, type StatusDotTone } from "../StatusDot/index.js"
import type { NoChildren } from "../../tier.js"

/** The Avatar sizes (`md` 40px, the bar's control height; `sm` 24px), and `floating`, the 56px launcher that floats over a page (the assistant), a launcher, not a mark. */
export type AvatarButtonSize = AvatarSize | "floating"

/** The status drawn as a dot badge at the avatar's top end corner; `label` is the status in words, read as the button's description. */
export type AvatarButtonStatus = {
    readonly tone: StatusDotTone
    readonly label: string
}

export type AvatarButtonProps = NoChildren & {
    /** The person or entity; it names the button. */
    readonly name: string
    readonly src?: string
    /** Stable identity id determines the local DiceBear initials background; otherwise `name` does. */
    readonly seed?: string
    readonly kind?: AvatarKind
    /** Custom uploaded-image loading/error fallback; the default is the same DiceBear initials image. */
    readonly fallback?: ReactNode
    /** The plate of the initials (0.46.0, forwarded to the `Avatar`): `default`, `accent`, `solid`, `strong`. */
    readonly tone?: AvatarProps["tone"]
    /** `md` (default) is 40px, the bar's control height; `sm` 24px; `floating` is 56px with an elevated shadow, for a launcher that floats over the page. */
    readonly size?: AvatarButtonSize
    /** A StatusDot badge at the top end corner (mirrored in RTL) on a surface ring; its `label` describes the button. Only with `size="floating"`. */
    readonly status?: AvatarButtonStatus
    readonly onPress?: () => void
    readonly isDisabled?: boolean
}

/**
 * An avatar that is only a circle and is also a control: no pill or oval button around it, no hover effect, a zoom-out on
 * press and a round focus ring. Pass it as the `trigger` of a DropdownMenu or Popover (the account menu).
 * Contract: A11Y-2 (the button is named once; the avatar inside is decorative).
 */
const AvatarButtonInner = ({ name, src, seed, kind = "person", fallback, tone, size = "md", status, onPress, isDisabled }: AvatarButtonProps) => {
    const statusId = useId()
    const isFloating = size === "floating"
    const avatarSize: AvatarSize = isFloating ? "md" : size
    const hasStatus = isFloating && status !== undefined
    const button = (
        <PlainPressable
            aria-label={avatarAccessibleName(name, kind)}
            shape="circle"
            {...(size === "md" ? { size: "control" as const } : {})}
            {...(hasStatus ? { "aria-describedby": statusId } : {})}
            {...(onPress === undefined ? {} : { onPress })}
            {...(isDisabled === undefined ? {} : { isDisabled })}
        >
            <Avatar name={name} kind={kind} isDecorative size={avatarSize} {...(src === undefined ? {} : { src })} {...(seed === undefined ? {} : { seed })} {...(fallback === undefined ? {} : { fallback })} {...(tone === undefined ? {} : { tone })} />
        </PlainPressable>
    )
    if (!isFloating) return button
    return (
        <span className="starci-core-avatar-button-floating" data-grammar-avatar-button-size="floating">
            {button}
            {hasStatus ? (
                <span className="starci-core-avatar-button-status" data-slot="avatar-button-status">
                    <StatusDotMark tone={status.tone} />
                    <span id={statusId} className={navigationClassName("starci-core-nav-visually-hidden")}>{status.label}</span>
                </span>
            ) : null}
        </span>
    )
}

/**
 * An avatar that is only a circle and is also a control: no pill or oval button around it, no hover effect, a zoom-out on
 * press and a round focus ring. Pass it as the `trigger` of a DropdownMenu or Popover (the account menu).
 * Contract: A11Y-2 (the button is named once; the avatar inside is decorative).
 */
export const AvatarButton = withRegionGeometry(AvatarButtonInner, "circle")
