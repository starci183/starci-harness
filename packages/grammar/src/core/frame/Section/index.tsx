"use client"

import { useId, type ReactNode } from "react"
import { ListRow } from "../../composite/ListRow/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { Sublabel } from "../../leaf/Sublabel/index.js"
import { FigureCells, figureItems } from "../SurfaceCard/FigureCells.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import type { Figure, ListRowData } from "../../surfaceCardData.js"
import type { NoChildren } from "../../tier.js"
import { SectionCaption, SectionHead, type SectionHeadProps } from "./head.js"

export type { SectionHeadingLevel, SectionHeadProps } from "./head.js"

/** One row of a list section: the `ListRowData` a Board item has too, drawn by the same `ListRow`. */
export type SectionRow = ListRowData

type RegionSection = {
    readonly kind?: "region"
    /** What the section holds, set one row step apart under its head (proximity: a container in it takes the inline step or less). */
    readonly children: ReactNode
    /**
     * The toolbar that narrows everything the section holds (0.41.0): several lists or groups under one filter, a catalog. `Tabs kind="filter"`, a
     * `SearchField` and its `Select`s, drawn as a flat row between the head and the children, on the surface the section stands on, never a card.
     * A toolbar of one list is that list's own `filter` (`kind="list"`).
     */
    readonly filter?: ReactNode
}

type ListSection = {
    readonly kind: "list"
    /**
     * `rows` (default): title with a supporting line. `keyValue`: each row is a key (`title`, muted, 14) and its `value` (normal text, 14, at the end), so the
     * hierarchy reads key then value. `suggestions` (law DNA-COMMON-CARD-SUGGESTIONS): the replies a message card offers, one row per reply, its plain text (14,
     * regular, wrapping, never truncated) with a trailing chevron; give every row `onPress` (it sends that text) and nothing else.
     */
    readonly layout?: "rows" | "keyValue" | "suggestions"
    readonly items: readonly SectionRow[]
    /** What a list with no row says: one line and its action. */
    readonly empty: ReactNode
    /**
     * The row that narrows the list: `Tabs kind="filter"`, a `SearchField` and its `Select`s, drawn between the head and the rows as the same flat
     * wrapping row a region's `filter` draws (0.43.1).
     */
    readonly filter?: ReactNode
}

type HeadlessFigures = Pick<SectionHeadProps, "id"> & {
    /** Names a strip whose visible heading already belongs to its surrounding region. */
    readonly ariaLabel: string
} & { readonly [Key in keyof Omit<SectionHeadProps, "id">]?: never }

/** A list whose visible heading already belongs to the surrounding region (a pane head): it draws no heading and is named by `ariaLabel`. */
type HeadlessList = ListSection & HeadlessFigures

/**
 * A region whose visible heading already belongs to the page or its surrounding region (0.43.1): a catalog toolbar and its lists under the
 * page title. It draws no heading and is named by `ariaLabel`, as a headless list is.
 */
type HeadlessRegion = RegionSection & HeadlessFigures

type FiguresSection = NoChildren & {
    readonly kind: "figures"
    readonly items: readonly Figure[]
    /**
     * Draws the strip as a ribbon (0.40.0): a full-width band with a hairline (`--separator`) on its top and bottom edges only, the cells divided by
     * vertical hairlines, open ends, no radius and no fill. Off by default: the strip keeps its card or pane placement.
     */
    readonly ribbon?: boolean
} & ((SectionHeadProps & { readonly ariaLabel?: never }) | HeadlessFigures)

/** The status every section takes from its read (contexts/ui/loading.md). */
type SectionStatus = {
    /**
     * The first read has no data yet (knowledge STATE-8). The head keeps its title and draws `meta` and
     * `action` as geometry, and the caption below the body as a skeleton line; the count is hidden; the rows are drawn from the rows given (the block's same-shape placeholder)
     * or a default few; a region's children follow. A refresh that already has data is not loading. Inside a loading
     * region the section follows the region.
     */
    readonly isLoading?: boolean
    /** The read failed: the head stays and this takes the place of the body. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
    /**
     * The section fills the height its host gives it (a cell of a stretched grid): the body (a `SurfaceCard height="fill"`, a `DataTable fill`) takes what the head and the caption leave.
     * A section without it keeps its own height.
     */
    readonly fill?: boolean
}

/** The one line under the body. */
type SectionCaption = {
    /**
     * One muted 12 line under the section's body: what a lone table, list or chart shows, its source or its period. The table, list
     * or chart is the surface and the section is its head and caption (the single-child-card law), never a card around it.
     */
    readonly caption?: string
}

/** No Sublabel: every form that carries a Label or is headless takes none (the types refuse a Label and a Sublabel together). */
type NoSublabel = { readonly sublabel?: never }

/**
 * A GROUP inside a labelled section (0.37.7, LABEL-SUBLABEL-HIERARCHY): it is named by a Sublabel (12 / 500 muted) set 8px above its body, never by a second Label. A section has
 * exactly ONE Label; sibling groups stand 24px apart. `sublabel` and `title` are never given together.
 */
type SublabelSection = (RegionSection | ListSection) & {
    readonly sublabel: string
    readonly id?: string
} & { readonly [Key in keyof Omit<SectionHeadProps, "id">]?: never } & { readonly ariaLabel?: never }

export type SectionProps = SectionStatus & SectionCaption & (
    | (SectionHeadProps & NoSublabel & (RegionSection | ListSection))
    | (HeadlessList & NoSublabel)
    | (HeadlessRegion & NoSublabel)
    | (FiguresSection & NoSublabel)
    | SublabelSection
)

const listRows = (props: ListSection, isLoading: boolean) => {
    if (isLoading && props.items.length === 0) {
        return Array.from({ length: LOADING_ROWS }, (_, index) => <ListRow key={index} row={{ id: String(index), title: " ", description: " " }} isLoading />)
    }
    return props.items.map((row) => <ListRow key={row.id} row={row} isLoading={isLoading} />)
}

/**
 * The flat row that narrows a section's body (a list's rows, or everything a region holds): its peers side by side, never a card. One wrapping
 * row in the order given (tabs, then the search, then the selects), the controls on one bottom edge: the tabs hug their labels, the search
 * grows into what is left, each select keeps its own width. Below the narrow step (the row's own width under 48rem) the peers stack, each
 * the row's full width. A list's filter and a region's are this one row.
 */
const FilterRow = ({ filter, isLoading }: { readonly filter: ReactNode; readonly isLoading: boolean }) => filter === undefined ? null : (
    <div className="starci-core-section-filter" data-contract="GAP-2">
        {isLoading ? <SkeletonPlaceholder shape="block">{filter}</SkeletonPlaceholder> : filter}
    </div>
)

const ListBody = ({ list, isLoading, error }: { readonly list: ListSection; readonly isLoading: boolean; readonly error: ErrorData | undefined }) => {
    const ordered = list.items.length > 0 && list.items.every((item) => item.leading?.position !== undefined)
    const Rows = ordered ? "ol" : "ul"
    const filter = <FilterRow filter={list.filter} isLoading={isLoading} />
    if (!isLoading && error !== undefined) return <>{filter}<ErrorView error={error} /></>
    return (
        <>
            {filter}
            {!isLoading && list.items.length === 0 ? list.empty : (
                <Rows
                    className="starci-core-section-list"
                    role="list"
                    aria-busy={isLoading || undefined}
                    data-grammar-list="true"
                    {...(list.layout === "keyValue" || list.layout === "suggestions" ? { "data-grammar-list-layout": list.layout } : {})}
                    data-contract="MARGIN-0 PADDING-0 GAP-0"
                >
                    {listRows(list, isLoading)}
                </Rows>
            )}
        </>
    )
}

/**
 * A named part of a page: a real `<section>` landmark with no surface, border or padding, headed by its own title.
 * The title is the heading and the landmark's name, so there is no free heading to place and no label to repeat.
 * Its head, its filter and its body are blocks under one heading: one row step apart (GAP-3; the section step before 0.27),
 * one step closer than the region step a section keeps from its siblings (the proximity law).
 *
 * `kind="region"` (the default) holds `children`, with an optional flat `filter` row that narrows all of them (a catalog of several lists under one
 * toolbar, never a rowless card borrowed for its zones); a region whose heading the page already gives takes `ariaLabel` in place of `title`
 * (0.43.1). `kind="list"` is THE list, wherever it stands (the page canvas, a card body, a
 * drawer, a pane): plain rows on the surface, divided by hairlines, aligned with the section title, with no frame, fill, radius or
 * shadow. Typed `items`, an optional `layout`, an optional `filter` and a required `empty` state; its title owns the list heading and
 * accessible name.
 * `kind="figures"` reuses the unpainted FigureCells strip inside an existing surface; a required `ariaLabel` keeps an
 * already-headed strip headless, while `title` gives a strip its own visible heading. Those forms cannot be mixed. `ribbon` draws the strip
 * as a band between two hairlines on the page (no card).
 */
export const Section = (props: SectionProps) => {
    const { title, description, count, isAttention, fact, meta, action, headingLevel = 2, id, error } = props
    const isLoading = useIsLoading(props.isLoading)
    const failed = !isLoading && error !== undefined
    const headingId = useId()
    const body = (() => {
        if (props.kind === "list") return <ListBody list={props} isLoading={isLoading} error={error} />
        if (props.kind === "figures") return failed ? <ErrorView error={error} /> : <FigureCells items={figureItems(props.items, isLoading)} isLoading={isLoading} ribbon={props.ribbon === true} />
        const filter = <FilterRow filter={props.filter} isLoading={isLoading} />
        if (failed) return <>{filter}<ErrorView error={error} /></>
        return <>{filter}<LoadingScope isLoading={isLoading}>{props.children}</LoadingScope></>
    })()
    return (
        <section
            id={id}
            aria-labelledby={title === undefined ? undefined : headingId}
            aria-label={title === undefined ? props.sublabel ?? ("ariaLabel" in props ? props.ariaLabel : undefined) : undefined}
            aria-busy={isLoading ? true : undefined}
            data-grammar-loading-region={isLoading ? "true" : undefined}
            className="starci-core-section"
            data-component="Section"
            data-tier="frame"
            data-grammar-section-kind={props.kind ?? "region"}
            data-grammar-skeleton={isLoading ? "true" : undefined}
            data-grammar-section-fill={props.fill === true ? "true" : undefined}
            data-grammar-section-sublabel={props.sublabel === undefined ? undefined : "true"}
            data-contract="GAP-3 MARGIN-0 PADDING-0"
        >
            {props.sublabel === undefined ? null : <Sublabel>{props.sublabel}</Sublabel>}
            {title === undefined ? null : <SectionHead
                headingId={headingId}
                level={headingLevel}
                title={title}
                count={failed ? undefined : count}
                isAttention={isAttention}
                fact={failed ? undefined : fact}
                meta={meta}
                action={action}
                isLoading={isLoading}
            />}
            {body}
            {failed ? null : <SectionCaption lines={[description, props.caption]} isLoading={isLoading} />}
        </section>
    )
}
