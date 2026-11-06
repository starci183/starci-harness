"use client"

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { HorizontalScrollRegionPart } from "../HorizontalScrollRegion/index.js"
import { SurfaceCard } from "../SurfaceCard/index.js"
import { Heading } from "../../leaf/Heading/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import type { HeaderZone, ListRowData } from "../../surfaceCardData.js"
import { SurfaceNesting } from "../../surfaceContext.js"
import { HeaderZoneView } from "../SurfaceCard/Zones.js"

/** One column of a board: a stage that holds items. */
export type BoardColumn = {
    readonly id: string
    /** The stage's name. */
    readonly title: string
    /** How many items the stage holds, beside the title. Leave it out while it is unknown: it is never `0`. */
    readonly count?: number
    /** The items, drawn as rows. A row with `onPress` opens its item by pressing anywhere on it. */
    readonly items: readonly ListRowData[]
    /** What the column shows when it has no items. Required: every column answers for its empty state. */
    readonly empty: ReactNode
}

/** One move of an item from a stage to another. */
export type BoardMove = {
    readonly itemId: string
    readonly fromColumnId: string
    readonly toColumnId: string
}

/** The app's words for the keyboard move and its announcement. */
export type BoardMoveLabels = {
    /** Explains the key to a screen reader on a focused item, e.g. "Alt and the left or right arrow move this item to the previous or next stage." */
    readonly instructions: string
    /** What is announced after a move, e.g. `Moved Chi Lan to Qualified`. */
    readonly announce: (item: string, column: string) => string
}

export type BoardProps = {
    /** Names the board for assistive technology, e.g. "Sales pipeline". */
    readonly label: string
    readonly columns: readonly BoardColumn[]
    /**
     * Typed zones (the `SurfaceCard` zones: filter, search, toolbar, figures, custom) drawn in ONE white surface strip above the
     * columns, on the well. The strip is the board's only surface of its own; the columns keep theirs. Neighbouring zones are divided
     * by one divider, and a filter or toolbar zone's divider is the line under its tabs. A loading board keeps the zones' geometry;
     * an error replaces the columns, not the strip.
     */
    readonly headers?: readonly HeaderZone[]
    /** Accessible names of the previous and next page controls of the scroller (the app's words). */
    readonly scrollPreviousLabel?: string
    readonly scrollNextLabel?: string
    /** The first read has no data yet: each column draws its ready rows as geometry, its title kept and its count hidden. */
    readonly isLoading?: boolean
    /** The read failed: this takes the board's place, in its region. Loading comes first, then error. */
    readonly error?: ErrorData
    /**
     * Items move between stages: by dragging a card onto a column (which highlights as the drop place), and by the keyboard
     * (Alt + the left or right arrow on a focused card moves it to the neighbour stage and announces it). The board keeps no
     * order of its own; the app applies the move and passes the new columns. Give `moveLabels` with it.
     */
    readonly onMove?: (move: BoardMove) => void
    readonly moveLabels?: BoardMoveLabels
}

/**
 * Items in stages: peer columns side by side that scroll as one row, each column a tinted surface (`--surface-secondary`) with its title and
 * a count chip in its head and its items as white cards (a sales pipeline, a hiring funnel, a task board). (Was: each column a card of rows)
 * (a sales pipeline, a hiring funnel, a task board). Columns share one width from 16rem, and snap into view as the row
 * scrolls, so a phone shows one stage at a time. Each column answers for its own empty state; a loading board draws the
 * columns it was given with placeholder rows (three each when it was given none). With `onMove` a card moves between stages
 * by drag or by keyboard, and a card with `onPress` opens by pressing anywhere on it.
 */
export const Board = ({ label, columns, headers, scrollPreviousLabel, scrollNextLabel, isLoading: ownLoading, error, onMove, moveLabels }: BoardProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [overColumn, setOverColumn] = useState<string | null>(null)
    const [announcement, setAnnouncement] = useState("")
    const root = useRef<HTMLDivElement | null>(null)
    const refocus = useRef<string | null>(null)

    // A moved card remounts in its new column: give the focus back to it so the keyboard can keep moving it.
    useEffect(() => {
        const id = refocus.current
        if (id === null) return
        refocus.current = null
        root.current?.querySelector<HTMLElement>(`[data-grammar-row-id="${CSS.escape(id)}"] button, [data-grammar-row-id="${CSS.escape(id)}"][tabindex]`)?.focus()
    }, [columns])

    const header = headers === undefined || headers.length === 0 ? null : (
        <SurfaceNesting host="chrome">
            <div className="starci-core-board-header" data-grammar-board-header="true" role="group" aria-label={label}>
                {headers.map((zone, index) => <HeaderZoneView key={`${zone.kind}-${index}`} zone={zone} isLoading={isLoading} />)}
            </div>
        </SurfaceNesting>
    )
    if (!isLoading && error !== undefined) {
        return <div data-tier="frame" data-component="Board" data-grammar-board-state="error">{header}<ErrorView error={error} /></div>
    }
    const shown: readonly BoardColumn[] = isLoading && columns.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, title: " ", items: [], empty: null }))
        : columns
    const movable = onMove !== undefined && !isLoading

    const columnOf = (itemId: string): BoardColumn | undefined => columns.find((column) => column.items.some((row) => row.id === itemId))
    const move = (itemId: string, toColumnId: string) => {
        const from = columnOf(itemId)
        const to = columns.find((column) => column.id === toColumnId)
        if (from === undefined || to === undefined || from.id === to.id || onMove === undefined) return
        const item = from.items.find((row) => row.id === itemId)
        refocus.current = itemId
        onMove({ itemId, fromColumnId: from.id, toColumnId: to.id })
        if (moveLabels !== undefined && item !== undefined) setAnnouncement(moveLabels.announce(item.title, to.title))
    }
    const rowsOf = (column: BoardColumn, index: number): readonly ListRowData[] => {
        if (isLoading && column.items.length === 0) return Array.from({ length: LOADING_ROWS }, (_, rowIndex) => ({ id: `loading-${rowIndex}`, title: " " }))
        if (!movable) return column.items
        return column.items.map((row) => ({
            ...row,
            drag: {
                onDragStart: () => setDraggingId(row.id),
                onDragEnd: () => { setDraggingId(null); setOverColumn(null) },
                onMoveKey: (direction) => {
                    const target = columns[index + (direction === "next" ? 1 : -1)]
                    if (target !== undefined) move(row.id, target.id)
                },
                ...(moveLabels === undefined ? {} : { keyHint: moveLabels.instructions }),
            },
        }))
    }
    const dropProps = (column: BoardColumn) => movable ? {
        onDragOver: (event: DragEvent<HTMLElement>) => { if (draggingId === null) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (overColumn !== column.id) setOverColumn(column.id) },
        onDragLeave: (event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn((current) => current === column.id ? null : current) },
        onDrop: (event: DragEvent<HTMLElement>) => {
            event.preventDefault()
            const id = draggingId ?? event.dataTransfer.getData("text/plain")
            setDraggingId(null)
            setOverColumn(null)
            if (id !== "") move(id, column.id)
        },
    } : {}

    return (
        <LoadingScope isLoading={isLoading}>
          <div ref={root} data-tier="frame" data-component="Board" data-grammar-board-state={isLoading ? "loading" : "ready"} {...(draggingId === null ? {} : { "data-grammar-board-dragging": "true" })}>
            {header}
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
                    {shown.map((column, index) => (
                        <div
                            key={column.id}
                            className="starci-core-board-column"
                            {...(overColumn === column.id ? { "data-grammar-drop": "true" } : {})}
                            {...dropProps(column)}
                        >
                            <div className="starci-core-board-column-head" data-contract="GAP-2">
                                <Heading level={3} isLoading={isLoading}>{column.title}</Heading>
                                {column.count === undefined || isLoading ? null : <span className="starci-core-board-count" data-grammar-board-count="true">{column.count}</span>}
                            </div>
                            <div className="starci-core-board-cards" data-contract="GAP-2">
                                {rowsOf(column, index).length === 0 ? <div className="starci-core-board-empty">{column.empty}</div> : rowsOf(column, index).map((row) => (
                                    <SurfaceCard key={row.id} kind="list" ariaLabel={row.title} items={[row]} empty={null} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </HorizontalScrollRegionPart>
            {moveLabels === undefined ? null : <span className="starci-core-board-announce" role="status" aria-live="polite">{announcement}</span>}
          </div>
        </LoadingScope>
    )
}
