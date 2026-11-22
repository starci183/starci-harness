import { Button, Dialog, Text } from "@starci/grammar/core"
import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent, ReactElement } from "react"
import type { Width } from "../explain.ts"
import { frameFile } from "../frames.ts"
import type { Labels } from "../labels.ts"
import type { Screen } from "../model.ts"
import { cap } from "./cap.ts"

/** What the lightbox opens: the approved design frame or the real shot. */
export type LightboxKind = "design" | "shot"

/** The lightbox pads its scroll area by 0.5rem on each side (app.css `.sg-lightbox`). */
const LIGHTBOX_PADDING = 16
const STEPS = [0.5, 0.75, 1, 1.5, 2, 3] as const
const base = (): string => import.meta.env.BASE_URL

export interface LightboxProps {
    readonly screen: Screen
    readonly kind: LightboxKind
    readonly width: Width
    readonly labels: Labels
    readonly onClose: () => void
}

/**
 * A frame or a shot at full size in a modal Dialog (focus trapped, Escape or a press outside closes it): step 1 fits the width of the view, the buttons
 * and the `+`, `-` and `0` keys zoom, a drag pans, and the arrow keys scroll it.
 */
export function Lightbox({ screen, kind, width, labels, onClose }: LightboxProps): ReactElement {
    const [step, setStep] = useState(2)
    const [view, setView] = useState<HTMLDivElement | null>(null)
    const [viewWidth, setViewWidth] = useState(0)
    useEffect(() => {
        if (view === null) return undefined
        const observer = new ResizeObserver(() => {
            setViewWidth(view.clientWidth)
        })
        observer.observe(view)
        setViewWidth(view.clientWidth)
        return () => {
            observer.disconnect()
        }
    }, [view])
    const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
    const zoom = STEPS[step] ?? 1
    const natural = width === "390" ? 390 : 1440
    const drawn = width === "390" ? "390" : "1440"
    const height = screen.frame?.heights[drawn] ?? 900
    const stage = Math.max(viewWidth - LIGHTBOX_PADDING, 0) * zoom
    const clamp = (next: number): void => {
        setStep(Math.min(STEPS.length - 1, Math.max(0, next)))
    }
    const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "+" || event.key === "=") clamp(step + 1)
        else if (event.key === "-") clamp(step - 1)
        else if (event.key === "0") setStep(2)
    }
    const onDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (view === null) return
        drag.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop }
        view.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent<HTMLDivElement>): void => {
        const start = drag.current
        if (start === null || view === null) return
        view.scrollLeft = start.left - (event.clientX - start.x)
        view.scrollTop = start.top - (event.clientY - start.y)
    }
    return (
        <Dialog
            isOpen
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
            title={cap(screen.title)}
            description={`${screen.id} · ${width}`}
            closeLabel={labels.close}
            size="full"
            footer={
                <div className="sg-zoom">
                    <Button variant="border" size="sm" isDisabled={step === 0} onPress={() => { clamp(step - 1) }}>
                        {labels.zoomOut}
                    </Button>
                    <Text role="body" tabular>{`${String(Math.round(zoom * 100))}%`}</Text>
                    <Button variant="border" size="sm" isDisabled={step === STEPS.length - 1} onPress={() => { clamp(step + 1) }}>
                        {labels.zoomIn}
                    </Button>
                    <Button variant="border" size="sm" onPress={() => { setStep(2) }}>
                        {labels.zoomFit}
                    </Button>
                </div>
            }
        >
            <div
                ref={setView}
                className="sg-lightbox"
                role="region"
                aria-label={`${screen.title} ${width}`}
                tabIndex={0}
                onKeyDown={onKey}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={() => {
                    drag.current = null
                }}
            >
                {kind === "design" ? (
                    <div className="sg-frame" style={{ width: stage, height: (height * stage) / natural }}>
                        <iframe
                            title={`${labels.design} ${screen.id} ${drawn}`}
                            src={`${base()}__frames/${frameFile(screen.id, drawn)}`}
                            width={natural}
                            height={height}
                            style={{ transform: `scale(${String(stage / natural)})` }}
                        />
                    </div>
                ) : (
                    <img className="sg-lightbox-img" src={`${base()}__shots/${screen.id}/${width}.png`} alt={`${screen.id} ${width}`} style={{ width: stage }} draggable={false} />
                )}
            </div>
        </Dialog>
    )
}
