"use client"

import type { ListData, ListRowData } from "../../surfaceCardData.js"
import { ListRow } from "../../composite/ListRow/index.js"
import { collectionClassName } from "./classNames.js"

const DEFAULT_LOADING_ROWS = 3
const clampRows = (rows: number) => Math.min(12, Math.max(1, Math.floor(Number.isFinite(rows) ? rows : DEFAULT_LOADING_ROWS)))

/**
 * The collection a `kind="list"` holds: a real `<ul role="list">` of rows drawn by `ListRow`, or the `empty` content in
 * the same slot. Shared by a card and a `Section` of rows, so one data shape has one drawing. A loading list draws the
 * rows it was given as geometry, or `loadingRows` bare ones.
 */
export const ListRows = ({ data, isSkeleton, ariaLabel }: {
    readonly data: ListData
    readonly isSkeleton: boolean
    readonly ariaLabel?: string | undefined
}) => {
    const isVerdict = data.items.some((row) => row.verdict !== undefined)
    if (!isSkeleton && data.items.length === 0) {
        return <div className={collectionClassName} data-grammar-collection="empty">{data.empty}</div>
    }
    const rows: readonly ListRowData[] = isSkeleton && data.items.length === 0
        ? Array.from({ length: clampRows(data.loadingRows ?? DEFAULT_LOADING_ROWS) }, (_, index) => ({ id: `skeleton-${index}`, title: "" }))
        : data.items
    return (
        <ul
            aria-label={ariaLabel}
            aria-busy={isSkeleton || undefined}
            className={collectionClassName}
            data-grammar-collection={isVerdict ? "verdict" : "list"}
            data-grammar-list="true"
            data-loading={String(isSkeleton)}
            role="list"
        >
            {rows.map((row) => <ListRow key={row.id} row={row} isSkeleton={isSkeleton} />)}
        </ul>
    )
}
