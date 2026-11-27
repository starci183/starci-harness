import type { AriaLabelConfig } from "@xyflow/react"
import type { ComponentType, ReactNode } from "react"
import type { StepCardKind, StepCardMode, StepCardModeLabels, StepCardRow } from "./StepCard.js"

/**
 * Where a node of a workflow run stands, exactly six states: `done`, `running` (the only active one on a path: green (success), a spinner, its outgoing edge flows),
 * `wait` (paused: amber, no animation), `error`, `skipped` and `todo` (not reached yet, the default). The app supplies valid states; see `findConcurrentRunning`.
 */
export const FLOW_STATUSES = ["done", "running", "wait", "error", "skipped", "todo"] as const
export type FlowStatus = (typeof FLOW_STATUSES)[number]

/** The older run words are accepted and mean: `waiting` = `wait`; `failed` = `error`; `idle` = `todo`. */
export type FlowStatusInput = FlowStatus | "waiting" | "failed" | "idle"

/** The Grammar tone a node, a tile or a legend swatch draws in (the tone tokens of the theme). */
export type GraphTone = "default" | "accent" | "info" | "success" | "warning" | "danger" | "muted"

/** The way edges run: `LR` left to right (the default), `TB` top to bottom. */
export type GraphDirection = "LR" | "TB"

/** The top-left corner of a node, in graph units, in the frame of its parent (the canvas for a node outside every container). */
export interface GraphPosition {
    readonly x: number
    readonly y: number
}

/** The arrangement a person made: the position of each node they moved. A node inside a container is positioned inside that container. */
export type GraphPositions = Readonly<Record<string, GraphPosition>>

/**
 * What a step is, which sets the tone of its icon tile and, in the spine layout, its shape: an `event` happens, an `action` does a step, a `condition`
 * forks the work through its output ports (an if, or a `switch` of three or more cases), an `ask` needs a person, a `wait` waits, a `parallel` step forks
 * branches that run at once, a `call` runs another workflow and an `end` closes a path. `trigger`, `execute` and `output` read as `event`, `action` and `end`.
 */
export type FlowKind = "event" | "action" | "condition" | "switch" | "ask" | "wait" | "parallel" | "call" | "end" | "trigger" | "execute" | "output"

/**
 * The outline of a node. `card` a rounded rectangle (an action, the default); `diamond` a decision (an if: its label inside, yes out of the bottom vertex,
 * no out of the right one); `hexagon` a flat hexagon (a switch: its count badge, one exit into a hollow split bar); `pill` round-ended (a wait, with a clock
 * when it has no icon of its own); `stadium` round-ended (an end); `rect` a square-cornered rectangle (a parallel step, with solid fork and join bars);
 * `call` a hexagon with a dashed outline (a step that runs another workflow). The spine layout reads the shape from the kind when it is left out; ports
 * stay at the midpoints of the shape's box.
 */
export type FlowShape = "card" | "diamond" | "hexagon" | "pill" | "stadium" | "rect" | "call"

/** A named output of a step, e.g. "Yes" and "No" on a condition. An edge leaves from it by `sourcePort` (its id). `tone: "danger"` is an error output. */
export interface FlowPort {
    readonly id: string
    readonly label: string
    readonly tone?: "danger"
    /** The case a switch takes when no other matches (its "else"): drawn last, in the rightmost column, dotted. */
    readonly isDefault?: boolean
}

/** A small pill under a step's title; at most three are drawn, the rest is one "+N" pill. */
export interface FlowChip {
    readonly label: string
    readonly tone?: "accent" | "default"
}

/**
 * A region that holds other nodes (`childIds`), laid out as a graph of its own. `group` is a solid box with a header; `loop` is a body that repeats:
 * a dashed frame whose `exits` are pills on its end edge. An edge to or from the container's id meets the box; an edge from it may name an exit by `sourcePort`.
 */
export interface FlowContainer {
    readonly childIds: readonly string[]
    readonly kind?: "group" | "loop"
    readonly chips?: readonly FlowChip[]
    /** `loop`: a muted line after the label in the header, e.g. "up to 6 rounds". */
    readonly description?: string
    /** `loop`: the ways out of the loop, one pill each on the frame's end edge. */
    readonly exits?: readonly FlowPort[]
    /** `loop`: a muted line inside the bottom of the frame. */
    readonly note?: string
    /** The words of the attempt the loop is on, the app's ("attempt 2 of 5"): added to the frame's status chip. */
    readonly attempt?: string
}

/**
 * What a waiting node waits for, in the app's words: a `person` ("waiting for <name> since <time>"), a `time` ("<n> minutes left, until <time>") or an `external` service
 * ("<vendor> is processing, retry at <time>"). `label` is the word on the status chip (it replaces the `wait` word of `statusLabels`), `detail` the line under the title.
 * Nothing runs while a node waits: its edge is amber and still.
 */
export interface FlowWait {
    readonly kind: "person" | "time" | "external"
    readonly label: string
    readonly detail?: string
}

/**
 * A step drawn as the workflow step card (0.64.2, `StepCard`): its kind's glyph on the tinted tile, the mode badge, and a control step's ways out as rows
 * (`rows`, with their `state` in a run: the taken row lit, the others dimmed; a parallel branch's own mark). The run status stays on the card's top edge.
 */
export interface FlowStepCard {
    readonly kind: StepCardKind
    readonly subtitle?: string
    readonly mode?: StepCardMode
    readonly modeLabels?: StepCardModeLabels
    readonly rows?: readonly StepCardRow[]
}

export interface FlowNode {
    readonly id: string
    readonly label: string
    /** A small line under the label. */
    readonly description?: string
    /** The glyph in the round 40px tile at the node's left: the node's own subject, passed in by the app (a hand-off node shows the icon of the flow it hands over to). Left out, the tile holds a neutral default glyph, never a state's. */
    readonly icon?: ReactNode
    /** Where the run is at this node; `todo` when left out. */
    readonly status?: FlowStatusInput
    /** What the step is: names its swatch in the legend (see `kindTones`) and makes a `condition` a branch. The tile's plate is the state's tone, not the kind's. */
    readonly kind?: FlowKind
    /** The tone of the round tile's plate, over the state's. */
    readonly tone?: GraphTone
    readonly shape?: FlowShape
    /** A small pill at the card's top-right corner, e.g. "Trigger". */
    readonly tag?: string
    /** The named output ports. On a branch (a `condition` or a diamond) left out, the ports are the labels of its labelled outgoing edges, in edge order. */
    readonly outputs?: readonly FlowPort[]
    readonly chips?: readonly FlowChip[]
    /** The agent that owns the step: an avatar slot (drawn at 16px) the app fills, with `agentName` beside it. */
    readonly agent?: ReactNode
    readonly agentName?: string
    /** A figure at the end of the head, e.g. a run count. */
    readonly count?: number | string
    /** Makes the node a link (see `linkComponent`). */
    readonly href?: string
    /** Makes the node a container of `container.childIds`. */
    readonly container?: FlowContainer
    /** With `status: "wait"`: what the node waits for, in the app's words. */
    readonly wait?: FlowWait
    /** With `status: "error"`: the business reason, in the app's words (never a code); it is the line under the title. */
    readonly errorReason?: string
    /** Draws the step's inside as the workflow step card (`StepCard`); the node is a card whatever its kind, and at least as tall as the step card. */
    readonly card?: FlowStepCard
    /** Filtered out: the node draws faint and keeps its place. */
    readonly dimmed?: boolean
    /** A slot not filled yet: dashed, muted. */
    readonly placeholder?: boolean
}

/** How an edge is drawn: `taken` (the run went this way: solid, success), `fallback` (the road when the awaited thing does not happen: dashed), `skipped` (not taken: faded and dotted), `back` (returns to an earlier step: dashed, curved). */
export type GraphEdgeVariant = "taken" | "fallback" | "skipped" | "back"

/**
 * What an edge means in the flow, which sets its look and where it attaches (the spine layout): the run state (`variant`, or the states of its ends) still
 * says how far the run went, the kind says which road it is.
 *
 * - `ok`: the plain next step (solid, neutral). Leaves by the bottom-mid of its source, enters the top-mid of its target.
 * - `yes`: the main answer of a decision (solid success green, stronger). Bottom-mid out, straight down the column.
 * - `no`: the other answer of a decision (dotted grey). Right-mid out, into a column on the right.
 * - `loop`: returns to an earlier step (dashed accent, a "↻" before its words). Left-mid out, up a lane on the left, into left-mid.
 * - `timeout`: the road taken when a wait runs out (round amber dots). Right-mid out.
 * - `refused`, `declined`: a person or a service said no (thin red dashes). Right-mid out.
 * - `parallel`: one of the branches that run at the same time (solid neutral, from a fork bar to a join bar).
 * - `case`: one case of a switch (solid neutral, from the switch's hollow split bar straight down its column; the case the run took bold, with a check).
 * - `default`: the switch's case when none matches (grey dots, the rightmost column).
 *
 * Left out, the kind is read from the edge: `variant: "back"` is `loop`, `variant: "fallback"` is `timeout`, the first port of a decision `yes` and its
 * others `no`, out of a switch `case` (its `isDefault` port `default`), two or more plain edges out of one step that is not a decision `parallel`, anything
 * else `ok`.
 */
export const GRAPH_EDGE_KINDS = ["ok", "yes", "no", "loop", "timeout", "refused", "declined", "parallel", "case", "default"] as const
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number]

export interface GraphEdge {
    /** Left out, it is `source->target`. */
    readonly id?: string
    readonly source: string
    readonly target: string
    /** A short label on the edge, e.g. "yes". */
    readonly label?: string
    /** The output port of the source this edge leaves from (a `FlowPort` id; a port with the same label works too). */
    readonly sourcePort?: string
    /** Left out, an edge is drawn from the run: it flows while its source runs, waits (amber, still) while its source waits, and an untaken branch of a decision is `skipped`. */
    readonly variant?: GraphEdgeVariant
    /** What the edge means (see `GraphEdgeKind`): its look and the side of its ends it attaches to. Left out, it is read from the edge. */
    readonly kind?: GraphEdgeKind
    /** A slot not filled yet: dashed, muted. */
    readonly placeholder?: boolean
}

/** One field of an entity of a schema map. */
export interface SchemaField {
    readonly id: string
    readonly label: string
    /** The kind of the field, in the app's words (text, number, relation ...), muted at the row's end. */
    readonly type?: string
}

/** A box of a schema map: an object type with its fields. */
export interface SchemaEntity {
    readonly id: string
    readonly label: string
    readonly description?: string
    /** A figure at the head's end, e.g. the record count. */
    readonly count?: number | string
    readonly icon?: ReactNode
    /** Up to `SCHEMA_FIELD_ROWS` rows are drawn, the rest as one "+N" row. */
    readonly fields?: readonly SchemaField[]
}

/** The six status words of the graph in the app's language, read aloud after a node's label and shown by the legend. */
export type FlowStatusLabels = Readonly<Record<FlowStatus, string>>

/** The tone of the icon tile of each kind, over `KIND_TONES`. */
export type FlowKindTones = Partial<Readonly<Record<FlowKind, GraphTone>>>

/** One entry of the legend under a graph: a swatch and its words (the words are the app's). Give exactly one of `kind`, `status` or `edge`. */
export interface FlowLegendItem {
    readonly label: string
    /** A step kind (an icon tile in the kind's tone), or `loop` (the dashed frame). */
    readonly kind?: FlowKind | "loop"
    /** With a `kind`: draw its swatch as a decision diamond. */
    readonly shape?: "diamond"
    /** A node state (its border and tone). */
    readonly status?: FlowStatus
    /** An edge style: a variant, `running` (flows) or `wait` (amber, still), or an edge kind (`yes`, `no`, `loop`, `timeout`, ...). */
    readonly edge?: GraphEdgeVariant | GraphEdgeKind | "running" | "wait"
}

/** The renderer of a node's link: the app's router link. It must render one anchor-like element that takes `className` and `children`. */
export type GraphLinkComponent = ComponentType<{ readonly href: string; readonly className: string; readonly children: ReactNode }>

/** What both graphs share: the canvas, its selection, its editing, its overview map and its words. */
export interface GraphCanvasProps {
    /** Names the graph for assistive technology. */
    readonly label: string
    /** `LR` (default) or `TB`. */
    readonly direction?: GraphDirection
    /**
     * Who sets the graph's height. `frame` (default): the parent gives it (the graph fills it and opens fitted inside). `content` (0.55.1): the graph is as
     * tall as its laid-out drawing at 100% plus the fit insets, at least 20rem and at most `--starci-graph-max-block-size` (default 80vh), so a top-down
     * flow in a wide frame opens at full size instead of shrinking to a fixed height; the parent gives it no height.
     */
    readonly height?: "frame" | "content"
    /** True while the data is fetched: a skeleton graph with no text. */
    readonly isLoading?: boolean
    /** Shown instead of the canvas when there are no nodes. */
    readonly emptyLabel?: string
    /** The selected node. Pass it (with `onSelect`) to control selection; left out, the graph keeps its own. */
    readonly selectedId?: string | null
    /** Fires with the node id on click, Enter or Space, and with `null` on the empty canvas or Escape. */
    readonly onSelect?: (id: string | null) => void
    /** Fires with the node id when a node is pressed (click, Enter or Space); never with `null`. */
    readonly onNodePress?: (id: string) => void
    /**
     * The node the first view is centred on. The graph opens at 100% on every screen (never fitted; the fit button fits): a graph larger than its frame is
     * centred on this node, left out on the running step, else a failed one, else a waiting one, else the first not done, else the first (`focusStep`).
     */
    readonly focusId?: string | undefined
    /** Pan and zoom. Default on; `false` draws a still picture (fitted on load, no zoom buttons or overview map). Selection and editing still work. */
    readonly interactive?: boolean
    /** The zoom buttons, 32px. Default on while `interactive`. */
    readonly showControls?: boolean
    /** An overview map in the end-bottom corner. Off by default. */
    readonly minimap?: boolean
    readonly minimapLabel?: string
    /** xyflow's `ariaLabelConfig`: the words of the zoom controls and the keyboard help, in the app's language. */
    readonly ariaLabelConfig?: Partial<AriaLabelConfig>
    /** Nodes can be dragged. Off by default: the graph is read-only. ELK gives the first positions and `positions` overrides them. */
    readonly editable?: boolean
    /** The saved arrangement: the position of each node the person moved. Pass it (with `onPositionsChange`) to hold it in the app; left out, the graph keeps its own. */
    readonly positions?: GraphPositions
    /** Fires when a drag ends with the whole arrangement, and with `{}` when the reset control returns to the automatic layout. */
    readonly onPositionsChange?: (positions: GraphPositions) => void
    /** The accessible name of the reset control, a button in the zoom group while `editable`; without it there is no reset control. */
    readonly resetLabel?: string
    /** How the disconnected parts (islands) are arranged: `wrap` (default) rows side by side up to `islandsWidth`, `stack` one column. */
    readonly islands?: "wrap" | "stack"
    /** The width the islands wrap at, in graph units. Default 1200. */
    readonly islandsWidth?: number
    readonly className?: string
}
