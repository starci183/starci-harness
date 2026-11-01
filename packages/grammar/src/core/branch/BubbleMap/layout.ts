import { flowGraphRoot, type FlowGraphPoint } from "../FlowGraph/layout.js"
import type { BubbleMapEdge, BubbleMapNode } from "./types.js"

/** The bubble width range in graph units, and the width a bubble takes when it gives none. */
export const BUBBLE_DIAMETER = { min: 24, max: 128 } as const
export const BUBBLE_DEFAULT_DIAMETER = 48

const clampDiameter = (value: number): number => Math.min(BUBBLE_DIAMETER.max, Math.max(BUBBLE_DIAMETER.min, value))

/**
 * The bubble width for a value: a square-root scale, so the disc's area tracks the value. `max` is the value that draws at the
 * widest, `range.max`; a value of 0 or less draws at `range.min`. The range defaults to the 24 to 128 a bubble accepts.
 */
export const bubbleDiameter = (value: number, max: number, range: { readonly min: number, readonly max: number } = BUBBLE_DIAMETER): number => {
    if (!(max > 0) || !(value > 0)) return clampDiameter(range.min)
    const scaled = range.max * Math.sqrt(Math.min(value / max, 1))
    return clampDiameter(Math.round(Math.max(range.min, scaled)))
}

/** The width a bubble draws at: its `diameter` held to the range. */
export const bubbleNodeDiameter = (node: BubbleMapNode): number => clampDiameter(node.diameter ?? BUBBLE_DEFAULT_DIAMETER)

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

export type BubbleMapMore = {
    /** The id of the synthetic `+n` bubble. */
    readonly id: string
    /** The node whose fan it closes; selecting the bubble selects this node. */
    readonly parentId: string
    /** How many members the fan holds beyond the limit. */
    readonly count: number
}

export type BubbleMapLayout = {
    readonly positions: ReadonlyMap<string, FlowGraphPoint>
    /** The parent of every node the root reaches, along the shortest path. */
    readonly parents: ReadonlyMap<string, string>
    /** The ids of the real nodes that draw now: rings one to three, the fans of open nodes, and the nodes the root does not reach. */
    readonly visible: ReadonlySet<string>
    /** The nodes on ring three that hold deeper nodes, which show only while the node is open. */
    readonly expandable: ReadonlySet<string>
    readonly more: ReadonlyArray<BubbleMapMore>
    /** The dashed guide rings. */
    readonly radii: ReadonlyArray<number>
    /** Half the width of the square that holds the guides. */
    readonly extent: number
}

export const bubbleMapMoreId = (parentId: string): string => `grammar-flow-more-${parentId}`

const adjacency = (nodes: ReadonlyArray<BubbleMapNode>, edges: ReadonlyArray<BubbleMapEdge>): ReadonlyMap<string, ReadonlyArray<string>> => {
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
export const bubbleMapLayout = (
    nodes: ReadonlyArray<BubbleMapNode>,
    edges: ReadonlyArray<BubbleMapEdge>,
    options: { readonly expanded: ReadonlySet<string>, readonly fanLimit: number },
): BubbleMapLayout => {
    const positions = new Map<string, FlowGraphPoint>()
    const parents = new Map<string, string>()
    const visible = new Set<string>()
    const expandable = new Set<string>()
    const more: BubbleMapMore[] = []
    const radii: number[] = []
    const root = flowGraphRoot(nodes)
    if (root === undefined) return { positions, parents, visible, expandable, more, radii, extent: 0 }
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const spanOf = (id: string): number => {
        const node = byId.get(id)
        return node?.form === "bubble" ? bubbleNodeDiameter(node) : ORBIT_LABEL_SPAN
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
                    const id = bubbleMapMoreId(fan.id)
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

