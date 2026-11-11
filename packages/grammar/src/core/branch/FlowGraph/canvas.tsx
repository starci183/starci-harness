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
/** The margin a steps graph keeps inside its pane, in screen pixels (12 since 0.37.35: a linear 5-step map and its end pill fit the 1160 well at >= 0.95). */
const STEPS_FIT_MARGIN = 12
/** The strip the zoom controls cover at the canvas's start edge (the control column 2rem + the panel's margin): a fit keeps every node out of it (0.37.11). */
export const CONTROLS_INSET = 56
/**
 * THE READABLE FLOOR OF A CONTAINED FIT (0.37.26). A contained fit (every `steps` graph, any `fit="contain"`) never shrinks below this zoom (0.6 in 0.37.26; 0.8 since
 * 0.37.29, owner "Nâng 0.8"): a 12px node label stays about 10px or more and a 14px title about 11px, wide graphs on a desktop pane pan too, never the 0.17 speck a wide branching graph fell to at 390 or in a drawer. A graph that would need less is drawn at
 * this zoom and the reader pans it (drag; the canvas pans even when the graph is otherwise static); the first view shows the entry node.
 */
export const CONTAIN_MIN_ZOOM = 0.8
/** The most tall a floored steps canvas grows when no `height` caps it (screen pixels, the `lg` step): the rest is reached by panning. */
const FLOORED_HEIGHT_CAP = 512
/**
 * THE OPENING ZOOM OF A STEPS GRAPH (0.37.33, owner drawing graph-state, law DNA-COMMON-FLOW-OPEN-ZOOM). A step card reads at zoom 1 (176 x 64 since 0.37.35, title 14, line 12).
 * On open the graph is fitted when it fits at {@link STEPS_OPEN_FIT_MIN} or more (never magnified past 1; a linear 5-step graph and its end pill in the 1160px workflow map well
 * fits at about 0.96); otherwise it opens at zoom 1 anchored at its entry node and the reader pans. At a narrow canvas (<= {@link STEPS_NARROW_WIDTH}) it opens at
 * {@link CONTAIN_MIN_ZOOM} (0.8) the same way. The least zoom (the zoom-out button, a pinch) stays {@link CONTAIN_MIN_ZOOM}.
 */
export const STEPS_OPEN_ZOOM = 1
/** The least fitted zoom a steps graph opens at on a wide canvas: a fit that needs less opens at zoom 1 and pans. */
export const STEPS_OPEN_FIT_MIN = 0.95
/** The canvas width at or under which a steps graph opens at {@link CONTAIN_MIN_ZOOM} (a phone). */
export const STEPS_NARROW_WIDTH = 480
/** The gap kept between the zoom controls column and a graph that would stand beside it. */
const CONTROLS_CLEARANCE = 8

export const Refit = ({ signature, readableZoom, onGrow, fitOptions, maxZoom, anchorStart, stepsFit, inset = 0, heightCap = null, containFloor = null, onFloor, direction = "TB", fixedHeight = false }: {
    /** `height="fill"` (0.37.33): the canvas height is the page's rest, never grown or shrunk to the graph; the graph is placed in it. */
    readonly fixedHeight?: boolean
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
            // The opening zoom (0.37.33, DNA-COMMON-FLOW-OPEN-ZOOM): fitted when the fit reads (>= 0.95 wide, >= 0.8 narrow), else zoom 1 (0.8 narrow) at the entry, panned.
            const isNarrow = width <= STEPS_NARROW_WIDTH
            const floor = Math.max(containFloor ?? STEPS_MIN_ZOOM, STEPS_MIN_ZOOM)
            const openZoom = Math.min(isNarrow ? floor : STEPS_OPEN_ZOOM, maxZoom)
            const fitMin = Math.min(isNarrow ? floor : STEPS_OPEN_FIT_MIN, openZoom)
            const cap = fixedHeight ? height : heightCap
            const place = (startInset: number) => {
                const start = STEPS_FIT_MARGIN + startInset
                const room = width - start - STEPS_FIT_MARGIN
                let fitZoom = Math.min(room / bounds.width, maxZoom)
                if (cap !== null) fitZoom = Math.min(fitZoom, (cap - 2 * STEPS_FIT_MARGIN) / bounds.height)
                const floored = fitZoom < fitMin
                return { start, room, floored, zoom: floored ? openZoom : fitZoom }
            }
            // On each axis: a graph that fits the window is centred in it (the room the controls leave, the canvas height); one that does not (opened at zoom 1, or
            // taller than a capped canvas) starts at the entry node (the first along the flow: the top one for TB, the leftmost for LR), centred when the graph's
            // edges allow, never leaving an empty band at a side.
            const entry = getNodes().reduce((first, node) => (direction === "LR" ? node.position.x < first.position.x : node.position.y < first.position.y) ? node : first)
            const axis = (zoom: number, entryAt: number, low: number, size: number, min: number, length: number): number => length * zoom <= size + 0.5
                ? low + (size - length * zoom) / 2 - min * zoom
                : Math.max(Math.min(low + size / 2 - entryAt * zoom, low - min * zoom), low + size - (min + length) * zoom)
            // The zoom controls column covers a strip of the canvas's start edge: the graph keeps clear of it only where it would stand beside it. A graph
            // centred in a tall frame (`height="fill"`) passes by the column and takes the whole width.
            const canvasBox = domNode?.getBoundingClientRect()
            const controlsBox = controlsElement?.getBoundingClientRect()
            const controlsTop = controlsBox === undefined || canvasBox === undefined ? 0 : controlsBox.top - canvasBox.top - CONTROLS_CLEARANCE
            const controlsBottom = controlsBox === undefined || canvasBox === undefined ? 0 : controlsBox.bottom - canvasBox.top + CONTROLS_CLEARANCE
            const free = place(0)
            const freeHeight = fixedHeight ? height : Math.max(Math.ceil(bounds.height * free.zoom + 2 * STEPS_FIT_MARGIN), controlsMin)
            const freeY = axis(free.zoom, entry.position.y, STEPS_FIT_MARGIN, freeHeight - 2 * STEPS_FIT_MARGIN, bounds.y, bounds.height)
            const graphTop = freeY + bounds.y * free.zoom
            const graphBottom = graphTop + bounds.height * free.zoom
            const clearsControls = inset === 0 || controlsElement === null || graphBottom <= controlsTop || graphTop >= controlsBottom
            const chosen = clearsControls ? free : place(inset)
            onFloor?.(chosen.floored)
            if (!fixedHeight) {
                const graphHeight = Math.ceil(bounds.height * chosen.zoom + 2 * STEPS_FIT_MARGIN)
                const wanted = Math.max(chosen.floored ? Math.min(graphHeight, heightCap ?? FLOORED_HEIGHT_CAP) : graphHeight, controlsMin)
                if (Math.abs(wanted - height) > 1) {
                    onGrow(wanted)
                    return
                }
            }
            const x = axis(chosen.zoom, entry.position.x, chosen.start, chosen.room, bounds.x, bounds.width)
            const y = axis(chosen.zoom, entry.position.y, STEPS_FIT_MARGIN, height - 2 * STEPS_FIT_MARGIN, bounds.y, bounds.height)
            void setViewport({ x, y, zoom: chosen.zoom }, { duration: 0 })
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
    }, [fitView, getNodes, getNodesBounds, setViewport, isReady, signature, readableZoom, width, height, onGrow, fitOptions, maxZoom, anchorStart, stepsFit, inset, heightCap, containFloor, onFloor, domNode, direction, fixedHeight])
    return null
}

export const labelFor = (node: { readonly label: string, readonly count?: number | string }) => node.count === undefined || node.count === "" ? node.label : `${node.label} (${node.count})`

/** The labelled edges as "source → target: label", for the screen-reader list; an unlabelled edge adds nothing to read. */
export const labelledEdges = (nodes: ReadonlyArray<{ readonly id: string, readonly label: string }>, edges: ReadonlyArray<{ readonly id: string, readonly source: string, readonly target: string, readonly label?: string }>) => {
    const names = new Map(nodes.map((node) => [node.id, node.label]))
    return edges.flatMap((edge) => edge.label === undefined || edge.label === "" ? [] : [{ id: edge.id, text: `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}: ${edge.label}` }])
}

