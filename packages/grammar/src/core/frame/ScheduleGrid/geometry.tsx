"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useState, type RefObject } from "react"
import type { ScheduleDependency } from "./lanes.js"

/** Where the overlay draws: the line for today and one path per dependency, in pixels of the plane (the table and its overlay). */
type Geometry = {
    readonly width: number
    readonly height: number
    readonly today: { readonly x: number; readonly top: number } | null
    readonly arrows: readonly { readonly key: string; readonly d: string }[]
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

const round = (value: number) => Math.round(value * 10) / 10

/** The elbow from the end of one entry to the start of the one that waits on it. */
const pathOf = (from: DOMRect, to: DOMRect, plane: DOMRect): string => {
    const x1 = from.right - plane.left
    const y1 = from.top + from.height / 2 - plane.top
    const x2 = to.left - plane.left
    const y2 = to.top + to.height / 2 - plane.top
    const step = 8
    if (x2 >= x1 + 2 * step) return `M${round(x1)} ${round(y1)}H${round(x1 + step)}V${round(y2)}H${round(x2)}`
    // The successor starts before the predecessor ends: leave to the right, run between the two rows, come in from the left.
    const between = y2 >= y1 ? (from.bottom + to.top) / 2 - plane.top : (to.bottom + from.top) / 2 - plane.top
    return `M${round(x1)} ${round(y1)}H${round(x1 + step)}V${round(between)}H${round(x2 - step)}V${round(y2)}H${round(x2)}`
}

/**
 * Measures the grid so the overlay can draw what the table cannot: the dependency arrows between entries and the line for today.
 * The overlay is decorative (the dependencies and the current column are also words in the entries and the headings), so a
 * failed measure draws nothing. It re-measures when the entries or the plane's size change.
 */
export const useScheduleOverlay = (planeRef: RefObject<HTMLDivElement | null>, columnRefs: RefObject<Map<string, HTMLElement>>, input: { readonly todayColumn: string | undefined; readonly todayAt: number; readonly dependencies: readonly ScheduleDependency[]; readonly isActive: boolean; readonly signature: string }) => {
    const [geometry, setGeometry] = useState<Geometry | null>(null)
    const markerId = useId()
    const { todayColumn, todayAt, dependencies, isActive, signature } = input
    const measure = useCallback(() => {
        const plane = planeRef.current
        if (plane === null || !isActive || (todayColumn === undefined && dependencies.length === 0)) { setGeometry((current) => (current === null ? current : null)); return }
        const box = plane.getBoundingClientRect()
        const heading = todayColumn === undefined ? undefined : columnRefs.current?.get(todayColumn)
        const headingBox = heading?.getBoundingClientRect()
        const today = headingBox === undefined || headingBox.width === 0 ? null : { x: round(headingBox.left - box.left + headingBox.width * Math.min(1, Math.max(0, todayAt))), top: round(headingBox.top - box.top) }
        const arrows: { key: string; d: string }[] = []
        for (const dependency of dependencies) {
            const from = plane.querySelector(`[data-schedule-item-id="${CSS.escape(dependency.from)}"]`)
            const to = plane.querySelector(`[data-schedule-item-id="${CSS.escape(dependency.to)}"]`)
            if (from === null || to === null) continue
            arrows.push({ key: `${dependency.from}>${dependency.to}`, d: pathOf(from.getBoundingClientRect(), to.getBoundingClientRect(), box) })
        }
        const next: Geometry = { width: round(box.width), height: round(box.height), today, arrows }
        setGeometry((current) => (current !== null && JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }, [planeRef, columnRefs, isActive, todayColumn, todayAt, dependencies])
    useIsoLayoutEffect(() => { measure() }, [measure, signature])
    useEffect(() => {
        const plane = planeRef.current
        if (plane === null || typeof ResizeObserver === "undefined") return undefined
        const observer = new ResizeObserver(() => measure())
        observer.observe(plane)
        return () => observer.disconnect()
    }, [planeRef, measure])
    return { geometry, markerId }
}

export const ScheduleOverlay = ({ geometry, markerId }: { readonly geometry: Geometry | null; readonly markerId: string }) => {
    if (geometry === null) return null
    return (
        <svg className="starci-core-schedule-overlay" aria-hidden="true" focusable="false" width={geometry.width} height={geometry.height} viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
            <defs>
                <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M0 0L8 4L0 8z" className="starci-core-schedule-arrowhead" />
                </marker>
            </defs>
            {geometry.arrows.map((arrow) => (
                <path key={arrow.key} d={arrow.d} className="starci-core-schedule-arrow" markerEnd={`url(#${markerId})`} />
            ))}
            {geometry.today === null ? null : <line className="starci-core-schedule-today" x1={geometry.today.x} x2={geometry.today.x} y1={geometry.today.top} y2={geometry.height} />}
        </svg>
    )
}
