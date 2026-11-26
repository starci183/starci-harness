import ElkModule from "elkjs/lib/elk.bundled.js"
import type { ELK, ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs/lib/elk-api.js"
import { alignDecisions, separateLabels, type MutableRoute } from "./arrange.js"
import type { GraphDirection, GraphPosition } from "./types.js"

/** The fixed width of a node box: the layout reserves it and the stylesheet draws it. */
export const NODE_WIDTH = 280
/** The fixed width of a schema entity box. */
export const ENTITY_WIDTH = 248
/** The height of a flow node. */
export const FLOW_NODE_HEIGHT = 64
/** The head of a schema entity (label, description, count) and each field row under it. */
export const ENTITY_HEAD_HEIGHT = 56
export const ENTITY_ROW_HEIGHT = 24
/** Rows of fields a schema entity draws; the rest is one "+N" row. */
export const SCHEMA_FIELD_ROWS = 6
/** The gap between two islands (disconnected parts of a graph), and the width they wrap at unless told otherwise. */
export const ISLAND_GAP = 48
export const ISLANDS_WIDTH = 1200

/** The side of a node an output port sits on. */
export type PortSide = "EAST" | "SOUTH" | "NORTH" | "WEST"

export interface LayoutPort {
    readonly id: string
    readonly side: PortSide
    /** Where the port sits on its node (top-left corner of the node is 0,0), when the node draws it itself; left out, ELK places it along its side. */
    readonly at?: { readonly x: number; readonly y: number }
}

export interface Insets {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
}

export interface SizedNode {
    readonly id: string
    readonly width: number
    readonly height: number
    /** The container this node sits in; a node others name as their `parentId` is a container, sized by its children (not less than `width` x `height`). */
    readonly parentId?: string
    /** The output ports an edge may leave from, in order. */
    readonly ports?: readonly LayoutPort[]
    /** The room a container keeps round its children (its header on top, its note at the bottom). */
    readonly insets?: Insets
}

export interface LinkEnds {
    readonly source: string
    readonly target: string
    /** The port of the source the edge leaves from. */
    readonly sourcePort?: string
    /** The port of the target the edge enters by. */
    readonly targetPort?: string
    /** The id the laid-out route of the edge is returned under. */
    readonly id?: string
    /** Words on the edge: ELK reserves the room for them (see `measure`) and places them. */
    readonly label?: string
    /** Where the label stands: at the start of the edge (`TAIL`) or in the middle (`CENTER`, the default). */
    readonly labelAt?: "TAIL" | "CENTER"
    /** A back edge: it returns to an earlier step; ELK routes it round the others in a lane of its own. */
    readonly back?: boolean
    /** What the edge means (a `GraphEdgeKind`): the spine layout reads it to pick the sides the edge attaches to. */
    readonly kind?: string
}

/** The route ELK gave an edge, in the frame of its island, and the box it reserved for the label. */
export interface Route {
    readonly points: readonly (readonly [number, number])[]
    readonly label?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    /**
     * How the route ends, when the layout decided it (the spine layout): `arrow` at its target, `join` on another edge's line at a junction dot (a merge
     * point), `bar` on a merge bar (no mark: the bar carries the one arrow).
     */
    readonly end?: "arrow" | "join" | "bar"
}

/** A fork or merge bar of the spine layout: a short thick line across the gap between two rows, and for a merge bar the one arrow down into its target. */
export interface Bar {
    readonly id: string
    /** The left end and the middle of the bar's thickness, in the canvas frame. */
    readonly x: number
    readonly y: number
    readonly width: number
    /** A merge bar's arrow: from the bar at `stemX` down to the target's top at `stemTo`. */
    readonly stemX?: number
    readonly stemTo?: number
}

/** The size of a label's box, from its words. */
export type Measure = (text: string) => Box

/** The room of a label when nothing measured it: the caption type at about 6.5px a character, a 20px line, 10px of padding each side. */
export const estimateLabel: Measure = (text) => ({ width: Math.ceil(text.length * 6.5) + 20, height: 22 })

export interface Box {
    readonly width: number
    readonly height: number
}

/** The laid-out graph: the top-left corner of each node (inside its container for a child) and the box of each, a container's from its children. */
export interface FlowLayout {
    readonly positions: Readonly<Record<string, GraphPosition>>
    readonly boxes: Readonly<Record<string, Box>>
    /** The route of each edge that has an id, as ELK routed it (orthogonal, round the nodes and the frames). */
    readonly routes: Readonly<Record<string, Route>>
    /** Where each output port of a node ended, by `portKey`, in the frame of its node. */
    readonly ports: Readonly<Record<string, GraphPosition>>
    /** The fork and merge bars (the spine layout). */
    readonly bars?: readonly Bar[]
}

export const portKey = (node: string, port: string): string => `${node}::port::${port}`

export interface LayoutSettings {
    readonly direction?: GraphDirection
    /** `wrap` (default): islands side by side in rows up to `width`; `stack`: one column. */
    readonly islands?: "wrap" | "stack"
    readonly width?: number
    /** Measures the words of an edge label so ELK can reserve their room. Default `estimateLabel`; the graph passes one that reads the page's font. */
    readonly measure?: Measure
}

const ELK_DIRECTION: Readonly<Record<GraphDirection, string>> = { LR: "RIGHT", TB: "DOWN" }

const options = (direction: GraphDirection, nested: boolean): LayoutOptions => ({
    "elk.algorithm": "layered",
    "elk.direction": ELK_DIRECTION[direction],
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.spacing.nodeNode": "48",
    "elk.spacing.edgeNode": "24",
    "elk.spacing.edgeEdge": "16",
    "elk.spacing.edgeLabel": "10",
    "elk.spacing.labelNode": "10",
    // NETWORK_SIMPLEX keeps the spine and each decision's main branch on one line (the routing law, rule 2 and 3); alignDecisions settles what it leaves off.
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.spacing.portPort": "10",
    "elk.layered.spacing.nodeNodeBetweenLayers": direction === "LR" ? "96" : "64",
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
    "elk.layered.considerModelOrder.strategy": "PREFER_EDGES",
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "elk.layered.nodePlacement.favorStraightEdges": "true",
    // One entry and one exit per side of a node: the edges without ports touch it at one point, never stacked (the routing law, simplifyRoutes).
    "elk.layered.mergeEdges": "true",
    "elk.layered.edgeLabels.sideSelection": "ALWAYS_UP",
    "elk.json.edgeCoords": "ROOT",
    "elk.separateConnectedComponents": "false",
    ...(nested ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}),
})

/** elkjs is a CommonJS bundle that sets `default` on its constructor; under Node the import is that constructor's module object, under a bundler the constructor itself. */
const Elk: typeof ElkModule = (ElkModule as unknown as { readonly default?: typeof ElkModule }).default ?? ElkModule
let engine: ELK | undefined

const linkKey = (link: LinkEnds): string => `${link.source}:${link.sourcePort ?? ""}->${link.target}:${link.targetPort ?? ""}`

/** The links the layout can use: both ends known, no self loop, each pair (and port) once. */
export const usableLinks = <T extends LinkEnds>(nodes: readonly { readonly id: string }[], links: readonly T[]): readonly T[] => {
    const ids = new Set(nodes.map((node) => node.id))
    const seen = new Set<string>()
    return links.filter((link) => {
        const key = linkKey(link)
        if (!ids.has(link.source) || !ids.has(link.target) || link.source === link.target || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

const portElkId = portKey

/** ELK reads a side's ports clockwise: down the east side, right to left along the south one. */
const REVERSED: ReadonlySet<PortSide> = new Set<PortSide>(["SOUTH", "WEST"])

const elkPorts = (node: SizedNode): ElkPort[] | undefined => {
    if (node.ports === undefined || node.ports.length === 0) return undefined
    const ports = node.ports
    return ports.map((port) => {
        const same = ports.filter((other) => other.side === port.side)
        const at = same.indexOf(port)
        const vertical = port.side === "EAST" || port.side === "WEST"
        return {
            id: portElkId(node.id, port.id),
            ...(port.at === undefined ? { width: vertical ? 1 : 96, height: vertical ? 20 : 1 } : { x: port.at.x, y: port.at.y, width: 1, height: 1 }),
            layoutOptions: { "elk.port.side": port.side, "elk.port.index": String(REVERSED.has(port.side) ? same.length - 1 - at : at) },
        }
    })
}

export interface Tree {
    readonly byId: ReadonlyMap<string, SizedNode>
    readonly kids: ReadonlyMap<string, readonly string[]>
    readonly parent: ReadonlyMap<string, string>
    readonly roots: readonly string[]
}

/** The containment of the nodes: a node whose parent is unknown, or would make a cycle, stands at the top. */
export const treeOf = (nodes: readonly SizedNode[]): Tree => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const parent = new Map<string, string>()
    for (const node of nodes) {
        if (node.parentId === undefined || node.parentId === node.id || !byId.has(node.parentId)) continue
        let up: string | undefined = node.parentId
        while (up !== undefined && up !== node.id) up = parent.get(up)
        if (up === undefined) parent.set(node.id, node.parentId)
    }
    const kids = new Map<string, string[]>()
    const roots: string[] = []
    for (const node of nodes) {
        const at = parent.get(node.id)
        if (at === undefined) roots.push(node.id)
        else kids.set(at, [...(kids.get(at) ?? []), node.id])
    }
    return { byId, kids, parent, roots }
}

export const isAncestor = (tree: Tree, ancestor: string, id: string): boolean => {
    for (let at = tree.parent.get(id); at !== undefined; at = tree.parent.get(at)) if (at === ancestor) return true
    return false
}

/** The top node of the tree that holds `id`. */
export const rootOf = (tree: Tree, id: string): string => {
    let at = id
    for (let up = tree.parent.get(at); up !== undefined; up = tree.parent.get(at)) at = up
    return at
}

/** The groups of top nodes joined by an edge (an edge into a container's child joins that container). */
export const islandsOf = (tree: Tree, links: readonly LinkEnds[]): readonly (readonly string[])[] => {
    const group = new Map<string, string>(tree.roots.map((id) => [id, id]))
    const find = (id: string): string => {
        let at = id
        for (let next = group.get(at); next !== undefined && next !== at; next = group.get(at)) at = next
        return at
    }
    for (const link of links) {
        const a = find(rootOf(tree, link.source))
        const b = find(rootOf(tree, link.target))
        if (a !== b) group.set(b, a)
    }
    const islands = new Map<string, string[]>()
    for (const id of tree.roots) {
        const key = find(id)
        islands.set(key, [...(islands.get(key) ?? []), id])
    }
    return [...islands.values()]
}

const sizeOptions = (node: SizedNode, isContainer: boolean, direction: GraphDirection): LayoutOptions => ({
    ...(node.ports !== undefined && node.ports.length > 0 ? { "elk.portConstraints": node.ports.every((port) => port.at !== undefined) ? "FIXED_POS" : "FIXED_ORDER" } : {}),
    ...(isContainer
        ? {
              ...options(direction, false),
              "elk.padding": `[top=${String(node.insets?.top ?? 16)},left=${String(node.insets?.left ?? 16)},bottom=${String(node.insets?.bottom ?? 16)},right=${String(node.insets?.right ?? 16)}]`,
              "elk.nodeSize.constraints": "MINIMUM_SIZE",
              "elk.nodeSize.minimum": `(${String(node.width)},${String(node.height)})`,
          }
        : {}),
})

const elkNode = (tree: Tree, id: string, direction: GraphDirection): ElkNode => {
    const node = tree.byId.get(id)
    if (node === undefined) return { id }
    const kids = tree.kids.get(id)
    const ports = elkPorts(node)
    const isContainer = kids !== undefined && kids.length > 0
    return {
        id,
        ...(isContainer ? {} : { width: node.width, height: node.height }),
        ...(ports === undefined ? {} : { ports }),
        ...(isContainer ? { children: kids.map((kid) => elkNode(tree, kid, direction)) } : {}),
        layoutOptions: sizeOptions(node, isContainer, direction),
    }
}

interface Collected {
    readonly positions: Record<string, GraphPosition>
    readonly boxes: Record<string, Box>
    readonly ports: Record<string, GraphPosition>
    readonly edges: ElkExtendedEdge[]
}

/** The nodes, the ports and the edges of a laid-out graph, at every depth (ELK keeps an edge in the node that holds both its ends). */
const collect = (parent: ElkNode, into: Collected): void => {
    for (const edge of (parent.edges ?? [])) into.edges.push(edge)
    for (const child of parent.children ?? []) {
        into.positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }
        into.boxes[child.id] = { width: Math.round(child.width ?? 0), height: Math.round(child.height ?? 0) }
        for (const port of child.ports ?? []) into.ports[port.id] = { x: Math.round(port.x ?? 0), y: Math.round(port.y ?? 0) }
        collect(child, into)
    }
}

const hasPort = (tree: Tree, node: string, port: string): boolean => tree.byId.get(node)?.ports?.some((candidate) => candidate.id === port) ?? false

/**
 * Places every node with ELK's layered algorithm (left to right, or top to bottom): containers hold their children, an edge leaves from its port,
 * and the disconnected parts of the graph (islands) are laid out one by one and packed side by side. The same graph always gets the same layout,
 * rounded to whole pixels. A position is the top-left corner of a node inside its container (inside the canvas for the others).
 */
export const layoutFlow = async (nodes: readonly SizedNode[], links: readonly LinkEnds[], settings: LayoutSettings = {}): Promise<FlowLayout> => {
    const { direction = "LR", islands: arrangement = "wrap", width = ISLANDS_WIDTH, measure = estimateLabel } = settings
    engine ??= new Elk()
    const tree = treeOf(nodes)
    const placed = usableLinks(nodes, links).filter((link) => !isAncestor(tree, link.source, link.target) && !isAncestor(tree, link.target, link.source))
    // A back edge goes last, so ELK breaks the cycle at it and routes it round the others.
    const usable = placed.filter((link) => link.back !== true)
    const backs = placed.filter((link) => link.back === true)
    const positions: Record<string, GraphPosition> = {}
    const boxes: Record<string, Box> = {}
    const routes: Record<string, Route> = {}
    const ports: Record<string, GraphPosition> = {}
    let cursorX = 0
    let cursorY = 0
    let rowHeight = 0
    for (const island of islandsOf(tree, usable)) {
        const members = new Set(island)
        const inIsland = (id: string): boolean => members.has(rootOf(tree, id))
        const widest = new Map<string, number>()
        for (const link of usable) if (link.label !== undefined && link.label !== "") widest.set(link.source, Math.max(widest.get(link.source) ?? 0, measure(link.label).width))
        const root: ElkNode = {
            id: "root",
            layoutOptions: { ...options(direction, tree.kids.size > 0), "elk.padding": "[top=0,left=0,bottom=0,right=0]" },
            children: island.map((id) => elkNode(tree, id, direction)),
            edges: usable
                .filter((link) => inIsland(link.source) && inIsland(link.target))
                .map((link, index) => {
                    const id = link.id ?? `e${String(index)}`
                    const own = link.label === undefined || link.label === "" ? undefined : measure(link.label)
                    // The labels of one node's branches reserve the same width, so a decision's two sides stay symmetric.
                    const box = own === undefined ? undefined : { width: Math.max(own.width, widest.get(link.source) ?? 0), height: own.height }
                    return {
                        id,
                        sources: [link.sourcePort !== undefined && hasPort(tree, link.source, link.sourcePort) ? portElkId(link.source, link.sourcePort) : link.source],
                        targets: [link.targetPort !== undefined && hasPort(tree, link.target, link.targetPort) ? portElkId(link.target, link.targetPort) : link.target],
                        ...(box === undefined || link.label === undefined
                            ? {}
                            : { labels: [{ id: `${id}::label`, text: link.label, width: box.width, height: box.height, layoutOptions: { "elk.edgeLabels.placement": link.labelAt ?? "CENTER" } }] }),
                    }
                }),
        }
        const laid = await engine.layout(root)
        const found: Collected = { positions: {}, boxes: {}, ports: {}, edges: [] }
        collect(laid, found)
        const local = found.positions
        const sizes = found.boxes
        // ELK's routes, copied; then each decision is made symmetric and its subtrees' edges follow (see arrange.ts).
        const arranged: Record<string, MutableRoute> = {}
        for (const edge of found.edges) {
            const section = edge.sections?.[0]
            if (section === undefined) continue
            const label = edge.labels?.[0]
            const point = (p: { readonly x: number; readonly y: number }): [number, number] => [Math.round(p.x), Math.round(p.y)]
            arranged[edge.id] = {
                points: [point(section.startPoint), ...(section.bendPoints ?? []).map(point)].concat([point(section.endPoint)]),
                ...(label?.x === undefined || label.y === undefined ? {} : { label: { x: Math.round(label.x), y: Math.round(label.y), width: Math.round(label.width ?? 0), height: Math.round(label.height ?? 0) } }),
            }
        }
        const sides = new Map<string, PortSide>()
        for (const id of island) for (const port of tree.byId.get(id)?.ports ?? []) sides.set(`${id}\u0000${port.id}`, port.side)
        alignDecisions({ island, links: usable.filter((link) => inIsland(link.source) && inIsland(link.target)), sides, positions: local, boxes: sizes, routes: arranged, direction })
        let right = 0
        let bottom = 0
        for (const id of island) {
            const at = local[id]
            const box = sizes[id]
            if (at === undefined || box === undefined) continue
            right = Math.max(right, at.x + box.width)
            bottom = Math.max(bottom, at.y + box.height)
        }
        if (arrangement === "wrap" && cursorX > 0 && cursorX + right > width) {
            cursorX = 0
            cursorY += rowHeight + ISLAND_GAP
            rowHeight = 0
        }
        for (const [id, at] of Object.entries(local)) positions[id] = members.has(id) ? { x: at.x + cursorX, y: at.y + cursorY } : at
        Object.assign(boxes, sizes)
        Object.assign(ports, found.ports)
        for (const [id, route] of Object.entries(arranged))
            routes[id] = {
                points: route.points.map(([x, y]) => [x + cursorX, y + cursorY] as const),
                ...(route.label === undefined ? {} : { label: { ...route.label, x: route.label.x + cursorX, y: route.label.y + cursorY } }),
            }
        rowHeight = Math.max(rowHeight, bottom)
        if (arrangement === "wrap") cursorX += right + ISLAND_GAP
        else cursorY += bottom + ISLAND_GAP
    }
    // The back edges are routed last, one by one, each clear of the edges and labels already placed.
    const taken: Taken = { labels: [], routes: [], lanes: [] }
    for (const route of Object.values(routes)) {
        taken.routes.push(route.points)
        if (route.label !== undefined) taken.labels.push({ l: route.label.x, t: route.label.y, r: route.label.x + route.label.width, b: route.label.y + route.label.height })
    }
    for (const link of backs) {
        const route = backRoute(tree, link, positions, boxes, measure, taken)
        if (route !== undefined && link.id !== undefined) routes[link.id] = route
    }
    // Labels of edges that leave one node keep 8px apart.
    const mutable: Record<string, MutableRoute> = Object.fromEntries(Object.entries(routes).map(([id, route]) => [id, { points: route.points.map(([x, y]) => [x, y] as [number, number]), ...(route.label === undefined ? {} : { label: { ...route.label } }) }]))
    separateLabels(usable, mutable, 8)
    snapEnds(tree, placed, mutable, positions, boxes)
    simplifyRoutes(tree, placed, mutable, positions, boxes, direction)
    return { positions, boxes, routes: mutable, ports }
}

/** How far apart (in graph units) two ends may stand across the flow and still be drawn as one straight line: a jog under this is a rounding, never a bend. */
export const STRAIGHT_SNAP = 8

/**
 * The edge-routing law of every graph (owner: "Chốt", 2026-11-23). An edge whose ends share a rank line (their boxes overlap across the flow, or stand within
 * `STRAIGHT_SNAP`) is one straight run, no jog. A port-less edge between offset nodes takes exactly one bend: it leaves its source by the side facing its target
 * across the flow (a decision's other branch turns to the side) and enters its target by the side facing the flow, so every node keeps one entry; when that
 * L would cross a node, the other L (out along the flow, then into the target's top or bottom) is tried, and ELK's own route is kept when both would. The
 * words of a branch stand right at the split. A back edge, an edge on a fixed port and an edge into or out of a container keep their routes.
 */
const simplifyRoutes = (tree: Tree, links: readonly LinkEnds[], routes: Record<string, MutableRoute>, positions: Readonly<Record<string, GraphPosition>>, boxes: Readonly<Record<string, Box>>, direction: GraphDirection): void => {
    const across = direction === "LR" ? 1 : 0
    const along = 1 - across
    const leaves = [...tree.byId.keys()].filter((id) => (tree.kids.get(id) ?? []).length === 0)
    const rects = new Map(leaves.flatMap((id) => {
        const box = boxes[id]
        return box === undefined ? [] : [[id, rectOf(absolute(tree, id, positions), box)] as const]
    }))
    const blocked = (points: readonly Point[], source: string, target: string): boolean => {
        for (const [id, rect] of rects) {
            if (id === source || id === target) continue
            for (let index = 1; index < points.length; index += 1) {
                const a = points[index - 1]
                const b = points[index]
                if (a !== undefined && b !== undefined && runMeets(a, b, grow(rect, 4))) return true
            }
        }
        return false
    }
    const lo = (rect: Rect, axis: number): number => (axis === 0 ? rect.l : rect.t)
    const hi = (rect: Rect, axis: number): number => (axis === 0 ? rect.r : rect.b)
    const mid = (rect: Rect, axis: number): number => (lo(rect, axis) + hi(rect, axis)) / 2
    const pt = (alongValue: number, acrossValue: number): [number, number] => (along === 0 ? [alongValue, acrossValue] : [acrossValue, alongValue])
    for (const link of links) {
        const route = link.id === undefined ? undefined : routes[link.id]
        if (route === undefined || link.back === true) continue
        const s = rects.get(link.source)
        const t = rects.get(link.target)
        if (s === undefined || t === undefined) continue
        const first = route.points[0]
        const last = route.points[route.points.length - 1]
        if (first === undefined || last === undefined) continue
        // A node's own entry and exit (the ports whose id starts with , model.ts IN_PORT and OUT_PORT) are not fixed: the edge may touch any side. A named
        // output (a decision's branch, a card's output pill) is fixed where it stands.
        const fixed = (port: string | undefined): boolean => port !== undefined && !port.startsWith("")
        const ported = fixed(link.sourcePort) || fixed(link.targetPort)
        // Straight: the exit (fixed when on a port) lies within the target's span across the flow, or both centres are a rounding apart.
        const exitAcross = ported ? first[across] : mid(s, across)
        const shared = [Math.max(lo(s, across), lo(t, across)) + 6, Math.min(hi(s, across), hi(t, across)) - 6] as const
        const forward = lo(t, along) >= hi(s, along)
        if (!forward) continue
        // A fixed exit runs straight only from inside the target's span: a branch out of a decision's side vertex never drops past its target.
        const exitInTarget = exitAcross !== undefined && exitAcross >= lo(t, across) + 6 && exitAcross <= hi(t, across) - 6
        const straightAt = Math.abs(mid(s, across) - mid(t, across)) <= STRAIGHT_SNAP
            ? (ported ? (exitInTarget ? exitAcross : undefined) : mid(t, across))
            : !ported && shared[0] <= shared[1]
              ? Math.min(Math.max(mid(t, across), shared[0]), shared[1])
              : ported && exitInTarget && Math.abs(exitAcross - mid(t, across)) <= STRAIGHT_SNAP
                ? exitAcross
                : undefined
        const towards = mid(t, across) > mid(s, across)
        // Into the target by the side facing the flow, at its centre: one entry per node.
        const entry = pt(lo(t, along), mid(t, across))
        let points: [number, number][] | undefined
        if (straightAt !== undefined && exitAcross !== undefined) {
            const candidate = [pt(ported ? (first[along] ?? hi(s, along)) : hi(s, along), straightAt), pt(lo(t, along), straightAt)]
            if (!blocked(candidate, link.source, link.target)) points = candidate
        } else if (fixed(link.targetPort)) {
            points = undefined
        } else if (fixed(link.sourcePort)) {
            // A branch on a side port (across the flow) turns once: out sideways to the target's centre line, then on into the target's flow-facing side.
            const onSide = first[along] !== undefined && first[along] > lo(s, along) + 1 && first[along] < hi(s, along) - 1
            const firstAcross = first[across]
            const firstAlong = first[along]
            if (onSide && firstAcross !== undefined && firstAlong !== undefined && Math.sign(mid(t, across) - firstAcross) === (towards ? 1 : -1)) {
                const candidate = [pt(firstAlong, firstAcross), pt(firstAlong, mid(t, across)), entry]
                if (!blocked(candidate, link.source, link.target)) points = candidate
            }
        } else if (route.points.length > 3 || route.points.length === 3) {
            // Out by the side facing the target across the flow, once round the corner, into the target's flow-facing side; else out along the flow.
            const sideExit = [pt(mid(s, along), towards ? hi(s, across) : lo(s, across)), pt(mid(s, along), mid(t, across)), entry]
            const alongExit = [pt(hi(s, along), mid(s, across)), pt(mid(t, along), mid(s, across)), pt(mid(t, along), towards ? lo(t, across) : hi(t, across))]
            points = [sideExit, alongExit].find((candidate) => !blocked(candidate, link.source, link.target))
        }
        // A route that keeps ELK's shape (an L would cross a node) still carries its words at the split, unless they sit on a named port.
        if (points === undefined && ported) continue
        const label = route.label
        if (points !== undefined) route.points = points
        points = route.points
        if (label === undefined || points.length < 2) continue
        // The words stand right at the split: on the first run this edge does not share with another edge of its source, a little past its start.
        const siblings = links.filter((other) => other !== link && other.source === link.source && other.id !== undefined).flatMap((other) => {
            const theirs = routes[other.id as string]
            return theirs === undefined ? [] : [theirs.points]
        })
        const onRun = (p: readonly [number, number], q: readonly [number, number], at: readonly [number, number]): boolean =>
            (Math.abs(p[0] - q[0]) <= 1 && Math.abs(at[0] - p[0]) <= 1 && at[1] >= Math.min(p[1], q[1]) - 1 && at[1] <= Math.max(p[1], q[1]) + 1) ||
            (Math.abs(p[1] - q[1]) <= 1 && Math.abs(at[1] - p[1]) <= 1 && at[0] >= Math.min(p[0], q[0]) - 1 && at[0] <= Math.max(p[0], q[0]) + 1)
        const sharedRun = (p: readonly [number, number], q: readonly [number, number]): boolean => {
            const middle: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
            return siblings.some((other) => other.some((point, index) => index > 0 && onRun(other[index - 1] ?? point, point, middle)))
        }
        let runAt = 0
        while (runAt < points.length - 2 && sharedRun(points[runAt] ?? [0, 0], points[runAt + 1] ?? [0, 0])) runAt += 1
        const a = points[runAt] ?? [0, 0]
        const b = points[runAt + 1] ?? [0, 0]
        const sideways = a[1] === b[1]
        const room = Math.abs(sideways ? b[0] - a[0] : b[1] - a[1])
        // Past a shared run, the words keep clear of the words a sibling carries on the line they leave.
        const siblingHalf = runAt === 0 ? 0 : Math.max(0, ...links.filter((other) => other !== link && other.source === link.source && other.id !== undefined).map((other) => {
            const theirs = routes[other.id as string]?.label
            return theirs === undefined ? 0 : (sideways ? theirs.width : theirs.height) / 2
        }))
        const half = (sideways ? label.width : label.height) / 2
        const step = Math.max(Math.min((siblingHalf > 0 ? siblingHalf + 8 : 12) + half, room - half), Math.min(12 + half, room / 2))
        const cx = sideways ? a[0] + Math.sign(b[0] - a[0]) * step : a[0]
        const cy = sideways ? a[1] : a[1] + Math.sign(b[1] - a[1]) * step
        route.label = { ...label, x: Math.round(cx - label.width / 2), y: Math.round(cy - label.height / 2) }
    }
}

/**
 * Puts the first point of each route on the border its edge leaves the source by, and the last on the border it enters the target by (a vertical run meets the top or
 * the bottom, a sideways run the left or the right side), so the dot of an edge is centred on the border line and the tip of its arrow touches the border.
 */
const snapEnds = (tree: Tree, links: readonly LinkEnds[], routes: Record<string, { points: [number, number][] }>, positions: Readonly<Record<string, GraphPosition>>, boxes: Readonly<Record<string, Box>>): void => {
    for (const link of links) {
        const route = link.id === undefined ? undefined : routes[link.id]
        if (route === undefined || route.points.length < 2) continue
        const sourceBox = boxes[link.source]
        const targetBox = boxes[link.target]
        const from = absolute(tree, link.source, positions)
        const to = absolute(tree, link.target, positions)
        const [first, second] = route.points
        const last = route.points[route.points.length - 1]
        const before = route.points[route.points.length - 2]
        if (link.back === true) continue
        // A run that is straight (to a pixel) is made exactly straight, on the border and, for a port in the middle of its side, on the middle.
        const fix = (end: [number, number] | undefined, next: [number, number] | undefined, box: Box | undefined, at: GraphPosition, leaving: boolean): void => {
            if (end === undefined || next === undefined || box === undefined) return
            if (Math.abs(end[0] - next[0]) <= 1) {
                const cx = at.x + box.width / 2
                end[1] = leaving ? (next[1] > end[1] ? at.y + box.height : at.y) : next[1] < end[1] ? at.y : at.y + box.height
                if (Math.abs(end[0] - cx) <= 2) {
                    end[0] = cx
                    next[0] = cx
                } else next[0] = end[0]
            } else if (Math.abs(end[1] - next[1]) <= 1) {
                const cy = at.y + box.height / 2
                end[0] = leaving ? (next[0] > end[0] ? at.x + box.width : at.x) : next[0] < end[0] ? at.x : at.x + box.width
                if (Math.abs(end[1] - cy) <= 2) {
                    end[1] = cy
                    next[1] = cy
                } else next[1] = end[1]
            }
        }
        fix(first, second, sourceBox, from, true)
        fix(last, before, targetBox, to, false)
    }
}

/** The absolute top-left corner of a node: its own position, and its containers' above it. */
const absolute = (tree: Tree, id: string, positions: Readonly<Record<string, GraphPosition>>): GraphPosition => {
    let x = 0
    let y = 0
    for (let at: string | undefined = id; at !== undefined; at = tree.parent.get(at)) {
        x += positions[at]?.x ?? 0
        y += positions[at]?.y ?? 0
    }
    return { x, y }
}

/** An axis-aligned box in the canvas frame: left, top, right, bottom. */
interface Rect {
    readonly l: number
    readonly t: number
    readonly r: number
    readonly b: number
}

type Point = readonly [number, number]
type Side = "W" | "E"

/** How far a back edge's lane stands from the side it leaves or enters when that side is free, and the least it may. */
const LANE_LEAD = 40
const LANE_MIN = 24
/** How far a back edge's line keeps from a node or a frame it passes and from another back edge's lane, and from a label. */
const LANE_CLEAR = 16
const LINE_LABEL_CLEAR = 6
/** How far the label of a back edge keeps from a node, a frame border and another label. */
const LABEL_CLEAR = 12
/** The status chip and the tag stand half above a card's top edge: a label keeps clear of them too. */
const TOP_CHIP = 12
/** What a lane pays, in graph units of length, for crossing another edge and for sharing a side of its target with another back edge. */
const CROSS_COST = 400
const SHARED_SIDE_COST = 120
/** What a lane pays for a breach: a line through a node, a frame or a label, or a label with no free place. Any free lane beats it. */
const BREACH_COST = 100_000
/** How far a lane may stand outside the box of its two ends before it pays as much as a tenth of a breach: one card and its gutter. */
const DETOUR = NODE_WIDTH + LANE_LEAD

const rectOf = (at: GraphPosition, box: Box): Rect => ({ l: at.x, t: at.y, r: at.x + box.width, b: at.y + box.height })
const grow = (rect: Rect, by: number): Rect => ({ l: rect.l - by, t: rect.t - by, r: rect.r + by, b: rect.b + by })
const meets = (a: Rect, b: Rect): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
/** Whether the orthogonal run from `a` to `b` passes through the box. */
const runMeets = (a: Point, b: Point, rect: Rect): boolean => meets({ l: Math.min(a[0], b[0]), t: Math.min(a[1], b[1]), r: Math.max(a[0], b[0]), b: Math.max(a[1], b[1]) }, rect)
/** Whether two orthogonal runs cross (each strictly inside the other's span; touching or running along is not a crossing). */
const runsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
    const across = (p: Point, q: Point, r: Point, s: Point): boolean =>
        p[1] === q[1] && r[0] === s[0] && r[0] > Math.min(p[0], q[0]) && r[0] < Math.max(p[0], q[0]) && p[1] > Math.min(r[1], s[1]) && p[1] < Math.max(r[1], s[1])
    return across(a, b, c, d) || across(c, d, a, b)
}
const runsOf = (points: readonly Point[]): readonly (readonly [Point, Point])[] => points.slice(1).map((point, index) => [points[index] ?? point, point] as const)

/** What the back edges of a graph keep clear of, shared as they are routed one by one: the routed edges, their labels and the lanes already taken. */
interface Taken {
    readonly labels: Rect[]
    readonly routes: (readonly Point[])[]
    readonly lanes: { readonly rect: Rect; readonly target: string; readonly side: Side }[]
}

/** The nearest container that holds both nodes, if any. */
const commonParent = (tree: Tree, a: string, b: string): string | undefined => {
    const above = new Set<string>()
    for (let at = tree.parent.get(a); at !== undefined; at = tree.parent.get(at)) above.add(at)
    for (let at = tree.parent.get(b); at !== undefined; at = tree.parent.get(at)) if (above.has(at)) return at
    return undefined
}

/**
 * The route of a back edge: out of the west or east side of its source, along a lane, and into the west or east side of its target. Every lane the
 * span of its ends allows is tried (beside both ends, between them, in each gap between the nodes it would pass) and the shortest that passes no
 * node, frame or label wins; a crossing with another edge, a side of the target another back edge already enters, and a lane or label outside the box
 * of all the nodes (it would widen the layout) cost extra. So a loop-back
 * runs close to the steps it joins, on their nearest free side, never down the far side of the whole graph, and inside the frame that holds both
 * its ends. Its label stands on the lane, at the free place nearest the middle.
 */
const backRoute = (tree: Tree, link: LinkEnds, positions: Readonly<Record<string, GraphPosition>>, boxes: Readonly<Record<string, Box>>, measure: Measure, taken: Taken): Route | undefined => {
    const sourceBox = boxes[link.source]
    const targetBox = boxes[link.target]
    if (sourceBox === undefined || targetBox === undefined) return undefined
    const s = rectOf(absolute(tree, link.source, positions), sourceBox)
    const t = rectOf(absolute(tree, link.target, positions), targetBox)
    // Every node but the two ends, and every frame that holds neither, is in the way; the frame that holds both bounds the lane.
    const nodes: Rect[] = []
    for (const [id, box] of Object.entries(boxes)) {
        if (id === link.source || id === link.target || !tree.byId.has(id)) continue
        if ((tree.kids.get(id)?.length ?? 0) > 0 && (isAncestor(tree, id, link.source) || isAncestor(tree, id, link.target))) continue
        nodes.push(rectOf(absolute(tree, id, positions), box))
    }
    // The layout's own content, the box of all the nodes: a lane that leaves it widens the layout, so it is a near last resort.
    const tops = tree.roots.filter((id) => boxes[id] !== undefined).map((id) => rectOf(absolute(tree, id, positions), boxes[id] as Box))
    const content: Rect = { l: Math.min(...tops.map((rect) => rect.l)), t: Math.min(...tops.map((rect) => rect.t)), r: Math.max(...tops.map((rect) => rect.r)), b: Math.max(...tops.map((rect) => rect.b)) }
    const holder = commonParent(tree, link.source, link.target)
    const holderBox = holder === undefined ? undefined : boxes[holder]
    const bound = holder === undefined || holderBox === undefined ? undefined : rectOf(absolute(tree, holder, positions), holderBox)
    const sy = Math.round((s.t + s.b) / 2)
    const ty = Math.round((t.t + t.b) / 2)
    const lo = Math.min(sy, ty)
    const hi = Math.max(sy, ty)
    const words = link.label === undefined || link.label === "" ? undefined : measure(link.label)
    // The side a branch lies on is tried first, so of two equal lanes the one on the branch's own side wins (the left one for the spine itself).
    const parent = tree.parent.get(link.source)
    const siblings = (parent === undefined ? tree.roots : (tree.kids.get(parent) ?? [])).filter((id) => boxes[id] !== undefined)
    const spineId = [...siblings].sort((a, b) => absolute(tree, a, positions).y - absolute(tree, b, positions).y)[0]
    const spineX = spineId === undefined ? 0 : absolute(tree, spineId, positions).x + (boxes[spineId]?.width ?? 0) / 2
    const right = (s.l + s.r + t.l + t.r) / 4 - spineX > 8
    const sides: readonly (readonly [Side, Side])[] = right ? [["E", "E"], ["W", "W"], ["E", "W"], ["W", "E"]] : [["W", "W"], ["E", "E"], ["W", "E"], ["E", "W"]]
    const lefts = [...nodes.map((rect) => rect.l), ...taken.lanes.map((lane) => lane.rect.l), s.l, t.l]
    const rights = [...nodes.map((rect) => rect.r), ...taken.lanes.map((lane) => lane.rect.r), s.r, t.r]
    const found = new Set<number>()
    for (const x of lefts) for (const by of [LANE_MIN, LANE_LEAD]) found.add(x - by)
    for (const x of rights) for (const by of [LANE_MIN, LANE_LEAD]) found.add(x + by)
    for (const r of rights) for (const l of lefts) if (l - r >= 2 * LANE_CLEAR) found.add(Math.round((r + l) / 2))
    if (bound !== undefined) found.add(bound.l + LANE_CLEAR).add(bound.r - LANE_CLEAR)
    const candidates = [...found].sort((a, b) => a - b)
    const routes = taken.routes.map(runsOf)
    // The label: on the lane, at the free place nearest the middle of it.
    const placeLabel = (g: number, runs: readonly (readonly [Point, Point])[]): Rect | undefined => {
        if (words === undefined) return undefined
        const free = (rect: Rect): boolean => {
            const room = grow(rect, LABEL_CLEAR)
            const line = grow(rect, LINE_LABEL_CLEAR)
            return (
                ![...nodes, s, t].some((node) => meets(room, { ...node, t: node.t - TOP_CHIP })) &&
                !taken.labels.some((other) => meets(room, other)) &&
                !routes.some((route) => route.some(([a, b]) => runMeets(a, b, line))) &&
                !runs.some(([a, b], index) => index !== 1 && runMeets(a, b, line)) &&
                (bound === undefined || (rect.l >= bound.l + LABEL_CLEAR && rect.r <= bound.r - LABEL_CLEAR))
            )
        }
        const middle = (lo + hi) / 2
        const reach = (hi - lo - words.height) / 2 - LINE_LABEL_CLEAR
        for (let step = 0; step <= reach; step += 8)
            for (const y of step === 0 ? [middle] : [middle - step, middle + step]) {
                const l = Math.round(g - words.width / 2)
                const top = Math.round(y - words.height / 2)
                const rect: Rect = { l, t: top, r: l + words.width, b: top + words.height }
                if (free(rect)) return rect
            }
        return undefined
    }
    let best: { readonly cost: number; readonly points: readonly Point[]; readonly label?: Rect; readonly side: Side; readonly lane: Rect } | undefined
    for (const [from, into] of sides) {
        const min = Math.max(from === "E" ? s.r + LANE_MIN : -Infinity, into === "E" ? t.r + LANE_MIN : -Infinity)
        const max = Math.min(from === "W" ? s.l - LANE_MIN : Infinity, into === "W" ? t.l - LANE_MIN : Infinity)
        const sx = from === "E" ? s.r : s.l
        const tx = into === "E" ? t.r : t.l
        for (const g of candidates) {
            if (g < min || g > max) continue
            const points: readonly Point[] = [[sx, sy], [g, sy], [g, ty], [tx, ty]]
            const runs = runsOf(points)
            const lane: Rect = { l: g, t: lo, r: g, b: hi }
            let cost = Math.abs(g - sx) + (hi - lo) + Math.abs(g - tx)
            if (best !== undefined && cost >= best.cost) continue
            for (const [a, b] of runs) {
                for (const rect of nodes) if (runMeets(a, b, grow(rect, LANE_CLEAR))) cost += BREACH_COST
                for (const rect of taken.labels) if (runMeets(a, b, grow(rect, LINE_LABEL_CLEAR))) cost += BREACH_COST
                for (const route of routes) for (const [c, d] of route) if (runsCross(a, b, c, d)) cost += CROSS_COST
            }
            for (const other of taken.lanes) {
                if (meets(grow(lane, LANE_CLEAR - 0.5), other.rect)) cost += BREACH_COST
                if (other.target === link.target && other.side === into) cost += SHARED_SIDE_COST
            }
            if (bound !== undefined && (g < bound.l + LANE_CLEAR || g > bound.r - LANE_CLEAR)) cost += BREACH_COST
            if (g < Math.min(s.l, t.l) - DETOUR || g > Math.max(s.r, t.r) + DETOUR) cost += BREACH_COST / 10
            if (best !== undefined && cost >= best.cost) continue
            const label = placeLabel(g, runs)
            if (words !== undefined && label === undefined) cost += BREACH_COST
            const half = words === undefined ? 0 : words.width / 2
            const outside = Math.max(content.l - Math.min(g - half, label?.l ?? g), Math.max(g + half, label?.r ?? g) - content.r, 0)
            // Outside the box of all the nodes a lane or its words widen the layout, and the first view, centred on a step, leaves them out: each unit
            // out costs its length, and more than the lane's gutter out is a near last resort.
            if (outside > 0) cost += outside
            if (outside > LANE_LEAD) cost += BREACH_COST / 10
            if (best === undefined || cost < best.cost) best = { cost, points, side: into, lane, ...(label === undefined ? {} : { label }) }
        }
    }
    if (best === undefined) return undefined
    taken.lanes.push({ rect: best.lane, target: link.target, side: best.side })
    taken.routes.push(best.points)
    if (words === undefined) return { points: best.points }
    const box = best.label === undefined ? { x: Math.round(best.lane.l - words.width / 2), y: Math.round((lo + hi - words.height) / 2), width: words.width, height: words.height } : { x: best.label.l, y: best.label.t, width: words.width, height: words.height }
    taken.labels.push({ l: box.x, t: box.y, r: box.x + box.width, b: box.y + box.height })
    return { points: best.points, label: box }
}

/** The positions of a graph, laid out by ELK (see `layoutFlow`). */
export const layoutGraph = async (nodes: readonly SizedNode[], links: readonly LinkEnds[], direction: GraphDirection = "LR"): Promise<Readonly<Record<string, GraphPosition>>> =>
    (await layoutFlow(nodes, links, { direction })).positions
