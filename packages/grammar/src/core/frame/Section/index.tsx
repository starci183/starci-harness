"use client"

import { useId, type ReactNode } from "react"
import { ListRow } from "../../composite/ListRow/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { FigureCells, figureItems } from "../SurfaceCard/FigureCells.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import type { Figure, ListRowData } from "../../surfaceCardData.js"
import type { NoChildren } from "../../tier.js"
import { SectionCaption, SectionHead, type SectionHeadProps } from "./head.js"

export type { SectionHeadingLevel, SectionHeadProps } from "./head.js"

/** One row of a list section: the same data a list card's row has, drawn by the same row. */
export type SectionRow = ListRowData

type RegionSection = {
    readonly kind?: "region"
    /** What the section holds, set one row step apart under its head (proximity: a container in it takes the inline step or less). */
    readonly children: ReactNode
}

type ListSection = {
    readonly kind: "list"
    readonly items: readonly SectionRow[]
    /** What a list with no row says: one line and its action. */
    readonly empty: ReactNode
    /** The row that narrows the list: a `FilterButtonGroup` and a `SearchField`. Drawn between the head and the rows. */
    readonly filter?: ReactNode
}

type HeadlessFigures = Pick<SectionHeadProps, "id"> & {
    /** Names a strip whose visible heading already belongs to its surrounding region. */
    readonly ariaLabel: string
} & { readonly [Key in keyof Omit<SectionHeadProps, "id">]?: never }

/** A list whose visible heading already belongs to the surrounding region (a pane head): it draws no heading and is named by `ariaLabel`. */
type HeadlessList = ListSection & HeadlessFigures

type FiguresSection = NoChildren & {
    readonly kind: "figures"
    readonly items: readonly Figure[]
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

export type SectionProps = SectionStatus & SectionCaption & ((SectionHeadProps & (RegionSection | ListSection)) | HeadlessList | FiguresSection)

const listRows = (props: ListSection, isLoading: boolean) => {
    if (isLoading && props.items.length === 0) {
        return Array.from({ length: LOADING_ROWS }, (_, index) => <ListRow key={index} row={{ id: String(index), title: " ", description: " " }} isLoading />)
    }
    return props.items.map((row) => <ListRow key={row.id} row={row} isLoading={isLoading} />)
}

const ListBody = ({ list, isLoading, error }: { readonly list: ListSection; readonly isLoading: boolean; readonly error: ErrorData | undefined }) => {
    const ordered = list.items.length > 0 && list.items.every((item) => item.leading?.position !== undefined)
    const Rows = ordered ? "ol" : "ul"
    const filter = list.filter === undefined ? null : (
        <div className="starci-core-section-filter" data-contract="GAP-2">
            {isLoading ? <SkeletonPlaceholder shape="block">{list.filter}</SkeletonPlaceholder> : list.filter}
        </div>
    )
    if (!isLoading && error !== undefined) return <>{filter}<ErrorView error={error} /></>
    return (
        <>
            {filter}
            {!isLoading && list.items.length === 0 ? list.empty : (
                <Rows className="starci-core-section-list" data-contract="MARGIN-0 PADDING-0 GAP-0">
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
 * `kind="region"` (the default) holds `children`. `kind="list"` owns rows inside an existing surface, or a standalone
 * list that searches, filters or pages: typed `items`, an optional `filter` and a required `empty` state. Its title owns
 * the list heading and accessible name. A standalone bounded worklist on the page canvas is `SurfaceCard kind="list"`.
 * `kind="figures"` reuses the unpainted FigureCells strip inside an existing surface; a required `ariaLabel` keeps an
 * already-headed strip headless, while `title` gives a strip its own visible heading. Those forms cannot be mixed.
 */
export const Section = (props: SectionProps) => {
    const { title, description, count, isAttention, fact, meta, action, headingLevel = 2, id, error } = props
    const isLoading = useIsLoading(props.isLoading)
    const failed = !isLoading && error !== undefined
    const headingId = useId()
    const body = (() => {
        if (props.kind === "list") return <ListBody list={props} isLoading={isLoading} error={error} />
        if (failed) return <ErrorView error={error} />
        if (props.kind === "figures") return <FigureCells items={figureItems(props.items, isLoading)} isLoading={isLoading} />
        return <LoadingScope isLoading={isLoading}>{props.children}</LoadingScope>
    })()
    return (
        <section
            id={id}
            aria-labelledby={title === undefined ? undefined : headingId}
            aria-label={title === undefined && "ariaLabel" in props ? props.ariaLabel : undefined}
            aria-busy={isLoading ? true : undefined}
            data-grammar-loading-region={isLoading ? "true" : undefined}
            className="starci-core-section"
            data-component="Section"
            data-tier="frame"
            data-grammar-section-kind={props.kind ?? "region"}
            data-grammar-skeleton={isLoading ? "true" : undefined}
            data-grammar-section-fill={props.fill === true ? "true" : undefined}
            data-contract="GAP-3 MARGIN-0 PADDING-0"
        >
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
