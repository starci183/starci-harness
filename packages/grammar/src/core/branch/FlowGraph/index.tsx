"use client"

import {
    BaseEdge,
    Background,
    Controls,
    EdgeLabelRenderer,
    getSmoothStepPath,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    type Edge,
    type EdgeProps,
    type EdgeTypes,
    type Node,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react"
import { Link as RouterLink } from "react-aria-components"
import { memo, useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { FIT_OPTIONS, LANES_FIT_OPTIONS, LANES_MAX_ZOOM, MAX_ZOOM, Refit, labelFor, labelledEdges, readableZoomFor } from "./canvas.js"
import { COMMON_SPACING_PX } from "../../../common/spacing.js"
import {
    FLOW_GRAPH_NODE_MAX_WIDTH,
    LANES_HEADER_ROOM,
    LANES_NODE_WIDTH,
    flowGraphRoot,
    layerCoordinate,
    layeredPositions,
    layeredStepPosition,
    lanesLayout,
    lanesNaturalHeight,
    lanesStepPosition,
    radialPositions,
    type LanesLayout,
} from "./layout.js"
import type { FlowGraphDirection, FlowGraphEdge, FlowGraphHeight, FlowGraphLayerHeader, FlowGraphLayout, FlowGraphNode, FlowGraphTone } from "./types.js"
import type { NoChildren } from "../../tier.js"

export { lanesLayout, layeredPositions, radialPositions } from "./layout.js"
export type { FlowGraphDirection, FlowGraphEdge, FlowGraphHeight, FlowGraphLayerHeader, FlowGraphLayout, FlowGraphNode, FlowGraphNodeKind, FlowGraphNodeShape, FlowGraphNodeSize, FlowGraphTone } from "./types.js"

export type FlowGraphProps = NoChildren & {
    /** Names the graph for assistive technology, e.g. "Second brain". */
    readonly label: string
    readonly nodes: ReadonlyArray<FlowGraphNode>
    readonly edges: ReadonlyArray<FlowGraphEdge>
    /**
     * The selected node. Pass it (with `onSelect`) to control selection; leave it out and the graph keeps its own. The node stamps
     * `data-grammar-selected` and the screen-reader list reports it. HeroUI has no graph node, so a pill draws no selected outline.
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
     * `lanes` is the branch map of a workflow: a column per stage and one row per branch of a condition, so each path reads left
     * to right on one line; its edges are orthogonal with rounded corners and an arrowhead, a branch label sits on its own edge, and
     * the node `kind` sets the tone (trigger neutral, condition warning, execute its tone, output accent). Its canvas is as tall as
     * the graph unless `height` is given.
     * `radial` places the nodes on rings round the root; `layered` puts a DAG in layers along `direction`; `manual` uses each
     * node's `position`. Defaults to `radial`, or to `layered` when a `direction` is given. A value-sized map of bubbles is `BubbleMap`.
     */
    readonly layout?: FlowGraphLayout
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
}

type NodeData = {
    readonly graphNode: FlowGraphNode
    readonly isSelected: boolean
    readonly direction?: FlowGraphDirection
    readonly [key: string]: unknown
}

/** The tone a node kind draws in a `lanes` graph: an execute node keeps its own tone (info by default). */
const toneOf = (node: FlowGraphNode): FlowGraphTone => {
    if (node.isPlaceholder === true) return "muted"
    if (node.kind === "trigger") return "neutral"
    if (node.kind === "condition") return "warning"
    if (node.kind === "output") return "accent"
    if (node.kind === "execute") return node.tone ?? "info"
    return node.tone ?? "neutral"
}

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
    const content = (
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
            data-form="label"
            data-grammar-selected={isSelected ? "true" : "false"}
            data-placeholder={graphNode.isPlaceholder === true ? "true" : undefined}
            data-root={graphNode.isRoot === true ? "true" : undefined}
            data-shape={graphNode.shape ?? "stadium"}
            data-size={graphNode.size ?? "md"}
            data-kind={graphNode.kind}
            data-tone={toneOf(graphNode)}
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

/**
 * A lanes edge: orthogonal with rounded corners, an arrowhead, and its label on its own last run. The label is an opaque chip in the
 * edge label layer, which React Flow paints above every edge line: an SVG label paints in its own edge's group, so the line of an edge
 * drawn after it (another branch running into the same node along the same row) would cross the words and read as struck through.
 */
const LANE_RADIUS = COMMON_SPACING_PX[3]
/** The room the arrowhead takes at the end of the last run, kept clear of the label. */
const LANE_ARROW_ROOM = COMMON_SPACING_PX[3]
const FlowGraphLaneEdge = memo(({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label, data }: EdgeProps) => {
    const share: unknown = data?.["stepPosition"]
    const stepPosition = typeof share === "number" ? share : 0.5
    const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: LANE_RADIUS, stepPosition })
    const turnX = sourceX + (targetX - sourceX) * stepPosition
    // The label is centred on the straight part of the last run, between the corner of the turn and the arrowhead.
    const labelX = (turnX + LANE_RADIUS + targetX - LANE_ARROW_ROOM) / 2
    return (
        <>
            <BaseEdge path={path} {...(markerEnd === undefined ? {} : { markerEnd })} />
            {typeof label === "string" && label !== "" ? (
                <EdgeLabelRenderer>
                    <span
                        className="starci-core-flow-graph-lane-label"
                        data-grammar-flow-edge-label="true"
                        style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(targetY)}px)` }}
                    >
                        {label}
                    </span>
                </EdgeLabelRenderer>
            ) : null}
        </>
    )
})
FlowGraphLaneEdge.displayName = "FlowGraphLaneEdge"

const EDGE_TYPES: EdgeTypes = { flowGraphLane: FlowGraphLaneEdge }
const EDGE_LABEL_PADDING: [number, number] = [COMMON_SPACING_PX[2], COMMON_SPACING_PX[1]]
const LABEL_RADIUS = COMMON_SPACING_PX[1]
const NODE_TYPES: NodeTypes = { flowGraph: FlowGraphNodeView, flowGraphHeader: FlowGraphHeaderView }
const HEADER_OFFSET = 70
const HEADER_SIDE_GAP = COMMON_SPACING_PX[6]
/**
 * A node-and-edge map drawn with React Flow (`@xyflow/react`, a peer dependency) in grammar tokens. The radial layout
 * puts the root in the centre with its children on a ring and their children on an outer ring around them. Nodes are
 * keyboard focusable (Tab) and selectable with Enter or Space; a visually hidden list repeats the nodes for screen readers.
 * Contract: focus FOCUS-2, selection STATE-1, empty STATE-3.
 */
export const FlowGraph = ({
    label,
    nodes,
    edges,
    selectedId,
    onSelect,
    height,
    fit = "readable",
    isInteractive = true,
    showControls,
    layout: layoutProp,
    direction,
    headers,
    emptyLabel = "Nothing to show yet.",
    isLoading = false,
}: FlowGraphProps) => {
    const [ownSelectedId, setOwnSelectedId] = useState<string | null>(null)
    const currentId = selectedId === undefined ? ownSelectedId : selectedId
    const select = (id: string | null) => {
        if (selectedId === undefined) setOwnSelectedId(id)
        onSelect?.(id)
    }

    const layout: FlowGraphLayout = layoutProp ?? (direction === undefined ? "radial" : "layered")
    const flowDirection: FlowGraphDirection | undefined = layout === "lanes" ? "LR" : direction ?? (layout === "layered" ? "TB" : undefined)
    const dimmedIds = useMemo(() => new Set(nodes.filter((node) => node.isDimmed === true).map((node) => node.id)), [nodes])

    const lanes = useMemo<LanesLayout | null>(() => layout === "lanes" ? lanesLayout(nodes, edges) : null, [layout, nodes, edges])
    const layered = useMemo(() => layout === "layered" ? layeredPositions(nodes, edges, flowDirection ?? "TB") : null, [layout, nodes, edges, flowDirection])
    const positions = useMemo(() => {
        if (layout === "radial") return radialPositions(nodes, edges)
        if (lanes !== null) return lanes.positions
        return layered?.positions ?? null
    }, [layout, nodes, edges, layered, lanes])
    const rootId = flowGraphRoot(nodes)?.id
    const flowNodes = useMemo<Array<Node<NodeData>>>(() => nodes.map((graphNode) => ({
        id: graphNode.id,
        type: "flowGraph",
        position: positions?.get(graphNode.id) ?? graphNode.position ?? { x: 0, y: 0 },
        data: {
            graphNode: layout === "radial" ? { ...graphNode, isRoot: graphNode.id === rootId } : graphNode,
            isSelected: graphNode.id === currentId,
            ...(flowDirection === undefined ? {} : { direction: flowDirection }),
        },
        selected: graphNode.id === currentId,
        ariaLabel: labelFor(graphNode),
        draggable: false,
        connectable: false,
        // A link node keeps one keyboard stop: the anchor inside it.
        ...(graphNode.href === undefined ? {} : { focusable: false }),
    })), [nodes, positions, layout, rootId, currentId, flowDirection])
    const headerNodes = useMemo<Array<Node<HeaderData>>>(() => {
        if (headers === undefined || headers.length === 0 || flowDirection === undefined) return []
        const points = nodes.map((node) => positions?.get(node.id) ?? node.position ?? { x: 0, y: 0 })
        const minX = Math.min(...points.map((point) => point.x))
        const minY = Math.min(...points.map((point) => point.y))
        const held = lanes === null ? null : new Set(nodes.map((node) => lanes.columns.get(node.id)))
        return headers.flatMap((header, index) => {
            // A column header shows only over a column that holds a node.
            if (held !== null && !held.has(header.at)) return []
            const along = lanes !== null ? (lanes.columnX[header.at] ?? 0) : layout === "layered" ? layerCoordinate(header.at, flowDirection) : header.at
            return [{
                id: `grammar-flow-header-${index}`,
                type: "flowGraphHeader",
                // A TB lane header ends a gap before the widest node can start, so a long title never runs under a node.
                position: flowDirection === "LR" ? { x: along, y: minY - (layout === "lanes" ? LANES_HEADER_ROOM : HEADER_OFFSET) } : { x: minX - FLOW_GRAPH_NODE_MAX_WIDTH / 2 - HEADER_SIDE_GAP, y: along },
                ...(flowDirection === "LR" ? {} : { origin: [1, 0.5] as [number, number] }),
                data: { label: header.label, direction: flowDirection },
                draggable: false,
                connectable: false,
                selectable: false,
                focusable: false,
                ariaHidden: true,
            }]
        })
    }, [headers, flowDirection, nodes, positions, layout, lanes])
    const allNodes = useMemo<Array<Node<NodeData> | Node<HeaderData>>>(() => [...headerNodes, ...flowNodes], [headerNodes, flowNodes])
    const flowEdges = useMemo<Array<Edge>>(() => edges.map((edge) => {
        // A layered edge that skips layers turns in a gap, never inside a skipped layer (see layeredStepPosition).
        const stepPosition = layered === null ? undefined : layeredStepPosition(edge, layered.positions, layered.layers, flowDirection ?? "TB")
        const classes = [
            "starci-core-flow-graph-edge",
            edge.isPlaceholder === true ? "starci-core-flow-graph-edge-placeholder" : "",
            // An edge dims with its target.
            dimmedIds.has(edge.target) ? "starci-core-flow-graph-edge-dimmed" : "",
        ].filter(Boolean).join(" ")
        return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: layout === "radial" ? "straight" : layout === "lanes" ? "flowGraphLane" : "smoothstep",
        ...(lanes === null ? {} : {
            data: { stepPosition: lanesStepPosition((lanes.columnX[lanes.columns.get(edge.target) ?? 0] ?? 0) - (lanes.columnX[lanes.columns.get(edge.source) ?? 0] ?? 0) - LANES_NODE_WIDTH, lanes.forks.get(edge.source) ?? 0) },
            markerEnd: { type: MarkerType.ArrowClosed, width: COMMON_SPACING_PX[6], height: COMMON_SPACING_PX[6], color: "var(--muted)" },
        }),
        ...(stepPosition === undefined ? {} : { pathOptions: { stepPosition } }),
        className: classes,
        // The label sits on its own chip at the midpoint; its paint is the grammar's (`.react-flow__edge-text*` in the sheet).
        ...(edge.label === undefined || edge.label === "" ? {} : { label: edge.label, labelShowBg: true, labelBgPadding: EDGE_LABEL_PADDING, labelBgBorderRadius: LABEL_RADIUS }),
        focusable: false,
        selectable: false,
        animated: false,
        }
    }), [edges, layout, layered, lanes, flowDirection, dimmedIds])
    const edgeLabels = useMemo(() => labelledEdges(nodes, edges), [nodes, edges])
    const signature = `${layout}:${flowDirection ?? ""}:${headerNodes.length}:${nodes.map((node) => node.id).join("|")}`

    const activate = (id: string) => { select(id) }
    const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") {
            if (currentId !== null) select(null)
            return
        }
        if (event.key !== "Enter" && event.key !== " ") return
        if (event.target instanceof Element && event.target.closest("a") !== null) return // the link owns Enter
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".react-flow__node") : null
        const id = target?.getAttribute("data-id")
        if (id === null || id === undefined || !nodeIds.has(id)) return
        event.preventDefault()
        activate(id)
    }

    const naturalHeight = lanes === null ? null : lanesNaturalHeight(lanes, headerNodes.length > 0)
    const customHeight = height === undefined && naturalHeight !== null ? `${naturalHeight}px` : height === undefined || height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
    const fitOptions = layout === "lanes" ? LANES_FIT_OPTIONS : FIT_OPTIONS
    const maxZoom = layout === "lanes" ? LANES_MAX_ZOOM : MAX_ZOOM
    const controls = showControls ?? isInteractive
    // The readable fit grows the canvas for one graph; a new set of nodes or layout starts again from `height`.
    const readableZoom = fit === "readable" && nodes.length > 0 ? readableZoomFor(nodes) : null
    const [growth, setGrowth] = useState<{ readonly signature: string, readonly height: number } | null>(null)
    const grownHeight = growth !== null && growth.signature === signature ? growth.height : null
    const onGrow = useCallback((next: number) => setGrowth({ signature, height: next }), [signature])
    // A grown canvas is taller than the screen may be: the wheel scrolls the page, the zoom buttons still zoom.
    const wheelZooms = isInteractive && grownHeight === null && layout !== "lanes"
    const style: CSSProperties | undefined = customHeight === undefined && grownHeight === null ? undefined : {
        ...(customHeight === undefined ? {} : { "--starci-flow-height": customHeight }),
        ...(grownHeight === null ? {} : { "--starci-flow-grown-height": `${grownHeight}px` }),
    } as CSSProperties

    return (
        <figure
            aria-label={label}
            className="starci-core-flow-graph"
            data-component="FlowGraph"
            data-contract="FOCUS-2 STATE-1 STATE-3"
            data-grammar-flow-direction={flowDirection}
            data-grammar-flow-height={customHeight === undefined ? height ?? "md" : "custom"}
            data-grammar-flow-interactive={isInteractive ? "true" : "false"}
            data-grammar-flow-layout={layout}
            data-grammar-flow-fit={fit}
            data-grammar-flow-grown={grownHeight === null ? undefined : "true"}
            data-tier="branch"
            style={style}
            {...(isLoading ? { "aria-busy": true, "data-loading": "true" } : {})}
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
                            edgeTypes={EDGE_TYPES}
                            edges={flowEdges}
                            edgesFocusable={false}
                            elementsSelectable
                            fitView
                            fitViewOptions={fitOptions}
                            maxZoom={maxZoom}
                            minZoom={0.2}
                            nodeOrigin={[0.5, 0.5]}
                            nodeTypes={NODE_TYPES}
                            nodes={allNodes}
                            nodesConnectable={false}
                            nodesDraggable={false}
                            nodesFocusable
                            onNodeClick={(_event, node) => { if (node.type === "flowGraph") activate(node.id) }}
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
                            <Refit anchorStart={layout === "lanes"} fitOptions={fitOptions} maxZoom={maxZoom} onGrow={onGrow} readableZoom={readableZoom} signature={signature} />
                        </ReactFlow>
                    </div>
                    <ul className="starci-core-visually-hidden" data-grammar-flow-fallback="true">
                        {nodes.map((node) => <li key={node.id} {...(node.id === currentId ? { "aria-current": "true" as const } : {})}>{labelFor(node)}</li>)}
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
