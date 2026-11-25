"use client"

import { Background, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeProps, type NodeTypes } from "@xyflow/react"
import { createElement as h, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react"
import { Badge, Icon, IconTile, Link, Text } from "../../../index.js"
import { GraphSkeleton, measureLabel, openView, roundedPath, type ViewRect } from "../shared/index.js"
import { FlowZoom, zoomWords } from "../shared/zoom.js"
import { useGraphScheme } from "../shared/scheme.js"
import { erdBounds, layoutErd, type ErdLayout, type ErdRoute, type Point } from "./layout.js"
import { NO_GLYPH } from "./glyphs.js"
import { endMarker, markerAngle, unitFrom, type Marker } from "./markers.js"
import { ERD_DEFAULT_FIELDS, ERD_WIDTH, HEAD_PORT, erdPortId, erdPortY, erdStructureKey, resolveErd, type ErdEdge, type ErdModel, type ErdNode } from "./model.js"
import type { ErdMapProps } from "./types.js"
import { TablerLink } from "../../../leaf/Icon/tabler.js"
import { FILE_GLYPHS } from "../../../fileGlyph.js"

const CORNER = 12
/** The first view's room round the map: on the left the 40px zoom controls and their gap. */
const OPEN_INSETS = { top: 16, right: 16, bottom: 16, left: 72 } as const

interface Lit {
    readonly edge: string | undefined
    readonly node: string | undefined
}

interface EntityData extends Record<string, unknown> {
    node: ErdNode
    lit: boolean
    /** The field row a lit relation starts at. */
    litRow: string | undefined
    used: readonly { readonly id: string; readonly row: string; readonly side: "L" | "R"; readonly kind: "source" | "target" }[]
    more: string | undefined
    /** Opens an entity (a field's link to the entity it points at). */
    open: (id: string) => void
    /** Drawn as the selected entity. */
    selected: boolean
    /** The field row drawn as selected. */
    selectedRow: string | undefined
    /** Opens a file field's files; undefined when the app opens none. */
    openField: ((field: string) => void) | undefined
}
type EntityRfNode = Node<EntityData, "erd">

interface RelationData extends Record<string, unknown> {
    edge: ErdEdge
    route: ErdRoute
    lit: boolean
}
type RelationRfEdge = Edge<RelationData, "erd">

const EntityView = ({ data }: NodeProps<EntityRfNode>): ReactElement => {
    const { node, lit, litRow, used, more, open, selected, selectedRow, openField } = data
    const entity = node.entity
    return h(
        "div",
        { className: "starci-graph-entity starci-erd", "data-lit": lit ? "true" : undefined, "data-selected": selected ? "true" : undefined },
        used.map((port) =>
            h(Handle, {
                key: `${port.kind}:${port.id}`,
                id: port.id,
                type: port.kind,
                position: port.side === "L" ? Position.Left : Position.Right,
                isConnectable: false,
                className: "starci-graph-handle starci-erd-handle",
                style: { top: erdPortY(port.row === HEAD_PORT ? HEAD_PORT : node.rows.findIndex((row) => row.field.id === port.row)) },
            }),
        ),
        h(
            "div",
            { className: "starci-erd-head" },
            entity.icon === undefined
                ? h(IconTile, { source: NO_GLYPH, artwork: h("span", { "aria-hidden": true }, entity.label.charAt(0).toUpperCase()), tone: lit ? "info" : "neutral" })
                : h(IconTile, { source: entity.icon, tone: lit ? "info" : "neutral" }),
            h(
                "span",
                { className: "starci-erd-text" },
                h(Text, { as: "span", role: "label.item", overflow: "truncate" }, entity.label),
                entity.count === undefined ? null : h(Text, { as: "span", role: "caption" }, String(entity.count)),
            ),
        ),
        node.rows.length === 0 && node.more === 0
            ? null
            : h(
                  "ul",
                  { className: "starci-erd-rows" },
                  node.rows.map((row) =>
                      h(
                          "li",
                          {
                              key: row.field.id,
                              className: "starci-erd-row",
                              "data-link": row.links === undefined ? undefined : "true",
                              "data-file": row.field.file?.kind,
                              "data-lit": litRow === row.field.id ? "true" : undefined,
                              "data-selected": selected && selectedRow === row.field.id ? "true" : undefined,
                          },
                          row.field.file !== undefined && openField !== undefined
                              ? // A file field opens its files: the name is the button (nodrag, so the map does not pan under the press), the box itself still opens the entity.
                                h(
                                    "button",
                                    {
                                        type: "button",
                                        className: "starci-erd-field starci-erd-file-open nodrag",
                                        title: row.field.label,
                                        "aria-pressed": selected && selectedRow === row.field.id,
                                        onClick: (event: MouseEvent) => {
                                            event.stopPropagation()
                                            openField(row.field.id)
                                        },
                                        onKeyDown: (event: KeyboardEvent) => {
                                            // Enter and Space press the button; they never reach the box, which would open the entity instead.
                                            if (event.key === "Enter" || event.key === " ") event.stopPropagation()
                                        },
                                    },
                                    h(Text, { as: "span", role: "body", overflow: "truncate" }, row.field.label),
                                )
                              : h("span", { className: "starci-erd-field", title: row.field.label }, h(Text, { as: "span", role: "body", overflow: "truncate" }, row.field.label)),
                          row.links !== undefined && row.linksTo !== undefined
                              ? // The core's Link to the entity the field points at, after the link icon.
                                h("span", { className: "starci-erd-type starci-erd-link" }, h(Icon, { source: TablerLink, usage: "text" }), h(Link, { href: `#${row.linksTo}`, variant: "plain", onFollow: () => { open(row.linksTo ?? "") }, children: row.links }))
                              : row.field.file !== undefined
                                ? // The file mark: the glyph of the kind, then the type words (the kind and, for a list, "many" in the app's words).
                                  h("span", { className: "starci-erd-type starci-erd-file" }, h(Icon, { source: FILE_GLYPHS[row.field.file.kind], usage: "text" }), row.field.type === undefined ? null : h(Text, { as: "span", role: "caption" }, row.field.type))
                                : row.field.type === undefined
                                  ? null
                                  : h("span", { className: "starci-erd-type" }, h(Text, { as: "span", role: "caption" }, row.field.type)),
                      ),
                  ),
                  more === undefined ? null : h("li", { key: "more", className: "starci-erd-row starci-erd-more" }, h(Text, { as: "span", role: "caption" }, more)),
              ),
    )
}

const Mark = ({ at, toward, marker }: { readonly at: Point; readonly toward: Point; readonly marker: Marker }): ReactElement => {
    const dir = unitFrom(at, toward) ?? [1, 0]
    return h(
        "g",
        { className: "starci-erd-mark", transform: `translate(${String(at[0])} ${String(at[1])}) rotate(${String(markerAngle(dir[0], dir[1]))})` },
        marker.segments.map((s, index) => h("line", { key: index, x1: s[0], y1: s[1], x2: s[2], y2: s[3] })),
        marker.ring === undefined ? null : h("circle", { className: "starci-erd-ring", cx: marker.ring.x, cy: marker.ring.y, r: marker.ring.r }),
    )
}

const RelationView = ({ id, source, target, data }: EdgeProps<RelationRfEdge>): ReactElement | null => {
    if (data === undefined) return null
    const { edge, route, lit } = data
    const first = route.points[0]
    const second = route.points[1]
    const last = route.points[route.points.length - 1]
    const before = route.points[route.points.length - 2]
    if (first === undefined || second === undefined || last === undefined || before === undefined) return null
    return h(
        "g",
        { className: "starci-erd-edge", "data-lit": lit ? "true" : undefined, "data-edge-source": source, "data-edge-target": target },
        h(BaseEdge, { path: roundedPath(route.points, CORNER), interactionWidth: 14 }),
        h(Mark, { at: first, toward: second, marker: endMarker(edge.fromMany, edge.fromOptional) }),
        h(Mark, { at: last, toward: before, marker: endMarker(edge.toMany, edge.toOptional) }),
        edge.label === undefined || route.label === undefined
            ? null
            : h(
                  EdgeLabelRenderer,
                  null,
                  h("span", { className: "starci-graph-edge-pill starci-erd-pill", "data-lit": lit ? "true" : undefined, "data-edge": id, style: { transform: `translate(${String(route.label.x)}px, ${String(route.label.y)}px)`, inlineSize: route.label.width, blockSize: route.label.height } }, h(Badge, { tone: lit ? "info" : "muted" }, edge.label)),
              ),
    )
}

const EDGE_TYPES: EdgeTypes = { erd: RelationView }

interface Placed {
    readonly key: string
    readonly layout: ErdLayout
}

interface Rect {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** What must stay clear of the zoom controls: every box, every word and every run of every line, in the frame of the graph. */
const shapesOf = (model: ErdModel, layout: ErdLayout): readonly Rect[] => {
    const shapes: Rect[] = []
    for (const node of model.nodes) {
        const at = layout.positions[node.id]
        if (at !== undefined) shapes.push({ x: at.x, y: at.y, width: ERD_WIDTH, height: node.height })
    }
    for (const route of Object.values(layout.routes)) {
        if (route.label !== undefined) shapes.push(route.label)
        for (let i = 1; i < route.points.length; i += 1) {
            const p = route.points[i - 1]
            const q = route.points[i]
            if (p !== undefined && q !== undefined) shapes.push({ x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), width: Math.abs(p[0] - q[0]), height: Math.abs(p[1] - q[1]) })
        }
    }
    return shapes
}

/** The gap the graph keeps from the zoom controls, in screen px. */
const CONTROLS_GAP = 16

/**
 * The box of the entity the first view is centred on: the app's `focusId`. Left out, a map larger than its frame opens at its top-left corner, where its reading
 * starts, past the zoom controls (so they cover nothing).
 */
const focusOf = (model: ErdModel, layout: ErdLayout, focusId: string | undefined): ViewRect | undefined => {
    const node = model.nodes.find((each) => each.id === focusId)
    const at = node === undefined ? undefined : layout.positions[node.id]
    return node === undefined || at === undefined ? undefined : { x: at.x, y: at.y, width: ERD_WIDTH, height: node.height }
}

/**
 * The view of the map and its zoom controls. Every screen opens fitted (`openView`): the whole map, centred, at 100% or less, and
 * the person drags it and pinches to zoom. The fit button fits `bounds` (and, when something of the graph would stand under the controls, fits again with their room added at
 * the left, a few passes at most since the zoom changes with each).
 */
const Viewport = ({ bounds, focus, shapes, token, words }: { readonly bounds: Rect; readonly focus: ViewRect | undefined; readonly shapes: readonly Rect[]; readonly token: string; readonly words: ReturnType<typeof zoomWords> }): ReactElement => {
    const flow = useReactFlow()
    const store = useStoreApi()
    const fit = async (): Promise<void> => {
        let extra = 0
        for (let pass = 0; pass < 4; pass += 1) {
            await flow.fitBounds({ ...bounds, x: bounds.x - extra, width: bounds.width + extra }, { padding: 0.06, duration: 0 })
            const dom = store.getState().domNode
            const controls = dom?.querySelector(".starci-graph-zoom")?.getBoundingClientRect()
            const frame = dom?.getBoundingClientRect()
            if (controls === undefined || frame === undefined) return
            const view = flow.getViewport()
            const hit = shapes.some((r) => {
                const left = frame.left + r.x * view.zoom + view.x
                const top = frame.top + r.y * view.zoom + view.y
                return left < controls.right + CONTROLS_GAP && left + r.width * view.zoom > controls.left - CONTROLS_GAP && top < controls.bottom + CONTROLS_GAP && top + r.height * view.zoom > controls.top - CONTROLS_GAP
            })
            if (!hit) return
            extra = (controls.right - frame.left + CONTROLS_GAP * 2) / view.zoom
        }
    }
    useEffect(() => {
        const frame = store.getState().domNode?.getBoundingClientRect()
        // Fitted on every screen: the whole map, centred (`openView`).
        if (frame !== undefined) void flow.setViewport(openView(frame, bounds, focus, OPEN_INSETS))
        // The view is set when a layout lands (its token changes), never while the person pans.
    }, [token])
    // The shared zoom (Grammar's 40px IconButtons); its fit is the ERD's own, clear of the buttons.
    return h(FlowZoom, { words, onFit: () => void fit() })
}

const Canvas = (props: ErdMapProps): ReactElement => {
    const anchor = useRef<HTMLDivElement | null>(null)
    const scheme = useGraphScheme(anchor)
    const { entities, relations, label, onOpen, onOpenField, selectedId, selectedField, maxFields = ERD_DEFAULT_FIELDS, moreLabel, isLoading = false, emptyLabel } = props
    const [placed, setPlaced] = useState<Placed | undefined>(undefined)
    const [lit, setLit] = useState<Lit>({ edge: undefined, node: undefined })
    const model = useMemo(() => resolveErd(entities, relations, maxFields), [entities, relations, maxFields])
    const key = erdStructureKey(model)

    useEffect(() => {
        let current = true
        void layoutErd(model, { measure: measureLabel }).then((layout) => {
            if (current) setPlaced({ key, layout })
        })
        return () => {
            current = false
        }
        // The layout depends on the structure (ids, rows, relations) only.
    }, [key])

    const classes = props.className === undefined ? "starci-graph" : `starci-graph ${props.className}`
    const outer = { className: classes, role: "region", "aria-label": label, "data-mode": "erd", ref: anchor }
    const ready = placed?.key === key ? placed.layout : undefined

    if (isLoading) return h("div", { ...outer, "aria-busy": true }, h(GraphSkeleton))
    if (model.nodes.length === 0) return h("div", { ...outer, "data-empty": true }, emptyLabel === undefined ? null : h("p", { className: "starci-graph-empty" }, emptyLabel))
    if (ready === undefined) return h("div", { ...outer, "aria-busy": true }, h(GraphSkeleton))

    const litEdges = new Set<string>()
    const litNodes = new Set<string>()
    for (const edge of model.edges) {
        if (edge.id === lit.edge || (lit.node !== undefined && (edge.source === lit.node || edge.target === lit.node))) {
            litEdges.add(edge.id)
            litNodes.add(edge.source)
            litNodes.add(edge.target)
        }
    }
    const litRows = new Map<string, string>()
    for (const edge of model.edges) if (litEdges.has(edge.id) && edge.sourcePort !== HEAD_PORT) litRows.set(edge.source, edge.sourcePort)

    const usedBy = new Map<string, EntityData["used"][number][]>()
    const addUsed = (node: string, port: EntityData["used"][number]): void => {
        const have = usedBy.get(node) ?? []
        if (!have.some((other) => other.id === port.id && other.kind === port.kind)) usedBy.set(node, [...have, port])
    }
    for (const edge of model.edges) {
        const route = ready.routes[edge.id]
        if (route === undefined) continue
        addUsed(edge.source, { id: erdPortId(edge.source, edge.sourcePort, route.fromSide), row: edge.sourcePort, side: route.fromSide, kind: "source" })
        addUsed(edge.target, { id: erdPortId(edge.target, HEAD_PORT, route.toSide), row: HEAD_PORT, side: route.toSide, kind: "target" })
    }
    const nodes: EntityRfNode[] = model.nodes.map((node) => ({
        id: node.id,
        type: "erd" as const,
        position: ready.positions[node.id] ?? { x: 0, y: 0 },
        width: ERD_WIDTH,
        height: node.height,
        initialWidth: ERD_WIDTH,
        initialHeight: node.height,
        ariaLabel: [node.entity.label, node.entity.count === undefined ? undefined : String(node.entity.count)].filter((part) => part !== undefined).join(", "),
        data: { node, lit: litNodes.has(node.id), litRow: litRows.get(node.id), used: usedBy.get(node.id) ?? [], more: node.more > 0 ? (moreLabel === undefined ? `+${String(node.more)}` : moreLabel(node.more)) : undefined, open: (id: string) => { onOpen?.(id) }, selected: node.id === selectedId, selectedRow: node.id === selectedId ? selectedField : undefined, openField: onOpenField === undefined ? undefined : (field: string) => { onOpenField(node.id, field) } },
    }))
    const edges: RelationRfEdge[] = model.edges.flatMap((edge) => {
        const route = ready.routes[edge.id]
        return route === undefined
            ? []
            : [{ id: edge.id, type: "erd" as const, selectable: true, focusable: false, source: edge.source, target: edge.target, sourceHandle: erdPortId(edge.source, edge.sourcePort, route.fromSide), targetHandle: erdPortId(edge.target, HEAD_PORT, route.toSide), data: { edge, route, lit: litEdges.has(edge.id) } }]
    })
    const press = (id: string): void => {
        onOpen?.(id)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" && event.key !== " ") return
        if ((event.target as Element).closest("button") !== null) return
        const id = (event.target as Element).closest(".react-flow__node")?.getAttribute("data-id")
        if (id !== null && id !== undefined) {
            event.preventDefault()
            press(id)
        }
    }
    const bounds = erdBounds(model, ready)
    return h(
        "div",
        { ...outer, onKeyDown },
        h(
            "div",
            {
                className: "starci-graph-canvas",
                // Over the bare pane nothing is lit, whatever leave event a moving element swallowed.
                onMouseMove: (event: MouseEvent) => {
                    if ((event.target as Element).classList.contains("react-flow__pane")) setLit((current) => (current.edge === undefined && current.node === undefined ? current : { edge: undefined, node: undefined }))
                },
            },
            h(
                ReactFlow,
                {
                    key,
                    nodes,
                    edges,
                    nodeTypes: NODE_TYPES,
                    edgeTypes: EDGE_TYPES,
                    minZoom: 0.1,
                    maxZoom: 1.5,
                    nodesDraggable: false,
                    nodesConnectable: false,
                    elementsSelectable: false,
                    onNodeClick: (event: MouseEvent, node: Node) => {
                        // A field's link opens the entity it points at, not its own; a file field's button opens its files.
                        if ((event.target as Element).closest("a, button") !== null) return
                        press(node.id)
                    },
                    onNodeMouseEnter: (_event: unknown, node: Node) => {
                        setLit({ edge: undefined, node: node.id })
                    },
                    onNodeMouseLeave: () => {
                        setLit({ edge: undefined, node: undefined })
                    },
                    onEdgeMouseEnter: (_event: unknown, edge: Edge) => {
                        setLit({ edge: edge.id, node: undefined })
                    },
                    onEdgeMouseLeave: () => {
                        setLit({ edge: undefined, node: undefined })
                    },
                    proOptions: { hideAttribution: true },
                    // xyflow's root class is a theme scope: it names the scheme the frame stands in.
                    colorMode: scheme,
                    ...(props.ariaLabelConfig === undefined ? {} : { ariaLabelConfig: props.ariaLabelConfig }),
                },
                h(Background, { gap: 22, size: 1.4, color: "var(--starci-graph-grid)" }),
                h(Viewport, { bounds, focus: focusOf(model, ready, props.focusId), shapes: shapesOf(model, ready), token: key, words: zoomWords(props.ariaLabelConfig) }),
            ),
        ),
    )
}

const NODE_TYPES: NodeTypes = { erd: EntityView }

/**
 * The map of the records of an app: a box per entity (a round tile, its name and record count, a row per field with its plain type, a port on each side of every row)
 * and a line per relation, from the field that points to the head of the entity it points at, laid out by ELK (left to right) at every width, with a crow's foot
 * where many stand and two bars where one stands. Pressing an entity calls `onOpen`; hovering a relation or an entity lights both ends. Render it inside a Grammar `Fragment`.
 */
export const ErdMap = (props: ErdMapProps): ReactElement => h(ReactFlowProvider, null, h(Canvas, props))
