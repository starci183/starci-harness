/**
 * The layout of a flowchart or a state diagram on the graph canvas (pure but for ELK): each node sized for its words in its shape, the containers round
 * their nodes, then the graph ext's own ELK layout and routing law (`layoutFlow`): straight edges between aligned nodes, one bend between offset ones.
 */
import { STRAIGHT_SNAP, layoutFlow, type Box, type FlowLayout, type LayoutPort, type LinkEnds, type Measure, type PortSide, type Route, type SizedNode } from "../layout.js"
import { entrySide, portAt, portSide } from "../model.js"
import { OVERLAP_TOLERANCE, dedupeRuns, overlaps } from "../shared/overlap.js"
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
/** A node's logo chip (`LogoChip`: 26px, the mark 18px inside) and the gap between it and the words (`--grammar-inline-gap`). */
export const ICON_SIZE = 26
export const ICON_GAP = 8
/** The "learner edits here" chip after the words: the logo chip's size, the same gap. */
export const EDIT_SIZE = ICON_SIZE
/** A port pill's padding across (`--grammar-inline-gap` each side) and the caption words' share of the label size they are measured at. */
const PORT_PAD = 16
const PORT_SCALE = 0.93
/** The least height of a node with a chip: the chip and 7px above and below it. */
const CHIP_ROW = ICON_SIZE + 14

/** The width a port pill takes, `:4001` in the caption size with its padding. */
export const portWidth = (port: string, textWidth: TextWidth): number => Math.ceil(textWidth(`:${port}`) * PORT_SCALE) + PORT_PAD

/** The width the extras of a node take beside its words, each with its gap: the logo chip before them, the port pill and the edit chip after. */
export const extrasWidth = (node: DiagramNode, textWidth: TextWidth): number => {
    if (node.shape === "container" || node.shape === "bar" || node.shape === "start" || node.shape === "end") return 0
    // An architecture node's port is on its muted second line (`metaLines`), not a pill beside the name.
    const pill = node.port === undefined || node.kind !== undefined ? 0 : portWidth(node.port, textWidth)
    const items = [node.icon === undefined ? 0 : ICON_SIZE, pill, node.edit === true ? EDIT_SIZE : 0].filter((width) => width > 0)
    if (items.length === 0) return 0
    // One gap between every two parts of the row: the words count as a part when there are any.
    const gaps = node.label === "" ? items.length - 1 : items.length
    return items.reduce((sum, width) => sum + width, 0) + gaps * ICON_GAP
}

/** A muted line of an architecture node: the caption size (13 of the label's 14) at its line height, and the gap above it. */
const META_LINE = 16
const META_SCALE = 0.93
/** How much wider than its words a queue's tube is: its two end caps (`TUBE_CAP` of MermaidDiagram.tsx) and the room inside them. */
const TUBE_ROOM = 64
/** The height of a cache's "cache" tag line over its name. */
const TAG_LINE = 18

/**
 * The muted lines under an architecture node's name (owner 2026-11-28): its port first (`:4001`), then its detail (a database's tables, a service's
 * files), one line each; none for a node of no kind. The canvas draws the same lines (`ShapeNode`).
 */
export const metaLines = (node: DiagramNode): readonly string[] =>
    node.kind === undefined ? [] : [...(node.port === undefined ? [] : [`:${node.port}`]), ...(node.detail === undefined ? [] : node.detail.split("\n"))]

/** The box a node needs for its words in its shape, and for its logo chip, port pill and edit chip beside them when it has them. */
export const nodeSize = (node: DiagramNode, direction: "LR" | "TB", textWidth: TextWidth, exits = 0): { readonly width: number; readonly height: number } => {
    const extras = extrasWidth(node, textWidth)
    // The words wrap at the box's own measure; the extras widen the box beside them instead of squeezing the words.
    const words = wrap(node.label, BOX_MAX - 32, textWidth)
    // An architecture node's muted lines (port, tables) stand under its name row, in the caption size; a cache's tag stands over it.
    const meta = metaLines(node).flatMap((line) => wrap(line, BOX_MAX - 32, textWidth))
    const metaWide = Math.max(0, ...meta.map((line) => Math.ceil(textWidth(line) * META_SCALE)))
    const wide = Math.max(Math.max(0, ...words.map(textWidth)) + extras, metaWide)
    const tall = Math.max(words.length * LINE, extras > 0 ? CHIP_ROW - 22 : 0) + meta.length * META_LINE + (node.kind === "cache" ? TAG_LINE : 0)
    if (node.shape === "tube") return { width: Math.max(136, wide + TUBE_ROOM), height: Math.max(56, tall + 24) }
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
            // A store's caps are 12 deep (STORE_CAP of MermaidDiagram.tsx): its lid above the words, its base under them.
            return { width: Math.max(104, wide + 48), height: Math.max(72, tall + 48) }
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
    /**
     * The edges whose routes share a stretch on purpose (the architecture layout's calls: one trunk, one bar, a drop each): drawn as laid out, never moved
     * aside by the corridor rule.
     */
    readonly merged?: ReadonlySet<string>
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

/** How far apart the ends of two edges stand on one side of a node: more than the overlap tolerance, and wider than an arrowhead. */
export const END_SPREAD = 16
/** How close two ends stand on one side of a node to count as one point. */
const END_SAME = 4

/**
 * Every edge of a diagram is its own line (owner 2026-11-24: separate, coloured edges, no merge points): two edges never leave or enter a node at one
 * point. `spread`: the ends that share a point on a side of a node (or stand closer than END_SPREAD) are spread along that side, END_SPREAD apart, in the
 * order of where their other ends lie, so no two cross there. `clear`: an end whose first run lies along another edge's run (two lines a few pixels apart)
 * slides clear of it, when its side has room. Each end's first run (square to the side) moves with it, and so do its words when they stand on that run;
 * a straight edge moves whole, by the mean of what its two ends ask, inside both its sides.
 */
const separateOnce = (graph: DiagramGraph, routes: Record<string, Route>, rectOf: (id: string) => Rect, mode: "spread" | "clear"): boolean => {
    interface End {
        readonly edge: string
        readonly node: string
        readonly start: boolean
        /** The axis the end slides along: 0 (x) on a top or bottom side, 1 (y) on a left or right one. */
        readonly axis: 0 | 1
        readonly side: string
        readonly at: Pt
        /** The next point of the route: the end's first run is `at` to `next`. */
        readonly next: Pt
        /** Where the edge's other end lies along the axis: the order of the spread. */
        readonly far: number
        /** Where along the axis the end may stand: inside its side, 8 from each corner, and for a straight edge inside the other end's side too. */
        readonly lo: number
        readonly hi: number
    }
    const inside = (id: string, axis: 0 | 1): readonly [number, number] => {
        const rect = rectOf(id)
        return axis === 0 ? [rect.l + 8, rect.r - 8] : [rect.t + 8, rect.b - 8]
    }
    const ends: End[] = []
    for (const edge of graph.edges) {
        const route = routes[edge.id]
        if (route === undefined || route.points.length < 2) continue
        for (const start of [true, false]) {
            const node = start ? edge.source : edge.target
            const points = start ? route.points : [...route.points].reverse()
            const [at, next] = points
            const far = points[points.length - 1]
            if (at === undefined || next === undefined || far === undefined) continue
            const rect = rectOf(node)
            const side = Math.abs(at[1] - rect.t) <= 1 ? "top" : Math.abs(at[1] - rect.b) <= 1 ? "bottom" : Math.abs(at[0] - rect.l) <= 1 ? "left" : Math.abs(at[0] - rect.r) <= 1 ? "right" : undefined
            if (side === undefined) continue
            const axis = side === "top" || side === "bottom" ? 0 : 1
            // Only an end whose first run is square to its side slides along it cleanly.
            if (Math.abs(at[axis] - next[axis]) > 0.5) continue
            const own = inside(node, axis)
            const other = route.points.length === 2 ? inside(start ? edge.target : edge.source, axis) : own
            ends.push({ edge: edge.id, node, start, axis, side, at, next, far: far[axis], lo: Math.max(own[0], other[0]), hi: Math.min(own[1], other[1]) })
        }
    }
    const shifts = new Map<string, number>()
    /** How far each end may move, either way, and stay inside its range. */
    const ranges = new Map<string, readonly [number, number]>()
    const key = (end: End): string => `${end.edge}\u0000${end.start ? "s" : "t"}`
    const grouped = new Set<End>()
    if (mode === "clear") {
        // The first end whose first run lies along another edge's run, and that can slide clear of it: one per pass, the next pass sees the result.
        const segments = graph.edges.flatMap((edge) => {
            const points = routes[edge.id]?.points ?? []
            return points.slice(1).map((point, index) => ({ edge: edge.id, a: points[index] ?? point, b: point }))
        })
        for (const end of ends) {
            const hit = segments.find((segment) => segment.edge !== end.edge && overlaps([end.at, end.next], [segment.a, segment.b]))
            if (hit === undefined) continue
            const line = hit.a[end.axis]
            const want = line + (end.at[end.axis] <= line ? -1 : 1) * (OVERLAP_TOLERANCE + 2)
            const crowded = ends.some((other) => other !== end && other.node === end.node && other.side === end.side && Math.abs(other.at[end.axis] - want) < END_SPREAD)
            if (want < end.lo || want > end.hi || crowded) continue
            shifts.set(key(end), Math.round(want - end.at[end.axis]))
            ranges.set(key(end), [end.lo - end.at[end.axis], end.hi - end.at[end.axis]])
            break
        }
    }
    for (const end of mode === "spread" ? ends : []) {
        if (grouped.has(end)) continue
        // The ends on this side closer than END_SPREAD to one of the group, one after another: they share a point, or their arrowheads would touch.
        const group = [end]
        grouped.add(end)
        for (let grew = true; grew; ) {
            grew = false
            for (const other of ends) {
                if (grouped.has(other) || other.node !== end.node || other.side !== end.side) continue
                if (!group.some((member) => Math.abs(member.at[end.axis] - other.at[end.axis]) < END_SPREAD && Math.abs(member.at[end.axis === 0 ? 1 : 0] - other.at[end.axis === 0 ? 1 : 0]) <= END_SAME)) continue
                group.push(other)
                grouped.add(other)
                grew = true
            }
        }
        if (group.length < 2) continue
        const rect = rectOf(end.node)
        const length = end.axis === 0 ? rect.r - rect.l : rect.b - rect.t
        const spread = Math.min(END_SPREAD, Math.max(END_SAME * 2, (length - 16) / (group.length - 1)))
        const centre = group.reduce((sum, member) => sum + member.at[end.axis], 0) / group.length
        const low = (end.axis === 0 ? rect.l : rect.t) + 8
        const high = (end.axis === 0 ? rect.r : rect.b) - 8
        const ordered = [...group].sort((a, b) => a.far - b.far || a.edge.localeCompare(b.edge))
        const half = ((ordered.length - 1) * spread) / 2
        // The fan stays on the side: it is moved inward when the shared point stands near a corner.
        const from = Math.min(Math.max(centre - half, low), Math.max(low, high - 2 * half))
        // Each end as near its place in the fan as its own range lets it (a straight edge is held by both its sides), then pushed apart both ways.
        const clamp = (value: number, member: End): number => Math.min(Math.max(value, member.lo), Math.max(member.lo, member.hi))
        const place = (order: readonly End[]): number[] => {
            const at = order.map((member, index) => clamp(from + index * spread, member))
            for (let index = 1; index < at.length; index += 1) at[index] = clamp(Math.max(at[index] ?? 0, (at[index - 1] ?? 0) + spread), order[index] as End)
            for (let index = at.length - 2; index >= 0; index -= 1) at[index] = clamp(Math.min(at[index] ?? 0, (at[index + 1] ?? 0) - spread), order[index] as End)
            return at
        }
        const apart = (at: readonly number[]): boolean => at.every((value, index) => index === 0 || value - (at[index - 1] ?? 0) >= spread - 0.5)
        // When the ranges cannot hold that order (a straight edge pinned near a corner), the reverse order is tried: two lines may cross, never meet.
        let places = place(ordered)
        if (!apart(places)) {
            const reversed = [...ordered].reverse()
            const other = place(reversed)
            if (apart(other)) {
                ordered.splice(0, ordered.length, ...reversed)
                places = other
            }
        }
        ordered.forEach((member, index) => {
            shifts.set(key(member), Math.round((places[index] ?? member.at[member.axis]) - member.at[member.axis]))
            ranges.set(key(member), [member.lo - member.at[member.axis], member.hi - member.at[member.axis]])
        })
    }
    let moved = false
    for (const edge of graph.edges) {
        const route = routes[edge.id]
        if (route === undefined) continue
        const startShift = shifts.get(`${edge.id}\u0000s`)
        const endShift = shifts.get(`${edge.id}\u0000t`)
        if (startShift === undefined && endShift === undefined) continue
        const points: [number, number][] = route.points.map(([x, y]) => [x, y])
        let label = route.label
        const slide = (index: number, neighbour: number, by: number, axis: 0 | 1): void => {
            const a = points[index]
            const b = points[neighbour]
            if (a === undefined || b === undefined || by === 0) return
            moved = true
            if (label !== undefined) {
                const cx = label.x + label.width / 2
                const cy = label.y + label.height / 2
                const onRun = axis === 0 ? Math.abs(cx - a[0]) <= 2 && cy >= Math.min(a[1], b[1]) - label.height && cy <= Math.max(a[1], b[1]) + label.height : Math.abs(cy - a[1]) <= 2 && cx >= Math.min(a[0], b[0]) - label.width && cx <= Math.max(a[0], b[0]) + label.width
                if (onRun) label = axis === 0 ? { ...label, x: label.x + by } : { ...label, y: label.y + by }
            }
            a[axis] += by
            b[axis] += by
        }
        const endOf = (start: boolean): End | undefined => ends.find((end) => end.edge === edge.id && end.start === start)
        if (points.length === 2) {
            // One straight run: both ends move together, by the mean of what each side asks.
            const asks = [startShift, endShift].filter((each): each is number => each !== undefined)
            const limits = [ranges.get(`${edge.id}\u0000s`), ranges.get(`${edge.id}\u0000t`)].filter((each): each is readonly [number, number] => each !== undefined)
            const least = Math.max(...limits.map((each) => each[0]))
            const most = Math.min(...limits.map((each) => each[1]))
            const mean = Math.round(asks.reduce((sum, each) => sum + each, 0) / asks.length)
            slide(0, 1, Math.min(Math.max(mean, least), Math.max(least, most)), endOf(startShift !== undefined)?.axis ?? 0)
        } else {
            if (startShift !== undefined) slide(0, 1, startShift, endOf(true)?.axis ?? 0)
            if (endShift !== undefined) slide(points.length - 1, points.length - 2, endShift, endOf(false)?.axis ?? 0)
        }
        // A decision or a circle touches its box only at the middle of each side: an end slid off it runs on, square to the side, to the outline.
        for (const start of [true, false]) {
            const end = endOf(start)
            const point = points[start ? 0 : points.length - 1]
            const shape = graph.nodes.find((node) => node.id === (start ? edge.source : edge.target))?.shape
            if (end === undefined || point === undefined || (shape !== "diamond" && shape !== "circle")) continue
            const rect = rectOf(end.node)
            const across = end.axis === 0 ? 1 : 0
            const halfAlong = (end.axis === 0 ? rect.r - rect.l : rect.b - rect.t) / 2
            const halfAcross = (across === 0 ? rect.r - rect.l : rect.b - rect.t) / 2
            const off = Math.min(Math.abs(point[end.axis] - (end.axis === 0 ? rect.l : rect.t) - halfAlong), halfAlong)
            const inset = shape === "diamond" ? (off / halfAlong) * halfAcross : halfAcross - Math.sqrt(Math.max(0, halfAcross * halfAcross - off * off))
            const inward = end.side === "top" || end.side === "left" ? 1 : -1
            point[across] = Math.round(point[across] + inward * inset)
        }
        routes[edge.id] = { points, ...(label === undefined ? {} : { label }) }
    }
    return moved
}

/** Spreads the ends, then clears the first runs, again until nothing moves: a straight edge that took the mean of its two ends may still crowd a neighbour. */
const separateEnds = (graph: DiagramGraph, routes: Record<string, Route>, rectOf: (id: string) => Rect): void => {
    for (let pass = 0; pass < 6; pass += 1) {
        const spread = separateOnce(graph, routes, rectOf, "spread")
        const nudged = nudgeCorridors(graph, routes)
        const cleared = separateOnce(graph, routes, rectOf, "clear")
        if (!spread && !nudged && !cleared) return
    }
}

/** The middle runs that lie in another edge's corridor moved aside, as the canvas draws them (dedupeRuns with no joins), so the ends are cleared against the drawn lines. */
const nudgeCorridors = (graph: DiagramGraph, routes: Record<string, Route>): boolean => {
    const drawn = dedupeRuns(graph.edges.flatMap((edge) => {
        const route = routes[edge.id]
        return route === undefined ? [] : [{ id: edge.id, points: route.points, rank: edge.back === true || edge.dashed ? 2 : 3 }]
    }), { join: false })
    let moved = false
    for (const [id, found] of drawn) {
        const route = routes[id]
        if (route === undefined || found.points.every((point, index) => point[0] === route.points[index]?.[0] && point[1] === route.points[index]?.[1])) continue
        routes[id] = { ...route, points: found.points }
        moved = true
    }
    return moved
}

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
    // A step three or more edges enter (or leave) is wide enough across the flow for each its own point, END_SPREAD apart (separateEnds).
    for (const node of graph.nodes) {
        if (node.shape !== "box" && node.shape !== "round" && node.shape !== "stadium" && node.shape !== "cylinder" && node.shape !== "tube") continue
        const ins = graph.edges.filter((edge) => edge.target === node.id && edge.source !== node.id && edge.back !== true).length
        const outs = graph.edges.filter((edge) => edge.source === node.id && edge.target !== node.id && edge.back !== true).length
        const size = natural.get(node.id)
        const room = (Math.max(ins, outs) - 1) * END_SPREAD + 16
        if (size === undefined || Math.max(ins, outs) < 3) continue
        natural.set(node.id, graph.direction === "TB" ? { ...size, width: Math.max(size.width, room) } : { ...size, height: Math.max(size.height, room) })
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

    separateEnds(graph, routes, rectOf)

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
