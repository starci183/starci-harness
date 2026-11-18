"use client"

import { Button as HeroButton } from "@heroui/react"
import { ArrowsPointingOutIcon, MinusIcon, PlusIcon } from "@heroicons/react/24/outline"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import type { FlowGraphHeight } from "../FlowGraph/types.js"
import { boundsOf, clusterPoints, fitBounds, panBy, tileAddress, tilesFor, zoomAbout, type Cluster, type GeoView, type Pixel, type Size } from "./projection.js"

/** One place on the map: where it is, and how many things are there. */
export type GeoMapPoint = {
    /** One per point. */
    readonly id: string
    readonly lat: number
    readonly lng: number
    /** How many things are at this place (stores, visits, people); the marker shows it. A place with no count is `0`. */
    readonly count: number
    /** The place's name, for `labels.point` and the list. */
    readonly label?: string
}

/**
 * The tile set the ground is drawn from: raster tiles at an address the app serves (its own tile route, or a PMTiles archive it
 * serves as `{z}/{x}/{y}` images). The grammar holds no key and calls no vendor: the address and the credit are the app's.
 */
export type GeoMapTiles = {
    /** The address of a tile, with `{z}`, `{x}` and `{y}` where the zoom, the column and the row go, e.g. `/tiles/vn/{z}/{x}/{y}.png`. */
    readonly url: string
    /** The credit the tile set requires (its data licence), drawn small at the corner and read by assistive technology. */
    readonly attribution: string
    /** The deepest zoom the set has tiles for (default 18); the map does not zoom past it. */
    readonly maxZoom?: number
}

/** The words of the map's controls, in the reader's language. */
export type GeoMapLabels = {
    readonly zoomIn: string
    readonly zoomOut: string
    /** The button that brings every point back into view. */
    readonly showAll: string
    /** Names the list of every point that assistive technology reads in place of the picture. */
    readonly list: string
    /** What a point reads as, e.g. `Ward 3, 120 stores`. */
    readonly point: (point: GeoMapPoint) => string
    /** What a cluster reads as, e.g. `12 places, 840 stores in all; press to zoom in`. */
    readonly cluster: (places: number, total: number) => string
}

export type GeoMapProps = NoChildren & {
    /** Names the map for assistive technology, e.g. "Stores by area". */
    readonly label: string
    readonly points: readonly GeoMapPoint[]
    readonly labels: GeoMapLabels
    /** The ground. Left out, the map draws its points on a plain ground (still pans and zooms). */
    readonly tiles?: GeoMapTiles
    /** What shows in place of the map when there is no point. Required: a map answers for its empty state. */
    readonly empty: ReactNode
    /** The map's height: `sm` 16rem, `md` 24rem (default), `lg` 32rem, a number of pixels, or a CSS length. */
    readonly height?: FlowGraphHeight | number | string
    /** Where the map starts. Left out, it opens on every point. */
    readonly defaultView?: { readonly lat: number; readonly lng: number; readonly zoom: number }
    /** A single point was pressed (a cluster zooms in instead). Given, points are buttons; left out, they are marks. */
    readonly onSelect?: (id: string) => void
    /** The first read has no data yet: the frame at its height with a Skeleton block, nothing mounted. */
    readonly isLoading?: boolean
    /** The read failed: this takes the map's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

const CELL = 64
const FIT_PADDING = 56
const PAN_STEP = 64
const DRAG_THRESHOLD = 4
const ANIMATION_MS = 260
const DEFAULT_MAX_ZOOM = 18
const SOLO_ZOOM = 12

const compact = typeof Intl === "undefined" ? undefined : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const countText = (value: number): string => (compact === undefined ? String(value) : compact.format(value))

const prefersReducedMotion = (): boolean => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches

const distance = (a: Pixel, b: Pixel): number => Math.hypot(a.x - b.x, a.y - b.y)

type MarkerStyle = CSSProperties & { readonly "--starci-core-geomap-size": string }

const markerSize = (total: number): string => `${(2 + 0.5 * Math.min(3, Math.max(0, Math.log10(Math.max(1, total))))).toFixed(2)}rem`

const GeoMapSurface = ({ label, points, labels, tiles, height, defaultView, onSelect }: Pick<GeoMapProps, "label" | "points" | "labels" | "tiles" | "height" | "defaultView" | "onSelect">) => {
    const frameRef = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState<Size | null>(null)
    const [view, setView] = useState<GeoView | null>(null)
    const viewRef = useRef<GeoView | null>(null)
    const sizeRef = useRef<Size | null>(null)
    const animation = useRef<number | null>(null)
    const hasMoved = useRef(false)
    const pointers = useRef(new Map<number, Pixel>())
    const gesture = useRef({ dragged: false, startX: 0, startY: 0, suppressClick: false })
    const maxZoom = tiles?.maxZoom ?? DEFAULT_MAX_ZOOM
    const limits = useMemo(() => ({ min: 0, max: maxZoom }), [maxZoom])
    const signature = points.map((point) => `${point.id}:${point.lat}:${point.lng}`).join("|")

    const commit = useCallback((next: GeoView) => {
        const bounded = { ...next, zoom: Math.min(maxZoom, Math.max(0, next.zoom)) }
        viewRef.current = bounded
        setView(bounded)
    }, [maxZoom])
    const stopAnimation = useCallback(() => {
        if (animation.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(animation.current)
        animation.current = null
    }, [])
    const animateTo = useCallback((target: GeoView) => {
        stopAnimation()
        const from = viewRef.current
        if (from === null || prefersReducedMotion() || typeof requestAnimationFrame !== "function") { commit(target); return }
        const startedAt = performance.now()
        const step = (now: number) => {
            const t = Math.min(1, (now - startedAt) / ANIMATION_MS)
            const eased = 1 - (1 - t) ** 3
            commit({ lat: from.lat + (target.lat - from.lat) * eased, lng: from.lng + (target.lng - from.lng) * eased, zoom: from.zoom + (target.zoom - from.zoom) * eased })
            animation.current = t < 1 ? requestAnimationFrame(step) : null
        }
        animation.current = requestAnimationFrame(step)
    }, [commit, stopAnimation])
    const fitAll = useCallback((current: Size): GeoView => {
        const bounds = boundsOf(points)
        return bounds === null ? { lat: 16, lng: 106, zoom: 5 } : fitBounds(bounds, current, limits, FIT_PADDING, SOLO_ZOOM)
    }, [points, limits])

    // The size of the frame, now and as it changes.
    useEffect(() => {
        const frame = frameRef.current
        if (frame === null) return undefined
        const read = () => {
            const box = frame.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) return
            const next = { width: box.width, height: box.height }
            sizeRef.current = next
            setSize((current) => (current !== null && Math.abs(current.width - next.width) < 0.5 && Math.abs(current.height - next.height) < 0.5 ? current : next))
        }
        read()
        if (typeof ResizeObserver === "undefined") return undefined
        const observer = new ResizeObserver(read)
        observer.observe(frame)
        return () => observer.disconnect()
    }, [])

    // The first view: the one given, or every point. New points bring it back until the reader has moved the map.
    useEffect(() => {
        if (size === null) return
        if (viewRef.current === null) commit(defaultView ?? fitAll(size))
        else if (!hasMoved.current && defaultView === undefined) animateTo(fitAll(size))
    }, [size === null, signature])

    useEffect(() => stopAnimation, [stopAnimation])

    const zoomBy = useCallback((delta: number, anchor?: Pixel) => {
        const current = viewRef.current
        const box = sizeRef.current
        if (current === null || box === null) return
        stopAnimation()
        hasMoved.current = true
        const target = Math.min(maxZoom, Math.max(0, current.zoom + delta))
        commit(zoomAbout(current, target, anchor ?? { x: box.width / 2, y: box.height / 2 }, box))
    }, [commit, maxZoom, stopAnimation])

    // Ctrl or Command with the wheel (and the trackpad pinch, which reports it) zooms about the pointer; a bare wheel scrolls the page.
    useEffect(() => {
        const frame = frameRef.current
        if (frame === null) return undefined
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return
            event.preventDefault()
            const box = frame.getBoundingClientRect()
            zoomBy(-event.deltaY * 0.01, { x: event.clientX - box.left, y: event.clientY - box.top })
        }
        frame.addEventListener("wheel", onWheel, { passive: false })
        return () => frame.removeEventListener("wheel", onWheel)
    }, [zoomBy])

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest("[data-grammar-geomap-control]") !== null) return
        if (event.pointerType === "mouse" && event.button !== 0) return
        stopAnimation()
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.current.size === 1) gesture.current = { dragged: false, startX: event.clientX, startY: event.clientY, suppressClick: false }
    }
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const last = pointers.current.get(event.pointerId)
        const current = viewRef.current
        const box = sizeRef.current
        if (last === undefined || current === null || box === null) return
        const next = { x: event.clientX, y: event.clientY }
        const frame = frameRef.current?.getBoundingClientRect()
        if (pointers.current.size >= 2 && frame !== undefined) {
            const other = Array.from(pointers.current.entries()).find(([id]) => id !== event.pointerId)?.[1]
            pointers.current.set(event.pointerId, next)
            if (other === undefined) return
            const before = distance(last, other)
            const after = distance(next, other)
            gesture.current.dragged = true
            gesture.current.suppressClick = true
            hasMoved.current = true
            if (before > 0 && after > 0) zoomBy(Math.log2(after / before), { x: (next.x + other.x) / 2 - frame.left, y: (next.y + other.y) / 2 - frame.top })
            return
        }
        if (!gesture.current.dragged && Math.hypot(next.x - gesture.current.startX, next.y - gesture.current.startY) < DRAG_THRESHOLD) return
        if (!gesture.current.dragged) {
            gesture.current.dragged = true
            gesture.current.suppressClick = true
            try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* a synthetic pointer has nothing to capture */ }
        }
        hasMoved.current = true
        pointers.current.set(event.pointerId, next)
        commit(panBy(current, next.x - last.x, next.y - last.y))
    }
    const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
        pointers.current.delete(event.pointerId)
        try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* nothing was captured */ }
        // The click that follows a drag lands on whatever was under the pointer; it is not a press.
        if (pointers.current.size === 0 && gesture.current.suppressClick) setTimeout(() => { gesture.current.suppressClick = false }, 0)
    }
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return
        const current = viewRef.current
        if (current === null) return
        const pan = (dx: number, dy: number) => { event.preventDefault(); hasMoved.current = true; stopAnimation(); commit(panBy(current, dx, dy)) }
        if (event.key === "ArrowLeft") pan(PAN_STEP, 0)
        else if (event.key === "ArrowRight") pan(-PAN_STEP, 0)
        else if (event.key === "ArrowUp") pan(0, PAN_STEP)
        else if (event.key === "ArrowDown") pan(0, -PAN_STEP)
        else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1) }
        else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomBy(-1) }
        else if (event.key === "Home" && size !== null) { event.preventDefault(); hasMoved.current = false; animateTo(fitAll(size)) }
    }
    const openCluster = (cluster: Cluster<GeoMapPoint>) => {
        const current = viewRef.current
        const box = sizeRef.current
        if (current === null || box === null) return
        hasMoved.current = true
        const bounds = boundsOf(cluster.members)
        if (bounds === null) return
        const fitted = fitBounds(bounds, box, limits, FIT_PADDING, Math.min(maxZoom, current.zoom + 3))
        animateTo({ lat: fitted.lat, lng: fitted.lng, zoom: Math.min(maxZoom, Math.max(fitted.zoom, current.zoom + 1)) })
    }
    const customHeight = height === undefined || height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
    const style = customHeight === undefined ? undefined : ({ "--starci-core-geomap-height": customHeight } as CSSProperties)

    const clusters = useMemo(() => (view === null || size === null ? [] : clusterPoints(points, view, size, CELL)), [points, view, size])
    const visible = size === null ? [] : clusters.filter((cluster) => cluster.pixel.x > -CELL && cluster.pixel.x < size.width + CELL && cluster.pixel.y > -CELL && cluster.pixel.y < size.height + CELL)
    const tileList = view === null || size === null || tiles === undefined ? [] : tilesFor(view, size, maxZoom)
    const ranked = useMemo(() => [...points].sort((a, b) => b.count - a.count), [points])
    const canZoomIn = view !== null && view.zoom < maxZoom - 1e-6
    const canZoomOut = view !== null && view.zoom > 1e-6

    return (
        <div className="starci-core-geomap-wrap">
            <div
                ref={frameRef}
                className="starci-core-geomap-frame"
                role="group"
                aria-roledescription="map"
                aria-label={label}
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - Home"
                tabIndex={0}
                data-grammar-geomap-height={customHeight === undefined ? height ?? "md" : "custom"}
                data-grammar-geomap-tiles={tiles === undefined ? "none" : "raster"}
                {...(view === null ? {} : { "data-grammar-geomap-zoom": view.zoom.toFixed(2) })}
                style={style}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={onKeyDown}
                onDoubleClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("[data-grammar-geomap-control], [data-grammar-geomap-marker]") !== null) return
                    const box = frameRef.current?.getBoundingClientRect()
                    if (box !== undefined) zoomBy(1, { x: event.clientX - box.left, y: event.clientY - box.top })
                }}
            >
                {tiles === undefined ? null : (
                    <div className="starci-core-geomap-tiles" aria-hidden="true">
                        {tileList.map((tile) => (
                            <img
                                key={tile.key}
                                className="starci-core-geomap-tile"
                                alt=""
                                draggable={false}
                                src={tileAddress(tiles.url, tile)}
                                style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
                                onError={(event) => { event.currentTarget.style.visibility = "hidden" }}
                            />
                        ))}
                    </div>
                )}
                <div className="starci-core-geomap-markers">
                    {visible.map((cluster) => {
                        const only = cluster.members.length === 1 ? cluster.members[0] : undefined
                        const markerStyle: MarkerStyle = { left: cluster.pixel.x, top: cluster.pixel.y, "--starci-core-geomap-size": markerSize(cluster.total) }
                        const text = <span className="starci-core-geomap-count" aria-hidden="true">{countText(cluster.total)}</span>
                        if (only === undefined) {
                            return (
                                <button
                                    key={cluster.members.map((member) => member.id).join("+")}
                                    type="button"
                                    className="starci-core-geomap-marker"
                                    data-grammar-geomap-marker="cluster"
                                    style={markerStyle}
                                    aria-label={labels.cluster(cluster.members.length, cluster.total)}
                                    onClick={() => { if (!gesture.current.suppressClick) openCluster(cluster) }}
                                >
                                    {text}
                                </button>
                            )
                        }
                        return onSelect === undefined ? (
                            <span key={only.id} className="starci-core-geomap-marker" role="img" data-grammar-geomap-marker="point" style={markerStyle} aria-label={labels.point(only)}>{text}</span>
                        ) : (
                            <button key={only.id} type="button" className="starci-core-geomap-marker" data-grammar-geomap-marker="point" style={markerStyle} aria-label={labels.point(only)} onClick={() => { if (!gesture.current.suppressClick) onSelect(only.id) }}>{text}</button>
                        )
                    })}
                </div>
                <div className="starci-core-geomap-controls" data-grammar-geomap-control="true">
                    <HeroButton isIconOnly size="sm" variant="secondary" aria-label={labels.zoomIn} isDisabled={!canZoomIn} onPress={() => zoomBy(1)}><PlusIcon aria-hidden="true" /></HeroButton>
                    <HeroButton isIconOnly size="sm" variant="secondary" aria-label={labels.zoomOut} isDisabled={!canZoomOut} onPress={() => zoomBy(-1)}><MinusIcon aria-hidden="true" /></HeroButton>
                    <HeroButton isIconOnly size="sm" variant="secondary" aria-label={labels.showAll} onPress={() => { hasMoved.current = false; if (size !== null) animateTo(fitAll(size)) }}><ArrowsPointingOutIcon aria-hidden="true" /></HeroButton>
                </div>
                {tiles === undefined ? null : <p className="starci-core-geomap-attribution">{tiles.attribution}</p>}
            </div>
            <ul className="starci-core-geomap-list" aria-label={labels.list}>
                {ranked.map((point) => (
                    <li key={point.id}>
                        {onSelect === undefined ? labels.point(point) : <button type="button" className="starci-core-geomap-list-press" onClick={() => onSelect(point.id)}>{labels.point(point)}</button>}
                    </li>
                ))}
            </ul>
        </div>
    )
}

/**
 * Points on a map of the ground, each with a count: zoom and pan by the buttons, the keys (arrows, plus, minus, Home), a drag, a
 * double click, a pinch, or Ctrl or Command with the wheel. Points that crowd one another merge into a cluster whose count is
 * the sum; pressing a cluster zooms in to the points inside it. The ground is a raster tile set at an address the app serves
 * (`tiles`), drawn with no key, no vendor script and no network call of the grammar's own; without it the points stand on a
 * plain ground. Assistive technology reads the map as a group and every point, ranked by count, as a list in place of the picture.
 */
export const GeoMap = ({ label, points, labels, tiles, empty, height, defaultView, onSelect, isLoading: ownLoading, error }: GeoMapProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (!isLoading && error !== undefined) return <ErrorView error={error} />
    if (!isLoading && points.length === 0) return <>{empty}</>
    if (isLoading) {
        const customHeight = height === undefined || height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
        return (
            <div
                data-tier="branch"
                data-component="GeoMap"
                data-contract="STATE-8"
                className="starci-core-geomap"
                data-loading="true"
                {...(ownsBusy ? {} : { "aria-busy": true })}
            >
                <div
                    className="starci-core-geomap-frame"
                    data-grammar-geomap-height={customHeight === undefined ? height ?? "md" : "custom"}
                    {...(customHeight === undefined ? {} : { style: { "--starci-core-geomap-height": customHeight } as CSSProperties })}
                >
                    <Skeleton shape="rect" />
                </div>
            </div>
        )
    }
    return (
        <div data-tier="branch" data-component="GeoMap" data-contract="FOCUS-2 STATE-8" className="starci-core-geomap">
            <GeoMapSurface label={label} points={points} labels={labels} {...(tiles === undefined ? {} : { tiles })} {...(height === undefined ? {} : { height })} {...(defaultView === undefined ? {} : { defaultView })} {...(onSelect === undefined ? {} : { onSelect })} />
        </div>
    )
}
