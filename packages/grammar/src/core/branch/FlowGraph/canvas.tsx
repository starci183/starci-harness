"use client"

import { useReactFlow, useStore } from "@xyflow/react"
import { useEffect } from "react"
import type { FlowGraphNodeSize } from "./types.js"

/** What the readable zoom needs of a node: its size step, and whether it is a bubble (whose text keeps one screen size). */
export type ZoomNode = { readonly size?: FlowGraphNodeSize, readonly form?: "label" | "bubble" }

/** The pieces of a React Flow canvas that `FlowGraph` and `BubbleMap` share: the fit, the readable zoom and the screen-reader lists. */

export const FIT_OPTIONS = { padding: 0.2, duration: 0 } as const
/** A lanes graph is laid out to fill its canvas, so its fit keeps a small margin and never magnifies. */
export const LANES_FIT_OPTIONS = { padding: 0.04, duration: 0 } as const
export const LANES_MAX_ZOOM = 1

export const MAX_ZOOM = 2

/** The smallest node text, in px at zoom 1, per node size (the node CSS: sm 0.75rem, md 0.875rem, lg 1rem). */
const NODE_TEXT_PX = { sm: 12, md: 14, lg: 16 } as const
/** Node text never renders below this many px under the `readable` fit. */
const READABLE_TEXT_PX = 12

/**
 * The zoom at which the smallest node text present renders at {@link READABLE_TEXT_PX}; null when no node carries label text
 * (a bubble keeps its text at a fixed screen size instead, see {@link ZoomMirror}).
 */
export const readableZoomFor = (nodes: ReadonlyArray<ZoomNode>): number | null => {
    const labelled = nodes.filter((node) => node.form !== "bubble")
    return labelled.length === 0 ? null : READABLE_TEXT_PX / Math.min(...labelled.map((node) => NODE_TEXT_PX[node.size ?? "md"]))
}

/** Below these zooms a bubble's caption and mark no longer fit its disc at the fixed screen size, and drop out. */
export const CAPTION_ZOOM = 0.42
export const MARK_ZOOM = 0.5

/** Reports the viewport zoom (two decimals) so the figure can publish `--starci-flow-zoom` to the bubbles' text. */
export const ZoomMirror = ({ onZoom }: { readonly onZoom: (zoom: number) => void }) => {
    const zoom = useStore((state) => Math.round(state.transform[2] * 100) / 100)
    useEffect(() => { onZoom(zoom) }, [zoom, onZoom])
    return null
}

/**
 * Re-fits the viewport once the nodes are measured, and again whenever the set of nodes, the layout or the canvas size
 * changes. Under a readable zoom, a fit that would go below it asks the canvas to grow to the graph's aspect at the
 * canvas width first, then fits with the readable zoom as the floor.
 */
/**
 * A steps graph (top-down) is always CONTAINED (0.37.20, owner: the fit shows every node): it fits the pane width, never magnifies, and the canvas height
 * follows the graph at that scale (capped by a named or numeric `height` under `fit="contain"`). Before 0.37.20 a graph wider than the pane at 0.75 held that
 * scale and started at the trigger, which clipped the first and last columns. This is the floor of the zoom itself, the canvas `minZoom`.
 */
export const STEPS_MIN_ZOOM = 0.1
/** The margin a steps graph keeps inside its pane, in screen pixels. */
const STEPS_FIT_MARGIN = 16
/** The strip the zoom controls cover at the canvas's start edge (the control column 2rem + the panel's margin): a fit keeps every node out of it (0.37.11). */
export const CONTROLS_INSET = 56
/**
 * THE READABLE FLOOR OF A CONTAINED FIT (0.37.26). A contained fit (every `steps` graph, any `fit="contain"`) never shrinks below this zoom: a 12px node label stays
 * about 7px or more and a 14px title about 8.5px, never the 0.17 speck a wide branching graph fell to at 390 or in a drawer. A graph that would need less is drawn at
 * this zoom and the reader pans it (drag; the canvas pans even when the graph is otherwise static); the first view shows the entry node.
 */
export const CONTAIN_MIN_ZOOM = 0.6
/** The most tall a floored steps canvas grows when no `height` caps it (screen pixels, the `lg` step): the rest is reached by panning. */
const FLOORED_HEIGHT_CAP = 512

export const Refit = ({ signature, readableZoom, onGrow, fitOptions, maxZoom, anchorStart, stepsFit, inset = 0, heightCap = null, containFloor = null, onFloor, direction = "TB" }: {
    /** The way a steps graph flows (0.37.27: LR by default): its entry node is the top one for TB, the leftmost for LR. */
    readonly direction?: "TB" | "LR"
    /** The least zoom a contained fit takes ({@link CONTAIN_MIN_ZOOM}); null = none (the readable fit has its own floor, a BubbleMap none). */
    readonly containFloor?: number | null
    /** Told whether the fit is held at `containFloor` (the graph is bigger than its canvas there and pans). */
    readonly onFloor?: (floored: boolean) => void
    /** `fit="contain"` with a named or numeric `height`: the most tall a steps canvas grows (screen pixels); null = no cap. */
    readonly heightCap?: number | null
    /** The strip at the start edge that the zoom controls cover: the fit leaves it empty, so no node is drawn under the controls. */
    readonly inset?: number
    /**
     * A `steps` graph (0.36.2; both directions since 0.37.27): fit to the pane width with a margin and contain every node (0.37.20), never below the readable
     * floor (0.37.26), and let the reader pan. The canvas height follows the graph at that scale, so no empty band stands above it.
     */
    readonly stepsFit?: boolean
    readonly signature: string
    readonly fitOptions: typeof FIT_OPTIONS | typeof LANES_FIT_OPTIONS
    readonly maxZoom: number
    /** A graph wider than its canvas at the readable zoom starts at its first column instead of its middle. */
    readonly anchorStart: boolean
    readonly readableZoom: number | null
    readonly onGrow: (height: number) => void
}) => {
    const { fitView, getNodes, getNodesBounds, setViewport } = useReactFlow()
    // React Flow's useNodesInitialized waits for every node's handle bounds, and a layer header has no handles, so it
    // never turned true for a graph with headers and the re-fit never ran. Ready means every node has been measured.
    const isReady = useStore((state) => state.nodeLookup.size > 0 && [...state.nodeLookup.values()].every((node) => (node.measured.width ?? 0) > 0))
    const width = useStore((state) => state.width)
    const height = useStore((state) => state.height)
    const domNode = useStore((state) => state.domNode)
    useEffect(() => {
        if (!isReady || width === 0 || height === 0) return
        // CONTROLS-INSIDE (0.37.26): the canvas is never shorter than the zoom controls column and its inset above and below, so the column never pokes out.
        const controlsElement = domNode?.querySelector<HTMLElement>(".starci-core-flow-graph-controls") ?? null
        const controlsStyle = controlsElement === null ? null : getComputedStyle(controlsElement)
        const controlsMin = controlsElement === null || controlsStyle === null
            ? 0
            : Math.ceil(controlsElement.offsetHeight + Number.parseFloat(controlsStyle.marginTop) + Number.parseFloat(controlsStyle.marginBottom))
        const side = Math.round(fitOptions.padding * Math.min(width, height))
        const px = (value: number): `${number}px` => `${value}px`
        const insetOptions = inset === 0 ? fitOptions : { ...fitOptions, padding: { top: px(side), right: px(side), bottom: px(side), left: px(side + inset) } }
        if (stepsFit === true) {
            const bounds = getNodesBounds(getNodes())
            if (bounds.width === 0 || bounds.height === 0) return
            const start = STEPS_FIT_MARGIN + inset
            const room = width - start - STEPS_FIT_MARGIN
            let fitZoom = Math.min(room / bounds.width, maxZoom)
            if (heightCap !== null) fitZoom = Math.min(fitZoom, (heightCap - 2 * STEPS_FIT_MARGIN) / bounds.height)
            const floor = Math.max(containFloor ?? STEPS_MIN_ZOOM, STEPS_MIN_ZOOM)
            const floored = fitZoom < floor
            const zoom = Math.max(fitZoom, floor)
            onFloor?.(floored)
            const graphHeight = Math.ceil(bounds.height * zoom + 2 * STEPS_FIT_MARGIN)
            const wanted = Math.max(floored ? Math.min(graphHeight, heightCap ?? FLOORED_HEIGHT_CAP) : graphHeight, controlsMin)
            if (Math.abs(wanted - height) > 1) {
                onGrow(wanted)
                return
            }
            // On each axis: a graph that fits the window is centred in it (the room the controls leave, the canvas height); one that does not (held at the floor, or
            // taller than a capped canvas) starts at the entry node (the first along the flow: the top one for TB, the leftmost for LR), centred when the graph's
            // edges allow, never leaving an empty band at a side.
            const entry = getNodes().reduce((first, node) => (direction === "LR" ? node.position.x < first.position.x : node.position.y < first.position.y) ? node : first)
            const axis = (entryAt: number, low: number, size: number, min: number, length: number): number => length * zoom <= size + 0.5
                ? low + (size - length * zoom) / 2 - min * zoom
                : Math.max(Math.min(low + size / 2 - entryAt * zoom, low - min * zoom), low + size - (min + length) * zoom)
            const x = axis(entry.position.x, start, room, bounds.x, bounds.width)
            const y = axis(entry.position.y, STEPS_FIT_MARGIN, height - 2 * STEPS_FIT_MARGIN, bounds.y, bounds.height)
            void setViewport({ x, y, zoom }, { duration: 0 })
            return
        }
        if (readableZoom === null) {
            if (containFloor !== null) {
                // A contained fit holds the readable floor; a graph bigger than the canvas there is centred and panned.
                const bounds = getNodesBounds(getNodes())
                const pad = 1 + 2 * fitOptions.padding
                const fitZoom = bounds.width === 0 || bounds.height === 0 ? maxZoom : Math.min((width - inset) / (bounds.width * pad), height / (bounds.height * pad), maxZoom)
                onFloor?.(fitZoom < containFloor)
                if (controlsMin > height + 1) {
                    onGrow(controlsMin)
                    return
                }
                void fitView({ ...insetOptions, minZoom: containFloor })
                return
            }
            void fitView(insetOptions)
            return
        }
        const bounds = getNodesBounds(getNodes())
        if (bounds.width === 0 || bounds.height === 0) return
        const pad = 1 + 2 * fitOptions.padding
        const zoomAtWidth = Math.min((width - inset) / (bounds.width * pad), maxZoom)
        const fitZoom = Math.min(zoomAtWidth, height / (bounds.height * pad))
        if (anchorStart && fitZoom < readableZoom) {
            void setViewport({ x: 16 + inset - bounds.x * readableZoom, y: 16 - bounds.y * readableZoom, zoom: readableZoom }, { duration: 0 })
            return
        }
        if (fitZoom < readableZoom) {
            const needed = Math.ceil(bounds.height * pad * Math.max(readableZoom, zoomAtWidth))
            if (needed > height + 1) {
                onGrow(needed)
                return
            }
        }
        void fitView({ ...insetOptions, minZoom: readableZoom })
    }, [fitView, getNodes, getNodesBounds, setViewport, isReady, signature, readableZoom, width, height, onGrow, fitOptions, maxZoom, anchorStart, stepsFit, inset, heightCap, containFloor, onFloor, domNode, direction])
    return null
}

export const labelFor = (node: { readonly label: string, readonly count?: number | string }) => node.count === undefined || node.count === "" ? node.label : `${node.label} (${node.count})`

/** The labelled edges as "source → target: label", for the screen-reader list; an unlabelled edge adds nothing to read. */
export const labelledEdges = (nodes: ReadonlyArray<{ readonly id: string, readonly label: string }>, edges: ReadonlyArray<{ readonly id: string, readonly source: string, readonly target: string, readonly label?: string }>) => {
    const names = new Map(nodes.map((node) => [node.id, node.label]))
    return edges.flatMap((edge) => edge.label === undefined || edge.label === "" ? [] : [{ id: edge.id, text: `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}: ${edge.label}` }])
}

