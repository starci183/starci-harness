import type { FlowGraphDirection, FlowGraphEdge, FlowGraphNode } from "./types.js"

export type FlowGraphPoint = { readonly x: number, readonly y: number }

/** Distance of the first ring from the root, and the step between the rings after it. */
export const FLOW_GRAPH_FIRST_RING = 200
export const FLOW_GRAPH_RING_STEP = 170

/** The node the radial layout puts in the centre: the one flagged `isRoot`, else the first. */
export const flowGraphRoot = (nodes: ReadonlyArray<FlowGraphNode>): FlowGraphNode | undefined =>
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

/** Distance between layers along the direction, and between nodes inside one layer. */
export const FLOW_GRAPH_LAYER_GAP = { TB: 130, LR: 240 } as const
export const FLOW_GRAPH_LANE_GAP = { TB: 220, LR: 90 } as const

/** The coordinate of layer `index` along the layer axis (y for `TB`, x for `LR`). */
export const layerCoordinate = (index: number, direction: FlowGraphDirection): number => index * FLOW_GRAPH_LAYER_GAP[direction]

/**
 * Layered positions for a DAG: a node sits in the layer after its deepest predecessor (longest path), the nodes of a
 * layer are spread evenly across the other axis in input order. Edges that close a cycle are ignored.
 */
export const layeredPositions = (
    nodes: ReadonlyArray<FlowGraphNode>,
    edges: ReadonlyArray<FlowGraphEdge>,
    direction: FlowGraphDirection,
): { readonly positions: ReadonlyMap<string, FlowGraphPoint>, readonly layers: ReadonlyMap<string, number> } => {
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
