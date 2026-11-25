"use client"

import { Background, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeProps, type NodeTypes } from "@xyflow/react"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react"
import { Alert, FencedCodeBlock, Skeleton, Text } from "../../../index.js"
import type { NoChildren } from "../../../tier.js"
import type { FlowLayout, SizedNode } from "../layout.js"
import { measureLabel } from "../shared/canvas.js"
import { StepEdge } from "../shared/StepEdge.js"
import { edgeClassName } from "../shared/status.js"
import { ZoomButtons } from "../shared/zoom.js"
import { STYLE_RANK, dedupeRuns } from "../shared/overlap.js"
import { PHONE_LAYOUT_WIDTH } from "../shared/phone.js"
import type { StepEdgeData } from "../build.js"
import { branchesWithoutDecision, describeDiagram, type DiagramEdge, type DiagramGraph, type DiagramNode, type MermaidTone, type ParsedDiagram, type SequenceModel, type SequenceRow } from "./model.js"
import { INSETS, canvasHeight, needsTopDown, openFloor, openView, type Box } from "./open.js"
import { parseDiagram, renderSvg, svgNode } from "./mermaid.js"
import { layoutDiagram } from "./graph.js"
import { layoutSequence, type Rect, type SequenceLayout } from "./sequence.js"
import { resolveMermaidTheme } from "./theme.js"

/** The least height of the canvas, kept by the loading, ready and error states alike: `sm` 16rem, `md` 24rem, `lg` 32rem. */
export type MermaidDiagramHeight = "sm" | "md" | "lg"

/** The words of the canvas, in the app's language. */
export interface MermaidDiagramLabels {
    readonly zoomIn: string
    readonly zoomOut: string
    readonly fit: string
    readonly reset: string
    /** How the text version names a state diagram's start and end marks. */
    readonly start: string
    readonly end: string
    /** How the text version joins the two ends of a link or a message ("Alice to Bob: hi"). */
    readonly to: string
}

export type { MermaidTone } from "./model.js"

/** One row of a diagram's legend: a short line in the tone and the words saying what that line is ("Read path"). */
export interface MermaidLegendItem {
    readonly tone: MermaidTone
    readonly label: string
}

export type MermaidDiagramProps = NoChildren & {
    /** The Mermaid text, as written in the article's fence (without the fence itself). */
    readonly source: string
    /** Names the diagram for assistive technology, e.g. "Request flow": the canvas region and the drawing take it. */
    readonly label: string
    /**
     * The least height of the canvas, kept by the loading, ready and error states alike so the page does not jump when the drawing arrives. A taller
     * drawing grows the canvas up to 45rem; the first view fits the whole drawing when it stays readable (caption-role words at 11px or more, zoom 0.85), else fits its width when that stays readable (a tall drawing pans down), else a flowchart or state diagram too wide to read across is laid out top-down, and what still does not fit opens at that zoom from the drawing's start and the reader pans and zooms. Default `sm`.
     */
    readonly height?: MermaidDiagramHeight
    /** The error title shown in the region when the source cannot be drawn; the source follows it as code. */
    readonly errorTitle?: string
    /** Accessible name of the source code block in the error state. Default: `${label} source`. */
    readonly sourceLabel?: string
    /** Unresolved source (STATE-8): the frame at its height with a Skeleton block, Mermaid not loaded, `aria-busy`. */
    readonly isLoading?: boolean
    /**
     * The tone of a flowchart node or a state, by its id (`{ B: "danger", C: "success" }`). The source may say the same with Mermaid's own
     * `class B danger` (a `classDef` is optional and its colours are ignored): either way the node is painted in the tone's soft pair and edge.
     */
    readonly tones?: Readonly<Record<string, MermaidTone>>
    /** The tone of a sequence diagram's message, by its place among the messages counted from 1 (`{ 5: "danger" }`): its line, head and words. */
    readonly messageTones?: Readonly<Record<number, MermaidTone>>
    /**
     * The tone of a flowchart's edge, by its place among the links counted from 1 (`{ 2: "info", 4: "accent" }`): its line, arrowhead and words. The
     * source may say the same with Mermaid's own edge ids: `A e1@--> B`, then `class e1 info`. The map wins.
     */
    readonly edgeTones?: Readonly<Record<number, MermaidTone>>
    /** What each edge tone means, drawn as a row under the drawing (above the caption): a short line in the tone and its words. */
    readonly legend?: ReadonlyArray<MermaidLegendItem>
    /**
     * What to draw for each icon name a node of the source names with Mermaid's own `R@{ icon: "redis" }` (the app passes small logo images): drawn
     * before the node's words at the height of one line, the node widened for it. A name the map lacks draws nothing and takes no room.
     */
    readonly icons?: Readonly<Record<string, ReactNode>>
    /** One line under the drawing, in the caption role, saying what to look at. */
    readonly caption?: string
    /** The canvas's words (zoom controls, the text version's start and end), English defaults. */
    readonly labels?: Partial<MermaidDiagramLabels>
}

const isProduction = (): boolean => typeof process !== "undefined" && process.env.NODE_ENV === "production"

const LABELS: MermaidDiagramLabels = { zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to frame", reset: "Reset view", start: "start", end: "end", to: "to" }

/** The reserved box of each height step. */
const RESERVED: Readonly<Record<MermaidDiagramHeight, number>> = { sm: 256, md: 384, lg: 512 }
const PAN_STEP = 48
const px = (n: number): `${number}px` => `${String(n)}px` as `${number}px`
/** The fit button: the whole drawing, clear of the controls row. */
const FIT_OPTIONS = { padding: { top: px(INSETS.top), right: px(INSETS.right), bottom: px(INSETS.bottom), left: px(INSETS.left) }, minZoom: 0.2, maxZoom: 1.5 } as const

/* ---------------------------------------------------------------- sizes */

/** The width of one line of words at the canvas's label size (the measure the edge words use, without their padding). */
const textWidth = (text: string): number => Math.ceil((measureLabel(text).width - 20) * 1.06)

/* ---------------------------------------------------------------- the drawings */

interface ShapeData extends Record<string, unknown> {
    node: DiagramNode
    /** What the app draws for the node's icon, before its words. */
    icon?: ReactNode
    width: number
    height: number
    direction: "LR" | "TB"
}

type Drawn =
    | { readonly kind: "graph"; readonly graph: DiagramGraph; readonly layout: FlowLayout; readonly sizes: readonly SizedNode[]; readonly entry?: Box; readonly width: number; readonly height: number }
    | { readonly kind: "sequence"; readonly model: SequenceModel; readonly layout: SequenceLayout; readonly width: number; readonly height: number }
    | { readonly kind: "other"; readonly type: string; readonly svg: string; readonly width: number; readonly height: number }

type Drawing = { readonly status: "loading" } | { readonly status: "ready"; readonly drawn: Drawn } | { readonly status: "error"; readonly message: string }

const handles = (direction: "LR" | "TB"): ReactElement[] => [
    <Handle key="in" id="in" type="target" isConnectable={false} position={direction === "LR" ? Position.Left : Position.Top} className="starci-graph-handle" />,
    <Handle key="out" id="out" type="source" isConnectable={false} position={direction === "LR" ? Position.Right : Position.Bottom} className="starci-graph-handle" />,
]

const toneProps = (tone: MermaidTone | undefined): Record<string, string> => (tone === undefined ? {} : { "data-tone": tone })

/** A node of a flowchart or a state diagram in its shape: the words centred, the shape drawn from the tokens. */
const ShapeNode = ({ data }: NodeProps<Node<ShapeData>>): ReactElement => {
    const { node, icon, width, height, direction } = data
    // A bar is the mark of a parallel: its words (a fork's "Song song") stand beside it, never in it.
    const text = node.label === "" ? null : <span className={node.shape === "bar" ? "starci-graph-diagram-bar-words" : "starci-graph-diagram-words"}>{node.label}</span>
    // An icon stands before the words, one line high; the text version names the node by its words alone.
    const words =
        icon === undefined || icon === null ? (
            text
        ) : (
            <span className="starci-graph-diagram-labelled">
                <span className="starci-graph-diagram-icon" aria-hidden="true">
                    {icon}
                </span>
                {text}
            </span>
        )
    const outline =
        node.shape === "diamond" ? (
            <svg className="starci-graph-diagram-outline" viewBox={`0 0 ${String(width)} ${String(height)}`} aria-hidden="true">
                <polygon points={`${String(width / 2)},1 ${String(width - 1)},${String(height / 2)} ${String(width / 2)},${String(height - 1)} 1,${String(height / 2)}`} />
            </svg>
        ) : node.shape === "cylinder" ? (
            <svg className="starci-graph-diagram-outline" viewBox={`0 0 ${String(width)} ${String(height)}`} aria-hidden="true">
                <path d={`M1 9 A${String(width / 2 - 1)} 8 0 0 1 ${String(width - 1)} 9 V${String(height - 9)} A${String(width / 2 - 1)} 8 0 0 1 1 ${String(height - 9)} Z`} />
                <path className="starci-graph-diagram-rim" d={`M1 9 A${String(width / 2 - 1)} 8 0 0 0 ${String(width - 1)} 9`} />
            </svg>
        ) : null
    return (
        <div className="starci-graph-diagram-node" data-shape={node.shape} data-direction={node.shape === "bar" ? direction : undefined} {...toneProps(node.tone)} style={{ inlineSize: width, blockSize: height }}>
            {outline}
            {handles(direction)}
            {words}
        </div>
    )
}

/** A subgraph or a composite state: a quiet tinted field, its name in its top corner. */
const GroupNode = ({ data }: NodeProps<Node<ShapeData>>): ReactElement => (
    <div className="starci-graph-diagram-group" data-repeat={data.node.repeat === true ? "true" : undefined} {...toneProps(data.node.tone)} style={{ inlineSize: data.width, blockSize: data.height }}>
        {handles(data.direction)}
        <span className="starci-graph-diagram-group-label">{data.node.label}</span>
    </div>
)

interface PartData extends Record<string, unknown> {
    label: string
    width: number
    height: number
    kind?: string
    tone?: MermaidTone
    sections?: readonly { readonly y: number; readonly label: string }[]
    actor?: boolean
}

/** A participant's header. */
const ParticipantNode = ({ data }: NodeProps<Node<PartData>>): ReactElement => (
    <div className="starci-graph-diagram-node starci-graph-diagram-participant" data-shape="box" data-actor={data.actor === true ? "true" : undefined} style={{ inlineSize: data.width, blockSize: data.height }}>
        <span className="starci-graph-diagram-words">{data.label}</span>
    </div>
)

/** A lifeline: a dashed muted line down from its header. */
const LifelineNode = ({ data }: NodeProps<Node<PartData>>): ReactElement => <div className="starci-graph-diagram-lifeline" style={{ blockSize: data.height }} />

/** The point of a lifeline a message leaves or reaches. */
const AnchorNode = (): ReactElement => (
    <div className="starci-graph-diagram-anchor">
        <Handle id="a" type="source" isConnectable={false} position={Position.Right} className="starci-graph-handle starci-graph-handle-center" />
        <Handle id="b" type="target" isConnectable={false} position={Position.Left} className="starci-graph-handle starci-graph-handle-center" />
    </div>
)

/** A note: a soft accent pill. */
const NoteNode = ({ data }: NodeProps<Node<PartData>>): ReactElement => (
    <div className="starci-graph-diagram-note" style={{ inlineSize: data.width, blockSize: data.height }}>
        <span className="starci-graph-diagram-words">{data.label}</span>
    </div>
)

/** A block (alt, loop, opt, par, ...): a tinted field round its rows, its kind and words in the corner, a dashed divider per section. */
const FieldNode = ({ data }: NodeProps<Node<PartData>>): ReactElement => (
    <div className="starci-graph-diagram-field" data-kind={data.kind} style={{ inlineSize: data.width, blockSize: data.height }}>
        {data.kind === "rect" ? null : (
            <span className="starci-graph-diagram-field-head">
                <span className="starci-graph-diagram-field-kind">{data.kind}</span>
                {data.label === "" ? null : <span className="starci-graph-diagram-field-label">{data.label}</span>}
            </span>
        )}
        {(data.sections ?? []).map((section) => (
            <span key={`${String(section.y)}-${section.label}`} className="starci-graph-diagram-field-section" style={{ insetBlockStart: section.y }}>
                {section.label === "" ? null : <span className="starci-graph-diagram-field-label">{section.label}</span>}
            </span>
        ))}
    </div>
)

/** Mermaid's own drawing of a kind the canvas does not lay out, as one node. */
const SvgNode = ({ data }: NodeProps<Node<PartData & { svg: string }>>): ReactElement => {
    const host = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        const placed = svgNode(data.svg)
        if (placed !== null) host.current?.replaceChildren(placed.node)
    }, [data.svg])
    return <div ref={host} className="starci-graph-diagram-svg" style={{ inlineSize: data.width, blockSize: data.height }} />
}

interface MessageData extends Record<string, unknown> {
    row: Extract<SequenceRow, { readonly kind: "message" }>
    x1: number
    x2: number
    y: number
    y2: number
    self: boolean
    text: Rect
    numbered: boolean
}

/** The arrowhead of every graph edge: 10 long, 10 across, open (StepEdge's), at the target only. */
const HEAD = 10

/** A message: a line between its two anchors (a reply dashed), its head, and its words over it; a self-message a loop to the right. */
const MessageEdge = ({ id, data }: EdgeProps<Edge<MessageData>>): ReactElement | null => {
    if (data === undefined) return null
    const { row, x1, x2, y, y2, self, text, numbered } = data
    const toward = self ? -1 : Math.sign(x2 - x1) || 1
    const endX = self ? x1 : x2
    const endY = self ? y2 : y
    const stop = row.head === "arrow" ? endX - toward * HEAD : endX
    const loopX = x1 + 36
    const path = self ? `M${String(x1)} ${String(y)}H${String(loopX - 8)}Q${String(loopX)} ${String(y)} ${String(loopX)} ${String(y + 8)}V${String(y2 - 8)}Q${String(loopX)} ${String(y2)} ${String(loopX - 8)} ${String(y2)}H${String(stop)}` : `M${String(x1)} ${String(y)}H${String(stop)}`
    const head =
        row.head === "arrow" ? (
            <path className="starci-graph-diagram-head" d={`M${String(endX)} ${String(endY)}L${String(endX - toward * HEAD)} ${String(endY - HEAD / 2)}L${String(endX - toward * HEAD)} ${String(endY + HEAD / 2)}Z`} />
        ) : row.head === "cross" ? (
            <path className="starci-graph-diagram-cross" d={`M${String(endX - 5)} ${String(endY - 5)}L${String(endX + 5)} ${String(endY + 5)}M${String(endX + 5)} ${String(endY - 5)}L${String(endX - 5)} ${String(endY + 5)}`} />
        ) : null
    return (
        <g className="starci-graph-diagram-message" data-reply={row.reply ? "true" : undefined} {...toneProps(row.tone)} data-message={row.index}>
            <path className="starci-graph-diagram-message-line" d={path} />
            {head}
            <EdgeLabelRenderer>
                <span
                    className="starci-graph-diagram-message-text"
                    data-edge={id}
                    data-self={self ? "true" : undefined}
                    {...toneProps(row.tone)}
                    style={{ transform: `translate(${String(text.x)}px, ${String(text.y)}px)`, minInlineSize: text.width }}
                >
                    {numbered ? <span className="starci-graph-diagram-message-number">{row.index}</span> : null}
                    {row.text}
                </span>
            </EdgeLabelRenderer>
        </g>
    )
}

const NODE_TYPES: NodeTypes = {
    "mermaid-shape": ShapeNode,
    "mermaid-group": GroupNode,
    "mermaid-participant": ParticipantNode,
    "mermaid-lifeline": LifelineNode,
    "mermaid-anchor": AnchorNode,
    "mermaid-note": NoteNode,
    "mermaid-field": FieldNode,
    "mermaid-svg": SvgNode,
}
const EDGE_TYPES: EdgeTypes = { step: StepEdge, "mermaid-message": MessageEdge }

const still = { draggable: false, connectable: false, selectable: false, focusable: false } as const

/** The nodes parents first: xyflow wants a container before the nodes inside it. */
const parentsFirst = (nodes: readonly DiagramNode[]): readonly DiagramNode[] => {
    const parent = new Map(nodes.flatMap((node) => (node.parentId === undefined ? [] : [[node.id, node.parentId] as const])))
    const depth = (id: string): number => {
        let n = 0
        for (let at = parent.get(id); at !== undefined && n < nodes.length; at = parent.get(at)) n += 1
        return n
    }
    return [...nodes].sort((a, b) => depth(a.id) - depth(b.id))
}

/** A loop's back edge and an author's dotted link are dashed (dashes mean something); every other edge is plain. */
const edgeStyle = (edge: DiagramEdge): "back" | "fallback" | "plain" => (edge.back === true ? "back" : edge.dashed ? "fallback" : "plain")

/**
 * The xyflow nodes and edges of a laid-out graph: shapes and containers where ELK put them, edges on ELK's routes with their words as pills. Every edge is
 * its own line (owner 2026-11-24: separate, coloured edges, no merge points): the layout gives each its own exit and entry, no route is cut back to
 * another's line, so no edge draws a junction dot and each keeps its arrowhead; a middle run in another's corridor still moves aside.
 */
const graphElements = (drawn: Extract<Drawn, { readonly kind: "graph" }>, icons: Readonly<Record<string, ReactNode>> | undefined): { readonly nodes: Node[]; readonly edges: Edge[] } => {
    const { graph, layout, sizes } = drawn
    const size = new Map(sizes.map((each) => [each.id, each] as const))
    const nodes = parentsFirst(graph.nodes).map((node): Node => {
        const box = layout.boxes[node.id]
        const own = size.get(node.id)
        const isGroup = node.shape === "container"
        const width = isGroup ? (box?.width ?? own?.width ?? 120) : (own?.width ?? 80)
        const height = isGroup ? (box?.height ?? own?.height ?? 40) : (own?.height ?? 40)
        const icon = node.icon === undefined ? undefined : icons?.[node.icon]
        const data: ShapeData = { node, ...(icon === undefined ? {} : { icon }), width, height, direction: graph.direction }
        return {
            id: node.id,
            type: isGroup ? "mermaid-group" : "mermaid-shape",
            position: layout.positions[node.id] ?? { x: 0, y: 0 },
            data,
            width,
            height,
            zIndex: isGroup ? 0 : 1,
            ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
            ...still,
        }
    })
    // No two edges in one corridor (the routing law, rule 6), and none cut back to another's line: a middle run in a corridor moves aside.
    const once = dedupeRuns(
        graph.edges.flatMap((edge) => {
            const route = layout.routes[edge.id]
            return route === undefined ? [] : [{ id: edge.id, points: route.points, rank: STYLE_RANK[edgeStyle(edge)] ?? 3 }]
        }),
        { join: false },
    )
    const edges = graph.edges.map((edge): Edge => {
        const style = edgeStyle(edge)
        const route = layout.routes[edge.id]
        const drawn = once.get(edge.id)
        const data: StepEdgeData = { style, pill: edge.label, dangerPort: false, dimmed: false, route: route === undefined || drawn === undefined ? route : { ...route, points: drawn.points }, joinStart: false, joinEnd: false, ...(edge.tone === undefined ? {} : { pillTone: edge.tone }) }
        const className = `${edgeClassName(style)}${edge.thick ? " starci-graph-diagram-edge--thick" : ""}${edge.tone === undefined ? "" : ` starci-graph-diagram-edge--${edge.tone}`}`
        return { id: edge.id, source: edge.source, target: edge.target, type: "step", sourceHandle: "out", targetHandle: "in", className, zIndex: 2, data, ...still }
    })
    return { nodes, edges }
}

/** The xyflow nodes and edges of a laid-out sequence: headers, lifelines, a pair of anchors and an edge per message, notes and block fields. */
const sequenceElements = (drawn: Extract<Drawn, { readonly kind: "sequence" }>): { readonly nodes: Node[]; readonly edges: Edge[] } => {
    const { layout, model } = drawn
    const nodes: Node[] = []
    for (const field of layout.fields) {
        const data: PartData = { label: field.label, width: field.box.width, height: field.box.height, kind: field.kind, sections: field.sections.map((section) => ({ ...section, y: section.y - field.box.y })) }
        nodes.push({ id: `f${String(field.block)}`, type: "mermaid-field", position: { x: field.box.x, y: field.box.y }, data, width: field.box.width, height: field.box.height, zIndex: field.depth, ...still })
    }
    for (const participant of layout.participants) {
        nodes.push({ id: `l:${participant.id}`, type: "mermaid-lifeline", position: { x: participant.x, y: layout.lifelineTop }, data: { label: "", width: 1, height: layout.lifelineEnd - layout.lifelineTop }, width: 1, height: layout.lifelineEnd - layout.lifelineTop, zIndex: 4, ...still })
        nodes.push({ id: `p:${participant.id}`, type: "mermaid-participant", position: { x: participant.box.x, y: participant.box.y }, data: { label: participant.label, width: participant.box.width, height: participant.box.height, actor: participant.kind === "actor" }, width: participant.box.width, height: participant.box.height, zIndex: 6, ...still })
    }
    const edges: Edge[] = []
    for (const message of layout.messages) {
        const at = `m${String(message.row.index)}`
        nodes.push({ id: `${at}:a`, type: "mermaid-anchor", position: { x: message.x1, y: message.y }, data: {}, width: 1, height: 1, zIndex: 5, ...still })
        nodes.push({ id: `${at}:b`, type: "mermaid-anchor", position: { x: message.self ? message.x1 : message.x2, y: message.y2 }, data: {}, width: 1, height: 1, zIndex: 5, ...still })
        const data: MessageData = { row: message.row, x1: message.x1, x2: message.x2, y: message.y, y2: message.y2, self: message.self, text: message.text, numbered: model.numbered }
        edges.push({ id: at, source: `${at}:a`, target: `${at}:b`, sourceHandle: "a", targetHandle: "b", type: "mermaid-message", zIndex: 5, data, ...still })
    }
    layout.notes.forEach((note, index) => {
        nodes.push({ id: `n${String(index + 1)}`, type: "mermaid-note", position: { x: note.box.x, y: note.box.y }, data: { label: note.row.text, width: note.box.width, height: note.box.height }, width: note.box.width, height: note.box.height, zIndex: 6, ...still })
    })
    return { nodes, edges }
}

/* ---------------------------------------------------------------- the canvas */

/** The width of an element, followed as it changes. */
const useWidth = (target: RefObject<HTMLElement | null>): number | null => {
    const [width, setWidth] = useState<number | null>(null)
    useEffect(() => {
        const element = target.current
        if (element === null) return
        setWidth(element.getBoundingClientRect().width)
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => {
            if (entry !== undefined) setWidth(entry.contentRect.width)
        })
        observer.observe(element)
        return () => {
            observer.disconnect()
        }
    }, [target])
    return width
}

/** The start of a drawing: a flowchart's entry node (a sequence's is its top left, its first participant and first message). */
const startOf = (drawn: Drawn): Box | undefined => (drawn.kind === "graph" ? drawn.entry : undefined)

/** The first view: the drawing at its open zoom (never under the readable floor), centred where it fits, else from its start so the reader pans on from there. */
const useOpenView = (drawing: Drawn) => {
    const flow = useReactFlow()
    const width = useStore((state) => state.width)
    const height = useStore((state) => state.height)
    return useCallback(() => {
        if (width === 0 || height === 0) return undefined
        const { x, y, zoom } = openView({ width, height }, drawing, openFloor(drawing.kind), startOf(drawing))
        return { x, y, zoom, set: () => void flow.setViewport({ x, y, zoom }) }
    }, [drawing, flow, height, width])
}

/** Opens the canvas on its first view once its frame is measured, and again when the frame's size changes. */
const OpenOnce = ({ drawing }: { readonly drawing: Drawn }): null => {
    const open = useOpenView(drawing)
    useEffect(() => {
        const view = open()
        if (view === undefined) return
        view.set()
        // The pan and zoom handler may not be ready on the first frame: set it once more.
        const later = setTimeout(view.set, 60)
        return () => {
            clearTimeout(later)
        }
    }, [open])
    return null
}

interface CanvasProps {
    readonly drawn: Drawn
    readonly icons: Readonly<Record<string, ReactNode>> | undefined
    readonly label: string
    readonly words: MermaidDiagramLabels
    readonly height: number
    /** The scheme of the scope the diagram stands in: xyflow names its root `light` or `dark`, a theme scope, so it must be the one around it. */
    readonly scheme: "light" | "dark"
}

/** The canvas of a drawn diagram: xyflow with the graph's dot grid, panned by drag or touch and the arrow keys, zoomed by pinch, the controls or + and -. */
const Canvas = ({ drawn, icons, label, words, height, scheme }: CanvasProps): ReactElement => {
    const flow = useReactFlow()
    const open = useOpenView(drawn)
    const elements = useMemo(() => {
        if (drawn.kind === "graph") return graphElements(drawn, icons)
        if (drawn.kind === "sequence") return sequenceElements(drawn)
        const data = { label: "", width: drawn.width, height: drawn.height, svg: drawn.svg }
        return { nodes: [{ id: "drawing", type: "mermaid-svg", position: { x: 0, y: 0 }, data, width: drawn.width, height: drawn.height, ...still }], edges: [] }
    }, [drawn, icons])
    const reset = (): void => open()?.set()
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.target !== event.currentTarget) return
        const moves: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] }
        const by = moves[event.key]
        if (by !== undefined) {
            event.preventDefault()
            const view = flow.getViewport()
            void flow.setViewport({ ...view, x: view.x + by[0], y: view.y + by[1] })
        } else if (event.key === "+" || event.key === "=") {
            event.preventDefault()
            void flow.zoomIn()
        } else if (event.key === "-") {
            event.preventDefault()
            void flow.zoomOut()
        } else if (event.key === "0") {
            event.preventDefault()
            reset()
        }
    }
    return (
        <div className="starci-graph starci-graph-diagram-canvas" data-grammar-mermaid-canvas="true" role="region" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} style={{ blockSize: height }}>
            <div className="starci-graph-canvas" role="img" aria-label={label}>
                <ReactFlow
                    nodes={elements.nodes}
                    edges={elements.edges}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    defaultViewport={{ x: INSETS.left, y: INSETS.top, zoom: 1 }}
                    minZoom={0.2}
                    maxZoom={3}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    nodesFocusable={false}
                    edgesFocusable={false}
                    elementsSelectable={false}
                    disableKeyboardA11y
                    panOnDrag
                    zoomOnPinch
                    zoomOnScroll={false}
                    panOnScroll={false}
                    preventScrolling={false}
                    zoomOnDoubleClick
                    colorMode={scheme}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={22} size={1.4} color="var(--starci-graph-grid)" />
                    <OpenOnce drawing={drawn} />
                </ReactFlow>
            </div>
            <div className="starci-graph-diagram-controls">
                <ZoomButtons
                    words={{ zoomIn: words.zoomIn, zoomOut: words.zoomOut, fit: words.fit }}
                    onZoomIn={() => void flow.zoomIn()}
                    onZoomOut={() => void flow.zoomOut()}
                    onFit={() => void flow.fitView(FIT_OPTIONS)}
                    reset={{ label: words.reset, onPress: reset }}
                />
            </div>
        </div>
    )
}

/** The text version of a drawing, for a screen reader: the nodes and links of a graph, the messages of a sequence in order. */
const TextVersion = ({ drawn, words }: { readonly drawn: Drawn; readonly words: MermaidDiagramLabels }): ReactElement | null => {
    if (drawn.kind === "other") return null
    const named: DiagramGraph | SequenceModel =
        drawn.kind === "graph"
            ? { ...drawn.graph, nodes: drawn.graph.nodes.map((node) => (node.shape === "start" ? { ...node, label: words.start } : node.shape === "end" ? { ...node, label: words.end } : node)) }
            : drawn.model
    const { items, links } = describeDiagram(named, words.to)
    return (
        <div className="starci-core-visually-hidden" data-grammar-mermaid-text="true">
            {drawn.kind === "sequence" ? (
                <ol>{items.map((item, index) => <li key={`${String(index)}-${item}`}>{item}</li>)}</ol>
            ) : (
                <>
                    <ul>{items.map((item, index) => <li key={`${String(index)}-${item}`}>{item}</li>)}</ul>
                    <ul>{links.map((link, index) => <li key={`${String(index)}-${link}`}>{link}</li>)}</ul>
                </>
            )}
        </div>
    )
}

/** Re-renders Mermaid's own SVG when the theme changes: the root's attributes, the page's mode class or the system scheme. */
const useThemeRevision = (anchor: RefObject<HTMLElement | null>): number => {
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const root = anchor.current?.closest(".grammar-common-root") ?? null
        const bump = (): void => setRevision((value) => value + 1)
        const scheme = window.matchMedia("(prefers-color-scheme: dark)")
        scheme.addEventListener("change", bump)
        const observer = root === null ? null : new MutationObserver(bump)
        if (root !== null) observer?.observe(root, { attributes: true, attributeFilter: ["data-grammar-family", "style", "class"] })
        const page = new MutationObserver(bump)
        page.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] })
        return () => {
            scheme.removeEventListener("change", bump)
            observer?.disconnect()
            page.disconnect()
        }
    }, [anchor])
    return revision
}

/** The legend under the drawing: one row of tones, each a short line in its tone (the graph ext's legend look) and the app's words. */
const DiagramLegend = ({ items }: { readonly items: ReadonlyArray<MermaidLegendItem> }): ReactElement => (
    <ul className="starci-graph-legend starci-graph-diagram-legend starci-type-caption" data-grammar-mermaid-legend="true">
        {items.map((item) => (
            <li key={`${item.tone}-${item.label}`} className="starci-graph-legend-item">
                <span className="starci-graph-legend-edge starci-graph-diagram-legend-line" data-tone={item.tone} aria-hidden="true">
                    <svg width={28} height={8} viewBox="0 0 28 8">
                        <path d="M1 4H27" />
                    </svg>
                </span>
                <Text role="caption">{item.label}</Text>
            </li>
        ))}
    </ul>
)

/** The icon names a node may keep: the ones the app draws something for. */
const keepIcons = (given: ParsedDiagram, iconNames: ReadonlySet<string>): ParsedDiagram => {
    if (given.kind !== "flowchart" && given.kind !== "state") return given
    // An icon the app draws nothing for takes no room: the node is sized for its words alone.
    return { ...given, nodes: given.nodes.map((node) => (node.icon === undefined || iconNames.has(node.icon) ? node : (({ icon: _dropped, ...rest }) => rest)(node))) }
}

/** Lays a parsed diagram out: ELK for a graph, the sequence layout for a sequence, Mermaid's SVG for any other kind. */
const draw = async (given: ParsedDiagram, source: string, id: string, anchor: HTMLElement, isPhone: boolean, iconNames: ReadonlySet<string>): Promise<Drawn> => {
    const known = keepIcons(given, iconNames)
    // On a phone a flowchart or a state diagram is laid out top-down, so it fits the width (the routing law, rule 4).
    const parsed: ParsedDiagram = isPhone && (known.kind === "flowchart" || known.kind === "state") ? { ...known, direction: "TB" } : known
    if (parsed.kind === "flowchart" || parsed.kind === "state") {
        const across = await layoutDiagram(parsed, textWidth, measureLabel)
        // A graph too wide to read across its frame is laid out top-down instead of opening cut at the readable floor (Next v0.0.10 audit).
        if (parsed.direction === "LR" && needsTopDown(anchor.getBoundingClientRect().width, across)) return { kind: "graph", ...(await layoutDiagram({ ...parsed, direction: "TB" }, textWidth, measureLabel)) }
        return { kind: "graph", ...across }
    }
    if (parsed.kind === "sequence") {
        const layout = layoutSequence(parsed, textWidth)
        return { kind: "sequence", model: parsed, layout, width: layout.width, height: layout.height }
    }
    const svg = await renderSvg(id, source, resolveMermaidTheme(anchor))
    const placed = svgNode(svg)
    if (placed === null) throw new Error("not an svg")
    return { kind: "other", type: "type" in parsed ? parsed.type : "diagram", svg, width: placed.width, height: placed.height }
}

/**
 * A Mermaid diagram on the graph ext's canvas (owner 2026-11-23): the author writes Mermaid, Mermaid's own parser reads it, and the Grammar draws it on
 * xyflow with the graph's dot grid, pan and zoom, fit and reset, its nodes, edges, arrowheads and fonts. A flowchart and a state diagram are laid out by
 * ELK (layered, few crossings; `[(db)]` a cylinder, a subgraph or a composite state a container); a sequence is laid out row by row (headers, dashed
 * lifelines, a message an edge between two anchors on their lifelines, notes as soft pills, alt/loop/opt as tinted fields); any other kind (gantt, pie,
 * journey, ...) is Mermaid's own SVG in the Grammar's diagram theme, as one node of the same canvas. Every edge of a flowchart is its own line: two edges
 * never leave or enter a node at one point and never share a stretch, so no junction dot is drawn and each keeps its arrowhead. Tones paint a node
 * (`tones`, `class B danger`), a message (`messageTones`) or an edge (`edgeTones`, or `A r1@--> B` then `class r1 info`); `legend` says under the canvas
 * what each edge tone means; a node's `R@{ icon: "name" }` draws `icons[name]` before its words. Loading keeps the canvas box with a Skeleton; a
 * source Mermaid refuses is an error inside the same region, the title then the source as code. A visually hidden text version (the nodes and links, or
 * the messages in order) follows the canvas. Import `@starci/grammar/core/ext/graph.css` once.
 * Contract: overflow OVERFLOW-4; loading and failure keep the anatomy STATE-8.
 */
export const MermaidDiagram = ({ source, label, height = "sm", errorTitle = "This diagram could not be drawn.", sourceLabel, isLoading = false, tones, messageTones, edgeTones, legend, icons, caption, labels }: MermaidDiagramProps): ReactElement => {
    const frame = useRef<HTMLElement | null>(null)
    const [drawing, setDrawing] = useState<Drawing>({ status: "loading" })
    const [needsTheme, setNeedsTheme] = useState(false)
    const [scheme, setScheme] = useState<"light" | "dark">("light")
    const themeRevision = useThemeRevision(frame)
    // Only Mermaid's own SVG is drawn again for a theme change; the canvas reads the tokens and only follows the scheme.
    const revision = needsTheme ? themeRevision : 0
    useEffect(() => {
        if (frame.current !== null) setScheme(resolveMermaidTheme(frame.current).darkMode ? "dark" : "light")
    }, [themeRevision])
    const width = useWidth(frame)
    // The layout waits for the frame's width: a phone lays a graph out top-down.
    const isPhone = width === null ? null : width < PHONE_LAYOUT_WIDTH
    const words = { ...LABELS, ...labels }
    const id = `grammar-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`
    // The tones and the icon names are read by value: an inline object passed each render redraws nothing unless what it says changed.
    const iconNames = Object.keys(icons ?? {}).sort()
    const toneKey = JSON.stringify([tones ?? null, messageTones ?? null, edgeTones ?? null, iconNames])
    const toned = useRef({ tones, messageTones, edgeTones, iconNames, label })
    toned.current = { tones, messageTones, edgeTones, iconNames, label }

    useEffect(() => {
        if (isLoading || frame.current === null || isPhone === null) return
        let isCurrent = true
        const anchor = frame.current
        setDrawing({ status: "loading" })
        parseDiagram(source, toned.current.tones, toned.current.messageTones, toned.current.edgeTones)
            .then((parsed) => {
                if (isCurrent) setNeedsTheme(parsed.kind === "other")
                if (parsed.kind === "flowchart" && !isProduction())
                    for (const node of branchesWithoutDecision(parsed))
                        globalThis.console.warn(`@starci/grammar/core/ext/graph: MermaidDiagram "${toned.current.label}": node "${node}" branches without a decision; a branch is an if/else, so write the condition as a decision node {…?} with one labelled edge per answer (yes / no), or drop the words of edges that are all taken.`)
                return draw(parsed, source, `${id}-${String(revision)}`, anchor, isPhone, new Set(toned.current.iconNames))
            })
            .then(
                (drawn) => {
                    if (isCurrent) setDrawing({ status: "ready", drawn })
                },
                (error: unknown) => {
                    if (isCurrent) setDrawing({ status: "error", message: error instanceof Error ? error.message : String(error) })
                },
            )
        return () => {
            isCurrent = false
        }
    }, [id, isLoading, isPhone, revision, source, toneKey])

    const state = isLoading ? "loading" : drawing.status
    const reserved = RESERVED[height]
    const ready = state === "ready" && drawing.status === "ready" ? drawing.drawn : undefined
    const canvas = ready === undefined || width === null ? reserved : canvasHeight(width, ready, reserved, openFloor(ready.kind))
    return (
        <figure
            ref={frame}
            className="starci-graph-diagram"
            data-component="MermaidDiagram"
            data-contract={state === "ready" ? "OVERFLOW-4" : "OVERFLOW-4 STATE-8"}
            data-grammar-mermaid-height={height}
            data-grammar-mermaid-state={state}
            {...(ready === undefined ? {} : { "data-grammar-mermaid-kind": ready.kind === "graph" ? ready.graph.kind : ready.kind })}
            data-tier="frame"
            {...(state === "loading" ? { "aria-busy": true, "data-loading": "true" } : {})}
        >
            {state === "error" ? (
                <div className="starci-graph-diagram-error" data-grammar-mermaid-error="true" style={{ minBlockSize: reserved }}>
                    <Alert tone="negative" title={errorTitle} />
                    <FencedCodeBlock language="mermaid" label={sourceLabel ?? `${label} source`} code={source} />
                </div>
            ) : ready === undefined ? (
                <div className="starci-graph-diagram-loading" data-grammar-mermaid-canvas="true" style={{ blockSize: reserved }}>
                    <Skeleton shape="rect" />
                </div>
            ) : (
                <ReactFlowProvider>
                    <Canvas drawn={ready} icons={icons} label={label} words={words} height={canvas} scheme={scheme} />
                </ReactFlowProvider>
            )}
            {ready === undefined ? null : <TextVersion drawn={ready} words={words} />}
            {legend === undefined || legend.length === 0 ? null : <DiagramLegend items={legend} />}
            {caption === undefined ? null : <figcaption className="starci-graph-diagram-caption">{caption}</figcaption>}
        </figure>
    )
}
