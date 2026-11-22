import type { Box, LinkEnds, PortSide } from "./layout.js"
import type { GraphPosition } from "./types.js"

/** A route and its label box while the layout is being arranged: the points are copied, never shared with ELK. */
export interface MutableRoute {
    points: [number, number][]
    label?: { x: number; y: number; width: number; height: number }
}

export interface Arrangement {
    /** The top nodes of the island. */
    readonly island: readonly string[]
    /** The links between them, without back edges. */
    readonly links: readonly LinkEnds[]
    /** The side of each port of a node, by node and port id. */
    readonly sides: ReadonlyMap<string, PortSide>
    readonly positions: Record<string, GraphPosition>
    readonly boxes: Readonly<Record<string, Box>>
    readonly routes: Record<string, MutableRoute>
}

const centre = (a: Arrangement, id: string): number => (a.positions[id]?.x ?? 0) + (a.boxes[id]?.width ?? 0) / 2

/** Everything reachable from `from` along the links. */
const reach = (next: ReadonlyMap<string, readonly string[]>, from: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [from]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        if (seen.has(id)) continue
        seen.add(id)
        queue.push(...(next.get(id) ?? []))
    }
    return seen
}

/** The route of an edge whose ends moved by different amounts: out of its source, straight on to the column of its target, then down into it. */
const reroute = (route: MutableRoute, start: readonly [number, number], end: readonly [number, number]): MutableRoute => {
    const sideways = route.points[1] !== undefined && route.points[0]?.[1] === route.points[1][1]
    const points: [number, number][] = sideways
        ? [[start[0], start[1]], [end[0], start[1]], [end[0], end[1]]]
        : [[start[0], start[1]], [start[0], Math.round((start[1] + end[1]) / 2)], [end[0], Math.round((start[1] + end[1]) / 2)], [end[0], end[1]]]
    const label = route.label
    if (label === undefined) return { points }
    // The words stand on the first straight run: beside the source, above a sideways run, to the right of a downward one.
    const x = sideways ? (end[0] < start[0] ? start[0] - 12 - label.width : start[0] + 12) : start[0] + 8
    const y = sideways ? start[1] - label.height - 6 : start[1] + 8
    return { points, label: { x: Math.round(x), y: Math.round(y), width: label.width, height: label.height } }
}

/**
 * Makes each decision symmetric: the two branches (the ones leaving by its west and its east port) stand equally far either side of it. The deepest decision goes
 * first, and a branch moves with everything only it reaches (a subtree moves as one), outward, so nothing comes closer to anything. The edges of what moved are
 * moved with it, or, when their two ends moved by different amounts, drawn again in the same orthogonal way. Deterministic: the same input, the same moves.
 */
export const symmetrise = (a: Arrangement): void => {
    const top = new Set(a.island)
    const next = new Map<string, string[]>()
    for (const link of a.links) if (top.has(link.source) && top.has(link.target)) next.set(link.source, [...(next.get(link.source) ?? []), link.target])
    const depth = new Map<string, number>()
    const depthOf = (id: string, trail: ReadonlySet<string>): number => {
        const known = depth.get(id)
        if (known !== undefined) return known
        if (trail.has(id)) return 0
        const value = 1 + Math.max(-1, ...(next.get(id) ?? []).map((child) => depthOf(child, new Set([...trail, id]))))
        depth.set(id, value)
        return value
    }
    const decisions = a.island.flatMap((id) => {
        const west = a.links.find((link) => link.source === id && link.sourcePort !== undefined && a.sides.get(`${id}\u0000${link.sourcePort}`) === "WEST")
        const east = a.links.find((link) => link.source === id && link.sourcePort !== undefined && a.sides.get(`${id}\u0000${link.sourcePort}`) === "EAST")
        return west === undefined || east === undefined || !top.has(west.target) || !top.has(east.target) ? [] : [{ id, left: west.target, right: east.target }]
    })
    // The deepest decision first (a larger depth is nearer the start, so the smallest goes first).
    decisions.sort((p, q) => depthOf(p.id, new Set()) - depthOf(q.id, new Set()) || p.id.localeCompare(q.id))

    const moved = new Map<string, number>()
    for (const d of decisions) {
        const reachLeft = reach(next, d.left)
        const reachRight = reach(next, d.right)
        const own = (mine: ReadonlySet<string>, other: ReadonlySet<string>): string[] => [...mine].filter((id) => !other.has(id) && id !== d.id)
        const left = own(reachLeft, reachRight)
        const right = own(reachRight, reachLeft)
        const toLeft = centre(a, d.id) - centre(a, d.left)
        const toRight = centre(a, d.right) - centre(a, d.id)
        if (toLeft <= 0 || toRight <= 0 || Math.abs(toLeft - toRight) < 1) continue
        const far = Math.max(toLeft, toRight)
        for (const [ids, by] of [[left, -(far - toLeft)], [right, far - toRight]] as const)
            for (const id of ids) {
                const at = a.positions[id]
                if (at === undefined) continue
                a.positions[id] = { x: Math.round(at.x + by), y: at.y }
                moved.set(id, (moved.get(id) ?? 0) + by)
            }
    }
    if (moved.size === 0) return

    for (const link of a.links) {
        const id = link.id
        const route = id === undefined ? undefined : a.routes[id]
        if (id === undefined || route === undefined) continue
        const ds = moved.get(link.source) ?? 0
        const dt = moved.get(link.target) ?? 0
        if (ds === 0 && dt === 0) continue
        const first = route.points[0]
        const last = route.points[route.points.length - 1]
        if (first === undefined || last === undefined) continue
        if (ds === dt) {
            a.routes[id] = {
                points: route.points.map(([x, y]) => [Math.round(x + ds), y]),
                ...(route.label === undefined ? {} : { label: { ...route.label, x: Math.round(route.label.x + ds) } }),
            }
        } else a.routes[id] = reroute(route, [Math.round(first[0] + ds), first[1]], [Math.round(last[0] + dt), last[1]])
    }

    // Moving outward can leave the island left of its origin: bring it back.
    const left = Math.min(...a.island.map((id) => a.positions[id]?.x ?? 0))
    if (left < 0) {
        for (const [id, at] of Object.entries(a.positions)) if (a.island.includes(id)) a.positions[id] = { x: at.x - left, y: at.y }
        for (const route of Object.values(a.routes)) {
            route.points = route.points.map(([x, y]) => [x - left, y])
            if (route.label !== undefined) route.label = { ...route.label, x: route.label.x - left }
        }
    }
}

/**
 * Keeps the labels of edges that leave one node at least `gap` apart: one that would sit too near an earlier one slides along the first straight run of its own
 * edge (as far as the run lets it), so the words stay on their edge.
 */
export const separateLabels = (links: readonly LinkEnds[], routes: Record<string, MutableRoute>, gap: number): void => {
    const placed = new Map<string, { x: number; y: number; width: number; height: number }[]>()
    for (const link of links) {
        const route = link.id === undefined ? undefined : routes[link.id]
        const label = route?.label
        const first = route?.points[0]
        const second = route?.points[1]
        if (route === undefined || label === undefined || first === undefined || second === undefined) continue
        const earlier = placed.get(link.source) ?? []
        const hits = (box: { x: number; y: number; width: number; height: number }): boolean =>
            earlier.some((other) => box.x < other.x + other.width + gap && other.x < box.x + box.width + gap && box.y < other.y + other.height + gap && other.y < box.y + box.height + gap)
        // Along the first run: downward when it runs down, sideways when it runs sideways.
        const down = first[0] === second[0]
        const room = Math.abs(down ? second[1] - first[1] : second[0] - first[0])
        const step = down ? { x: 0, y: 4 } : { x: Math.sign(second[0] - first[0]) * 4, y: 0 }
        let box = { ...label }
        for (let travelled = 0; hits(box) && travelled < room; travelled += 4) box = { ...box, x: box.x + step.x, y: box.y + step.y }
        route.label = box
        placed.set(link.source, [...earlier, box])
    }
}
