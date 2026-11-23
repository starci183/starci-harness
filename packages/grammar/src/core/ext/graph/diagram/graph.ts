/**
 * The layout of a flowchart or a state diagram on the graph canvas (pure but for ELK): each node sized for its words in its shape, the containers round
 * their nodes, then the graph ext's own ELK layout and routing law (`layoutFlow`): straight edges between aligned nodes, one bend between offset ones.
 */
import { layoutFlow, type FlowLayout, type LayoutPort, type LinkEnds, type Measure, type Route, type SizedNode } from "../layout.js"
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
export const nodeSize = (node: DiagramNode, direction: "LR" | "TB", textWidth: TextWidth): { readonly width: number; readonly height: number } => {
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
            const width = Math.max(104, Math.round(wide * 1.5) + 40)
            return { width, height: Math.max(64, Math.round(tall * 1.6) + 40, Math.round(width * 0.55)) }
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

/**
 * The branches of each decision (a diamond with two or more edges out), by edge id: the port it leaves by. A branch is an if/else, so it leaves by a vertex of
 * the diamond, as a FlowGraph decision does (owner 2026-11-23: "if else mới rẽ nhánh"): the first branch written straight on in the flow (the end vertex), the
 * second out of the side vertex, the third out of the other side; its words stand on its own edge at that vertex, never beside a sibling's on one shared stub.
 */
/** The port a decision is entered by: its entry vertex (the top one down the page, the left one across). */
const DECISION_ENTRY = "entry"

export const decisionBranches = (graph: DiagramGraph): ReadonlyMap<string, { readonly node: string; readonly port: LayoutPort }> => {
    const out = new Map<string, { readonly node: string; readonly port: LayoutPort }>()
    for (const node of graph.nodes) {
        if (node.shape !== "diamond") continue
        const branches = graph.edges.filter((edge) => edge.source === node.id && edge.target !== node.id)
        if (branches.length < 2) continue
        for (const [index, edge] of branches.entries()) {
            const side = portSide(true, graph.direction, index)
            out.set(edge.id, { node: node.id, port: { id: `branch-${String(index)}`, side } })
        }
    }
    return out
}

/** A branch's words on its first run, a little past the vertex it leaves by, the pill centred on the line, as the main branch's stand on theirs. */
const atVertex = (route: Route): Route => {
    const label = route.label
    const [a, b] = route.points
    if (label === undefined || a === undefined || b === undefined) return route
    const sideways = Math.abs(a[1] - b[1]) < 0.5
    const half = (sideways ? label.width : label.height) / 2
    const room = Math.abs(sideways ? b[0] - a[0] : b[1] - a[1])
    const step = Math.min(12 + half, Math.max(half, room / 2))
    const cx = sideways ? a[0] + Math.sign(b[0] - a[0]) * step : a[0]
    const cy = sideways ? a[1] : a[1] + Math.sign(b[1] - a[1]) * step
    return { ...route, label: { ...label, x: Math.round(cx - label.width / 2), y: Math.round(cy - label.height / 2) } }
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

/** Lays a flowchart or a state diagram out with the graph ext's ELK layout, in the graph's direction. */
export const layoutDiagram = async (graph: DiagramGraph, textWidth: TextWidth, measure: Measure): Promise<DiagramLayout> => {
        const branches = decisionBranches(graph)
        const decisions = new Set([...branches.values()].map((branch) => branch.node))
        const sizes: SizedNode[] = graph.nodes.map((node) => {
            const size = nodeSize(node, graph.direction, textWidth)
            // A decision is entered by its entry vertex and its branches leave by the others, each fixed where the diamond draws it.
            const out = [...branches.values()].filter((branch) => branch.node === node.id).map(({ port }) => port)
            const own = out.length === 0 ? [] : [{ id: DECISION_ENTRY, side: entrySide(graph.direction) }, ...out].map((port) => ({ ...port, at: portAt(port.side, true, 0, 1, size.width, size.height) }))
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
                ...(decisions.has(edge.target) ? { targetPort: DECISION_ENTRY } : {}),
                ...(edge.label === undefined ? {} : { label: edge.label, ...(branch === undefined ? {} : { labelAt: "TAIL" as const }) }),
            }
        })
        const laid = await layoutFlow(sizes, links, { direction: graph.direction, islands: "wrap", width: 960, measure })
        const layout: FlowLayout = { ...laid, routes: Object.fromEntries(Object.entries(laid.routes).map(([id, route]) => [id, branches.has(id) ? atVertex(route) : route])) }
        const parent = new Map(graph.nodes.flatMap((node) => (node.parentId === undefined ? [] : [[node.id, node.parentId] as const])))
        const absolute = (nodeId: string): { x: number; y: number } => {
            const own = layout.positions[nodeId] ?? { x: 0, y: 0 }
            const up = parent.get(nodeId)
            if (up === undefined) return own
            const at = absolute(up)
            return { x: at.x + own.x, y: at.y + own.y }
        }
        const boxes = sizes.map((size) => {
            const at = absolute(size.id)
            const box = layout.boxes[size.id] ?? size
            return { x: at.x, y: at.y, width: box.width, height: box.height }
        })
        const routeEnds = Object.values(layout.routes).flatMap((route) => [...route.points, ...(route.label === undefined ? [] : [[route.label.x, route.label.y] as const, [route.label.x + route.label.width, route.label.y + route.label.height] as const])])
        const minX = Math.min(...boxes.map((box) => box.x), ...routeEnds.map((point) => point[0]))
        const minY = Math.min(...boxes.map((box) => box.y), ...routeEnds.map((point) => point[1]))
        const maxX = Math.max(...boxes.map((box) => box.x + box.width), ...routeEnds.map((point) => point[0]))
        const maxY = Math.max(...boxes.map((box) => box.y + box.height), ...routeEnds.map((point) => point[1]))
        const led = new Set(graph.edges.map((edge) => edge.target))
        const entryAt = graph.nodes.findIndex((node) => node.shape !== "container" && !led.has(node.id))
        const first = entryAt >= 0 ? entryAt : graph.nodes.findIndex((node) => node.shape !== "container")
        const entry = first >= 0 ? boxes[first] : undefined
        return { graph, layout, sizes, ...(entry === undefined ? {} : { entry }), width: Math.max(1, maxX - Math.min(0, minX)), height: Math.max(1, maxY - Math.min(0, minY)) }
}
