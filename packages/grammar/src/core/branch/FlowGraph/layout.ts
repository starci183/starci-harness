import type { FlowGraphDirection, FlowGraphEdge, FlowGraphNode } from "./types.js"

export type FlowGraphPoint = { readonly x: number, readonly y: number }

/** Distance of the first ring from the root, and the step between the rings after it. */
export const FLOW_GRAPH_FIRST_RING = 200
export const FLOW_GRAPH_RING_STEP = 170

/** The node a radial or orbit layout puts in the centre: the one flagged `isRoot`, else the first. */
export const flowGraphRoot = <Node extends { readonly isRoot?: boolean }>(nodes: ReadonlyArray<Node>): Node | undefined =>
    nodes.find((node) => node.isRoot === true) ?? nodes[0]

/**
 * Radial positions, node centres in graph units, the root at (0, 0). Direct children of the root sit evenly on
 * the first ring; each deeper level sits on the next ring, spread over the wedge of its parent so a branch
 * stays together. Nodes the root cannot reach through any edge (either direction) share an outer ring.
 */
export const radialPositions = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>): ReadonlyMap<string, FlowGraphPoint> => {
    const positions = new Map<string, FlowGraphPoint>()
    const root = flowGraphRoot(nodes)
    if (root === undefined) return positions
    const known = new Set(nodes.map((node) => node.id))
    const neighbours = new Map<string, string[]>()
    for (const edge of edges) {
        if (!known.has(edge.source) || !known.has(edge.target)) continue
        neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target])
        neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source])
    }
    positions.set(root.id, { x: 0, y: 0 })
    const radius = (depth: number) => FLOW_GRAPH_FIRST_RING + (depth - 1) * FLOW_GRAPH_RING_STEP
    const place = (id: string, depth: number, angle: number) => {
        positions.set(id, { x: Math.cos(angle) * radius(depth), y: Math.sin(angle) * radius(depth) })
    }
    // A level at a time. The root shares the full circle out evenly; every other parent spreads its unplaced
    // neighbours over its own wedge, centred on the direction it was placed in, so a branch stays together.
    let level: Array<{ readonly id: string, readonly angle: number, readonly wedge: number }> = [{ id: root.id, angle: -Math.PI / 2, wedge: Math.PI * 2 }]
    let deepest = 0
    for (let depth = 1; level.length > 0; depth += 1) {
        const next: typeof level = []
        for (const parent of level) {
            const children = (neighbours.get(parent.id) ?? []).filter((id, index, all) => !positions.has(id) && all.indexOf(id) === index)
            const slot = parent.wedge / Math.max(children.length, 1)
            children.forEach((id, index) => {
                const angle = depth === 1 ? parent.angle + index * slot : parent.angle + (index - (children.length - 1) / 2) * slot
                place(id, depth, angle)
                deepest = depth
                next.push({ id, angle, wedge: Math.min(slot, Math.PI * 0.9) })
            })
        }
        level = next
    }
    const orphans = nodes.filter((node) => !positions.has(node.id))
    orphans.forEach((node, index) => place(node.id, deepest + 1, -Math.PI / 2 + (index * Math.PI * 2) / orphans.length))
    return positions
}

/** The widest a node draws (`.starci-core-flow-graph-node` `max-inline-size: 14rem`), in graph units. */
export const FLOW_GRAPH_NODE_MAX_WIDTH = 224

/**
 * Centre-to-centre distance between layers along the direction, and between nodes inside one layer. Wherever nodes sit
 * side by side (`TB` lanes, `LR` layers) the step is the widest node plus a gap, so two nodes never overlap; along `TB`
 * the step leaves an edge room to turn between rows of one-line nodes.
 */
export const FLOW_GRAPH_LAYER_GAP = { TB: 100, LR: FLOW_GRAPH_NODE_MAX_WIDTH + 64 } as const
export const FLOW_GRAPH_LANE_GAP = { TB: FLOW_GRAPH_NODE_MAX_WIDTH + 24, LR: 90 } as const

/** The coordinate of layer `index` along the layer axis (y for `TB`, x for `LR`). */
export const layerCoordinate = (index: number, direction: FlowGraphDirection): number => index * FLOW_GRAPH_LAYER_GAP[direction]

/** The layer of every node: one after its deepest predecessor (longest path). Edges that close a cycle are ignored. */
export const layerOf = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>): ReadonlyMap<string, number> => {
    const known = new Set(nodes.map((node) => node.id))
    const layers = new Map<string, number>(nodes.map((node) => [node.id, 0]))
    const usable = edges.filter((edge) => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target)
    // Relaxation bounded by the node count, so a cycle cannot loop for ever.
    for (let pass = 0; pass < nodes.length; pass += 1) {
        let changed = false
        for (const edge of usable) {
            const next = (layers.get(edge.source) ?? 0) + 1
            if (next > (layers.get(edge.target) ?? 0) && next < nodes.length) {
                layers.set(edge.target, next)
                changed = true
            }
        }
        if (!changed) break
    }
    return layers
}

/**
 * Layered positions for a DAG: a node sits in the layer after its deepest predecessor (longest path), the nodes of a
 * layer are spread evenly across the other axis in input order. Edges that close a cycle are ignored.
 */
export const layeredPositions = (
    nodes: ReadonlyArray<FlowGraphNode>,
    edges: ReadonlyArray<FlowGraphEdge>,
    direction: FlowGraphDirection,
): { readonly positions: ReadonlyMap<string, FlowGraphPoint>, readonly layers: ReadonlyMap<string, number> } => {
    const layers = layerOf(nodes, edges)
    const byLayer = new Map<number, string[]>()
    for (const node of nodes) {
        const layer = layers.get(node.id) ?? 0
        byLayer.set(layer, [...(byLayer.get(layer) ?? []), node.id])
    }
    const positions = new Map<string, FlowGraphPoint>()
    for (const [layer, ids] of byLayer) {
        ids.forEach((id, index) => {
            const along = layerCoordinate(layer, direction)
            const across = (index - (ids.length - 1) / 2) * FLOW_GRAPH_LANE_GAP[direction]
            positions.set(id, direction === "LR" ? { x: along, y: across } : { x: across, y: along })
        })
    }
    return { positions, layers }
}

/**
 * Where a layered edge turns, as React Flow's smoothstep `stepPosition` (0 at the source, 1 at the target). An edge to
 * the next layer turns half-way, in the one gap. An edge that skips layers would turn half-way too, which is inside an
 * intermediate layer, so its cross segment would run under a node there and read as an edge to that node. It turns in
 * the last gap instead (running along the source's lane through the skipped layers) or, when a node sits in that lane,
 * in the first gap (running along the target's lane). A node within half a lane gap of the run blocks it.
 */
export const layeredStepPosition = (
    edge: FlowGraphEdge,
    positions: ReadonlyMap<string, FlowGraphPoint>,
    layers: ReadonlyMap<string, number>,
    direction: FlowGraphDirection,
): number | undefined => {
    const from = layers.get(edge.source)
    const to = layers.get(edge.target)
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (from === undefined || to === undefined || source === undefined || target === undefined) return undefined
    const span = to - from
    if (span <= 1) return undefined
    const acrossOf = (point: FlowGraphPoint) => direction === "LR" ? point.y : point.x
    const clearance = FLOW_GRAPH_LANE_GAP[direction] / 2
    const isFree = (across: number) => {
        for (const [id, layer] of layers) {
            if (layer <= from || layer >= to) continue
            const point = positions.get(id)
            if (point !== undefined && Math.abs(acrossOf(point) - across) < clearance) return false
        }
        return true
    }
    if (isFree(acrossOf(source))) return 1 - 0.5 / span
    if (isFree(acrossOf(target))) return 0.5 / span
    return 1 - 0.5 / span
}

/** The `lanes` layout, in graph units: every node is one width, a column is a step, a row is a step. */
export const LANES_NODE_WIDTH = 128
export const LANES_NODE_HEIGHT = 68
export const LANES_COLUMN_STEP = 232
export const LANES_ROW_STEP = 84
/** Where an edge leaves its source column, from the node's right edge: every branch of a node forks from that one point. */
export const LANES_FORK_FIRST = 14
/** Each further node of a column that forks moves its fork point this far right, so two trunks never share a vertical line. */
export const LANES_FORK_STEP = 12
/** The room above the first row for the column headers, and the margin around the graph. */
export const LANES_HEADER_ROOM = 44

export type LanesLayout = {
    readonly positions: ReadonlyMap<string, FlowGraphPoint>
    /** The column of every node. */
    readonly columns: ReadonlyMap<string, number>
    /** The row of every node: row 0 is the main path, each branch after the first child of a node takes the next free row. */
    readonly rows: ReadonlyMap<string, number>
    readonly rowCount: number
    readonly columnCount: number
    /** For a node that forks (it has a child in another row), the order of its fork point among the forking nodes of its column, top first. */
    readonly forks: ReadonlyMap<string, number>
}

/**
 * Branch lanes: a node sits in the column after its deepest predecessor, and a path reads left to right on one row. The first
 * child of a node keeps its row, and every further child (a branch of a condition) takes the nearest row below that is free
 * for the whole run from the source's column to its own, so no line crosses a node and no row stays empty between branches.
 * A node with several parents follows the first one. Edges that close a cycle are ignored.
 */
export const lanesLayout = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>): LanesLayout => {
    const columns = layerOf(nodes, edges)
    const known = new Set(nodes.map((node) => node.id))
    const incoming = new Map<string, string[]>()
    for (const edge of edges) {
        if (!known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) continue
        if ((columns.get(edge.source) ?? 0) >= (columns.get(edge.target) ?? 0)) continue
        incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
    }
    const order = [...nodes].sort((a, b) => (columns.get(a.id) ?? 0) - (columns.get(b.id) ?? 0))
    const rows = new Map<string, number>()
    const taken = new Set<string>()
    const cell = (column: number, row: number) => `${column}:${row}`
    const isFree = (row: number, from: number, to: number) => {
        for (let column = from; column <= to; column += 1) if (taken.has(cell(column, row))) return false
        return true
    }
    for (const node of order) {
        const column = columns.get(node.id) ?? 0
        const parent = (incoming.get(node.id) ?? [])[0]
        const parentRow = parent === undefined ? undefined : rows.get(parent)
        const parentColumn = parent === undefined ? column : (columns.get(parent) ?? 0)
        let row = parentRow ?? 0
        // The run along the target's row from the column after the source to this one must be free.
        while (!isFree(row, parent === undefined ? column : parentColumn + 1, column)) row += 1
        // A node that starts a path (no parent) takes the first free row of its column.
        rows.set(node.id, row)
        taken.add(cell(column, row))
    }
    const positions = new Map<string, FlowGraphPoint>()
    for (const node of nodes) positions.set(node.id, { x: (columns.get(node.id) ?? 0) * LANES_COLUMN_STEP, y: (rows.get(node.id) ?? 0) * LANES_ROW_STEP })
    const forks = new Map<string, number>()
    const perColumn = new Map<number, number>()
    const children = new Map<string, string[]>()
    for (const [target, sources] of incoming) {
        const first = sources[0]
        if (first !== undefined) children.set(first, [...(children.get(first) ?? []), target])
    }
    const forking = nodes
        .filter((node) => (children.get(node.id) ?? []).some((child) => rows.get(child) !== rows.get(node.id)))
        .sort((a, b) => (rows.get(a.id) ?? 0) - (rows.get(b.id) ?? 0))
    for (const node of forking) {
        const column = columns.get(node.id) ?? 0
        const k = perColumn.get(column) ?? 0
        forks.set(node.id, k)
        perColumn.set(column, k + 1)
    }
    return {
        forks,
        positions,
        columns,
        rows,
        rowCount: Math.max(0, ...rows.values()) + 1,
        columnCount: Math.max(0, ...columns.values()) + 1,
    }
}

/**
 * Where a lanes edge turns, as React Flow's smoothstep `stepPosition`: a fixed distance after the source's right edge, whatever the
 * span, so the branches of one node fork from one point and then run along their own row through the columns they skip; `fork` is
 * the node's place among the forking nodes of its column, which keeps their trunks apart.
 */
export const lanesStepPosition = (span: number, fork: number): number => {
    const distance = Math.max(span, 1) * LANES_COLUMN_STEP - LANES_NODE_WIDTH
    return (LANES_FORK_FIRST + fork * LANES_FORK_STEP) / distance
}

/** The canvas height that holds a lanes graph at zoom 1, headers and margin included. */
export const lanesNaturalHeight = (layout: LanesLayout, hasHeaders: boolean): number =>
    (layout.rowCount - 1) * LANES_ROW_STEP + LANES_NODE_HEIGHT + (hasHeaders ? LANES_HEADER_ROOM : 0) + 48
