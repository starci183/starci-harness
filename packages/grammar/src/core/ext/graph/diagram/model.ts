/**
 * The Mermaid text of a lesson as the graph ext draws it (owner 2026-11-23: every diagram on the graph canvas): Mermaid is the parser only, and this file
 * turns the database its parser fills into plain data the canvas lays out. A flowchart and a state diagram become a graph (nodes, containers, edges) for
 * ELK; a sequence diagram becomes its participants and its rows in the order written (messages, notes and the rows that open, divide and close a block).
 * Every function here is pure over the parser's database, so the specs read the same mapping the browser draws.
 */

/** A tone a part of the drawing takes, in the Grammar's tokens: `danger` the faulty step, `success` the fix, `accent` a part the change touches. */
export type MermaidTone = "danger" | "success" | "accent"

export const MERMAID_TONES: readonly MermaidTone[] = ["danger", "success", "accent"]

/** The shape a node is drawn in. */
export type DiagramShape = "box" | "round" | "stadium" | "diamond" | "circle" | "cylinder" | "start" | "end" | "bar" | "note" | "container"

export interface DiagramNode {
    readonly id: string
    readonly label: string
    readonly shape: DiagramShape
    /** The container (a subgraph, a composite state) the node stands in. */
    readonly parentId?: string
    readonly tone?: MermaidTone
    /** A container that repeats its body (`class X foreach` on a subgraph): its frame is dashed, and the dashes mean "repeats". */
    readonly repeat?: boolean
}

export interface DiagramEdge {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly label?: string
    /** A dotted Mermaid link (`-.->`): drawn dashed. */
    readonly dashed: boolean
    /** A thick Mermaid link (`==>`): drawn heavier. */
    readonly thick: boolean
    /** The end of a loop's body, returning to the loop's decision (see `loopBackEdges`): drawn dashed, round the outside. */
    readonly back?: true
}

/** A flowchart or a state diagram as a graph, in the direction its source asked for (RL is drawn LR, BT is drawn TB). */
export interface DiagramGraph {
    readonly kind: "flowchart" | "state"
    readonly direction: "LR" | "TB"
    readonly nodes: readonly DiagramNode[]
    readonly edges: readonly DiagramEdge[]
}

export interface SequenceParticipant {
    readonly id: string
    readonly label: string
    readonly kind: "participant" | "actor"
}

/** How a message ends: an arrowhead, a cross (a lost message) or nothing (an open line). */
export type SequenceHead = "arrow" | "cross" | "open"

/** The kinds of block a sequence groups its rows in; `rect` is a plain highlight with no words. */
export type SequenceBlockKind = "loop" | "alt" | "opt" | "par" | "critical" | "break" | "rect"

export type SequenceRow =
    /** A message, counted from 1 among the messages in the order written (the place `messageTones` names). */
    | { readonly kind: "message"; readonly index: number; readonly from: string; readonly to: string; readonly text: string; readonly reply: boolean; readonly head: SequenceHead; readonly tone?: MermaidTone }
    /** A note: over one participant or across two (`from` to `to`), or beside one (`side`). */
    | { readonly kind: "note"; readonly from: string; readonly to: string; readonly side: "left" | "right" | "over"; readonly text: string }
    | { readonly kind: "open"; readonly block: number; readonly blockKind: SequenceBlockKind; readonly label: string }
    /** The divider of a block (`else`, `and`, `option`) with its words. */
    | { readonly kind: "section"; readonly block: number; readonly label: string }
    | { readonly kind: "close"; readonly block: number }

export interface SequenceModel {
    readonly kind: "sequence"
    readonly participants: readonly SequenceParticipant[]
    readonly rows: readonly SequenceRow[]
    /** `autonumber` in the source: the messages carry their numbers. */
    readonly numbered: boolean
}

/** The words of a Mermaid label as plain text: a `<br>` is a line break, any other tag and the markdown string quotes are dropped. */
export const plainLabel = (text: unknown): string =>
    (typeof text === "string" ? text : "")
        .replace(/<br\s*\/?>/giu, "\n")
        .replace(/<[^>]+>/gu, "")
        .replace(/^"?`([\s\S]*)`"?$/u, "$1")
        .replace(/#quot;/gu, "\"")
        .replace(/#amp;/gu, "&")
        .replace(/#lt;/gu, "<")
        .replace(/#gt;/gu, ">")
        .replace(/\*\*([^*]+)\*\*/gu, "$1")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .trim()

const toneOf = (id: string, classes: readonly string[], tones: Readonly<Record<string, MermaidTone>> | undefined): MermaidTone | undefined =>
    tones?.[id] ?? MERMAID_TONES.find((tone) => classes.includes(tone))

const direction = (given: string | undefined): "LR" | "TB" => (given === "LR" || given === "RL" ? "LR" : "TB")

/** The part of Mermaid's flowchart database the mapping reads. */
export interface FlowchartDb {
    readonly getVertices: () => ReadonlyMap<string, { readonly id: string; readonly text?: string; readonly type?: string; readonly classes?: readonly string[] }>
    readonly getEdges: () => readonly { readonly start: string; readonly end: string; readonly text?: string; readonly stroke?: string; readonly type?: string }[]
    readonly getSubGraphs: () => readonly { readonly id: string; readonly title?: string; readonly nodes: readonly string[]; readonly classes?: readonly string[] }[]
    readonly getDirection: () => string | undefined
}

const FLOW_SHAPES: Readonly<Record<string, DiagramShape>> = {
    square: "box",
    rect: "box",
    round: "round",
    stadium: "stadium",
    diamond: "diamond",
    circle: "circle",
    doublecircle: "circle",
    cylinder: "cylinder",
    // `F@{ shape: fork }` and `J@{ shape: join }`: the bars of a parallel (the same bar in a state diagram's `<<fork>>` and `<<join>>`).
    fork: "bar",
    join: "bar",
}

/**
 * The edges that close a loop: the end of a loop's body returning to its decision. A depth-first walk from the steps nothing leads into, links in the order
 * written; a link into a decision that is still being walked (one of its own ancestors) is the loop's back edge. Any other cycle is left to the layout.
 */
export const loopBackEdges = (nodes: readonly DiagramNode[], edges: readonly DiagramEdge[]): ReadonlySet<string> => {
    const diamond = new Set(nodes.filter((node) => node.shape === "diamond").map((node) => node.id))
    const out = new Map<string, DiagramEdge[]>()
    for (const edge of edges) if (edge.source !== edge.target) out.set(edge.source, [...(out.get(edge.source) ?? []), edge])
    const led = new Set(edges.filter((edge) => edge.source !== edge.target).map((edge) => edge.target))
    const back = new Set<string>()
    const walking = new Set<string>()
    const seen = new Set<string>()
    const visit = (id: string): void => {
        seen.add(id)
        walking.add(id)
        for (const edge of out.get(id) ?? []) {
            if (walking.has(edge.target)) {
                if (diamond.has(edge.target)) back.add(edge.id)
            } else if (!seen.has(edge.target)) visit(edge.target)
        }
        walking.delete(id)
    }
    for (const node of nodes) if (node.shape !== "container" && !led.has(node.id) && !seen.has(node.id)) visit(node.id)
    for (const node of nodes) if (node.shape !== "container" && !seen.has(node.id)) visit(node.id)
    return back
}

/**
 * A flowchart as a graph: each vertex a node in its shape (`[(db)]` a cylinder, `{x}` a decision, `((x))` a circle, `(x)` round, `([x])` a stadium,
 * anything else a rounded box), each subgraph a container its nodes stand in (the innermost one a node is listed in), each link an edge with its words,
 * a dotted link dashed. A node's tone is `tones[id]`, else a `class X danger|success|accent` the source gave it.
 */
export const flowchartGraph = (db: FlowchartDb, tones?: Readonly<Record<string, MermaidTone>>): DiagramGraph => {
    const subgraphs = db.getSubGraphs()
    const parent = new Map<string, string>()
    // Mermaid lists an inner subgraph before the one around it, and the outer one lists the inner one's nodes too: the first listing wins.
    for (const group of subgraphs) for (const member of group.nodes) if (member !== group.id && !parent.has(member)) parent.set(member, group.id)
    const groupIds = new Set(subgraphs.map((group) => group.id))
    const nodes: DiagramNode[] = []
    for (const group of subgraphs) {
        const at = parent.get(group.id)
        const tone = toneOf(group.id, group.classes ?? [], tones)
        const repeat = (group.classes ?? []).includes("foreach")
        nodes.push({ id: group.id, label: plainLabel(group.title ?? group.id), shape: "container", ...(at === undefined ? {} : { parentId: at }), ...(tone === undefined ? {} : { tone }), ...(repeat ? { repeat } : {}) })
    }
    for (const vertex of db.getVertices().values()) {
        if (groupIds.has(vertex.id)) continue
        const at = parent.get(vertex.id)
        const tone = toneOf(vertex.id, vertex.classes ?? [], tones)
        const shape = FLOW_SHAPES[vertex.type ?? ""] ?? "box"
        // A bar keeps the words its source wrote ("Song song"), never the id Mermaid falls back to.
        const label = shape === "bar" && (vertex.text === undefined || vertex.text === vertex.id) ? "" : plainLabel(vertex.text ?? vertex.id)
        nodes.push({ id: vertex.id, label, shape, ...(at === undefined ? {} : { parentId: at }), ...(tone === undefined ? {} : { tone }) })
    }
    const links = db.getEdges().map((edge, index): DiagramEdge => {
        const label = plainLabel(edge.text)
        return { id: `e${String(index + 1)}`, source: edge.start, target: edge.end, ...(label === "" ? {} : { label }), dashed: edge.stroke === "dotted", thick: edge.stroke === "thick" }
    })
    const loops = loopBackEdges(nodes, links)
    const edges = links.map((edge): DiagramEdge => (loops.has(edge.id) ? { ...edge, back: true } : edge))
    return { kind: "flowchart", direction: direction(db.getDirection()), nodes, edges }
}

/**
 * The boxes of a flowchart that branch without a decision: an ordinary node (not a `{…}` decision, not a subgraph) with two or more labelled edges out.
 * A branch is an if/else (owner 2026-11-23: "if else mới rẽ nhánh"), so it comes out of a decision whose words ask the condition (`{Price in the cache?}`),
 * one labelled edge per answer; edges that are always all taken carry no words, which go in the nodes. The renderer never invents the question: a
 * development build warns with these ids, and the author writes the decision.
 */
export const branchesWithoutDecision = (graph: DiagramGraph): readonly string[] => {
    if (graph.kind !== "flowchart") return []
    const labelled = new Map<string, number>()
    for (const edge of graph.edges) if (edge.label !== undefined && edge.source !== edge.target) labelled.set(edge.source, (labelled.get(edge.source) ?? 0) + 1)
    return graph.nodes.filter((node) => node.shape !== "diamond" && node.shape !== "container" && node.shape !== "bar" && (labelled.get(node.id) ?? 0) >= 2).map((node) => node.id)
}

/** The part of Mermaid's state database the mapping reads (`getData()`, the layout data Mermaid's own renderers take). */
export interface StateData {
    readonly nodes: readonly { readonly id: string; readonly label?: string; readonly description?: readonly string[] | string; readonly shape?: string; readonly isGroup?: boolean; readonly parentId?: string; readonly cssClasses?: string }[]
    readonly edges: readonly { readonly start: string; readonly end: string; readonly label?: string }[]
    readonly direction?: string
}

const STATE_SHAPES: Readonly<Record<string, DiagramShape>> = {
    stateStart: "start",
    stateEnd: "end",
    choice: "diamond",
    fork: "bar",
    join: "bar",
    note: "note",
    noteGroup: "container",
}

/**
 * A state diagram as a graph: a state a rounded box named by its description when it has one, `[*]` a start dot or an end ring, a composite state a
 * container, a choice a decision, a fork or join a bar, a note a soft pill; each transition an edge with its words. A state's tone is `tones[id]`, else
 * `class X danger|success|accent`.
 */
export const stateGraph = (data: StateData, tones?: Readonly<Record<string, MermaidTone>>): DiagramGraph => {
    const nodes = data.nodes.map((node): DiagramNode => {
        const shape: DiagramShape = node.isGroup === true ? "container" : (STATE_SHAPES[node.shape ?? ""] ?? "round")
        const classes = (node.cssClasses ?? "").split(/\s+/u)
        const description = Array.isArray(node.description) ? node.description.join("\n") : (node.description as string | undefined)
        const label = shape === "start" || shape === "end" || shape === "bar" ? "" : plainLabel(description !== undefined && description !== "" ? description : (node.label ?? node.id))
        const tone = toneOf(node.id, classes, tones)
        return { id: node.id, label, shape, ...(node.parentId === undefined ? {} : { parentId: node.parentId }), ...(tone === undefined ? {} : { tone }) }
    })
    const edges = data.edges.map((edge, index): DiagramEdge => {
        const label = plainLabel(edge.label)
        return { id: `e${String(index + 1)}`, source: edge.start, target: edge.end, ...(label === "" ? {} : { label }), dashed: false, thick: false }
    })
    return { kind: "state", direction: direction(data.direction), nodes, edges }
}

/** The part of Mermaid's sequence database the mapping reads. */
export interface SequenceDb {
    readonly getActors: () => ReadonlyMap<string, { readonly name: string; readonly description?: string; readonly type?: string }>
    readonly getMessages: () => readonly { readonly from?: string; readonly to?: string; readonly message?: unknown; readonly type?: number; readonly placement?: number }[]
    readonly LINETYPE: Readonly<Record<string, number>>
    readonly PLACEMENT: Readonly<Record<string, number>>
}

const BLOCK_OPENS: Readonly<Record<string, SequenceBlockKind>> = { LOOP_START: "loop", ALT_START: "alt", OPT_START: "opt", PAR_START: "par", PAR_OVER_START: "par", CRITICAL_START: "critical", BREAK_START: "break", RECT_START: "rect" }
const BLOCK_SECTIONS = new Set(["ALT_ELSE", "PAR_AND", "CRITICAL_OPTION"])
const BLOCK_CLOSES = new Set(["LOOP_END", "ALT_END", "OPT_END", "PAR_END", "CRITICAL_END", "BREAK_END", "RECT_END"])
const REPLIES = new Set(["DOTTED", "DOTTED_CROSS", "DOTTED_OPEN", "DOTTED_POINT", "BIDIRECTIONAL_DOTTED"])
const CROSSES = new Set(["SOLID_CROSS", "DOTTED_CROSS"])
const OPENS = new Set(["SOLID_OPEN", "DOTTED_OPEN"])

/**
 * A sequence diagram as its participants (in the order Mermaid met them) and its rows in the order written: each message with its place among the
 * messages (from 1), whether it is a reply (dashed) and its head; each note with the participants it spans; each block's opening, dividers and close.
 * A message's tone is `messageTones[index]`.
 */
export const sequenceModel = (db: SequenceDb, messageTones?: Readonly<Record<number, MermaidTone>>): SequenceModel => {
    const typeName = new Map(Object.entries(db.LINETYPE).map(([name, value]) => [value, name] as const))
    const participants = [...db.getActors().values()].map((actor): SequenceParticipant => ({ id: actor.name, label: plainLabel(actor.description ?? actor.name) || actor.name, kind: actor.type === "actor" ? "actor" : "participant" }))
    const known = new Set(participants.map((participant) => participant.id))
    const rows: SequenceRow[] = []
    const open: number[] = []
    let blocks = 0
    let index = 0
    let numbered = false
    for (const message of db.getMessages()) {
        const name = typeName.get(message.type ?? -1) ?? ""
        const text = plainLabel(message.message)
        if (name === "AUTONUMBER") {
            numbered = true
            continue
        }
        if (BLOCK_OPENS[name] !== undefined) {
            blocks += 1
            open.push(blocks)
            rows.push({ kind: "open", block: blocks, blockKind: BLOCK_OPENS[name], label: name === "RECT_START" ? "" : text })
            continue
        }
        if (BLOCK_SECTIONS.has(name)) {
            const block = open[open.length - 1]
            if (block !== undefined) rows.push({ kind: "section", block, label: text })
            continue
        }
        if (BLOCK_CLOSES.has(name)) {
            const block = open.pop()
            if (block !== undefined) rows.push({ kind: "close", block })
            continue
        }
        if (message.from === undefined || message.to === undefined || !known.has(message.from) || !known.has(message.to)) continue
        if (name === "NOTE") {
            const side = message.placement === db.PLACEMENT["LEFTOF"] ? "left" : message.placement === db.PLACEMENT["RIGHTOF"] ? "right" : "over"
            rows.push({ kind: "note", from: message.from, to: message.to, side, text })
            continue
        }
        if (name === "ACTIVE_START" || name === "ACTIVE_END") continue
        index += 1
        const tone = messageTones?.[index]
        rows.push({ kind: "message", index, from: message.from, to: message.to, text, reply: REPLIES.has(name), head: CROSSES.has(name) ? "cross" : OPENS.has(name) ? "open" : "arrow", ...(tone === undefined ? {} : { tone }) })
    }
    // A block the source never closed is closed at the end, so every field has a bottom.
    for (const block of open.reverse()) rows.push({ kind: "close", block })
    return { kind: "sequence", participants, rows, numbered }
}

/** The kinds the canvas lays out itself; any other Mermaid kind is Mermaid's own drawing placed on the canvas as one node. */
export type ParsedDiagram = DiagramGraph | SequenceModel | { readonly kind: "other"; readonly type: string }

/** What the parser hands over: Mermaid's own type name of the diagram and its database. */
export interface ParsedSource {
    readonly type: string
    readonly db: unknown
}

/** The drawing of a parsed source: a flowchart or a state diagram as a graph, a sequence as its rows, any other kind as Mermaid's own. */
export const diagramOf = (parsed: ParsedSource, tones?: Readonly<Record<string, MermaidTone>>, messageTones?: Readonly<Record<number, MermaidTone>>): ParsedDiagram => {
    const { type, db } = parsed
    if (type === "flowchart" || type === "flowchart-v2" || type === "graph") return flowchartGraph(db as FlowchartDb, tones)
    if (type === "stateDiagram" || type === "state") return stateGraph((db as { readonly getData: () => StateData }).getData(), tones)
    if (type === "sequence") return sequenceModel(db as SequenceDb, messageTones)
    return { kind: "other", type }
}

/** The name of a participant, by its id. */
const nameOf = (model: SequenceModel, id: string): string => model.participants.find((participant) => participant.id === id)?.label ?? id

/**
 * The text version of a drawing, for a screen reader, in the order a reader follows it: a graph's nodes (a container's members after it), then its links
 * (who to whom, with their words); a sequence's messages in order (who to whom: what), its notes where they stand.
 */
export const describeDiagram = (diagram: DiagramGraph | SequenceModel, to = "to"): { readonly items: readonly string[]; readonly links: readonly string[] } => {
    if (diagram.kind === "sequence") {
        const items = diagram.rows.flatMap((row) => {
            if (row.kind === "message") return [`${nameOf(diagram, row.from)} ${to} ${nameOf(diagram, row.to)}: ${row.text}`]
            if (row.kind === "note") return [`${row.from === row.to ? nameOf(diagram, row.from) : `${nameOf(diagram, row.from)}, ${nameOf(diagram, row.to)}`}: ${row.text}`]
            if (row.kind === "open" && row.label !== "") return [`${row.blockKind} ${row.label}`]
            if (row.kind === "section" && row.label !== "") return [row.label]
            return []
        })
        return { items, links: [] }
    }
    const label = new Map(diagram.nodes.map((node) => [node.id, node.label] as const))
    const name = (id: string): string => {
        const node = diagram.nodes.find((each) => each.id === id)
        if (node?.shape === "start") return "start"
        if (node?.shape === "end") return "end"
        return label.get(id) || id
    }
    const items = diagram.nodes.filter((node) => node.label !== "").map((node) => (node.parentId === undefined ? node.label : `${node.label} (${name(node.parentId)})`))
    const links = diagram.edges.map((edge) => `${name(edge.source)} ${to} ${name(edge.target)}${edge.label === undefined ? "" : `: ${edge.label}`}`)
    return { items, links }
}
