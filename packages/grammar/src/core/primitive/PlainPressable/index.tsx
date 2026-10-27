"use client"

import { Button as HeroButton } from "@heroui/react"
import type { ReactNode } from "react"
import { navigationClassName } from "../../navigationClassNames.js"

export type PlainPressableShape = "rounded" | "circle"

export type PlainPressableProps = {
    /** The visible content: a mark, an avatar, a lockup. It is the whole pressable; nothing is drawn around it. */
    readonly children: ReactNode
    /** The accessible name. Needed when the content carries no text of its own (an avatar, a logo). */
    readonly "aria-label"?: string
    /** Runs on a press: pointer, Enter or Space. */
    readonly onPress?: () => void
    readonly isDisabled?: boolean
    /** The shape of the keyboard focus ring: `circle` for a round mark, `rounded` (default) for a lockup. */
    readonly shape?: PlainPressableShape
    /** Aligns the bare pressable with the navbar's shared control height. */
    readonly size?: "control"
    readonly className?: string
}

/*
 * The look is SHIPPED by `[data-component="PlainPressable"]` in `src/common/styles.css`: no padding, background, border or button shape in
 * any state, no hover effect, a zoom-out on press only (removed under reduced motion), and a focus ring. It is a vendor
 * React Aria button, so it also works as the trigger of a DropdownMenu or Popover (aria-haspopup / aria-expanded come with it).
 */

/**
 * A pressable that does not look like a button: the content itself is the control. Use it for a brand or
 * workspace lockup, or an avatar, that opens a menu or goes somewhere. Name it with `aria-label` when the content has no text.
 * Contract: A11Y-2 (a named control), FOCUS-1 (a visible ring), MOTION-2 (reduced motion removes the zoom, never the control).
 */
export const PlainPressable = ({ children, "aria-label": ariaLabel, onPress, isDisabled = false, shape = "rounded", size, className }: PlainPressableProps) => (
    <HeroButton
        data-tier="atom"
        data-component="PlainPressable"
        data-contract="A11Y-2 FOCUS-1 MOTION-2"
        data-grammar-pressable-shape={shape}
        data-grammar-control-size={size}
        className={navigationClassName("starci-core-plain-pressable", className)}
        type="button"
        isDisabled={isDisabled}
        {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
        {...(onPress === undefined ? {} : { onPress })}
    >
        {children}
    </HeroButton>
)
