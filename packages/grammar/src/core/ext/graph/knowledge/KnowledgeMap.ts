"use client"

import { createElement as h, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from "react"
import { InlineStatus, Skeleton as Bone, Text, type MarkState } from "../../../index.js"
import { InlineStatusGlyph } from "../../../statusMark.js"
import { AnchoredTooltip } from "../../../branch/Tooltip/index.js"
import { READABLE_ZOOM } from "../diagram/open.js"
import { useLayoutDirection } from "../shared/phone.js"
import { openView as openAt } from "../shared/view.js"
import { ZoomButtons } from "../shared/zoom.js"
import type { GraphTone } from "../types.js"
import { layoutKnowledge, linePairs, type KnowledgeLayout } from "./layout.js"
import type { KnowledgeCluster, KnowledgeItem, KnowledgeMapProps, KnowledgeState } from "./types.js"

/** The tones the clusters take in turn when the app names none. */
export const CLUSTER_TONES: readonly GraphTone[] = ["accent", "info", "success", "warning", "danger"]

/** The core mark state of an item's state (the core's status map draws its glyph) and its tone: ready done, pending running (the info blue), stale not run, error error. */
export const STATE_GLYPH: Readonly<Record<KnowledgeState, { readonly state: MarkState; readonly tone: GraphTone }>> = {
    ready: { state: "done", tone: "success" },
    pending: { state: "running", tone: "info" },
    stale: { state: "notRun", tone: "muted" },
    error: { state: "error", tone: "danger" },
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const STEP = 1.25
/** Two taps this close in time (ms) and place (px) zoom in. */
const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_PX = 30

interface View {
    readonly k: number
    readonly x: number
    readonly y: number
}

interface Size {
    readonly width: number
    readonly height: number
}

interface Point {
    readonly x: number
    readonly y: number
}

/** The room kept above a map taller than its canvas, so its first names stand in view below the zoom toolbar. */
const OPEN_TOP = 12

/** The columns of the cluster grid on a phone (under the graphs' phone width): the map is laid out top-down, two clusters across, so its names stay readable. */
const PHONE_COLUMNS = 2

/**
 * The view a map opens in, on every screen alike: the whole map fitted (at 100% or less) in the middle of the canvas (`openView`), never under the diagrams'
 * readable floor (`READABLE_ZOOM`): a map that needs less opens at the floor from its top, centred across when it fits the width, and the reader pans on.
 */
const openView = (layout: KnowledgeLayout, size: Size, focusId: string | undefined): View => {
    const room = { width: size.width - 2 * OPEN_TOP, height: size.height - 2 * OPEN_TOP }
    const fit = Math.min(room.width / Math.max(1, layout.width), room.height / Math.max(1, layout.height))
    if (fit < READABLE_ZOOM) {
        const k = READABLE_ZOOM
        const wide = layout.width * k
        return { k, x: wide <= room.width ? OPEN_TOP + (room.width - wide) / 2 : OPEN_TOP, y: OPEN_TOP }
    }
    const heaviest = layout.bubbles.reduce<KnowledgeLayout["bubbles"][number] | undefined>((best, bubble) => (best === undefined || bubble.r > best.r ? bubble : best), undefined)
    const bubble = layout.bubbles.find((each) => each.id === focusId) ?? heaviest
    const focus = bubble === undefined ? undefined : { x: bubble.x - bubble.r, y: bubble.y - bubble.r, width: bubble.r * 2, height: bubble.r * 2 }
    const view = openAt(size, { x: 0, y: 0, width: layout.width, height: layout.height }, focus, { top: OPEN_TOP, right: OPEN_TOP, bottom: OPEN_TOP, left: OPEN_TOP })
    return { k: view.zoom, x: view.x, y: view.y }
}

/** The view that shows the whole map, centred in the canvas; never enlarged beyond 1.25 so a sparse map stays small. */
const fitView = (layout: KnowledgeLayout, size: Size): View => {
    const k = Math.min(1.25, Math.max(MIN_ZOOM, Math.min(size.width / layout.width, size.height / layout.height)))
    return { k, x: (size.width - layout.width * k) / 2, y: (size.height - layout.height * k) / 2 }
}

const clamp = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

/** `view` zoomed by `factor` about the canvas point `at`, which stays where it is. */
const zoomAbout = (view: View, factor: number, at: Point): View => {
    const k = clamp(view.k * factor)
    return { k, x: at.x - ((at.x - view.x) / view.k) * k, y: at.y - ((at.y - view.y) / view.k) * k }
}

const toneOf = (clusters: readonly KnowledgeCluster[]): Map<string, GraphTone> => new Map(clusters.map((cluster, index) => [cluster.id, cluster.tone ?? CLUSTER_TONES[index % CLUSTER_TONES.length] ?? "accent"] as const))

interface Words {
    readonly kindLabels: KnowledgeMapProps["kindLabels"]
    readonly stateLabels: KnowledgeMapProps["stateLabels"]
    readonly weightLabel: KnowledgeMapProps["weightLabel"]
}

/** The words of one bubble, all from the app: "name, kind, state, weight". */
const describe = (item: KnowledgeItem, words: Words): string =>
    [item.name, words.kindLabels?.[item.kind], item.state === undefined ? undefined : words.stateLabels?.[item.state], words.weightLabel?.(item.weight)].filter((part): part is string => part !== undefined && part !== "").join(", ")

/** A bubble's state: the core's inline status glyph, in its state's tone. */
const Glyph = ({ state }: { readonly state: KnowledgeState }): ReactElement => h("span", { className: "starci-knowledge-glyph", "data-tone": STATE_GLYPH[state].tone, "aria-hidden": true }, h(InlineStatusGlyph, { state: STATE_GLYPH[state].state }))

/** The shared zoom of every graph mode (Grammar's 40px IconButtons), at the canvas's bottom left. */
const Zoom = ({ labels, onIn, onOut, onFit }: { readonly labels: KnowledgeMapProps["zoomLabels"]; readonly onIn: () => void; readonly onOut: () => void; readonly onFit: () => void }): ReactElement =>
    h("div", { className: "starci-knowledge-zoom" }, h(ZoomButtons, { words: { zoomIn: labels.zoomIn, zoomOut: labels.zoomOut, fit: labels.fit }, onZoomIn: onIn, onZoomOut: onOut, onFit }))

const Legend = ({ items }: { readonly items: NonNullable<KnowledgeMapProps["legend"]> }): ReactElement =>
    h(
        "ul",
        { className: "starci-graph-legend starci-type-caption starci-knowledge-legend" },
        items.map((item, index) =>
            h(
                "li",
                { key: index, className: "starci-graph-legend-item" },
                // A state row is the core's InlineStatus; a line or a kind swatch stands before a caption.
                item.state !== undefined
                    ? h(InlineStatus, { state: STATE_GLYPH[item.state].state, label: item.label })
                    : [
                          item.source === true
                              ? h("span", { key: "swatch", className: "starci-knowledge-legend-line", "aria-hidden": true })
                              : h("span", { key: "swatch", className: "starci-knowledge-swatch", "data-kind": item.kind ?? "document", "aria-hidden": true }),
                          h(Text, { key: "label", role: "caption" }, item.label),
                      ],
            ),
        ),
    )

/** Bones in the shape of bubbles, as percentages of the canvas: three clumps. */
const SKELETON: readonly (readonly [number, number, number])[] = [
    [22, 30, 56],
    [30, 44, 28],
    [16, 46, 24],
    [26, 58, 36],
    [52, 20, 44],
    [60, 34, 24],
    [46, 36, 28],
    [56, 48, 32],
    [74, 58, 52],
    [68, 72, 26],
    [82, 74, 30],
    [84, 46, 22],
]

const MapSkeleton = (): ReactElement =>
    h(
        "div",
        { className: "starci-knowledge-skeleton", "aria-hidden": true },
        // The core's Skeleton, a round box the size of each bubble.
        SKELETON.map(([x, y, size], index) => h("span", { key: index, className: "starci-knowledge-bone", style: { left: `${String(x)}%`, top: `${String(y)}%` } }, h(Bone, { shape: "box", radius: "full", width: `${String(size)}px`, height: `${String(size)}px` }))),
    )

interface Gesture {
    /** The fingers (or the mouse) down now, by pointer id. */
    readonly down: Map<number, Point>
    /** The pinch: the distance between two fingers at the last move. */
    pinch: number | null
    moved: boolean
    /** The last tap, for a double tap. */
    tap: { at: number; x: number; y: number } | null
}

interface MapProps extends KnowledgeMapProps {
    readonly layout: KnowledgeLayout
    readonly tones: ReadonlyMap<string, GraphTone>
}

const MapView = (props: MapProps): ReactElement => {
    const { layout, tones, clusters, items, onOpen, zoomLabels } = props
    const canvas = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState<Size | undefined>(undefined)
    const [view, setView] = useState<View | undefined>(undefined)
    const [hover, setHover] = useState<string | null>(null)
    const gesture = useRef<Gesture>({ down: new Map(), pinch: null, moved: false, tap: null })
    const suppress = useRef(false)
    const tipId = useId()
    const opened = useRef<KnowledgeLayout | null>(null)
    const words: Words = { kindLabels: props.kindLabels, stateLabels: props.stateLabels, weightLabel: props.weightLabel }

    useLayoutEffect(() => {
        const element = canvas.current
        if (element === null) return undefined
        const read = (): void => {
            const next = { width: element.clientWidth, height: element.clientHeight }
            setSize((now) => (now?.width === next.width && now.height === next.height ? now : next))
        }
        read()
        const observer = new ResizeObserver(read)
        observer.observe(element)
        return () => {
            observer.disconnect()
        }
    }, [])
    // The map opens at 100% when its first size is known, and again when the layout changes; the canvas changing size afterwards leaves the view alone.
    useLayoutEffect(() => {
        if (size === undefined || size.width === 0 || opened.current === layout) return
        opened.current = layout
        setView(openView(layout, size, props.focusId))
    }, [layout, size, props.focusId])

    const middle = useCallback((): Point => ({ x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 }), [size])
    const zoomBy = useCallback(
        (factor: number): void => {
            setView((now) => (now === undefined ? now : zoomAbout(now, factor, middle())))
        },
        [middle],
    )

    const byId = new Map(items.map((item) => [item.id, item] as const))
    const lines = linePairs(items, props.links ?? [])
    const at = new Map(layout.bubbles.map((bubble) => [bubble.id, bubble] as const))
    const hovered = hover === null ? undefined : byId.get(hover)
    const hoveredSource = hovered?.sourceId === undefined ? undefined : byId.get(hovered.sourceId)

    const onDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.pointerType === "mouse" && event.button !== 0) return
        const g = gesture.current
        g.down.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (g.down.size === 1) g.moved = false
        if (g.down.size === 2) {
            const [a, b] = [...g.down.values()]
            g.pinch = a === undefined || b === undefined ? null : Math.hypot(a.x - b.x, a.y - b.y)
            g.moved = true
        }
    }
    const onMove = (event: PointerEvent<HTMLDivElement>): void => {
        const g = gesture.current
        const last = g.down.get(event.pointerId)
        if (last === undefined || view === undefined) return
        const now = { x: event.clientX, y: event.clientY }
        if (g.down.size === 2) {
            // Pinch: the distance of the two fingers sets the zoom, the middle between them carries the pan.
            const [c, d] = [...g.down.values()]
            g.down.set(event.pointerId, now)
            const [a, b] = [...g.down.values()]
            if (a === undefined || b === undefined || c === undefined || d === undefined || g.pinch === null) return
            const distance = Math.hypot(a.x - b.x, a.y - b.y)
            const box = event.currentTarget.getBoundingClientRect()
            const centre = { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top }
            const shift = { x: (a.x + b.x) / 2 - (c.x + d.x) / 2, y: (a.y + b.y) / 2 - (c.y + d.y) / 2 }
            const zoomed = zoomAbout(view, distance / g.pinch, centre)
            g.pinch = distance
            setView({ ...zoomed, x: zoomed.x + shift.x, y: zoomed.y + shift.y })
            return
        }
        const dx = now.x - last.x
        const dy = now.y - last.y
        if (!g.moved && Math.hypot(dx, dy) < 4) return
        if (!g.moved) event.currentTarget.setPointerCapture(event.pointerId)
        g.moved = true
        g.down.set(event.pointerId, now)
        setView({ ...view, x: view.x + dx, y: view.y + dy })
    }
    const onUp = (event: PointerEvent<HTMLDivElement>): void => {
        const g = gesture.current
        const alone = g.down.size === 1
        g.down.delete(event.pointerId)
        g.pinch = null
        if (g.moved) {
            // The click that ends a pan or a pinch opens nothing.
            suppress.current = true
            if (g.down.size === 0) g.moved = false
            return
        }
        if (!alone || event.type === "pointercancel") return
        const box = event.currentTarget.getBoundingClientRect()
        const point = { x: event.clientX - box.left, y: event.clientY - box.top }
        const before = g.tap
        if (before !== null && event.timeStamp - before.at < DOUBLE_TAP_MS && Math.hypot(point.x - before.x, point.y - before.y) < DOUBLE_TAP_PX) {
            g.tap = null
            // A double tap on empty canvas zooms in there; on a bubble it only opens it.
            if ((event.target as Element).closest(".starci-knowledge-bubble") === null) setView((now) => (now === undefined ? now : zoomAbout(now, 2, point)))
        } else g.tap = { at: event.timeStamp, x: point.x, y: point.y }
    }
    const open = (id: string): void => {
        if (suppress.current) {
            suppress.current = false
            return
        }
        onOpen?.(id)
    }

    return h(
        "div",
        { className: "starci-knowledge-body" },
        h(Zoom, {
            labels: zoomLabels,
            onIn: () => {
                zoomBy(STEP)
            },
            onOut: () => {
                zoomBy(1 / STEP)
            },
            onFit: () => {
                if (size !== undefined) setView(fitView(layout, size))
            },
        }),
        h(
            "div",
            { className: "starci-knowledge-canvas", ref: canvas, onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp },
            view === undefined
                ? null
                : h(
                      "div",
                      { className: "starci-knowledge-stage", style: { inlineSize: layout.width, blockSize: layout.height, transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.k)})` } },
                      h(
                          "svg",
                          { className: "starci-knowledge-lines", width: layout.width, height: layout.height, "aria-hidden": true },
                          lines.flatMap(([fromId, toId]) => {
                              const from = at.get(fromId)
                              const to = at.get(toId)
                              if (from === undefined || to === undefined || from === to) return []
                              const length = Math.hypot(to.x - from.x, to.y - from.y)
                              if (length === 0) return []
                              const ux = (to.x - from.x) / length
                              const uy = (to.y - from.y) / length
                              return [
                                  h("line", {
                                      key: `${fromId}>${toId}`,
                                      className: "starci-knowledge-line",
                                      "data-active": hover === fromId || hover === toId ? "true" : undefined,
                                      "data-from": fromId,
                                      "data-to": toId,
                                      x1: from.x + ux * from.r,
                                      y1: from.y + uy * from.r,
                                      x2: to.x - ux * to.r,
                                      y2: to.y - uy * to.r,
                                  }),
                              ]
                          }),
                      ),
                      layout.labels.map((label) =>
                          h(
                              "div",
                              { key: label.id, className: "starci-knowledge-name", "data-cluster": label.id, "data-tone": tones.get(label.id), title: clusters.find((candidate) => candidate.id === label.id)?.name, style: { left: label.x, top: label.y, inlineSize: label.width, blockSize: label.height } },
                              h("span", { className: "starci-knowledge-name-dot", "aria-hidden": true }),
                              h("span", { className: "starci-knowledge-name-text" }, h(Text, { role: "caption", overflow: "truncate" }, clusters.find((candidate) => candidate.id === label.id)?.name)),
                          ),
                      ),
                      layout.bubbles.map((bubble) => {
                          const item = byId.get(bubble.id)
                          if (item === undefined) return null
                          return h(
                              "button",
                              {
                                  key: bubble.id,
                                  type: "button",
                                  className: "starci-knowledge-bubble",
                                  "data-id": bubble.id,
                                  "data-kind": item.kind,
                                  "data-state": item.state,
                                  "data-tone": tones.get(item.clusterId),
                                  "aria-label": describe(item, words),
                                  style: { left: bubble.x - bubble.r, top: bubble.y - bubble.r, inlineSize: bubble.r * 2, blockSize: bubble.r * 2 },
                                  onClick: () => {
                                      open(bubble.id)
                                  },
                                  onPointerEnter: (event: PointerEvent) => {
                                      if (event.pointerType === "mouse") setHover(bubble.id)
                                  },
                                  onPointerLeave: () => {
                                      setHover(null)
                                  },
                                  onFocus: () => {
                                      setHover(bubble.id)
                                  },
                                  onBlur: () => {
                                      setHover(null)
                                  },
                              },
                              item.state === undefined ? null : h(Glyph, { state: item.state }),
                          )
                      }),
                  ),
        ),
        // The name card of the hovered or focused bubble: the Grammar Tooltip, anchored above the bubble (HeroUI places and flips it), at the page's own size.
        h(AnchoredTooltip, {
            id: tipId,
            target: hover === null ? null : (canvas.current?.querySelector(`.starci-knowledge-bubble[data-id="${CSS.escape(hover)}"]`) ?? null),
            isOpen: hovered !== undefined,
            placement: "top",
            content:
                hovered === undefined
                    ? null
                    : h(
                          "span",
                          { className: "starci-knowledge-tip" },
                          h(Text, { role: "label.item" }, hovered.name),
                          h(Text, { role: "caption" }, [words.kindLabels?.[hovered.kind], words.weightLabel?.(hovered.weight)].filter((part): part is string => part !== undefined).join(" · ")),
                          hoveredSource === undefined ? null : h(Text, { role: "caption" }, `${props.sourceLabel === undefined ? "" : `${props.sourceLabel} `}${hoveredSource.name}`),
                      ),
        }),
    )
}

/**
 * The knowledge map of an app: topic clusters, a bubble for each item sized by its weight, a line from each item to the one it came from and one for each
 * link between two items (every pair drawn once). A bordered dot-grid panel with 40px zoom buttons (in, out, fit) and a legend; hover shows a bubble's name, a
 * click calls `onOpen(id)`. It opens fitted, never under the readable floor; on a phone the clusters stand two across, top-down. A finger drags it, pinches it
 * and double-taps it. The layout is seeded: the same clusters and items always stand in the same
 * places. Every word is the app's.
 */
export const KnowledgeMap = (props: KnowledgeMapProps): ReactElement => {
    const { clusters, items, label, isLoading = false, emptyLabel, legend } = props
    const columns = useLayoutDirection<"wide" | "phone">("wide", "phone") === "phone" ? PHONE_COLUMNS : undefined
    const layout = useMemo(() => layoutKnowledge(clusters, items, { links: props.links ?? [], ...(columns === undefined ? {} : { maxColumns: columns }) }), [clusters, items, props.links, columns])
    const tones = useMemo(() => toneOf(clusters), [clusters])

    const classes = props.className === undefined ? "starci-graph starci-knowledge" : `starci-graph starci-knowledge ${props.className}`
    const frame = { className: classes, role: "region", "aria-label": label }
    if (isLoading) return h("div", { ...frame, "aria-busy": true }, h(MapSkeleton))
    if (layout.bubbles.length === 0) return h("div", { ...frame, "data-empty": true }, emptyLabel === undefined ? null : h("p", { className: "starci-knowledge-empty" }, emptyLabel))

    return h("div", frame, h(MapView, { ...props, layout, tones }), legend === undefined || legend.length === 0 ? null : h(Legend, { items: legend }))
}
