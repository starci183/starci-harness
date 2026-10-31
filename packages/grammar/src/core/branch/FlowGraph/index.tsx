"use client"

import {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlow,
    useReactFlow,
    useStore,
    type Edge,
    type Node,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react"
import { Link as RouterLink } from "react-aria-components"
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react"
import { Skeleton } from "../../primitive/Skeleton/index.js"
import {
    FLOW_GRAPH_NODE_MAX_WIDTH,
    flowGraphBubbleDiameter,
    flowGraphRoot,
    layerCoordinate,
    layeredPositions,
    layeredStepPosition,
    orbitLayout,
    radialPositions,
    type OrbitLayout,
} from "./layout.js"
import type { FlowGraphDirection, FlowGraphEdge, FlowGraphFill, FlowGraphHeight, FlowGraphLayerHeader, FlowGraphLayout, FlowGraphNode, FlowGraphRingPart, FlowGraphTone } from "./types.js"

export { flowGraphDiameter, layeredPositions, orbitLayout, radialPositions } from "./layout.js"
export type { FlowGraphDirection, FlowGraphEdge, FlowGraphFill, FlowGraphHeight, FlowGraphLayerHeader, FlowGraphLayout, FlowGraphNode, FlowGraphNodeForm, FlowGraphNodeShape, FlowGraphNodeSize, FlowGraphRingPart, FlowGraphTone } from "./types.js"

export type FlowGraphProps = {
    /** Names the graph for assistive technology, e.g. "Second brain". */
    readonly label: string
    readonly nodes: ReadonlyArray<FlowGraphNode>
    readonly edges: ReadonlyArray<FlowGraphEdge>
    /**
     * The selected node. Pass it (with `onSelect`) to control selection; leave it out and the graph keeps its own. The node stamps
     * `data-grammar-selected` and the screen-reader list reports it. A bubble draws a selected outline, and in `orbit` the edges
     * from the root to the selected node draw strong; HeroUI has no graph node, so a pill draws none.
     */
    readonly selectedId?: string | null
    /** Fires with the node id on click, Enter or Space, and with `null` when the empty canvas is clicked or Escape is pressed. */
    readonly onSelect?: (id: string | null) => void
    /**
     * Canvas height: `sm` 16rem, `md` 24rem, `lg` 32rem, or any size of your own: a number is pixels, a string is a CSS length
     * (`"60vh"`, `"48rem"`).
     */
    readonly height?: FlowGraphHeight | number | string
    /**
     * How the graph meets its canvas. `readable` (default) never fits below the zoom at which node text renders at 12px:
     * a graph that would shrink further grows the canvas height to the graph's aspect at the canvas width (the page
     * scrolls; a graph still too wide pans sideways). `contain` always shrinks the whole graph into the canvas `height`.
     */
    readonly fit?: "readable" | "contain"
    /** Pan and zoom. `false` draws a static picture. */
    readonly isInteractive?: boolean
    /** Zoom buttons. Defaults to on while the graph is interactive. */
    readonly showControls?: boolean
    /**
     * `radial` places the nodes on rings round the root; `layered` puts a DAG in layers along `direction`; `manual` uses each
     * node's `position`; `orbit` is the value-sized map of bubbles (see `expandedIds`). Defaults to `radial`, or to `layered`
     * when a `direction` is given.
     */
    readonly layout?: FlowGraphLayout
    /**
     * `orbit` only: the ring-three nodes that are open. A node's children past ring three show only while it is open, on ring
     * four. Pass it (with `onExpandedChange`) to control it; leave it out and the graph keeps its own, from `defaultExpandedIds`.
     */
    readonly expandedIds?: ReadonlyArray<string>
    readonly defaultExpandedIds?: ReadonlyArray<string>
    /** Fires with the open ids when a node opens or closes: on click, or on Enter or Space, of a node that holds more. */
    readonly onExpandedChange?: (ids: ReadonlyArray<string>) => void
    /** `orbit` only: the most nodes one open fan draws (default 30). The rest fold into a `+n` bubble that selects the parent. */
    readonly fanLimit?: number
    /**
     * The way edges run, `TB` (top to bottom) or `LR` (left to right). It places the target handle on the entering side and the
     * source handle on the leaving side so edges follow the layout. Leave it out for the radial layout (both handles on top).
     */
    readonly direction?: FlowGraphDirection
    /** Titles for the layers of a layered layout: a column header above each layer for `LR`, a lane header beside it for `TB`. */
    readonly headers?: ReadonlyArray<FlowGraphLayerHeader>
    /** Shown instead of the canvas when there are no nodes. */
    readonly emptyLabel?: string
    /** Unresolved graph (knowledge STATE-8): the frame at its height with a Skeleton block, no React Flow mounted, `aria-busy`. */
    readonly isLoading?: boolean
    readonly className?: string
}

type NodeData = {
    readonly graphNode: FlowGraphNode
    readonly isSelected: boolean
    readonly direction?: FlowGraphDirection
    /** The node holds deeper nodes that show while it is open (orbit). */
    readonly isExpandable?: boolean
    readonly [key: string]: unknown
}

type GuideData = {
    readonly radii: ReadonlyArray<number>
    readonly size: number
    readonly [key: string]: unknown
}

/** The longest mark a bubble draws, in characters. */
const MARK_LENGTH = 4

/** The token each ring arc and bubble tone paints from, with the fallback the sheet uses outside a root. */
const TONE_PAINT: Record<FlowGraphTone, string> = {
    neutral: "var(--muted, GrayText)",
    accent: "var(--accent, Highlight)",
    success: "var(--success, CanvasText)",
    warning: "var(--warning, CanvasText)",
    danger: "var(--danger, CanvasText)",
    info: "var(--info, CanvasText)",
    muted: "color-mix(in oklab, var(--muted, GrayText) 55%, transparent)",
}

/** A conic gradient of the ring arcs, clockwise from the top; undefined when the arcs hold nothing. */
const ringGradient = (ring: ReadonlyArray<FlowGraphRingPart>): string | undefined => {
    const total = ring.reduce((sum, part) => sum + Math.max(part.value, 0), 0)
    if (total <= 0) return undefined
    let at = 0
    const stops = ring.filter((part) => part.value > 0).map((part) => {
        const next = at + part.value / total * 100
        const stop = `${TONE_PAINT[part.tone]} ${at.toFixed(2)}% ${next.toFixed(2)}%`
        at = next
        return stop
    })
    return `conic-gradient(${stops.join(", ")})`
}

const fillOf = (node: FlowGraphNode): FlowGraphFill | undefined => node.fill ?? (node.form === "bubble" ? "soft" : undefined)

type HeaderData = {
    readonly label: string
    readonly direction: FlowGraphDirection
    readonly [key: string]: unknown
}

const HANDLE_SIDES = {
    radial: { target: Position.Top, source: Position.Top },
    TB: { target: Position.Top, source: Position.Bottom },
    LR: { target: Position.Left, source: Position.Right },
} as const

const FlowGraphNodeView = memo(({ data }: NodeProps<Node<NodeData>>) => {
    const { graphNode, isSelected, direction } = data
    const sides = HANDLE_SIDES[direction ?? "radial"]
    const hasCount = graphNode.count !== undefined && graphNode.count !== ""
    const isBubble = graphNode.form === "bubble"
    const ring = isBubble && graphNode.ring !== undefined ? ringGradient(graphNode.ring) : undefined
    const nodeStyle = isBubble ? {
        "--starci-flow-diameter": `${flowGraphBubbleDiameter(graphNode)}px`,
        ...(ring === undefined ? {} : { "--starci-flow-ring": ring }),
    } as CSSProperties : undefined
    const mark = graphNode.mark === undefined ? undefined : [...graphNode.mark].slice(0, MARK_LENGTH).join("")
    const content = isBubble ? (
        <span className="starci-core-flow-graph-disc">
            {mark === undefined || mark === "" ? null : <span className="starci-core-flow-graph-mark">{mark}</span>}
            {graphNode.caption === undefined || graphNode.caption === "" ? null : <span className="starci-core-flow-graph-caption">{graphNode.caption}</span>}
        </span>
    ) : (
        <>
            <span className="starci-core-flow-graph-copy">
                <span className="starci-core-flow-graph-label">{graphNode.label}</span>
                {graphNode.description === undefined ? null : <span className="starci-core-flow-graph-description">{graphNode.description}</span>}
            </span>
            {hasCount ? <span className="starci-core-flow-graph-count">{graphNode.count}</span> : null}
        </>
    )
    return (
        <div
            className="starci-core-flow-graph-node"
            data-grammar-flow-node={graphNode.id}
            data-dimmed={graphNode.isDimmed === true ? "true" : undefined}
            data-expandable={data.isExpandable === true ? "true" : undefined}
            data-fill={fillOf(graphNode)}
            data-form={graphNode.form ?? "label"}
            data-grammar-selected={isSelected ? "true" : "false"}
            data-placeholder={graphNode.isPlaceholder === true ? "true" : undefined}
            data-ring={ring === undefined ? undefined : "true"}
            data-root={graphNode.isRoot === true ? "true" : undefined}
            data-shape={graphNode.shape ?? "stadium"}
            data-size={graphNode.size ?? "md"}
            data-tone={graphNode.isPlaceholder === true ? "muted" : graphNode.tone ?? "neutral"}
            style={nodeStyle}
        >
            <Handle className="starci-core-flow-graph-handle" isConnectable={false} position={sides.target} type="target" />
            {graphNode.href === undefined ? content : (
                <RouterLink className="starci-core-flow-graph-link" data-grammar-flow-link="true" href={graphNode.href}>{content}</RouterLink>
            )}
            <Handle className="starci-core-flow-graph-handle" isConnectable={false} position={sides.source} type="source" />
        </div>
    )
})
FlowGraphNodeView.displayName = "FlowGraphNodeView"

const FlowGraphHeaderView = memo(({ data }: NodeProps<Node<HeaderData>>) => (
    <div className="starci-core-flow-graph-header" data-direction={data.direction} data-grammar-flow-header={data.label}>{data.label}</div>
))
FlowGraphHeaderView.displayName = "FlowGraphHeaderView"

/** The dashed ring guides of the orbit layout: a square the size of the outermost ring, centred on the root. */
const FlowGraphGuideView = memo(({ data }: NodeProps<Node<GuideData>>) => (
    <svg aria-hidden="true" className="starci-core-flow-graph-guide" height={data.size} width={data.size}>
        {data.radii.map((radius) => <circle cx={data.size / 2} cy={data.size / 2} key={radius} r={radius} />)}
    </svg>
))
FlowGraphGuideView.displayName = "FlowGraphGuideView"

const EDGE_LABEL_PADDING: [number, number] = [6, 2]
const NODE_TYPES: NodeTypes = { flowGraph: FlowGraphNodeView, flowGraphHeader: FlowGraphHeaderView, flowGraphGuide: FlowGraphGuideView }
const HEADER_OFFSET = 70
const HEADER_SIDE_GAP = 24
const FIT_OPTIONS = { padding: 0.2, duration: 0 } as const

const MAX_ZOOM = 2

/** The smallest node text, in px at zoom 1, per node size (the node CSS: sm 0.75rem, md 0.875rem, lg 1rem). */
const NODE_TEXT_PX = { sm: 12, md: 14, lg: 16 } as const
/** Node text never renders below this many px under the `readable` fit. */
const READABLE_TEXT_PX = 12

/**
 * The zoom at which the smallest node text present renders at {@link READABLE_TEXT_PX}; null when no node carries label text
 * (a bubble keeps its text at a fixed screen size instead, see {@link ZoomMirror}).
 */
const readableZoomFor = (nodes: ReadonlyArray<FlowGraphNode>): number | null => {
    const labelled = nodes.filter((node) => node.form !== "bubble")
    return labelled.length === 0 ? null : READABLE_TEXT_PX / Math.min(...labelled.map((node) => NODE_TEXT_PX[node.size ?? "md"]))
}

/** Below these zooms a bubble's caption and mark no longer fit its disc at the fixed screen size, and drop out. */
const CAPTION_ZOOM = 0.42
const MARK_ZOOM = 0.5

/** Reports the viewport zoom (two decimals) so the figure can publish `--starci-flow-zoom` to the bubbles' text. */
const ZoomMirror = ({ onZoom }: { readonly onZoom: (zoom: number) => void }) => {
    const zoom = useStore((state) => Math.round(state.transform[2] * 100) / 100)
    useEffect(() => { onZoom(zoom) }, [zoom, onZoom])
    return null
}

/**
 * Re-fits the viewport once the nodes are measured, and again whenever the set of nodes, the layout or the canvas size
 * changes. Under a readable zoom, a fit that would go below it asks the canvas to grow to the graph's aspect at the
 * canvas width first, then fits with the readable zoom as the floor.
 */
const Refit = ({ signature, readableZoom, onGrow }: {
    readonly signature: string
    readonly readableZoom: number | null
    readonly onGrow: (height: number) => void
}) => {
    const { fitView, getNodes, getNodesBounds } = useReactFlow()
    // React Flow's useNodesInitialized waits for every node's handle bounds, and a layer header has no handles, so it
    // never turned true for a graph with headers and the re-fit never ran. Ready means every node has been measured.
    const isReady = useStore((state) => state.nodeLookup.size > 0 && [...state.nodeLookup.values()].every((node) => (node.measured.width ?? 0) > 0))
    const width = useStore((state) => state.width)
    const height = useStore((state) => state.height)
    useEffect(() => {
        if (!isReady || width === 0 || height === 0) return
        if (readableZoom === null) {
            void fitView(FIT_OPTIONS)
            return
        }
        const bounds = getNodesBounds(getNodes())
        if (bounds.width === 0 || bounds.height === 0) return
        const pad = 1 + 2 * FIT_OPTIONS.padding
        const zoomAtWidth = Math.min(width / (bounds.width * pad), MAX_ZOOM)
        const fitZoom = Math.min(zoomAtWidth, height / (bounds.height * pad))
        if (fitZoom < readableZoom) {
            const needed = Math.ceil(bounds.height * pad * Math.max(readableZoom, zoomAtWidth))
            if (needed > height + 1) {
                onGrow(needed)
                return
            }
        }
        void fitView({ ...FIT_OPTIONS, minZoom: readableZoom })
    }, [fitView, getNodes, getNodesBounds, isReady, signature, readableZoom, width, height, onGrow])
    return null
}

const labelFor = (node: FlowGraphNode) => node.count === undefined || node.count === "" ? node.label : `${node.label} (${node.count})`

/** The labelled edges as "source → target: label", for the screen-reader list; an unlabelled edge adds nothing to read. */
const labelledEdges = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>) => {
    const names = new Map(nodes.map((node) => [node.id, node.label]))
    return edges.flatMap((edge) => edge.label === undefined || edge.label === "" ? [] : [{ id: edge.id, text: `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}: ${edge.label}` }])
}

/** The most nodes one open fan draws before the rest fold into a `+n` bubble. */
const DEFAULT_FAN_LIMIT = 30
/** The width of the `+n` bubble that closes a fan. */
const MORE_DIAMETER = 44
/** Half the widest tip, and the room a tip needs above its node before it flips below, in px. */
const TIP_HALF_WIDTH = 128
const TIP_ROOM = 56

type Tip = {
    readonly id: string
    readonly x: number
    readonly y: number
    readonly isBelow: boolean
}

/** The `+n` bubble that closes a fan: it names the parent in its label, and selecting it selects the parent. */
const moreNodeFor = (id: string, count: number, parent: FlowGraphNode | undefined): FlowGraphNode => ({
    id,
    label: parent === undefined ? `${count} more` : `${count} more under ${parent.label}`,
    form: "bubble",
    mark: count > 999 ? "999+" : `+${count}`,
    diameter: MORE_DIAMETER,
    fill: "soft",
})

/** The ids on the path from the root to `id`, `id` included; empty when there is no layout path. */
const pathTo = (id: string | null, orbit: OrbitLayout | null): ReadonlySet<string> => {
    const path = new Set<string>()
    if (orbit === null) return path
    let current = id ?? undefined
    while (current !== undefined && !path.has(current)) {
        path.add(current)
        current = orbit.parents.get(current)
    }
    return path
}

/**
 * A node-and-edge map drawn with React Flow (`@xyflow/react`, a peer dependency) in grammar tokens. The radial layout
 * puts the root in the centre with its children on a ring and their children on an outer ring around them. The orbit layout
 * draws a value-sized map: bubbles (`form="bubble"`) on rings, with the nodes below ring three shown while their parent is
 * open. Nodes are keyboard focusable (Tab) and selectable with Enter or Space, which also opens or closes a node that holds
 * more; a visually hidden list repeats the nodes for screen readers.
 * Contract: focus FOCUS-2, selection STATE-1, empty STATE-3.
 */
export const FlowGraph = ({
    label,
    nodes,
    edges,
    selectedId,
    onSelect,
    expandedIds,
    defaultExpandedIds,
    onExpandedChange,
    fanLimit = DEFAULT_FAN_LIMIT,
    height = "md",
    fit = "readable",
    isInteractive = true,
    showControls,
    layout: layoutProp,
    direction,
    headers,
    emptyLabel = "Nothing to show yet.",
    isLoading = false,
    className,
}: FlowGraphProps) => {
    const [ownSelectedId, setOwnSelectedId] = useState<string | null>(null)
    const currentId = selectedId === undefined ? ownSelectedId : selectedId
    const select = (id: string | null) => {
        if (selectedId === undefined) setOwnSelectedId(id)
        onSelect?.(id)
    }

    const [ownExpanded, setOwnExpanded] = useState<ReadonlyArray<string>>(defaultExpandedIds ?? [])
    const openIds = expandedIds ?? ownExpanded
    const openKey = openIds.join("\u0000")
    const expanded = useMemo<ReadonlySet<string>>(() => new Set(openKey === "" ? [] : openKey.split("\u0000")), [openKey])
    const toggle = (id: string) => {
        const next = expanded.has(id) ? openIds.filter((open) => open !== id) : [...openIds, id]
        if (expandedIds === undefined) setOwnExpanded(next)
        onExpandedChange?.(next)
    }

    const layout: FlowGraphLayout = layoutProp ?? (direction === undefined ? "radial" : "layered")
    const flowDirection: FlowGraphDirection | undefined = direction ?? (layout === "layered" ? "TB" : undefined)
    const orbit = useMemo<OrbitLayout | null>(
        () => layout === "orbit" ? orbitLayout(nodes, edges, { expanded, fanLimit }) : null,
        [layout, nodes, edges, expanded, fanLimit],
    )
    // The orbit layout draws the rings and the fans of the open nodes, plus the `+n` bubbles that close a fan.
    const shownNodes = useMemo<ReadonlyArray<FlowGraphNode>>(() => {
        if (orbit === null) return nodes
        const byId = new Map(nodes.map((node) => [node.id, node]))
        return [
            ...nodes.filter((node) => orbit.visible.has(node.id)),
            ...orbit.more.map((more) => moreNodeFor(more.id, more.count, byId.get(more.parentId))),
        ]
    }, [nodes, orbit])
    const shownEdges = useMemo<ReadonlyArray<FlowGraphEdge>>(() => {
        if (orbit === null) return edges
        const shown = new Set(shownNodes.map((node) => node.id))
        return [
            ...edges.filter((edge) => shown.has(edge.source) && shown.has(edge.target)),
            ...orbit.more.map((more) => ({ id: `${more.id}-edge`, source: more.parentId, target: more.id })),
        ]
    }, [edges, orbit, shownNodes])
    const moreParents = useMemo(() => new Map((orbit?.more ?? []).map((more) => [more.id, more.parentId])), [orbit])
    const dimmedIds = useMemo(() => new Set(shownNodes.filter((node) => node.isDimmed === true).map((node) => node.id)), [shownNodes])
    const pathIds = useMemo(() => pathTo(currentId, orbit), [currentId, orbit])

    const layered = useMemo(() => layout === "layered" ? layeredPositions(nodes, edges, flowDirection ?? "TB") : null, [layout, nodes, edges, flowDirection])
    const positions = useMemo(() => {
        if (layout === "radial") return radialPositions(nodes, edges)
        if (orbit !== null) return orbit.positions
        return layered?.positions ?? null
    }, [layout, nodes, edges, layered, orbit])
    const rootId = flowGraphRoot(nodes)?.id
    const flowNodes = useMemo<Array<Node<NodeData>>>(() => shownNodes.map((graphNode) => {
        const isExpandable = orbit?.expandable.has(graphNode.id) === true
        const domAttributes = {
            ...(isExpandable && graphNode.href === undefined ? { "aria-expanded": expanded.has(graphNode.id) } : {}),
            ...(graphNode.form === "bubble" && graphNode.description !== undefined ? { "aria-description": graphNode.description } : {}),
        }
        return {
            id: graphNode.id,
            type: "flowGraph",
            position: positions?.get(graphNode.id) ?? graphNode.position ?? { x: 0, y: 0 },
            data: {
                graphNode: layout === "radial" || layout === "orbit" ? { ...graphNode, isRoot: graphNode.id === rootId } : graphNode,
                isSelected: graphNode.id === currentId,
                ...(isExpandable ? { isExpandable } : {}),
                ...(flowDirection === undefined ? {} : { direction: flowDirection }),
            },
            selected: graphNode.id === currentId,
            ariaLabel: labelFor(graphNode),
            // An openable node is a button that reports whether it is open.
            ...(isExpandable && graphNode.href === undefined ? { ariaRole: "button" as const } : {}),
            ...(Object.keys(domAttributes).length === 0 ? {} : { domAttributes }),
            draggable: false,
            connectable: false,
            // A link node keeps one keyboard stop: the anchor inside it.
            ...(graphNode.href === undefined ? {} : { focusable: false }),
        }
    }), [shownNodes, positions, layout, rootId, currentId, flowDirection, orbit, expanded])
    const guideNodes = useMemo<Array<Node<GuideData>>>(() => {
        if (orbit === null || orbit.radii.length === 0) return []
        const size = orbit.extent * 2
        return [{
            id: "grammar-flow-guide",
            type: "flowGraphGuide",
            position: { x: 0, y: 0 },
            width: size,
            height: size,
            data: { radii: orbit.radii, size },
            className: "starci-core-flow-graph-guide-node",
            zIndex: -1,
            draggable: false,
            connectable: false,
            selectable: false,
            focusable: false,
            ariaHidden: true,
        }]
    }, [orbit])
    const headerNodes = useMemo<Array<Node<HeaderData>>>(() => {
        if (headers === undefined || headers.length === 0 || flowDirection === undefined) return []
        const points = nodes.map((node) => positions?.get(node.id) ?? node.position ?? { x: 0, y: 0 })
        const minX = Math.min(...points.map((point) => point.x))
        const minY = Math.min(...points.map((point) => point.y))
        return headers.map((header, index) => {
            const along = layout === "layered" ? layerCoordinate(header.at, flowDirection) : header.at
            return {
                id: `grammar-flow-header-${index}`,
                type: "flowGraphHeader",
                // A TB lane header ends a gap before the widest node can start, so a long title never runs under a node.
                position: flowDirection === "LR" ? { x: along, y: minY - HEADER_OFFSET } : { x: minX - FLOW_GRAPH_NODE_MAX_WIDTH / 2 - HEADER_SIDE_GAP, y: along },
                ...(flowDirection === "LR" ? {} : { origin: [1, 0.5] as [number, number] }),
                data: { label: header.label, direction: flowDirection },
                draggable: false,
                connectable: false,
                selectable: false,
                focusable: false,
                ariaHidden: true,
            }
        })
    }, [headers, flowDirection, nodes, positions, layout])
    const allNodes = useMemo<Array<Node<NodeData> | Node<HeaderData> | Node<GuideData>>>(() => [...guideNodes, ...headerNodes, ...flowNodes], [guideNodes, headerNodes, flowNodes])
    const flowEdges = useMemo<Array<Edge>>(() => shownEdges.map((edge) => {
        // A layered edge that skips layers turns in a gap, never inside a skipped layer (see layeredStepPosition).
        const stepPosition = layered === null ? undefined : layeredStepPosition(edge, layered.positions, layered.layers, flowDirection ?? "TB")
        const classes = [
            "starci-core-flow-graph-edge",
            edge.isPlaceholder === true ? "starci-core-flow-graph-edge-placeholder" : "",
            // An edge dims with its target; the edges from the root to the selected node draw strong.
            dimmedIds.has(edge.target) ? "starci-core-flow-graph-edge-dimmed" : "",
            pathIds.has(edge.source) && pathIds.has(edge.target) ? "starci-core-flow-graph-edge-strong" : "",
        ].filter(Boolean).join(" ")
        return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: layout === "radial" || layout === "orbit" ? "straight" : "smoothstep",
        ...(stepPosition === undefined ? {} : { pathOptions: { stepPosition } }),
        className: classes,
        // The label sits on its own chip at the midpoint; its paint is the grammar's (`.react-flow__edge-text*` in the sheet).
        ...(edge.label === undefined || edge.label === "" ? {} : { label: edge.label, labelShowBg: true, labelBgPadding: EDGE_LABEL_PADDING, labelBgBorderRadius: 4 }),
        focusable: false,
        selectable: false,
        animated: false,
        }
    }), [shownEdges, layout, layered, flowDirection, dimmedIds, pathIds])
    const edgeLabels = useMemo(() => labelledEdges(shownNodes, shownEdges), [shownNodes, shownEdges])
    const signature = `${layout}:${flowDirection ?? ""}:${headerNodes.length}:${shownNodes.map((node) => node.id).join("|")}`

    // Opening a node that holds more selects it and toggles it; the `+n` bubble selects the node it closes.
    const activate = (id: string) => {
        const parentId = moreParents.get(id)
        if (parentId !== undefined) {
            select(parentId)
            return
        }
        select(id)
        if (orbit?.expandable.has(id) === true) toggle(id)
    }

    const figureRef = useRef<HTMLElement>(null)
    const [tip, setTip] = useState<Tip | null>(null)
    const [zoom, setZoom] = useState(1)
    const shownById = useMemo(() => new Map(shownNodes.map((node) => [node.id, node])), [shownNodes])
    // One tip for the node under the pointer or the keyboard focus: a bubble draws no words, so its name and description show here.
    const showTip = (element: Element | null) => {
        const id = element?.getAttribute("data-id") ?? null
        const figure = figureRef.current
        if (element === null || id === null || figure === null || shownById.get(id)?.form !== "bubble") {
            setTip(null)
            return
        }
        const box = element.getBoundingClientRect()
        const frame = figure.getBoundingClientRect()
        const above = box.top - frame.top
        setTip({
            id,
            x: Math.min(Math.max(box.left + box.width / 2 - frame.left, TIP_HALF_WIDTH), Math.max(frame.width - TIP_HALF_WIDTH, TIP_HALF_WIDTH)),
            y: above >= TIP_ROOM ? above : box.bottom - frame.top,
            isBelow: above < TIP_ROOM,
        })
    }
    const tipNode = tip === null ? undefined : shownById.get(tip.id)

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") {
            setTip(null)
            if (currentId !== null) select(null)
            return
        }
        if (event.key !== "Enter" && event.key !== " ") return
        if (event.target instanceof Element && event.target.closest("a") !== null) return // the link owns Enter
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".react-flow__node") : null
        const id = target?.getAttribute("data-id")
        if (id === null || id === undefined || !shownById.has(id)) return
        event.preventDefault()
        activate(id)
    }
    const onFocus = (event: FocusEvent<HTMLElement>) => showTip(event.target instanceof Element ? event.target.closest(".react-flow__node") : null)

    const customHeight = height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
    const controls = showControls ?? isInteractive
    // The readable fit grows the canvas for one graph; a new set of nodes or layout starts again from `height`.
    const readableZoom = fit === "readable" && shownNodes.length > 0 ? readableZoomFor(shownNodes) : null
    const [growth, setGrowth] = useState<{ readonly signature: string, readonly height: number } | null>(null)
    const grownHeight = growth !== null && growth.signature === signature ? growth.height : null
    const onGrow = useCallback((next: number) => setGrowth({ signature, height: next }), [signature])
    // A grown canvas is taller than the screen may be: the wheel scrolls the page, the zoom buttons still zoom.
    const wheelZooms = isInteractive && grownHeight === null
    const hasBubbles = shownNodes.some((node) => node.form === "bubble")
    const style: CSSProperties | undefined = customHeight === undefined && grownHeight === null && !hasBubbles ? undefined : {
        ...(customHeight === undefined ? {} : { "--starci-flow-height": customHeight }),
        ...(grownHeight === null ? {} : { "--starci-flow-grown-height": `${grownHeight}px` }),
        // The bubbles' text keeps one screen size: it is sized in graph units by the inverse of this zoom.
        ...(hasBubbles ? { "--starci-flow-zoom": zoom } : {}),
    } as CSSProperties

    return (
        <figure
            aria-label={label}
            className={["starci-core-flow-graph", className].filter(Boolean).join(" ")}
            data-component="FlowGraph"
            data-contract="FOCUS-2 STATE-1 STATE-3"
            data-grammar-flow-caption={hasBubbles && zoom < CAPTION_ZOOM ? "off" : undefined}
            data-grammar-flow-direction={flowDirection}
            data-grammar-flow-height={customHeight === undefined ? height : "custom"}
            data-grammar-flow-interactive={isInteractive ? "true" : "false"}
            data-grammar-flow-layout={layout}
            data-grammar-flow-fit={fit}
            data-grammar-flow-grown={grownHeight === null ? undefined : "true"}
            data-grammar-flow-mark={hasBubbles && zoom < MARK_ZOOM ? "off" : undefined}
            data-tier="branch"
            ref={figureRef}
            style={style}
            {...(isLoading ? { "aria-busy": true, "data-loading": "true" } : {})}
            onBlur={() => setTip(null)}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
        >
            {isLoading ? (
                <div className="starci-core-flow-graph-canvas starci-core-flow-graph-loading" data-grammar-flow-loading="true"><Skeleton shape="rect" /></div>
            ) : nodes.length === 0 ? (
                <p className="starci-core-flow-graph-empty" data-contract="STATE-3" data-grammar-flow-empty="true">{emptyLabel}</p>
            ) : (
                <>
                    <div className="starci-core-flow-graph-canvas">
                        <ReactFlow
                            edges={flowEdges}
                            edgesFocusable={false}
                            elementsSelectable
                            fitView
                            fitViewOptions={FIT_OPTIONS}
                            maxZoom={MAX_ZOOM}
                            minZoom={0.2}
                            nodeOrigin={[0.5, 0.5]}
                            nodeTypes={NODE_TYPES}
                            nodes={allNodes}
                            nodesConnectable={false}
                            nodesDraggable={false}
                            nodesFocusable
                            onMoveStart={() => setTip(null)}
                            onNodeClick={(_event, node) => { if (node.type === "flowGraph") activate(node.id) }}
                            onNodeMouseEnter={(event) => showTip(event.currentTarget instanceof Element ? event.currentTarget : null)}
                            onNodeMouseLeave={() => setTip(null)}
                            onPaneClick={() => { if (currentId !== null) select(null) }}
                            panOnDrag={isInteractive}
                            panOnScroll={false}
                            preventScrolling={wheelZooms}
                            proOptions={{ hideAttribution: true }}
                            zoomOnDoubleClick={false}
                            zoomOnPinch={isInteractive}
                            zoomOnScroll={wheelZooms}
                        >
                            <Background className="starci-core-flow-graph-background" gap={1000} size={0} />
                            {controls ? <Controls aria-label={`${label}: zoom`} className="starci-core-flow-graph-controls" showInteractive={false} /> : null}
                            <Refit signature={signature} readableZoom={readableZoom} onGrow={onGrow} />
                            {hasBubbles ? <ZoomMirror onZoom={setZoom} /> : null}
                        </ReactFlow>
                    </div>
                    {tip === null || tipNode === undefined ? null : (
                        <div
                            aria-hidden="true"
                            className="starci-core-flow-graph-tip"
                            data-grammar-flow-tip={tip.id}
                            data-placement={tip.isBelow ? "bottom" : "top"}
                            style={{ insetInlineStart: `${tip.x}px`, insetBlockStart: `${tip.y}px` }}
                        >
                            <span className="starci-core-flow-graph-tip-label">{tipNode.label}</span>
                            {tipNode.description === undefined ? null : <span className="starci-core-flow-graph-tip-description">{tipNode.description}</span>}
                        </div>
                    )}
                    <ul className="starci-core-visually-hidden" data-grammar-flow-fallback="true">
                        {shownNodes.map((node) => <li key={node.id} {...(node.id === currentId ? { "aria-current": "true" as const } : {})}>{labelFor(node)}</li>)}
                    </ul>
                    {edgeLabels.length === 0 ? null : (
                        <ul className="starci-core-visually-hidden" data-grammar-flow-edge-fallback="true">
                            {edgeLabels.map((edge) => <li key={edge.id}>{edge.text}</li>)}
                        </ul>
                    )}
                </>
            )}
        </figure>
    )
}
