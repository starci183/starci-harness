export type FlowGraphTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted"
export type FlowGraphNodeSize = "sm" | "md" | "lg"
export type FlowGraphHeight = "sm" | "md" | "lg"
/**
 * The outline of a node, the flowchart shapes: `stadium` (the default pill), `rect` (a step), `round` (a rounded step),
 * `diamond` (a decision) and `circle` (a start or end point).
 */
export type FlowGraphNodeShape = "stadium" | "rect" | "round" | "diamond" | "circle"
export type FlowGraphLayout = "radial" | "manual" | "layered"
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
}

/**
 * A header for one layer of a layered layout: a column title above the layer for `LR`, a lane title beside it for `TB`.
 * `at` is the layer index (0 first) in `layout="layered"`, and the coordinate along the layer axis in graph units in `layout="manual"`.
 */
export type FlowGraphLayerHeader = {
    readonly label: string
    readonly at: number
}
