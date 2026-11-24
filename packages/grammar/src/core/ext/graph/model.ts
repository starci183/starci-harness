import { FLOW_NODE_HEIGHT, NODE_WIDTH, type Insets, type LayoutPort, type LinkEnds, type PortSide, type SizedNode } from "./layout.js"
import { edgeStyleOf, normalizeStatus, type EdgeStyle } from "./shared/status.js"
import type { FlowNode, FlowPort, FlowStatus, GraphDirection, GraphEdge } from "./types.js"

/** What a card draws beyond the 64px head: a row of chips, an agent row, a row of ports along the bottom (`TB`) or a column of them down the end side (`LR`). */
export const CHIP_ROW = 24
export const AGENT_ROW = 20
export const PORT_ROW_TB = 32
export const PORT_PITCH_LR = 28
/** A card with a column of ports down its end side (LR) is wider by that column. */
export const PORT_COLUMN = 96
export const DIAMOND_WIDTH = 176
export const DIAMOND_HEIGHT = 104
export const CONTAINER_HEAD = 48
export const CONTAINER_PAD = 24
/** A frame that holds a loop's back edge keeps a gutter on each side for the line and its label: the line is 40px in from the frame. */
export const BACK_GUTTER = 56
export const NOTE_ROW = 24
/** The pitch of the exits down a loop frame: room for a 22px label and a fixed gap; a port's y is where its edge leaves. */
export const EXIT_PITCH = 44

export interface ResolvedPort extends FlowPort {
    readonly side: PortSide
}

export interface ResolvedEdge {
    readonly id: string
    readonly edge: GraphEdge
    readonly style: EdgeStyle
    /** The port it leaves from, when it leaves from one. */
    readonly port: ResolvedPort | undefined
    /** An untaken branch of a decision: it carries the "skipped" words. */
    readonly branchSkipped: boolean
    /** The words on the line: its own label (a decision's port label too), and the skipped words of an untaken branch. */
    readonly pill: string | undefined
    /** Whether its ends are cards or diamonds, which have an entry port and a default exit port (a container has neither). */
    readonly sourceIsCard: boolean
    readonly targetIsCard: boolean
}

export interface FlowModel {
    readonly statuses: ReadonlyMap<string, FlowStatus>
    readonly ports: ReadonlyMap<string, readonly ResolvedPort[]>
    /** The container each child sits in. */
    readonly parents: ReadonlyMap<string, string>
    readonly sizes: readonly SizedNode[]
    /** The edges the layout routes, with the words each carries (a back edge goes round the others in a lane of its own). */
    readonly links: readonly (LinkEnds & { readonly id: string })[]
    readonly edges: readonly ResolvedEdge[]
}

export const isDiamond = (node: FlowNode): boolean => node.shape === "diamond" && node.container === undefined

const isBranch = (node: FlowNode): boolean => node.kind === "condition" || isDiamond(node)
/** A diamond leaves through its vertices: the main branch straight on in the flow (the end vertex), the others turning to the side (owner: "Chốt", the routing law). */
const DIAMOND_SIDES: Readonly<Record<GraphDirection, readonly PortSide[]>> = {
    LR: ["EAST", "SOUTH", "NORTH"],
    TB: ["SOUTH", "EAST", "WEST"],
}

/** The side the n-th port of a node sits on. */
/** The ports every card and diamond has besides its outputs: the one an edge enters by, and the one an edge with no named port leaves by. */
export const IN_PORT = "\u0001in"
export const OUT_PORT = "\u0001out"

export const portSide = (diamond: boolean, direction: GraphDirection, index: number): PortSide => {
    if (diamond) return DIAMOND_SIDES[direction][index] ?? DIAMOND_SIDES[direction][0] ?? "EAST"
    return direction === "LR" ? "EAST" : "SOUTH"
}

/** The side a node is entered from. */
export const entrySide = (direction: GraphDirection): PortSide => (direction === "LR" ? "WEST" : "NORTH")

/** Where the i-th of n ports of a card or a diamond sits on its node, which draws it there (ELK is told, so the edge leaves from it). */
export const portAt = (side: PortSide, diamond: boolean, index: number, count: number, width: number, height: number): { readonly x: number; readonly y: number } => {
    if (side === "EAST") return { x: width, y: diamond ? height / 2 : 8 + ((index + 0.5) * (height - 16)) / count }
    if (side === "SOUTH") return { x: diamond ? width / 2 : ((index + 0.5) * width) / count, y: height }
    if (side === "NORTH") return { x: width / 2, y: 0 }
    return { x: 0, y: height / 2 }
}

const withSides = (ports: readonly FlowPort[], diamond: boolean, direction: GraphDirection): ResolvedPort[] =>
    ports.map((port, index) => ({ ...port, side: portSide(diamond, direction, index) }))

/** The width of a card: the fixed one, and the port column when its ports stand down its end side. */
export const cardWidth = (portCount: number, direction: GraphDirection): number => (portCount > 0 && direction === "LR" ? NODE_WIDTH + PORT_COLUMN : NODE_WIDTH)

/** The height of a card with its chips, agent and ports. */
export const cardHeight = (node: FlowNode, portCount: number, direction: GraphDirection): number => {
    let height = FLOW_NODE_HEIGHT + (node.chips !== undefined && node.chips.length > 0 ? CHIP_ROW : 0) + (node.agent !== undefined || node.agentName !== undefined ? AGENT_ROW : 0)
    if (portCount > 0) height = direction === "TB" ? height + PORT_ROW_TB : Math.max(height, portCount * PORT_PITCH_LR + 16)
    return height
}

/** The room a frame keeps round its children: its header on top and its note at the bottom. An exit has no pill: its words are the label of its edge, outside the frame. */
const containerInsets = (node: FlowNode, hasBack: boolean): Insets => {
    return {
        top: CONTAINER_HEAD,
        left: CONTAINER_PAD + (hasBack ? BACK_GUTTER : 0),
        right: CONTAINER_PAD + (hasBack ? BACK_GUTTER : 0),
        bottom: CONTAINER_PAD + (node.container?.note === undefined ? 0 : NOTE_ROW),
    }
}

/** The least box of a container: its header and padding, and room for its exits on the end edge. */
const containerMinimum = (node: FlowNode, direction: GraphDirection, hasBack: boolean): { readonly width: number; readonly height: number } => {
    const insets = containerInsets(node, hasBack)
    const exits = node.container?.exits?.length ?? 0
    return {
        width: direction === "TB" ? Math.max(NODE_WIDTH, exits * 112 + 32) : NODE_WIDTH,
        height: Math.max(insets.top + insets.bottom + 64, direction === "LR" ? insets.top + exits * PORT_PITCH_LR + 16 : 0),
    }
}

/**
 * What the graph needs of its nodes and edges before it can be laid out and drawn: the status of each node, the output ports (declared, or the labels of a
 * branch's edges), which container holds which node, the size of each box, and each edge with its port, its style and whether it is an untaken branch.
 * An edge is drawn from the run unless it names a variant: it flows while its source runs, waits while its source waits, and when a branch has a taken
 * edge the others (with no variant of their own) are `skipped`.
 */
export const resolveFlow = (nodes: readonly FlowNode[], edges: readonly GraphEdge[], direction: GraphDirection, skippedLabel?: string): FlowModel => {
    const known = new Set(nodes.map((node) => node.id))
    // A node that says what it waits for is waiting, not running.
    const own = (node: FlowNode): FlowStatus => {
        const status = normalizeStatus(node.status)
        return status === "running" && node.wait !== undefined ? "wait" : status
    }
    const statuses = new Map(nodes.map((node) => [node.id, own(node)] as const))
    const byId = new Map(nodes.map((node) => [node.id, node] as const))
    const usable = edges.filter((edge) => known.has(edge.source) && known.has(edge.target))
    const parents = new Map<string, string>()
    for (const node of nodes) {
        if (node.container === undefined) continue
        for (const child of node.container.childIds) if (known.has(child) && child !== node.id && !parents.has(child)) parents.set(child, node.id)
    }

    // A container that holds the whole of a back edge keeps a gutter for it.
    const backIn = new Set<string>()
    for (const edge of usable) {
        const parent = parents.get(edge.source)
        if (edge.variant === "back" && parent !== undefined && parent === parents.get(edge.target)) backIn.add(parent)
    }
    const hasRun = nodes.some((node) => node.status !== undefined)

    // A container is what its children are, in this order: error, running, wait, done (all of them), in progress (some done), skipped (all), not run.
    const depthOf = (id: string): number => {
        let n = 0
        for (let at = parents.get(id); at !== undefined; at = parents.get(at)) n += 1
        return n
    }
    for (const node of [...nodes].filter((candidate) => candidate.container !== undefined).sort((a, b) => depthOf(b.id) - depthOf(a.id))) {
        const kids = [...parents].filter(([, parent]) => parent === node.id).map(([child]) => statuses.get(child) ?? "todo")
        const has = (status: FlowStatus): boolean => kids.includes(status)
        const derived: FlowStatus = has("error")
            ? "error"
            : has("running")
              ? "running"
              : has("wait")
                ? "wait"
                : kids.length > 0 && kids.every((kid) => kid === "done" || kid === "skipped") && has("done")
                  ? "done"
                  : has("done")
                    ? "running"
                    : kids.length > 0 && kids.every((kid) => kid === "skipped")
                      ? "skipped"
                      : "todo"
        if (derived !== "todo") statuses.set(node.id, derived)
    }

    const ports = new Map<string, readonly ResolvedPort[]>()
    for (const node of nodes) {
        const diamond = isDiamond(node)
        if (node.container !== undefined) {
            if (node.container.exits !== undefined && node.container.exits.length > 0) ports.set(node.id, withSides(node.container.exits, false, direction))
            continue
        }
        if (node.outputs !== undefined && node.outputs.length > 0) ports.set(node.id, withSides(node.outputs, diamond, direction))
        else if (isBranch(node)) {
            const labels: FlowPort[] = []
            for (const edge of usable) {
                if (edge.source !== node.id || edge.variant === "back" || edge.label === undefined || edge.label === "") continue
                if (!labels.some((port) => port.id === edge.label)) labels.push({ id: edge.label, label: edge.label })
            }
            if (labels.length > 0) ports.set(node.id, withSides(labels, diamond, direction))
        }
    }

    const sizes: SizedNode[] = nodes.map((node) => {
        const own = ports.get(node.id) ?? []
        const parentId = parents.get(node.id)
        const place = parentId === undefined ? {} : { parentId }
        const fixed = (width: number, height: number, diamond: boolean): readonly LayoutPort[] => [
            { id: IN_PORT, side: entrySide(direction), at: portAt(entrySide(direction), true, 0, 1, width, height) },
            ...(own.length === 0 ? [{ id: OUT_PORT, side: portSide(false, direction, 0), at: portAt(portSide(false, direction, 0), true, 0, 1, width, height) }] : []),
            ...own.map((port, index) => ({ id: port.id, side: port.side, at: portAt(port.side, diamond, index, own.length, width, height) })),
        ]
        if (node.container !== undefined) return { id: node.id, ...containerMinimum(node, direction, backIn.has(node.id)), insets: containerInsets(node, backIn.has(node.id)), ports: own.map((port, index) => ({ id: port.id, side: port.side, ...(direction === "LR" ? { at: { x: 0, y: CONTAINER_HEAD + 4 + index * EXIT_PITCH + EXIT_PITCH / 3 } } : {}) })), ...place }
        if (isDiamond(node)) return { id: node.id, width: DIAMOND_WIDTH, height: DIAMOND_HEIGHT, ports: fixed(DIAMOND_WIDTH, DIAMOND_HEIGHT, true), ...place }
        const width = cardWidth(own.length, direction)
        const height = cardHeight(node, own.length, direction)
        return { id: node.id, width, height, ports: fixed(width, height, false), ...place }
    })

    const taken = new Set<string>()
    const started = (id: string): boolean => ["done", "running", "wait", "error"].includes(statuses.get(id) ?? "todo")
    const derivedTaken = (edge: GraphEdge): boolean => edge.variant === undefined && hasRun && statuses.get(edge.source) === "done" && started(edge.target)
    for (const edge of usable) if (edge.variant === "taken" || derivedTaken(edge)) taken.add(edge.source)

    const counted = new Map<string, number>()
    const resolved: ResolvedEdge[] = []
    for (const edge of usable) {
        const base = edge.id ?? `${edge.source}->${edge.target}`
        const count = counted.get(base) ?? 0
        counted.set(base, count + 1)
        const id = count === 0 ? base : `${base}#${String(count)}`
        const source = byId.get(edge.source)
        const own = ports.get(edge.source) ?? []
        const asked = edge.sourcePort ?? (source !== undefined && isBranch(source) ? edge.label : undefined)
        const port = edge.variant === "back" || asked === undefined ? undefined : (own.find((candidate) => candidate.id === asked) ?? own.find((candidate) => candidate.label === asked))
        const sourceIsBranch = source !== undefined && (isBranch(source) || own.length > 1)
        const branchSkipped = edge.variant === "skipped" ? true : edge.variant === undefined && sourceIsBranch && taken.has(edge.source) && !derivedTaken(edge)
        const targetSkipped = edge.variant === undefined && statuses.get(edge.target) === "skipped"
        const variant = edge.variant ?? (branchSkipped || targetSkipped ? "skipped" : undefined)
        // A decision's branch is named at the start of its edge; a card's port names its own branch inside the card.
        const own_label = port === undefined ? edge.label : source !== undefined && (isDiamond(source) || source.container !== undefined) ? port.label : undefined
        const words = [own_label, branchSkipped ? skippedLabel : undefined].filter((part): part is string => part !== undefined && part !== "")
        resolved.push({ id, edge, style: edgeStyleOf(variant, statuses.get(edge.source), statuses.get(edge.target), hasRun), port, branchSkipped, pill: words.length === 0 ? undefined : words.join(" \u00b7 "), sourceIsCard: source?.container === undefined, targetIsCard: byId.get(edge.target)?.container === undefined })
    }
    const links = resolved.map((item) => ({
        id: item.id,
        source: item.edge.source,
        target: item.edge.target,
        ...(item.port === undefined ? (item.sourceIsCard ? { sourcePort: OUT_PORT } : {}) : { sourcePort: item.port.id }),
        ...(item.targetIsCard ? { targetPort: IN_PORT } : {}),
        ...(item.pill === undefined ? {} : { label: item.pill, labelAt: "TAIL" as const }),
        ...(item.edge.variant === "back" ? { back: true } : {}),
    }))
    return { statuses, ports, parents, sizes, links, edges: resolved }
}
