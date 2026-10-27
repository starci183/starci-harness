export type FlowGraphTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted"
export type FlowGraphNodeSize = "sm" | "md" | "lg"
export type FlowGraphHeight = "sm" | "md" | "lg"
export type FlowGraphLayout = "radial" | "manual" | "layered"
/** The way edges run: top to bottom or left to right. */
export type FlowGraphDirection = "TB" | "LR"

export type FlowGraphNode = {
    readonly id: string
    readonly label: string
    readonly description?: string
    readonly tone?: FlowGraphTone
    readonly size?: FlowGraphNodeSize
    readonly count?: number | string
    /** The centre of a radial layout. Defaults to the first node. */
    readonly isRoot?: boolean
    /** A slot not filled yet: dashed outline, muted. */
    readonly isPlaceholder?: boolean
    /** Where the node sits in `layout="manual"`, as its centre in graph units. */
    /** Makes the node a link. It navigates through the root's router (`navigate`/`useHref`) and is one keyboard stop (Enter). */
    readonly href?: string
    readonly position?: { readonly x: number, readonly y: number }
}

export type FlowGraphEdge = {
    readonly id: string
    readonly source: string
    readonly target: string
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
