import { wrappedLines, type FlowGraphPoint } from "./layout.js"
import type { FlowGraphDirection, FlowGraphEdge, FlowGraphNode, FlowGraphPort, FlowGraphStepKind } from "./types.js"

/**
 * The `steps` layout (0.35.0): the card map of a workflow. Every card is one width; the flow reads down (`TB`, the default) or across
 * (`LR`). A node sits in the layer after its deepest forward predecessor; the forward edges by first parent form a tree, and the tree is
 * laid out tidy: a leaf takes one column, a parent sits centred over its children, and the children of a condition stand in the order
 * of its ports, so the "Có" branch is left of the "Không" branch. A back edge never changes a layer; it is routed round the cards
 * through the gap below its source's layer (see {@link stepsBackRoute}).
 */

/** The card width (`--grammar-flow-card-width`, 12.25rem), in graph units. */
export const STEPS_CARD_WIDTH = 196
/** The room between two columns: wide enough for the vertical runs of back edges beside a card. */
export const STEPS_COLUMN_GAP = 80
/** The room between two layers: a curve, and the channels of back edges after a layer (`LR` also holds a back label beside its channel). */
export const STEPS_LAYER_GAP = { TB: 64, LR: 112 } as const
/** The margin around the graph at zoom 1. */
export const STEPS_MARGIN = 32

/** Card geometry from the CSS, to estimate a card's height before it is drawn. */
const CARD_CHROME = 2 * 8 + 2
const TILE = 32
const TITLE_LINE = 18
const DESCRIPTION_LINE = 16
const TITLE_CHARS = 16
const DESCRIPTION_CHARS = 19
const OUTPUTS_ROW = 33
const END_HEIGHT = 36

/** The `steps` kind of a node; the `lanes` kinds map onto it, and a node without one is an action. */
export const stepKindOf = (node: FlowGraphNode): FlowGraphStepKind => {
    switch (node.kind) {
        case "trigger": return "event"
        case "execute": return "action"
        case "output": return "end"
        case undefined: return "action"
        default: return node.kind
    }
}

export const isBackEdge = (edge: FlowGraphEdge): boolean => edge.variant === "back" || edge.variant === "return"

/** The output ports of a condition node: its own `outputs`, else the labels of its labelled outgoing forward edges (each label once). */
export const portsOf = (node: FlowGraphNode, edges: ReadonlyArray<FlowGraphEdge>): ReadonlyArray<FlowGraphPort> => {
    if (stepKindOf(node) !== "condition") return []
    if (node.outputs !== undefined) return node.outputs
    const labels: string[] = []
    for (const edge of edges) {
        if (edge.source !== node.id || isBackEdge(edge)) continue
        const label = edge.sourcePort ?? edge.label
        if (label !== undefined && label !== "" && !labels.includes(label)) labels.push(label)
    }
    return labels.map((label) => ({ id: label, label }))
}

/** The port an edge leaves from, matched by `sourcePort` (id, then label), else by its own label; undefined when it leaves no port. */
export const portOfEdge = (edge: FlowGraphEdge, ports: ReadonlyArray<FlowGraphPort>): FlowGraphPort | undefined => {
    if (ports.length === 0) return undefined
    const key = edge.sourcePort ?? edge.label
    if (key === undefined || key === "") return undefined
    return ports.find((port) => port.id === key) ?? ports.find((port) => port.label === key)
}

/** The height a card draws at, estimated from its words and ports. */
export const stepsNodeHeight = (node: FlowGraphNode, ports: number): number => {
    if (stepKindOf(node) === "end") return END_HEIGHT
    const title = wrappedLines(node.label, TITLE_CHARS) * TITLE_LINE
    const description = node.description === undefined || node.description === "" ? 0 : wrappedLines(node.description, DESCRIPTION_CHARS) * DESCRIPTION_LINE
    return CARD_CHROME + Math.max(TILE, title + description) + (ports > 0 ? OUTPUTS_ROW : 0)
}

/** A back edge as the layout routes it: the channel it runs in under its source's layer, and its place among the back edges of its target side. */
export type StepsBackRoute = {
    /** The along coordinate (y for `TB`, x for `LR`) of the channel, in graph units. */
    readonly channel: number
    /** How far beside the target's side its last run climbs. */
    readonly targetOffset: number
    /** How far off the target's middle it enters, along the side. */
    readonly entryOffset: number
    /** The side of the source it leaves, and the side of the target it enters: `start` (left / top) or `end` (right / bottom). */
    readonly sourceSide: "start" | "end"
    readonly targetSide: "start" | "end"
}

export type StepsLayout = {
    /** Node centres, in graph units. */
    readonly positions: ReadonlyMap<string, FlowGraphPoint>
    readonly layers: ReadonlyMap<string, number>
    readonly ports: ReadonlyMap<string, ReadonlyArray<FlowGraphPort>>
    readonly back: ReadonlyMap<string, StepsBackRoute>
    /** The size of the whole graph at zoom 1, margin included. */
    readonly width: number
    readonly height: number
}

/** Rounded orthogonal path through points (screen coordinates), every corner a quarter curve of `radius`. */
export const roundedPath = (points: ReadonlyArray<FlowGraphPoint>, radius: number): string => {
    const first = points[0]
    if (first === undefined) return ""
    let path = `M ${first.x} ${first.y}`
    for (let index = 1; index < points.length; index += 1) {
        const point = points[index] as FlowGraphPoint
        const next = points[index + 1]
        if (next === undefined) {
            path += ` L ${point.x} ${point.y}`
            break
        }
        const previous = points[index - 1] as FlowGraphPoint
        const inLength = Math.hypot(point.x - previous.x, point.y - previous.y)
        const outLength = Math.hypot(next.x - point.x, next.y - point.y)
        const r = Math.min(radius, inLength / 2, outLength / 2)
        if (r <= 0) {
            path += ` L ${point.x} ${point.y}`
            continue
        }
        const before = { x: point.x - ((point.x - previous.x) / inLength) * r, y: point.y - ((point.y - previous.y) / inLength) * r }
        const after = { x: point.x + ((next.x - point.x) / outLength) * r, y: point.y + ((next.y - point.y) / outLength) * r }
        path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`
    }
    return path
}

/** The distance a back edge first runs out of its source's side before it turns. */
export const STEPS_BACK_LEAVE = 12
const BACK_CHANNEL_FIRST = 14
const BACK_CHANNEL_STEP = 12
const BACK_TARGET_FIRST = 10
const BACK_TARGET_STEP = 14
const BACK_ENTRY_STEP = 12

/**
 * The points of a back edge, from its source handle to its target handle (screen coordinates, the handles at the middle of a side): out of
 * the source's side, along to its channel under the source's layer, across to beside the target, and back along into the target's side.
 */
export const stepsBackRoute = (
    source: FlowGraphPoint,
    target: FlowGraphPoint,
    route: StepsBackRoute,
    direction: FlowGraphDirection,
): ReadonlyArray<FlowGraphPoint> => {
    // Work in (across, along): x/y for TB, y/x for LR.
    const toLocal = (point: FlowGraphPoint) => direction === "TB" ? { a: point.x, l: point.y } : { a: point.y, l: point.x }
    const toScreen = (a: number, l: number): FlowGraphPoint => direction === "TB" ? { x: a, y: l } : { x: l, y: a }
    const s = toLocal(source)
    const t = toLocal(target)
    const leave = route.sourceSide === "start" ? -STEPS_BACK_LEAVE : STEPS_BACK_LEAVE
    const beside = route.targetSide === "start" ? -route.targetOffset : route.targetOffset
    const entry = t.l + route.entryOffset
    return [
        toScreen(s.a, s.l),
        toScreen(s.a + leave, s.l),
        toScreen(s.a + leave, route.channel),
        toScreen(t.a + beside, route.channel),
        toScreen(t.a + beside, entry),
        toScreen(t.a, entry),
    ]
}

/** The `steps` layout of a graph (see the module comment). */
export const stepsLayout = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>, direction: FlowGraphDirection): StepsLayout => {
    const known = new Set(nodes.map((node) => node.id))
    const usable = edges.filter((edge) => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target)
    const forward = usable.filter((edge) => !isBackEdge(edge))
    // Longest path over the forward edges; an edge that closes a cycle is bounded by the node count.
    const layers = new Map<string, number>(nodes.map((node) => [node.id, 0]))
    for (let pass = 0; pass < nodes.length; pass += 1) {
        let changed = false
        for (const edge of forward) {
            const next = (layers.get(edge.source) ?? 0) + 1
            if (next > (layers.get(edge.target) ?? 0) && next < nodes.length) {
                layers.set(edge.target, next)
                changed = true
            }
        }
        if (!changed) break
    }
    const layerOf = (id: string) => layers.get(id) ?? 0
    const ports = new Map(nodes.map((node) => [node.id, portsOf(node, usable)]))

    // The tree: a node hangs under the source of its first forward edge that runs down a layer or more.
    const parent = new Map<string, string>()
    const children = new Map<string, Array<{ readonly id: string, readonly order: number }>>()
    forward.forEach((edge, index) => {
        if (parent.has(edge.target) || layerOf(edge.target) <= layerOf(edge.source)) return
        parent.set(edge.target, edge.source)
        const sourcePorts = ports.get(edge.source) ?? []
        const port = portOfEdge(edge, sourcePorts)
        const order = port === undefined ? sourcePorts.length * edges.length + index : sourcePorts.indexOf(port) * edges.length + index
        children.set(edge.source, [...(children.get(edge.source) ?? []), { id: edge.target, order }])
    })
    const kids = (id: string) => [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order).map((child) => child.id)

    // Tidy columns: a leaf takes the next column, a parent sits centred over its first and last child.
    const across = new Map<string, number>()
    let nextColumn = 0
    const place = (id: string, seen: Set<string>): number => {
        if (seen.has(id)) return across.get(id) ?? nextColumn
        seen.add(id)
        const own = kids(id).filter((child) => !seen.has(child))
        if (own.length === 0) {
            const column = nextColumn
            nextColumn += 1
            across.set(id, column)
            return column
        }
        const placed = own.map((child) => place(child, seen))
        const column = ((placed[0] ?? 0) + (placed[placed.length - 1] ?? 0)) / 2
        across.set(id, column)
        return column
    }
    const seen = new Set<string>()
    for (const node of nodes) if (!parent.has(node.id)) place(node.id, seen)
    for (const node of nodes) if (!across.has(node.id)) place(node.id, seen)

    // The extent of every layer along the flow: TB rows as tall as their tallest card, LR columns one card wide.
    const layerCount = Math.max(0, ...layers.values()) + 1
    const extent = new Array<number>(layerCount).fill(0)
    for (const node of nodes) {
        const size = direction === "TB" ? stepsNodeHeight(node, (ports.get(node.id) ?? []).length) : STEPS_CARD_WIDTH
        extent[layerOf(node.id)] = Math.max(extent[layerOf(node.id)] ?? 0, size)
    }
    const layerStart: number[] = []
    let along = 0
    for (const size of extent) {
        layerStart.push(along)
        along += size + STEPS_LAYER_GAP[direction]
    }
    const alongSize = Math.max(0, along - STEPS_LAYER_GAP[direction])
    const crossStep = direction === "TB" ? STEPS_CARD_WIDTH + STEPS_COLUMN_GAP : Math.max(TILE + CARD_CHROME, ...nodes.map((node) => stepsNodeHeight(node, (ports.get(node.id) ?? []).length))) + STEPS_COLUMN_GAP

    const positions = new Map<string, FlowGraphPoint>()
    for (const node of nodes) {
        const layer = layerOf(node.id)
        const l = (layerStart[layer] ?? 0) + (extent[layer] ?? 0) / 2
        const a = (across.get(node.id) ?? 0) * crossStep
        positions.set(node.id, direction === "TB" ? { x: a, y: l } : { x: l, y: a })
    }

    // Back edges: grouped by target side, the nearest source takes the shallowest channel, the widest offset and the highest entry, so
    // the routes nest and never cross one another.
    const back = new Map<string, StepsBackRoute>()
    const backEdges = usable.filter(isBackEdge)
    const sideOf = (edge: FlowGraphEdge) => {
        const s = across.get(edge.source) ?? 0
        const t = across.get(edge.target) ?? 0
        // A source right of (below) its target leaves its start side and enters the target's end side; level, both use the end side.
        return s > t ? { sourceSide: "start" as const, targetSide: "end" as const } : s < t ? { sourceSide: "end" as const, targetSide: "start" as const } : { sourceSide: "end" as const, targetSide: "end" as const }
    }
    const groups = new Map<string, FlowGraphEdge[]>()
    for (const edge of backEdges) {
        const key = `${edge.target}:${sideOf(edge).targetSide}`
        groups.set(key, [...(groups.get(key) ?? []), edge])
    }
    const channelUse = new Map<number, number>()
    for (const group of groups.values()) {
        const sorted = [...group].sort((a, b) => Math.abs((across.get(a.source) ?? 0) - (across.get(a.target) ?? 0)) - Math.abs((across.get(b.source) ?? 0) - (across.get(b.target) ?? 0)))
        sorted.forEach((edge, k) => {
            const layer = layerOf(edge.source)
            const used = channelUse.get(layer) ?? 0
            channelUse.set(layer, used + 1)
            const sides = sideOf(edge)
            back.set(edge.id, {
                channel: (layerStart[layer] ?? 0) + (extent[layer] ?? 0) + BACK_CHANNEL_FIRST + used * BACK_CHANNEL_STEP,
                targetOffset: BACK_TARGET_FIRST + (sorted.length - 1 - k) * BACK_TARGET_STEP,
                entryOffset: (k - (sorted.length - 1) / 2) * BACK_ENTRY_STEP,
                ...sides,
            })
        })
    }
    // The layer gap holds three channels under a layer; a fourth back edge out of one layer runs over the next layer's curves.

    const columns = Math.max(1, nextColumn)
    const acrossSize = (columns - 1) * crossStep + (direction === "TB" ? STEPS_CARD_WIDTH : crossStep - STEPS_COLUMN_GAP)
    const width = (direction === "TB" ? acrossSize : alongSize) + 2 * STEPS_MARGIN
    const height = (direction === "TB" ? alongSize : acrossSize) + 2 * STEPS_MARGIN
    return { positions, layers, ports, back, width, height }
}
