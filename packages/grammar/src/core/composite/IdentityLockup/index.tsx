"use client"

import { Avatar, type AvatarShape } from "../../primitive/Avatar/index.js"
import { PlainPressable } from "../../primitive/PlainPressable/index.js"

export type IdentityLockupProps = {
    /** The workspace or brand name: the first line, and the mark's initials when there is no image. */
    readonly title: string
    /** The muted second line, e.g. the viewer's role. */
    readonly subtitle?: string
    /** Uploaded logo; without it or while it loads or fails, the mark uses local DiceBear initials. */
    readonly logoSrc?: string
    /** `square` (default): a transparent box with no corner, the image contained so round, square and wide logos keep their own shape. `rounded` is an explicit opt-in. */
    readonly markShape?: Extract<AvatarShape, "square" | "rounded">
    /** Gives the existing PlainPressable the navbar's shared control height. */
    readonly size?: "control"
    readonly onPress?: () => void
    readonly isDisabled?: boolean
}

/**
 * An uploaded logo (transparent and contained by default) or local DiceBear initials beside a title and a muted subtitle, drawn with no caret and no button chrome. The whole lockup is a
 * PlainPressable, so it can trigger a menu or popover (the workspace switcher of a top bar). The name is the visible text.
 * Contract: A11Y-2 (the mark is decorative; the lines name the control).
 */
export const IdentityLockup = ({ title, subtitle, logoSrc, markShape = "square", size, onPress, isDisabled }: IdentityLockupProps) => (
    <PlainPressable
        {...(size === undefined ? {} : { size })}
        {...(onPress === undefined ? {} : { onPress })}
        {...(isDisabled === undefined ? {} : { isDisabled })}
    >
        <span className="starci-core-identity-lockup" data-tier="composite" data-component="IdentityLockup" data-contract="A11Y-2">
            <Avatar name={title} isDecorative shape={markShape} size="md" {...(logoSrc === undefined ? {} : { src: logoSrc })} />
            <span className="starci-core-identity-lockup-copy">
                <span className="starci-core-identity-lockup-title" data-grammar-lockup-line="title">{title}</span>
                {subtitle === undefined ? null : <span className="starci-core-identity-lockup-subtitle" data-grammar-lockup-line="subtitle">{subtitle}</span>}
            </span>
        </span>
    </PlainPressable>
)
