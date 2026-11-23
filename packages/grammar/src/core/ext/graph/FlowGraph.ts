"use client"

import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react"
import { createElement as h, isValidElement, useEffect, useMemo, type CSSProperties, type ElementType, type ReactElement, type ReactNode } from "react"
import { POSITION_OF, buildFlowEdges, buildFlowNodes, containerKind, type FlowRfNode } from "./build.js"
import { Badge, IconTile, InlineStatus, Text, type IconSource } from "../../index.js"
import { focusStep } from "./shared/status.js"
import { useLayoutDirection } from "./shared/phone.js"
import { GraphCanvas, type Placement } from "./shared/canvas.js"
import { FlowLegend } from "./shared/legend.js"
import { PORT_COLUMN, PORT_ROW_TB, entrySide, resolveFlow, type ResolvedPort } from "./model.js"
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
}

/** The room the card body leaves for its ports, from the layout's own sizes plus the 8px gap: the column down the end side (LR) or the row along the bottom (TB). */
const PORTS_GAP = 8
const PORTS_RESERVE = { "--starci-graph-ports-inline": `${String(PORT_COLUMN + PORTS_GAP)}px`, "--starci-graph-ports-block": `${String(PORT_ROW_TB + PORTS_GAP)}px` } as CSSProperties

/** The chips a card shows: the first three, the rest as one "+N" pill. */
const CHIPS_SHOWN = 3

/**
 * A node's mark, the core's status mark (B): the node's icon on its state's plate (`IconTile state source`). An icon given as an element of an icon
 * component (`<TruckIcon />`) is drawn by its component; any other node (a picture, an intrinsic element) keeps its look as artwork on a neutral plate.
 */
const nodeMark = (status: FlowStatus, icon: ReactNode): ReactElement => {
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
        const sub = (data.status === "wait" ? node.wait?.detail : undefined) ?? (data.status === "error" ? node.errorReason : undefined) ?? node.description
        return h(
            "span",
            { className: "starci-graph-node-head" },
            // The core's status mark (B): the node's own icon on its state's plate, or the state's glyph when it has none.
            h("span", { className: "starci-graph-node-icon", "data-status": data.status }, nodeMark(data.status, node.icon)),
            h(
                "span",
                { className: "starci-graph-node-text" },
                h(Text, { role: "label.item", overflow: "truncate" }, node.label),
                sub === undefined ? null : h(Text, { role: "label.field", overflow: "truncate" }, sub),
            ),
            node.count === undefined || node.count === "" ? null : h("span", { className: "starci-graph-node-count" }, h(Text, { role: "label.field", tabular: true }, String(node.count))),
        )
    }

    const CardView = ({ data, sourcePosition, targetPosition }: NodeProps<FlowRfNode>): ReactElement => {
        const { node, ports } = data
        const body = [
            head(data),
            chips(node.chips),
            node.agent === undefined && node.agentName === undefined
                ? null
                : h("span", { key: "agent", className: "starci-graph-agent" }, node.agent === undefined ? null : h("span", { className: "starci-graph-agent-avatar", "aria-hidden": true }, node.agent), node.agentName === undefined ? null : h("span", { className: "starci-graph-agent-name" }, node.agentName)),
        ]
        return h(
            "div",
            { className: nodeClassName(data.status), ...nodeFlags(data), "data-direction": data.direction, "data-ports": ports.length > 0 ? "true" : undefined, style: { inlineSize: data.width, blockSize: data.height, ...PORTS_RESERVE } },
            node.tag === undefined ? null : h("span", { className: "starci-graph-node-tag" }, h(Badge, { tone: badgeTone(statusTone(data.status)) }, node.tag)),
            statusChip(data.status, data.statusWord),
            ...handles(data, sourcePosition, targetPosition),
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
            ...handles(data, sourcePosition, targetPosition, ports[0] === undefined ? undefined : POSITION_OF[ports[0].side]),
            node.href === undefined ? text : h(Link ?? "a", { href: node.href, className: "starci-graph-node-link starci-graph-diamond-link" }, text),
            ports.map((port) => h(Handle, { ...handleProps, key: port.id, id: `port:${port.id}`, type: "source", position: POSITION_OF[port.side], className: "starci-graph-handle starci-graph-handle-vertex" })),
        )
    }

    const ContainerView = ({ data, sourcePosition, targetPosition }: NodeProps<FlowRfNode>): ReactElement => {
        const { node, ports, direction } = data
        const container = node.container
        const kind = container === undefined ? "group" : containerKind(container)
        return h(
            "div",
            { className: "starci-graph-container", ...nodeFlags(data), "data-container": kind, "data-direction": direction, style: { inlineSize: data.width, blockSize: data.height } },
            ...handles(data, sourcePosition, targetPosition),
            h(
                "span",
                { className: "starci-graph-container-head" },
                h("span", { className: "starci-graph-container-label" }, node.label),
                chips(container?.chips),
                container?.description === undefined ? null : h("span", { className: "starci-graph-container-description" }, container.description),
            ),
            statusChip(data.status, data.statusWord),
            container?.note === undefined ? null : h("span", { className: "starci-graph-container-note" }, container.note),
            ports.map((port) => h(Handle, { ...handleProps, key: port.id, id: `port:${port.id}`, type: "source", position: POSITION_OF[port.side], className: "starci-graph-handle starci-graph-handle-center", style: direction === "LR" ? exitStyle(data.exitAt[port.id]) : undefined })),
        )
    }

    return { flow: CardView, diamond: DiamondView, container: ContainerView }
}

const EDGE_TYPES = { step: StepEdge }

const isProduction = (): boolean => typeof process !== "undefined" && process.env.NODE_ENV === "production"

/**
 * The graph of one workflow run: laid out by ELK, panned and zoomed, fitted on load; read-only unless `editable`. Shapes: cards (kind, tag, chips,
 * agent, ports, count, link), decision diamonds, containers (groups and loops). A decision draws every branch: the taken one solid, the others faded
 * and dotted with `skippedLabel`. Exactly six node states (see `FlowStatus`); the app supplies valid ones, one active node per path, and a development
 * build warns when two running nodes lie on one path. Render it inside a Grammar `Fragment` with a reason; the parent gives it a height.
 * Import `@starci/grammar/core/ext/graph.css` once (it carries xyflow's base sheet).
 */
export const FlowGraph = (props: FlowGraphProps): ReactElement => {
    const { nodes, edges, statusLabels, skippedLabel, kindTones, legend, linkComponent } = props
    // On a phone the flow is laid out top-down, so it fits the width (the routing law, rule 4).
    const direction = useLayoutDirection(props.direction ?? "LR", "TB")
    const model = useMemo(() => resolveFlow(nodes, edges, direction, skippedLabel), [nodes, edges, direction, skippedLabel])
    const rfEdges = useMemo(() => buildFlowEdges(model, nodes), [model, nodes])
    const nodeTypes = useMemo(() => makeNodeTypes(linkComponent), [linkComponent])
    const makeNodes = useMemo(
        () => (placement: Placement, selectedId: string | null) =>
            buildFlowNodes(nodes, model, placement.positions, placement.boxes, { statusLabels, kindTones, direction, selectedId }, placement.ports),
        [nodes, model, statusLabels, kindTones, direction],
    )
    useEffect(() => {
        if (isProduction()) return
        for (const [from, to] of findConcurrentRunning(nodes, edges)) globalThis.console.warn(`@starci/grammar/core/ext/graph: "${from}" and "${to}" are both running on one path; a path has one active node, so check the states the app passes.`)
    }, [nodes, edges])
    const footer = legend === undefined || legend.length === 0 ? undefined : h(FlowLegend, { items: legend, ...(kindTones === undefined ? {} : { kindTones }) })
    return h(GraphCanvas, { ...props, direction, focusId: props.focusId ?? focusStep(nodes), sizes: model.sizes, links: model.links, rfEdges, makeNodes, nodeTypes, edgeTypes: EDGE_TYPES, ...(footer === undefined ? {} : { footer }) })
}
