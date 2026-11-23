"use client"

import { Button as HeroButton } from "@heroui/react"
import { Fragment, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { HorizontalScrollRegionPart } from "../HorizontalScrollRegion/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { useIsLoading } from "../../regionScope.js"
import { ScheduleOverlay, useScheduleOverlay } from "./geometry.js"
import { columnLabelOf, dependenciesOf, depthOf, hiddenRowIds, rangeOf, spanLanes, type SpanPlacement } from "./lanes.js"
import { TablerChevronDown } from "../../leaf/Icon/tabler.js"

export type ScheduleTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"

/** One column: a day, a person, a room. */
export type ScheduleColumn = {
    readonly id: string
    readonly label: string
    /** A second muted line, e.g. the date. */
    readonly description?: string
    /** The column holding today: its heading is marked and announced as the current one. */
    readonly isCurrent?: boolean
    /**
     * Draws the line for now: a vertical line over the grid at this share across the column (0 its start, 1 its end), in place of
     * the tint of today's cells. Give it on one column; the line is decorative, `isCurrent` is what announces today.
     */
    readonly todayAt?: number
}

/** One row: an hour, a week, a shift, a project. */
export type ScheduleRow = {
    readonly id: string
    readonly label: string
    /** The row heads a group: its label becomes a button that collapses the rows under it (`onRowToggle` on the grid). */
    readonly isGroup?: boolean
    /** A group row is collapsed: the rows whose `parent` is it (and theirs) are not drawn. The grid keeps no state: apply the toggle and pass the new rows. */
    readonly isCollapsed?: boolean
    /** The id of the group row this row sits under; it is indented and hidden while that group is collapsed. */
    readonly parent?: string
}

/** The handles on the two ends of an entry, to move its first or its last column. */
export type ScheduleResize = {
    /** Moves one end to a column. Called once per gesture (pointer release), or once per arrow press on a focused handle; the grid keeps no state, so apply it and pass the new entry. */
    readonly onResize: (edge: "start" | "end", column: string) => void
    /** The accessible names of the two handles, with the column they stand at, e.g. "Start of Design review, Monday 2". */
    readonly startLabel: string
    readonly endLabel: string
}

/** One entry, placed in the cell where its row and column meet. Several in a cell stack in order. */
export type ScheduleItem = {
    readonly id: string
    readonly row: string
    /** The column the entry starts in. */
    readonly column: string
    /** A span: the entry crosses every column from `column` to this one, as one bar in the row. */
    readonly endColumn?: string
    readonly title: string
    /** One muted line under the title (who, where, how long). */
    readonly meta?: string
    /** The entry's state, by tone; the title and meta carry the meaning, the tone only helps. */
    readonly tone?: ScheduleTone
    /** `milestone` draws a diamond mark with the title instead of a bar: a point in time, in one column. */
    readonly form?: "bar" | "milestone"
    /** How much is done, 0 to 1: the bar fills from its start. Decorative; say the share in `meta`. */
    readonly progress?: number
    /** The ids of the entries this one waits on: an arrow runs from the end of each to the start of this one (ids not in `items` are ignored). */
    readonly after?: readonly string[]
    /** Handles on both ends to change the columns it covers, by pointer or by arrow keys. */
    readonly resize?: ScheduleResize
    /** Makes the entry a button that opens it, or, with `onCellPress` on the grid, the one picked to be placed. */
    readonly onPress?: () => void
    /** The entry can be dragged to another cell of the grid (`onDrop`). The keyboard path is pick it (`onPress`, `isSelected`), then press a cell (`onCellPress`). */
    readonly isDraggable?: boolean
    /** The entry is the one picked up to be placed. Drawn with a ring and announced as pressed. */
    readonly isSelected?: boolean
    /** The entry breaks a rule where it stands; `why` says which, on a second line. */
    readonly isInvalid?: boolean
    readonly why?: string
    /** An entry that is still open to take (an unfilled shift): a dashed outline. */
    readonly isDashed?: boolean
}

/** A small muted label in the top corner of a cell, e.g. the day of the month in a month view. */
export type ScheduleCellLabel = {
    readonly row: string
    readonly column: string
    readonly label: string
}

/** Where a dropped entry came from: another cell of this grid, or a list outside it (a `DragItem` that called `startScheduleDrag`). */
export type ScheduleDropSource = "grid" | "outside"

export type ScheduleGridProps = {
    /** Names the schedule for assistive technology, e.g. "Appointments, 2 to 8 November". */
    readonly label: string
    readonly columns: readonly ScheduleColumn[]
    readonly rows: readonly ScheduleRow[]
    readonly items: readonly ScheduleItem[]
    readonly cellLabels?: readonly ScheduleCellLabel[]
    /** What shows under the grid when no entry exists. Required: a schedule answers for its empty state. */
    readonly empty: ReactNode
    /**
     * An entry was dropped on a cell, from this grid or from a list beside it. The grid keeps no state of its own: apply the move
     * and pass the new `items`. `source` tells the two apart; an outside drop carries the id the list's `startScheduleDrag` gave.
     */
    readonly onDrop?: (itemId: string, row: string, column: string, source: ScheduleDropSource) => void
    /**
     * The cells are pressable (pick then place by pointer or keyboard, or add an entry there). `cellPressLabel` names each cell
     * for assistive technology, e.g. "Monday 2 November, 09:00". This is also the keyboard path for an entry that starts in a list
     * outside the grid: pick it there, then press the cell.
     */
    readonly onCellPress?: (row: string, column: string) => void
    readonly cellPressLabel?: (row: ScheduleRow, column: ScheduleColumn) => string
    /** A group row's label was pressed: `isCollapsed` is the state it asks for. */
    readonly onRowToggle?: (rowId: string, isCollapsed: boolean) => void
    readonly isLoading?: boolean
    /** The read failed: this takes the grid's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

/** The drag type an outside list sets, so the grid takes its drop and no other drag. */
export const SCHEDULE_DRAG_TYPE = "application/x-starci-schedule-item"

/** Call it from a `DragItem` `onDragStart` of a list beside the grid: the grid then accepts the drop and `onDrop` receives `itemId` with source `outside`. */
export const startScheduleDrag = (event: DragEvent<HTMLElement>, itemId: string): void => {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(SCHEDULE_DRAG_TYPE, itemId)
    event.dataTransfer.setData("text/plain", itemId)
}

/** Cells that hold a placeholder entry while the grid loads: one in three, so the shimmer reads as a schedule. */
const isPlaceholderCell = (rowIndex: number, columnIndex: number): boolean => (rowIndex + columnIndex) % 3 === 0

type Resizing = { readonly id: string; readonly edge: "start" | "end"; readonly column: string }

type ItemContext = {
    readonly columns: readonly ScheduleColumn[]
    readonly range: readonly [number, number]
    readonly resizing: Resizing | null
    readonly onDragStart: (id: string) => void
    readonly onDragEnd: () => void
    readonly onResizeStart: (resizing: Resizing) => void
    readonly onResizeMove: (id: string, x: number) => void
    readonly onResizeEnd: (item: ScheduleItem, commit: boolean) => void
}

const Handle = ({ item, edge, context }: { readonly item: ScheduleItem; readonly edge: "start" | "end"; readonly context: ItemContext }) => {
    const resize = item.resize as NonNullable<ScheduleItem["resize"]>
    const [first, last] = context.range
    const current = edge === "start" ? first : last
    const key = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        event.stopPropagation()
        const target = Math.min(context.columns.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)))
        const bounded = edge === "start" ? Math.min(target, last) : Math.max(target, first)
        const column = context.columns[bounded]
        if (bounded !== current && column !== undefined) resize.onResize(edge, column.id)
    }
    const down = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* a synthetic pointer has nothing to capture; the move events still reach the handle */ }
        context.onResizeStart({ id: item.id, edge, column: (context.columns[current] as ScheduleColumn).id })
    }
    const active = context.resizing !== null && context.resizing.id === item.id && context.resizing.edge === edge
    return (
        <button
            type="button"
            className="starci-core-schedule-handle"
            data-grammar-edge={edge}
            {...(active ? { "data-grammar-active": "true" } : {})}
            aria-label={edge === "start" ? resize.startLabel : resize.endLabel}
            aria-keyshortcuts="ArrowLeft ArrowRight"
            onKeyDown={key}
            onPointerDown={down}
            onPointerMove={(event) => { if (active) context.onResizeMove(item.id, event.clientX) }}
            onPointerUp={() => context.onResizeEnd(item, true)}
            onPointerCancel={() => context.onResizeEnd(item, false)}
        />
    )
}

const ItemView = ({ item, context }: { readonly item: ScheduleItem; readonly context: ItemContext }) => {
    const isMilestone = item.form === "milestone"
    const progress = item.progress === undefined || isMilestone ? undefined : Math.min(1, Math.max(0, item.progress))
    const content = (
        <>
            {progress === undefined || progress === 0 ? null : <span className="starci-core-schedule-progress" aria-hidden="true" style={{ inlineSize: `${Math.round(progress * 100)}%` }} />}
            <span className="starci-core-schedule-item-title">{item.title}</span>
            {item.meta === undefined ? null : <span className="starci-core-schedule-item-meta">{item.meta}</span>}
            {item.isInvalid === true && item.why !== undefined ? <span className="starci-core-schedule-item-why">{item.why}</span> : null}
        </>
    )
    const isResizing = context.resizing !== null && context.resizing.id === item.id
    const state = {
        "data-grammar-tone": item.tone ?? "neutral",
        ...(isMilestone ? { "data-grammar-form": "milestone" } : {}),
        ...(progress === undefined ? {} : { "data-grammar-progress": "true" }),
        ...(item.isSelected === true ? { "data-grammar-selected": "true" } : {}),
        ...(item.isInvalid === true ? { "data-grammar-invalid": "true" } : {}),
        ...(item.isDashed === true ? { "data-grammar-dashed": "true" } : {}),
        ...(isResizing ? { "data-grammar-resizing": "true" } : {}),
    }
    const drag = item.isDraggable === true ? {
        draggable: true,
        "data-grammar-draggable": "true",
        onDragStart: (event: DragEvent<HTMLElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); context.onDragStart(item.id) },
        onDragEnd: context.onDragEnd,
    } : {}
    const handles = item.resize === undefined ? null : (
        <>
            <Handle item={item} edge="start" context={context} />
            <Handle item={item} edge="end" context={context} />
        </>
    )
    const idAttr = item.resize === undefined ? { "data-schedule-item-id": item.id } : {}
    const body = item.onPress === undefined ? (
        <div className="starci-core-schedule-item" {...idAttr} {...state} {...drag}>{content}</div>
    ) : (
        <div className="starci-core-schedule-item-slot" {...idAttr} {...drag}>
            <HeroButton className="starci-core-schedule-item" {...state} data-grammar-pressable="true" {...(item.isSelected === true ? { "aria-pressed": true } : {})} type="button" onPress={item.onPress}>{content}</HeroButton>
        </div>
    )
    return item.resize === undefined ? body : <div className="starci-core-schedule-resizable" data-schedule-item-id={item.id}>{body}{handles}</div>
}

type CellProps = {
    readonly row: ScheduleRow
    readonly column: ScheduleColumn
    readonly rowIndex: number
    readonly columnIndex: number
    readonly colSpan?: number
    readonly cell: readonly ScheduleItem[]
    readonly cellLabel: string | undefined
    readonly isLoading: boolean
    readonly overCell: string | null
    readonly setOverCell: (key: string | null) => void
    readonly draggingId: string | null
    readonly setDraggingId: (id: string | null) => void
    readonly onDrop: ScheduleGridProps["onDrop"]
    readonly onCellPress: ScheduleGridProps["onCellPress"]
    readonly cellPressLabel: ScheduleGridProps["cellPressLabel"]
    readonly context: Omit<ItemContext, "range">
    readonly rangeFor: (item: ScheduleItem) => readonly [number, number]
    readonly rangeLabel?: string
}

const CellView = (props: CellProps) => {
    const { row, column, rowIndex, columnIndex, cell, cellLabel, isLoading, overCell, setOverCell, draggingId, setDraggingId, onDrop, onCellPress, cellPressLabel } = props
    const key = `${row.id}|${column.id}`
    const placeholder = isLoading && isPlaceholderCell(rowIndex, columnIndex)
    const hasContent = cell.length > 0 || cellLabel !== undefined || placeholder
    const accepts = (event: DragEvent<HTMLElement>): boolean => draggingId !== null || Array.from(event.dataTransfer.types).includes(SCHEDULE_DRAG_TYPE)
    return (
        <td
            className="starci-core-schedule-cell"
            data-grammar-cell-empty={hasContent ? "false" : "true"}
            {...(props.colSpan === undefined ? {} : { colSpan: props.colSpan, "data-grammar-span": "true" })}
            {...(column.isCurrent === true && column.todayAt === undefined ? { "data-grammar-current": "true" } : {})}
            {...(overCell === key ? { "data-grammar-drop": "true" } : {})}
            {...(onDrop === undefined || isLoading ? {} : {
                onDragOver: (event: DragEvent<HTMLElement>) => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (overCell !== key) setOverCell(key) },
                onDragLeave: (event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverCell(overCell === key ? null : overCell) },
                onDrop: (event: DragEvent<HTMLElement>) => {
                    event.preventDefault()
                    const inside = draggingId
                    const id = inside ?? event.dataTransfer.getData(SCHEDULE_DRAG_TYPE)
                    setDraggingId(null)
                    setOverCell(null)
                    if (id !== "") onDrop(id, row.id, column.id, inside === null ? "outside" : "grid")
                },
            })}
        >
            {onCellPress === undefined || isLoading ? null : (
                <button type="button" className="starci-core-schedule-cell-press" aria-label={cellPressLabel === undefined ? `${row.label}, ${column.label}` : cellPressLabel(row, column)} onClick={() => onCellPress(row.id, column.id)} />
            )}
            <span className="starci-core-schedule-cell-column" aria-hidden="true">{props.rangeLabel ?? columnLabelOf(column)}</span>
            {cellLabel === undefined ? null : <span className="starci-core-schedule-cell-label">{cellLabel}</span>}
            {placeholder ? <span className="starci-core-schedule-item" data-grammar-tone="neutral"><Skeleton shape="text" lines={2} /></span> : cell.map((item) => <ItemView key={item.id} item={item} context={{ ...props.context, range: props.rangeFor(item) }} />)}
        </td>
    )
}

/**
 * Entries placed by row and column: a week by hour, people by day, a month by week, a plan by project. A real table (a caption,
 * column headings, a heading per row) on a wide container; below 48rem of its own width it reads as an agenda, each row a block
 * whose entries name their column, and empty cells are not drawn. A loading grid keeps the headings it was given as real
 * text and draws shimmering entries in the shape of real ones, so nothing jumps when the data lands.
 *
 * An entry with `endColumn` is a bar across several columns of its row (a timeline): it may show how much is done (`progress`),
 * wait on other entries (`after`, drawn as arrows), take handles on both ends (`resize`) or be a milestone (`form`); a row can head
 * a collapsible group (`isGroup`, `parent`), and a column can carry the line for now (`todayAt`). A list beside the grid hands
 * entries in with `startScheduleDrag` and `onDrop`.
 */
export const ScheduleGrid = ({ label, columns, rows, items, cellLabels = [], empty, onDrop, onCellPress, cellPressLabel, onRowToggle, isLoading: ownLoading, error }: ScheduleGridProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [overCell, setOverCell] = useState<string | null>(null)
    const [resizing, setResizing] = useState<Resizing | null>(null)
    const planeRef = useRef<HTMLDivElement>(null)
    const columnRefs = useRef(new Map<string, HTMLElement>())
    const dependencies = dependenciesOf(items)
    const today = columns.find((column) => column.todayAt !== undefined)
    const hidden = hiddenRowIds(rows)
    const { geometry, markerId } = useScheduleOverlay(planeRef, columnRefs, {
        todayColumn: today?.id,
        todayAt: today?.todayAt ?? 0,
        dependencies,
        isActive: !isLoading && error === undefined,
        signature: `${items.map((item) => `${item.id}:${item.row}:${item.column}:${item.endColumn ?? ""}`).join(",")}|${rows.map((row) => `${row.id}${row.isCollapsed === true ? "c" : ""}`).join(",")}|${columns.length}`,
    })
    if (!isLoading && error !== undefined) {
        return <div data-tier="frame" data-component="ScheduleGrid" data-grammar-schedule-state="error"><ErrorView error={error} /></div>
    }
    const indexOf = new Map(columns.map((column, index) => [column.id, index]))
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    const byCell = new Map<string, ScheduleItem[]>()
    const spansByRow = new Map<string, SpanPlacement[]>()
    for (const item of items) {
        const range = rangeOf(item, indexOf)
        if (range !== null && range[0] !== range[1]) {
            spansByRow.set(item.row, [...(spansByRow.get(item.row) ?? []), { item, start: range[0], end: range[1] }])
            continue
        }
        byCell.set(`${item.row}|${item.column}`, [...(byCell.get(`${item.row}|${item.column}`) ?? []), item])
    }
    const labelOf = new Map(cellLabels.map((entry) => [`${entry.row}|${entry.column}`, entry.label]))
    const isEmpty = !isLoading && items.length === 0
    const rangeFor = (item: ScheduleItem): readonly [number, number] => rangeOf(item, indexOf) ?? [0, 0]
    const columnAt = (x: number): string | undefined => {
        let found: string | undefined
        for (const column of columns) {
            const box = columnRefs.current.get(column.id)?.getBoundingClientRect()
            if (box === undefined) continue
            if (x >= box.left) found = column.id
        }
        return found ?? columns[0]?.id
    }
    const itemContext: Omit<ItemContext, "range"> = {
        columns,
        resizing,
        onDragStart: setDraggingId,
        onDragEnd: () => { setDraggingId(null); setOverCell(null) },
        onResizeStart: setResizing,
        onResizeMove: (id, x) => {
            const column = columnAt(x)
            setResizing((current) => (current === null || current.id !== id || column === undefined || current.column === column ? current : { ...current, column }))
        },
        onResizeEnd: (item, commit) => {
            const current = resizing
            setResizing(null)
            if (!commit || current === null || current.id !== item.id || item.resize === undefined) return
            const [first, last] = rangeFor(item)
            const target = indexOf.get(current.column)
            if (target === undefined) return
            const bounded = current.edge === "start" ? Math.min(target, last) : Math.max(target, first)
            if (bounded !== (current.edge === "start" ? first : last)) item.resize.onResize(current.edge, (columns[bounded] as ScheduleColumn).id)
        },
    }
    const cellProps = { isLoading, overCell, setOverCell, draggingId, setDraggingId, onDrop, onCellPress, cellPressLabel, context: itemContext, rangeFor }
    const visibleRows = rows.filter((row) => !hidden.has(row.id))
    const renderRow = (row: ScheduleRow, rowIndex: number): ReactNode => {
        const lanes = spanLanes(spansByRow.get(row.id) ?? [])
        const hasLanes = lanes.length > 0
        const covered = new Set<number>()
        for (const span of lanes[0] ?? []) for (let index = span.start; index <= span.end; index += 1) covered.add(index)
        const hasHiddenContent = columns.some((column, index) => covered.has(index) && (byCell.has(`${row.id}|${column.id}`) || labelOf.has(`${row.id}|${column.id}`)))
        const laneCount = Math.max(1, lanes.length) + (hasHiddenContent ? 1 : 0)
        const depth = depthOf(row, rowsById)
        const head = (
            <th scope="row" rowSpan={laneCount} className="starci-core-schedule-row-label" {...(depth > 0 ? { "data-grammar-depth": String(Math.min(depth, 3)) } : {})} {...(row.isGroup === true ? { "data-grammar-group": "true" } : {})}>
                {row.isGroup === true && onRowToggle !== undefined && !isLoading ? (
                    <button type="button" className="starci-core-schedule-group-toggle" aria-expanded={row.isCollapsed !== true} onClick={() => onRowToggle(row.id, row.isCollapsed !== true)}>
                        <TablerChevronDown className="starci-core-schedule-group-chevron" aria-hidden="true" data-grammar-collapsed={row.isCollapsed === true ? "true" : "false"} />
                        <span className="starci-core-schedule-group-label">{row.label}</span>
                    </button>
                ) : row.label}
            </th>
        )
        const cellsOf = (only: ReadonlySet<number> | null, skip: ReadonlySet<number>, startAt: ReadonlyMap<number, SpanPlacement>): ReactNode[] => {
            const out: ReactNode[] = []
            for (let index = 0; index < columns.length; index += 1) {
                const column = columns[index] as ScheduleColumn
                const key = `${row.id}|${column.id}`
                const span = startAt.get(index)
                if (span !== undefined) {
                    const last = columns[span.end] as ScheduleColumn
                    out.push(<CellView key={`${column.id}:span`} {...cellProps} row={row} column={column} rowIndex={rowIndex} columnIndex={index} colSpan={span.end - span.start + 1} cell={[span.item]} cellLabel={undefined} rangeLabel={`${columnLabelOf(column)} – ${columnLabelOf(last)}`} />)
                    index = span.end
                    continue
                }
                const blank = (only !== null && !only.has(index)) || skip.has(index)
                out.push(<CellView key={column.id} {...cellProps} row={row} column={column} rowIndex={rowIndex} columnIndex={index} cell={blank ? [] : byCell.get(key) ?? []} cellLabel={blank ? undefined : labelOf.get(key)} />)
            }
            return out
        }
        if (!hasLanes) return <tr key={row.id}>{head}{cellsOf(null, new Set(), new Map())}</tr>
        return (
            <Fragment key={row.id}>
                {lanes.map((lane, laneIndex) => (
                    <tr key={`${row.id}:${laneIndex}`} data-grammar-lane={laneIndex}>
                        {laneIndex === 0 ? head : null}
                        {cellsOf(null, laneIndex === 0 ? new Set() : new Set(columns.keys()), new Map(lane.map((span) => [span.start, span] as const)))}
                    </tr>
                ))}
                {hasHiddenContent ? <tr data-grammar-lane={lanes.length}>{cellsOf(covered, new Set(), new Map())}</tr> : null}
            </Fragment>
        )
    }
    return (
        <div
            data-tier="frame"
            data-component="ScheduleGrid"
            data-contract="GAP-3 STATE-8"
            data-grammar-schedule-state={isLoading ? "loading" : isEmpty ? "empty" : "ready"}
            className="starci-core-schedule"
            {...(isLoading ? { "aria-busy": true } : {})}
        >
            <HorizontalScrollRegionPart aria-label={label} carets={false} overflow="needed" className="starci-core-schedule-scroll">
                <div ref={planeRef} className="starci-core-schedule-plane">
                    <table className="starci-core-schedule-table">
                        <caption className="starci-core-schedule-caption">{label}</caption>
                        <thead>
                            <tr>
                                <td className="starci-core-schedule-corner" />
                                {columns.map((column) => (
                                    <th
                                        key={column.id}
                                        scope="col"
                                        className="starci-core-schedule-column"
                                        ref={(element) => { if (element === null) columnRefs.current.delete(column.id); else columnRefs.current.set(column.id, element) }}
                                        {...(column.isCurrent === true ? { "aria-current": "date", "data-grammar-current": "true" } : {})}
                                        {...(resizing !== null && resizing.column === column.id ? { "data-grammar-resize-target": "true" } : {})}
                                    >
                                        <span className="starci-core-schedule-column-label">{column.label}</span>
                                        {column.description === undefined ? null : <span className="starci-core-schedule-column-description">{column.description}</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>{visibleRows.map((row, rowIndex) => renderRow(row, rowIndex))}</tbody>
                    </table>
                    <ScheduleOverlay geometry={geometry} markerId={markerId} />
                </div>
            </HorizontalScrollRegionPart>
            {isEmpty ? <div className="starci-core-schedule-empty">{empty}</div> : null}
        </div>
    )
}
