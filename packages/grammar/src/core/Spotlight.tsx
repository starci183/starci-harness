"use client"

import { useEffect, useState, type AnimationEvent, type ReactNode } from "react"
import { navigationClassName } from "./navigationClassNames.js"

export type SpotlightShape = "rounded" | "pill" | "circle"

export type SpotlightProps = {
    /** The part to point at: a button, a card, an avatar. The ring is drawn around its box. */
    readonly children: ReactNode
    /** While true the target is ringed once; it settles by itself (no ring) and calls `onEnd`. Set it true again to point again. */
    readonly isActive: boolean
    /** Runs once when the ring has settled. Use it to clear the app's own "look here" state. */
    readonly onEnd?: () => void
    /** The ring's corner: `rounded` (default, the control radius), `pill` or `circle`, matching the target. */
    readonly shape?: SpotlightShape
    /** The target fills the row (a card, a field): the frame is a block instead of shrinking to the target's width. */
    readonly isBlock?: boolean
}

/*
 * The look is SHIPPED by `[data-component="Spotlight"]` in `src/common/components-navigation.css`: an accent ring outside the
 * target with a soft accent pulse for the spotlight duration step, then no ring. Under reduced motion the ring is static for the
 * same time. The ring is an outline and a box-shadow, so it takes no layout space.
 */

/**
 * "Look here": rings its target with the accent for about three seconds, then settles and calls `onEnd`. The frame is an
 * inline-block (a block with `isBlock`) hugging the target's box, so the ring follows it; `display: contents` has no box to ring.
 * The frame is not interactive and adds no role or name (the target keeps its own). Exported from `@starci/grammar/common`.
 * Contract: MOTION-2 (reduced motion keeps the ring, drops the pulse).
 */
export const Spotlight = ({ children, isActive, onEnd, shape = "rounded", isBlock = false }: SpotlightProps) => {
    const [settled, setSettled] = useState(false)
    useEffect(() => {
        if (isActive) setSettled(false)
    }, [isActive])
    const isOn = isActive && !settled
    const handleEnd = (event: AnimationEvent<HTMLSpanElement>) => {
        if (event.target !== event.currentTarget || !isOn) return
        setSettled(true)
        onEnd?.()
    }
    return (
        <span
            className={navigationClassName("starci-core-spotlight")}
            data-component="Spotlight"
            data-contract="MOTION-2"
            data-grammar-spotlight={isOn ? "true" : "false"}
            data-grammar-spotlight-shape={shape}
            data-grammar-spotlight-block={isBlock ? "true" : "false"}
            onAnimationEnd={handleEnd}
        >
            {children}
        </span>
    )
}
