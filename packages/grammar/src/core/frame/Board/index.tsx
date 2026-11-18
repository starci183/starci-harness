"use client"

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { HorizontalScrollRegionPart } from "../HorizontalScrollRegion/index.js"
import { ListRow } from "../../composite/ListRow/index.js"
import { Heading } from "../../leaf/Heading/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import type { ListRowData } from "../../surfaceCardData.js"
import { FilterRow } from "../Section/index.js"

/** How long a refused move's reason stays written in its column (ms); it was announced when it happened. */
const REFUSAL_SHOWN_MS = 5000

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
    /**
     * Whether this stage takes the item of `move` (0.46.2): `null` lets it in, a string REFUSES it and is the reason, in the app's words ("Add a quote before it can be won").
     * A refusing column still takes the pointer (the drag shows it cannot drop there and the reason shows in the column) but the item does not move: the card springs back to where it
     * was, `onMove` does not run, and the reason is announced (`role="status"`) and handed to `onRefuse`. The keyboard move is held to the same answer. Pure: it runs on every drag-over.
     */
    readonly canDrop?: (move: BoardMove) => string | null
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
     * The row that narrows the board: `Tabs kind="filter"`, a `SearchField` and its `Select`s, drawn above the columns as the same flat
     * wrapping row a `Section`'s `filter` draws, never a card. A loading board keeps its geometry; an error replaces the columns, not the row.
     */
    readonly filter?: ReactNode
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
    /** A move a column's `canDrop` refused, with its reason (0.46.2): the app may also raise a Toast. The Board has already announced the reason. */
    readonly onRefuse?: (move: BoardMove, reason: string) => void
}

/**
 * Items in stages: peer columns side by side that scroll as one row, each column a tinted surface (`--surface-secondary`) with its title and
 * a count chip in its head and its items as white cards (a sales pipeline, a hiring funnel, a task board). An item is a real object, so it is
 * a card: the Board draws each `ListRow` on its own card face (a `<ul>` of rows per column, never `SurfaceCard`). Columns share one width from 16rem, and snap into view as the row
 * scrolls, so a phone shows one stage at a time. Each column answers for its own empty state; a loading board draws the
 * columns it was given with placeholder rows (three each when it was given none). With `onMove` a card moves between stages
 * by drag or by keyboard, and a card with `onPress` opens by pressing anywhere on it.
 */
export const Board = ({ label, columns, filter, scrollPreviousLabel, scrollNextLabel, isLoading: ownLoading, error, onMove, moveLabels, onRefuse }: BoardProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [overColumn, setOverColumn] = useState<string | null>(null)
    const [announcement, setAnnouncement] = useState("")
    /** The column a drag is over and the reason it refuses the dragged card; read again at drag end, when the card has sprung back. */
    const [refusal, setRefusal] = useState<{ readonly columnId: string; readonly reason: string } | null>(null)
    const refusalRef = useRef<{ readonly move: BoardMove; readonly reason: string } | null>(null)
    const clearRefusalTimer = useRef<number | undefined>(undefined)
    useEffect(() => () => { if (clearRefusalTimer.current !== undefined) window.clearTimeout(clearRefusalTimer.current) }, [])
    const root = useRef<HTMLDivElement | null>(null)
    const refocus = useRef<string | null>(null)

    // A moved card remounts in its new column: give the focus back to it so the keyboard can keep moving it.
    useEffect(() => {
        const id = refocus.current
        if (id === null) return
        refocus.current = null
        root.current?.querySelector<HTMLElement>(`[data-grammar-row-id="${CSS.escape(id)}"] button, [data-grammar-row-id="${CSS.escape(id)}"][tabindex]`)?.focus()
    }, [columns])

    const header = filter === undefined ? null : (
        <div className="starci-core-board-header" data-grammar-board-header="true" role="group" aria-label={label}>
            <FilterRow filter={filter} isLoading={isLoading} />
        </div>
    )
    if (!isLoading && error !== undefined) {
        return <div data-tier="frame" data-component="Board" data-grammar-board-state="error">{header}<ErrorView error={error} /></div>
    }
    const shown: readonly BoardColumn[] = isLoading && columns.length === 0
        ? Array.from({ length: LOADING_ROWS }, (_, index) => ({ id: `loading-${index}`, title: " ", items: [], empty: null }))
        : columns
    const movable = onMove !== undefined && !isLoading

    const columnOf = (itemId: string): BoardColumn | undefined => columns.find((column) => column.items.some((row) => row.id === itemId))
    /** The reason a column refuses a move, or `null` when it takes it. */
    const refusalOf = (itemId: string, toColumnId: string): { readonly move: BoardMove; readonly reason: string } | null => {
        const from = columnOf(itemId)
        const to = columns.find((column) => column.id === toColumnId)
        if (from === undefined || to === undefined || from.id === to.id || to.canDrop === undefined) return null
        const move: BoardMove = { itemId, fromColumnId: from.id, toColumnId: to.id }
        const reason = to.canDrop(move)
        return reason === null ? null : { move, reason }
    }
    /** The refusal is said once (announced, handed to the app) and stays written in its column for a few seconds. */
    const refuse = (refused: { readonly move: BoardMove; readonly reason: string }) => {
        setAnnouncement(refused.reason)
        setRefusal({ columnId: refused.move.toColumnId, reason: refused.reason })
        if (clearRefusalTimer.current !== undefined) window.clearTimeout(clearRefusalTimer.current)
        clearRefusalTimer.current = window.setTimeout(() => setRefusal(null), REFUSAL_SHOWN_MS)
        onRefuse?.(refused.move, refused.reason)
    }
    const move = (itemId: string, toColumnId: string) => {
        const from = columnOf(itemId)
        const to = columns.find((column) => column.id === toColumnId)
        if (from === undefined || to === undefined || from.id === to.id || onMove === undefined) return
        const refused = refusalOf(itemId, toColumnId)
        if (refused !== null) {
            refuse(refused)
            return
        }
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
                onDragEnd: () => {
                    // A drop a column refused never fired `drop` (the drag was not cancelled over it), so the card has sprung back and the reason is said here.
                    const refused = refusalRef.current
                    refusalRef.current = null
                    setDraggingId(null)
                    setOverColumn(null)
                    if (refused !== null) refuse(refused)
                },
                onMoveKey: (direction) => {
                    const target = columns[index + (direction === "next" ? 1 : -1)]
                    if (target !== undefined) move(row.id, target.id)
                },
                ...(moveLabels === undefined ? {} : { keyHint: moveLabels.instructions }),
            },
        }))
    }
    const dropProps = (column: BoardColumn) => movable ? {
        onDragOver: (event: DragEvent<HTMLElement>) => {
            if (draggingId === null) return
            if (overColumn !== column.id) setOverColumn(column.id)
            const refused = refusalOf(draggingId, column.id)
            if (refused !== null) {
                // Not cancelling the event leaves the column no drop place: the pointer shows it, the card springs back, and `drop` never fires.
                event.dataTransfer.dropEffect = "none"
                refusalRef.current = refused
                if (refusal?.columnId !== column.id) setRefusal({ columnId: column.id, reason: refused.reason })
                return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
            refusalRef.current = null
            if (refusal !== null) setRefusal(null)
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setOverColumn((current) => current === column.id ? null : current)
            if (refusalRef.current?.move.toColumnId === column.id) refusalRef.current = null
            setRefusal((current) => current?.columnId === column.id && draggingId !== null ? null : current)
        },
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
                            {...(overColumn === column.id ? { "data-grammar-drop": refusal?.columnId === column.id ? "refused" : "true" } : {})}
                            {...dropProps(column)}
                        >
                            <div className="starci-core-board-column-head" data-contract="GAP-2">
                                <Heading level={3} isLoading={isLoading}>{column.title}</Heading>
                                {column.count === undefined || isLoading ? null : <span className="starci-core-board-count" data-grammar-board-count="true">{column.count}</span>}
                            </div>
                            {refusal?.columnId === column.id ? <p className="starci-core-board-refusal" data-grammar-board-refusal="true">{refusal.reason}</p> : null}
                            {rowsOf(column, index).length === 0 ? <div className="starci-core-board-cards" data-contract="GAP-2"><div className="starci-core-board-empty">{column.empty}</div></div> : (
                                <ul className="starci-core-board-cards" role="list" aria-label={column.title} data-contract="GAP-2">
                                    {rowsOf(column, index).map((row) => <ListRow key={row.id} row={row} />)}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            </HorizontalScrollRegionPart>
            {moveLabels === undefined && !columns.some((column) => column.canDrop !== undefined) ? null : <span className="starci-core-board-announce" role="status" aria-live="polite">{announcement}</span>}
          </div>
        </LoadingScope>
    )
}
