import { Fragment, createElement as h, type ReactElement } from "react"
import { InlineStatus, Text } from "../../../index.js"
import { edgeClassName, edgeKindClassName, kindTone, markState, type EdgeStyle } from "./status.js"
import { GRAPH_EDGE_KINDS, type FlowKindTones, type FlowLegendItem, type GraphEdgeKind } from "../types.js"

const isKind = (value: string): value is GraphEdgeKind => (GRAPH_EDGE_KINDS as readonly string[]).includes(value)

export interface FlowLegendProps {
    readonly items: readonly FlowLegendItem[]
    /** The same `kindTones` the graph gets, so a swatch has the tone of its kind. */
    readonly kindTones?: FlowKindTones
    readonly className?: string
}

const swatch = (item: FlowLegendItem, kindTones: FlowKindTones | undefined): ReactElement => {
    if (item.edge !== undefined) {
        const edge = item.edge
        // A kind is drawn as an untouched edge of that kind; a style as an edge in that run style.
        const classes = isKind(edge) ? `${edgeClassName("plain")} ${edgeKindClassName(edge)}` : edgeClassName(edge as EdgeStyle)
        return h(
            "span",
            { className: `starci-graph-legend-edge ${classes}`, "aria-hidden": true },
            h("svg", { width: 28, height: 8, viewBox: "0 0 28 8" }, h("path", { className: "react-flow__edge-path", d: "M1 4H27" })),
        )
    }
    if (item.kind === "loop") return h("span", { className: "starci-graph-legend-loop", "aria-hidden": true })
    return h("span", { className: "starci-graph-legend-kind", "data-shape": item.shape, "data-tile-tone": item.kind === undefined ? "default" : kindTone(item.kind, kindTones), "aria-hidden": true })
}

/** The legend of a graph: a row of swatches (a step kind, a node state, a loop frame or an edge style) with the app's words. `FlowGraph` draws it under its canvas when it gets `legend`; inside a card, place it under the card. */
export const FlowLegend = ({ items, kindTones, className }: FlowLegendProps): ReactElement =>
    h(
        "ul",
        { className: className === undefined ? "starci-graph-legend starci-type-caption" : `starci-graph-legend starci-type-caption ${className}` },
        // A state row is the core's InlineStatus (its glyph and the app's word); the other swatches stand before a caption.
        items.map((item, index) =>
            h("li", { key: index, className: "starci-graph-legend-item" }, item.status !== undefined ? h(InlineStatus, { state: markState(item.status), label: item.label }) : h(Fragment, null, swatch(item, kindTones), h(Text, { role: "caption" }, item.label))),
        ),
    )
