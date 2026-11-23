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
    /** The flow's direction: a decision's main branch continues along it (default top-down). */
    readonly direction?: "LR" | "TB"
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
 * Aligns each decision's main branch (owner: "Chốt", the routing law, rule 3): the branch leaving by the port on the flow's side (SOUTH top-down, EAST across)
 * continues straight on, its target centred on the decision across the flow, and the other branches turn to the side. The deepest decision goes first; the main
 * branch moves with everything only it reaches (a subtree moves as one) and the side branches move with it by the same amount, away from the decision, so
 * nothing comes closer to anything. The edges of what moved are moved with it, or, when their two ends moved by different amounts, drawn again in the same
 * orthogonal way. Deterministic: the same input, the same moves.
 */
export const alignDecisions = (a: Arrangement): void => {
    const top = new Set(a.island)
    const across = a.direction === "LR" ? 1 : 0
    const mainSide: PortSide = a.direction === "LR" ? "EAST" : "SOUTH"
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
    const sideOf = (id: string, link: LinkEnds): PortSide | undefined => (link.sourcePort === undefined ? undefined : a.sides.get(`${id}\u0000${link.sourcePort}`))
    const decisions = a.island.flatMap((id) => {
        const out = a.links.filter((link) => link.source === id && link.sourcePort !== undefined && top.has(link.target))
        const main = out.find((link) => sideOf(id, link) === mainSide)
        const others = out.filter((link) => link !== main && sideOf(id, link) !== undefined)
        return main === undefined || others.length === 0 ? [] : [{ id, main: main.target, others: others.map((link) => link.target) }]
    })
    // The deepest decision first (a larger depth is nearer the start, so the smallest goes first).
    decisions.sort((p, q) => depthOf(p.id, new Set()) - depthOf(q.id, new Set()) || p.id.localeCompare(q.id))
    const centreOf = (id: string): number => (across === 0 ? centre(a, id) : (a.positions[id]?.y ?? 0) + (a.boxes[id]?.height ?? 0) / 2)
    const moved = new Map<string, number>()
    const shift = (id: string, by: number): void => {
        const at = a.positions[id]
        if (at === undefined) return
        a.positions[id] = across === 0 ? { x: Math.round(at.x + by), y: at.y } : { x: at.x, y: Math.round(at.y + by) }
        moved.set(id, (moved.get(id) ?? 0) + by)
    }
    for (const d of decisions) {
        const by = centreOf(d.id) - centreOf(d.main)
        if (Math.abs(by) < 1) continue
        const reachMain = reach(next, d.main)
        const reachOthers = d.others.map((other) => reach(next, other))
        const shared = (id: string, sets: readonly ReadonlySet<string>[]): boolean => sets.some((set) => set.has(id))
        const ownMain = [...reachMain].filter((id) => id !== d.id && !shared(id, reachOthers))
        // A side branch moves with the main one only when it stands on the side the main one moves towards, so it is pushed away, never pulled in.
        const ownOthers = reachOthers.flatMap((set, index) => {
            const other = d.others[index]
            if (other === undefined || Math.sign(centreOf(other) - centreOf(d.main)) !== Math.sign(by)) return []
            return [...set].filter((id) => id !== d.id && !reachMain.has(id) && !reachOthers.some((each, at) => at !== index && each.has(id)))
        })
        for (const id of new Set([...ownMain, ...ownOthers])) shift(id, by)
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
        const move = (point: readonly [number, number], by: number): [number, number] => (across === 0 ? [Math.round(point[0] + by), point[1]] : [point[0], Math.round(point[1] + by)])
        if (ds === dt) {
            a.routes[id] = {
                points: route.points.map((point) => move(point, ds)),
                ...(route.label === undefined ? {} : { label: across === 0 ? { ...route.label, x: Math.round(route.label.x + ds) } : { ...route.label, y: Math.round(route.label.y + ds) } }),
            }
        } else a.routes[id] = reroute(route, move(first, ds), move(last, dt))
    }

    // Moving outward can leave the island left of or above its origin: bring it back.
    const left = Math.min(...a.island.map((id) => a.positions[id]?.x ?? 0))
    if (left < 0) {
        for (const [id, at] of Object.entries(a.positions)) if (a.island.includes(id)) a.positions[id] = { x: at.x - left, y: at.y }
        for (const route of Object.values(a.routes)) {
            route.points = route.points.map(([x, y]) => [x - left, y])
            if (route.label !== undefined) route.label = { ...route.label, x: route.label.x - left }
        }
    }
    const above = Math.min(...a.island.map((id) => a.positions[id]?.y ?? 0))
    if (above < 0) {
        for (const [id, at] of Object.entries(a.positions)) if (a.island.includes(id)) a.positions[id] = { x: at.x, y: at.y - above }
        for (const route of Object.values(a.routes)) {
            route.points = route.points.map(([x, y]) => [x, y - above])
            if (route.label !== undefined) route.label = { ...route.label, y: route.label.y - above }
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
