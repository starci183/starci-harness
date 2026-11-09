"use client"

import { DataTable, type DataTableColumn, type DataTableRow } from "../../branch/DataTable/index.js"
import type { TableData, TableRowData } from "../../surfaceCardData.js"

type Row = DataTableRow & Pick<TableRowData, "cells">

/**
 * The table a `kind="table"` card holds: Grammar's own `DataTable` as the `frame` (0.37.8): the card is a list card (white, the edge of its ground, header
 * zones and a `paging` footer zone divided by the zone seam), the column labels (12, muted) on the white and 1px full-width row dividers. One implementation: the card
 * passes data, the table draws it.
 */
export const TableRows = ({ data, isLoading, ariaLabel }: {
    readonly data: TableData
    readonly isLoading: boolean
    readonly ariaLabel?: string | undefined
}) => {
    const columns: ReadonlyArray<DataTableColumn<Row>> = data.columns.map((column) => ({
        id: column.id,
        label: column.label,
        ...(column.align === undefined ? {} : { align: column.align }),
        ...(column.numeric === true ? { isNumeric: true } : {}),
        ...(column.priority === undefined ? {} : { priority: column.priority }),
        ...(column.width === undefined ? {} : { width: column.width }),
        ...(column.minWidth === undefined ? {} : { minWidth: column.minWidth }),
        ...(column.truncate === true ? { truncate: true } : {}),
        ...(column.hideBelow === undefined ? {} : { hideBelow: column.hideBelow }),
    }))
    const shared = {
        label: ariaLabel ?? "",
        columns,
        renderCell: (row: Row, columnId: string) => row.cells[columnId] ?? null,
        isLoading,
        emptyContent: data.empty,
        surface: "frame" as const,
        ...(data.onRowAction === undefined ? {} : { onRowAction: data.onRowAction }),
        ...(data.resizable === true ? { resizable: true } : {}),
        ...(data.id === undefined ? {} : { id: data.id }),
        ...(data.phone === undefined ? {} : { phone: data.phone }),
    }
    return data.groups === undefined
        ? <DataTable<Row> {...shared} rows={data.rows} />
        : <DataTable<Row> {...shared} groups={data.groups} />
}
