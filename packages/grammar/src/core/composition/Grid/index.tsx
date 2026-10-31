import type { ReactNode } from "react"
import { FormGrid, type FormGridColumns } from "../../composite/FormGrid/index.js"
import { PrimaryRailLayout, type PrimaryRailLayoutProps } from "../PrimaryRailLayout/index.js"

/** The most cards a row of a `cards` grid holds once its width allows; below that it holds fewer. */
export type GridCardColumns = 2 | 3 | 4

type GridCardsProps = {
    /** Peer cards of one collection: equal tracks, the section gap on both axes. */
    readonly kind: "cards"
    readonly children: ReactNode
    /** The most cards per row. Omit it to fit as many tracks of the card minimum as the width holds. */
    readonly columns?: GridCardColumns
}

type GridFormProps = {
    /** The fields of one form, through the form layout (`FormGrid`): labels, controls and messages on shared rows. */
    readonly kind: "form"
    readonly children: ReactNode
    readonly columns?: FormGridColumns
}

type GridMainRailProps = Omit<PrimaryRailLayoutProps, "className"> & {
    /** Dominant content and one subordinate rail (`PrimaryRailLayout`), the region gap between them on both axes. */
    readonly kind: "main-rail"
}

export type GridKind = "cards" | "form" | "main-rail"
export type GridProps = GridCardsProps | GridFormProps | GridMainRailProps

/**
 * A two-dimensional layout named by what it lays out. `cards` is the Grammar's card grid; `form` is the form layout
 * and `main-rail` the primary-and-rail layout, the same components `FormGrid` and `PrimaryRailLayout` render, so each
 * layout has one owner and the app names it by kind. No kind takes a class or a gap: the kind decides both.
 */
export const Grid = (props: GridProps) => {
    if (props.kind === "form") {
        return props.columns === undefined ? <FormGrid>{props.children}</FormGrid> : <FormGrid columns={props.columns}>{props.children}</FormGrid>
    }
    if (props.kind === "main-rail") {
        const { kind, ...layout } = props
        return <PrimaryRailLayout {...layout} />
    }
    return (
        <div
            className="starci-core-grid"
            data-component="Grid"
            data-tier="composition"
            data-grammar-grid-kind="cards"
            data-grammar-grid-columns={props.columns === undefined ? "fit" : String(props.columns)}
            data-contract="GAP-4 RESPONSIVE-1"
        >
            {props.children}
        </div>
    )
}
