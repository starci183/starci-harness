"use client"

import {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlow,
    type Edge,
    type Node,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react"
import { Link as RouterLink } from "react-aria-components"
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { CAPTION_ZOOM, FIT_OPTIONS, MARK_ZOOM, MAX_ZOOM, Refit, ZoomMirror, labelFor, readableZoomFor } from "../FlowGraph/canvas.js"
import type { FlowGraphHeight, FlowGraphTone } from "../FlowGraph/types.js"
import { bubbleMapLayout, bubbleNodeDiameter, type BubbleMapLayout } from "./layout.js"
import type { BubbleMapEdge, BubbleMapFill, BubbleMapNode, BubbleMapRingPart } from "./types.js"
import type { NoChildren } from "../../tier.js"

export { bubbleDiameter, bubbleMapLayout } from "./layout.js"
export type { BubbleMapEdge, BubbleMapFill, BubbleMapNode, BubbleMapNodeForm, BubbleMapRingPart } from "./types.js"

export type BubbleMapProps = NoChildren & {
    /** Names the map for assistive technology, e.g. "Second brain". */
    readonly label: string
    readonly nodes: ReadonlyArray<BubbleMapNode>
    readonly edges: ReadonlyArray<BubbleMapEdge>
    /**
     * The selected node. Pass it (with `onSelect`) to control selection; leave it out and the map keeps its own. The node stamps
     * `data-grammar-selected` and the screen-reader list reports it. A bubble draws a selected outline, and the edges from the root
     * to the selected node draw strong.
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
     * How the map meets its canvas. `readable` (default) never fits below the zoom at which node text renders at 12px:
     * a map that would shrink further grows the canvas height to its aspect at the canvas width. `contain` always shrinks the
     * whole map into the canvas `height`.
     */
    readonly fit?: "readable" | "contain"
    /** Pan and zoom. `false` draws a static picture. */
    readonly isInteractive?: boolean
    /** Zoom buttons. Defaults to on while the map is interactive. */
    readonly showControls?: boolean
    /**
     * The ring-three nodes that are open. A node's children past ring three show only while it is open, on ring four. Pass it
     * (with `onExpandedChange`) to control it; leave it out and the map keeps its own, from `defaultExpandedIds`.
     */
    readonly expandedIds?: ReadonlyArray<string>
    readonly defaultExpandedIds?: ReadonlyArray<string>
    /** Fires with the open ids when a node opens or closes: on click, or on Enter or Space, of a node that holds more. */
    readonly onExpandedChange?: (ids: ReadonlyArray<string>) => void
    /** The most nodes one open fan draws (default 30). The rest fold into a `+n` bubble that selects the parent. */
    readonly fanLimit?: number
    /** Shown instead of the canvas when there are no nodes. */
    readonly emptyLabel?: string
    /** Unresolved map (knowledge STATE-8): the frame at its height with a Skeleton block, no React Flow mounted, `aria-busy`. */
    readonly isLoading?: boolean
}

type NodeData = {
    readonly graphNode: BubbleMapNode
    readonly isSelected: boolean
    /** The node holds deeper nodes that show while it is open. */
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

/** The token each ring arc and bubble tone paints from. */
const TONE_PAINT: Record<FlowGraphTone, string> = {
    neutral: "var(--muted)",
    accent: "var(--accent)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    info: "var(--info)",
    muted: "color-mix(in oklab, var(--muted) 55%, transparent)",
}

/** A conic gradient of the ring arcs, clockwise from the top; undefined when the arcs hold nothing. */
const ringGradient = (ring: ReadonlyArray<BubbleMapRingPart>): string | undefined => {
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

const toneOf = (node: BubbleMapNode): FlowGraphTone => node.isPlaceholder === true ? "muted" : node.tone ?? "neutral"

const fillOf = (node: BubbleMapNode): BubbleMapFill | undefined => node.fill ?? (node.form === "bubble" ? "soft" : undefined)

const BubbleMapNodeView = memo(({ data }: NodeProps<Node<NodeData>>) => {
    const { graphNode, isSelected } = data
    const hasCount = graphNode.count !== undefined && graphNode.count !== ""
    const isBubble = graphNode.form === "bubble"
    const ring = isBubble && graphNode.ring !== undefined ? ringGradient(graphNode.ring) : undefined
    const nodeStyle = isBubble ? {
        "--starci-flow-diameter": `${bubbleNodeDiameter(graphNode)}px`,
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
            data-tone={toneOf(graphNode)}
            style={nodeStyle}
        >
            <Handle className="starci-core-flow-graph-handle" isConnectable={false} position={Position.Top} type="target" />
            {graphNode.href === undefined ? content : (
                <RouterLink className="starci-core-flow-graph-link" data-grammar-flow-link="true" href={graphNode.href}>{content}</RouterLink>
            )}
            <Handle className="starci-core-flow-graph-handle" isConnectable={false} position={Position.Top} type="source" />
        </div>
    )
})
BubbleMapNodeView.displayName = "BubbleMapNodeView"

/** The dashed ring guides: a square the size of the outermost ring, centred on the root. */
const BubbleMapGuideView = memo(({ data }: NodeProps<Node<GuideData>>) => (
    <svg aria-hidden="true" className="starci-core-flow-graph-guide" height={data.size} width={data.size}>
        {data.radii.map((radius) => <circle cx={data.size / 2} cy={data.size / 2} key={radius} r={radius} />)}
    </svg>
))
BubbleMapGuideView.displayName = "BubbleMapGuideView"

const NODE_TYPES: NodeTypes = { flowGraph: BubbleMapNodeView, flowGraphGuide: BubbleMapGuideView }

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
const moreNodeFor = (id: string, count: number, parent: BubbleMapNode | undefined): BubbleMapNode => ({
    id,
    label: parent === undefined ? `${count} more` : `${count} more under ${parent.label}`,
    form: "bubble",
    mark: count > 999 ? "999+" : `+${count}`,
    diameter: MORE_DIAMETER,
    fill: "soft",
})

/** The ids on the path from the root to `id`, `id` included; empty when there is no layout path. */
const pathTo = (id: string | null, layout: BubbleMapLayout): ReadonlySet<string> => {
    const path = new Set<string>()
    let current = id ?? undefined
    while (current !== undefined && !path.has(current)) {
        path.add(current)
        current = layout.parents.get(current)
    }
    return path
}

/**
 * A value-sized map drawn with React Flow (`@xyflow/react`, a peer dependency) in grammar tokens: the root in the centre, its
 * children in sectors on a second ring, their children staggered on a third, and the fans of the open ring-three nodes on a
 * fourth. Bubbles (`form="bubble"`) are sized by `bubbleDiameter(value, max)` so area tracks value. Nodes are keyboard
 * focusable (Tab) and selectable with Enter or Space, which also opens or closes a node that holds more; a visually hidden list
 * repeats the nodes for screen readers. A graph of steps, layers or lanes is `FlowGraph`.
 * Contract: focus FOCUS-2, selection STATE-1, empty STATE-3.
 */
export const BubbleMap = ({
    label,
    nodes,
    edges,
    selectedId,
    onSelect,
    expandedIds,
    defaultExpandedIds,
    onExpandedChange,
    fanLimit = DEFAULT_FAN_LIMIT,
    height,
    fit = "readable",
    isInteractive = true,
    showControls,
    emptyLabel = "Nothing to show yet.",
    isLoading = false,
}: BubbleMapProps) => {
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

    const orbit = useMemo(() => bubbleMapLayout(nodes, edges, { expanded, fanLimit }), [nodes, edges, expanded, fanLimit])
    // The map draws the rings and the fans of the open nodes, plus the `+n` bubbles that close a fan.
    const shownNodes = useMemo<ReadonlyArray<BubbleMapNode>>(() => {
        const byId = new Map(nodes.map((node) => [node.id, node]))
        return [
            ...nodes.filter((node) => orbit.visible.has(node.id)),
            ...orbit.more.map((more) => moreNodeFor(more.id, more.count, byId.get(more.parentId))),
        ]
    }, [nodes, orbit])
    const shownEdges = useMemo<ReadonlyArray<BubbleMapEdge>>(() => {
        const shown = new Set(shownNodes.map((node) => node.id))
        return [
            ...edges.filter((edge) => shown.has(edge.source) && shown.has(edge.target)),
            ...orbit.more.map((more) => ({ id: `${more.id}-edge`, source: more.parentId, target: more.id })),
        ]
    }, [edges, orbit, shownNodes])
    const moreParents = useMemo(() => new Map(orbit.more.map((more) => [more.id, more.parentId])), [orbit])
    const dimmedIds = useMemo(() => new Set(shownNodes.filter((node) => node.isDimmed === true).map((node) => node.id)), [shownNodes])
    const pathIds = useMemo(() => pathTo(currentId, orbit), [currentId, orbit])

    const rootId = useMemo(() => (nodes.find((node) => node.isRoot === true) ?? nodes[0])?.id, [nodes])
    const flowNodes = useMemo<Array<Node<NodeData>>>(() => shownNodes.map((graphNode) => {
        const isExpandable = orbit.expandable.has(graphNode.id)
        const domAttributes = {
            ...(isExpandable && graphNode.href === undefined ? { "aria-expanded": expanded.has(graphNode.id) } : {}),
            ...(graphNode.form === "bubble" && graphNode.description !== undefined ? { "aria-description": graphNode.description } : {}),
        }
        return {
            id: graphNode.id,
            type: "flowGraph",
            position: orbit.positions.get(graphNode.id) ?? { x: 0, y: 0 },
            data: {
                graphNode: { ...graphNode, isRoot: graphNode.id === rootId },
                isSelected: graphNode.id === currentId,
                ...(isExpandable ? { isExpandable } : {}),
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
    }), [shownNodes, orbit, rootId, currentId, expanded])
    const guideNodes = useMemo<Array<Node<GuideData>>>(() => {
        if (orbit.radii.length === 0) return []
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
    const allNodes = useMemo<Array<Node<NodeData> | Node<GuideData>>>(() => [...guideNodes, ...flowNodes], [guideNodes, flowNodes])
    const flowEdges = useMemo<Array<Edge>>(() => shownEdges.map((edge) => {
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
            type: "straight",
            className: classes,
            focusable: false,
            selectable: false,
            animated: false,
        }
    }), [shownEdges, dimmedIds, pathIds])
    const signature = `orbit::${shownNodes.map((node) => node.id).join("|")}`

    // Opening a node that holds more selects it and toggles it; the `+n` bubble selects the node it closes.
    const activate = (id: string) => {
        const parentId = moreParents.get(id)
        if (parentId !== undefined) {
            select(parentId)
            return
        }
        select(id)
        if (orbit.expandable.has(id)) toggle(id)
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

    const customHeight = height === undefined || height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
    const controls = showControls ?? isInteractive
    // The readable fit grows the canvas for one map; a new set of nodes starts again from `height`.
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
            className="starci-core-flow-graph starci-core-bubble-map"
            data-component="BubbleMap"
            data-contract="FOCUS-2 STATE-1 STATE-3"
            data-grammar-flow-caption={hasBubbles && zoom < CAPTION_ZOOM ? "off" : undefined}
            data-grammar-flow-height={customHeight === undefined ? height ?? "md" : "custom"}
            data-grammar-flow-interactive={isInteractive ? "true" : "false"}
            data-grammar-flow-layout="orbit"
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
                            <Refit anchorStart={false} fitOptions={FIT_OPTIONS} maxZoom={MAX_ZOOM} onGrow={onGrow} readableZoom={readableZoom} signature={signature} />
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
                </>
            )}
        </figure>
    )
}
