"use client"

import { useLayoutEffect, useRef, type RefObject } from "react"

/**
 * Height of the Grammar chrome pinned to the bottom edge right now (WorkspaceShell's compact navigation, BottomNav,
 * PinnedActionBar mark themselves `data-grammar-bottom-chrome`): the tallest visible fixed or sticky one in the lower half.
 */
export const bottomChromeHeight = (): number => {
    let tallest = 0
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-grammar-bottom-chrome="true"]'))) {
        const rect = node.getBoundingClientRect()
        const position = getComputedStyle(node).position
        if (rect.height > 0 && (position === "fixed" || position === "sticky") && rect.top >= window.innerHeight / 2) tallest = Math.max(tallest, rect.height)
    }
    return Math.round(tallest)
}

/** Layout effect on the client, plain effect during server rendering (no warning, nothing to measure there). */
const useIsoLayoutEffect = typeof window === "undefined" ? () => {} : useLayoutEffect

/**
 * The one measurer of a fill box, shared by FillViewport and Page `chrome="panes"`: it measures the returned ref's top
 * edge in document coordinates into `--starci-core-fill-top` and any Grammar bottom chrome into
 * `--starci-core-fill-bottom`, and re-measures on window resize and body size changes. CSS does the rest.
 */
export const useFillMeasure = (): RefObject<HTMLDivElement | null> => {
    const ref = useRef<HTMLDivElement>(null)
    useIsoLayoutEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        let frame = 0
        const measure = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                const top = node.getBoundingClientRect().top + window.scrollY
                node.style.setProperty("--starci-core-fill-top", `${Math.max(0, Math.round(top))}px`)
                node.style.setProperty("--starci-core-fill-bottom", `${bottomChromeHeight()}px`)
            })
        }
        measure()
        window.addEventListener("resize", measure)
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
        observer?.observe(document.body)
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("resize", measure)
            observer?.disconnect()
        }
    }, [])
    return ref
}
