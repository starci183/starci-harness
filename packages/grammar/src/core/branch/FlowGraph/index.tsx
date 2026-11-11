"use client"

import { withRegionLoading } from "../../regionScope.js"
import { useCustomTone } from "../../useCustomTone.js"
import {
    BaseEdge,
    Background,
    BackgroundVariant,
    ControlButton,
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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { CONTAIN_MIN_ZOOM, CONTROLS_INSET, FIT_OPTIONS, LANES_FIT_OPTIONS, LANES_MAX_ZOOM, MAX_ZOOM, Refit, labelFor, labelledEdges, readableZoomFor } from "./canvas.js"
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
import { useSurfaceHost } from "../../surfaceContext.js"
import { isBackEdge, portOfEdge, stepKindOf, stepsLayout, stepsNodeHeight, type StepsLayout } from "./steps.js"
export { FlowGraphLegend } from "./stepsView.js"
import { DEFAULT_STATUS_LABELS, STEPS_ARROW_BOX, STEPS_ARROW_STROKE, STEPS_TAKEN_TONE, STEPS_UNTAKEN_TONE, FlowGraphBackEdge, FlowGraphContainerView, FlowGraphLegend, FlowGraphStepEdge, FlowGraphStepView, STEP_KIND_TONES, stepAriaLabel, type ContainerNodeData, type StepNodeData } from "./stepsView.js"
import type {
    FlowGraphDirection,
    FlowGraphEdge,
    FlowGraphHeight,
    FlowGraphLayerHeader,
    FlowGraphLayout,
    FlowGraphLegendItem,
    FlowGraphNode,
    FlowGraphPositions,
    FlowGraphRunStatus,
    FlowGraphStepKind,
    FlowGraphTone,
} from "./types.js"
import type { NoChildren } from "../../tier.js"

export { lanesLayout, layeredPositions, radialPositions } from "./layout.js"
export { stepsLayout } from "./steps.js"
export type { FlowGraphAgent, FlowGraphPositions } from "./types.js"
export { STEP_KIND_TONES } from "./stepsView.js"
export type {
    FlowGraphDirection,
    FlowGraphEdge,
    FlowGraphEdgeVariant,
    FlowGraphHeight,
    FlowGraphLanesKind,
    FlowGraphLayerHeader,
    FlowGraphLayout,
    FlowGraphLegendItem,
    FlowGraphNode,
    FlowGraphNodeKind,
    FlowGraphNodeShape,
    FlowGraphNodeSize,
    FlowGraphChip,
    FlowGraphContainer,
    FlowGraphPort,
    FlowGraphRunStatus,
    FlowGraphStepKind,
    FlowGraphTone,
} from "./types.js"

export type FlowGraphProps = NoChildren & {
    /** Names the graph for assistive technology, e.g. "Second brain". */
    readonly label: string
    readonly nodes: ReadonlyArray<FlowGraphNode>
    readonly edges: ReadonlyArray<FlowGraphEdge>
    /**
     * The selected node. Pass it (with `onSelect`) to control selection; leave it out and the graph keeps its own. The node stamps
     * `data-grammar-selected` and the screen-reader list reports it. HeroUI has no graph node, so a pill draws no selected outline. A `steps` card selected
     * (0.37.35, DNA-COMMON-FLOW-SELECTED) has ONE 2px border in its status colour (the foreground without a run) and a soft tint of it; never a second ring.
     */
    readonly selectedId?: string | null
    /** Fires with the node id on click, Enter or Space, and with `null` when the empty canvas is clicked or Escape is pressed. */
    readonly onSelect?: (id: string | null) => void
    /** Fires with the node id when a node is pressed (click, Enter or Space); never with `null`. */
    readonly onNodePress?: (id: string) => void
    /**
     * `steps` only: the tone of each kind's icon tile, tag and legend swatch, over {@link STEP_KIND_TONES}. Core's palette has no purple,
     * teal or coral; an app that declares them (`GrammarToneRegistry`) maps `event`, `action` and `ask` to them here.
     */
    readonly kindTones?: Partial<Readonly<Record<FlowGraphStepKind, FlowGraphTone>>>
    /** `steps` only: a legend row of kinds under the canvas, in the given order and words. Drawn on the page only: inside a card it stands under the card as chips, `SurfaceCard note={<FlowGraphLegend items={...} />}`. */
    readonly legend?: ReadonlyArray<FlowGraphLegendItem>
    /** `steps` only: the words of the run statuses in the node's accessible name. Defaults to English. */
    readonly statusLabels?: Partial<Readonly<Record<FlowGraphRunStatus, string>>>
    /**
     * Canvas height: `sm` 16rem, `md` 24rem, `lg` 32rem, or any size of your own: a number is pixels, a string is a CSS length
     * (`"60vh"`, `"48rem"`). `fill` (0.37.33, `steps`, owner drawing graph-state): the frame takes the rest of the page height under it (the room its scroll
     * owner shows below the graph's top, less what follows the graph there), at least 22.5rem (360px), instead of hugging the graph; the graph is placed in it
     * by the opening zoom (DNA-COMMON-FLOW-OPEN-ZOOM). The map of one workflow on its own page takes `fill`.
     */
    readonly height?: FlowGraphHeight | "fill" | number | string
    /**
     * How the graph meets its canvas. `readable` (default) never fits below the zoom at which node text renders at 12px:
     * a graph that would shrink further grows the canvas height to the graph's aspect at the canvas width (the page
     * scrolls; a graph still too wide pans sideways). `contain` shrinks the whole graph into the canvas `height`, but never below zoom 0.8 (0.37.26 at 0.6, 0.8 since 0.37.29,
     * `CONTAIN_MIN_ZOOM`): a graph that needs less is drawn at 0.8 and pans (drag), even when `isInteractive` is false. A `steps` graph always fits this way.
     */
    readonly fit?: "readable" | "contain"
    /** Pan and zoom. `false` draws a static picture (a graph held at the contained fit's readable floor still pans by drag). */
    readonly isInteractive?: boolean
    /** Zoom buttons. Defaults to on while the graph is interactive. */
    readonly showControls?: boolean
    /**
     * `steps` is the card map of a workflow (0.35.0): white step cards on the well, top-down (`direction="LR"` runs across), an icon
     * tile per node `kind`, a condition card with named output ports its edges leave from, smooth curved edges with an arrowhead, dashed
     * `back` edges routed round the cards, an `end` pill, and the run overlay (`status`, `isTaken`). Its canvas is as tall as the graph
     * unless `height` is given; `headers` are not drawn.
     * `lanes` is the older branch map of a workflow: a column per stage and one row per branch of a condition, so each path reads left
     * to right on one line; its edges are orthogonal with rounded corners and an arrowhead, a branch label sits on its own edge, and
     * the node `kind` sets the tone (trigger neutral, condition warning, execute its tone, output accent). Its canvas is as tall as
     * the graph unless `height` is given.
     * `radial` places the nodes on rings round the root; `layered` puts a DAG in layers along `direction`; `manual` uses each
     * node's `position`. Defaults to `radial`, or to `layered` when a `direction` is given. A value-sized map of bubbles is `BubbleMap`.
     */
    readonly layout?: FlowGraphLayout
    /**
     * The way edges run, `TB` (top to bottom) or `LR` (left to right); a `steps` graph defaults to `LR` (0.37.27). It places the target handle on the entering side and the
     * source handle on the leaving side so edges follow the layout. Leave it out for the radial layout (both handles on top).
     */
    readonly direction?: FlowGraphDirection
    /** Titles for the layers of a layered layout: a column header above each layer for `LR`, a lane header beside it for `TB`. */
    readonly headers?: ReadonlyArray<FlowGraphLayerHeader>
    /** The canvas ground (0.37.5): `dots` draws a subtle dot grid (18px, the muted token) behind the graph, n8n-like. Default `dots` for `layout="steps"` (0.37.27), `none` otherwise. */
    readonly background?: "none" | "dots"
    /** Turns on dragging the blocks (0.37.5): the user rearranges them, edges re-route live, and a reset control joins the zoom group. */
    /**
     * How the disconnected parts of a `steps` graph (islands) are arranged (0.37.8): `wrap` (default) fills rows left to right by the canvas width and then starts the
     * next row, 48 apart on both axes; `stack` puts them in one column.
     */
    readonly islands?: "stack" | "wrap"
    readonly isEditable?: boolean
    /** The saved arrangement (0.37.5): the centre of each node the user moved, overriding the auto layout for those ids (a loop card's children too). */
    readonly positions?: FlowGraphPositions
    /** Fires on drag end with the full map of moved nodes, and with `{}` when the reset control returns to the auto layout. */
    readonly onPositionsChange?: (positions: FlowGraphPositions) => void
    /** The accessible name of the reset control. Default "Sắp xếp lại". */
    readonly resetLabel?: string
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

const NODE_BUILT_IN_TONES: readonly string[] = ["neutral", "accent", "success", "warning", "danger", "muted"]

/** The tone a node kind draws in a `lanes` graph: an execute node keeps its own tone (accent by default; an app-declared tone paints its own pair). */
const toneOf = (node: FlowGraphNode): FlowGraphTone => {
    if (node.isPlaceholder === true) return "muted"
    if (node.kind === "trigger") return "neutral"
    if (node.kind === "condition") return "warning"
    if (node.kind === "output") return "accent"
    if (node.kind === "execute") return node.tone ?? "accent"
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
    const custom = useCustomTone(toneOf(graphNode), NODE_BUILT_IN_TONES)
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
            ref={custom.ref as never}
            {...custom.attrs}
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

const EDGE_TYPES: EdgeTypes = { flowGraphLane: FlowGraphLaneEdge, flowGraphStep: FlowGraphStepEdge, flowGraphBack: FlowGraphBackEdge }
const EDGE_LABEL_PADDING: [number, number] = [COMMON_SPACING_PX[2], COMMON_SPACING_PX[1]]
const LABEL_RADIUS = COMMON_SPACING_PX[1]
const NODE_TYPES: NodeTypes = { flowGraph: FlowGraphNodeView, flowGraphHeader: FlowGraphHeaderView, flowGraphStep: FlowGraphStepView, flowGraphContainer: FlowGraphContainerView }
/** A steps graph is laid out with its own margin, so like lanes its fit keeps a small one and never magnifies. */
const STEPS_MAX_ZOOM = 1
/** The pixel height of a named or numeric canvas `height` (a CSS length string has none): the cap of a contained steps graph. */
const heightCapPx = (height: FlowGraphHeight | "fill" | number | string | undefined): number | null =>
    height === "sm" ? 256 : height === "md" ? 384 : height === "lg" ? 512 : typeof height === "number" ? height : null
const HEADER_OFFSET = 70
/** The least height of a `fill` frame (0.37.33): 22.5rem. */
export const FLOW_FILL_MIN = 360

/** The element that scrolls the page around `node`: the nearest ancestor whose block overflow scrolls, else the document. */
const scrollOwnerOf = (node: HTMLElement): HTMLElement => {
    for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) break
        const overflow = getComputedStyle(parent).overflowY
        if (overflow === "auto" || overflow === "scroll") return parent
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement
}

/** The last laid-out child of an element (absolute, fixed and hidden children are not content that follows). */
const lastInFlow = (parent: HTMLElement): HTMLElement | null => {
    for (let child = parent.lastElementChild; child !== null; child = child.previousElementSibling) {
        if (!(child instanceof HTMLElement)) continue
        const style = getComputedStyle(child)
        if (style.display !== "none" && style.position !== "absolute" && style.position !== "fixed") return child
    }
    return null
}

/**
 * The canvas height of a `fill` frame (0.37.33): the height its scroll owner shows, less where the figure starts in it, less what follows the figure (the
 * siblings after it and the end padding of every box up to the scroll owner: a legend, a caption), less the figure's own parts besides the canvas; at least
 * {@link FLOW_FILL_MIN}. Measured from the layout, so a well that is stretched to the page (min-height) is not counted as content after the graph.
 */
const fillHeightOf = (figure: HTMLElement, canvas: HTMLElement): number => {
    const owner = scrollOwnerOf(figure)
    const isDocument = owner === document.scrollingElement || owner === document.documentElement
    const view = isDocument ? window.innerHeight : owner.clientHeight
    const ownerTop = isDocument ? 0 : owner.getBoundingClientRect().top + owner.clientTop
    const figureBox = figure.getBoundingClientRect()
    const top = figureBox.top - ownerTop + (isDocument ? window.scrollY : owner.scrollTop)
    let after = 0
    let node: HTMLElement = figure
    for (let parent = figure.parentElement; parent !== null && node !== owner; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const last = lastInFlow(parent)
        if (last !== null && last !== node) after += Math.max(0, last.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom)
        if (parent === owner || (isDocument && parent === document.body)) break
        after += Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth)
        node = parent
    }
    const own = figureBox.height - canvas.getBoundingClientRect().height
    return Math.max(FLOW_FILL_MIN, Math.floor(view - top - after - own))
}
const HEADER_SIDE_GAP = COMMON_SPACING_PX[6]
/**
 * A node-and-edge map drawn with React Flow (`@xyflow/react`, a peer dependency) in grammar tokens. The radial layout
 * puts the root in the centre with its children on a ring and their children on an outer ring around them. Nodes are
 * keyboard focusable (Tab) and selectable with Enter or Space; a visually hidden list repeats the nodes for screen readers.
 * Contract: focus FOCUS-2, selection STATE-1, empty STATE-3.
 */
/**
 * A FlowGraph on the page is a framed figure. Inside a surface (a card, a pane, a drawer) it draws NO frame of its own (no frame inside a frame:
 * `data-grammar-flow-framed="false"`) and no legend; the legend stands under the card as chips: `<SurfaceCard note={<FlowGraphLegend items={...} />}>`.
 */
const FlowGraphInner = ({
    label,
    nodes,
    edges,
    selectedId,
    onSelect,
    onNodePress,
    kindTones: kindTonesProp,
    legend,
    statusLabels: statusLabelsProp,
    height,
    fit = "readable",
    isInteractive = true,
    showControls,
    layout: layoutProp,
    direction,
    headers,
    background: backgroundProp,
    islands = "wrap",
    isEditable = false,
    positions: positionsProp,
    onPositionsChange,
    resetLabel = "Sắp xếp lại",
    emptyLabel = "Nothing to show yet.",
    isLoading = false,
}: FlowGraphProps) => {
    // No frame inside a frame (0.36.0): in a surface the figure is unframed and its legend stands under the card (`SurfaceCard note`).
    const isFramed = useSurfaceHost() === null
    const [ownSelectedId, setOwnSelectedId] = useState<string | null>(null)
    const currentId = selectedId === undefined ? ownSelectedId : selectedId
    const select = (id: string | null) => {
        if (selectedId === undefined) setOwnSelectedId(id)
        onSelect?.(id)
    }

    const layout: FlowGraphLayout = layoutProp ?? (direction === undefined ? "radial" : "layered")
    // 0.37.27 (drawing C): a steps graph stands on the dotted ground by default, on the page and inside a drawer alike.
    const background = backgroundProp ?? (layout === "steps" ? "dots" : "none")
    // 0.37.27 (owner, drawing C): a steps graph reads LEFT → RIGHT by default; `direction="TB"` keeps the top-down map.
    const flowDirection: FlowGraphDirection | undefined = layout === "lanes" || layout === "steps" ? direction ?? "LR" : direction ?? (layout === "layered" ? "TB" : undefined)
    // The default kind tones (event accent, action success, condition warning, ask danger, wait neutral, end success) apply unless the app declares one; an entry left undefined never wipes a default.
    const kindTones = useMemo(() => ({ ...STEP_KIND_TONES, ...Object.fromEntries(Object.entries(kindTonesProp ?? {}).filter(([, tone]) => tone !== undefined)) }), [kindTonesProp])
    const statusLabels = useMemo(() => ({ ...DEFAULT_STATUS_LABELS, ...statusLabelsProp }), [statusLabelsProp])
    // The width islands wrap to: the figure's own width, measured (0.37.8); unknown until it mounts.
    const figureRef = useRef<HTMLElement>(null)
    const [measured, setMeasured] = useState<number | undefined>(undefined)
    useEffect(() => {
        const figure = figureRef.current
        if (figure === null || layout !== "steps" || islands !== "wrap" || typeof ResizeObserver === "undefined") return undefined
        const observer = new ResizeObserver(([entry]) => {
            const width = Math.round(entry?.contentRect.width ?? 0)
            if (width > 0) setMeasured((current) => (current !== undefined && Math.abs(current - width) < 24 ? current : width))
        })
        observer.observe(figure)
        return () => observer.disconnect()
    }, [layout, islands])
    // `height="fill"` (0.37.33): the frame takes the rest of the page height, measured once laid out and again when the page resizes.
    const isFill = height === "fill"
    const [fillHeight, setFillHeight] = useState<number | null>(null)
    useEffect(() => {
        const figure = figureRef.current
        if (!isFill || figure === null) return undefined
        const measure = () => {
            const canvas = figure.querySelector<HTMLElement>(":scope > .starci-core-flow-graph-canvas")
            if (canvas === null) return
            const next = fillHeightOf(figure, canvas)
            setFillHeight((current) => (current !== null && Math.abs(current - next) < 2 ? current : next))
        }
        measure()
        window.addEventListener("resize", measure)
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
        observer?.observe(scrollOwnerOf(figure))
        return () => {
            window.removeEventListener("resize", measure)
            observer?.disconnect()
        }
    }, [isFill, isLoading, nodes.length])
    const steps = useMemo<StepsLayout | null>(() => layout === "steps" ? stepsLayout(nodes, edges, flowDirection ?? "LR", { islands, ...(measured === undefined ? {} : { width: measured }) }) : null, [layout, nodes, edges, flowDirection, islands, measured])
    const isRun = useMemo(() => steps !== null && (nodes.some((node) => node.status !== undefined) || edges.some((edge) => edge.isTaken !== undefined)), [steps, nodes, edges])
    const nodeLabel = (node: FlowGraphNode) => steps === null ? labelFor(node) : stepAriaLabel(node, statusLabels)
    const dimmedIds = useMemo(() => new Set(nodes.filter((node) => node.isDimmed === true).map((node) => node.id)), [nodes])

    const lanes = useMemo<LanesLayout | null>(() => layout === "lanes" ? lanesLayout(nodes, edges) : null, [layout, nodes, edges])
    const layered = useMemo(() => layout === "layered" ? layeredPositions(nodes, edges, flowDirection ?? "TB") : null, [layout, nodes, edges, flowDirection])
    // The arrangement the user made (0.37.5): `positions` when the app holds it, else our own copy; `live` is the node under the pointer while it is dragged.
    const [ownMoved, setOwnMoved] = useState<FlowGraphPositions>({})
    const [live, setLive] = useState<FlowGraphPositions>({})
    const moved = positionsProp ?? ownMoved
    const placed = useCallback((id: string, auto: { readonly x: number, readonly y: number }) => live[id] ?? moved[id] ?? auto, [live, moved])
    const commitMoved = (next: FlowGraphPositions) => {
        setOwnMoved(next)
        setLive({})
        onPositionsChange?.(next)
    }
    const positions = useMemo(() => {
        if (layout === "radial") return radialPositions(nodes, edges)
        if (lanes !== null) return lanes.positions
        if (steps !== null) return steps.positions
        return layered?.positions ?? null
    }, [layout, nodes, edges, layered, lanes, steps])
    const rootId = flowGraphRoot(nodes)?.id
    /**
     * TOP-ALIGNED LAYERS (0.37.29). The layout places a step by its centre from an estimated height; a card that draws a few px taller or shorter than the estimate
     * (a title that wraps differently) then stood off its layer's top line (the fan-out row drifted 1.5px). A top-down step is drawn from its TOP edge instead (origin
     * [0.5, 0], the estimate converts the centre once), so a layer's cards share one top line whatever they measure. Positions in and out (`positions`, drags) stay centres.
     */
    const topOffsets = useMemo(() => {
        const offsets = new Map<string, number>()
        if (steps === null || (flowDirection ?? "TB") !== "TB") return offsets
        // The layout centres a layer's cards on one line; the top line is that centre less half the layer's tallest estimate, the same for every card of the layer.
        const estimate = (node: FlowGraphNode) => stepsNodeHeight(node, (steps.ports.get(node.id) ?? []).length, "TB")
        const tallest = new Map<string, number>()
        const keyOf = (node: FlowGraphNode) => `${String(steps.layers.get(node.id) ?? 0)}:${String(Math.round(steps.positions.get(node.id)?.y ?? 0))}`
        const cards = nodes.filter((node) => !steps.boxes.has(node.id))
        for (const node of cards) tallest.set(keyOf(node), Math.max(tallest.get(keyOf(node)) ?? 0, estimate(node)))
        for (const node of cards) offsets.set(node.id, (tallest.get(keyOf(node)) ?? estimate(node)) / 2)
        return offsets
    }, [steps, nodes, flowDirection])
    const toTop = useCallback((id: string, point: { readonly x: number, readonly y: number }) => ({ x: point.x, y: point.y - (topOffsets.get(id) ?? 0) }), [topOffsets])
    const fromTop = useCallback((id: string, point: { readonly x: number, readonly y: number }) => ({ x: point.x, y: point.y + (topOffsets.get(id) ?? 0) }), [topOffsets])
    const flowNodes = useMemo<Array<Node<NodeData> | Node<StepNodeData> | Node<ContainerNodeData>>>(() => steps !== null ? [...nodes].sort((a, b) => Number(b.container !== undefined) - Number(a.container !== undefined)).map((graphNode): Node<StepNodeData> | Node<ContainerNodeData> => {
        const kind = stepKindOf(graphNode)
        const box = steps.boxes.get(graphNode.id)
        if (box !== undefined) {
            return {
                id: graphNode.id,
                type: "flowGraphContainer",
                position: placed(graphNode.id, steps.positions.get(graphNode.id) ?? { x: 0, y: 0 }),
                data: { graphNode, direction: flowDirection ?? "TB", isSelected: graphNode.id === currentId },
                style: { width: box.width, height: box.height },
                width: box.width,
                height: box.height,
                zIndex: 0,
                selected: graphNode.id === currentId,
                ariaLabel: graphNode.container?.label ?? graphNode.label,
                draggable: false,
                connectable: false,
            }
        }
        return {
            id: graphNode.id,
            type: "flowGraphStep",
            position: toTop(graphNode.id, placed(graphNode.id, steps.positions.get(graphNode.id) ?? { x: 0, y: 0 })),
            ...(topOffsets.has(graphNode.id) ? { origin: [0.5, 0] as [number, number] } : {}),
            data: {
                graphNode,
                kind,
                tone: graphNode.isPlaceholder === true ? "muted" : graphNode.tone ?? kindTones[kind],
                ports: steps.ports.get(graphNode.id) ?? [],
                hasEdgeOut: edges.some((edge) => edge.source === graphNode.id),
                isSelected: graphNode.id === currentId,
                direction: flowDirection ?? "TB",
                ...(graphNode.status === undefined ? {} : { statusLabel: statusLabels[graphNode.status] }),
            },
            selected: graphNode.id === currentId,
            ariaLabel: stepAriaLabel(graphNode, statusLabels),
            zIndex: 1,
            draggable: isEditable,
            connectable: false,
            ...(graphNode.href === undefined ? {} : { focusable: false }),
        }
    }) : nodes.map((graphNode) => ({
        id: graphNode.id,
        type: "flowGraph",
        position: placed(graphNode.id, positions?.get(graphNode.id) ?? graphNode.position ?? { x: 0, y: 0 }),
        data: {
            graphNode: layout === "radial" ? { ...graphNode, isRoot: graphNode.id === rootId } : graphNode,
            isSelected: graphNode.id === currentId,
            ...(flowDirection === undefined ? {} : { direction: flowDirection }),
        },
        selected: graphNode.id === currentId,
        ariaLabel: labelFor(graphNode),
        draggable: isEditable,
        connectable: false,
        // A link node keeps one keyboard stop: the anchor inside it.
        ...(graphNode.href === undefined ? {} : { focusable: false }),
    })), [nodes, positions, layout, rootId, currentId, flowDirection, steps, kindTones, statusLabels, placed, isEditable, toTop, topOffsets])
    const headerNodes = useMemo<Array<Node<HeaderData>>>(() => {
        if (headers === undefined || headers.length === 0 || flowDirection === undefined || layout === "steps") return []
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
    const allNodes = useMemo<Array<Node<NodeData> | Node<HeaderData> | Node<StepNodeData> | Node<ContainerNodeData>>>(() => [...headerNodes, ...flowNodes], [headerNodes, flowNodes])
    const flowEdges = useMemo<Array<Edge>>(() => steps !== null ? edges.flatMap((edge): Edge[] => {
        const route = steps.back.get(edge.id)
        const isBack = isBackEdge(edge)
        if (isBack && route === undefined) return []
        const port = isBack ? undefined : portOfEdge(edge, steps.ports.get(edge.source) ?? [])
        const run = !isRun ? "" : edge.isTaken === true ? "starci-core-flow-graph-edge-taken" : "starci-core-flow-graph-edge-untaken"
        const classes = [
            "starci-core-flow-graph-edge",
            isBack ? "starci-core-flow-graph-edge-back" : "",
            edge.isPlaceholder === true ? "starci-core-flow-graph-edge-placeholder" : "",
            dimmedIds.has(edge.target) ? "starci-core-flow-graph-edge-dimmed" : "",
            port?.tone === "danger" ? "starci-core-flow-graph-edge-danger" : "",
            run,
        ].filter(Boolean).join(" ")
        // A branch label lives on its port, not on the line; a label with no port (a back edge, a plain edge) is a pill on the line.
        const label = port === undefined && edge.label !== undefined && edge.label !== "" ? { label: edge.label } : {}
        return [{
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: isBack ? "flowGraphBack" : "flowGraphStep",
            sourceHandle: route !== undefined ? `back-out-${route.sourceSide}` : port === undefined ? "out" : `port:${port.id}`,
            targetHandle: route !== undefined ? `back-in-${route.targetSide}` : "in",
            data: route === undefined
                ? { direction: flowDirection ?? "LR", ...(steps.trunks.has(edge.id) ? { lane: steps.trunks.get(edge.id) } : {}) }
                : { route, direction: flowDirection ?? "LR" },
            // Drawing C (0.37.27): a small solid triangle in the edge's colour; a run's taken path is the success green.
            markerEnd: { type: MarkerType.ArrowClosed, markerUnits: "userSpaceOnUse", width: STEPS_ARROW_BOX, height: STEPS_ARROW_BOX, strokeWidth: STEPS_ARROW_STROKE, color: port?.tone === "danger" ? "var(--danger)" : isRun && edge.isTaken === true ? STEPS_TAKEN_TONE : isRun ? STEPS_UNTAKEN_TONE : "var(--muted)" },
            // Above the cards (0.37.33: the nodes stand at 1), so the round dot each edge starts with is drawn whole, centred ON its source card's edge.
            zIndex: 2,
            className: classes,
            ...label,
            focusable: false,
            selectable: false,
            animated: false,
        }]
    }) : edges.map((edge) => {
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
    }), [edges, layout, layered, lanes, steps, isRun, flowDirection, dimmedIds])
    const edgeLabels = useMemo(() => labelledEdges(nodes, edges), [nodes, edges])
    const signature = `${layout}:${flowDirection ?? ""}:${headerNodes.length}:${nodes.map((node) => node.id).join("|")}`

    const activate = (id: string) => {
        select(id)
        onNodePress?.(id)
    }
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

    const naturalHeight = lanes !== null ? lanesNaturalHeight(lanes, headerNodes.length > 0) : steps !== null ? Math.ceil(steps.height) : null
    const customHeight = isFill
        ? `${String(fillHeight ?? FLOW_FILL_MIN)}px`
        : height === undefined && naturalHeight !== null ? `${naturalHeight}px` : height === undefined || height === "sm" || height === "md" || height === "lg" ? undefined : typeof height === "number" ? `${height}px` : height
    const fitOptions = layout === "lanes" ? LANES_FIT_OPTIONS : layout === "steps" ? LANES_FIT_OPTIONS : FIT_OPTIONS
    const maxZoom = layout === "lanes" ? LANES_MAX_ZOOM : layout === "steps" ? STEPS_MAX_ZOOM : MAX_ZOOM
    const controls = showControls ?? isInteractive
    // The readable fit grows the canvas for one graph; a new set of nodes or layout starts again from `height`.
    const readableZoom = fit === "readable" && nodes.length > 0 ? readableZoomFor(nodes) : null
    const [growth, setGrowth] = useState<{ readonly signature: string, readonly height: number } | null>(null)
    const grownHeight = !isFill && growth !== null && growth.signature === signature ? growth.height : null
    const onGrow = useCallback((next: number) => setGrowth({ signature, height: next }), [signature])
    // 0.37.26: a contained fit (every steps graph, any fit="contain") holds the readable floor; a graph held there pans, even when it is otherwise static.
    const containFloor = layout === "steps" || fit === "contain" ? CONTAIN_MIN_ZOOM : null
    const [floored, setFloored] = useState(false)
    // A grown canvas is taller than the screen may be: the wheel scrolls the page, the zoom buttons still zoom.
    const wheelZooms = isInteractive && grownHeight === null && layout !== "lanes" && layout !== "steps"
    const style: CSSProperties | undefined = customHeight === undefined && grownHeight === null && steps === null ? undefined : {
        ...(steps === null ? {} : { "--grammar-flow-card-width": `${steps.cardWidth}px` }),
        ...(customHeight === undefined ? {} : { "--starci-flow-height": customHeight }),
        ...(grownHeight === null ? {} : { "--starci-flow-grown-height": `${grownHeight}px` }),
    } as CSSProperties

    return (
        <figure
            ref={figureRef}
            aria-label={label}
            className="starci-core-flow-graph"
            data-grammar-flow-framed={isFramed ? "true" : "false"}
            data-component="FlowGraph"
            data-contract="FOCUS-2 STATE-1 STATE-3"
            data-grammar-flow-direction={flowDirection}
            data-grammar-flow-height={isFill ? "fill" : customHeight === undefined ? height ?? "md" : "custom"}
            data-grammar-flow-interactive={isInteractive ? "true" : "false"}
            data-grammar-flow-layout={layout}
            data-grammar-flow-fit={fit}
            data-grammar-flow-grown={grownHeight === null ? undefined : "true"}
            data-grammar-flow-floored={floored ? "true" : undefined}
            data-grammar-flow-run={isRun ? "true" : undefined}
            data-grammar-flow-background={background}
            data-grammar-flow-editable={isEditable ? "true" : undefined}
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
                            minZoom={containFloor ?? 0.1}
                            nodeOrigin={[0.5, 0.5]}
                            nodeTypes={NODE_TYPES}
                            nodes={allNodes}
                            nodesConnectable={false}
                            nodesDraggable={isEditable}
                            onNodesChange={(changes) => {
                                if (!isEditable) return
                                const drag = changes.flatMap((change) => change.type === "position" && change.position !== undefined ? [[change.id, fromTop(change.id, change.position)] as const] : [])
                                if (drag.length > 0) setLive((current) => ({ ...current, ...Object.fromEntries(drag) }))
                            }}
                            onNodeDragStop={(_event, node) => commitMoved({ ...moved, ...live, [node.id]: fromTop(node.id, node.position) })}
                            nodesFocusable
                            onNodeClick={(_event, node) => { if (node.type === "flowGraph" || node.type === "flowGraphStep" || node.type === "flowGraphContainer") activate(node.id) }}
                            onPaneClick={() => { if (currentId !== null) select(null) }}
                            panOnDrag={isInteractive || floored}
                            panOnScroll={false}
                            preventScrolling={wheelZooms}
                            proOptions={{ hideAttribution: true }}
                            zoomOnDoubleClick={false}
                            zoomOnPinch={isInteractive}
                            zoomOnScroll={wheelZooms}
                        >
                            {background === "dots"
                                ? <Background className="starci-core-flow-graph-background" gap={18} size={1.2} variant={BackgroundVariant.Dots} />
                                : <Background className="starci-core-flow-graph-background" gap={1000} size={0} />}
                            {controls ? (
                                <Controls aria-label={`${label}: zoom`} className="starci-core-flow-graph-controls" showInteractive={false}>
                                    {isEditable ? <ControlButton aria-label={resetLabel} className="starci-core-flow-graph-reset" onClick={() => commitMoved({})} title={resetLabel} /> : null}
                                </Controls>
                            ) : null}
                            <Refit fixedHeight={isFill} containFloor={containFloor} onFloor={setFloored} inset={controls ? CONTROLS_INSET : 0} heightCap={fit === "contain" ? heightCapPx(height) : null} stepsFit={layout === "steps"} direction={flowDirection ?? "TB"} anchorStart={layout === "lanes"} fitOptions={fitOptions} maxZoom={maxZoom} onGrow={onGrow} readableZoom={readableZoom} signature={signature} />
                        </ReactFlow>
                    </div>
                    <ul className="starci-core-visually-hidden" data-grammar-flow-fallback="true">
                        {nodes.map((node) => <li key={node.id} {...(node.id === currentId ? { "aria-current": "true" as const } : {})}>{nodeLabel(node)}</li>)}
                    </ul>
                    {edgeLabels.length === 0 ? null : (
                        <ul className="starci-core-visually-hidden" data-grammar-flow-edge-fallback="true">
                            {edgeLabels.map((edge) => <li key={edge.id}>{edge.text}</li>)}
                        </ul>
                    )}
                    {!isFramed || steps === null || legend === undefined || legend.length === 0 ? null : <FlowGraphLegend items={legend} kindTones={kindTones} />}
                </>
            )}
        </figure>
    )
}

/**
 * A node-and-edge map drawn with React Flow (`@xyflow/react`, a peer dependency) in grammar tokens. The radial layout
 * puts the root in the centre with its children on a ring and their children on an outer ring around them. Nodes are
 * keyboard focusable (Tab) and selectable with Enter or Space; a visually hidden list repeats the nodes for screen readers.
 * Contract: focus FOCUS-2, selection STATE-1, empty STATE-3.
 */
export const FlowGraph = withRegionLoading(FlowGraphInner)
