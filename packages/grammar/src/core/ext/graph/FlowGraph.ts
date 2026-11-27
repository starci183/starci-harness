"use client"

import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react"
import { createElement as h, isValidElement, useEffect, useMemo, useState, type CSSProperties, type ElementType, type ReactElement, type ReactNode } from "react"
import { POSITION_OF, buildBarNodes, buildFlowEdges, buildFlowNodes, containerKind, type BarRfNode, type FlowRfNode } from "./build.js"
import { layoutSpine } from "./spine.js"
import { layoutLayered } from "./layered.js"
import { foldFlow, type FlowCollapse } from "./collapse.js"
import type { CanvasLayout } from "./shared/canvas.js"
import { Badge, IconTile, InlineStatus, Text, type IconSource } from "../../index.js"
import { focusStep } from "./shared/status.js"
import { useLayoutDirection } from "./shared/phone.js"
import { GraphCanvas, type Placement } from "./shared/canvas.js"
import { FlowLegend } from "./shared/legend.js"
import { IN_PORT, OUT_PORT, PORT_COLUMN, PORT_ROW_TB, entrySide, resolveFlow, type FlowLayoutMode, type ResolvedPort } from "./model.js"
import { StepEdge } from "./shared/StepEdge.js"
import { badgeTone, findConcurrentRunning, markState, nodeClassName, statusTone } from "./shared/status.js"
import type { FlowChip, FlowKindTones, FlowLegendItem, FlowNode, FlowStatus, FlowStatusLabels, GraphCanvasProps, GraphEdge, GraphLinkComponent } from "./types.js"

export interface FlowGraphProps extends GraphCanvasProps {
    readonly nodes: readonly FlowNode[]
    readonly edges: readonly GraphEdge[]
    /** The six status words in the app's language; a node is named by its label and its word. */
    readonly statusLabels: FlowStatusLabels
    /** The words an untaken branch of a decision carries on its edge ("Skipped"). Left out, the untaken branch is drawn faded and dotted with no words. */
    readonly skippedLabel?: string
    /** The tone of the icon tile of each kind, over the defaults (event accent, action success, condition warning, ask danger, wait default, end success). */
    readonly kindTones?: FlowKindTones
    /** A legend row under the canvas: swatches (a kind, a state or an edge style) and the app's words. */
    readonly legend?: readonly FlowLegendItem[]
    /** The renderer of the link of a node with an `href`: the app's router link. Default a plain `<a>`. */
    readonly linkComponent?: GraphLinkComponent
    /**
     * How the flow is laid out. `spine` (default): one straight centred column for the main run, side roads in columns to its right, edges only at the
     * middles of the sides with the fewest bends, kinds drawn apart, merge points and bars (see `SPINE`); it always runs top to bottom, so `direction` is
     * not read. `layered`: ELK's layered layout, `LR` or `TB`, with ports drawn on the cards.
     */
    readonly layout?: FlowLayoutMode
    /**
     * Fires with the node id when a step is opened (click, Enter or Space on it): the app opens the step's drawer (`FlowStepDrawer`, a wide right-side
     * Drawer) with what it has of the step. It fires with `onNodePress`, never for a fork or merge bar.
     */
    readonly onNodeOpen?: (id: string) => void
    /**
     * Fold a long flow: past `above` steps (default 20) every side road the run did not take hangs behind one pill ("+N steps", `label(n)`, the app's words)
     * and the spine and every step the run reached stay drawn; pressing a pill unfolds its road. Left out, nothing folds.
     */
    readonly collapse?: FlowCollapse
}

/**
 * The least zoom a flow opens and fits at: a card of the spine layout stays at least 210px wide and its words readable; a longer or wider flow is panned,
 * never shrunk past it. The first view fits the frame's width, and a tall flow runs on below its focus.
 */
export const FLOW_READABLE_ZOOM = 0.75

/** The room the card body leaves for its ports, from the layout's own sizes plus the 8px gap: the column down the end side (LR) or the row along the bottom (TB). */
const PORTS_GAP = 8
const PORTS_RESERVE = { "--starci-graph-ports-inline": `${String(PORT_COLUMN + PORTS_GAP)}px`, "--starci-graph-ports-block": `${String(PORT_ROW_TB + PORTS_GAP)}px` } as CSSProperties

/** The chips a card shows: the first three, the rest as one "+N" pill. */
const CHIPS_SHOWN = 3

/**
 * A node's mark, the core's status mark (B): the node's icon on its state's plate (`IconTile state source`). An icon given as an element of an icon
 * component (`<TruckIcon />`) is drawn by its component; any other node (a picture, an intrinsic element) keeps its look as artwork on a neutral plate.
 */
/** The clock a wait step shows when the app gives it no icon of its own (the wait shape, a pill with a clock). */
const ClockGlyph: IconSource = (props) =>
    h(
        "svg",
        { ...props, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
        h("circle", { cx: 12, cy: 12, r: 9 }),
        h("path", { d: "M12 7v5l3 2" }),
    )

/** The outline of a hexagon shape (a switch, or a call with a dashed stroke): flat top and bottom, its points at the middles of its sides. */
const HEX_POINT = 22
const hexagon = (width: number, height: number): ReactElement => {
    const k = Math.min(HEX_POINT, width / 4)
    const points = [[k, 1.5], [width - k, 1.5], [width - 1.5, height / 2], [width - k, height - 1.5], [k, height - 1.5], [1.5, height / 2]].map(([x, y]) => `${String(x)},${String(y)}`).join(" ")
    return h("svg", { className: "starci-graph-shape-outline", viewBox: `0 0 ${String(width)} ${String(height)}`, "aria-hidden": true }, h("polygon", { points }))
}

const nodeMark = (status: FlowStatus, icon: ReactNode | IconSource): ReactElement => {
    const state = markState(status)
    if (icon === undefined || icon === null) return h(IconTile, { state })
    if (typeof icon === "function") return h(IconTile, { state, source: icon as IconSource })
    if (isValidElement(icon) && typeof icon.type !== "string") return h(IconTile, { state, source: icon.type as IconSource })
    return h(IconTile, { state, artwork: icon })
}

/** The status on the card's top edge: the core's InlineStatus in a caption line (the chip size: a 20px glyph and 12px words, the owner's icon rule), on the surface so the edge never crosses it. */
const statusChip = (status: FlowStatus, word: string): ReactElement =>
    h("span", { className: "starci-graph-status starci-type-caption", "data-status": status }, h(InlineStatus, { state: markState(status), label: word }))

const chips = (items: readonly FlowChip[] | undefined): ReactElement | null => {
    if (items === undefined || items.length === 0) return null
    const shown = items.slice(0, CHIPS_SHOWN)
    const more = items.length - shown.length
    return h(
        "span",
        { className: "starci-graph-chips" },
        shown.map((chip, index) => h(Badge, { key: index, tone: chip.tone === "accent" ? "accent" : "neutral" }, chip.label)),
        more > 0 ? h(Badge, { key: "more", tone: "neutral" }, `+${String(more)}`) : null,
    )
}

const handleProps = { isConnectable: false, className: "starci-graph-handle" } as const

/**
 * The four midpoint ports of a node in the spine layout: in at the top-mid (a forward edge) and the left-mid (a loop), out at the bottom-mid (the main road),
 * the right-mid (a side road) and the left-mid (a loop). The routes are the layout's; the handles anchor them once a person drags a node.
 */
const spineHandles = (): ReactElement[] => [
    h(Handle, { ...handleProps, key: "in", id: "in", type: "target", position: Position.Top }),
    h(Handle, { ...handleProps, key: "loop-in", id: "loop-in", type: "target", position: Position.Left }),
    h(Handle, { ...handleProps, key: "out", id: "out", type: "source", position: Position.Bottom }),
    h(Handle, { ...handleProps, key: "side", id: "side", type: "source", position: Position.Right }),
    h(Handle, { ...handleProps, key: "loop-out", id: "loop-out", type: "source", position: Position.Left }),
]

/** A port's pill and the handle an edge leaves from; `centered` puts the handle at the pill's centre (a pill that straddles a frame's edge). */
const portPill = (port: ResolvedPort, centered: boolean, style?: CSSProperties): ReactElement =>
    h(
        "span",
        { key: port.id, className: "starci-graph-port", "data-tone": port.tone, "data-side": port.side, ...(style === undefined ? {} : { style }) },
        h(Badge, { tone: badgeTone(port.tone) }, port.label),
        h(Handle, { ...handleProps, id: `port:${port.id}`, type: "source", position: POSITION_OF[port.side], className: centered ? "starci-graph-handle starci-graph-handle-center" : "starci-graph-handle" }),
    )

/** An exit of a loop frame is anchored at the point ELK put its port. */
const exitStyle = (at: { readonly x: number; readonly y: number } | undefined): CSSProperties | undefined => (at === undefined ? undefined : { insetInlineStart: at.x, insetBlockStart: at.y })

const nodeFlags = (data: FlowRfNode["data"]): Record<string, string | undefined> => ({
    "data-status": data.status,
    "data-tone": statusTone(data.status),
    "data-tile-tone": data.tileTone,
    "data-kind": data.node.kind,
    "data-wait": data.status === "wait" ? data.node.wait?.kind : undefined,
    "data-selected": data.selected ? "true" : undefined,
    "data-dimmed": data.node.dimmed === true ? "true" : undefined,
    "data-placeholder": data.node.placeholder === true ? "true" : undefined,
})

const handles = (data: FlowRfNode["data"], sourcePosition: Position | undefined, targetPosition: Position | undefined, firstSide?: Position): ReactElement[] => [
    h(Handle, { ...handleProps, key: "in", id: "in", type: "target", position: targetPosition ?? POSITION_OF[entrySide(data.direction)] }),
    h(Handle, { ...handleProps, key: "out", id: "out", type: "source", position: firstSide ?? sourcePosition ?? Position.Right }),
]

const makeNodeTypes = (Link: ElementType | undefined): NodeTypes => {
    const head = (data: FlowRfNode["data"]): ReactElement => {
        const { node } = data
        // A wait with no icon of its own shows the clock; a switch shows its count ("3 ways", the app's words) as a badge, not a figure.
        const icon = node.icon ?? (data.shape === "pill" ? ClockGlyph : undefined)
        const badgeCount = data.shape === "hexagon"
        const sub = (data.status === "wait" ? node.wait?.detail : undefined) ?? (data.status === "error" ? node.errorReason : undefined) ?? node.description
        return h(
            "span",
            { className: "starci-graph-node-head" },
            // The core's status mark (B): the node's own icon on its state's plate, or the state's glyph when it has none.
            h("span", { className: "starci-graph-node-icon", "data-status": data.status }, nodeMark(data.status, icon)),
            h(
                "span",
                { className: "starci-graph-node-text" },
                h(Text, { role: "label.item", overflow: "truncate" }, node.label),
                sub === undefined ? null : h(Text, { role: "label.field", overflow: "truncate" }, sub),
            ),
            node.count === undefined || node.count === ""
                ? null
                : h("span", { className: "starci-graph-node-count" }, badgeCount ? h(Badge, { tone: "neutral" }, String(node.count)) : h(Text, { role: "label.field", tabular: true }, String(node.count))),
        )
    }

    const CardView = ({ data, sourcePosition, targetPosition }: NodeProps<FlowRfNode>): ReactElement => {
        const { node } = data
        // The spine layout names a port on its edge, so a card draws no port pills.
        const spine = data.layout === "spine"
        const ports = spine ? [] : data.ports
        const body = [
            head(data),
            chips(node.chips),
            node.agent === undefined && node.agentName === undefined
                ? null
                : h("span", { key: "agent", className: "starci-graph-agent" }, node.agent === undefined ? null : h("span", { className: "starci-graph-agent-avatar", "aria-hidden": true }, node.agent), node.agentName === undefined ? null : h("span", { className: "starci-graph-agent-name" }, node.agentName)),
        ]
        return h(
            "div",
            { className: nodeClassName(data.status), ...nodeFlags(data), "data-shape": data.shape === "card" ? undefined : data.shape, "data-direction": data.direction, "data-ports": ports.length > 0 ? "true" : undefined, style: { inlineSize: data.width, blockSize: data.height, ...PORTS_RESERVE } },
            data.shape === "hexagon" || data.shape === "call" ? hexagon(data.width, data.height) : null,
            node.tag === undefined ? null : h("span", { className: "starci-graph-node-tag" }, h(Badge, { tone: badgeTone(statusTone(data.status)) }, node.tag)),
            statusChip(data.status, data.statusWord),
            ...(spine ? spineHandles() : handles(data, sourcePosition, targetPosition)),
            node.href === undefined ? h("span", { className: "starci-graph-node-body" }, ...body) : h(Link ?? "a", { href: node.href, className: "starci-graph-node-body starci-graph-node-link" }, ...body),
            ports.length === 0 ? null : h("span", { className: "starci-graph-ports" }, ports.map((port) => portPill(port, false))),
        )
    }

    const DiamondView = ({ data, sourcePosition, targetPosition }: NodeProps<FlowRfNode>): ReactElement => {
        const { node, ports, width, height } = data
        const points = `${String(width / 2)},1.5 ${String(width - 1.5)},${String(height / 2)} ${String(width / 2)},${String(height - 1.5)} 1.5,${String(height / 2)}`
        const text = h("span", { className: "starci-graph-diamond-text" }, h("span", { className: "starci-graph-diamond-label" }, node.label))
        return h(
            "div",
            { className: nodeClassName(data.status), ...nodeFlags(data), "data-shape": "diamond", style: { inlineSize: width, blockSize: height } },
            statusChip(data.status, data.statusWord),
            h("svg", { className: "starci-graph-diamond-shape", viewBox: `0 0 ${String(width)} ${String(height)}`, "aria-hidden": true }, h("polygon", { points })),
            ...(data.layout === "spine" ? spineHandles() : handles(data, sourcePosition, targetPosition, ports[0] === undefined ? undefined : POSITION_OF[ports[0].side])),
            node.href === undefined ? text : h(Link ?? "a", { href: node.href, className: "starci-graph-node-link starci-graph-diamond-link" }, text),
            (data.layout === "spine" ? [] : ports).map((port) => h(Handle, { ...handleProps, key: port.id, id: `port:${port.id}`, type: "source", position: POSITION_OF[port.side], className: "starci-graph-handle starci-graph-handle-vertex" })),
        )
    }

    const ContainerView = ({ data, sourcePosition, targetPosition }: NodeProps<FlowRfNode>): ReactElement => {
        const { node, ports, direction } = data
        const container = node.container
        const kind = container === undefined ? "group" : containerKind(container)
        return h(
            "div",
            { className: "starci-graph-container", ...nodeFlags(data), "data-container": kind, "data-direction": direction, style: { inlineSize: data.width, blockSize: data.height } },
            ...(data.layout === "spine" ? spineHandles() : handles(data, sourcePosition, targetPosition)),
            h(
                "span",
                { className: "starci-graph-container-head" },
                h("span", { className: "starci-graph-container-label" }, node.label),
                chips(container?.chips),
                container?.description === undefined ? null : h("span", { className: "starci-graph-container-description" }, container.description),
            ),
            statusChip(data.status, data.statusWord),
            container?.note === undefined ? null : h("span", { className: "starci-graph-container-note" }, container.note),
            (data.layout === "spine" ? [] : ports).map((port) => h(Handle, { ...handleProps, key: port.id, id: `port:${port.id}`, type: "source", position: POSITION_OF[port.side], className: "starci-graph-handle starci-graph-handle-center", style: direction === "LR" ? exitStyle(data.exitAt[port.id]) : undefined })),
        )
    }

    /**
     * A fork or merge bar: a thick neutral line across the gap. A merge bar also draws the one arrow from its middle down into its target's top-mid, so
     * the edges that drop into it end on it with no mark of their own.
     */
    const BarView = ({ data }: NodeProps<BarRfNode>): ReactElement => {
        const stem = data.stem
        const arrow = 10
        return h(
            "div",
            { className: "starci-graph-bar", "data-look": data.look, "aria-hidden": true, style: { inlineSize: data.width, blockSize: data.thickness } },
            stem === undefined || stem.length <= arrow
                ? null
                : h(
                      "svg",
                      { className: "starci-graph-bar-stem", width: 12, height: stem.length, viewBox: `0 0 12 ${String(stem.length)}`, style: { insetInlineStart: stem.x - 6, insetBlockStart: data.thickness / 2 } },
                      h("path", { className: "starci-graph-bar-stem-line", d: `M6 0V${String(stem.length - arrow)}` }),
                      h("path", { className: "starci-graph-edge-arrow", d: `M6 ${String(stem.length)}L1 ${String(stem.length - arrow)}L11 ${String(stem.length - arrow)}Z` }),
                  ),
        )
    }

    return { flow: CardView, diamond: DiamondView, container: ContainerView, bar: BarView }
}

const EDGE_TYPES = { step: StepEdge }

const SPINE_LAYOUT: CanvasLayout = (sizes, links, settings) => layoutSpine(sizes, links, settings)

/** The layered layout: one ELK run places the nodes and routes every edge, final as given (see `layered.ts`). */
const LAYERED_LAYOUT: CanvasLayout = (sizes, links, settings) => layoutLayered(sizes, links, settings)

/** The layout port a card's handle stands for: its entry, its default exit, or a row's port (`port:<id>`, the id the card renders). */
const portOfHandle = (handle: string): string | undefined => (handle === "in" ? IN_PORT : handle === "out" ? OUT_PORT : handle.startsWith("port:") ? handle.slice("port:".length) : undefined)

const isProduction = (): boolean => typeof process !== "undefined" && process.env.NODE_ENV === "production"

/**
 * The graph of one workflow run: laid out on its spine (`layout`, default `spine`: a straight centred main column, side roads to its right, midpoint
 * ports, the fewest bends, a look per edge kind; or ELK's `layered`), panned and zoomed, fitted on load; read-only unless `editable`. Shapes: cards (kind, tag, chips,
 * agent, ports, count, link), decision diamonds, containers (groups and loops). A decision draws every branch: the taken one solid, the others faded
 * and dotted with `skippedLabel`. Exactly six node states (see `FlowStatus`); the app supplies valid ones, one active node per path, and a development
 * build warns when two running nodes lie on one path. Render it inside a Grammar `Fragment` with a reason; the parent gives it a height.
 * Import `@starci/grammar/core/ext/graph.css` once (it carries xyflow's base sheet).
 */
export const FlowGraph = (props: FlowGraphProps): ReactElement => {
    const { statusLabels, skippedLabel, kindTones, legend, linkComponent, onNodePress, onNodeOpen, collapse } = props
    const layout = props.layout ?? "spine"
    // On a phone the flow is laid out top-down, so it fits the width (the routing law, rule 4); the spine always runs top-down.
    const phoneDirection = useLayoutDirection(props.direction ?? "LR", "TB")
    const direction = layout === "spine" ? "TB" : phoneDirection
    // A long flow folds its untaken side roads behind pills; the roads a person opened stay open.
    const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
    const folded = useMemo(
        () => (collapse === undefined ? undefined : foldFlow(props.nodes, props.edges, resolveFlow(props.nodes, props.edges, direction, skippedLabel, layout), collapse, opened)),
        [props.nodes, props.edges, direction, skippedLabel, layout, collapse, opened],
    )
    const nodes = folded?.nodes ?? props.nodes
    const edges = folded?.edges ?? props.edges
    const model = useMemo(() => resolveFlow(nodes, edges, direction, skippedLabel, layout), [nodes, edges, direction, skippedLabel, layout])
    const rfEdges = useMemo(() => buildFlowEdges(model, nodes, layout), [model, nodes, layout])
    const nodeTypes = useMemo(() => makeNodeTypes(linkComponent), [linkComponent])
    const makeNodes = useMemo(
        () => (placement: Placement, selectedId: string | null) => [
            ...buildFlowNodes(nodes, model, placement.positions, placement.boxes, { statusLabels, kindTones, direction, selectedId, layout }, placement.ports),
            ...buildBarNodes(placement.bars ?? []),
        ],
        [nodes, model, statusLabels, kindTones, direction, layout],
    )
    useEffect(() => {
        if (isProduction()) return
        for (const [from, to] of findConcurrentRunning(nodes, edges)) globalThis.console.warn(`@starci/grammar/core/ext/graph: "${from}" and "${to}" are both running on one path; a path has one active node, so check the states the app passes.`)
    }, [nodes, edges])
    const footer = legend === undefined || legend.length === 0 ? undefined : h(FlowLegend, { items: legend, ...(kindTones === undefined ? {} : { kindTones }) })
    const press = (id: string): void => {
        // A fold pill is no step: pressing it unfolds its road.
        if (folded?.folds.has(id) === true) {
            setOpened((current) => new Set([...current, id]))
            return
        }
        onNodePress?.(id)
        onNodeOpen?.(id)
    }
    return h(GraphCanvas, {
        ...props,
        direction,
        focusId: props.focusId ?? focusStep(nodes),
        sizes: model.sizes,
        links: model.links,
        rfEdges,
        makeNodes,
        nodeTypes,
        edgeTypes: EDGE_TYPES,
        onNodePress: press,
        ...(layout === "spine" ? { runLayout: SPINE_LAYOUT, routed: true, leastZoom: FLOW_READABLE_ZOOM, fitWidth: true } : { runLayout: LAYERED_LAYOUT, routed: true, portOf: portOfHandle }),
        ...(footer === undefined ? {} : { footer }),
    })
}
