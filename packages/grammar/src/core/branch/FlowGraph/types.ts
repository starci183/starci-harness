export type FlowGraphTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "muted"
export type FlowGraphNodeSize = "sm" | "md" | "lg"
export type FlowGraphHeight = "sm" | "md" | "lg"
/**
 * The outline of a node, the flowchart shapes: `stadium` (the default pill), `rect` (a step), `round` (a rounded step),
 * `diamond` (a decision) and `circle` (a start or end point).
 */
export type FlowGraphNodeShape = "stadium" | "rect" | "round" | "diamond" | "circle"
/**
 * `radial` rings the nodes round the root, `layered` puts a DAG in layers, `manual` uses each node's `position`, and `orbit`
 * is the value-sized map: the root at the centre, then sectors, a staggered ring and the fans of open nodes.
 */
export type FlowGraphLayout = "radial" | "manual" | "layered" | "orbit"
/** How a node draws: a `label` pill that carries its words, or a `bubble` disc that carries a short `mark` and is named on hover. */
export type FlowGraphNodeForm = "label" | "bubble"
/**
 * The paint of a node beyond its tone, so a status never rests on colour alone: `solid` (a full disc), `half` (the lower half
 * filled), `soft` (a tint), `outline` (a dashed edge on the surface) and `hatched` (diagonal stripes with a dotted edge).
 */
export type FlowGraphFill = "solid" | "half" | "soft" | "outline" | "hatched"
/** One arc of a status ring: its tone and its share. The arcs run clockwise from the top in the order given. */
export type FlowGraphRingPart = {
    readonly tone: FlowGraphTone
    readonly value: number
}
/** The way edges run: top to bottom or left to right. */
export type FlowGraphDirection = "TB" | "LR"

export type FlowGraphNode = {
    readonly id: string
    readonly label: string
    readonly description?: string
    readonly tone?: FlowGraphTone
    readonly size?: FlowGraphNodeSize
    /** The node outline. Defaults to `stadium`. */
    readonly shape?: FlowGraphNodeShape
    readonly count?: number | string
    /** `bubble` draws a disc (see {@link FlowGraphNodeForm}). Defaults to `label`. */
    readonly form?: FlowGraphNodeForm
    /** The text inside a bubble, at most 4 characters (`02`, `PDF`); longer text is cut to 4. Hidden under zoom 0.5. */
    readonly mark?: string
    /** A second line inside a large bubble. Hidden under zoom 0.42. */
    readonly caption?: string
    /** The bubble width in graph units, 24 to 128 (default 48). Size it with `flowGraphDiameter(value, max)` so area tracks value. */
    readonly diameter?: number
    /** The paint of the node beyond its tone. Defaults to `soft` for a bubble. */
    readonly fill?: FlowGraphFill
    /** A conic status ring round an inner disc, one arc per part. A bubble only. */
    readonly ring?: ReadonlyArray<FlowGraphRingPart>
    /** Filtered out: the node draws faint, keeps its place and stays focusable; an edge dims with its target. */
    readonly isDimmed?: boolean
    /** The centre of a radial or orbit layout. Defaults to the first node. */
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
}

/**
 * A header for one layer of a layered layout: a column title above the layer for `LR`, a lane title beside it for `TB`.
 * `at` is the layer index (0 first) in `layout="layered"`, and the coordinate along the layer axis in graph units in `layout="manual"`.
 */
export type FlowGraphLayerHeader = {
    readonly label: string
    readonly at: number
}
