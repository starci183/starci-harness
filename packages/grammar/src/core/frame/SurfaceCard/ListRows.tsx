"use client"

import type { ListData, ListRowData } from "../../surfaceCardData.js"
import { ListRow } from "../../composite/ListRow/index.js"
import { LOADING_ROWS } from "../../loadingState.js"
import { collectionClassName } from "./classNames.js"

/**
 * The collection a `kind="list"` holds: a real `<ul role="list">` of rows drawn by `ListRow`, or the `empty` content in
 * the same slot. Shared by a card and a `Section` of rows, so one data shape has one drawing. A loading list draws the
 * rows it was given as geometry (the block's same-shape placeholder), or a default few when it was given none.
 */
export const ListRows = ({ data, isLoading, ariaLabel }: {
    readonly data: ListData
    readonly isLoading: boolean
    readonly ariaLabel?: string | undefined
}) => {
    const isVerdict = data.items.some((row) => row.verdict !== undefined)
    if (!isLoading && data.items.length === 0) {
        return <div className={collectionClassName} data-grammar-collection="empty">{data.empty}</div>
    }
    const rows: readonly ListRowData[] = isLoading && data.items.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `skeleton-${index}`, title: "", description: "" }))
        : data.items
    return (
        <ul
            aria-label={ariaLabel}
            aria-busy={isLoading || undefined}
            className={collectionClassName}
            data-grammar-collection={isVerdict ? "verdict" : "list"}
            data-grammar-list="true"
            {...(data.layout === "keyValue" ? { "data-grammar-list-layout": "keyValue" } : {})}
            data-loading={String(isLoading)}
            role="list"
        >
            {rows.map((row) => <ListRow key={row.id} row={row} isLoading={isLoading} />)}
        </ul>
    )
}
