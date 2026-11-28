import { Position, type Edge, type Node } from "@xyflow/react"
import type { ReactNode } from "react"
import { ENTITY_HEAD_HEIGHT, ENTITY_ROW_HEIGHT, ENTITY_WIDTH, NODE_WIDTH, SCHEMA_FIELD_ROWS, portKey, type Bar, type Box, type LinkEnds, type Route, type SizedNode } from "./layout.js"
import { MAIN_KINDS, isDiamond, type FlowLayoutMode, type FlowModel, type ResolvedPort } from "./model.js"
import { edgeClassName, edgeKindClassName, isEdgeAnimated, nodeAriaLabel, normalizeStatus, tileTone, type EdgeStyle } from "./shared/status.js"
import type { BadgeTone } from "../../index.js"
import type { FlowContainer, FlowKindTones, FlowNode, FlowShape, FlowStatus, FlowStatusLabels, GraphDirection, GraphEdge, GraphEdgeKind, GraphPosition, GraphTone, SchemaEntity, SchemaField } from "./types.js"

/** What a card, a diamond or a container node carries to its view. */
export interface FlowNodeData extends Record<string, unknown> {
    node: FlowNode
    status: FlowStatus
    tileTone: GraphTone
    /** The words of the state, from `statusLabels`. */
    statusWord: string
    /** Where each exit of a container sits on its frame (the centre of its pill), as ELK placed it. */
    exitAt: Readonly<Record<string, GraphPosition>>
    ports: readonly ResolvedPort[]
    direction: GraphDirection
    /** The layout the node stands in: the spine layout gives every node its four midpoint handles and draws no port pill. */
    layout: FlowLayoutMode
    /** The outline it is drawn in (`shapeOf`): a card, a diamond, a hexagon, a pill, a stadium, a rectangle or a call hexagon. */
    shape: FlowShape
    selected: boolean
    width: number
    height: number
}
export type FlowRfNode = Node<FlowNodeData, "flow" | "diamond" | "container">

/** A fork or merge bar of the spine layout, drawn as a node of its own (never pressed, never focused). */
export interface BarNodeData extends Record<string, unknown> {
    width: number
    /** A merge bar's arrow: where along the bar it leaves, and how far below the bar the target's top stands. */
    stem: { readonly x: number; readonly length: number } | undefined
    look: "solid" | "hollow"
    /** How thick it is drawn: a solid bar `BAR_THICKNESS`, a hollow split bar twice that, so its outline reads. */
    thickness: number
}
export type BarRfNode = Node<BarNodeData, "bar">

/** The thickness of a bar; its node is that tall, centred on the bar's line. */
export const BAR_THICKNESS = 4

export interface EntityNodeData extends Record<string, unknown> {
    label: string
    description: string | undefined
    count: number | string | undefined
    icon: ReactNode
    rows: readonly SchemaField[]
    more: number
    selected: boolean
}
export type EntityRfNode = Node<EntityNodeData, "entity">

/** What an edge carries to its view. */
export interface StepEdgeData extends Record<string, unknown> {
    style: EdgeStyle
    /** The words of the pill on the line, when it has one. */
    pill: string | undefined
    dangerPort: boolean
    dimmed: boolean
    /** The route ELK gave the edge, while the nodes stand where ELK put them. */
    route?: Route | undefined
    /** The route begins on another edge's line (the routing law, rule 6): a junction dot there. */
    joinStart?: boolean
    /** The route ends on another edge's line, which carries the one arrowhead: a junction dot there and no arrowhead. */
    joinEnd?: boolean
    /** The tone of the pill's words when the edge has one of its own (a diagram edge's tone, a flow edge's kind); else the pill takes the tone of its style. */
    pillTone?: BadgeTone
    /** The route ends on a merge bar: no arrowhead and no dot, the bar carries the one arrow. */
    bareEnd?: boolean
    /** What a flow edge means (its look). */
    kind?: GraphEdgeKind
    /**
     * The arrowhead's look (a Mermaid architecture edge's kind, owner 2026-11-28): `open` the open V every graph draws (the default), `filled` a solid
     * triangle (an HTTP call), `small` a smaller open V (a service reaching its own store).
     */
    head?: "open" | "filled" | "small"
}

const SIDES: Readonly<Record<GraphDirection, { readonly source: Position; readonly target: Position }>> = {
    LR: { source: Position.Right, target: Position.Left },
    TB: { source: Position.Bottom, target: Position.Top },
}

/** The xyflow side of a port side. */
export const POSITION_OF: Readonly<Record<"EAST" | "SOUTH" | "NORTH" | "WEST", Position>> = { EAST: Position.Right, SOUTH: Position.Bottom, NORTH: Position.Top, WEST: Position.Left }

/** The fields an entity draws and how many it leaves to the "+N" row. */
export const visibleFields = (fields: readonly SchemaField[] | undefined): { readonly rows: readonly SchemaField[]; readonly more: number } => {
    const all = fields ?? []
    return all.length <= SCHEMA_FIELD_ROWS ? { rows: all, more: 0 } : { rows: all.slice(0, SCHEMA_FIELD_ROWS), more: all.length - SCHEMA_FIELD_ROWS }
}

/** The height of an entity box: its head, a row per drawn field and the "+N" row. */
export const entityHeight = (entity: SchemaEntity): number => {
    const { rows, more } = visibleFields(entity.fields)
    return ENTITY_HEAD_HEIGHT + (rows.length + (more > 0 ? 1 : 0)) * ENTITY_ROW_HEIGHT + (rows.length > 0 ? 8 : 0)
}

export const schemaSizes = (entities: readonly SchemaEntity[]): SizedNode[] => entities.map((entity) => ({ id: entity.id, width: ENTITY_WIDTH, height: entityHeight(entity) }))

/** The nodes parents first: xyflow wants a container before the nodes inside it. */
const parentsFirst = (nodes: readonly FlowNode[], parents: ReadonlyMap<string, string>): readonly FlowNode[] => {
    const depth = (id: string): number => {
        let n = 0
        for (let at = parents.get(id); at !== undefined; at = parents.get(at)) n += 1
        return n
    }
    return [...nodes].sort((a, b) => depth(a.id) - depth(b.id))
}

export interface FlowBuildContext {
    readonly statusLabels: FlowStatusLabels
    readonly kindTones: FlowKindTones | undefined
    readonly direction: GraphDirection
    readonly selectedId: string | null
    /** Default `layered`. */
    readonly layout?: FlowLayoutMode
}

/**
 * The xyflow nodes of a flow: each at its laid-out position (inside its container for a child), named for assistive technology by its label and its status
 * in words. A container is drawn at the box its children gave it; a child stays inside it.
 */
export const buildFlowNodes = (
    nodes: readonly FlowNode[],
    model: FlowModel,
    positions: Readonly<Record<string, GraphPosition>>,
    boxes: Readonly<Record<string, Box>>,
    context: FlowBuildContext,
    portPositions: Readonly<Record<string, GraphPosition>> = {},
): FlowRfNode[] =>
    parentsFirst(nodes, model.parents).map((node): FlowRfNode => {
        const status = model.statuses.get(node.id) ?? normalizeStatus(node.status)
        const size = model.sizes.find((candidate) => candidate.id === node.id)
        const box = boxes[node.id]
        const isContainer = node.container !== undefined
        const width = isContainer ? (box?.width ?? size?.width ?? NODE_WIDTH) : (size?.width ?? NODE_WIDTH)
        const height = isContainer ? (box?.height ?? size?.height ?? 0) : (size?.height ?? 0)
        const parentId = model.parents.get(node.id)
        const side = SIDES[context.direction]
        const shape = model.shapes.get(node.id) ?? (isDiamond(node) ? "diamond" : "card")
        return {
            id: node.id,
            type: isContainer ? "container" : shape === "diamond" ? "diamond" : "flow",
            position: positions[node.id] ?? { x: 0, y: 0 },
            data: {
                node,
                status,
                tileTone: tileTone(node.tone, status),
                statusWord: [status === "wait" && node.wait !== undefined ? node.wait.label : context.statusLabels[status], node.container?.attempt].filter((part): part is string => part !== undefined && part !== "").join(" \u00b7 "),
                exitAt: Object.fromEntries((model.ports.get(node.id) ?? []).flatMap((port) => { const at = portPositions[portKey(node.id, port.id)]; return at === undefined ? [] : [[port.id, at] as const] })),
                ports: model.ports.get(node.id) ?? [],
                direction: context.direction,
                layout: context.layout ?? "layered",
                shape,
                selected: node.id === context.selectedId,
                width,
                height,
            },
            ...(isContainer ? { width, height, style: { width, height }, zIndex: 0 } : { initialWidth: width, initialHeight: height, zIndex: 1 }),
            ...(parentId === undefined ? {} : { parentId, extent: "parent" as const }),
            sourcePosition: side.source,
            targetPosition: side.target,
            draggable: false,
            connectable: false,
            selectable: false,
            ariaLabel: nodeAriaLabel(node.label, context.statusLabels[status]),
            ...(node.href === undefined ? {} : { focusable: false }),
        }
    })

/**
 * The xyflow edges of a flow, each drawn from its style: it flows while its source runs, waits (amber, still) while its source waits, `taken` is solid
 * success, `fallback` dashed, `skipped` faded and dotted (an untaken branch of a decision also carries `skippedLabel`), `back` dashed and curved.
 * A label on a branch's port stays on the port; any other label is a pill on the line.
 */
export const buildFlowEdges = (model: FlowModel, nodes: readonly FlowNode[], layout: FlowLayoutMode = "layered"): Edge[] => {
    const dimmed = new Set(nodes.filter((node) => node.dimmed === true).map((node) => node.id))
    return model.edges.map((item): Edge => {
        const { edge, style, port, kind } = item
        const danger = port?.tone === "danger"
        const classes = [edgeClassName(style), edgeKindClassName(kind), edge.placeholder === true ? "starci-graph-edge--placeholder" : "", danger ? "starci-graph-edge--danger" : "", dimmed.has(edge.target) ? "starci-graph-edge--dimmed" : ""].filter((part) => part !== "").join(" ")
        // The words of an edge the run has not reached (or will not take) stay quiet; otherwise they speak in the tone of the edge's kind.
        const quiet = style === "skipped" || style === "pending" || style === "running" || style === "wait"
        const tone = quiet ? undefined : KIND_PILL_TONE[kind]
        const data: StepEdgeData = { style, pill: item.pill, dangerPort: danger, dimmed: dimmed.has(edge.target), kind, ...(tone === undefined ? {} : { pillTone: tone }) }
        // The spine layout's four midpoint handles: in at the top (a loop at the left), out at the bottom (a side road at the right, a loop at the left).
        const spine = layout === "spine"
        const sourceHandle = spine ? (kind === "loop" ? "loop-out" : MAIN_KINDS.has(kind) ? "out" : "side") : port === undefined ? "out" : `port:${port.id}`
        return {
            id: item.id,
            source: edge.source,
            target: edge.target,
            type: "step",
            sourceHandle,
            targetHandle: spine && kind === "loop" ? "loop-in" : "in",
            animated: isEdgeAnimated(model.statuses.get(edge.target) ?? "todo") && style === "running",
            className: classes,
            zIndex: 2,
            data,
            selectable: false,
            focusable: false,
        }
    })
}

/** The Badge tone of a flow edge's words by its kind; `ok` and `parallel` take the tone of their run style. */
const KIND_PILL_TONE: Readonly<Record<GraphEdgeKind, BadgeTone | undefined>> = { ok: undefined, parallel: undefined, yes: "success", no: "neutral", loop: "accent", timeout: "warning", refused: "danger", declined: "danger", case: undefined, default: "neutral" }

/** The xyflow nodes of the fork and merge bars: each a thin node on its line, under no step and never pressed. */
export const buildBarNodes = (bars: readonly Bar[]): BarRfNode[] =>
    bars.map((bar) => {
        const thickness = bar.look === "hollow" ? 2 * BAR_THICKNESS : BAR_THICKNESS
        return {
        id: bar.id,
        type: "bar" as const,
        position: { x: bar.x, y: bar.y - thickness / 2 },
        initialWidth: Math.max(bar.width, 1),
        initialHeight: thickness,
        data: { width: Math.max(bar.width, 1), look: bar.look ?? "solid", thickness, stem: bar.stemX === undefined || bar.stemTo === undefined ? undefined : { x: bar.stemX - bar.x, length: bar.stemTo - bar.y } },
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
        zIndex: 3,
        }
    })

/** The xyflow nodes of a schema map. A node is named by its label, its description and its figure. */
export const buildEntityNodes = (entities: readonly SchemaEntity[], positions: Readonly<Record<string, GraphPosition>>, direction: GraphDirection, selectedId: string | null): EntityRfNode[] =>
    entities.map((entity) => {
        const { rows, more } = visibleFields(entity.fields)
        const name = [entity.label, entity.description, entity.count === undefined ? undefined : String(entity.count)].filter((part): part is string => part !== undefined && part !== "").join(", ")
        return {
            id: entity.id,
            type: "entity" as const,
            position: positions[entity.id] ?? { x: 0, y: 0 },
            initialWidth: ENTITY_WIDTH,
            initialHeight: entityHeight(entity),
            sourcePosition: SIDES[direction].source,
            targetPosition: SIDES[direction].target,
            draggable: false,
            connectable: false,
            selectable: false,
            ariaLabel: name,
            data: { label: entity.label, description: entity.description, count: entity.count, icon: entity.icon, rows, more, selected: entity.id === selectedId },
        }
    })

/** The xyflow edges of a schema map: every one stands still. An edge with an unknown end is dropped; a missing id is `source->target`, made unique when a pair repeats. */
export const buildSchemaEdges = (known: ReadonlySet<string>, edges: readonly GraphEdge[]): Edge[] => {
    const taken = new Map<string, number>()
    const built: Edge[] = []
    for (const edge of edges) {
        if (!known.has(edge.source) || !known.has(edge.target)) continue
        const base = edge.id ?? `${edge.source}->${edge.target}`
        const count = taken.get(base) ?? 0
        taken.set(base, count + 1)
        const data: StepEdgeData = { style: "plain", pill: edge.label, dangerPort: false, dimmed: false }
        built.push({
            id: count === 0 ? base : `${base}#${String(count)}`,
            source: edge.source,
            target: edge.target,
            type: "step",
            sourceHandle: "out",
            targetHandle: "in",
            className: edgeClassName("plain"),
            data,
            selectable: false,
            focusable: false,
        })
    }
    return built
}

/** The kind of container a node is, `group` when it does not say. */
export const containerKind = (container: FlowContainer): "group" | "loop" => container.kind ?? "group"

/** What the layout depends on: ids, sizes, ports, edge ends, direction and islands, never a status or a label, so a status change does not move or refit the graph. */
export const structureKey = (sizes: readonly SizedNode[], links: readonly LinkEnds[], direction: GraphDirection, islands = "wrap", width = 0): string =>
    JSON.stringify([
        direction,
        islands,
        width,
        sizes.map((size) => [size.id, size.width, size.height, size.parentId ?? null, (size.ports ?? []).map((port) => `${port.id}:${port.side}`)]),
        links.map((link) => [link.source, link.target, link.sourcePort ?? null, link.targetPort ?? null, link.label ?? null, link.back === true, link.kind ?? null]),
    ])
