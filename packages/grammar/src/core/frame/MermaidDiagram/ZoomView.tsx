"use client"

import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, ArrowsPointingInIcon } from "@heroicons/react/24/outline"
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react"
import { IconButton } from "../../leaf/IconButton/index.js"

/** The names of the zoom controls, in the app's words. */
export type MermaidZoomLabels = { readonly zoomIn: string; readonly zoomOut: string; readonly reset: string; readonly close: string; readonly open: string }

type View = { readonly scale: number; readonly x: number; readonly y: number }

const MIN = 0.25
const MAX = 8
const STEP = 1.25
const REST: View = { scale: 1, x: 0, y: 0 }
const clamp = (scale: number) => Math.min(MAX, Math.max(MIN, scale))

/**
 * The full-screen view of a diagram: the drawing in a pane the reader pans (drag, the arrow keys) and zooms (the wheel or a pinch
 * through the browser's wheel events, the + and - keys, the three controls), starting at 100% and centred. `drawing` places the svg.
 */
export const ZoomView = ({ label, labels, drawing }: { readonly label: string; readonly labels: MermaidZoomLabels; readonly drawing: (host: HTMLElement) => void }) => {
    const [view, setView] = useState<View>(REST)
    const host = useRef<HTMLDivElement | null>(null)
    const drag = useRef<{ readonly id: number; readonly x: number; readonly y: number } | null>(null)
    useEffect(() => { if (host.current !== null) drawing(host.current) }, [drawing])
    const zoom = useCallback((factor: number) => setView((current) => ({ ...current, scale: clamp(current.scale * factor) })), [])
    const onWheel = (event: WheelEvent<HTMLDivElement>) => { zoom(event.deltaY < 0 ? STEP : 1 / STEP) }
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        drag.current = { id: event.pointerId, x: event.clientX - view.x, y: event.clientY - view.y }
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current
        if (start === null || start.id !== event.pointerId) return
        setView((current) => ({ ...current, x: event.clientX - start.x, y: event.clientY - start.y }))
    }
    const onPointerUp = () => { drag.current = null }
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const move = 48
        const moves: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [move, 0], ArrowRight: [-move, 0], ArrowUp: [0, move], ArrowDown: [0, -move] }
        const by = moves[event.key]
        if (by !== undefined) {
            event.preventDefault()
            setView((current) => ({ ...current, x: current.x + by[0], y: current.y + by[1] }))
        } else if (event.key === "+" || event.key === "=") zoom(STEP)
        else if (event.key === "-") zoom(1 / STEP)
        else if (event.key === "0") setView(REST)
    }
    return (
        <div className="starci-core-mermaid-zoom" data-grammar-mermaid-zoom="true">
            <div className="starci-core-mermaid-zoom-controls">
                <IconButton size="sm" variant="border" label={labels.zoomOut} source={MagnifyingGlassMinusIcon} onPress={() => zoom(1 / STEP)} />
                <span className="starci-core-mermaid-zoom-level" aria-live="polite">{`${String(Math.round(view.scale * 100))}%`}</span>
                <IconButton size="sm" variant="border" label={labels.zoomIn} source={MagnifyingGlassPlusIcon} onPress={() => zoom(STEP)} />
                <IconButton size="sm" variant="border" label={labels.reset} source={ArrowsPointingInIcon} onPress={() => setView(REST)} />
            </div>
            <div
                className="starci-core-mermaid-zoom-pane"
                role="region"
                aria-label={label}
                tabIndex={0}
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
            >
                <div
                    ref={host}
                    className="starci-core-mermaid-zoom-drawing"
                    role="img"
                    aria-label={label}
                    style={{ transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})` }}
                />
            </div>
        </div>
    )
}
