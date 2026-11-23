/**
 * The layout of a flowchart or a state diagram on the graph canvas (pure but for ELK): each node sized for its words in its shape, the containers round
 * their nodes, then the graph ext's own ELK layout and routing law (`layoutFlow`): straight edges between aligned nodes, one bend between offset ones.
 */
import { STRAIGHT_SNAP, layoutFlow, type Box, type FlowLayout, type LayoutPort, type LinkEnds, type Measure, type PortSide, type Route, type SizedNode } from "../layout.js"
import { entrySide, portAt, portSide } from "../model.js"
import type { DiagramGraph, DiagramNode } from "./model.js"
import type { TextWidth } from "./sequence.js"

/** The room a container keeps round its nodes: its name on top. */
export const CONTAINER_INSETS = { top: 36, right: 16, bottom: 16, left: 16 } as const

/** Words wrapped greedily into lines no wider than `max`. */
const wrap = (text: string, max: number, textWidth: TextWidth): readonly string[] =>
    text.split("\n").flatMap((paragraph) => {
        const out: string[] = []
        let line = ""
        for (const word of paragraph.split(/\s+/u)) {
            const next = line === "" ? word : `${line} ${word}`
            if (line !== "" && textWidth(next) > max) {
                out.push(line)
                line = word
            } else line = next
        }
        out.push(line)
        return out
    })

const LINE = 18
const BOX_MAX = 240

/** The box a node needs for its words in its shape. */
export const nodeSize = (node: DiagramNode, direction: "LR" | "TB", textWidth: TextWidth, exits = 0): { readonly width: number; readonly height: number } => {
    const words = wrap(node.label, BOX_MAX - 32, textWidth)
    const wide = Math.max(0, ...words.map(textWidth))
    const tall = words.length * LINE
    switch (node.shape) {
        case "start":
        case "end":
            return { width: 20, height: 20 }
        case "bar":
            return direction === "LR" ? { width: 8, height: 64 } : { width: 64, height: 8 }
        case "diamond": {
            // A switch (three or more exits) is wider, and tall enough that the exits on its slanted sides stand SWITCH_PITCH apart.
            const width = Math.max(exits >= 3 ? 144 : 104, Math.round(wide * 1.5) + 40)
            return { width, height: Math.max(64, Math.round(tall * 1.6) + 40, Math.round(width * 0.55), exits >= 4 ? SWITCH_PITCH * (exits - 1) : 0) }
        }
        case "circle": {
            const side = Math.max(64, wide + 32, tall + 32)
            return { width: side, height: side }
        }
        case "cylinder":
            return { width: Math.max(96, wide + 40), height: Math.max(64, tall + 40) }
        case "container":
            return { width: Math.max(120, wide + 32), height: 0 }
        default:
            return { width: Math.max(node.shape === "stadium" ? 96 : 80, wide + 32), height: Math.max(40, tall + 22) }
    }
}

/** The least distance between two exits of a switch along its slanted side: room for a branch's words on each. */
const SWITCH_PITCH = 28

/** The side the i-th of n exits of a switch leaves by: the first half to the left (above, across), the last to the right (below), the middle one straight on. */
const switchSide = (direction: "LR" | "TB", index: number, count: number): PortSide => {
    const middle = (count - 1) / 2
    if (index < middle) return direction === "TB" ? "WEST" : "NORTH"
    if (index > middle) return direction === "TB" ? "EAST" : "SOUTH"
    return direction === "TB" ? "SOUTH" : "EAST"
}

/** Where the i-th of n exits of a switch leaves its diamond: spread from the first side vertex, along the slanted sides, to the last, the middle one at the end vertex. */
const switchAt = (direction: "LR" | "TB", index: number, count: number, width: number, height: number): { readonly x: number; readonly y: number } => {
    const along = index / (count - 1)
    if (direction === "TB") {
        const x = width * along
        return { x, y: height / 2 + (height * Math.min(x, width - x)) / width }
    }
    const y = height * along
    return { x: width / 2 + (width * Math.min(y, height - y)) / height, y }
}

/** The port a decision is entered by: its entry vertex (the top one down the page, the left one across). */
const DECISION_ENTRY = "entry"

/**
 * The branches of each decision (a diamond with two or more edges out), by edge id: the port it leaves by. An if/else (two) leaves by a vertex of the
 * diamond, as a FlowGraph decision does (owner 2026-11-23: "if else mới rẽ nhánh"): the first branch written straight on in the flow (the end vertex), the
 * second out of the side vertex. A switch (three or more, owner 2026-11-23) fans its exits left to right in the order written, the first out of the side
 * vertex, the last out of the other, the ones between along the slanted sides, the middle of an odd count straight on (`switchAt`); the default ("Khác")
 * is the one written last. Each answer's words stand on its own edge at its port, never beside a sibling's on one shared stub. A loop's decision keeps
 * its other side vertex for the back edge that returns to it.
 */
export const decisionBranches = (graph: DiagramGraph): ReadonlyMap<string, { readonly node: string; readonly port: LayoutPort; readonly index: number; readonly count: number }> => {
    const out = new Map<string, { readonly node: string; readonly port: LayoutPort; readonly index: number; readonly count: number }>()
    for (const node of graph.nodes) {
        if (node.shape !== "diamond") continue
        const branches = graph.edges.filter((edge) => edge.source === node.id && edge.target !== node.id)
        if (branches.length < 2) continue
        for (const [index, edge] of branches.entries()) {
            const side = branches.length >= 3 ? switchSide(graph.direction, index, branches.length) : portSide(true, graph.direction, index)
            out.set(edge.id, { node: node.id, port: { id: `branch-${String(index)}`, side }, index, count: branches.length })
        }
    }
    return out
}

/** A branch's words on its first run, a little past the vertex it leaves by, the pill centred on the line, as the main branch's stand on theirs. */
const atVertex = (route: Route, extra = 0): Route => {
    const label = route.label
    const [a, b] = route.points
    if (label === undefined || a === undefined || b === undefined) return route
    const sideways = Math.abs(a[1] - b[1]) < 0.5
    const half = (sideways ? label.width : label.height) / 2
    const room = Math.abs(sideways ? b[0] - a[0] : b[1] - a[1])
    const step = Math.min(12 + half + extra, Math.max(half, room / 2))
    const cx = sideways ? a[0] + Math.sign(b[0] - a[0]) * step : a[0]
    const cy = sideways ? a[1] : a[1] + Math.sign(b[1] - a[1]) * step
    return { ...route, label: { ...label, x: Math.round(cx - label.width / 2), y: Math.round(cy - label.height / 2) } }
}

/**
 * How wide (tall, drawn across) each loop's decision must be: the widest step of the loop's body and BACK_ROOM, so the back edge runs along the side of the
 * last step to the decision's side vertex and up it, clear of every step of the body. The body is what the decision leads to and what leads back to its edge.
 */
const BACK_ROOM = { TB: 56, LR: 44 } as const

const loopRoom = (graph: DiagramGraph, sizes: ReadonlyMap<string, { readonly width: number; readonly height: number }>): ReadonlyMap<string, number> => {
    const room = new Map<string, number>()
    const reach = (from: string, forward: boolean): Set<string> => {
        const seen = new Set<string>()
        const queue = [from]
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            if (seen.has(id)) continue
            seen.add(id)
            for (const edge of graph.edges) if (edge.back !== true && (forward ? edge.source === id : edge.target === id)) queue.push(forward ? edge.target : edge.source)
        }
        return seen
    }
    for (const edge of graph.edges) {
        if (edge.back !== true) continue
        const down = reach(edge.target, true)
        const up = reach(edge.source, false)
        const body = [...down].filter((id) => up.has(id) && id !== edge.target)
        const widest = Math.max(0, ...body.map((id) => (graph.direction === "TB" ? sizes.get(id)?.width : sizes.get(id)?.height) ?? 0))
        room.set(edge.target, Math.max(room.get(edge.target) ?? 0, widest + BACK_ROOM[graph.direction]))
    }
    return room
}

/** A laid-out graph: ELK's positions and routes, the sizes it laid out, and the drawing's box (nodes, routes and words). */
export interface DiagramLayout {
    readonly graph: DiagramGraph
    readonly layout: FlowLayout
    readonly sizes: readonly SizedNode[]
    /** The entry node's box (the first node nothing leads into, else the first), where the first view starts when the drawing does not fit whole. */
    readonly entry?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    readonly width: number
    readonly height: number
}

type Pt = readonly [number, number]

interface Rect {
    readonly l: number
    readonly t: number
    readonly r: number
    readonly b: number
}

/** How far a bar reaches past the outermost branch it joins, so the line meets the bar well inside its ends. */
const BAR_REACH = 24
const BAR_LEAST = 64
/** The least a loop's back edge runs along its source before it turns up to the decision, and the clearance it keeps from the steps it passes. */
const BACK_RUN = 24
const BACK_CLEAR = 8

const meets = (a: Rect, b: Rect): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/** Whether an orthogonal run passes through a box. */
const runMeets = (a: Pt, b: Pt, rect: Rect): boolean => meets({ l: Math.min(a[0], b[0]), t: Math.min(a[1], b[1]), r: Math.max(a[0], b[0]), b: Math.max(a[1], b[1]) }, rect)

/** Lays a flowchart or a state diagram out with the graph ext's ELK layout, in the graph's direction. */
export const layoutDiagram = async (graph: DiagramGraph, textWidth: TextWidth, measure: Measure): Promise<DiagramLayout> => {
    const branches = decisionBranches(graph)
    const decisions = new Set([...branches.values()].map((branch) => branch.node))
    const exits = new Map([...branches.values()].map((branch) => [branch.node, branch.count] as const))
    const natural = new Map(graph.nodes.map((node) => [node.id, nodeSize(node, graph.direction, textWidth, exits.get(node.id) ?? 0)] as const))
    // A loop's decision is wider than its body (taller across), so the back edge can run up the outside of the body to the decision's side vertex.
    for (const [id, room] of loopRoom(graph, natural)) {
        const size = natural.get(id)
        if (size !== undefined) natural.set(id, graph.direction === "TB" ? { ...size, width: Math.max(size.width, room) } : { ...size, height: Math.max(size.height, room) })
    }
    const sizes: SizedNode[] = graph.nodes.map((node) => {
        const size = natural.get(node.id) ?? { width: 80, height: 40 }
        // A decision is entered by its entry vertex and its branches leave by the others, each fixed where the diamond draws it.
        const out = [...branches.values()].filter((branch) => branch.node === node.id)
        const own =
            out.length === 0
                ? []
                : [
                      { id: DECISION_ENTRY, side: entrySide(graph.direction), at: portAt(entrySide(graph.direction), true, 0, 1, size.width, size.height) },
                      ...out.map(({ port, index, count }) => ({ ...port, at: count >= 3 ? switchAt(graph.direction, index, count, size.width, size.height) : portAt(port.side, true, 0, 1, size.width, size.height) })),
                  ]
        return {
            id: node.id,
            ...size,
            ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
            ...(node.shape === "container" ? { insets: CONTAINER_INSETS } : {}),
            ...(own.length === 0 ? {} : { ports: own }),
        }
    })
    const links: LinkEnds[] = graph.edges.map((edge) => {
        const branch = branches.get(edge.id)
        return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            ...(branch === undefined ? {} : { sourcePort: branch.port.id }),
            ...(decisions.has(edge.target) && edge.back !== true ? { targetPort: DECISION_ENTRY } : {}),
            ...(edge.back === true ? { back: true } : {}),
            ...(edge.label === undefined ? {} : { label: edge.label, ...(branch === undefined ? {} : { labelAt: "TAIL" as const }) }),
        }
    })
    const laid = await layoutFlow(sizes, links, { direction: graph.direction, islands: "wrap", width: 960, measure })
    const positions: Record<string, { x: number; y: number }> = { ...laid.positions }
    const boxes: Record<string, Box> = { ...laid.boxes }
    const routes: Record<string, Route> = Object.fromEntries(Object.entries(laid.routes).map(([id, route]) => [id, branches.has(id) ? atVertex(route) : route]))
    const parent = new Map(graph.nodes.flatMap((node) => (node.parentId === undefined ? [] : [[node.id, node.parentId] as const])))
    const absolute = (nodeId: string): { x: number; y: number } => {
        const own = positions[nodeId] ?? { x: 0, y: 0 }
        const up = parent.get(nodeId)
        if (up === undefined) return own
        const above = absolute(up)
        return { x: above.x + own.x, y: above.y + own.y }
    }
    const boxOf = (id: string): Box => boxes[id] ?? sizes.find((size) => size.id === id) ?? { width: 0, height: 0 }
    const rectOf = (id: string): Rect => {
        const where = absolute(id)
        const box = boxOf(id)
        return { l: where.x, t: where.y, r: where.x + box.width, b: where.y + box.height }
    }
    const across = graph.direction === "LR" ? 1 : 0
    const along = 1 - across
    const lo = (rect: Rect, axis: number): number => (axis === 0 ? rect.l : rect.t)
    const hi = (rect: Rect, axis: number): number => (axis === 0 ? rect.r : rect.b)
    const mid = (rect: Rect, axis: number): number => (lo(rect, axis) + hi(rect, axis)) / 2
    const pt = (alongValue: number, acrossValue: number): [number, number] => (along === 0 ? [alongValue, acrossValue] : [acrossValue, alongValue])
    const leaves = graph.nodes.filter((node) => node.shape !== "container").map((node) => node.id)
    const blocked = (points: readonly Pt[], ends: readonly string[], clear: number): boolean =>
        leaves.some((id) => {
            if (ends.includes(id)) return false
            const rect = rectOf(id)
            const grown = { l: rect.l - clear, t: rect.t - clear, r: rect.r + clear, b: rect.b + clear }
            return points.slice(1).some((point, index) => runMeets(points[index] ?? point, point, grown))
        })

    // A parallel's bar spans the branches it forks or joins: it reaches BAR_REACH past the outermost, and every line meets it straight, at its branch's centre.
    const widened = new Map<string, number>()
    for (const bar of graph.nodes.filter((node) => node.shape === "bar")) {
        const ties = graph.edges.filter((edge) => edge.back !== true && (edge.source === bar.id) !== (edge.target === bar.id) && boxes[edge.source === bar.id ? edge.target : edge.source] !== undefined)
        if (ties.length < 2) continue
        const centres = ties.map((edge) => mid(rectOf(edge.source === bar.id ? edge.target : edge.source), across))
        const middle = (Math.min(...centres) + Math.max(...centres)) / 2
        const half = Math.max(BAR_LEAST / 2, (Math.max(...centres) - Math.min(...centres)) / 2 + BAR_REACH)
        const holder = parent.get(bar.id)
        const inside = holder === undefined ? { x: 0, y: 0 } : absolute(holder)
        const here = positions[bar.id] ?? { x: 0, y: 0 }
        positions[bar.id] = across === 0 ? { x: Math.round(middle - half - inside.x), y: here.y } : { x: here.x, y: Math.round(middle - half - inside.y) }
        boxes[bar.id] = across === 0 ? { width: Math.round(half * 2), height: boxOf(bar.id).height } : { width: boxOf(bar.id).width, height: Math.round(half * 2) }
        widened.set(bar.id, Math.round(half * 2))
        const barRect = rectOf(bar.id)
        for (const edge of ties) {
            const out = edge.source === bar.id
            const other = rectOf(out ? edge.target : edge.source)
            const c = Math.round(mid(other, across))
            const points: Pt[] = out ? [pt(hi(barRect, along), c), pt(lo(other, along), c)] : [pt(hi(other, along), c), pt(lo(barRect, along), c)]
            const forward = out ? lo(other, along) >= hi(barRect, along) : hi(other, along) <= lo(barRect, along)
            if (!forward || blocked(points, [edge.source, edge.target], 4)) continue
            const route = routes[edge.id]
            routes[edge.id] = route?.label === undefined ? { points } : atVertex({ points, label: route.label })
        }
    }

    // A switch's exits start on the outline of the diamond, where its port is (ELK draws a port on the side of the box); the words of an exit on a slanted
    // side stand clear of that side.
    const switches = [...branches.entries()].filter(([, branch]) => branch.count >= 3)
    for (const [edgeId, branch] of switches) {
        const route = routes[edgeId]
        const rect = rectOf(branch.node)
        if (route === undefined || route.points.length < 2) continue
        const w = rect.r - rect.l
        const h = rect.b - rect.t
        const port = switchAt(graph.direction, branch.index, branch.count, w, h)
        const start: [number, number] = [Math.round(rect.l + port.x), Math.round(rect.t + port.y)]
        const points: [number, number][] = route.points.map(([x, y]) => [x, y])
        const [first, second] = [points[0], points[1]]
        if (first === undefined || second === undefined) continue
        const sideways = Math.abs(first[1] - second[1]) < 1
        points[0] = start
        points[1] = sideways ? [second[0], start[1]] : [start[0], second[1]]
        const slanted = across === 0 ? Math.abs(port.y - h / 2) > 1 && Math.abs(port.x - w / 2) > 1 : Math.abs(port.x - w / 2) > 1 && Math.abs(port.y - h / 2) > 1
        const label = route.label
        const slope = across === 0 ? w / h : h / w
        routes[edgeId] = label === undefined ? { points } : atVertex({ points, label }, slanted ? Math.ceil((across === 0 ? label.height : label.width) * slope / 2) + 4 : 0)
    }

    // The branches of a switch rejoin where they first meet: that step stands under the decision, with everything only it leads to, and each branch runs
    // down to a line just above it and along it to the step's centre, so the lines merge into one entry and one arrowhead.
    const forward = (from: string): Set<string> => {
        const seen = new Set<string>()
        const queue = [from]
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            if (seen.has(id)) continue
            seen.add(id)
            for (const edge of graph.edges) if (edge.back !== true && edge.source === id) queue.push(edge.target)
        }
        return seen
    }
    for (const decision of new Set(switches.map(([, branch]) => branch.node))) {
        const targets = graph.edges.filter((edge) => edge.source === decision && edge.back !== true).map((edge) => edge.target)
        const reaches = targets.map(forward)
        const common = [...(reaches[0] ?? [])].filter((id) => reaches.every((set) => set.has(id)) && id !== decision && parent.get(id) === undefined)
        const join = common.sort((a, b) => lo(rectOf(a), along) - lo(rectOf(b), along))[0]
        if (join === undefined) continue
        // What only the join leads to moves with it.
        const moving = forward(join)
        for (let again = true; again; ) {
            again = false
            for (const id of [...moving]) if (id !== join && graph.edges.some((edge) => edge.target === id && edge.back !== true && !moving.has(edge.source))) { moving.delete(id); again = true }
        }
        if ([...moving].some((id) => parent.get(id) !== undefined)) continue
        const by = Math.round(mid(rectOf(decision), across) - mid(rectOf(join), across))
        const settle = (id: string, amount: number): void => {
            const here = positions[id] ?? { x: 0, y: 0 }
            positions[id] = across === 0 ? { x: here.x + amount, y: here.y } : { x: here.x, y: here.y + amount }
        }
        const before = new Map([...moving].map((id) => [id, positions[id] ?? { x: 0, y: 0 }] as const))
        for (const id of moving) settle(id, by)
        const crowded = [...moving].some((id) => leaves.some((other) => !moving.has(other) && meets(rectOf(id), rectOf(other))))
        if (crowded) {
            for (const [id, where] of before) positions[id] = where
            continue
        }
        for (const edge of graph.edges) {
            const route = routes[edge.id]
            if (route === undefined || !moving.has(edge.source) || !moving.has(edge.target)) continue
            const move = ([x, y]: Pt): [number, number] => (across === 0 ? [x + by, y] : [x, y + by])
            routes[edge.id] = { points: route.points.map(move), ...(route.label === undefined ? {} : { label: across === 0 ? { ...route.label, x: route.label.x + by } : { ...route.label, y: route.label.y + by } }) }
        }
        const target = rectOf(join)
        const busAt = lo(target, along) - 28
        const c = Math.round(mid(target, across))
        for (const edge of graph.edges) {
            if (edge.target !== join || edge.back === true || moving.has(edge.source)) continue
            const from = rectOf(edge.source)
            const x = Math.round(mid(from, across))
            const points: Pt[] = Math.abs(x - c) <= STRAIGHT_SNAP ? [pt(hi(from, along), c), pt(lo(target, along), c)] : [pt(hi(from, along), x), pt(busAt, x), pt(busAt, c), pt(lo(target, along), c)]
            if (hi(from, along) >= busAt - 4 || blocked(points, [edge.source, edge.target], 4)) continue
            routes[edge.id] = { points }
        }
    }

    // A loop's back edge returns to its decision with one bend where the body is narrower than the decision: out of the side of the last step, along to the
    // decision's side vertex, and into it. Where a step is in the way it keeps the layout's route round the outside.
    for (const edge of graph.edges) {
        if (edge.back !== true || routes[edge.id]?.label !== undefined) continue
        const s = rectOf(edge.source)
        const t = rectOf(edge.target)
        const room = across === 0 ? s.l - t.l : s.t - t.t
        const below = across === 0 ? mid(s, 1) > mid(t, 1) + BACK_CLEAR : mid(s, 0) > mid(t, 0) + BACK_CLEAR
        if (!below || room < (across === 0 ? BACK_RUN : BACK_RUN - 4)) continue
        const points: Pt[] = across === 0 ? [[s.l, mid(s, 1)], [t.l, mid(s, 1)], [t.l, mid(t, 1)]] : [[mid(s, 0), s.t], [mid(s, 0), t.t], [mid(t, 0), t.t]]
        if (!blocked(points, [edge.source, edge.target], BACK_CLEAR)) routes[edge.id] = { points }
    }

    const layout: FlowLayout = { ...laid, positions, boxes, routes }
    const placed = sizes.map((size) => {
        const wide = widened.get(size.id)
        return wide === undefined ? size : across === 0 ? { ...size, width: wide } : { ...size, height: wide }
    })
    const rects = placed.map((size) => rectOf(size.id))
    const routeEnds = Object.values(routes).flatMap((route) => [...route.points, ...(route.label === undefined ? [] : [[route.label.x, route.label.y] as const, [route.label.x + route.label.width, route.label.y + route.label.height] as const])])
    const ends: readonly Pt[] = routeEnds
    const minX = Math.min(...rects.map((box) => box.l), ...ends.map((point) => point[0]))
    const minY = Math.min(...rects.map((box) => box.t), ...ends.map((point) => point[1]))
    const maxX = Math.max(...rects.map((box) => box.r), ...ends.map((point) => point[0]))
    const maxY = Math.max(...rects.map((box) => box.b), ...ends.map((point) => point[1]))
    const led = new Set(graph.edges.map((edge) => edge.target))
    const entryAt = graph.nodes.findIndex((node) => node.shape !== "container" && !led.has(node.id))
    const first = entryAt >= 0 ? entryAt : graph.nodes.findIndex((node) => node.shape !== "container")
    const entryRect = first >= 0 ? rects[first] : undefined
    const entry = entryRect === undefined ? undefined : { x: entryRect.l, y: entryRect.t, width: entryRect.r - entryRect.l, height: entryRect.b - entryRect.t }
    return { graph, layout, sizes: placed, ...(entry === undefined ? {} : { entry }), width: Math.max(1, maxX - Math.min(0, minX)), height: Math.max(1, maxY - Math.min(0, minY)) }
}
