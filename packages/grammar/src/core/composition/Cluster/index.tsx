import type { ReactNode } from "react"
import type { GapRole } from "../../../common/spacing.js"
import { GAP_CONTRACT } from "../Stack/index.js"

/** The relations a cluster's items can have: a cluster never holds regions. */
export type ClusterGap = Exclude<GapRole, "region">
/** Where the items stand across the line. Default `center`. */
export type ClusterAlign = "start" | "center" | "baseline" | "end"
/** How the items share the line. Default `start`. */
export type ClusterJustify = "start" | "end" | "between"

export type ClusterProps = {
    readonly children: ReactNode
    /** One relation on both axes: a wrapped line is the same set, so the row gap equals the column gap. */
    readonly gap: ClusterGap
    /** Default true; `false` keeps one line (a toolbar group whose own owner scrolls or truncates). */
    readonly wrap?: boolean
    readonly align?: ClusterAlign
    readonly justify?: ClusterJustify
}

/**
 * Items side by side in the inline axis that wrap onto further lines (chips, filters, a toolbar group, a badge
 * row). The column gap and the row gap are the one relation `gap` names.
 */
export const Cluster = ({ children, gap, wrap = true, align = "center", justify = "start" }: ClusterProps) => (
    <div
        className="starci-core-cluster"
        data-component="Cluster"
        data-tier="composition"
        data-grammar-gap={gap}
        data-grammar-wrap={wrap ? "true" : "false"}
        data-grammar-align={align}
        data-grammar-justify={justify}
        data-contract={GAP_CONTRACT[gap]}
    >
        {children}
    </div>
)
