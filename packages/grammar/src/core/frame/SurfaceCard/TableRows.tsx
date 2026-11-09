"use client"

import { DataTable, type DataTableColumn, type DataTableRow } from "../../branch/DataTable/index.js"
import type { TableData, TableRowData } from "../../surfaceCardData.js"

type Row = DataTableRow & Pick<TableRowData, "cells">

/**
 * The table a `kind="table"` card holds: Grammar's own `DataTable` as the `frame` (0.36.0): the card IS HeroUI's grey frame (CSS on the
 * card's `data-grammar-surface-kind="table"`, no border), the heading row on the grey, the rows on a white rounded body, and a `paging`
 * footer zone below it in the grey. One implementation: the card passes data, the table draws it.
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
    }))
    const shared = {
        label: ariaLabel ?? "",
        columns,
        renderCell: (row: Row, columnId: string) => row.cells[columnId] ?? null,
        isLoading,
        emptyContent: data.empty,
        surface: "frame" as const,
        ...(data.onRowAction === undefined ? {} : { onRowAction: data.onRowAction }),
    }
    return data.groups === undefined
        ? <DataTable<Row> {...shared} rows={data.rows} />
        : <DataTable<Row> {...shared} groups={data.groups} />
}
