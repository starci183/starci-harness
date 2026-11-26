"use client"

import { Background, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useStoreApi, type Edge, type EdgeTypes, type Node, type NodeChange, type NodeTypes } from "@xyflow/react"
import { createElement as h, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from "react"
import { structureKey } from "../build.js"
import { ISLANDS_WIDTH, estimateLabel, layoutFlow, type Bar, type Box, type FlowLayout, type LayoutSettings, type LinkEnds, type Measure, type SizedNode } from "../layout.js"
import { GraphSkeleton } from "./skeleton.js"
import { STYLE_RANK, dedupeRuns } from "./overlap.js"
import { useGraphScheme } from "./scheme.js"
import { clearOfControls, openView } from "./view.js"
import { FlowZoom, zoomWords } from "./zoom.js"
import type { GraphCanvasProps, GraphPosition, GraphPositions } from "../types.js"

/** Where the nodes stand once laid out, with the saved and the dragged positions over the automatic ones; a container's box comes from its children. */
export interface Placement {
    readonly positions: Readonly<Record<string, GraphPosition>>
    readonly boxes: Readonly<Record<string, Box>>
    readonly ports: Readonly<Record<string, GraphPosition>>
    /** The fork and merge bars of the layout, while every node stands where the layout put it (none once a person moved one). */
    readonly bars?: readonly Bar[]
}

/** A layout the canvas runs: ELK's `layoutFlow` by default, or the flow's spine layout. */
export type CanvasLayout = (sizes: readonly SizedNode[], links: readonly LinkEnds[], settings: LayoutSettings) => Promise<FlowLayout> | FlowLayout

let canvasContext: CanvasRenderingContext2D | null | undefined

/** The size of an edge label's box from the page's own font: the words at the caption size, 10px of padding each side, a 22px line. A page with no canvas gets the estimate. */
export const measureLabel: Measure = (text) => {
    if (typeof document === "undefined" || navigator.userAgent.includes("jsdom")) return estimateLabel(text)
    try {
        canvasContext ??= document.createElement("canvas").getContext("2d")
    } catch {
        canvasContext = null
    }
    if (canvasContext === null) return estimateLabel(text)
    // The label role the edge words are drawn in (label.field, 13px; src/common/ramps.css), read from the Grammar root, so the measure follows the theme.
    const page = getComputedStyle(document.querySelector(".grammar-common-root") ?? document.body)
    canvasContext.font = `${page.getPropertyValue("--grammar-weight-regular").trim()} ${page.getPropertyValue("--grammar-type-label-field-size").trim()} ${page.fontFamily}`
    return { width: Math.ceil(canvasContext.measureText(text).width) + 20, height: 22 }
}

/** The inset of the fitted and the first view, and their room on the left for the 40px zoom buttons (16 + 40 + 16). */
const FIT_INSET = 16
const CONTROLS_ROOM = 72
const px = (n: number): `${number}px` => `${String(n)}px` as `${number}px`
/** The fitted view, clear of the zoom buttons on the left: the fit button's, and the first view of a still picture (`interactive: false`) only. */
const FIT_OPTIONS = { padding: { top: px(FIT_INSET), right: px(FIT_INSET), bottom: px(FIT_INSET), left: px(CONTROLS_ROOM) }, minZoom: 0.15 } as const

/** What a graph hands the shared canvas: the sizes to lay out, its links, its drawn edges, and how its nodes are built once they have positions. */
export interface CanvasInput extends GraphCanvasProps {
    readonly sizes: readonly SizedNode[]
    readonly links: readonly LinkEnds[]
    readonly rfEdges: readonly Edge[]
    readonly makeNodes: (placement: Placement, selectedId: string | null) => Node[]
    /** Where each output port ended, by `portKey`. */
    readonly nodeTypes: NodeTypes
    readonly edgeTypes: EdgeTypes
    /** The node the first view is centred on when even the least fitted zoom (`LEAST_FIT`) cannot show the whole graph: the app's `focusId` over the mode's own choice. */
    readonly focusId?: string | undefined
    /** Drawn under the canvas (the legend). */
    readonly footer?: ReactNode
    /** The layout to run; default ELK's `layoutFlow`. */
    readonly runLayout?: CanvasLayout
    /**
     * The layout's routes are final (the spine layout): every edge is drawn on its route as given, ending as its route says (an arrow, a junction dot, or
     * nothing on a merge bar), and no shared stretch is cut short (`onceDrawn` is not run).
     */
    readonly routed?: boolean
}

interface Placed {
    readonly key: string
    readonly layout: FlowLayout
}

const NO_POSITIONS: GraphPositions = {}

/** The edges on ELK's routes with every shared stretch drawn once (the routing law, rule 6): the stronger state keeps it, the other meets it at a junction. */
const onceDrawn = (edges: readonly Edge[], routes: FlowLayout["routes"]): Edge[] => {
    const ranked = edges.flatMap((edge) => {
        const route = routes[edge.id]
        const style = (edge.data as { readonly style?: string } | undefined)?.style ?? "plain"
        return route === undefined || style === "back" ? [] : [{ id: edge.id, points: route.points, rank: STYLE_RANK[style] ?? 3 }]
    })
    const once = dedupeRuns(ranked)
    return edges.map((edge) => {
        const route = routes[edge.id]
        const drawn = once.get(edge.id)
        if (route === undefined) return edge
        return { ...edge, data: { ...edge.data, route: drawn === undefined ? route : { ...route, points: drawn.points }, joinStart: drawn?.joinStart === true, joinEnd: drawn?.joinEnd === true } }
    })
}

/** The edges on final routes: each as the layout drew it, its end as the route says. */
const asRouted = (edges: readonly Edge[], routes: FlowLayout["routes"]): Edge[] =>
    edges.map((edge) => {
        const route = routes[edge.id]
        if (route === undefined) return edge
        return { ...edge, data: { ...edge.data, route, joinStart: false, joinEnd: route.end === "join", bareEnd: route.end === "bar" } }
    })

/** The saved positions that still name a node of this graph. */
const known = (saved: GraphPositions, sizes: readonly SizedNode[]): GraphPositions => {
    const ids = new Set(sizes.map((size) => size.id))
    return Object.fromEntries(Object.entries(saved).filter(([id]) => ids.has(id)))
}

/** The height of a laid-out drawing in graph units: its top-level nodes from the highest top to the lowest bottom (a child sits inside its container's box). */
const contentHeight = (layout: FlowLayout, sizes: readonly SizedNode[]): number => {
    const tops = sizes.flatMap((node) => {
        const at = layout.positions[node.id]
        const box = layout.boxes[node.id]
        return node.parentId !== undefined || at === undefined || box === undefined ? [] : [[at.y, at.y + box.height] as const]
    })
    if (tops.length === 0) return 0
    return Math.max(...tops.map(([, bottom]) => bottom)) - Math.min(...tops.map(([top]) => top))
}

/** The first view's room round the graph: the zoom buttons on the left. */
const OPEN_INSETS = { top: FIT_INSET, right: FIT_INSET, bottom: FIT_INSET, left: CONTROLS_ROOM } as const

/** The first view, on every screen alike: the whole graph fitted (100% or less), centred (`openView`). */
const FocusStep = ({ id }: { readonly id: string | undefined }): null => {
    const flow = useReactFlow()
    const store = useStoreApi()
    // Every node measured (xyflow's useNodesInitialized stays false for nodes given a width and height).
    const ready = useStore((state) => state.nodeLookup.size > 0 && [...state.nodeLookup.values()].every((node) => (node.measured.width ?? 0) > 0))
    const measured = useStore((state) => state.width > 0 && state.height > 0)
    const opened = useRef(false)
    const later = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(
        () => () => {
            clearTimeout(later.current)
        },
        [],
    )
    useEffect(() => {
        if (!ready || !measured || opened.current) return
        const { width, height } = store.getState()
        const nodes = flow.getNodes()
        const node = (id === undefined ? undefined : flow.getNode(id)) ?? nodes[0]
        const internal = node === undefined ? undefined : flow.getInternalNode(node.id)
        if (internal === undefined) return
        opened.current = true
        const { x, y } = internal.internals.positionAbsolute
        const focus = { x, y, width: internal.measured.width ?? 0, height: internal.measured.height ?? 0 }
        const centred = openView({ width, height }, flow.getNodesBounds(nodes.filter((each) => each.parentId === undefined)), focus, OPEN_INSETS)
        // The zoom buttons cover no step at the first view: a step under them is moved off the start edge or below the bottom, the focus kept in view.
        const dom = store.getState().domNode
        const buttons = dom?.querySelector(".starci-graph-zoom")?.getBoundingClientRect()
        const pane = dom?.getBoundingClientRect()
        const parents = new Set(nodes.flatMap((each) => (each.parentId === undefined ? [] : [each.parentId])))
        const steps = nodes.flatMap((each) => {
            const inner = parents.has(each.id) ? undefined : flow.getInternalNode(each.id)
            return inner === undefined ? [] : [{ ...inner.internals.positionAbsolute, width: inner.measured.width ?? 0, height: inner.measured.height ?? 0 }]
        })
        // A fitted view keeps the buttons' room in its insets; only a graph shown at 100% that still overflows is moved clear of them.
        const view = buttons === undefined || pane === undefined || centred.zoom !== 1 ? centred : clearOfControls(centred, { width, height }, steps, focus, { x: buttons.left - pane.left, y: buttons.top - pane.top, width: buttons.width, height: buttons.height })
        // The pan and zoom handler may not be ready on the first frame: set it now and once more (kept when the effect runs again; cleared on unmount).
        void flow.setViewport(view)
        later.current = setTimeout(() => void flow.setViewport(view), 60)
        // Once per layout (the canvas is keyed by it), when its nodes and its frame are measured: a status change, a resize or a pan never moves it.
    }, [ready, measured, id, flow, store])
    return null
}

const Canvas = (props: CanvasInput): ReactElement => {
    const anchor = useRef<HTMLDivElement | null>(null)
    const scheme = useGraphScheme(anchor)
    const { sizes, links, rfEdges, makeNodes, nodeTypes, edgeTypes, label, direction = "LR", islands = "wrap", islandsWidth = ISLANDS_WIDTH, isLoading = false, emptyLabel, selectedId, onSelect, onNodePress } = props
    const editable = props.editable === true
    const interactive = props.interactive !== false
    const key = `${structureKey(sizes, links, direction, islands, islandsWidth)}${props.routed === true ? ":routed" : ""}`
    const [placed, setPlaced] = useState<Placed | undefined>(undefined)
    const [own, setOwn] = useState<string | null>(null)
    const [ownMoved, setOwnMoved] = useState<GraphPositions>(NO_POSITIONS)
    const [live, setLive] = useState<GraphPositions>(NO_POSITIONS)
    const selected = selectedId === undefined ? own : selectedId
    const moved = props.positions ?? ownMoved

    useEffect(() => {
        let current = true
        const run = props.runLayout ?? layoutFlow
        void Promise.resolve(run(sizes, links, { direction, islands, width: islandsWidth, measure: measureLabel })).then((layout) => {
            if (current) setPlaced({ key, layout })
        })
        return () => {
            current = false
        }
        // The layout depends on the structure (ids, sizes, ports, edge ends, direction, islands) only, never on a status or a label.
    }, [key])

    const select = (id: string | null): void => {
        if (selectedId === undefined) setOwn(id)
        onSelect?.(id)
    }
    const press = (id: string): void => {
        select(id)
        onNodePress?.(id)
    }
    const commit = (next: GraphPositions): void => {
        setOwnMoved(next)
        setLive(NO_POSITIONS)
        props.onPositionsChange?.(next)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            select(null)
            return
        }
        if (event.key !== "Enter" && event.key !== " ") return
        const target = event.target as Element
        if (target.closest("a") !== null) return // a link node owns Enter
        const id = target.closest(".react-flow__node")?.getAttribute("data-id")
        if (id !== null && id !== undefined) press(id)
    }
    const onNodesChange = (changes: NodeChange[]): void => {
        if (!editable) return
        const drag = changes.flatMap((change) => (change.type === "position" && change.position !== undefined ? [[change.id, change.position] as const] : []))
        if (drag.length > 0) setLive((current) => ({ ...current, ...Object.fromEntries(drag) }))
    }

    const classes = props.className === undefined ? "starci-graph" : `starci-graph ${props.className}`
    const frame = { className: classes, role: "region", "aria-label": label, ref: anchor }
    const ready = placed?.key === key ? placed.layout : undefined
    // `height="content"`: the frame hugs the drawing at 100% (the fit insets round it), capped by the theme's most; the CSS keeps its 20rem least.
    const hugs = props.height === "content"
    const drawnHeight = ready === undefined ? undefined : contentHeight(ready, sizes)
    // The canvas takes that height (a legend under it adds its own); the frame grows round both. The CSS clamps it (`[data-hugs]`, shared/styles.css).
    const frameHeight = hugs ? { style: { blockSize: "auto" } } : {}
    const canvasHeight = hugs && drawnHeight !== undefined ? { "data-hugs": true, style: { "--starci-graph-drawn-block-size": `${String(drawnHeight + 2 * FIT_INSET)}px` } as CSSProperties } : {}

    if (isLoading) return h("div", { ...frame, "aria-busy": true }, h(GraphSkeleton))
    if (sizes.length === 0) return h("div", { ...frame, "data-empty": true }, emptyLabel === undefined ? null : h("p", { className: "starci-graph-empty" }, emptyLabel))
    if (ready === undefined) return h("div", { ...frame, "aria-busy": true }, h(GraphSkeleton))

    const merged = { ...ready.positions, ...known(moved, sizes), ...live }
    // While every node stands where ELK put it the edges run on the routes ELK gave them; once a person moves one, they are drawn between the handles.
    const arranged = Object.keys(known(moved, sizes)).length === 0 && Object.keys(live).length === 0
    const nodes = makeNodes({ positions: merged, boxes: ready.boxes, ports: ready.ports, ...(arranged && ready.bars !== undefined ? { bars: ready.bars } : {}) }, selected).map((node) => ({ ...node, draggable: editable }))
    const controls =
        props.showControls === false || !interactive
            ? null
            : h(FlowZoom, {
                  words: zoomWords(props.ariaLabelConfig as Readonly<Record<string, string>> | undefined),
                  fitOptions: FIT_OPTIONS,
                  ...(editable && props.resetLabel !== undefined ? { reset: { label: props.resetLabel, onPress: () => { commit(NO_POSITIONS) } } } : {}),
              })

    return h(
        "div",
        { ...frame, ...frameHeight, "data-height": hugs ? "content" : undefined, "data-editable": editable ? "true" : undefined, onKeyDown },
        h(
            "div",
            { className: "starci-graph-canvas", ...canvasHeight },
            h(
                ReactFlow,
                {
                    key,
                    nodes,
                    edges: arranged ? (props.routed === true ? asRouted(rfEdges, ready.routes) : onceDrawn(rfEdges, ready.routes)) : [...rfEdges],
                    nodeTypes,
                    edgeTypes,
                    // Every graph opens fitted (FocusStep, `openView`): the whole graph, centred, never enlarged; a still picture too.
                    fitView: !interactive,
                    fitViewOptions: FIT_OPTIONS,
                    defaultViewport: { x: 0, y: 0, zoom: 1 },
                    minZoom: 0.1,
                    maxZoom: 2,
                    nodesDraggable: editable,
                    nodesConnectable: false,
                    elementsSelectable: false,
                    panOnDrag: interactive,
                    zoomOnScroll: interactive,
                    zoomOnPinch: interactive,
                    zoomOnDoubleClick: interactive,
                    preventScrolling: interactive,
                    onNodesChange,
                    onNodeDragStop: (_event: unknown, node: Node) => {
                        commit({ ...known(moved, sizes), ...live, [node.id]: node.position })
                    },
                    onNodeClick: (_event: unknown, node: Node) => {
                        // A fork or merge bar is drawing, not a step: it is never pressed.
                        if (node.type === "bar") return
                        press(node.id)
                    },
                    onPaneClick: () => {
                        select(null)
                    },
                    proOptions: { hideAttribution: true },
                    // xyflow's root class is a theme scope: it names the scheme the frame stands in, never a fixed light one.
                    colorMode: scheme,
                    ...(props.ariaLabelConfig === undefined ? {} : { ariaLabelConfig: props.ariaLabelConfig }),
                },
                h(Background, { gap: 22, size: 1.4, color: "var(--starci-graph-grid)" }),
                interactive ? h(FocusStep, { id: props.focusId }) : null,
                controls,
                props.minimap === true && interactive ? h(MiniMap, { pannable: true, zoomable: true, className: "starci-graph-minimap", ...(props.minimapLabel === undefined ? {} : { ariaLabel: props.minimapLabel }) }) : null,
            ),
        ),
        props.footer ?? null,
    )
}

/** The canvas both graphs share: laid out by ELK, panned and zoomed, fitted when it opens, selectable, draggable when `editable`, a skeleton while loading. */
export const GraphCanvas = (props: CanvasInput): ReactElement => h(ReactFlowProvider, null, h(Canvas, props))
