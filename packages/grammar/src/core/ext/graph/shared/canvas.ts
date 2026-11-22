"use client"

import { Background, MiniMap, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, useStore, type Edge, type EdgeTypes, type Node, type NodeChange, type NodeTypes } from "@xyflow/react"
import { createElement as h, useEffect, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react"
import { structureKey } from "../build.js"
import { ISLANDS_WIDTH, estimateLabel, layoutFlow, type Box, type FlowLayout, type LinkEnds, type Measure, type SizedNode } from "../layout.js"
import { GraphSkeleton } from "./skeleton.js"
import { usePhone } from "./touch.js"
import { FlowZoom, zoomWords } from "./zoom.js"
import type { GraphCanvasProps, GraphPosition, GraphPositions } from "../types.js"

/** Where the nodes stand once laid out, with the saved and the dragged positions over the automatic ones; a container's box comes from its children. */
export interface Placement {
    readonly positions: Readonly<Record<string, GraphPosition>>
    readonly boxes: Readonly<Record<string, Box>>
    readonly ports: Readonly<Record<string, GraphPosition>>
}

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

/** The fitted view's inset, and its room on the left for the 40px zoom buttons (16 + 40 + 16). */
const FIT_INSET = 16
const CONTROLS_ROOM = 72
const px = (n: number): `${number}px` => `${String(n)}px` as `${number}px`
/** The fitted view: clear of the zoom buttons on the left, on load and on the fit button. */
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
    /** The node a phone's first view is centred on, at 100%. */
    readonly focusId?: string | undefined
    /** Drawn under the canvas (the legend). */
    readonly footer?: ReactNode
}

interface Placed {
    readonly key: string
    readonly layout: FlowLayout
}

const NO_POSITIONS: GraphPositions = {}

/** The saved positions that still name a node of this graph. */
const known = (saved: GraphPositions, sizes: readonly SizedNode[]): GraphPositions => {
    const ids = new Set(sizes.map((size) => size.id))
    return Object.fromEntries(Object.entries(saved).filter(([id]) => ids.has(id)))
}

/** The x of a step's centre at a phone's first view: clear of the 40px zoom buttons (12px in, 8px clear) with room for a 280px card. */
const PHONE_CENTRE = 200

/** Where a phone's first view stands before the nodes are measured: 100%, the step's centre at `PHONE_CENTRE`, the step a third of the way down. */
const startView = (nodes: readonly Node[], id: string | undefined): { readonly x: number; readonly y: number; readonly zoom: number } => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const target = (id === undefined ? undefined : byId.get(id)) ?? nodes[0]
    let x = 0
    let y = 0
    for (let at: Node | undefined = target; at !== undefined; at = at.parentId === undefined ? undefined : byId.get(at.parentId)) {
        x += at.position.x
        y += at.position.y
    }
    return { x: PHONE_CENTRE - x - 140, y: 200 - y, zoom: 1 }
}

/** On a phone the first view is the graph at 100%, on one step, to the right of the zoom buttons (never fitted to the width). */
const FocusStep = ({ id }: { readonly id: string | undefined }): null => {
    const flow = useReactFlow()
    const ready = useNodesInitialized()
    const height = useStore((state) => state.height)
    useEffect(() => {
        if (!ready) return
        const node = id === undefined ? flow.getNodes()[0] : flow.getNode(id)
        const internal = node === undefined ? undefined : flow.getInternalNode(node.id)
        if (internal === undefined) return
        const { x, y } = internal.internals.positionAbsolute
        // At 100%, vertically on the step, its centre where a full-width card clears the zoom buttons.
        const view = { x: PHONE_CENTRE - x - (internal.measured.width ?? 0) / 2, y: height / 2 - (y + (internal.measured.height ?? 0) / 2), zoom: 1 }
        // The pan and zoom handler may not be ready on the first frame: set it now and once more.
        void flow.setViewport(view)
        const later = setTimeout(() => void flow.setViewport(view), 60)
        return () => {
            clearTimeout(later)
        }
    }, [ready, id, flow, height])
    return null
}

const Canvas = (props: CanvasInput): ReactElement => {
    const phone = usePhone()
    const { sizes, links, rfEdges, makeNodes, nodeTypes, edgeTypes, label, direction = "LR", islands = "wrap", islandsWidth = ISLANDS_WIDTH, isLoading = false, emptyLabel, selectedId, onSelect, onNodePress } = props
    const editable = props.editable === true
    const interactive = props.interactive !== false
    const key = structureKey(sizes, links, direction, islands, islandsWidth)
    const [placed, setPlaced] = useState<Placed | undefined>(undefined)
    const [own, setOwn] = useState<string | null>(null)
    const [ownMoved, setOwnMoved] = useState<GraphPositions>(NO_POSITIONS)
    const [live, setLive] = useState<GraphPositions>(NO_POSITIONS)
    const selected = selectedId === undefined ? own : selectedId
    const moved = props.positions ?? ownMoved

    useEffect(() => {
        let current = true
        void layoutFlow(sizes, links, { direction, islands, width: islandsWidth, measure: measureLabel }).then((layout) => {
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
    const frame = { className: classes, role: "region", "aria-label": label }
    const ready = placed?.key === key ? placed.layout : undefined

    if (isLoading) return h("div", { ...frame, "aria-busy": true }, h(GraphSkeleton))
    if (sizes.length === 0) return h("div", { ...frame, "data-empty": true }, emptyLabel === undefined ? null : h("p", { className: "starci-graph-empty" }, emptyLabel))
    if (ready === undefined) return h("div", { ...frame, "aria-busy": true }, h(GraphSkeleton))

    const merged = { ...ready.positions, ...known(moved, sizes), ...live }
    // While every node stands where ELK put it the edges run on the routes ELK gave them; once a person moves one, they are drawn between the handles.
    const arranged = Object.keys(known(moved, sizes)).length === 0 && Object.keys(live).length === 0
    const nodes = makeNodes({ positions: merged, boxes: ready.boxes, ports: ready.ports }, selected).map((node) => ({ ...node, draggable: editable }))
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
        { ...frame, "data-editable": editable ? "true" : undefined, onKeyDown },
        h(
            "div",
            { className: "starci-graph-canvas" },
            h(
                ReactFlow,
                {
                    key,
                    nodes,
                    edges: arranged ? rfEdges.map((edge) => ({ ...edge, data: { ...edge.data, route: ready.routes[edge.id] } })) : [...rfEdges],
                    nodeTypes,
                    edgeTypes,
                    fitView: !phone,
                    // The zoom buttons (40px, bottom left) keep clear of the graph: the view leaves room for them on the left.
                    fitViewOptions: FIT_OPTIONS,
                    ...(phone ? { defaultViewport: startView(nodes, props.focusId) } : {}),
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
                        press(node.id)
                    },
                    onPaneClick: () => {
                        select(null)
                    },
                    proOptions: { hideAttribution: true },
                    ...(props.ariaLabelConfig === undefined ? {} : { ariaLabelConfig: props.ariaLabelConfig }),
                },
                h(Background, { gap: 22, size: 1.4, color: "var(--border)" }),
                phone ? h(FocusStep, { id: props.focusId }) : null,
                controls,
                props.minimap === true && interactive ? h(MiniMap, { pannable: true, zoomable: true, className: "starci-graph-minimap", ...(props.minimapLabel === undefined ? {} : { ariaLabel: props.minimapLabel }) }) : null,
            ),
        ),
        props.footer ?? null,
    )
}

/** The canvas both graphs share: laid out by ELK, panned and zoomed, fitted on load, selectable, draggable when `editable`, a skeleton while loading. */
export const GraphCanvas = (props: CanvasInput): ReactElement => h(ReactFlowProvider, null, h(Canvas, props))
