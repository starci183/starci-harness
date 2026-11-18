"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { prefersReducedMotion } from "../../motion.js"
import type { NoChildren } from "../../tier.js"

export type CountUpProps = NoChildren & {
    /** The final value: what the server renders, what a crawler and a screen reader read, and what the count ends on. */
    readonly value: number
    /** The application's active BCP 47 locale; never inferred from the server or browser. */
    readonly locale: string
    /** How the number reads (`Intl.NumberFormat` options): grouping, decimals, a compact or percent style. Default: the locale's plain number. */
    readonly format?: Intl.NumberFormatOptions
    /** Text before the number, e.g. "+" or a currency sign the format does not draw. */
    readonly prefix?: string
    /** Text after the number, e.g. "%" or "+". */
    readonly suffix?: string
}

/** The easing of the count: the Grammar's decelerating curve, evaluated in script because the number is text, not a paint property. */
const easeOut = (progress: number): number => 1 - (1 - progress) ** 3

const durationOf = (node: HTMLElement): number => {
    const raw = getComputedStyle(node).getPropertyValue("--grammar-motion-duration-count").trim()
    const parsed = Number.parseFloat(raw)
    if (Number.isNaN(parsed)) return 0
    return raw.endsWith("ms") ? parsed : parsed * 1000
}

/**
 * A number that counts up from zero to its value the first time it is seen (0.47.3). The final value is the rendered text from the first byte: the server
 * HTML, a page whose script never runs, a reader under reduced motion and a crawler all get it. The count is a cue drawn over it: while it runs the moving
 * figure is `aria-hidden` and the final value stays in the accessibility tree as hidden text, so assistive technology never reads an intermediate number.
 */
export const CountUp = ({ value, locale, format, prefix = "", suffix = "" }: CountUpProps) => {
    const ref = useRef<HTMLSpanElement>(null)
    const [shown, setShown] = useState<number | null>(null)
    const formatter = useMemo(() => new Intl.NumberFormat(locale, format), [locale, format])
    useEffect(() => {
        const node = ref.current
        if (node === null || prefersReducedMotion() || typeof IntersectionObserver === "undefined" || typeof requestAnimationFrame === "undefined") return undefined
        let frame = 0
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return
            observer.disconnect()
            const duration = durationOf(node)
            if (duration <= 0) return
            const start = performance.now()
            const tick = (now: number) => {
                const progress = Math.min(1, (now - start) / duration)
                if (progress >= 1) {
                    setShown(null)
                    return
                }
                setShown(value * easeOut(progress))
                frame = requestAnimationFrame(tick)
            }
            setShown(0)
            frame = requestAnimationFrame(tick)
        })
        observer.observe(node)
        return () => {
            observer.disconnect()
            cancelAnimationFrame(frame)
        }
    }, [value])
    /** A whole value counts in whole steps; a fractional one counts to the decimals its format draws. */
    const digits = Number.isInteger(value) ? 0 : (formatter.resolvedOptions().maximumFractionDigits ?? 0)
    const stepped = (amount: number): number => Math.round(amount * 10 ** digits) / 10 ** digits
    const final = `${prefix}${formatter.format(value)}${suffix}`
    return (
        <span ref={ref} data-component="CountUp" data-tier="branch" data-contract="MOTION-1 MOTION-2 MOTION-3" className="starci-core-count-up" data-grammar-count-state={shown === null ? "done" : "counting"}>
            {shown === null ? final : (
                <>
                    <span aria-hidden="true">{`${prefix}${formatter.format(stepped(shown))}${suffix}`}</span>
                    <span className="starci-core-visually-hidden">{final}</span>
                </>
            )}
        </span>
    )
}
