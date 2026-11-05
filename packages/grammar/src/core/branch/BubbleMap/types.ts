import type { FlowGraphNode, FlowGraphTone } from "../FlowGraph/types.js"

/** How a node draws: a `label` pill that carries its words, or a `bubble` disc that carries a short `mark` and is named on hover. */
export type BubbleMapNodeForm = "label" | "bubble"
/**
 * The paint of a node beyond its tone, so a status never rests on colour alone: `solid` (a full disc), `half` (the lower half
 * filled), `soft` (a tint), `outline` (a dashed edge on the surface) and `hatched` (diagonal stripes with a dotted edge).
 */
export type BubbleMapFill = "solid" | "half" | "soft" | "outline" | "hatched"
/** One arc of a status ring: its tone and its share. The arcs run clockwise from the top in the order given. */
export type BubbleMapRingPart = {
    readonly tone: FlowGraphTone
    readonly value: number
}

export type BubbleMapNode = Omit<FlowGraphNode, "kind" | "position"> & {
    /** `bubble` draws a disc (see {@link BubbleMapNodeForm}). Defaults to `label`. */
    readonly form?: BubbleMapNodeForm
    /** The text inside a bubble, at most 4 characters (`02`, `PDF`); longer text is cut to 4. Hidden under zoom 0.5. */
    readonly mark?: string
    /**
     * The name inside a bubble, whatever its length: it wraps to two lines and its type scales with the disc, so it is never cut ("Bang gia va menu").
     * Hidden under zoom 0.42.
     */
    readonly caption?: string
    /** One small line under the caption (a count: "3 hoso"), scaled with it and never cut. Hidden with the caption. */
    readonly detail?: string
    /** The bubble width in graph units, 24 to 128 (default 48). Size it with `bubbleDiameter(value, max)` so area tracks value. */
    readonly diameter?: number
    /** The paint of the node beyond its tone. Defaults to `soft` for a bubble. */
    readonly fill?: BubbleMapFill
    /** A conic status ring round an inner disc, one arc per part. A bubble only. */
    readonly ring?: ReadonlyArray<BubbleMapRingPart>
}

export type BubbleMapEdge = {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly isPlaceholder?: boolean
}
