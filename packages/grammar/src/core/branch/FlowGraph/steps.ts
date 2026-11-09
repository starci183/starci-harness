import { wrappedLines, type FlowGraphPoint } from "./layout.js"
import type { FlowGraphChip, FlowGraphDirection, FlowGraphEdge, FlowGraphNode, FlowGraphPort, FlowGraphStepKind } from "./types.js"

/**
 * The `steps` layout (0.35.0): the card map of a workflow. Every card is one width; the flow reads down (`TB`, the default) or across
 * (`LR`). A node sits in the layer after its deepest forward predecessor; the forward edges by first parent form a tree, and the tree is
 * laid out tidy: a leaf takes one column, a parent sits centred over its children, and the children of a condition stand in the order
 * of its ports, so the "Có" branch is left of the "Không" branch. A back edge never changes a layer; it is routed round the cards
 * through the gap below its source's layer (see {@link stepsBackRoute}).
 */

/** The card width (`--grammar-flow-card-width`, 12.25rem), in graph units. */
export const STEPS_CARD_WIDTH = 196
/** A port label shows this many characters; a longer one is cut with an ellipsis and read in full from its tooltip. */
export const STEPS_PORT_CHARS = 16
/** The most a card widens for its ports, in graph units. */
const STEPS_CARD_WIDTH_MAX = 360
/** An estimate of a port's width: 12px type at about 6.5 per character, the cell's inline padding and its divider. */
const portWidth = (port: FlowGraphPort): number => Math.min(port.label.length, STEPS_PORT_CHARS) * 6.5 + 2 * 8 + 1

/** The card width of a graph (0.36.2): the base width, or wider when a condition's ports need it (one width for every card, so the columns stay aligned). */
export const stepsCardWidth = (ports: ReadonlyMap<string, ReadonlyArray<FlowGraphPort>>): number =>
    Math.min(STEPS_CARD_WIDTH_MAX, Math.max(STEPS_CARD_WIDTH, ...[...ports.values()].map((row) => Math.ceil(row.reduce((sum, port) => sum + portWidth(port), 0) + 2))))

/** The room between two columns: wide enough for the vertical runs of back edges beside a card. */
export const STEPS_COLUMN_GAP = 80
/** The room between two layers: a curve, and the channels of back edges after a layer (`LR` also holds a back label beside its channel). */
export const STEPS_LAYER_GAP = { TB: 64, LR: 112 } as const
/** The margin around the graph at zoom 1. */
export const STEPS_MARGIN = 32

/** Card geometry from the CSS, to estimate a card's height before it is drawn. */
const CARD_CHROME = 2 * 8 + 2
const TILE = 32
const TITLE_LINE = 18
const DESCRIPTION_LINE = 16
/** The agent line under a title (0.37.5): a 16px avatar and the name, with a 2px step above it. */
const AGENT_LINE = 18
const TITLE_CHARS = 16
const DESCRIPTION_CHARS = 19
const OUTPUTS_ROW = 33
const END_HEIGHT = 36
/** Chips under a title (0.37.4): the most drawn before the "+N" pill; a chip row is 16 tall with a 4 gap above it. */
export const STEPS_CHIPS_MAX = 3
const CHIP_ROW = 16
const CHIP_GAP = 4
/** The width the copy column of a card has for its chips (card width less padding, border, tile and gap), and an estimate of a chip's width. */
const CHIP_ROOM = STEPS_CARD_WIDTH - 2 * 12 - 2 - TILE - 8
const chipWidth = (label: string): number => Math.min(label.length, 18) * 6 + 2 * 8 + 4

/** The chips a card draws and the count that folds into "+N". */
export const chipsOf = (chips: ReadonlyArray<FlowGraphChip> | undefined): { readonly shown: ReadonlyArray<FlowGraphChip>, readonly rest: number } => {
    const all = chips ?? []
    return { shown: all.slice(0, STEPS_CHIPS_MAX), rest: Math.max(0, all.length - STEPS_CHIPS_MAX) }
}

/** The height of the chip rows of a card (wrapping in the copy column), 0 with no chips. */
const chipsHeight = (chips: ReadonlyArray<FlowGraphChip> | undefined): number => {
    const { shown, rest } = chipsOf(chips)
    const widths = [...shown.map((chip) => chipWidth(chip.label)), ...(rest > 0 ? [chipWidth(`+${String(rest)}`)] : [])]
    if (widths.length === 0) return 0
    let rows = 1
    let used = 0
    for (const width of widths) {
        if (used > 0 && used + width > CHIP_ROOM) {
            rows += 1
            used = 0
        }
        used += width + CHIP_GAP
    }
    return CHIP_GAP + rows * CHIP_ROW + (rows - 1) * CHIP_GAP
}

/** The `steps` kind of a node; the `lanes` kinds map onto it, and a node without one is an action. */
export const stepKindOf = (node: FlowGraphNode): FlowGraphStepKind => {
    switch (node.kind) {
        case "trigger": return "event"
        case "execute": return "action"
        case "output": return "end"
        case undefined: return "action"
        default: return node.kind
    }
}

export const isBackEdge = (edge: FlowGraphEdge): boolean => edge.variant === "back" || edge.variant === "return"

/** The output ports of a node: its own `outputs`, else on a condition the labels of its labelled outgoing forward edges (each label once). */
export const portsOf = (node: FlowGraphNode, edges: ReadonlyArray<FlowGraphEdge>): ReadonlyArray<FlowGraphPort> => {
    // Any kind may declare `outputs` (0.37.4); only a condition derives ports from its labelled edges.
    if (node.outputs !== undefined) return node.outputs
    if (stepKindOf(node) !== "condition") return []
    const labels: string[] = []
    for (const edge of edges) {
        if (edge.source !== node.id || isBackEdge(edge)) continue
        const label = edge.sourcePort ?? edge.label
        if (label !== undefined && label !== "" && !labels.includes(label)) labels.push(label)
    }
    return labels.map((label) => ({ id: label, label }))
}

/** The port an edge leaves from, matched by `sourcePort` (id, then label), else by its own label; undefined when it leaves no port. */
export const portOfEdge = (edge: FlowGraphEdge, ports: ReadonlyArray<FlowGraphPort>): FlowGraphPort | undefined => {
    if (ports.length === 0) return undefined
    const key = edge.sourcePort ?? edge.label
    if (key === undefined || key === "") return undefined
    return ports.find((port) => port.id === key) ?? ports.find((port) => port.label === key)
}

/** The height a card draws at, estimated from its words and ports. */
export const stepsNodeHeight = (node: FlowGraphNode, ports: number): number => {
    if (stepKindOf(node) === "end") return END_HEIGHT
    const title = wrappedLines(node.label, TITLE_CHARS) * TITLE_LINE
    const description = node.description === undefined || node.description === "" ? 0 : wrappedLines(node.description, DESCRIPTION_CHARS) * DESCRIPTION_LINE
    return CARD_CHROME + Math.max(TILE, title + (node.agent === undefined ? 0 : AGENT_LINE) + description + chipsHeight(node.chips)) + (ports > 0 ? OUTPUTS_ROW : 0)
}

/** A back edge as the layout routes it: the channel it runs in under its source's layer, and its place among the back edges of its target side. */
export type StepsBackRoute = {
    /** The along coordinate (y for `TB`, x for `LR`) of the channel, in graph units. */
    readonly channel: number
    /** How far beside the target's side its last run climbs. */
    readonly targetOffset: number
    /** How far off the target's middle it enters, along the side. */
    readonly entryOffset: number
    /** The side of the source it leaves, and the side of the target it enters: `start` (left / top) or `end` (right / bottom). */
    readonly sourceSide: "start" | "end"
    readonly targetSide: "start" | "end"
}

export type StepsLayout = {
    /** Node centres, in graph units. */
    readonly positions: ReadonlyMap<string, FlowGraphPoint>
    readonly layers: ReadonlyMap<string, number>
    readonly ports: ReadonlyMap<string, ReadonlyArray<FlowGraphPort>>
    readonly back: ReadonlyMap<string, StepsBackRoute>
    /** The width every card draws at, in graph units (the base width, or wider for a condition's ports). */
    readonly cardWidth: number
    /** The size of the whole graph at zoom 1, margin included. */
    readonly width: number
    readonly height: number
    /** The box of every loop card (a node with `container`), centred on its position, in graph units (0.37.4). */
    readonly boxes: ReadonlyMap<string, { readonly width: number, readonly height: number }>
    /** The top-left corner of the content (margin excluded) in the same coordinates as `positions`. */
    readonly origin: FlowGraphPoint
}

/** Rounded orthogonal path through points (screen coordinates), every corner a quarter curve of `radius`. */
export const roundedPath = (points: ReadonlyArray<FlowGraphPoint>, radius: number): string => {
    const first = points[0]
    if (first === undefined) return ""
    let path = `M ${first.x} ${first.y}`
    for (let index = 1; index < points.length; index += 1) {
        const point = points[index] as FlowGraphPoint
        const next = points[index + 1]
        if (next === undefined) {
            path += ` L ${point.x} ${point.y}`
            break
        }
        const previous = points[index - 1] as FlowGraphPoint
        const inLength = Math.hypot(point.x - previous.x, point.y - previous.y)
        const outLength = Math.hypot(next.x - point.x, next.y - point.y)
        const r = Math.min(radius, inLength / 2, outLength / 2)
        if (r <= 0) {
            path += ` L ${point.x} ${point.y}`
            continue
        }
        const before = { x: point.x - ((point.x - previous.x) / inLength) * r, y: point.y - ((point.y - previous.y) / inLength) * r }
        const after = { x: point.x + ((next.x - point.x) / outLength) * r, y: point.y + ((next.y - point.y) / outLength) * r }
        path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`
    }
    return path
}

/** The distance a back edge first runs out of its source's side before it turns. */
export const STEPS_BACK_LEAVE = 12
const BACK_CHANNEL_FIRST = 14
const BACK_CHANNEL_STEP = 12
const BACK_TARGET_FIRST = 10
const BACK_TARGET_STEP = 14
const BACK_ENTRY_STEP = 12

/**
 * The points of a back edge, from its source handle to its target handle (screen coordinates, the handles at the middle of a side): out of
 * the source's side, along to its channel under the source's layer, across to beside the target, and back along into the target's side.
 */
export const stepsBackRoute = (
    source: FlowGraphPoint,
    target: FlowGraphPoint,
    route: StepsBackRoute,
    direction: FlowGraphDirection,
): ReadonlyArray<FlowGraphPoint> => {
    // Work in (across, along): x/y for TB, y/x for LR.
    const toLocal = (point: FlowGraphPoint) => direction === "TB" ? { a: point.x, l: point.y } : { a: point.y, l: point.x }
    const toScreen = (a: number, l: number): FlowGraphPoint => direction === "TB" ? { x: a, y: l } : { x: l, y: a }
    const s = toLocal(source)
    const t = toLocal(target)
    const leave = route.sourceSide === "start" ? -STEPS_BACK_LEAVE : STEPS_BACK_LEAVE
    const beside = route.targetSide === "start" ? -route.targetOffset : route.targetOffset
    const entry = t.l + route.entryOffset
    return [
        toScreen(s.a, s.l),
        toScreen(s.a + leave, s.l),
        toScreen(s.a + leave, route.channel),
        toScreen(t.a + beside, route.channel),
        toScreen(t.a + beside, entry),
        toScreen(t.a, entry),
    ]
}

/** The room a loop card keeps between its box and its children, and the height of its header line (label and chips). */
export const STEPS_CONTAINER_PAD = 16
export const STEPS_CONTAINER_HEAD = 40
/** The gap between two islands (disconnected parts of a graph), stacked vertically. */
export const STEPS_ISLAND_GAP = 48

type Box = { readonly width: number, readonly height: number }

/** The width a loop card's header line needs: its label, then its chips on one line, between the card's insets. */
const containerHeaderWidth = (node: FlowGraphNode): number => {
    const { shown, rest } = chipsOf(node.container?.chips)
    const chips = [...shown.map((chip) => chipWidth(chip.label)), ...(rest > 0 ? [chipWidth(`+${String(rest)}`)] : [])]
    return 2 * 12 + Math.min((node.container?.label ?? node.label).length, 40) * 7.5 + chips.reduce((sum, width) => sum + width + 8, 0)
}

/** Everything under a container: its children and their children, by `childIds`. */
const descendantsOf = (root: FlowGraphNode, byId: ReadonlyMap<string, FlowGraphNode>): Set<string> => {
    const out = new Set<string>()
    const walk = (node: FlowGraphNode) => {
        for (const id of node.container?.childIds ?? []) {
            const child = byId.get(id)
            if (child === undefined || out.has(id) || id === root.id) continue
            out.add(id)
            walk(child)
        }
    }
    walk(root)
    return out
}

type Core = {
    readonly positions: Map<string, FlowGraphPoint>
    readonly layers: Map<string, number>
    readonly back: Map<string, StepsBackRoute>
    readonly origin: FlowGraphPoint
    readonly contentWidth: number
    readonly contentHeight: number
}

/** One connected part of a graph, laid out on its own: the tidy tree, the layers and the back-edge channels (the body of the 0.35.0 layout). */
const coreLayout = (
    nodes: ReadonlyArray<FlowGraphNode>,
    edges: ReadonlyArray<FlowGraphEdge>,
    direction: FlowGraphDirection,
    cardWidth: number,
    boxes: ReadonlyMap<string, Box>,
    ports: ReadonlyMap<string, ReadonlyArray<FlowGraphPort>>,
): Core => {
    const known = new Set(nodes.map((node) => node.id))
    const usable = edges.filter((edge) => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target)
    const forward = usable.filter((edge) => !isBackEdge(edge))
    // Longest path over the forward edges; an edge that closes a cycle is bounded by the node count.
    const layers = new Map<string, number>(nodes.map((node) => [node.id, 0]))
    for (let pass = 0; pass < nodes.length; pass += 1) {
        let changed = false
        for (const edge of forward) {
            const next = (layers.get(edge.source) ?? 0) + 1
            if (next > (layers.get(edge.target) ?? 0) && next < nodes.length) {
                layers.set(edge.target, next)
                changed = true
            }
        }
        if (!changed) break
    }
    const layerOf = (id: string) => layers.get(id) ?? 0
    const isCondition = new Map(nodes.map((node) => [node.id, stepKindOf(node) === "condition"]))
    const heightOf = (node: FlowGraphNode) => boxes.get(node.id)?.height ?? stepsNodeHeight(node, (ports.get(node.id) ?? []).length)
    const widthOf = (node: FlowGraphNode) => boxes.get(node.id)?.width ?? cardWidth

    // The tree: a node hangs under the source of its first forward edge that runs down a layer or more.
    const parent = new Map<string, string>()
    const children = new Map<string, Array<{ readonly id: string, readonly order: number }>>()
    forward.forEach((edge, index) => {
        if (parent.has(edge.target) || layerOf(edge.target) <= layerOf(edge.source)) return
        parent.set(edge.target, edge.source)
        const sourcePorts = ports.get(edge.source) ?? []
        const port = portOfEdge(edge, sourcePorts)
        const fork = isCondition.get(edge.source) === true
        // A condition's flow-through edges come after its ports; on any other kind the main flow stands before its ports (an error branch is last).
        const order = port === undefined
            ? fork ? sourcePorts.length * edges.length + index : index
            : (fork ? 0 : edges.length) + sourcePorts.indexOf(port) * edges.length + index
        children.set(edge.source, [...(children.get(edge.source) ?? []), { id: edge.target, order }])
    })
    const kids = (id: string) => [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order).map((child) => child.id)

    // A loop card is wider (TB) or taller (LR) than one column: it takes as many columns as it needs.
    const crossStep = direction === "TB" ? cardWidth + STEPS_COLUMN_GAP : Math.max(TILE + CARD_CHROME, ...nodes.filter((node) => !boxes.has(node.id)).map(heightOf)) + STEPS_COLUMN_GAP
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const spanOf = (id: string) => {
        const box = boxes.get(id)
        if (box === undefined || byId.get(id) === undefined) return 1
        return Math.max(1, Math.ceil(((direction === "TB" ? box.width : box.height) + STEPS_COLUMN_GAP) / crossStep))
    }

    // Tidy columns: a leaf takes the next column(s), a parent sits centred over its first and last child.
    const across = new Map<string, number>()
    let nextColumn = 0
    const place = (id: string, seen: Set<string>): number => {
        if (seen.has(id)) return across.get(id) ?? nextColumn
        seen.add(id)
        const own = kids(id).filter((child) => !seen.has(child))
        if (own.length === 0) {
            const width = spanOf(id)
            const column = nextColumn + (width - 1) / 2
            nextColumn += width
            across.set(id, column)
            return column
        }
        const placed = own.map((child) => place(child, seen))
        const column = ((placed[0] ?? 0) + (placed[placed.length - 1] ?? 0)) / 2
        across.set(id, column)
        return column
    }
    const seen = new Set<string>()
    for (const node of nodes) if (!parent.has(node.id)) place(node.id, seen)
    for (const node of nodes) if (!across.has(node.id)) place(node.id, seen)

    // Several entry nodes feeding one step (0.37.4): when every source of a step is a root whose only target it is, the roots stand side by side centred over it.
    const sources = new Map<string, string[]>()
    for (const edge of forward) sources.set(edge.target, [...new Set([...(sources.get(edge.target) ?? []), edge.source])])
    for (const [target, from] of sources) {
        if (from.length < 2) continue
        if (!from.every((id) => !sources.has(id) && forward.every((edge) => edge.source !== id || edge.target === target))) continue
        const centre = across.get(target) ?? 0
        from.forEach((id, index) => across.set(id, centre + (index - (from.length - 1) / 2)))
    }
    let low = Infinity
    let high = -Infinity
    for (const node of nodes) {
        const half = (spanOf(node.id) - 1) / 2
        low = Math.min(low, (across.get(node.id) ?? 0) - half)
        high = Math.max(high, (across.get(node.id) ?? 0) + half)
    }
    if (!Number.isFinite(low)) {
        low = 0
        high = 0
    }
    for (const node of nodes) across.set(node.id, (across.get(node.id) ?? 0) - low)
    const columns = high - low

    // The extent of every layer along the flow: TB rows as tall as their tallest card, LR columns as wide as their widest.
    const layerCount = Math.max(0, ...layers.values()) + 1
    const extent = new Array<number>(layerCount).fill(0)
    for (const node of nodes) {
        const size = direction === "TB" ? heightOf(node) : widthOf(node)
        extent[layerOf(node.id)] = Math.max(extent[layerOf(node.id)] ?? 0, size)
    }
    const layerStart: number[] = []
    let along = 0
    for (const size of extent) {
        layerStart.push(along)
        along += size + STEPS_LAYER_GAP[direction]
    }
    const alongSize = Math.max(0, along - STEPS_LAYER_GAP[direction])

    const positions = new Map<string, FlowGraphPoint>()
    for (const node of nodes) {
        const layer = layerOf(node.id)
        const l = (layerStart[layer] ?? 0) + (extent[layer] ?? 0) / 2
        const a = (across.get(node.id) ?? 0) * crossStep
        positions.set(node.id, direction === "TB" ? { x: a, y: l } : { x: l, y: a })
    }

    // Back edges: grouped by target side, the nearest source takes the shallowest channel, the widest offset and the highest entry, so
    // the routes nest and never cross one another.
    const back = new Map<string, StepsBackRoute>()
    const backEdges = usable.filter(isBackEdge)
    const sideOf = (edge: FlowGraphEdge) => {
        const s = across.get(edge.source) ?? 0
        const t = across.get(edge.target) ?? 0
        // A source right of (below) its target leaves its start side and enters the target's end side; level, both use the end side.
        return s > t ? { sourceSide: "start" as const, targetSide: "end" as const } : s < t ? { sourceSide: "end" as const, targetSide: "start" as const } : { sourceSide: "end" as const, targetSide: "end" as const }
    }
    const groups = new Map<string, FlowGraphEdge[]>()
    for (const edge of backEdges) {
        const key = `${edge.target}:${sideOf(edge).targetSide}`
        groups.set(key, [...(groups.get(key) ?? []), edge])
    }
    const channelUse = new Map<number, number>()
    for (const group of groups.values()) {
        const sorted = [...group].sort((a, b) => Math.abs((across.get(a.source) ?? 0) - (across.get(a.target) ?? 0)) - Math.abs((across.get(b.source) ?? 0) - (across.get(b.target) ?? 0)))
        sorted.forEach((edge, k) => {
            const layer = layerOf(edge.source)
            const used = channelUse.get(layer) ?? 0
            channelUse.set(layer, used + 1)
            const sides = sideOf(edge)
            back.set(edge.id, {
                channel: (layerStart[layer] ?? 0) + (extent[layer] ?? 0) + BACK_CHANNEL_FIRST + used * BACK_CHANNEL_STEP,
                targetOffset: BACK_TARGET_FIRST + (sorted.length - 1 - k) * BACK_TARGET_STEP,
                entryOffset: (k - (sorted.length - 1) / 2) * BACK_ENTRY_STEP,
                ...sides,
            })
        })
    }
    // The layer gap holds three channels under a layer; a fourth back edge out of one layer runs over the next layer's curves.

    const acrossSize = columns * crossStep + (direction === "TB" ? cardWidth : crossStep - STEPS_COLUMN_GAP)
    return {
        positions,
        layers,
        back,
        origin: direction === "TB" ? { x: -cardWidth / 2, y: 0 } : { x: 0, y: -(crossStep - STEPS_COLUMN_GAP) / 2 },
        contentWidth: direction === "TB" ? acrossSize : alongSize,
        contentHeight: direction === "TB" ? alongSize : acrossSize,
    }
}

/** The parts of a graph that share no edge, in node order (undirected, over the edges both of whose ends are here). */
const componentsOf = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>): ReadonlyArray<ReadonlyArray<FlowGraphNode>> => {
    const root = new Map(nodes.map((node) => [node.id, node.id]))
    const find = (id: string): string => {
        let current = id
        while (root.get(current) !== current) current = root.get(current) ?? current
        return current
    }
    for (const edge of edges) {
        if (!root.has(edge.source) || !root.has(edge.target)) continue
        root.set(find(edge.source), find(edge.target))
    }
    const groups = new Map<string, FlowGraphNode[]>()
    for (const node of nodes) groups.set(find(node.id), [...(groups.get(find(node.id)) ?? []), node])
    return [...groups.values()]
}

/**
 * The `steps` layout of a graph (see the module comment). 0.37.4: a node with `container` is a loop card, laid out as a box that holds its children's own
 * layout; the graph may be disconnected (each island is laid out on its own and the islands stack down the page); several entry nodes may feed one step.
 */
export const stepsLayout = (nodes: ReadonlyArray<FlowGraphNode>, edges: ReadonlyArray<FlowGraphEdge>, direction: FlowGraphDirection, shared?: { readonly cardWidth: number }): StepsLayout => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const ports = new Map(nodes.map((node) => [node.id, portsOf(node, edges)]))
    const cardWidth = shared?.cardWidth ?? stepsCardWidth(ports)

    // Loop cards: the children of each top-level container are laid out as a graph of their own, and the container stands as one box.
    const inside = new Set<string>()
    const owned = new Map<string, Set<string>>()
    for (const node of nodes) {
        if (node.container === undefined) continue
        const below = descendantsOf(node, byId)
        owned.set(node.id, below)
        for (const id of below) inside.add(id)
    }
    const top = nodes.filter((node) => !inside.has(node.id))
    const subs = new Map<string, { readonly layout: StepsLayout, readonly box: Box }>()
    const owner = new Map<string, string>()
    for (const node of top) {
        const below = owned.get(node.id)
        if (below === undefined) continue
        for (const id of below) owner.set(id, node.id)
        const layout = stepsLayout(nodes.filter((child) => below.has(child.id)), edges.filter((edge) => below.has(edge.source) && below.has(edge.target)), direction, { cardWidth })
        const contentWidth = layout.width - 2 * STEPS_MARGIN
        const contentHeight = layout.height - 2 * STEPS_MARGIN
        subs.set(node.id, { layout, box: { width: Math.max(cardWidth, contentWidth + 2 * STEPS_CONTAINER_PAD, containerHeaderWidth(node)), height: STEPS_CONTAINER_HEAD + contentHeight + 2 * STEPS_CONTAINER_PAD } })
    }
    const boxes = new Map<string, Box>([...subs].map(([id, sub]) => [id, sub.box]))
    // An edge into or out of a child is laid out as an edge of its container; an edge inside a container belongs to its own layout.
    const outerEdges = edges.flatMap((edge): FlowGraphEdge[] => {
        const source = owner.get(edge.source) ?? edge.source
        const target = owner.get(edge.target) ?? edge.target
        if (source === target) return []
        return [source === edge.source && target === edge.target ? edge : { ...edge, source, target }]
    })

    const cores = componentsOf(top, outerEdges).map((part) => {
        const ids = new Set(part.map((node) => node.id))
        return coreLayout(part, outerEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), direction, cardWidth, boxes, ports)
    })
    // Islands stack down the page, left edges aligned, the first at the origin of its own layout.
    const left = cores.length === 0 ? 0 : Math.min(...cores.map((core) => core.origin.x))
    const topEdge = cores[0]?.origin.y ?? 0
    const positions = new Map<string, FlowGraphPoint>()
    const layers = new Map<string, number>()
    const back = new Map<string, StepsBackRoute>()
    let cursor = topEdge
    let contentWidth = 0
    for (const core of cores) {
        const dx = left - core.origin.x
        const dy = cursor - core.origin.y
        for (const [id, point] of core.positions) positions.set(id, { x: point.x + dx, y: point.y + dy })
        for (const [id, layer] of core.layers) layers.set(id, layer)
        for (const [id, route] of core.back) back.set(id, { ...route, channel: route.channel + (direction === "TB" ? dy : dx) })
        contentWidth = Math.max(contentWidth, core.contentWidth)
        cursor += core.contentHeight + STEPS_ISLAND_GAP
    }
    const contentHeight = cores.length === 0 ? 0 : cursor - STEPS_ISLAND_GAP - topEdge

    // Put every container's children in its box: the child layout's content corner goes to the box's content corner.
    const allBoxes = new Map(boxes)
    for (const [id, sub] of subs) {
        const centre = positions.get(id) ?? { x: 0, y: 0 }
        const innerWidth = sub.layout.width - 2 * STEPS_MARGIN
        const corner = { x: centre.x - sub.box.width / 2 + (sub.box.width - innerWidth) / 2, y: centre.y - sub.box.height / 2 + STEPS_CONTAINER_HEAD + STEPS_CONTAINER_PAD }
        const dx = corner.x - sub.layout.origin.x
        const dy = corner.y - sub.layout.origin.y
        for (const [childId, point] of sub.layout.positions) positions.set(childId, { x: point.x + dx, y: point.y + dy })
        for (const [childId, layer] of sub.layout.layers) layers.set(childId, layer)
        for (const [edgeId, route] of sub.layout.back) back.set(edgeId, { ...route, channel: route.channel + (direction === "TB" ? dy : dx) })
        for (const [childId, box] of sub.layout.boxes) allBoxes.set(childId, box)
    }
    return {
        positions,
        layers,
        ports,
        back,
        cardWidth,
        width: contentWidth + 2 * STEPS_MARGIN,
        height: contentHeight + 2 * STEPS_MARGIN,
        boxes: allBoxes,
        origin: { x: left, y: topEdge },
    }
}
