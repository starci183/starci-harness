"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { prefersReducedMotion, supportsViewTimeline } from "../../motion.js"

/** `rise`: the wrapped region fades up as one piece. `stagger`: each direct child fades up in turn, the next a beat after the one before. */
export type RevealKind = "rise" | "stagger"

export type RevealProps = {
    /** The section or the grid that rises when it enters the viewport. With `kind="stagger"` its direct children are the pieces that follow one another. */
    readonly children: ReactNode
    /** Default `rise`. */
    readonly kind?: RevealKind
}

type RevealState = "idle" | "pending" | "in"

/**
 * Fades a region up as it scrolls into view (0.47.3). Where the browser has scroll-driven animations (`animation-timeline: view()`) the stylesheet does
 * it alone, with no script. Elsewhere a small observer marks the region `pending` only when it starts below the fold, and `in` as it arrives. The content is
 * visible by default: the server render and the first client render draw it in place, so a page whose script never runs shows everything. Under
 * reduced motion nothing slides and nothing is hidden.
 */
export const Reveal = ({ children, kind = "rise" }: RevealProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const [state, setState] = useState<RevealState>("idle")
    useEffect(() => {
        const node = ref.current
        if (node === null || supportsViewTimeline() || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return undefined
        // Already on screen, or scrolled past: it stays as drawn; only a region still below the fold waits to rise.
        if (node.getBoundingClientRect().top < window.innerHeight) return undefined
        setState("pending")
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setState("in")
                observer.disconnect()
            }
        }, { rootMargin: "0px 0px -10% 0px" })
        observer.observe(node)
        return () => {
            observer.disconnect()
        }
    }, [])
    return (
        <div
            ref={ref}
            data-tier="frame"
            data-component="Reveal"
            data-contract="MOTION-2 MOTION-3"
            className="starci-core-reveal"
            data-grammar-reveal-kind={kind}
            data-grammar-reveal-state={state}
        >
            {children}
        </div>
    )
}
