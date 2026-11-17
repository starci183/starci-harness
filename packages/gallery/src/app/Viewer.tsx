import type { ReactElement } from "react"
import { Slider, Tabs, Text } from "@starci/grammar/core"
import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { Width } from "../explain.ts"
import { frameFile } from "../frames.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import type { Model, Screen } from "../model.ts"
import type { View } from "./route.ts"

const pct = (fraction: number | undefined): string => `${String((fraction ?? 0) * 100)}%`
const base = (): string => import.meta.env.BASE_URL
/** A phone screen is drawn no wider than this on the board; a desktop one takes the width its host gives it. */
const PHONE_STAGE = 520
/** The board pads its content by 1rem on each side (app.css `.sg-board`); the frames are scaled to what is left. */
const BOARD_PADDING = 32

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

/** The approved design frame of a screen at real pixels, scaled to the width its host gives it. The gallery has two widths, the two the design draws. */
function DesignFrame({ screen, width, labels, available }: { readonly screen: Screen; readonly width: Width; readonly labels: Labels; readonly available: number }) {
    const drawn = width
    const [measured, setMeasured] = useState<number | null>(null)
    const frame = screen.frame
    if (!frame?.widths.includes(drawn)) return <Text tone="muted">{labels.noDesign}</Text>
    const natural = Number(drawn)
    const height = frame.heights[drawn] ?? measured ?? 900
    const scale = available > 0 ? available / natural : 1
    return (
        <div className="sg-frame" style={{ height: height * scale }}>
            <iframe
                title={`${labels.design} ${screen.id} ${drawn}`}
                src={`${base()}__frames/${frameFile(screen.id, drawn)}`}
                width={natural}
                height={height}
                style={{ transform: `scale(${String(scale)})` }}
                onLoad={(event) => {
                    const body = event.currentTarget.contentDocument?.body
                    if (body && frame.heights[drawn] === undefined) setMeasured(body.scrollHeight)
                }}
            />
        </div>
    )
}

/** The real shot with the hotspots of links.json over it. */
function Shot({ screen, width, labels, model, onOpen }: { readonly screen: Screen; readonly width: Width; readonly labels: Labels; readonly model: Model; readonly onOpen: (id: string) => void }) {
    if (!screen.shots.includes(width)) return <Text tone="muted">{screen.shots.length === 0 ? labels.noShot : labels.noShotAtWidth}</Text>
    return (
        <div className="sg-shot">
            <img src={`${base()}__shots/${screen.id}/${width}.png`} alt={`${screen.id} ${width}`} />
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
                        onOpen(link.to)
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
    readonly view: View
    readonly onOpen: (id: string) => void
}

/** The viewer on its light grey board: design and shot side by side, a slider over both, or the shot alone. */
export function Viewer({ screen, model, labels, width, view, onOpen }: ViewerProps): ReactElement {
    const [ref, outer] = useWidth<HTMLDivElement>()
    const available = Math.max(outer - BOARD_PADDING, 0)
    const [split, setSplit] = useState(50)
    const columns = view === "side" && available > 760 ? 2 : 1
    const each = columns === 2 ? (available - 16) / 2 : available
    const cap = (value: number): number => (width === "390" ? Math.min(value, PHONE_STAGE) : value)
    return (
        <div ref={ref} className="sg-board">
            {view === "side" ? (
                <div className="sg-columns" data-columns={columns}>
                    <figure>
                        <figcaption>
                            <Text size="xs" tone="muted" isStrong>
                                {labels.design}
                            </Text>
                        </figcaption>
                        <DesignFrame screen={screen} width={width} labels={labels} available={cap(each)} />
                    </figure>
                    <figure>
                        <figcaption>
                            <Text size="xs" tone="muted" isStrong>
                                {labels.shot}
                            </Text>
                        </figcaption>
                        <Shot screen={screen} width={width} labels={labels} model={model} onOpen={onOpen} />
                    </figure>
                </div>
            ) : null}
            {view === "slider" ? (
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
                            <Shot screen={screen} width={width} labels={labels} model={model} onOpen={onOpen} />
                        </div>
                        <div className="sg-handle" style={{ left: `${String(split)}%` }} aria-hidden="true" />
                    </div>
                </div>
            ) : null}
            {view === "shot" ? <Shot screen={screen} width={width} labels={labels} model={model} onOpen={onOpen} /> : null}
        </div>
    )
}

/** The widths and the views, two switches of the one viewer. */
export function ViewSwitches({ labels, width, view, onChange }: { readonly labels: Labels; readonly width: Width; readonly view: View; readonly onChange: (next: { width?: Width; view?: View }) => void }): ReactElement {
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
        </div>
    )
}
