"use client"

import type { ReactNode } from "react"
import { Avatar, avatarAccessibleName, type AvatarKind, type AvatarSize } from "../../primitive/Avatar/index.js"
import { PlainPressable } from "../../primitive/PlainPressable/index.js"

export type AvatarButtonProps = {
    /** The person or entity; it names the button. */
    readonly name: string
    readonly src?: string
    /** Stable identity id determines the local DiceBear initials background; otherwise `name` does. */
    readonly seed?: string
    readonly kind?: AvatarKind
    /** Custom uploaded-image loading/error fallback; the default is the same DiceBear initials image. */
    readonly fallback?: ReactNode
    /** `md` is 40px. */
    readonly size?: AvatarSize
    readonly onPress?: () => void
    readonly isDisabled?: boolean
}

/**
 * An avatar that is only a circle and is also a control: no pill or oval button around it, no hover effect, a zoom-out on
 * press and a round focus ring. Pass it as the `trigger` of a DropdownMenu or Popover (the account menu).
 * Contract: A11Y-2 (the button is named once; the avatar inside is decorative).
 */
export const AvatarButton = ({ name, src, seed, kind = "person", fallback, size = "md", onPress, isDisabled }: AvatarButtonProps) => (
    <PlainPressable
        aria-label={avatarAccessibleName(name, kind)}
        shape="circle"
        {...(size === "control" ? { size } : {})}
        {...(onPress === undefined ? {} : { onPress })}
        {...(isDisabled === undefined ? {} : { isDisabled })}
    >
        <Avatar name={name} kind={kind} isDecorative size={size} {...(src === undefined ? {} : { src })} {...(seed === undefined ? {} : { seed })} {...(fallback === undefined ? {} : { fallback })} />
    </PlainPressable>
)
