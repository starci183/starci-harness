import { useId, type ReactNode } from "react"
import { ListRow } from "../../composite/ListRow/index.js"
import type { ListRowData } from "../../surfaceCardData.js"
import { SectionHead, type SectionHeadProps } from "./head.js"

export type { SectionHeadingLevel, SectionHeadProps } from "./head.js"

/** One row of a list section: the same data a list card's row has, drawn by the same row. */
export type SectionRow = ListRowData

type RegionSection = {
    readonly kind?: "region"
    /** What the section holds, set one section step apart under its head. */
    readonly children: ReactNode
}

type ListSection = {
    readonly kind: "list"
    readonly items: readonly SectionRow[]
    /** What a list with no row says: one line and its action. */
    readonly empty: ReactNode
    /** The row that narrows the list: a `FilterButtonGroup` and a `SearchField`. Drawn between the head and the rows. */
    readonly filter?: ReactNode
    /** How many placeholder rows the loading list draws. Default 3. */
    readonly loadingRows?: number
}

export type SectionProps = SectionHeadProps & (RegionSection | ListSection)

const listRows = (props: ListSection, isSkeleton: boolean) => {
    if (isSkeleton) {
        const count = props.loadingRows ?? 3
        return Array.from({ length: count }, (_, index) => <ListRow key={index} row={{ id: String(index), title: " ", description: " " }} isSkeleton />)
    }
    return props.items.map((row) => <ListRow key={row.id} row={row} />)
}

const ListBody = ({ list, isSkeleton }: { readonly list: ListSection; readonly isSkeleton: boolean }) => {
    const ordered = list.items.length > 0 && list.items.every((item) => item.leading?.position !== undefined)
    const Rows = ordered ? "ol" : "ul"
    return (
        <>
            {list.filter === undefined || isSkeleton ? null : <div className="starci-core-section-filter" data-contract="GAP-2">{list.filter}</div>}
            {!isSkeleton && list.items.length === 0 ? list.empty : (
                <Rows className="starci-core-section-list" data-contract="MARGIN-0 PADDING-0 GAP-0">
                    {listRows(list, isSkeleton)}
                </Rows>
            )}
        </>
    )
}

/**
 * A named part of a page: a real `<section>` landmark with no surface, border or padding, headed by its own title.
 * The title is the heading and the landmark's name, so there is no free heading to place and no label to repeat.
 * Its head, its filter and its body are blocks under one heading: one section step apart (GAP-4).
 *
 * `kind="region"` (the default) holds `children`. `kind="list"` is the long list that searches or filters: it draws
 * `items` as rows under an optional `filter` row, and an `empty` line when there are none. A short list to work through
 * is a `SurfaceCard kind="list"`, not a section.
 */
export const Section = (props: SectionProps) => {
    const { title, description, count, meta, action, headingLevel = 2, id, isSkeleton = false } = props
    const headingId = useId()
    return (
        <section
            id={id}
            aria-labelledby={headingId}
            aria-busy={isSkeleton ? true : undefined}
            className="starci-core-section"
            data-component="Section"
            data-tier="frame"
            data-grammar-section-kind={props.kind === "list" ? "list" : "region"}
            data-grammar-skeleton={isSkeleton ? "true" : undefined}
            data-contract="GAP-4 MARGIN-0 PADDING-0"
        >
            <SectionHead
                headingId={headingId}
                level={headingLevel}
                title={title}
                description={description}
                count={count}
                meta={meta}
                action={action}
                isSkeleton={isSkeleton}
            />
            {props.kind === "list" ? <ListBody list={props} isSkeleton={isSkeleton} /> : props.children}
        </section>
    )
}
