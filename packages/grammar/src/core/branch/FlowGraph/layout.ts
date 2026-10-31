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

/** The bubble width range in graph units, and the width a bubble takes when it gives none. */
export const FLOW_GRAPH_DIAMETER = { min: 24, max: 128 } as const
export const FLOW_GRAPH_DEFAULT_DIAMETER = 48

const clampDiameter = (value: number): number => Math.min(FLOW_GRAPH_DIAMETER.max, Math.max(FLOW_GRAPH_DIAMETER.min, value))

/**
 * The bubble width for a value: a square-root scale, so the disc's area tracks the value. `max` is the value that draws at the
 * widest, `range.max`; a value of 0 or less draws at `range.min`. The range defaults to the 24 to 128 a bubble accepts.
 */
export const flowGraphDiameter = (value: number, max: number, range: { readonly min: number, readonly max: number } = FLOW_GRAPH_DIAMETER): number => {
    if (!(max > 0) || !(value > 0)) return clampDiameter(range.min)
    const scaled = range.max * Math.sqrt(Math.min(value / max, 1))
    return clampDiameter(Math.round(Math.max(range.min, scaled)))
}

/** The width a bubble draws at: its `diameter` held to the range. */
export const flowGraphBubbleDiameter = (node: FlowGraphNode): number => clampDiameter(node.diameter ?? FLOW_GRAPH_DEFAULT_DIAMETER)

/** The ring distances of the orbit layout, in graph units. */
export const ORBIT_SECOND_RING = 226
export const ORBIT_RING_GAP = 136
export const ORBIT_STAGGER = 34
export const ORBIT_FAN_GAP = 160
export const ORBIT_FAN_STEP = 44
const ORBIT_MIN_ARC = 0.44
/** The room a label pill claims on its ring in the orbit layout (a bubble claims its diameter). */
export const ORBIT_LABEL_SPAN = 120
/** How far the guide square reaches past the outermost ring. */
const ORBIT_GUIDE_MARGIN = 30

export type OrbitMore = {
    /** The id of the synthetic `+n` bubble. */
    readonly id: string
    /** The node whose fan it closes; selecting the bubble selects this node. */
    readonly parentId: string
    /** How many members the fan holds beyond the limit. */
    readonly count: number
}

export type OrbitLayout = {
    readonly positions: ReadonlyMap<string, FlowGraphPoint>
    /** The parent of every node the root reaches, along the shortest path. */
    readonly parents: ReadonlyMap<string, string>
    /** The ids of the real nodes that draw now: rings one to three, the fans of open nodes, and the nodes the root does not reach. */
    readonly visible: ReadonlySet<string>
    /** The nodes on ring three that hold deeper nodes, which show only while the node is open. */
    readonly expandable: ReadonlySet<string>
    readonly more: ReadonlyArray<OrbitMore>
    /** The dashed guide rings. */
    readonly radii: ReadonlyArray<number>
    /** Half the width of the square that holds the guides. */
    readonly extent: number
}

export const orbitMoreId = (parentId: string): string => `grammar-flow-more-${parentId}`

const adjacency = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>): ReadonlyMap<string, ReadonlyArray<string>> => {
    const known = new Set(nodes.map((node) => node.id))
    const neighbours = new Map<string, string[]>()
    for (const edge of edges) {
        if (!known.has(edge.source) || !known.has(edge.target)) continue
        neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target])
        neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source])
    }
    return neighbours
}

/** The step between two neighbours on a ring, from their widths: centre to centre, with a gap. */
const orbitStep = (a: number, b: number): number => (a + b) / 2 * 0.68 + 6

type Fan = {
    readonly id: string
    readonly shown: ReadonlyArray<string>
    readonly rest: number
    readonly slots: number
    readonly bearing: number
}

/**
 * Orbit positions, node centres in graph units, the root at (0, 0). Ring two holds the root's children in sectors weighted by
 * what they hold; ring three holds their children, staggered on two radii inside the sector so it stays compact; ring four
 * holds the fans of the ring-three nodes in `expanded`: every node below such a node, up to `fanLimit`, then a `+n` bubble.
 * Fans sit on their node's bearing and push apart when several are open, the sequence cut at the widest empty arc so a fan
 * never wraps into the first one. Nodes the root cannot reach share an outer ring.
 */
export const orbitLayout = (
    nodes: ReadonlyArray<FlowGraphNode>,
    edges: ReadonlyArray<FlowGraphEdge>,
    options: { readonly expanded: ReadonlySet<string>, readonly fanLimit: number },
): OrbitLayout => {
    const positions = new Map<string, FlowGraphPoint>()
    const parents = new Map<string, string>()
    const visible = new Set<string>()
    const expandable = new Set<string>()
    const more: OrbitMore[] = []
    const radii: number[] = []
    const root = flowGraphRoot(nodes)
    if (root === undefined) return { positions, parents, visible, expandable, more, radii, extent: 0 }
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const spanOf = (id: string): number => {
        const node = byId.get(id)
        return node?.form === "bubble" ? flowGraphBubbleDiameter(node) : ORBIT_LABEL_SPAN
    }
    const neighbours = adjacency(nodes, edges)
    const depths = new Map<string, number>([[root.id, 0]])
    const children = new Map<string, string[]>()
    const queue = [root.id]
    for (const id of queue) {
        for (const next of neighbours.get(id) ?? []) {
            if (depths.has(next)) continue
            depths.set(next, (depths.get(id) ?? 0) + 1)
            parents.set(next, id)
            children.set(id, [...(children.get(id) ?? []), next])
            queue.push(next)
        }
    }
    // Every node below `id`, nearest first.
    const below = (id: string): string[] => {
        const found = [...(children.get(id) ?? [])]
        for (const member of found) found.push(...(children.get(member) ?? []))
        return found
    }
    positions.set(root.id, { x: 0, y: 0 })
    visible.add(root.id)
    const ringTwo = children.get(root.id) ?? []
    const bearings = new Map<string, number>()
    let outer = 0
    if (ringTwo.length > 0) {
        const second = Math.max(ORBIT_SECOND_RING, spanOf(root.id) / 2 + Math.max(...ringTwo.map(spanOf)) / 2 + 48)
        const weightOf = (kids: ReadonlyArray<string>): number => kids.reduce((sum, id, index) => {
            const next = kids[index + 1]
            return sum + (next === undefined ? spanOf(id) * 0.7 : orbitStep(spanOf(id), spanOf(next)))
        }, 26)
        const weights = ringTwo.map((id) => weightOf(children.get(id) ?? []))
        const total = weights.reduce((sum, weight) => sum + weight, 0)
        const third = Math.max(second + ORBIT_RING_GAP, total / (2 * Math.PI))
        const raw = weights.map((weight) => Math.max(weight / total * 2 * Math.PI, ORBIT_MIN_ARC))
        const rawSum = raw.reduce((sum, arc) => sum + arc, 0)
        const share = raw.map((arc) => arc / rawSum * 2 * Math.PI)
        let cursor = -Math.PI / 2 - (share[0] ?? 0) / 2
        let cursorThree = -Math.PI / 2 - (weights[0] ?? 0) / total * Math.PI
        ringTwo.forEach((id, index) => {
            const arc = share[index] ?? 0
            const mid = cursor + arc / 2
            cursor += arc
            positions.set(id, { x: Math.cos(mid) * second, y: Math.sin(mid) * second })
            visible.add(id)
            const wedge = (weights[index] ?? 0) / total * 2 * Math.PI
            const midThree = cursorThree + wedge / 2
            cursorThree += wedge
            const kids = children.get(id) ?? []
            const steps = kids.slice(0, -1).map((kid, at) => orbitStep(spanOf(kid), spanOf(kids[at + 1] ?? kid)) / third)
            let angle = midThree - steps.reduce((sum, step) => sum + step, 0) / 2
            kids.forEach((kid, at) => {
                const radius = third + (at % 2 === 0 ? -ORBIT_STAGGER : ORBIT_STAGGER)
                positions.set(kid, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
                visible.add(kid)
                bearings.set(kid, angle)
                if ((children.get(kid) ?? []).length > 0) expandable.add(kid)
                angle += steps[at] ?? 0
            })
        })
        radii.push(second, third)
        outer = third + ORBIT_STAGGER
        // Ring four: the fans of the open nodes of ring three.
        const fans: Fan[] = [...expandable]
            .filter((id) => options.expanded.has(id))
            .sort((a, b) => (bearings.get(a) ?? 0) - (bearings.get(b) ?? 0))
            .map((id) => {
                const members = below(id)
                const shown = members.slice(0, Math.max(1, options.fanLimit))
                const rest = members.length - shown.length
                return { id, shown, rest, slots: shown.length + (rest > 0 ? 1 : 0), bearing: bearings.get(id) ?? 0 }
            })
        if (fans.length > 0) {
            const step = Math.max(ORBIT_FAN_STEP, ...fans.flatMap((fan) => fan.shown.map((id) => spanOf(id) + 8)))
            const slotTotal = fans.reduce((sum, fan) => sum + fan.slots + 1, 0)
            const fourth = Math.max(third + ORBIT_FAN_GAP, slotTotal * step / (2 * Math.PI * 0.92))
            // Cut the circle at its widest empty arc, so a fan never wraps into the first one.
            const first = fans[0]?.bearing ?? 0
            const last = fans[fans.length - 1]?.bearing ?? 0
            const cut = fans.reduce((best, fan, index) => {
                const gap = index === 0 ? first + 2 * Math.PI - last : fan.bearing - (fans[index - 1]?.bearing ?? 0)
                return gap > best.gap ? { gap, index } : best
            }, { gap: -1, index: 0 }).index
            const sequence = fans.map((_fan, index) => {
                const fan = fans[(index + cut) % fans.length]
                return { fan, bearing: (fan?.bearing ?? 0) + (index + cut >= fans.length ? 2 * Math.PI : 0) }
            })
            const angular = step / fourth
            let end = -Infinity
            let wanted = 0
            let got = 0
            const starts = sequence.map((entry) => {
                const run = ((entry.fan?.slots ?? 1) - 1) * angular
                const start = Math.max(entry.bearing - run / 2, end + angular)
                end = start + run
                wanted += entry.bearing
                got += start + run / 2
                return start
            })
            const shift = (wanted - got) / sequence.length
            sequence.forEach((entry, index) => {
                const { fan } = entry
                if (fan === undefined) return
                const place = (id: string, slot: number) => {
                    const angle = (starts[index] ?? 0) + shift + slot * angular
                    positions.set(id, { x: Math.cos(angle) * fourth, y: Math.sin(angle) * fourth })
                }
                fan.shown.forEach((member, slot) => {
                    place(member, slot)
                    visible.add(member)
                })
                if (fan.rest > 0) {
                    const id = orbitMoreId(fan.id)
                    place(id, fan.shown.length)
                    more.push({ id, parentId: fan.id, count: fan.rest })
                }
            })
            radii.push(fourth)
            outer = fourth
        }
    }
    const stray = nodes.filter((node) => !depths.has(node.id))
    stray.forEach((node, index) => {
        const radius = outer + 90
        const angle = -Math.PI / 2 + index * Math.PI * 2 / stray.length
        positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
        visible.add(node.id)
    })
    if (stray.length > 0) outer += 90
    return { positions, parents, visible, expandable, more, radii, extent: outer + ORBIT_GUIDE_MARGIN }
}
