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
     * What this stage answers to the item of `move`: `boardAllow` lets it in, `boardRefuse(reason)` refuses it with the reason in the app's words ("Add a quote before it can be won"),
     * and `boardNeedsData(kind)` takes the drop but needs more from the person first (a booking time, a reason a lead was lost): the card stays where it was, `onMove` does not run
     * and the app gets `onNeedsData(move, kind)` to open its dialog, then moves the card itself when the dialog is confirmed. A refusing column still takes the pointer (the drag shows it
     * cannot drop there and the reason shows in the column): the card springs back, `onMove` does not run, and the reason is announced (`role="status"`) and handed to `onRefuse`. The
     * keyboard move is held to the same answer. Pure: it runs on every drag-over. Left out, the stage lets every item in.
     */
    readonly canDrop?: (move: BoardMove) => BoardDropAnswer
    /**
     * The words written in the drop slot while a card is over this stage, in the app's words: a title ("Drop to book") and what happens next ("Ask when the customer comes").
     * Without it the slot is an empty dashed place the size of a card.
     */
    readonly dropHint?: BoardDropHint
}

/** The words of a drop slot: a title and, under it, what the drop leads to. */
export type BoardDropHint = {
    readonly title: string
    readonly detail?: string
}

/** What a stage answers to a card dropped on it: let in, refused with a reason, or taken once the app has asked the person for more. */
export type BoardDropAnswer =
    | { readonly kind: "allow" }
    | { readonly kind: "refuse"; readonly reason: string }
    | { readonly kind: "needsData"; readonly data: string }

/** The answer that lets a card in. */
export const boardAllow: BoardDropAnswer = { kind: "allow" }
/** The answer that refuses a card, with the reason in the app's words. */
export const boardRefuse = (reason: string): BoardDropAnswer => ({ kind: "refuse", reason })
/** The answer that asks the app to collect `data` (its own name for what is missing: "booking", "lost-reason") before the card moves. */
export const boardNeedsData = (data: string): BoardDropAnswer => ({ kind: "needsData", data })

/**
 * A drop place after the last stage, drawn as a wide band under the board only while a card is being dragged (a lead that was lost, an item to archive). It is not a column: it keeps
 * no cards, so the move into it is only `onMove` (or `onNeedsData`) with `toColumnId` set to its `id`, and the app decides where the card goes.
 */
export type BoardEndBand = {
    readonly id: string
    /** What the band says, e.g. "Drop here when the customer did not buy". */
    readonly label: ReactNode
    /** The same answer a column gives (`canDrop` of `BoardColumn`). */
    readonly canDrop?: (move: BoardMove) => BoardDropAnswer
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
    /** What is announced when a move waits for the person's answer (`needsData`), e.g. `Asking for the booking time before moving Chi Lan to Booked`. */
    readonly announceAsk?: (item: string, column: string) => string
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
    /** A stage answered `boardNeedsData(kind)` to a move: open the app's dialog for `kind`, and move the card (`columns` again) once it is confirmed. The card has not moved. */
    readonly onNeedsData?: (move: BoardMove, data: string) => void
    /** The band after the last stage that only a dragged card can reach (see `BoardEndBand`). It is drawn while a card is dragged and by the keyboard it is the stage after the last. */
    readonly endBand?: BoardEndBand
}

/** What a drag over a stage resolved to: the answer and, for a refusal or a question, the move it is about. */
type Resolved = { readonly move: BoardMove; readonly answer: Exclude<BoardDropAnswer, { readonly kind: "allow" }> }

/** One place a card can be dropped: a stage, or the end band. */
type Target = { readonly id: string; readonly title: string; readonly canDrop?: (move: BoardMove) => BoardDropAnswer }

/**
 * Items in stages: peer columns side by side that scroll as one row, each column a tinted surface (`--surface-secondary`) with its title and
 * a count chip in its head and its items as white cards (a sales pipeline, a hiring funnel, a task board). An item is a real object, so it is
 * a card: the Board draws each `ListRow` on its own card face (a `<ul>` of rows per column, never `SurfaceCard`). Columns share one width from 16rem, and snap into view as the row
 * scrolls, so a phone shows one stage at a time. Each column answers for its own empty state; a loading board draws the
 * columns it was given with placeholder rows (three each when it was given none). With `onMove` a card moves between stages
 * by drag or by keyboard, and a card with `onPress` opens by pressing anywhere on it. A card shows its grip (six dots) on hover and focus; while one is dragged it leaves an
 * origin slot (a dashed, emptied place) where it stood, travels as a lifted card with a soft shadow, and the stage under it opens a drop slot (a dashed card-sized place with the
 * stage's `dropHint`). An `endBand` is one more place after the last stage, shown only while dragging.
 */
export const Board = ({ label, columns, filter, scrollPreviousLabel, scrollNextLabel, isLoading: ownLoading, error, onMove, moveLabels, onRefuse, onNeedsData, endBand }: BoardProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [overColumn, setOverColumn] = useState<string | null>(null)
    const [announcement, setAnnouncement] = useState("")
    /** The column a drag is over and the reason it refuses the dragged card; read again at drag end, when the card has sprung back. */
    const [refusal, setRefusal] = useState<{ readonly columnId: string; readonly reason: string } | null>(null)
    const refusalRef = useRef<Resolved | null>(null)
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
    /** The places a card can land: every stage, then the end band. */
    const targets: readonly Target[] = [
        ...columns.map((column): Target => ({ id: column.id, title: column.title, ...(column.canDrop === undefined ? {} : { canDrop: column.canDrop }) })),
        ...(endBand === undefined ? [] : [{ id: endBand.id, title: typeof endBand.label === "string" ? endBand.label : endBand.id, ...(endBand.canDrop === undefined ? {} : { canDrop: endBand.canDrop }) }]),
    ]

    const columnOf = (itemId: string): BoardColumn | undefined => columns.find((column) => column.items.some((row) => row.id === itemId))
    /** What a place answers to the card: `null` when it takes it, else the refusal or the question with its move. */
    const resolve = (itemId: string, toId: string): Resolved | null => {
        const from = columnOf(itemId)
        const to = targets.find((target) => target.id === toId)
        if (from === undefined || to === undefined || from.id === to.id || to.canDrop === undefined) return null
        const move: BoardMove = { itemId, fromColumnId: from.id, toColumnId: to.id }
        const answer = to.canDrop(move)
        return answer.kind === "allow" ? null : { move, answer }
    }
    /** The refusal is said once (announced, handed to the app) and stays written in its column for a few seconds. */
    const refuse = (move: BoardMove, reason: string) => {
        setAnnouncement(reason)
        setRefusal({ columnId: move.toColumnId, reason })
        if (clearRefusalTimer.current !== undefined) window.clearTimeout(clearRefusalTimer.current)
        clearRefusalTimer.current = window.setTimeout(() => setRefusal(null), REFUSAL_SHOWN_MS)
        onRefuse?.(move, reason)
    }
    const announceFor = (itemId: string, toId: string, ask: boolean) => {
        const item = columnOf(itemId)?.items.find((row) => row.id === itemId)
        const to = targets.find((target) => target.id === toId)
        if (moveLabels === undefined || item === undefined || to === undefined) return
        const say = ask ? moveLabels.announceAsk : moveLabels.announce
        if (say !== undefined) setAnnouncement(say(item.title, to.title))
    }
    const move = (itemId: string, toId: string) => {
        const from = columnOf(itemId)
        const to = targets.find((target) => target.id === toId)
        if (from === undefined || to === undefined || from.id === to.id || onMove === undefined) return
        const resolved = resolve(itemId, toId)
        if (resolved !== null && resolved.answer.kind === "refuse") {
            refuse(resolved.move, resolved.answer.reason)
            return
        }
        if (resolved !== null && resolved.answer.kind === "needsData") {
            // The card stays where it was; the app asks the person and moves it when they confirm.
            refocus.current = itemId
            announceFor(itemId, toId, true)
            onNeedsData?.(resolved.move, resolved.answer.data)
            return
        }
        refocus.current = itemId
        announceFor(itemId, toId, false)
        onMove({ itemId, fromColumnId: from.id, toColumnId: to.id })
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
                    if (refused !== null && refused.answer.kind === "refuse") refuse(refused.move, refused.answer.reason)
                },
                onMoveKey: (direction) => {
                    const target = targets[index + (direction === "next" ? 1 : -1)]
                    if (target !== undefined) move(row.id, target.id)
                },
                isOrigin: draggingId === row.id,
                ...(moveLabels === undefined ? {} : { keyHint: moveLabels.instructions }),
            },
        }))
    }
    const dropProps = (placeId: string) => movable ? {
        onDragOver: (event: DragEvent<HTMLElement>) => {
            if (draggingId === null) return
            if (overColumn !== placeId) setOverColumn(placeId)
            const resolved = resolve(draggingId, placeId)
            if (resolved !== null && resolved.answer.kind === "refuse") {
                // Not cancelling the event leaves the column no drop place: the pointer shows it, the card springs back, and `drop` never fires.
                event.dataTransfer.dropEffect = "none"
                refusalRef.current = resolved
                if (refusal?.columnId !== placeId) setRefusal({ columnId: placeId, reason: resolved.answer.reason })
                return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
            refusalRef.current = null
            if (refusal !== null) setRefusal(null)
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setOverColumn((current) => current === placeId ? null : current)
            if (refusalRef.current?.move.toColumnId === placeId) refusalRef.current = null
            setRefusal((current) => current?.columnId === placeId && draggingId !== null ? null : current)
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
            event.preventDefault()
            const id = draggingId ?? event.dataTransfer.getData("text/plain")
            setDraggingId(null)
            setOverColumn(null)
            if (id !== "") move(id, placeId)
        },
    } : {}
    /** How the place under the drag reads: a refusal, a question the app will ask, or a plain drop. */
    const dropState = (placeId: string): "refused" | "ask" | "true" | undefined => {
        if (overColumn !== placeId || draggingId === null) return undefined
        if (refusal?.columnId === placeId) return "refused"
        const resolved = resolve(draggingId, placeId)
        if (resolved?.answer.kind === "needsData") return "ask"
        return "true"
    }
    const originColumnId = draggingId === null ? undefined : columnOf(draggingId)?.id
    const bandState = endBand === undefined ? undefined : dropState(endBand.id)

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
                    {shown.map((column, index) => {
                        const state = originColumnId === column.id && dropState(column.id) === "true" ? undefined : dropState(column.id)
                        const rows = rowsOf(column, index)
                        const slot = state === undefined || state === "refused" ? null : (
                            <li className="starci-core-board-slot" data-grammar-board-slot={state} aria-hidden="true">
                                {column.dropHint === undefined ? null : <span className="starci-core-board-slot-title">{column.dropHint.title}</span>}
                                {column.dropHint?.detail === undefined ? null : <span className="starci-core-board-slot-detail">{column.dropHint.detail}</span>}
                            </li>
                        )
                        return (
                            <div
                                key={column.id}
                                className="starci-core-board-column"
                                {...(state === undefined ? {} : { "data-grammar-drop": state })}
                                {...dropProps(column.id)}
                            >
                                <div className="starci-core-board-column-head" data-contract="GAP-2">
                                    <Heading level={3} isLoading={isLoading}>{column.title}</Heading>
                                    {column.count === undefined || isLoading ? null : <span className="starci-core-board-count" data-grammar-board-count="true">{column.count}</span>}
                                </div>
                                {refusal?.columnId === column.id ? <p className="starci-core-board-refusal" data-grammar-board-refusal="true">{refusal.reason}</p> : null}
                                {rows.length === 0 && slot === null ? <div className="starci-core-board-cards" data-contract="GAP-2"><div className="starci-core-board-empty">{column.empty}</div></div> : (
                                    <ul className="starci-core-board-cards" role="list" aria-label={column.title} data-contract="GAP-2">
                                        {slot}
                                        {rows.map((row) => <ListRow key={row.id} row={row} />)}
                                    </ul>
                                )}
                            </div>
                        )
                    })}
                </div>
            </HorizontalScrollRegionPart>
            {endBand === undefined || draggingId === null ? null : (
                <div
                    className="starci-core-board-band"
                    data-grammar-board-band="true"
                    {...(bandState === undefined ? {} : { "data-grammar-drop": bandState })}
                    {...dropProps(endBand.id)}
                >
                    {endBand.label}
                </div>
            )}
            {moveLabels === undefined && !targets.some((target) => target.canDrop !== undefined) ? null : <span className="starci-core-board-announce" role="status" aria-live="polite">{announcement}</span>}
          </div>
        </LoadingScope>
    )
}
