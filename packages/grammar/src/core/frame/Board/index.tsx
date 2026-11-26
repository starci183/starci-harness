"use client"

import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode, type RefObject } from "react"
import { useDrop } from "react-aria-components"
import { HorizontalScrollRegionPart } from "../HorizontalScrollRegion/index.js"
import { ListRow } from "../../composite/ListRow/index.js"
import { Heading } from "../../leaf/Heading/index.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import type { ListRowData } from "../../surfaceCardData.js"
import { FilterRow } from "../Section/index.js"

/** How long a refused move's reason stays written in its column (ms); it was announced when it happened. */
const REFUSAL_SHOWN_MS = 5000
/** The share of the scroller's width at each edge where a held card scrolls the stages (a phone shows one stage at a time). */
const EDGE_SHARE = 0.15
/** The least edge in px, so a narrow board still has a place to hold the card. */
const EDGE_MIN_PX = 32
/** The least time between two scroll steps of a held drag (ms): one stage per step, never a run-away scroll. */
const EDGE_STEP_MS = 600

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
     * and the app gets `onNeedsData(move, kind)` to open its dialog, then moves the card itself when the dialog is confirmed. A refusing column is still a place the drag
     * reaches, by pointer, touch, keyboard or screen reader, so it can say no: while the card is over it the column wears the refusal outline and writes the reason; dropped there, the card
     * stays where it was, `onMove` does not run, and the reason is announced (`role="status"`), stays written a few seconds and is handed to `onRefuse`. The Alt and arrow move is held
     * to the same answer. Pure: it runs on every render of a drag. Left out, the stage lets every item in.
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
     * Items move between stages: by dragging a card onto a column (which highlights as the drop place) with a mouse, or a long press and a
     * drag on a touch screen; by react-aria's keyboard and screen-reader drag (Enter on a focused card, or activating it with a screen reader,
     * then Tab to a stage and Enter to drop, Escape to cancel); and by Alt + the left or right arrow on a focused card, which moves it to the
     * neighbour stage and announces it. The board keeps no order of its own; the app applies the move and passes the new columns. Give
     * `moveLabels` with it.
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

/** How the place under a dragged card reads: a refusal, a question the app will ask, or a plain drop. */
type DropState = "refused" | "ask" | "true"

/** What a drop place asks of the board while a card is dragged. */
type DropPlace = {
    /** Whether a card of this board is in flight and may land here (any place but its own stage). */
    readonly accepts: (placeId: string) => boolean
    readonly enter: (placeId: string) => void
    readonly exit: (placeId: string) => void
    readonly drop: (placeId: string) => void
}

type BoardDrop = {
    readonly ref: RefObject<HTMLDivElement | null>
    readonly dropProps: HTMLAttributes<HTMLElement>
}

/**
 * One drop place on react-aria's `useDrop`: the native drag of a mouse or a touch screen (dragenter, dragover and drop, with the WebKit and
 * Chrome Android quirks handled), and the virtual drag of a keyboard or a screen reader, which focuses each place in turn (Tab), drops with
 * Enter and cancels with Escape. A place that refuses the card still takes it, so its reason can be said: the board answers on the drop.
 */
const useBoardDrop = (placeId: string, place: DropPlace | null): BoardDrop => {
    const ref = useRef<HTMLDivElement | null>(null)
    const { dropProps } = useDrop({
        ref,
        isDisabled: place === null,
        getDropOperation: () => (place?.accepts(placeId) === true ? "move" : "cancel"),
        onDropEnter: () => place?.enter(placeId),
        onDropExit: () => place?.exit(placeId),
        onDrop: () => place?.drop(placeId),
    })
    return { ref, dropProps }
}

type StageProps = {
    readonly column: BoardColumn
    readonly rows: readonly ListRowData[]
    readonly isLoading: boolean
    readonly state: DropState | undefined
    /** The reason written under the head: the refusing stage's while the card is over it, and a refused drop's for a few seconds. */
    readonly refusal: string | undefined
    readonly place: DropPlace | null
}

/** One stage: the tinted column with its head, its refusal note and its cards (or its empty state), and a drop place while cards move. */
const BoardStage = ({ column, rows, isLoading, state, refusal, place }: StageProps) => {
    const { ref, dropProps } = useBoardDrop(column.id, place)
    const slot = state === undefined || state === "refused" ? null : (
        <li className="starci-core-board-slot" data-grammar-board-slot={state} aria-hidden="true">
            {column.dropHint === undefined ? null : <span className="starci-core-board-slot-title">{column.dropHint.title}</span>}
            {column.dropHint?.detail === undefined ? null : <span className="starci-core-board-slot-detail">{column.dropHint.detail}</span>}
        </li>
    )
    return (
        <div
            ref={ref}
            className="starci-core-board-column"
            {...(state === undefined ? {} : { "data-grammar-drop": state })}
            // A keyboard or screen-reader drag focuses the stage it would drop on and reads its name.
            {...(place === null ? {} : { role: "group", "aria-label": column.title, tabIndex: -1 })}
            {...dropProps}
        >
            <div className="starci-core-board-column-head" data-contract="GAP-2">
                <Heading level={3} isLoading={isLoading}>{column.title}</Heading>
                {column.count === undefined || isLoading ? null : <span className="starci-core-board-count" data-grammar-board-count="true">{column.count}</span>}
            </div>
            {refusal === undefined ? null : <p className="starci-core-board-refusal" data-grammar-board-refusal="true">{refusal}</p>}
            {rows.length === 0 && slot === null ? <div className="starci-core-board-cards" data-contract="GAP-2"><div className="starci-core-board-empty">{column.empty}</div></div> : (
                <ul className="starci-core-board-cards" role="list" aria-label={column.title} data-contract="GAP-2">
                    {slot}
                    {rows.map((row) => <ListRow key={row.id} row={row} />)}
                </ul>
            )}
        </div>
    )
}

/** The end band: a wide drop place under the stages, drawn only while a card is dragged. */
const BoardBand = ({ band, state, place }: { readonly band: BoardEndBand; readonly state: DropState | undefined; readonly place: DropPlace | null }) => {
    const { ref, dropProps } = useBoardDrop(band.id, place)
    return (
        <div
            ref={ref}
            className="starci-core-board-band"
            data-grammar-board-band="true"
            {...(state === undefined ? {} : { "data-grammar-drop": state })}
            {...(place === null ? {} : { role: "group", tabIndex: -1, ...(typeof band.label === "string" ? { "aria-label": band.label } : {}) })}
            {...dropProps}
        >
            {band.label}
        </div>
    )
}

/** The person asked for less motion: a scroll step jumps instead of gliding. */
const prefersReducedMotion = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Items in stages: peer columns side by side that scroll as one row, each column a tinted surface (`--surface-secondary`) with its title and
 * a count chip in its head and its items as white cards (a sales pipeline, a hiring funnel, a task board). An item is a real object, so it is
 * a card: the Board draws each `ListRow` on its own card face (a `<ul>` of rows per column, never `SurfaceCard`). Columns share one width from 16rem, and snap into view as the row
 * scrolls, so a phone shows one stage at a time. Each column answers for its own empty state; a loading board draws the
 * columns it was given with placeholder rows (three each when it was given none). With `onMove` a card moves between stages
 * by drag or by keyboard, and a card with `onPress` opens by pressing anywhere on it. The drag is react-aria's (`useDrag`, `useDrop`): a mouse drags a card at once, a touch
 * screen lifts it on a long press, and a card held near the left or right edge of the stages scrolls them one stage at a time; a keyboard starts it with Enter on a focused
 * card and a screen reader by activating the card, then Tab walks the stages, Enter drops and Escape cancels; Alt and an arrow move a focused card to the neighbour stage in
 * one step. A card shows its grip (six dots) on hover and focus, and always on a touch screen; while one is dragged it leaves an origin slot (a dashed, emptied place) where it
 * stood, travels as a lifted card with a soft shadow, and the stage under it opens a drop slot (a dashed card-sized place with the stage's `dropHint`). An `endBand` is one more
 * place after the last stage, shown only while dragging.
 */
export const Board = ({ label, columns, filter, scrollPreviousLabel, scrollNextLabel, isLoading: ownLoading, error, onMove, moveLabels, onRefuse, onNeedsData, endBand }: BoardProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    /** The card in flight, read at once by the drop places: a drag starts and is judged before React renders again. */
    const draggingRef = useRef<string | null>(null)
    const [overPlace, setOverPlace] = useState<string | null>(null)
    const [announcement, setAnnouncement] = useState("")
    /** A refused drop's reason, written in its column for a few seconds after it was announced. */
    const [refusal, setRefusal] = useState<{ readonly columnId: string; readonly reason: string } | null>(null)
    const clearRefusalTimer = useRef<number | undefined>(undefined)
    useEffect(() => () => { if (clearRefusalTimer.current !== undefined) window.clearTimeout(clearRefusalTimer.current) }, [])
    const root = useRef<HTMLDivElement | null>(null)
    const scroller = useRef<HTMLDivElement | null>(null)
    const lastStep = useRef(0)
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
    const endDrag = () => {
        draggingRef.current = null
        setDraggingId(null)
        setOverPlace(null)
    }
    /** The drop places' side of a drag: a card of this board lands on any place but its own stage; a refusing place still takes it and answers on the drop. */
    const place: DropPlace | null = movable ? {
        accepts: (placeId) => {
            const id = draggingRef.current
            return id !== null && columnOf(id)?.id !== placeId
        },
        enter: (placeId) => setOverPlace(placeId),
        exit: (placeId) => setOverPlace((current) => (current === placeId ? null : current)),
        drop: (placeId) => {
            const id = draggingRef.current
            endDrag()
            if (id !== null) move(id, placeId)
        },
    } : null
    const rowsOf = (column: BoardColumn, index: number): readonly ListRowData[] => {
        if (isLoading && column.items.length === 0) return Array.from({ length: LOADING_ROWS }, (_, rowIndex) => ({ id: `loading-${rowIndex}`, title: " " }))
        if (!movable) return column.items
        return column.items.map((row) => ({
            ...row,
            drag: {
                onDragStart: () => {
                    draggingRef.current = row.id
                    setDraggingId(row.id)
                },
                onDragEnd: endDrag,
                onMoveKey: (direction) => {
                    const target = targets[index + (direction === "next" ? 1 : -1)]
                    if (target !== undefined) move(row.id, target.id)
                },
                isOrigin: draggingId === row.id,
                ...(moveLabels === undefined ? {} : { keyHint: moveLabels.instructions }),
            },
        }))
    }
    /** How the place under the drag reads: a refusal, a question the app will ask, or a plain drop. */
    const dropState = (placeId: string): DropState | undefined => {
        if (overPlace !== placeId || draggingId === null) return undefined
        const resolved = resolve(draggingId, placeId)
        if (resolved?.answer.kind === "refuse") return "refused"
        if (resolved?.answer.kind === "needsData") return "ask"
        return "true"
    }
    /** The reason a column writes: the refusing stage under the card says why at once, and a refused drop's reason stays a few seconds. */
    const refusalOf = (placeId: string): string | undefined => {
        if (draggingId !== null && overPlace === placeId) {
            const resolved = resolve(draggingId, placeId)
            if (resolved?.answer.kind === "refuse") return resolved.answer.reason
        }
        return refusal?.columnId === placeId ? refusal.reason : undefined
    }
    /**
     * A card held near the left or right edge of the stages scrolls them one stage at a time: on a phone the stage it is meant for is
     * off screen, and a touch drag has no wheel. Read in the capture phase, since each drop place stops the drag-over it handles.
     */
    const scrollAtEdge = (event: DragEvent<HTMLDivElement>) => {
        const node = scroller.current
        if (node === null || draggingRef.current === null || node.scrollWidth <= node.clientWidth) return
        const box = node.getBoundingClientRect()
        if (event.clientY < box.top || event.clientY > box.bottom) return
        const edge = Math.max(EDGE_MIN_PX, box.width * EDGE_SHARE)
        const direction = event.clientX > box.right - edge ? 1 : event.clientX < box.left + edge ? -1 : 0
        if (direction === 0 || event.timeStamp - lastStep.current < EDGE_STEP_MS) return
        const stage = node.querySelector<HTMLElement>(".starci-core-board-column")
        if (stage === null) return
        lastStep.current = event.timeStamp
        node.scrollBy({ left: direction * stage.offsetWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" })
    }
    const bandState = endBand === undefined ? undefined : dropState(endBand.id)

    return (
        <LoadingScope isLoading={isLoading}>
          <div
            ref={root}
            data-tier="frame"
            data-component="Board"
            data-grammar-board-state={isLoading ? "loading" : "ready"}
            {...(draggingId === null ? {} : { "data-grammar-board-dragging": "true" })}
            {...(movable ? { onDragOverCapture: scrollAtEdge } : {})}
          >
            {header}
            <HorizontalScrollRegionPart
                ref={scroller}
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
                        <BoardStage
                            key={column.id}
                            column={column}
                            rows={rowsOf(column, index)}
                            isLoading={isLoading}
                            state={dropState(column.id)}
                            refusal={refusalOf(column.id)}
                            place={place}
                        />
                    ))}
                </div>
            </HorizontalScrollRegionPart>
            {endBand === undefined || draggingId === null ? null : <BoardBand band={endBand} state={bandState} place={place} />}
            {moveLabels === undefined && !targets.some((target) => target.canDrop !== undefined) ? null : <span className="starci-core-board-announce" role="status" aria-live="polite">{announcement}</span>}
          </div>
        </LoadingScope>
    )
}
