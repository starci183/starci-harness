import ElkModule from "elkjs/lib/elk.bundled.js"
import type { ELK, ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs/lib/elk-api.js"
import { separateLabels, symmetrise, type MutableRoute } from "./arrange.js"
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
}

/** The route ELK gave an edge, in the frame of its island, and the box it reserved for the label. */
export interface Route {
    readonly points: readonly (readonly [number, number])[]
    readonly label?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
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
    // SIMPLE keeps the spine on one x and a decision's branches equally far either side; BRANDES_KOEPF left them 8 to 70px off (see the CHANGELOG).
    "elk.layered.nodePlacement.strategy": "SIMPLE",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.spacing.portPort": "10",
    "elk.layered.spacing.nodeNodeBetweenLayers": direction === "LR" ? "96" : "64",
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
    "elk.layered.considerModelOrder.strategy": "PREFER_EDGES",
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "elk.layered.nodePlacement.favorStraightEdges": "true",
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

interface Tree {
    readonly byId: ReadonlyMap<string, SizedNode>
    readonly kids: ReadonlyMap<string, readonly string[]>
    readonly parent: ReadonlyMap<string, string>
    readonly roots: readonly string[]
}

/** The containment of the nodes: a node whose parent is unknown, or would make a cycle, stands at the top. */
const treeOf = (nodes: readonly SizedNode[]): Tree => {
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

const isAncestor = (tree: Tree, ancestor: string, id: string): boolean => {
    for (let at = tree.parent.get(id); at !== undefined; at = tree.parent.get(at)) if (at === ancestor) return true
    return false
}

/** The top node of the tree that holds `id`. */
const rootOf = (tree: Tree, id: string): string => {
    let at = id
    for (let up = tree.parent.get(at); up !== undefined; up = tree.parent.get(at)) at = up
    return at
}

/** The groups of top nodes joined by an edge (an edge into a container's child joins that container). */
const islandsOf = (tree: Tree, links: readonly LinkEnds[]): readonly (readonly string[])[] => {
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
        symmetrise({ island, links: usable.filter((link) => inIsland(link.source) && inIsland(link.target)), sides, positions: local, boxes: sizes, routes: arranged })
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
    for (const link of backs) {
        const route = backRoute(tree, link, positions, boxes, measure)
        if (route !== undefined && link.id !== undefined) routes[link.id] = route
    }
    // Labels of edges that leave one node keep 8px apart.
    const mutable: Record<string, MutableRoute> = Object.fromEntries(Object.entries(routes).map(([id, route]) => [id, { points: route.points.map(([x, y]) => [x, y] as [number, number]), ...(route.label === undefined ? {} : { label: { ...route.label } }) }]))
    separateLabels(usable, mutable, 8)
    snapEnds(tree, placed, mutable, positions, boxes)
    return { positions, boxes, routes: mutable, ports }
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

/**
 * The route of a back edge: out of the west or east side of its source, along the gutter on the side its branch lies (the left one for the spine itself), and into the
 * same side of its target. The gutter lies outside every sibling node beside the lane (overlapping the rows between its ends), so the line never crosses the spine
 * or a branch it passes, and stays near the steps it joins; its label stands on the line.
 */
const backRoute = (tree: Tree, link: LinkEnds, positions: Readonly<Record<string, GraphPosition>>, boxes: Readonly<Record<string, Box>>, measure: Measure): Route | undefined => {
    const sourceBox = boxes[link.source]
    const targetBox = boxes[link.target]
    if (sourceBox === undefined || targetBox === undefined) return undefined
    const from = absolute(tree, link.source, positions)
    const to = absolute(tree, link.target, positions)
    const parent = tree.parent.get(link.source)
    const siblings = (parent === undefined ? tree.roots : (tree.kids.get(parent) ?? [])).filter((id) => boxes[id] !== undefined)
    // The gutter keeps clear of the siblings the lane runs beside (those that overlap the rows between its ends), not of the whole graph: a back edge stays
    // near the steps it joins instead of running down the far side of every branch.
    const top = Math.min(from.y, to.y)
    const bottom = Math.max(from.y + sourceBox.height, to.y + targetBox.height)
    const beside = siblings.filter((id) => {
        const y = absolute(tree, id, positions).y
        return id === link.source || id === link.target || (y < bottom && y + (boxes[id]?.height ?? 0) > top)
    })
    const lefts = beside.map((id) => absolute(tree, id, positions).x)
    const rights = beside.map((id) => absolute(tree, id, positions).x + (boxes[id]?.width ?? 0))
    const spineId = [...siblings].sort((a, b) => absolute(tree, a, positions).y - absolute(tree, b, positions).y)[0]
    const spineX = spineId === undefined ? 0 : absolute(tree, spineId, positions).x + (boxes[spineId]?.width ?? 0) / 2
    const centre = (from.x + sourceBox.width / 2 + to.x + targetBox.width / 2) / 2
    const right = centre - spineX > 8
    const gutter = right ? Math.max(...rights) + 40 : Math.min(...lefts) - 40
    const sy = from.y + sourceBox.height / 2
    const ty = to.y + targetBox.height / 2
    const sx = right ? from.x + sourceBox.width : from.x
    const tx = right ? to.x + targetBox.width : to.x
    const points: readonly (readonly [number, number])[] = [[Math.round(sx), Math.round(sy)], [Math.round(gutter), Math.round(sy)], [Math.round(gutter), Math.round(ty)], [Math.round(tx), Math.round(ty)]]
    if (link.label === undefined || link.label === "") return { points }
    const box = measure(link.label)
    return { points, label: { x: Math.round(gutter - box.width / 2), y: Math.round((sy + ty) / 2 - box.height / 2), width: box.width, height: box.height } }
}

/** The positions of a graph, laid out by ELK (see `layoutFlow`). */
export const layoutGraph = async (nodes: readonly SizedNode[], links: readonly LinkEnds[], direction: GraphDirection = "LR"): Promise<Readonly<Record<string, GraphPosition>>> =>
    (await layoutFlow(nodes, links, { direction })).positions
