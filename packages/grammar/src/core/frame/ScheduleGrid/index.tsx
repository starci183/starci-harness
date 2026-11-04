"use client"

import { Button as HeroButton } from "@heroui/react"
import { useState, type DragEvent, type ReactNode } from "react"
import { HorizontalScrollRegionPart } from "../HorizontalScrollRegion/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { useIsLoading } from "../../regionScope.js"

export type ScheduleTone = "neutral" | "accent" | "success" | "warning" | "danger"

/** One column: a day, a person, a room. */
export type ScheduleColumn = {
    readonly id: string
    readonly label: string
    /** A second muted line, e.g. the date. */
    readonly description?: string
    /** The column holding today: its heading is marked and announced as the current one. */
    readonly isCurrent?: boolean
}

/** One row: an hour, a week, a shift. */
export type ScheduleRow = {
    readonly id: string
    readonly label: string
}

/** One entry, placed in the cell where its row and column meet. Several in a cell stack in order. */
export type ScheduleItem = {
    readonly id: string
    readonly row: string
    readonly column: string
    readonly title: string
    /** One muted line under the title (who, where, how long). */
    readonly meta?: string
    /** The entry's state, by tone; the title and meta carry the meaning, the tone only helps. */
    readonly tone?: ScheduleTone
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

export type ScheduleGridProps = {
    /** Names the schedule for assistive technology, e.g. "Appointments, 2 to 8 November". */
    readonly label: string
    readonly columns: readonly ScheduleColumn[]
    readonly rows: readonly ScheduleRow[]
    readonly items: readonly ScheduleItem[]
    readonly cellLabels?: readonly ScheduleCellLabel[]
    /** What shows under the grid when no entry exists. Required: a schedule answers for its empty state. */
    readonly empty: ReactNode
    /** An entry was dropped on a cell. The grid keeps no state of its own: apply the move and pass the new `items`. */
    readonly onDrop?: (itemId: string, row: string, column: string) => void
    /**
     * The cells are pressable (pick then place by pointer or keyboard, or add an entry there). `cellPressLabel` names each cell
     * for assistive technology, e.g. "Monday 2 November, 09:00".
     */
    readonly onCellPress?: (row: string, column: string) => void
    readonly cellPressLabel?: (row: ScheduleRow, column: ScheduleColumn) => string
    readonly isLoading?: boolean
    /** The read failed: this takes the grid's place. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
}

/** Cells that hold a placeholder entry while the grid loads: one in three, so the shimmer reads as a schedule. */
const isPlaceholderCell = (rowIndex: number, columnIndex: number): boolean => (rowIndex + columnIndex) % 3 === 0

const ItemView = ({ item, onDragStart, onDragEnd }: { readonly item: ScheduleItem; readonly onDragStart: (id: string) => void; readonly onDragEnd: () => void }) => {
    const content = (
        <>
            <span className="starci-core-schedule-item-title">{item.title}</span>
            {item.meta === undefined ? null : <span className="starci-core-schedule-item-meta">{item.meta}</span>}
            {item.isInvalid === true && item.why !== undefined ? <span className="starci-core-schedule-item-why">{item.why}</span> : null}
        </>
    )
    const state = {
        "data-grammar-tone": item.tone ?? "neutral",
        ...(item.isSelected === true ? { "data-grammar-selected": "true" } : {}),
        ...(item.isInvalid === true ? { "data-grammar-invalid": "true" } : {}),
        ...(item.isDashed === true ? { "data-grammar-dashed": "true" } : {}),
    }
    const drag = item.isDraggable === true ? {
        draggable: true,
        "data-grammar-draggable": "true",
        onDragStart: (event: DragEvent<HTMLElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); onDragStart(item.id) },
        onDragEnd,
    } : {}
    return item.onPress === undefined ? (
        <div className="starci-core-schedule-item" {...state} {...drag}>{content}</div>
    ) : (
        <div className="starci-core-schedule-item-slot" {...drag}>
            <HeroButton className="starci-core-schedule-item" {...state} data-grammar-pressable="true" {...(item.isSelected === true ? { "aria-pressed": true } : {})} type="button" onPress={item.onPress}>{content}</HeroButton>
        </div>
    )
}

/**
 * Entries placed by row and column: a week by hour, people by day, a month by week. A real table (a caption, column
 * headings, a heading per row) on a wide container; below 48rem of its own width it reads as an agenda, each row a block
 * whose entries name their column, and empty cells are not drawn. A loading grid keeps the headings it was given as real
 * text and draws shimmering entries in the shape of real ones, so nothing jumps when the data lands.
 */
export const ScheduleGrid = ({ label, columns, rows, items, cellLabels = [], empty, onDrop, onCellPress, cellPressLabel, isLoading: ownLoading, error }: ScheduleGridProps) => {
    const isLoading = useIsLoading(ownLoading)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [overCell, setOverCell] = useState<string | null>(null)
    if (!isLoading && error !== undefined) {
        return <div data-tier="frame" data-component="ScheduleGrid" data-grammar-schedule-state="error"><ErrorView error={error} /></div>
    }
    const byCell = new Map<string, ScheduleItem[]>()
    for (const item of items) byCell.set(`${item.row}|${item.column}`, [...(byCell.get(`${item.row}|${item.column}`) ?? []), item])
    const labelOf = new Map(cellLabels.map((entry) => [`${entry.row}|${entry.column}`, entry.label]))
    const isEmpty = !isLoading && items.length === 0
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
                <table className="starci-core-schedule-table">
                    <caption className="starci-core-schedule-caption">{label}</caption>
                    <thead>
                        <tr>
                            <td className="starci-core-schedule-corner" />
                            {columns.map((column) => (
                                <th key={column.id} scope="col" className="starci-core-schedule-column" {...(column.isCurrent === true ? { "aria-current": "date", "data-grammar-current": "true" } : {})}>
                                    <span className="starci-core-schedule-column-label">{column.label}</span>
                                    {column.description === undefined ? null : <span className="starci-core-schedule-column-description">{column.description}</span>}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={row.id}>
                                <th scope="row" className="starci-core-schedule-row-label">{row.label}</th>
                                {columns.map((column, columnIndex) => {
                                    const key = `${row.id}|${column.id}`
                                    const cell = byCell.get(key) ?? []
                                    const cellLabel = labelOf.get(key)
                                    const placeholder = isLoading && isPlaceholderCell(rowIndex, columnIndex)
                                    const hasContent = cell.length > 0 || cellLabel !== undefined || placeholder
                                    return (
                                        <td
                                            key={column.id}
                                            className="starci-core-schedule-cell"
                                            data-grammar-cell-empty={hasContent ? "false" : "true"}
                                            {...(column.isCurrent === true ? { "data-grammar-current": "true" } : {})}
                                            {...(overCell === key ? { "data-grammar-drop": "true" } : {})}
                                            {...(onDrop === undefined || isLoading ? {} : {
                                                onDragOver: (event: DragEvent<HTMLElement>) => { if (draggingId === null) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (overCell !== key) setOverCell(key) },
                                                onDragLeave: (event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverCell((current) => current === key ? null : current) },
                                                onDrop: (event: DragEvent<HTMLElement>) => {
                                                    event.preventDefault()
                                                    const id = draggingId ?? event.dataTransfer.getData("text/plain")
                                                    setDraggingId(null)
                                                    setOverCell(null)
                                                    if (id !== "") onDrop(id, row.id, column.id)
                                                },
                                            })}
                                        >
                                            {onCellPress === undefined || isLoading ? null : (
                                                <button type="button" className="starci-core-schedule-cell-press" aria-label={cellPressLabel === undefined ? `${row.label}, ${column.label}` : cellPressLabel(row, column)} onClick={() => onCellPress(row.id, column.id)} />
                                            )}
                                            <span className="starci-core-schedule-cell-column" aria-hidden="true">{column.label}{column.description === undefined ? "" : ` ${column.description}`}</span>
                                            {cellLabel === undefined ? null : <span className="starci-core-schedule-cell-label">{cellLabel}</span>}
                                            {placeholder ? <span className="starci-core-schedule-item" data-grammar-tone="neutral"><Skeleton shape="text" lines={2} /></span> : cell.map((item) => <ItemView key={item.id} item={item} onDragStart={setDraggingId} onDragEnd={() => { setDraggingId(null); setOverCell(null) }} />)}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </HorizontalScrollRegionPart>
            {isEmpty ? <div className="starci-core-schedule-empty">{empty}</div> : null}
        </div>
    )
}
