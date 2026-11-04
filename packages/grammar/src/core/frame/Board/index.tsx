"use client"

import { HorizontalScrollRegionPart } from "../HorizontalScrollRegion/index.js"
import { SurfaceCard } from "../SurfaceCard/index.js"
import { ErrorView, LoadingScope, useIsLoading, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import type { ListRowData } from "../../surfaceCardData.js"
import type { ReactNode } from "react"

/** One column of a board: a stage that holds items. */
export type BoardColumn = {
    readonly id: string
    /** The stage's name. */
    readonly title: string
    /** How many items the stage holds, beside the title. Leave it out while it is unknown: it is never `0`. */
    readonly count?: number
    /** The items, drawn as rows. */
    readonly items: readonly ListRowData[]
    /** What the column shows when it has no items. Required: every column answers for its empty state. */
    readonly empty: ReactNode
}

export type BoardProps = {
    /** Names the board for assistive technology, e.g. "Sales pipeline". */
    readonly label: string
    readonly columns: readonly BoardColumn[]
    /** Accessible names of the previous and next page controls of the scroller (the app's words). */
    readonly scrollPreviousLabel?: string
    readonly scrollNextLabel?: string
    /** The first read has no data yet: each column draws its ready rows as geometry, its title kept and its count hidden. */
    readonly isLoading?: boolean
    /** The read failed: this takes the board's place, in its region. Loading comes first, then error. */
    readonly error?: ErrorData
}

/**
 * Items in stages: peer columns side by side that scroll as one row, each column a card of rows with its title and count
 * (a sales pipeline, a hiring funnel, a task board). Columns share one width from 16rem, and snap into view as the row
 * scrolls, so a phone shows one stage at a time. Each column answers for its own empty state; a loading board draws the
 * columns it was given with placeholder rows (three each when it was given none).
 */
export const Board = ({ label, columns, scrollPreviousLabel, scrollNextLabel, isLoading: ownLoading, error }: BoardProps) => {
    const isLoading = useIsLoading(ownLoading)
    if (!isLoading && error !== undefined) {
        return <div data-tier="frame" data-component="Board" data-grammar-board-state="error"><ErrorView error={error} /></div>
    }
    const shown: readonly BoardColumn[] = isLoading && columns.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, title: " ", items: [], empty: null }))
        : columns
    return (
        <LoadingScope isLoading={isLoading}>
          <div data-tier="frame" data-component="Board" data-grammar-board-state={isLoading ? "loading" : "ready"}>
            <HorizontalScrollRegionPart
                aria-label={label}
                carets={false}
                overflow="needed"
                {...(scrollPreviousLabel === undefined ? {} : { scrollPreviousLabel })}
                {...(scrollNextLabel === undefined ? {} : { scrollNextLabel })}
                className="starci-core-board"
                {...(isLoading ? { "aria-busy": true } : {})}
            >
                <div className="starci-core-board-columns" data-contract="GAP-3">
                    {shown.map((column) => (
                        <div key={column.id} className="starci-core-board-column">
                            <SurfaceCard
                                kind="list"
                                label={column.title}
                                {...(column.count === undefined ? {} : { fact: String(column.count) })}
                                items={column.items.length === 0 && isLoading ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, title: " " })) : column.items}
                                empty={column.empty}
                            />
                        </div>
                    ))}
                </div>
            </HorizontalScrollRegionPart>
          </div>
        </LoadingScope>
    )
}
