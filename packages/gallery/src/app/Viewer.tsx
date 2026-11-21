import { Slider, Tabs, Text } from "@starci/grammar/core"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactElement, RefObject } from "react"
import type { Width } from "../explain.ts"
import { frameFile } from "../frames.ts"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import type { Model, Screen } from "../model.ts"
import { Lightbox } from "./Lightbox.tsx"
import type { LightboxKind } from "./Lightbox.tsx"
import { COMPARE_VIEWS } from "../views.ts"
import type { View } from "../views.ts"
import type { Pane } from "./route.ts"

const pct = (fraction: number | undefined): string => `${String((fraction ?? 0) * 100)}%`
const base = (): string => import.meta.env.BASE_URL
/** A phone screen is drawn no wider than this on the board; a desktop one takes the width its host gives it. */
const PHONE_STAGE = 520
/** The board pads its content by 1rem on each side (app.css `.sg-board`); the frames are scaled to what is left. */
const BOARD_PADDING = 32
/** Side by side holds while each column keeps at least this width; below it the two stack. */
const MIN_COLUMN = 320
const COLUMN_GAP = 16
/** The design.json statuses from which the drawing is the approved one. */
const APPROVED = ["approved", "built", "matches"]

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
    /** The view of a wide window: the design, a comparison of design and shot, the shot. */
    readonly view: View
    /** The pane of a narrow window (one at a time): design, shot or the comparison (its way is `view`). */
    readonly pane: Exclude<Pane, "explain"> | null
    readonly onOpen: (id: string) => void
}

/**
 * The viewer: the design frame alone, the real shot alone, or the two compared: side by side, a slider that wipes the shot over the design, an onion skin (the shot over the
 * design at an opacity), a difference (the shot over the design with mix-blend-mode difference, so a shape that differs lights up). Both images are aligned to the same
 * width at the top left. Each frame opens full size on a press; in a narrow window one pane shows at a time.
 */
export function Viewer({ screen, model, labels, width, view, pane, onOpen }: ViewerProps): ReactElement {
    const [ref, outer] = useWidth<HTMLDivElement>()
    const [amount, setAmount] = useState(50)
    const [lightbox, setLightbox] = useState<LightboxKind | null>(null)
    const available = Math.max(outer - BOARD_PADDING, 0)
    const designTitle = screen.designStatus !== null && APPROVED.includes(screen.designStatus) ? labels.designApproved : labels.design
    const narrow = pane !== null
    const mode: View = narrow ? (pane === "design" ? "design" : pane === "shot" ? "shot" : COMPARE_VIEWS.includes(view) ? view : "slider") : view
    const columns = mode === "side" && available >= 2 * MIN_COLUMN + COLUMN_GAP ? 2 : 1
    const each = columns === 2 ? (available - COLUMN_GAP) / 2 : available
    const cap = (value: number): number => (width === "390" ? Math.min(value, PHONE_STAGE) : value)
    const open = (kind: LightboxKind) => (): void => {
        setLightbox(kind)
    }
    const overlay = mode === "slider" || mode === "onion" || mode === "diff"
    const overStyle: CSSProperties = mode === "slider" ? { clipPath: `inset(0 ${String(100 - amount)}% 0 0)` } : mode === "onion" ? { opacity: amount / 100 } : mode === "diff" ? { mixBlendMode: "difference" } : {}
    return (
        <div ref={ref} className="sg-board">
            {mode === "side" ? (
                <div className="sg-columns" data-columns={columns}>
                    <figure>
                        <figcaption>
                            <Text role="label.group">
                                {designTitle}
                            </Text>
                        </figcaption>
                        <DesignFrame screen={screen} width={width} labels={labels} available={cap(each)} onOpen={open("design")} />
                    </figure>
                    <figure>
                        <figcaption>
                            <Text role="label.group">
                                {labels.shot}
                            </Text>
                        </figcaption>
                        <div style={width === "390" ? { maxWidth: PHONE_STAGE } : undefined}>
                            <Shot screen={screen} width={width} labels={labels} model={model} onOpenScreen={onOpen} onOpen={open("shot")} />
                        </div>
                    </figure>
                </div>
            ) : null}
            {mode === "design" ? (
                <figure className="sg-single">
                    <figcaption>
                        <Text role="label.group">
                            {designTitle}
                        </Text>
                    </figcaption>
                    <DesignFrame screen={screen} width={width} labels={labels} available={cap(available)} onOpen={open("design")} />
                </figure>
            ) : null}
            {overlay ? (
                <div className="sg-slider">
                    {mode === "diff" ? null : (
                        <Slider
                            label={mode === "onion" ? labels.onionOpacity : labels.slider}
                            value={amount}
                            minValue={0}
                            maxValue={100}
                            step={1}
                            onValueChange={(value) => {
                                setAmount(typeof value === "number" ? value : (value[0] ?? 50))
                            }}
                        />
                    )}
                    <div className="sg-stage" data-mode={mode} style={width === "390" ? { maxWidth: PHONE_STAGE } : undefined}>
                        <div className="sg-under">
                            <DesignFrame screen={screen} width={width} labels={labels} available={cap(available)} />
                        </div>
                        <div className="sg-over" style={overStyle}>
                            <Shot screen={screen} width={width} labels={labels} model={model} onOpenScreen={onOpen} />
                        </div>
                        {mode === "slider" ? <div className="sg-handle" style={{ left: `${String(amount)}%` }} aria-hidden="true" /> : null}
                    </div>
                </div>
            ) : null}
            {mode === "shot" ? (
                <figure className="sg-single" style={width === "390" ? { maxWidth: PHONE_STAGE } : undefined}>
                    <figcaption>
                        <Text role="label.group">
                            {labels.shot}
                        </Text>
                    </figcaption>
                    <Shot screen={screen} width={width} labels={labels} model={model} onOpenScreen={onOpen} onOpen={open("shot")} />
                </figure>
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

export interface SwitchesProps {
    readonly labels: Labels
    readonly width: Width
    readonly view: View
    /** Whether the screen has a design frame and a shot at this width: a view that needs the missing one is disabled. */
    readonly hasDesign: boolean
    readonly hasShot: boolean
    readonly showView: boolean
    readonly onChange: (next: { width?: Width; view?: View }) => void
}

/** The widths and, in a wide window, the three views (Bản vẽ, Đối chiếu, Ảnh thật); a view with only one side to show is disabled, and the reason stands beside. */
export function ViewSwitches({ labels, width, view, hasDesign, hasShot, showView, onChange }: SwitchesProps): ReactElement {
    const group = view === "design" || view === "shot" ? view : "compare"
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
                    selectedKey={group}
                    onSelect={(key) => {
                        onChange({ view: key === "compare" ? (COMPARE_VIEWS.includes(view) ? view : "side") : (key as View) })
                    }}
                    items={[
                        { id: "design", label: labels.viewDesign, isDisabled: !hasDesign },
                        { id: "compare", label: labels.viewCompare, isDisabled: !(hasDesign && hasShot) },
                        { id: "shot", label: labels.viewShot, isDisabled: !hasShot },
                    ]}
                />
            ) : null}
        </div>
    )
}

/** The ways to compare, under the Đối chiếu view. */
export function CompareModes({ labels, view, onChange }: { readonly labels: Labels; readonly view: View; readonly onChange: (view: View) => void }): ReactElement {
    return (
        <Tabs
            kind="filter"
            label={labels.viewCompare}
            selectedKey={view}
            onSelect={(key) => {
                onChange(key as View)
            }}
            items={[
                { id: "side", label: labels.viewSide },
                { id: "slider", label: labels.viewSlider },
                { id: "onion", label: labels.viewOnion },
                { id: "diff", label: labels.viewDiff },
            ]}
        />
    )
}
