import { Children, type ReactNode } from "react"
import { FormGrid, type FormGridColumns } from "../FormGrid/index.js"
import { PrimaryRailLayout, type PrimaryRailLayoutProps } from "../PrimaryRailLayout/index.js"
import type { NoChildren } from "../../tier.js"

/**
 * The most cards a row of a `cards` grid holds once its width allows; below that it holds fewer. `balanced` (0.36.2) picks the cap from the number of
 * cards so the last row is never one orphan: 5 or 6 cards cap at 3 (3 + 2, 3 + 3), 7 or 8 at 4 (4 + 3, 4 + 4), up to 4 cards at their own count.
 */
export type GridCardColumns = 2 | 3 | 4 | 5 | "balanced"

/** The column cap a `balanced` grid of `count` cards takes. */
export const balancedColumns = (count: number): 2 | 3 | 4 => count <= 2 ? 2 : count <= 3 ? 3 : count === 4 ? 4 : count <= 6 ? 3 : 4

type GridCardsProps = {
    /** Peer cards of one collection: equal tracks, the inline gap on both axes. */
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
    /** A dated event agenda, or one summary per day; the kind owns its responsive tracks and spacing (both the inline gap). */
    readonly kind: "week" | "week-summary"
    readonly label: string
    /** Seven consecutive days in reading order, including the days with no entries. */
    readonly children: ReactNode
}

type GridSectionsProps = {
    /** Independent named working regions; each child keeps its own heading owner. */
    readonly kind: "sections"
    readonly children: ReactNode
}

type GridPairProps = NoChildren & {
    /** Two equal portions of one reading or comparison unit, in reading order. */
    readonly kind: "pair"
    readonly leading: ReactNode
    readonly trailing: ReactNode
}

type GridFeaturedProps = NoChildren & {
    /** One focus between two symmetric supporting groups, in reading order. */
    readonly kind: "featured"
    readonly leading: ReactNode
    readonly featured: ReactNode
    readonly trailing: ReactNode
}

export type GridKind = "cards" | "form" | "main-rail" | "week" | "week-summary" | "sections" | "pair" | "featured"
export type GridProps = GridCardsProps | GridFormProps | GridMainRailProps | GridWeekProps | GridSectionsProps | GridPairProps | GridFeaturedProps

const RelatedRegions = (props: GridSectionsProps | GridPairProps | GridFeaturedProps) => (
    <div className="starci-core-grid-relations" data-component="Grid" data-tier="frame" data-grammar-grid-kind={props.kind} data-contract="LAYOUT-2 GAP-4 RESPONSIVE-1">
        <div className="starci-core-grid-regions">
            {props.kind === "sections" ? props.children : (
                <>
                    <div data-grammar-grid-slot="leading">{props.leading}</div>
                    {props.kind === "featured" ? <div data-grammar-grid-slot="featured">{props.featured}</div> : null}
                    <div data-grammar-grid-slot="trailing">{props.trailing}</div>
                </>
            )}
        </div>
    </div>
)

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
            data-contract="GAP-2 RESPONSIVE-1"
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
    if (props.kind === "sections" || props.kind === "pair" || props.kind === "featured") return <RelatedRegions {...props} />
    if (props.kind !== "cards") return <WeekGrid {...props} />
    return (
        <div
            className="starci-core-grid"
            data-component="Grid"
            data-tier="frame"
            data-grammar-grid-kind="cards"
            data-grammar-grid-columns={props.columns === undefined ? "fit" : props.columns === "balanced" ? String(balancedColumns(Children.toArray(props.children).length)) : String(props.columns)}
            data-contract="GAP-2 RESPONSIVE-1"
        >
            {props.children}
        </div>
    )
}
