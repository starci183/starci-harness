import { Slider, Tabs, Text } from "@starci/grammar/core"
import { useEffect, useRef, useState } from "react"
import type { ReactElement, RefObject } from "react"
import type { Width } from "../explain.ts"
import { frameFile } from "../frames.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import type { Model, Screen } from "../model.ts"
import { Lightbox } from "./Lightbox.tsx"
import type { LightboxKind } from "./Lightbox.tsx"
import type { Pane, View } from "./route.ts"

const pct = (fraction: number | undefined): string => `${String((fraction ?? 0) * 100)}%`
const base = (): string => import.meta.env.BASE_URL
/** A phone screen is drawn no wider than this on the board; a desktop one takes the width its host gives it. */
const PHONE_STAGE = 520
/** The board pads its content by 1rem on each side (app.css `.sg-board`); the frames are scaled to what is left. */
const BOARD_PADDING = 32
/** Side by side holds while each column keeps at least this width; below it the two stack. */
const MIN_COLUMN = 320
const COLUMN_GAP = 16

/** The width of an element, followed while the window is resized. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
    const ref = useRef<T | null>(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        const observer = new ResizeObserver(() => {
            setWidth(node.clientWidth)
        })
        observer.observe(node)
        setWidth(node.clientWidth)
        return () => {
            observer.disconnect()
        }
    }, [])
    return [ref, width]
}

interface FrameProps {
    readonly screen: Screen
    readonly width: Width
    readonly labels: Labels
    readonly available: number
    /** Opens the frame full size; omitted where a press has another job (the slider). */
    readonly onOpen?: () => void
}

/** The approved design frame of a screen at real pixels, scaled to fill the width its host gives it, aspect kept. */
function DesignFrame({ screen, width, labels, available, onOpen }: FrameProps): ReactElement {
    const [measured, setMeasured] = useState<number | null>(null)
    const frame = screen.frame
    if (!frame?.widths.includes(width)) return <Text tone="muted">{labels.noDesign}</Text>
    const natural = Number(width)
    const height = frame.heights[width] ?? measured ?? 900
    const scale = available > 0 ? available / natural : 1
    return (
        <div className="sg-frame" style={{ height: height * scale }}>
            <iframe
                title={`${labels.design} ${screen.id} ${width}`}
                src={`${base()}__frames/${frameFile(screen.id, width)}`}
                width={natural}
                height={height}
                style={{ transform: `scale(${String(scale)})` }}
                tabIndex={-1}
                onLoad={(event) => {
                    const body = event.currentTarget.contentDocument?.body
                    if (body && frame.heights[width] === undefined) setMeasured(body.scrollHeight)
                }}
            />
            {onOpen === undefined ? null : <button type="button" className="sg-open" aria-label={labels.openFrame} title={labels.openFrame} onClick={onOpen} />}
        </div>
    )
}

interface ShotProps {
    readonly screen: Screen
    readonly width: Width
    readonly labels: Labels
    readonly model: Model
    readonly onOpenScreen: (id: string) => void
    readonly onOpen?: () => void
}

/** The real shot with the hotspots of links.json over it; a press elsewhere opens it full size. */
function Shot({ screen, width, labels, model, onOpenScreen, onOpen }: ShotProps): ReactElement {
    if (!screen.shots.includes(width)) return <Text tone="muted">{screen.shots.length === 0 ? labels.noShot : labels.noShotAtWidth}</Text>
    return (
        <div className="sg-shot">
            <img src={`${base()}__shots/${screen.id}/${width}.png`} alt={`${screen.id} ${width}`} />
            {onOpen === undefined ? null : <button type="button" className="sg-open" aria-label={labels.openFrame} title={labels.openFrame} onClick={onOpen} />}
            {screen.links.map((link, index) => (
                <button
                    key={index}
                    type="button"
                    className="sg-hotspot"
                    title={fill(labels.openScreen, { to: link.to })}
                    aria-label={fill(labels.openScreen, { to: link.to })}
                    disabled={model.screens[link.to] === undefined}
                    style={{ left: pct(link.x), top: pct(link.y), width: pct(link.w), height: pct(link.h) }}
                    onClick={() => {
                        onOpenScreen(link.to)
                    }}
                />
            ))}
        </div>
    )
}

export interface ViewerProps {
    readonly screen: Screen
    readonly model: Model
    readonly labels: Labels
    readonly width: Width
    /** The view of a wide window: side by side, a slider, the shot alone. */
    readonly view: View
    /** The pane of a narrow window (one at a time): design, shot or slider. */
    readonly pane: Exclude<Pane, "explain"> | null
    readonly onOpen: (id: string) => void
}

/** The viewer: design and shot side by side, a slider over both, or the shot alone; in a narrow window one pane at a time. Each frame opens full size on a press. */
export function Viewer({ screen, model, labels, width, view, pane, onOpen }: ViewerProps): ReactElement {
    const [ref, outer] = useWidth<HTMLDivElement>()
    const [split, setSplit] = useState(50)
    const [lightbox, setLightbox] = useState<LightboxKind | null>(null)
    const available = Math.max(outer - BOARD_PADDING, 0)
    const narrow = pane !== null
    const mode = narrow ? (pane === "design" ? "design" : pane === "shot" ? "shot" : "slider") : view
    const columns = mode === "side" && available >= 2 * MIN_COLUMN + COLUMN_GAP ? 2 : 1
    const each = columns === 2 ? (available - COLUMN_GAP) / 2 : available
    const cap = (value: number): number => (width === "390" ? Math.min(value, PHONE_STAGE) : value)
    const open = (kind: LightboxKind) => (): void => {
        setLightbox(kind)
    }
    return (
        <div ref={ref} className="sg-board">
            {mode === "side" ? (
                <div className="sg-columns" data-columns={columns}>
                    <figure>
                        <figcaption>
                            <Text size="xs" tone="muted" isStrong>
                                {labels.design}
                            </Text>
                        </figcaption>
                        <DesignFrame screen={screen} width={width} labels={labels} available={cap(each)} onOpen={open("design")} />
                    </figure>
                    <figure>
                        <figcaption>
                            <Text size="xs" tone="muted" isStrong>
                                {labels.shot}
                            </Text>
                        </figcaption>
                        <div style={width === "390" ? { maxWidth: PHONE_STAGE } : undefined}>
                            <Shot screen={screen} width={width} labels={labels} model={model} onOpenScreen={onOpen} onOpen={open("shot")} />
                        </div>
                    </figure>
                </div>
            ) : null}
            {mode === "design" ? <DesignFrame screen={screen} width={width} labels={labels} available={cap(available)} onOpen={open("design")} /> : null}
            {mode === "slider" ? (
                <div className="sg-slider">
                    <Slider
                        label={labels.slider}
                        value={split}
                        minValue={0}
                        maxValue={100}
                        step={1}
                        onValueChange={(value) => {
                            setSplit(typeof value === "number" ? value : (value[0] ?? 50))
                        }}
                    />
                    <div className="sg-stage" style={width === "390" ? { maxWidth: PHONE_STAGE } : undefined}>
                        <div className="sg-under">
                            <DesignFrame screen={screen} width={width} labels={labels} available={cap(available)} />
                        </div>
                        <div className="sg-over" style={{ clipPath: `inset(0 ${String(100 - split)}% 0 0)` }}>
                            <Shot screen={screen} width={width} labels={labels} model={model} onOpenScreen={onOpen} />
                        </div>
                        <div className="sg-handle" style={{ left: `${String(split)}%` }} aria-hidden="true" />
                    </div>
                </div>
            ) : null}
            {mode === "shot" ? (
                <div style={width === "390" ? { maxWidth: PHONE_STAGE } : undefined}>
                    <Shot screen={screen} width={width} labels={labels} model={model} onOpenScreen={onOpen} onOpen={open("shot")} />
                </div>
            ) : null}
            {lightbox === null ? null : (
                <Lightbox
                    screen={screen}
                    kind={lightbox}
                    width={width}
                    labels={labels}
                    onClose={() => {
                        setLightbox(null)
                    }}
                />
            )}
        </div>
    )
}

/** The widths, and in a wide window the views: two switches of the one viewer. */
export function ViewSwitches({ labels, width, view, showView, onChange }: { readonly labels: Labels; readonly width: Width; readonly view: View; readonly showView: boolean; readonly onChange: (next: { width?: Width; view?: View }) => void }): ReactElement {
    return (
        <div className="sg-switches">
            <Tabs
                appearance="primary"
                label={labels.width}
                selectedKey={width}
                onSelect={(key) => {
                    onChange({ width: key as Width })
                }}
                items={[
                    { id: "1440", label: "1440" },
                    { id: "390", label: "390" },
                ]}
            />
            {showView ? (
                <Tabs
                    appearance="primary"
                    label={labels.view}
                    selectedKey={view}
                    onSelect={(key) => {
                        onChange({ view: key as View })
                    }}
                    items={[
                        { id: "side", label: labels.viewSide },
                        { id: "slider", label: labels.viewSlider },
                        { id: "shot", label: labels.viewShot },
                    ]}
                />
            ) : null}
        </div>
    )
}
