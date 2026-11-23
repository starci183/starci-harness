import type { FlowKind, FlowKindTones, FlowStatus, FlowStatusInput, GraphEdgeVariant, GraphTone } from "../types.js"
import type { BadgeTone, MarkState } from "../../../index.js"

/** Each status draws in one Grammar tone: the node border, the status mark and the edge that leaves it. */
export const STATUS_TONE: Readonly<Record<FlowStatus, GraphTone>> = {
    done: "success",
    running: "info",
    wait: "warning",
    error: "danger",
    skipped: "muted",
    todo: "default",
}

const ALIASES: Readonly<Record<FlowStatusInput, FlowStatus>> = {
    done: "done",
    running: "running",
    wait: "wait",
    error: "error",
    skipped: "skipped",
    todo: "todo",
    waiting: "wait",
    failed: "error",
    idle: "todo",
}

/** The status of a node: its own word (or an older alias of it), `todo` when it has none. */
export const normalizeStatus = (status: FlowStatusInput | undefined): FlowStatus => (status === undefined ? "todo" : ALIASES[status])

export const statusTone = (status: FlowStatus): GraphTone => STATUS_TONE[status]

/** The six kinds a step can be; `trigger`, `execute` and `output` are the older names of `event`, `action` and `end`. */
export type StepKind = "event" | "action" | "condition" | "ask" | "wait" | "end"

const KIND_ALIASES: Readonly<Record<FlowKind, StepKind>> = {
    event: "event",
    action: "action",
    condition: "condition",
    ask: "ask",
    wait: "wait",
    end: "end",
    trigger: "event",
    execute: "action",
    output: "end",
}

export const normalizeKind = (kind: FlowKind | undefined): StepKind | undefined => (kind === undefined ? undefined : KIND_ALIASES[kind])

/** The tone of each kind's icon tile unless the app says otherwise (`kindTones`). */
export const KIND_TONES: Readonly<Record<StepKind, GraphTone>> = {
    event: "accent",
    action: "success",
    condition: "warning",
    ask: "danger",
    wait: "default",
    end: "success",
}

/** The tone of a node's round tile plate: its state's (the node's own `tone` overrides it). The glyph on it is the node's own icon, never a state's. */
export const tileTone = (tone: GraphTone | undefined, status: FlowStatus): GraphTone => tone ?? statusTone(status)

/** The tone of a step kind in the legend: the app's `kindTones`, else the default of the kind. */
export const kindTone = (kind: FlowKind, kindTones?: FlowKindTones): GraphTone => kindTones?.[kind] ?? KIND_TONES[KIND_ALIASES[kind]]

/** The class of a node in a status; the stylesheet draws the border, the mark and the dash from it. */
export const nodeClassName = (status: FlowStatus): string => `starci-graph-node starci-graph-node--${status}`

/** An edge flows (moving dots on a solid line) exactly while the step it leads into runs. A waiting step is paused: the edge into it is solid amber and still. */
export const isEdgeAnimated = (targetStatus: FlowStatus): boolean => targetStatus === "running"

/** What an edge is drawn as: its variant, else the state of its source (`running` flows, `wait` is amber and still); in a run, `taken` or `pending` (not taken yet: dashed, muted); out of a run, a quiet line. */
export type EdgeStyle = GraphEdgeVariant | "running" | "wait" | "pending" | "plain"

export const edgeStyleOf = (variant: GraphEdgeVariant | undefined, sourceStatus: FlowStatus | undefined, targetStatus?: FlowStatus, hasRun = false): EdgeStyle => {
    if (variant !== undefined) return variant
    if (targetStatus === "running") return "running"
    if (targetStatus === "wait") return "wait"
    if (!hasRun) return "plain"
    // In a run, a path the run took is solid in the tone of the state; one it has not reached yet is dashed and muted.
    return sourceStatus === "done" && (targetStatus === "done" || targetStatus === "error") ? "taken" : "pending"
}

/** The class of an edge in a style; the stylesheet draws the colour and the dash from it. */
export const edgeClassName = (style: EdgeStyle): string => `starci-graph-edge starci-graph-edge--${style}`

/** The accessible name of a node: its label, then its status in the app's words. */
export const nodeAriaLabel = (label: string, statusWord: string): string => `${label}, ${statusWord}`

/**
 * Pairs of nodes on one path that both run. A path has one active node, so a pair is a mistake of the app's states; the graph draws what it is given
 * and warns about it in development. A pair is reported once, as `[upstream, downstream]`.
 */
export const findConcurrentRunning = (
    nodes: readonly { readonly id: string; readonly status?: FlowStatusInput | undefined }[],
    edges: readonly { readonly source: string; readonly target: string; readonly variant?: GraphEdgeVariant | undefined }[],
): readonly (readonly [string, string])[] => {
    const running = new Set(nodes.filter((node) => normalizeStatus(node.status) === "running").map((node) => node.id))
    if (running.size < 2) return []
    const next = new Map<string, string[]>()
    for (const edge of edges) if (edge.variant !== "back") next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target])
    const pairs: (readonly [string, string])[] = []
    for (const from of running) {
        const seen = new Set<string>([from])
        const queue = [...(next.get(from) ?? [])]
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            if (seen.has(id)) continue
            seen.add(id)
            if (running.has(id)) pairs.push([from, id])
            queue.push(...(next.get(id) ?? []))
        }
    }
    return pairs
}

/**
 * The step the first view is centred on, on every screen (when the app names no `focusId`): the running one, else a failed one, else a waiting one, else the first one not done (in the order given), else the first.
 */
export const focusStep = (nodes: readonly { readonly id: string; readonly status?: FlowStatusInput | undefined }[]): string | undefined => {
    const at = (status: FlowStatus): string | undefined => nodes.find((node) => normalizeStatus(node.status) === status)?.id
    return at("running") ?? at("error") ?? at("wait") ?? nodes.find((node) => !["done", "skipped"].includes(normalizeStatus(node.status)))?.id ?? nodes[0]?.id
}

/** The core's mark state of a graph state (`MarkState`): the six graph states on the core's status map. */
export const markState = (status: FlowStatus): MarkState =>
    ({ done: "done", running: "running", wait: "waiting", error: "error", skipped: "skipped", todo: "notRun" } as const)[status]

/** The core Badge tone of a graph tone. */
export const badgeTone = (tone: GraphTone | undefined): BadgeTone => (tone === undefined || tone === "default" ? "neutral" : tone)
