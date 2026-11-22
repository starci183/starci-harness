import { createElement as h, type ReactElement } from "react"
import { Skeleton } from "../../../index.js"

/** Nodes per column of the skeleton graph: a graph that fans out and joins again. */
export const SKELETON_COLUMNS: readonly number[] = [1, 2, 1]

/** The loading state of a graph: bones in the shape of nodes and the lines between them, and no text at all. */
export const GraphSkeleton = (): ReactElement =>
    h(
        "div",
        { className: "starci-graph-skeleton", "aria-hidden": true },
        SKELETON_COLUMNS.flatMap((count, column) => [
            ...(column === 0 ? [] : [h("span", { key: `line-${String(column)}`, className: "starci-graph-skeleton-line" })]),
            h(
                "div",
                { key: `column-${String(column)}`, className: "starci-graph-skeleton-column" },
                Array.from({ length: count }, (_, row) =>
                    h(
                        "div",
                        { key: row, className: "starci-graph-skeleton-node" },
                        // The core's Skeleton: the 40px tile and the two text lines of a card.
                        h("span", { className: "starci-graph-skeleton-tile" }, h(Skeleton, { shape: "circle" })),
                        h("span", { className: "starci-graph-skeleton-lines" }, h(Skeleton, { shape: "text", lines: 2 })),
                    ),
                ),
            ),
        ]),
    )
