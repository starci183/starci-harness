import { createElement, type ReactNode } from "react"
import type { GapRole } from "../../../common/spacing.js"

/** The rule id each gap role carries (contexts/ui/presentation.md, space.choose.gap). */
export const GAP_CONTRACT: Readonly<Record<GapRole, string>> = Object.freeze({
    identity: "GAP-1",
    inline: "GAP-2",
    row: "GAP-3",
    section: "GAP-4",
    region: "GAP-5",
})

/** Where the children stand across the stack. Default `stretch`. */
export type StackAlign = "stretch" | "start" | "center" | "end"
/** A width cap, centred in the host: the reading measure or the form measure. Default `full` (the host's width). */
export type StackMeasure = "full" | "reading" | "form"

export type StackProps = {
    readonly children: ReactNode
    /** The relation between the children, never a number: the Grammar resolves the role to its step. */
    readonly gap: GapRole
    readonly align?: StackAlign
    readonly measure?: StackMeasure
    readonly as?: "div" | "header" | "footer"
}

/**
 * Blocks one after another in the block axis, the distance between them named by their relation (`gap`). The app
 * says which relation its blocks have; the Grammar owns the number. A stack holding two relations is two stacks.
 */
export const Stack = ({ children, gap, align = "stretch", measure = "full", as = "div" }: StackProps) => createElement(
    as,
    {
        className: "starci-core-stack",
        "data-component": "Stack",
        "data-tier": "composition",
        "data-grammar-gap": gap,
        "data-grammar-align": align,
        "data-grammar-measure": measure,
        "data-contract": measure === "full" ? GAP_CONTRACT[gap] : `${GAP_CONTRACT[gap]} MEASURE-4 MARGIN-AUTO`,
    },
    children,
)
