"use client"

import {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlow,
    useNodesInitialized,
    useReactFlow,
    type Edge,
    type Node,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react"
import { Link as RouterLink } from "react-aria-components"
import { memo, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react"
import { Skeleton } from "../../primitive/Skeleton/index.js"
import { FLOW_GRAPH_NODE_MAX_WIDTH, flowGraphRoot, layerCoordinate, layeredPositions, layeredStepPosition, radialPositions } from "./layout.js"
import type { FlowGraphDirection, FlowGraphEdge, FlowGraphHeight, FlowGraphLayerHeader, FlowGraphLayout, FlowGraphNode } from "./types.js"

export { layeredPositions, radialPositions } from "./layout.js"
export type { FlowGraphDirection, FlowGraphEdge, FlowGraphHeight, FlowGraphLayerHeader, FlowGraphLayout, FlowGraphNode, FlowGraphNodeSize, FlowGraphTone } from "./types.js"

export type FlowGraphProps = {
    /** Names the graph for assistive technology, e.g. "Second brain". */
    readonly label: string
    readonly nodes: ReadonlyArray<FlowGraphNode>
    readonly edges: ReadonlyArray<FlowGraphEdge>
    /**
     * The selected node. Pass it (with `onSelect`) to control selection; leave it out and the graph keeps its own. The node stamps
     * `data-grammar-selected` and the screen-reader list reports it; HeroUI has no graph node, so Grammar draws no selected outline.
     */
    readonly selectedId?: string | null
    /** Fires with the node id on click, Enter or Space, and with `null` when the empty canvas is clicked or Escape is pressed. */
    readonly onSelect?: (id: string | null) => void
    /**
     * Canvas height: `sm` 16rem, `md` 24rem, `lg` 32rem, or any size of your own: a number is pixels, a string is a CSS length
     * (`"60vh"`, `"48rem"`).
     */
    readonly height?: FlowGraphHeight | number | string
    /** Pan and zoom. `false` draws a static picture. */
    readonly isInteractive?: boolean
    /** Zoom buttons. Defaults to on while the graph is interactive. */
    readonly showControls?: boolean
    /**
     * `radial` places the nodes on rings round the root; `layered` puts a DAG in layers along `direction`; `manual` uses each
     * node's `position`. Defaults to `radial`, or to `layered` when a `direction` is given.
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
    readonly className?: string
}

type NodeData = {
    readonly graphNode: FlowGraphNode
    readonly isSelected: boolean
    readonly direction?: FlowGraphDirection
    readonly [key: string]: unknown
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
            data-grammar-selected={isSelected ? "true" : "false"}
            data-placeholder={graphNode.isPlaceholder === true ? "true" : undefined}
            data-root={graphNode.isRoot === true ? "true" : undefined}
            data-size={graphNode.size ?? "md"}
            data-tone={graphNode.isPlaceholder === true ? "muted" : graphNode.tone ?? "neutral"}
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

const NODE_TYPES: NodeTypes = { flowGraph: FlowGraphNodeView, flowGraphHeader: FlowGraphHeaderView }
const HEADER_OFFSET = 70
const HEADER_SIDE_GAP = 24
const FIT_OPTIONS = { padding: 0.2, duration: 0 } as const

/** Re-fits the viewport once the nodes are measured, and again whenever the set of nodes or the layout changes. */
const Refit = ({ signature }: { readonly signature: string }) => {
    const { fitView } = useReactFlow()
    const isReady = useNodesInitialized()
    useEffect(() => {
        if (isReady) void fitView(FIT_OPTIONS)
    }, [fitView, isReady, signature])
    return null
}

const labelFor = (node: FlowGraphNode) => node.count === undefined || node.count === "" ? node.label : `${node.label} (${node.count})`

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
    height = "md",
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

    const layout: FlowGraphLayout = layoutProp ?? (direction === undefined ? "radial" : "layered")
    const flowDirection: FlowGraphDirection | undefined = direction ?? (layout === "layered" ? "TB" : undefined)
    const layered = useMemo(() => layout === "layered" ? layeredPositions(nodes, edges, flowDirection ?? "TB") : null, [layout, nodes, edges, flowDirection])
    const positions = useMemo(() => {
        if (layout === "radial") return radialPositions(nodes, edges)
        return layered?.positions ?? null
    }, [layout, nodes, edges, layered])
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
    const allNodes = useMemo<Array<Node<NodeData> | Node<HeaderData>>>(() => [...headerNodes, ...flowNodes], [headerNodes, flowNodes])
    const flowEdges = useMemo<Array<Edge>>(() => edges.map((edge) => {
        // A layered edge that skips layers turns in a gap, never inside a skipped layer (see layeredStepPosition).
        const stepPosition = layered === null ? undefined : layeredStepPosition(edge, layered.positions, layered.layers, flowDirection ?? "TB")
        return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: layout === "radial" ? "straight" : "smoothstep",
        ...(stepPosition === undefined ? {} : { pathOptions: { stepPosition } }),
        className: edge.isPlaceholder === true ? "starci-core-flow-graph-edge starci-core-flow-graph-edge-placeholder" : "starci-core-flow-graph-edge",
        focusable: false,
        selectable: false,
        animated: false,
        }
    }), [edges, layout, layered, flowDirection])
    const signature = `${layout}:${flowDirection ?? ""}:${headerNodes.length}:${nodes.map((node) => node.id).join("|")}`

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") {
            if (currentId !== null) select(null)
            return
        }
        if (event.key !== "Enter" && event.key !== " ") return
        if (event.target instanceof Element && event.target.closest("a") !== null) return // the link owns Enter
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".react-flow__node") : null
        const id = target?.getAttribute("data-id")
        if (id === null || id === undefined) return
        event.preventDefault()
        select(id)
    }

    const customHeight = height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
    const controls = showControls ?? isInteractive

    return (
        <figure
            aria-label={label}
            className={["starci-core-flow-graph", className].filter(Boolean).join(" ")}
            data-component="FlowGraph"
            data-contract="FOCUS-2 STATE-1 STATE-3"
            data-grammar-flow-direction={flowDirection}
            data-grammar-flow-height={customHeight === undefined ? height : "custom"}
            data-grammar-flow-interactive={isInteractive ? "true" : "false"}
            data-grammar-flow-layout={layout}
            data-tier="branch"
            style={customHeight === undefined ? undefined : { "--starci-flow-height": customHeight } as CSSProperties}
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
                            edges={flowEdges}
                            edgesFocusable={false}
                            elementsSelectable
                            fitView
                            fitViewOptions={FIT_OPTIONS}
                            maxZoom={2}
                            minZoom={0.2}
                            nodeOrigin={[0.5, 0.5]}
                            nodeTypes={NODE_TYPES}
                            nodes={allNodes}
                            nodesConnectable={false}
                            nodesDraggable={false}
                            nodesFocusable
                            onNodeClick={(_event, node) => { if (node.type === "flowGraph") select(node.id) }}
                            onPaneClick={() => { if (currentId !== null) select(null) }}
                            panOnDrag={isInteractive}
                            panOnScroll={false}
                            preventScrolling={isInteractive}
                            proOptions={{ hideAttribution: true }}
                            zoomOnDoubleClick={false}
                            zoomOnPinch={isInteractive}
                            zoomOnScroll={isInteractive}
                        >
                            <Background className="starci-core-flow-graph-background" gap={1000} size={0} />
                            {controls ? <Controls aria-label={`${label}: zoom`} className="starci-core-flow-graph-controls" showInteractive={false} /> : null}
                            <Refit signature={signature} />
                        </ReactFlow>
                    </div>
                    <ul className="starci-core-visually-hidden" data-grammar-flow-fallback="true">
                        {nodes.map((node) => <li key={node.id} {...(node.id === currentId ? { "aria-current": "true" as const } : {})}>{labelFor(node)}</li>)}
                    </ul>
                </>
            )}
        </figure>
    )
}
