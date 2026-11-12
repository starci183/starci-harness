import type { ReactNode } from "react"
import type { CustomTone } from "../../../common/tones.js"
import type { IconSource } from "../../leaf/Icon/index.js"

/** HeroUI's palette tones, `muted`, and any tone the app declared in `GrammarToneRegistry`. */
export type FlowGraphTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted" | CustomTone
export type FlowGraphNodeSize = "sm" | "md" | "lg"
export type FlowGraphHeight = "sm" | "md" | "lg"
/**
 * The outline of a node, the flowchart shapes: `stadium` (the default pill), `rect` (a step), `round` (a rounded step),
 * `diamond` (a decision) and `circle` (a start or end point).
 */
export type FlowGraphNodeShape = "stadium" | "rect" | "round" | "diamond" | "circle"
/**
 * `steps` is the card map of a workflow (0.35.0, the owner-approved look): white step cards on the well, top-down by default, a condition
 * card with named output ports, curved edges and dashed back edges. `radial` rings the nodes round the root, `layered` puts a DAG in
 * layers, `manual` uses each node's `position`, and `lanes` is the older left-to-right branch map of a workflow (kept; prefer `steps`).
 */
export type FlowGraphLayout = "radial" | "manual" | "layered" | "lanes" | "steps"
/**
 * What a node of a `lanes` graph is, which sets its tone: a `trigger` starts the work (neutral), a `condition` forks it (warning), an
 * `execute` does a step (the node's `tone`, info by default) and an `output` ends a path (accent).
 */
export type FlowGraphLanesKind = "trigger" | "condition" | "execute" | "output"
/**
 * What a node of a `steps` graph is, which sets its icon tile and its card: an `event` happens (starts or announces the work), an `action`
 * does a step, a `condition` forks the work through its output ports, an `ask` needs the owner, a `wait` waits (dashed card) and an `end`
 * closes a path (a pill with a check). The `lanes` kinds still work in `steps`: `trigger` draws as `event`, `execute` as `action`, `output` as `end`.
 */
export type FlowGraphStepKind = "event" | "action" | "condition" | "ask" | "wait" | "end"
/** The kind of a node: the `lanes` kinds and the `steps` kinds. */
export type FlowGraphNodeKind = FlowGraphLanesKind | FlowGraphStepKind
/** Where a run is at a node (the run overlay of a `steps` graph): a status ring and badge on the card; a `skipped` node is faded. */
export type FlowGraphRunStatus = "done" | "running" | "failed" | "waiting" | "skipped"
/**
 * A named output of a card, e.g. "Yes" / "No" on a condition, or "Error" on an action (0.37.4: any kind may declare `outputs`). An edge leaves from it by
 * `sourcePort` (its `id`). `tone: "danger"` is an error output: its label, its dot on the card edge and the edges that leave it are drawn in the danger tone.
 */
export type FlowGraphPort = {
    readonly id: string
    readonly label: string
    readonly tone?: "danger"
}
/** A small 12px pill under a step's title (0.37.4): `accent` is the pink soft pair (a dynamic parameter, "= order.id"), `neutral` the grey one (a fixed value). */
export type FlowGraphChip = {
    readonly label: string
    readonly tone?: "accent" | "neutral"
}
/**
 * A loop card (0.37.4, `steps` only): the node is drawn as a box with a 1.5px primary outline and a header line (its `label` and `chips`), and the nodes named
 * in `childIds` are laid out inside it, as a graph of their own. An edge to or from the container's id meets the box's edge; an edge between two children is drawn inside.
 */
export type FlowGraphContainer = {
    readonly label: string
    readonly chips?: ReadonlyArray<FlowGraphChip>
    readonly childIds: ReadonlyArray<string>
}
/** The agent a block belongs to (0.37.5): drawn as a 16px avatar and the name (12px, muted) under the title. */
export type FlowGraphAgent = {
    readonly name: string
    readonly avatar?: string
}
/** The position of a node's centre, in graph units (0.37.5: the app's saved arrangement). */
export type FlowGraphPositions = Readonly<Record<string, { readonly x: number, readonly y: number }>>
/** `forward` (default) runs down the flow; `back` (alias `return`) returns to an earlier or sibling step: dashed, with an optional pill label. */
export type FlowGraphEdgeVariant = "forward" | "back" | "return"
/** One entry of the kind legend under a `steps` graph. */
export type FlowGraphLegendItem = {
    readonly kind: FlowGraphStepKind
    readonly label: string
}
/** The way edges run: top to bottom or left to right. */
export type FlowGraphDirection = "TB" | "LR"

export type FlowGraphNode = {
    readonly id: string
    readonly label: string
    readonly description?: string
    readonly tone?: FlowGraphTone
    /**
     * What the node is; it sets the tone (`lanes`: see {@link FlowGraphLanesKind}, an `execute` node keeps its own `tone`; `steps`: see
     * {@link FlowGraphStepKind}, a node `tone` overrides the kind's tile tone).
     */
    readonly kind?: FlowGraphNodeKind
    /** `steps` only: the glyph in the icon tile, an app icon component (`IconSource`) or a node. Leave it out for the kind's own glyph. */
    readonly icon?: IconSource | ReactNode
    /** `steps` only: a small pill at the top-right corner of the card, e.g. "Trigger", "Needs owner", "Waiting". */
    readonly tag?: string
    /**
     * `steps` only: the node's named output ports, left to right along the bottom of the card. On a `condition` left out, the ports are the
     * labels of the node's labelled outgoing edges, in edge order; on every other kind (0.37.4) the card has ports only when `outputs` is given
     * (an `action` with an "Error" `tone: "danger"` port), and an edge with no `sourcePort` still leaves from the bottom middle.
     */
    readonly outputs?: ReadonlyArray<FlowGraphPort>
    /** `steps` only (0.37.4): small pills under the title, up to 3, the rest as one "+N" pill. */
    readonly chips?: ReadonlyArray<FlowGraphChip>
    /** `steps` only (0.37.4): makes the node a loop card that holds `childIds` (see {@link FlowGraphContainer}). */
    readonly container?: FlowGraphContainer
    /** `steps` only (0.37.5): the agent that owns this block, for a block of another agent: a small avatar (the sprout when no `avatar`) and the name under the title. */
    readonly agent?: FlowGraphAgent
    /** `steps` only: the run overlay, where the run is at this node. */
    readonly status?: FlowGraphRunStatus
    readonly size?: FlowGraphNodeSize
    /** The node outline. Defaults to `stadium`. */
    readonly shape?: FlowGraphNodeShape
    readonly count?: number | string
    /** Filtered out: the node draws faint, keeps its place and stays focusable; an edge dims with its target. */
    readonly isDimmed?: boolean
    /** The centre of a radial layout. Defaults to the first node. */
    readonly isRoot?: boolean
    /** A slot not filled yet: dashed outline, muted. */
    readonly isPlaceholder?: boolean
    /** Makes the node a link. It navigates through the root's router (`navigate`/`useHref`) and is one keyboard stop (Enter). */
    readonly href?: string
    /** Where the node sits in `layout="manual"`, as its centre in graph units. */
    readonly position?: { readonly x: number, readonly y: number }
}

export type FlowGraphEdge = {
    readonly id: string
    readonly source: string
    readonly target: string
    /** A short label drawn on the edge, at its midpoint, e.g. "yes" on a decision branch. Screen readers get it in the edge list. */
    readonly label?: string
    readonly isPlaceholder?: boolean
    /** `steps` only: the output port of a condition source this edge leaves from (a {@link FlowGraphPort} `id`; a matching port label works too). */
    readonly sourcePort?: string
    /** `steps` only: `back` / `return` draws the edge dashed and routes it round the cards; its `label` is a small pill on it. */
    readonly variant?: FlowGraphEdgeVariant
    /** `steps` only, the run overlay: `true` the run took this edge (solid accent), `false` it did not (neutral, dashed and faded). */
    readonly isTaken?: boolean
}

/**
 * A header for one layer of a layered layout: a column title above the layer for `LR`, a lane title beside it for `TB`.
 * `at` is the layer index (0 first) in `layout="layered"`, and the coordinate along the layer axis in graph units in `layout="manual"`.
 */
export type FlowGraphLayerHeader = {
    readonly label: string
    readonly at: number
}
