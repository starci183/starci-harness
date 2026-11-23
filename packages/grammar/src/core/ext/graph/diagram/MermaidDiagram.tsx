"use client"

import { Background, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeProps, type NodeTypes } from "@xyflow/react"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react"
import { Alert, FencedCodeBlock, Skeleton } from "../../../index.js"
import type { NoChildren } from "../../../tier.js"
import { layoutFlow, type FlowLayout, type LinkEnds, type SizedNode } from "../layout.js"
import { measureLabel } from "../shared/canvas.js"
import { StepEdge } from "../shared/StepEdge.js"
import { edgeClassName } from "../shared/status.js"
import { ZoomButtons } from "../shared/zoom.js"
import type { StepEdgeData } from "../build.js"
import { describeDiagram, type DiagramGraph, type DiagramNode, type MermaidTone, type ParsedDiagram, type SequenceModel, type SequenceRow } from "./model.js"
import { parseDiagram, renderSvg, svgNode } from "./mermaid.js"
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

export type MermaidDiagramProps = NoChildren & {
    /** The Mermaid text, as written in the article's fence (without the fence itself). */
    readonly source: string
    /** Names the diagram for assistive technology, e.g. "Request flow": the canvas region and the drawing take it. */
    readonly label: string
    /**
     * The least height of the canvas, kept by the loading, ready and error states alike so the page does not jump when the drawing arrives. A taller
     * drawing grows the canvas up to 35rem; a wider or taller one than that is panned and zoomed. Default `sm`.
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
    /** One line under the drawing, in the caption role, saying what to look at. */
    readonly caption?: string
    /** The canvas's words (zoom controls, the text version's start and end), English defaults. */
    readonly labels?: Partial<MermaidDiagramLabels>
}

const LABELS: MermaidDiagramLabels = { zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to frame", reset: "Reset view", start: "start", end: "end", to: "to" }

/** The reserved box of each height step, and the tallest the canvas grows to fit a drawing. */
const RESERVED: Readonly<Record<MermaidDiagramHeight, number>> = { sm: 256, md: 384, lg: 512 }
const TALLEST = 560
/** The room round the drawing at the first view: the controls row along the bottom (40 + 2 × 8). */
const INSETS = { top: 16, right: 16, bottom: 64, left: 16 } as const
/** The first view never draws smaller than this (the 13px words stay about 9px, read on a phone); a drawing that needs less opens on its start and is panned. */
const LEAST_OPEN_ZOOM = 0.7
const PAN_STEP = 48
const px = (n: number): `${number}px` => `${String(n)}px` as `${number}px`
/** The fit button: the whole drawing, clear of the controls row. */
const FIT_OPTIONS = { padding: { top: px(INSETS.top), right: px(INSETS.right), bottom: px(INSETS.bottom), left: px(INSETS.left) }, minZoom: 0.2, maxZoom: 1.5 } as const

/* ---------------------------------------------------------------- sizes */

/** The width of one line of words at the canvas's label size (the measure the edge words use, without their padding). */
const textWidth = (text: string): number => Math.ceil((measureLabel(text).width - 20) * 1.06)

/** Words wrapped greedily into lines no wider than `max`. */
const wrap = (text: string, max: number): readonly string[] =>
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
const nodeSize = (node: DiagramNode, direction: "LR" | "TB"): { readonly width: number; readonly height: number } => {
    const words = wrap(node.label, BOX_MAX - 32)
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

/* ---------------------------------------------------------------- the drawings */

interface ShapeData extends Record<string, unknown> {
    node: DiagramNode
    width: number
    height: number
    direction: "LR" | "TB"
}

type Drawn =
    | { readonly kind: "graph"; readonly graph: DiagramGraph; readonly layout: FlowLayout; readonly sizes: readonly SizedNode[]; readonly width: number; readonly height: number }
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
    const { node, width, height, direction } = data
    const words = node.label === "" ? null : <span className="starci-graph-diagram-words">{node.label}</span>
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
        <div className="starci-graph-diagram-node" data-shape={node.shape} {...toneProps(node.tone)} style={{ inlineSize: width, blockSize: height }}>
            {outline}
            {handles(direction)}
            {words}
        </div>
    )
}

/** A subgraph or a composite state: a quiet tinted field, its name in its top corner. */
const GroupNode = ({ data }: NodeProps<Node<ShapeData>>): ReactElement => (
    <div className="starci-graph-diagram-group" {...toneProps(data.node.tone)} style={{ inlineSize: data.width, blockSize: data.height }}>
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

const HEAD = 9

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

/** The xyflow nodes and edges of a laid-out graph: shapes and containers where ELK put them, edges on ELK's routes with their words as pills. */
const graphElements = (drawn: Extract<Drawn, { readonly kind: "graph" }>): { readonly nodes: Node[]; readonly edges: Edge[] } => {
    const { graph, layout, sizes } = drawn
    const size = new Map(sizes.map((each) => [each.id, each] as const))
    const nodes = parentsFirst(graph.nodes).map((node): Node => {
        const box = layout.boxes[node.id]
        const own = size.get(node.id)
        const isGroup = node.shape === "container"
        const width = isGroup ? (box?.width ?? own?.width ?? 120) : (own?.width ?? 80)
        const height = isGroup ? (box?.height ?? own?.height ?? 40) : (own?.height ?? 40)
        const data: ShapeData = { node, width, height, direction: graph.direction }
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
    const edges = graph.edges.map((edge): Edge => {
        const style = edge.dashed ? "fallback" : "plain"
        const data: StepEdgeData = { style, pill: edge.label, dangerPort: false, dimmed: false, route: layout.routes[edge.id] }
        return { id: edge.id, source: edge.source, target: edge.target, type: "step", sourceHandle: "out", targetHandle: "in", className: `${edgeClassName(style)}${edge.thick ? " starci-graph-diagram-edge--thick" : ""}`, zIndex: 2, data, ...still }
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
        if (element === null || typeof ResizeObserver === "undefined") return
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

/** The zoom of the first view in a frame: the whole drawing when it fits at 100% or less, never under the least open zoom. */
export const openZoom = (frame: { readonly width: number; readonly height: number }, drawing: { readonly width: number; readonly height: number }): number => {
    const room = { width: frame.width - INSETS.left - INSETS.right, height: frame.height - INSETS.top - INSETS.bottom }
    const fit = Math.min(room.width / Math.max(1, drawing.width), room.height / Math.max(1, drawing.height))
    return Math.max(LEAST_OPEN_ZOOM, Math.min(1, fit))
}

/** The canvas height for a frame width: the drawing as large as the width lets it, between the reserved box and the tallest. */
export const canvasHeight = (frameWidth: number, drawing: { readonly width: number; readonly height: number }, reserved: number): number => {
    const zoom = Math.max(LEAST_OPEN_ZOOM, Math.min(1, (frameWidth - INSETS.left - INSETS.right) / Math.max(1, drawing.width)))
    return Math.round(Math.max(reserved, Math.min(Math.max(reserved, TALLEST), drawing.height * zoom + INSETS.top + INSETS.bottom)))
}

/** The first view: the drawing at its open zoom, centred where it fits, else from its start (top left) so the reader pans on from there. */
const useOpenView = (drawing: { readonly width: number; readonly height: number }) => {
    const flow = useReactFlow()
    const width = useStore((state) => state.width)
    const height = useStore((state) => state.height)
    return useCallback(() => {
        if (width === 0 || height === 0) return undefined
        const zoom = openZoom({ width, height }, drawing)
        const room = { width: width - INSETS.left - INSETS.right, height: height - INSETS.top - INSETS.bottom }
        const x = drawing.width * zoom <= room.width ? INSETS.left + (room.width - drawing.width * zoom) / 2 : INSETS.left
        const y = drawing.height * zoom <= room.height ? INSETS.top + (room.height - drawing.height * zoom) / 2 : INSETS.top
        return { x, y, zoom, set: () => void flow.setViewport({ x, y, zoom }) }
    }, [drawing, flow, height, width])
}

/** Opens the canvas on its first view once its frame is measured, and again when the frame's size changes. */
const OpenOnce = ({ drawing }: { readonly drawing: { readonly width: number; readonly height: number } }): null => {
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
    readonly label: string
    readonly words: MermaidDiagramLabels
    readonly height: number
    /** The scheme of the scope the diagram stands in: xyflow names its root `light` or `dark`, a theme scope, so it must be the one around it. */
    readonly scheme: "light" | "dark"
}

/** The canvas of a drawn diagram: xyflow with the graph's dot grid, panned by drag or touch and the arrow keys, zoomed by pinch, the controls or + and -. */
const Canvas = ({ drawn, label, words, height, scheme }: CanvasProps): ReactElement => {
    const flow = useReactFlow()
    const open = useOpenView(drawn)
    const elements = useMemo(() => {
        if (drawn.kind === "graph") return graphElements(drawn)
        if (drawn.kind === "sequence") return sequenceElements(drawn)
        const data = { label: "", width: drawn.width, height: drawn.height, svg: drawn.svg }
        return { nodes: [{ id: "drawing", type: "mermaid-svg", position: { x: 0, y: 0 }, data, width: drawn.width, height: drawn.height, ...still }], edges: [] }
    }, [drawn])
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

const CONTAINER_INSETS = { top: 36, right: 16, bottom: 16, left: 16 } as const

/** Lays a parsed diagram out: ELK for a graph, the sequence layout for a sequence, Mermaid's SVG for any other kind. */
const draw = async (parsed: ParsedDiagram, source: string, id: string, anchor: HTMLElement): Promise<Drawn> => {
    if (parsed.kind === "flowchart" || parsed.kind === "state") {
        const sizes: SizedNode[] = parsed.nodes.map((node) => ({
            id: node.id,
            ...nodeSize(node, parsed.direction),
            ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
            ...(node.shape === "container" ? { insets: CONTAINER_INSETS } : {}),
        }))
        const links: LinkEnds[] = parsed.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...(edge.label === undefined ? {} : { label: edge.label }) }))
        const layout = await layoutFlow(sizes, links, { direction: parsed.direction, islands: "wrap", width: 960, measure: measureLabel })
        const parent = new Map(parsed.nodes.flatMap((node) => (node.parentId === undefined ? [] : [[node.id, node.parentId] as const])))
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
        const routeEnds = Object.values(layout.routes).flatMap((route) => route.points)
        const minX = Math.min(...boxes.map((box) => box.x), ...routeEnds.map((point) => point[0]))
        const minY = Math.min(...boxes.map((box) => box.y), ...routeEnds.map((point) => point[1]))
        const maxX = Math.max(...boxes.map((box) => box.x + box.width), ...routeEnds.map((point) => point[0]))
        const maxY = Math.max(...boxes.map((box) => box.y + box.height), ...routeEnds.map((point) => point[1]))
        return { kind: "graph", graph: parsed, layout, sizes, width: Math.max(1, maxX - Math.min(0, minX)), height: Math.max(1, maxY - Math.min(0, minY)) }
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
 * journey, ...) is Mermaid's own SVG in the Grammar's diagram theme, as one node of the same canvas. Loading keeps the canvas box with a Skeleton; a
 * source Mermaid refuses is an error inside the same region, the title then the source as code. A visually hidden text version (the nodes and links, or
 * the messages in order) follows the canvas. Import `@starci/grammar/core/ext/graph.css` once.
 * Contract: overflow OVERFLOW-4; loading and failure keep the anatomy STATE-8.
 */
export const MermaidDiagram = ({ source, label, height = "sm", errorTitle = "This diagram could not be drawn.", sourceLabel, isLoading = false, tones, messageTones, caption, labels }: MermaidDiagramProps): ReactElement => {
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
    const words = { ...LABELS, ...labels }
    const id = `grammar-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`
    // The tones are read by value: an inline object passed each render redraws nothing unless what it says changed.
    const toneKey = JSON.stringify([tones ?? null, messageTones ?? null])
    const toned = useRef({ tones, messageTones })
    toned.current = { tones, messageTones }

    useEffect(() => {
        if (isLoading || frame.current === null) return
        let isCurrent = true
        const anchor = frame.current
        setDrawing({ status: "loading" })
        parseDiagram(source, toned.current.tones, toned.current.messageTones)
            .then((parsed) => {
                if (isCurrent) setNeedsTheme(parsed.kind === "other")
                return draw(parsed, source, `${id}-${String(revision)}`, anchor)
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
    }, [id, isLoading, revision, source, toneKey])

    const state = isLoading ? "loading" : drawing.status
    const reserved = RESERVED[height]
    const ready = state === "ready" && drawing.status === "ready" ? drawing.drawn : undefined
    const canvas = ready === undefined || width === null ? reserved : canvasHeight(width, ready, reserved)
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
                    <Canvas drawn={ready} label={label} words={words} height={canvas} scheme={scheme} />
                </ReactFlowProvider>
            )}
            {ready === undefined ? null : <TextVersion drawn={ready} words={words} />}
            {caption === undefined ? null : <figcaption className="starci-graph-diagram-caption">{caption}</figcaption>}
        </figure>
    )
}
