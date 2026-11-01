import { Children, type ReactNode } from "react"
import { FormGrid, type FormGridColumns } from "../FormGrid/index.js"
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
    /** The fields of one form, through the form layout: labels, controls and messages on shared rows. */
    readonly kind: "form"
    readonly children: ReactNode
    readonly columns?: FormGridColumns
}

type GridMainRailProps = Omit<PrimaryRailLayoutProps, "className"> & {
    /** Dominant content and one subordinate rail, the region gap between them on both axes. */
    readonly kind: "main-rail"
}

type GridWeekProps = {
    /** A dated event agenda, or one summary per day; the kind owns its responsive tracks and spacing. */
    readonly kind: "week" | "week-summary"
    readonly label: string
    /** Seven consecutive days in reading order, including the days with no entries. */
    readonly children: ReactNode
}

export type GridKind = "cards" | "form" | "main-rail" | "week" | "week-summary"
export type GridProps = GridCardsProps | GridFormProps | GridMainRailProps | GridWeekProps

const WeekGrid = ({ kind, label, children }: GridWeekProps) => {
    if (process.env.NODE_ENV !== "production" && Children.count(children) !== 7) throw new Error("GRID_WEEK_REQUIRES_SEVEN_DAYS: supply seven consecutive day regions, including empty days")
    return (
        <div
            aria-label={label}
            role="region"
            className="starci-core-grid-week"
            data-component="Grid"
            data-tier="frame"
            data-grammar-grid-kind={kind}
            data-contract="GAP-4 RESPONSIVE-1"
        >
            <div className="starci-core-grid-week-days">{children}</div>
        </div>
    )
}

/**
 * A two-dimensional layout named by what it lays out. `cards` is the Grammar's card grid; `form` is the form layout
 * and `main-rail` the primary-and-rail layout, so each layout has one owner and the app names it by kind. No kind takes a class or a gap: the kind decides both.
 */
export const Grid = (props: GridProps) => {
    if (props.kind === "form") {
        return props.columns === undefined ? <FormGrid>{props.children}</FormGrid> : <FormGrid columns={props.columns}>{props.children}</FormGrid>
    }
    if (props.kind === "main-rail") {
        const { kind, ...layout } = props
        return <PrimaryRailLayout {...layout} />
    }
    if (props.kind === "week" || props.kind === "week-summary") return <WeekGrid {...props} />
    return (
        <div
            className="starci-core-grid"
            data-component="Grid"
            data-tier="frame"
            data-grammar-grid-kind="cards"
            data-grammar-grid-columns={props.columns === undefined ? "fit" : String(props.columns)}
            data-contract="GAP-4 RESPONSIVE-1"
        >
            {props.children}
        </div>
    )
}
