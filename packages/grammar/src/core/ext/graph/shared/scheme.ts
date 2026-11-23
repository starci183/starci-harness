"use client"

import { useEffect, useState, type RefObject } from "react"

/**
 * The scheme of the scope a graph stands in. xyflow names its root `light` or `dark`, and those classes are theme scopes of the vendor's sheet: a root named
 * `light` inside a dark page resets every token under it to the light theme (light cards on a dark page). So the canvas tells xyflow the scheme it reads
 * from its own frame: the surface token resolved there, light or dark by its luminance.
 */
export type GraphScheme = "light" | "dark"

let probeContext: CanvasRenderingContext2D | null | undefined

const luminanceOf = (color: string): number | undefined => {
    try {
        probeContext ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    } catch {
        probeContext = null
    }
    if (probeContext === null || probeContext === undefined) return undefined
    probeContext.clearRect(0, 0, 1, 1)
    probeContext.fillStyle = color
    probeContext.fillRect(0, 0, 1, 1)
    const [red = 0, green = 0, blue = 0] = probeContext.getImageData(0, 0, 1, 1).data
    const linear = (channel: number): number => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

/** The scheme the element's surface token resolves to. */
export const schemeOf = (element: HTMLElement): GraphScheme => {
    const probe = document.createElement("span")
    probe.setAttribute("aria-hidden", "true")
    probe.style.cssText = "position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;color:var(--surface)"
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    const luminance = luminanceOf(color)
    return luminance !== undefined && luminance < 0.5 ? "dark" : "light"
}

/** The scheme of the scope around `anchor`, followed as the page's mode, the root's theme or the system scheme change. */
export const useGraphScheme = (anchor: RefObject<HTMLElement | null>): GraphScheme => {
    const [scheme, setScheme] = useState<GraphScheme>("light")
    useEffect(() => {
        if (typeof window === "undefined" || navigator.userAgent.includes("jsdom")) return
        const read = (): void => {
            if (anchor.current !== null) setScheme(schemeOf(anchor.current))
        }
        read()
        const media = window.matchMedia("(prefers-color-scheme: dark)")
        media.addEventListener("change", read)
        const page = new MutationObserver(read)
        page.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] })
        const root = anchor.current?.closest(".grammar-common-root")
        const scope = root === null || root === undefined ? null : new MutationObserver(read)
        if (root !== null && root !== undefined) scope?.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-grammar-family"] })
        return () => {
            media.removeEventListener("change", read)
            page.disconnect()
            scope?.disconnect()
        }
    }, [anchor])
    return scheme
}
