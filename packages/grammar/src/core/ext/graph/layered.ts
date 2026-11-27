import ElkModule from "elkjs/lib/elk.bundled.js"
import type { ELK, ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs/lib/elk-api.js"
import { estimateLabel, isAncestor, portKey, treeOf, usableLinks, type Box, type FlowLayout, type LayoutSettings, type LinkEnds, type PortSide, type Route, type SizedNode, type Tree } from "./layout.js"
import type { GraphDirection, GraphPosition } from "./types.js"

/**
 * THE LAYERED LAYOUT of a `FlowGraph` (`layout="layered"`, owner 2026-11-27: "nothing overlaps"). One ELK `layered` run places every node AND routes every
 * edge; nothing is moved or re-routed by hand afterwards, so ELK's guarantees hold on the drawing:
 *
 * 1. **Ports in row order.** Each output port of a node (a branch row of an if, a switch, a loop or a parallel step) is its own ELK port on the end side
 *    (east, left to right), in the order of its rows: `FIXED_POS` where the card says where its row's handle stands (measured, see `GraphCanvas`), else
 *    `FIXED_ORDER`. An edge into a card enters by its one entry port on the start side.
 * 2. **Orthogonal routes, spaced.** Every edge is orthogonal, keeps `EDGE_EDGE` from a parallel edge and `EDGE_NODE` from a node, and never runs through one.
 * 3. **Labels placed, never on a line.** An edge's words are an ELK centre label: ELK gives them their own room in the layer gap, so no line and no node
 *    runs through them. An edge out of a port carries no words (the row names the branch; see `resolveFlow`).
 * 4. **Back edges round the outside.** A loop's body returning to its head, a wait's retry: ELK breaks the cycle at the edge (it is given last, flagged
 *    `back`) and routes it round the nodes in a lane of its own (`feedbackEdges`); the graph draws it dashed.
 * 5. **Deterministic.** The same nodes, sizes, ports and edges give the same layout (a fixed seed, the model order kept); the canvas runs it again only when
 *    that structure changes, never on a run update.
 */

/** The room between two nodes of one layer, between two layers, between an edge and a node, between two parallel edges, and round a label. */
export const LAYERED_SPACING = { nodeNode: 40, betweenLayers: 72, edgeNode: 20, edgeEdge: 12, label: 6, components: 48 } as const

const ELK_DIRECTION: Readonly<Record<GraphDirection, string>> = { LR: "RIGHT", TB: "DOWN" }

const options = (direction: GraphDirection): LayoutOptions => ({
    "elk.algorithm": "layered",
    "elk.direction": ELK_DIRECTION[direction],
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.randomSeed": "1",
    "elk.spacing.nodeNode": String(LAYERED_SPACING.nodeNode),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYERED_SPACING.betweenLayers),
    "elk.spacing.edgeNode": String(LAYERED_SPACING.edgeNode),
    "elk.layered.spacing.edgeNodeBetweenLayers": String(LAYERED_SPACING.edgeNode),
    "elk.spacing.edgeEdge": String(LAYERED_SPACING.edgeEdge),
    "elk.layered.spacing.edgeEdgeBetweenLayers": String(LAYERED_SPACING.edgeEdge),
    "elk.spacing.edgeLabel": String(LAYERED_SPACING.label),
    "elk.spacing.labelNode": String(LAYERED_SPACING.label),
    "elk.spacing.portPort": "8",
    "elk.edgeLabels.inline": "false",
    "elk.layered.edgeLabels.sideSelection": "ALWAYS_UP",
    // The model order (the app's order of nodes and edges) settles every tie, so the same graph always comes out the same.
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.nodePlacement.favorStraightEdges": "true",
    // A back edge runs round the nodes in a lane of its own, never through a column.
    "elk.layered.feedbackEdges": "true",
    "elk.layered.mergeEdges": "false",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": String(LAYERED_SPACING.components),
    "elk.json.edgeCoords": "ROOT",
    "elk.padding": "[top=0,left=0,bottom=0,right=0]",
})

/** elkjs is a CommonJS bundle that sets `default` on its constructor; under Node the import is that constructor's module object, under a bundler the constructor itself. */
const Elk: typeof ElkModule = (ElkModule as unknown as { readonly default?: typeof ElkModule }).default ?? ElkModule
let engine: ELK | undefined

/** ELK reads a side's ports clockwise: down the east side, right to left along the south one. */
const REVERSED: ReadonlySet<PortSide> = new Set<PortSide>(["SOUTH", "WEST"])

const elkPorts = (node: SizedNode): ElkPort[] | undefined => {
    const ports = node.ports
    if (ports === undefined || ports.length === 0) return undefined
    return ports.map((port) => {
        const same = ports.filter((other) => other.side === port.side)
        const at = same.indexOf(port)
        return {
            id: portKey(node.id, port.id),
            width: 0,
            height: 0,
            ...(port.at === undefined ? {} : { x: port.at.x, y: port.at.y }),
            layoutOptions: { "elk.port.side": port.side, "elk.port.index": String(REVERSED.has(port.side) ? same.length - 1 - at : at) },
        }
    })
}

const elkNode = (tree: Tree, id: string, direction: GraphDirection): ElkNode => {
    const node = tree.byId.get(id)
    if (node === undefined) return { id }
    const kids = tree.kids.get(id) ?? []
    const ports = elkPorts(node)
    const isContainer = kids.length > 0
    const constraint = node.ports === undefined || node.ports.length === 0 ? {} : { "elk.portConstraints": node.ports.every((port) => port.at !== undefined) ? "FIXED_POS" : "FIXED_ORDER" }
    const insets = node.insets
    return {
        id,
        ...(isContainer ? {} : { width: node.width, height: node.height }),
        ...(ports === undefined ? {} : { ports }),
        ...(isContainer ? { children: kids.map((kid) => elkNode(tree, kid, direction)) } : {}),
        layoutOptions: {
            ...constraint,
            ...(isContainer
                ? {
                      ...options(direction),
                      "elk.padding": `[top=${String(insets?.top ?? 16)},left=${String(insets?.left ?? 16)},bottom=${String(insets?.bottom ?? 16)},right=${String(insets?.right ?? 16)}]`,
                      "elk.nodeSize.constraints": "MINIMUM_SIZE",
                      "elk.nodeSize.minimum": `(${String(node.width)},${String(node.height)})`,
                  }
                : {}),
        },
    }
}

interface Collected {
    readonly positions: Record<string, GraphPosition>
    readonly boxes: Record<string, Box>
    readonly ports: Record<string, GraphPosition>
    readonly edges: ElkExtendedEdge[]
}

/** The nodes, the ports and the edges of the laid-out graph, at every depth (ELK keeps an edge in the node that holds both its ends). */
const collect = (parent: ElkNode, into: Collected): void => {
    for (const edge of parent.edges ?? []) into.edges.push(edge)
    for (const child of parent.children ?? []) {
        into.positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }
        into.boxes[child.id] = { width: Math.round(child.width ?? 0), height: Math.round(child.height ?? 0) }
        for (const port of child.ports ?? []) into.ports[port.id] = { x: Math.round(port.x ?? 0), y: Math.round(port.y ?? 0) }
        collect(child, into)
    }
}

const hasPort = (tree: Tree, node: string, port: string): boolean => tree.byId.get(node)?.ports?.some((candidate) => candidate.id === port) ?? false

type Point = readonly [number, number]

/** A route's points with every repeated point and every point in the middle of a straight run dropped. */
const tidy = (points: readonly Point[]): Point[] => {
    const out: Point[] = []
    for (const point of points) {
        const last = out[out.length - 1]
        if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue
        const before = out[out.length - 2]
        if (before !== undefined && last !== undefined && ((before[0] === last[0] && last[0] === point[0]) || (before[1] === last[1] && last[1] === point[1]))) out[out.length - 1] = point
        else out.push(point)
    }
    return out
}

/**
 * Lays a flow out with ELK's layered algorithm (see the top of this file): every node placed, every edge routed orthogonally from its port, its words in a
 * box of their own, a back edge round the outside. A position is the top-left corner of a node inside its container (inside the canvas for the others);
 * a route is in the canvas frame. The same input always gives the same layout, rounded to whole pixels.
 */
export const layoutLayered = async (nodes: readonly SizedNode[], links: readonly LinkEnds[], settings: LayoutSettings = {}): Promise<FlowLayout> => {
    const { direction = "LR", measure = estimateLabel } = settings
    engine ??= new Elk()
    const tree = treeOf(nodes)
    const placed = usableLinks(nodes, links).filter((link) => !isAncestor(tree, link.source, link.target) && !isAncestor(tree, link.target, link.source))
    // The back edges go last, so ELK's depth-first cycle breaking meets them last and turns them, never a forward road.
    const ordered = [...placed.filter((link) => link.back !== true), ...placed.filter((link) => link.back === true)]
    const nested = tree.kids.size > 0
    const root: ElkNode = {
        id: "root",
        layoutOptions: { ...options(direction), ...(nested ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}) },
        children: tree.roots.map((id) => elkNode(tree, id, direction)),
        edges: ordered.map((link, index) => {
            const id = link.id ?? `e${String(index)}`
            const words = link.label === undefined || link.label === "" ? undefined : measure(link.label)
            return {
                id,
                sources: [link.sourcePort !== undefined && hasPort(tree, link.source, link.sourcePort) ? portKey(link.source, link.sourcePort) : link.source],
                targets: [link.targetPort !== undefined && hasPort(tree, link.target, link.targetPort) ? portKey(link.target, link.targetPort) : link.target],
                ...(words === undefined || link.label === undefined
                    ? {}
                    : { labels: [{ id: `${id}::label`, text: link.label, width: words.width, height: words.height, layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }] }),
            }
        }),
    }
    const laid = await engine.layout(root)
    const found: Collected = { positions: {}, boxes: {}, ports: {}, edges: [] }
    collect(laid, found)
    const routes: Record<string, Route> = {}
    for (const edge of found.edges) {
        const section = edge.sections?.[0]
        if (section === undefined) continue
        const label = edge.labels?.[0]
        const point = (p: { readonly x: number; readonly y: number }): Point => [Math.round(p.x), Math.round(p.y)]
        routes[edge.id] = {
            points: tidy([point(section.startPoint), ...(section.bendPoints ?? []).map(point), point(section.endPoint)]),
            ...(label?.x === undefined || label.y === undefined ? {} : { label: { x: Math.round(label.x), y: Math.round(label.y), width: Math.round(label.width ?? 0), height: Math.round(label.height ?? 0) } }),
        }
    }
    return { positions: found.positions, boxes: found.boxes, routes, ports: found.ports }
}

/** What overlaps on a laid-out drawing. */
export type OverlapKind = "node-node" | "edge-node" | "label-node" | "label-edge" | "label-label" | "edge-edge"

export interface Overlap {
    readonly kind: OverlapKind
    /** The ids of the two things that overlap (a node, an edge, or an edge's label as `<edge id>::label`). */
    readonly a: string
    readonly b: string
}

interface Rect {
    readonly l: number
    readonly t: number
    readonly r: number
    readonly b: number
}

const inset = (rect: Rect, by: number): Rect => ({ l: rect.l + by, t: rect.t + by, r: rect.r - by, b: rect.b - by })
const meets = (a: Rect, b: Rect): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
const runRect = (a: Point, b: Point): Rect => ({ l: Math.min(a[0], b[0]), t: Math.min(a[1], b[1]), r: Math.max(a[0], b[0]), b: Math.max(a[1], b[1]) })
/** A straight run meets a box when it passes through its inside (a run along its border, or ending on it, does not). */
const runMeets = (a: Point, b: Point, rect: Rect): boolean => {
    if (a[1] === b[1]) return a[1] > rect.t && a[1] < rect.b && Math.max(a[0], b[0]) > rect.l && Math.min(a[0], b[0]) < rect.r
    if (a[0] === b[0]) return a[0] > rect.l && a[0] < rect.r && Math.max(a[1], b[1]) > rect.t && Math.min(a[1], b[1]) < rect.b
    return meets(runRect(a, b), rect)
}
const runsOf = (points: readonly Point[]): (readonly [Point, Point])[] => points.slice(1).map((point, index) => [points[index] ?? point, point] as const)

/** Two straight runs that lie on one line and share more than `by` of it. */
const runsShare = (a: readonly [Point, Point], b: readonly [Point, Point], by: number): boolean => {
    const [a0, a1] = a
    const [b0, b1] = b
    if (a0[1] === a1[1] && b0[1] === b1[1] && a0[1] === b0[1]) return Math.min(Math.max(a0[0], a1[0]), Math.max(b0[0], b1[0])) - Math.max(Math.min(a0[0], a1[0]), Math.min(b0[0], b1[0])) > by
    if (a0[0] === a1[0] && b0[0] === b1[0] && a0[0] === b0[0]) return Math.min(Math.max(a0[1], a1[1]), Math.max(b0[1], b1[1])) - Math.max(Math.min(a0[1], a1[1]), Math.min(b0[1], b1[1])) > by
    return false
}

/**
 * Every overlap on a laid-out drawing (the proof of `layoutLayered`, and a check an app may run on its own graph): two nodes that meet; an edge that runs
 * through a node (the containers an edge's ends sit in are its own to cross); a label on a node, on any edge's line or on another label; two edges that run
 * along one line for more than 2px, unless they leave one port or enter one port (a shared trunk). Empty when nothing overlaps.
 */
export const findOverlaps = (nodes: readonly SizedNode[], links: readonly LinkEnds[], layout: FlowLayout): readonly Overlap[] => {
    const tree = treeOf(nodes)
    const absolute = (id: string): GraphPosition => {
        let x = 0
        let y = 0
        for (let at: string | undefined = id; at !== undefined; at = tree.parent.get(at)) {
            const p = layout.positions[at]
            x += p?.x ?? 0
            y += p?.y ?? 0
        }
        return { x, y }
    }
    const rects = new Map<string, Rect>()
    for (const node of nodes) {
        const at = absolute(node.id)
        const box = layout.boxes[node.id] ?? { width: node.width, height: node.height }
        rects.set(node.id, { l: at.x, t: at.y, r: at.x + box.width, b: at.y + box.height })
    }
    const isContainer = (id: string): boolean => (tree.kids.get(id)?.length ?? 0) > 0
    const leaves = nodes.filter((node) => !isContainer(node.id))
    const found: Overlap[] = []
    for (let i = 0; i < nodes.length; i += 1)
        for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i]
            const b = nodes[j]
            if (a === undefined || b === undefined || isAncestor(tree, a.id, b.id) || isAncestor(tree, b.id, a.id)) continue
            const ra = rects.get(a.id)
            const rb = rects.get(b.id)
            if (ra !== undefined && rb !== undefined && meets(ra, rb)) found.push({ kind: "node-node", a: a.id, b: b.id })
        }
    const byId = new Map(links.flatMap((link) => (link.id === undefined ? [] : [[link.id, link] as const])))
    const routed = Object.entries(layout.routes).map(([id, route]) => ({ id, link: byId.get(id), runs: runsOf(route.points), label: route.label }))
    for (const edge of routed) {
        // An edge may cross the frames its own ends sit in, never another node.
        const own = new Set<string>()
        for (const end of [edge.link?.source, edge.link?.target]) for (let at = end === undefined ? undefined : tree.parent.get(end); at !== undefined; at = tree.parent.get(at)) own.add(at)
        for (const node of nodes) {
            if (own.has(node.id)) continue
            const rect = rects.get(node.id)
            // A frame the edge has no end in, like a card, is never crossed.
            if (rect !== undefined && edge.runs.some(([a, b]) => runMeets(a, b, inset(rect, 1)))) found.push({ kind: "edge-node", a: edge.id, b: node.id })
        }
    }
    const labels = routed.flatMap((edge) => (edge.label === undefined ? [] : [{ id: `${edge.id}::label`, edge: edge.id, rect: { l: edge.label.x, t: edge.label.y, r: edge.label.x + edge.label.width, b: edge.label.y + edge.label.height } }]))
    for (const label of labels) {
        for (const node of leaves) {
            const rect = rects.get(node.id)
            if (rect !== undefined && meets(inset(label.rect, 1), rect)) found.push({ kind: "label-node", a: label.id, b: node.id })
        }
        for (const edge of routed) if (edge.runs.some(([a, b]) => runMeets(a, b, inset(label.rect, 1)))) found.push({ kind: "label-edge", a: label.id, b: edge.id })
    }
    for (let i = 0; i < labels.length; i += 1)
        for (let j = i + 1; j < labels.length; j += 1) {
            const a = labels[i]
            const b = labels[j]
            if (a !== undefined && b !== undefined && meets(a.rect, b.rect)) found.push({ kind: "label-label", a: a.id, b: b.id })
        }
    const endKey = (link: LinkEnds | undefined, side: "source" | "target"): string | undefined => (link === undefined ? undefined : side === "source" ? `${link.source}:${link.sourcePort ?? ""}` : `${link.target}:${link.targetPort ?? ""}`)
    for (let i = 0; i < routed.length; i += 1)
        for (let j = i + 1; j < routed.length; j += 1) {
            const a = routed[i]
            const b = routed[j]
            if (a === undefined || b === undefined) continue
            // Edges that leave one port or enter one port share a trunk there: that is one line, drawn once.
            if (endKey(a.link, "source") === endKey(b.link, "source") || endKey(a.link, "target") === endKey(b.link, "target")) continue
            if (a.runs.some((ra) => b.runs.some((rb) => runsShare(ra, rb, 2)))) found.push({ kind: "edge-edge", a: a.id, b: b.id })
        }
    return found
}
