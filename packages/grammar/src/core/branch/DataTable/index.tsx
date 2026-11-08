"use client"

import { Checkbox as HeroCheckbox, Table as HeroTable, type Selection, type SortDescriptor } from "@heroui/react"
import { useEffect, useRef, useState, type CSSProperties, type DragEventHandler, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { ErrorView, LOADING_ROWS, type ErrorData } from "../../loadingState.js"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** A table of this many columns or fewer fits its container (its columns shrink to their words); a wider one keeps its natural width and scrolls. */
const FIT_COLUMNS = 4

export type DataTableColumn<Row extends DataTableRow = DataTableRow> = {
    readonly id: string
    readonly label: string
    /**
     * The heading stays for assistive technology but is not drawn: an action or menu column whose meaning is plain from its
     * cells (a row's main button, its ⋯ menu). Default false.
     */
    readonly isLabelHidden?: boolean
    /** The column that names each row for assistive technology. Defaults to the first column. */
    readonly isRowHeader?: boolean
    readonly allowsSorting?: boolean
    readonly align?: "start" | "end"
    /** A column of amounts or counts: its cells and heading never wrap, read in tabular numerals and align to the end. */
    readonly isNumeric?: boolean
    /**
     * Narrow-width mode. A `low` column leaves the header below the table's `collapseBelow` width and its value joins the
     * row as stacked secondary text (its label, then its cell) under the first `high` column's content. Default `high`.
     */
    readonly priority?: "high" | "low"
    /**
     * Makes every cell of the column an editor: the render returns a Select, NumberField, TagGroup or other field for the row.
     * The editor owns its keys and focus. Arrow keys, Enter, Space and typing stay inside it, Tab moves through the cell's fields
     * and Escape returns focus to the cell. A table with an editor column leaves the grid's arrow-key cell navigation for
     * cell-to-cell Tab and arrow movement from the cell itself (React Aria's `tab` keyboard behaviour), so editors work.
     */
    readonly editor?: (row: Row) => ReactNode
}

export type DataTableSort = {
    readonly columnId: string
    readonly direction: "ascending" | "descending"
}

export type DataTableRow = {
    readonly id: string
    /** A destination: the whole row becomes a link target, so a click or Enter on the row navigates through the app's router. */
    readonly href?: string
}

/** Cell effects belong to the caller; the table owns cell semantics, focus and activation. */
export type DataTableCellInteraction = {
    /** Invoked by a cell click or Enter/Space on the focused cell, excluding nested controls. */
    readonly onAction?: () => void
    readonly onDragOver?: DragEventHandler<HTMLDivElement>
    readonly onDragLeave?: DragEventHandler<HTMLDivElement>
    readonly onDrop?: DragEventHandler<HTMLDivElement>
}

/** A run of rows under one group heading row (a day of a ledger): its `label` and an optional end-of-group `fact`. */
export type DataTableGroup<Row extends DataTableRow = DataTableRow> = {
    readonly id: string
    /** The group heading, e.g. the date. */
    readonly label: string
    /** One short fact at the end of the heading row, e.g. the end-of-day balance. */
    readonly fact?: string
    readonly rows: ReadonlyArray<Row>
}

/** The rows of a table: one flat list, or groups of rows under heading rows inside the same table. */
type DataTableRows<Row extends DataTableRow> =
    | { readonly rows: ReadonlyArray<Row>; readonly groups?: undefined }
    | { readonly groups: ReadonlyArray<DataTableGroup<Row>>; readonly rows?: undefined }

export type DataTableProps<Row extends DataTableRow> = NoChildren & DataTableRows<Row> & {
    /** Names the table, e.g. "Invoices". */
    readonly label: string
    readonly columns: ReadonlyArray<DataTableColumn<Row>>
    readonly renderCell: (row: Row, columnId: string) => ReactNode
    /** Optional cell actions and native drop events. An actionable cell receives arrow-key focus itself. */
    readonly getCellInteraction?: (row: Row, columnId: string) => DataTableCellInteraction | undefined
    /** Controlled sort. Sorting the rows stays with the app; the table announces `aria-sort`. */
    readonly sort?: DataTableSort
    readonly onSortChange?: (sort: DataTableSort) => void
    readonly selectionMode?: "none" | "single" | "multiple"
    readonly selectedIds?: ReadonlyArray<string> | "all"
    readonly defaultSelectedIds?: ReadonlyArray<string> | "all"
    readonly onSelectionChange?: (ids: ReadonlyArray<string> | "all") => void
    /** App-owned accessible names of the selection checkboxes in multiple mode. */
    readonly selectAllLabel?: string
    readonly selectRowLabel?: (row: Row) => string
    /**
     * The first read has no data yet (knowledge STATE-8). The table is busy, the real column headers stay and the body draws one
     * skeleton row per row it was given (the block's same-shape placeholder), or a default few when it has none. A refresh that
     * has data is not loading. Loading comes first, then `error`, then `emptyContent`.
     */
    readonly isLoading?: boolean
    /** The read failed: this takes the place of the rows, as `emptyContent` does. */
    readonly error?: ErrorData
    /** Shown when there are no rows and the table is not loading. */
    readonly emptyContent: ReactNode
    /** Keep the column header visible while the body scrolls inside `maxBlockSize`. */
    readonly stickyHeader?: boolean
    /** Bounds the body so the table owns vertical scroll, e.g. "24rem". */
    readonly maxBlockSize?: string
    /**
     * Makes every row pressable (opens a drawer, a detail): called with the row's `id` on a click, or Enter / Space on the focused row
     * (React Aria's row action, so the row is a focus stop with the table's focus ring). The pressable row takes the pointer cursor and
     * the hover fill; buttons, links and editors inside a row keep their own press. Runs alongside a row `href` when both are given.
     * The row's title stays plain text: do not render it as a Link.
     */
    readonly onRowAction?: (id: string) => void
    /** Container inline size in px below which `low` priority columns collapse into the row. Default 640. */
    readonly collapseBelow?: number
    /**
     * `card` (default): the table standing alone IS the surface: ONE frame (a 1px separator edge, the card radius, the surface ground,
     * clipped) with its heading row inside it; no grey band and no inner rounded body (the single-child-card law: never wrap a lone
     * table in a SurfaceCard; title it with a Section head and put one `caption` under it). `none`: plain hairline rows under a muted
     * heading with no container paint, for a table inside a card (full bleed) that must not be a surface inside a surface.
     */
    readonly surface?: "card" | "none"
}

/** The vendor row part filters aria-hidden out of its props, so the skeleton rows take it by ref (knowledge STATE-8). */
const hideFromAssistiveTechnology = (node: HTMLElement | null) => node?.setAttribute("aria-hidden", "true")

const SELECTION_COLUMN = "starci-data-table-selection"

// Labels activate their associated inputs; editable content, media and ARIA widgets own their gestures too.
const CELL_CONTROL_SELECTOR = [
    "button", "a", "input", "select", "textarea", "label", "summary",
    "audio[controls]", "video[controls]", '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]:not([tabindex="-1"])',
    ...["button", "link", "checkbox", "combobox", "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox", "treeitem"].map((role) => `[role="${role}"]`),
].join(",")

const isNestedCellControl = (target: EventTarget, cell: HTMLTableCellElement): boolean => {
    if (!(target instanceof Element)) return false
    const control = target.closest(CELL_CONTROL_SELECTOR)
    return control !== null && control !== cell && cell.contains(control)
}

const DEFAULT_COLLAPSE_BELOW = 640

// An editor owns its pointer and key gestures; they must not select the row, run its action or follow its link.
const stopEditorPress = (event: { stopPropagation: () => void }) => event.stopPropagation()

const EditorHost = ({ children }: { readonly children: ReactNode }) => (
    <div
        className="starci-core-data-table-editor"
        data-grammar-cell-editor="true"
        onClick={stopEditorPress}
        onPointerDown={stopEditorPress}
        onPointerUp={stopEditorPress}
        onMouseDown={stopEditorPress}
        onKeyDown={(event) => {
            if (event.key !== "Escape") return
            const cell = event.currentTarget.closest<HTMLElement>("[role='gridcell']")
            if (cell === null) return
            event.preventDefault()
            event.stopPropagation()
            cell.focus()
        }}
    >
        {children}
    </div>
)

type CellBodyProps<Row extends DataTableRow> = {
    readonly row: Row
    readonly column: DataTableColumn<Row>
    readonly renderBody: (row: Row, column: DataTableColumn<Row>) => ReactNode
    /** Low-priority columns folded into this cell as stacked secondary text. */
    readonly collapsed: ReadonlyArray<DataTableColumn<Row>>
    readonly renderCell: (row: Row, columnId: string) => ReactNode
}

const CellBody = <Row extends DataTableRow>({ row, column, renderBody, collapsed, renderCell }: CellBodyProps<Row>) => (
    <>
        {renderBody(row, column)}
        {collapsed.length === 0 ? null : (
            <div className="starci-core-data-table-secondary" data-grammar-table-secondary="true">
                {collapsed.map((hidden) => (
                    <div key={hidden.id} className="starci-core-data-table-secondary-item" data-grammar-table-secondary-column={hidden.id}>
                        <span className="starci-core-data-table-secondary-label">{hidden.label}</span>
                        <span className="starci-core-data-table-secondary-value">{hidden.editor === undefined ? renderCell(row, hidden.id) : <EditorHost>{hidden.editor(row)}</EditorHost>}</span>
                    </div>
                ))}
            </div>
        )}
    </>
)

const toSortDescriptor = (sort: DataTableSort): SortDescriptor => ({ column: sort.columnId, direction: sort.direction })

const toIds = (selection: Selection): ReadonlyArray<string> | "all" => selection === "all" ? "all" : [...selection].map(String)

const toSelection = (ids: ReadonlyArray<string> | "all"): Selection => ids === "all" ? "all" : new Set(ids)

const SelectionCheckbox = ({ label }: { readonly label: string | undefined }) => (
    <HeroCheckbox className="starci-core-data-table-checkbox" slot="selection" {...(label === undefined ? {} : { "aria-label": label })}>
        <HeroCheckbox.Content>
            <HeroCheckbox.Control>
                <HeroCheckbox.Indicator />
            </HeroCheckbox.Control>
        </HeroCheckbox.Content>
    </HeroCheckbox>
)

/*
 * Consumer hooks: `starci-core-data-table-sort`, `starci-core-data-table-body`,
 * `starci-core-data-table-checkbox` name HeroUI parts whose vendor paint Common leaves as it is. No
 * shipped sheet paints them; the Grammar name lets a consumer or family select those parts without
 * reaching for vendor class names.
 */

/**
 * Tabular data with sortable columns (`aria-sort`), row selection (`aria-selected`,
 * `data-grammar-selected`), empty and loading states, an optional sticky header, and its own
 * horizontal scroll so a wide table never widens a 360px page.
 * Contract: scroll LAYOUT-3, grid FOCUS-2 STATE-1, row FOCUS-1, empty STATE-3.
 */
export const DataTable = <Row extends DataTableRow>({
    label,
    columns,
    rows: flatRows,
    groups,
    renderCell,
    getCellInteraction,
    sort,
    onSortChange,
    selectionMode = "none",
    selectedIds,
    defaultSelectedIds,
    onSelectionChange,
    selectAllLabel,
    selectRowLabel,
    isLoading: ownLoading,
    error,
    emptyContent,
    stickyHeader = false,
    maxBlockSize,
    onRowAction,
    collapseBelow = DEFAULT_COLLAPSE_BELOW,
    surface = "card",
}: DataTableProps<Row>) => {
    const rows: ReadonlyArray<Row> = groups === undefined ? flatRows ?? [] : groups.flatMap((group) => group.rows)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState<number | null>(null)
    useEffect(() => {
        const element = scrollRef.current
        if (element === null) return
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (entry !== undefined) setWidth(entry.contentRect.width)
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [])
    const hasHigh = columns.some((column) => column.priority !== "low")
    const narrow = hasHigh && width !== null && width < collapseBelow
    const collapsed = narrow ? columns.filter((column) => column.priority === "low") : []
    const shown = narrow ? columns.filter((column) => column.priority !== "low") : columns
    const rowHeaderId = shown.find((column) => column.isRowHeader)?.id ?? shown[0]?.id
    const hostColumnId = rowHeaderId
    const hasEditors = columns.some((column) => column.editor !== undefined)
    const renderBody = (row: Row, column: DataTableColumn<Row>): ReactNode => column.editor === undefined
        ? renderCell(row, column.id)
        : <EditorHost>{column.editor(row)}</EditorHost>
    const multiple = selectionMode === "multiple"
    // Selection is always held here so every row can expose its own `data-grammar-selected`.
    const [uncontrolledSelection, setUncontrolledSelection] = useState<ReadonlyArray<string> | "all">(defaultSelectedIds ?? [])
    const selection = selectedIds ?? uncontrolledSelection
    const isRowSelected = (id: string) => selection === "all" || selection.includes(id)
    const isLoading = useIsLoading(ownLoading)
    const skeletonRows = isLoading ? Array.from({ length: rows.length > 0 ? Math.min(12, rows.length) : LOADING_ROWS }, (_, index) => ({ id: `starci-skeleton-${index}` })) : []
    const failed = !isLoading && error !== undefined
    const visibleRows = isLoading || failed ? [] : rows
    // Rows in order, a group's heading row before its rows (a group with no rows draws no heading).
    const entries: ReadonlyArray<{ readonly group: DataTableGroup<Row> | undefined; readonly row: Row | undefined }> = isLoading || failed
        ? []
        : groups === undefined
            ? visibleRows.map((row) => ({ group: undefined, row }))
            : groups.filter((group) => group.rows.length > 0).flatMap((group) => [{ group, row: undefined }, ...group.rows.map((row) => ({ group: undefined, row }))])
    const columnCount = shown.length + (multiple ? 1 : 0)
    const state = isLoading ? "loading" : failed ? "error" : rows.length === 0 ? "empty" : "ready"
    const scrollStyle = maxBlockSize === undefined ? undefined : { "--starci-core-data-table-max-block-size": maxBlockSize } as CSSProperties
    // RAC filters consumer key handlers out of Cell props. The native scroll owner captures activation before its grid handlers.
    const onCellKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return
        const cell = event.target
        if (!(cell instanceof HTMLTableCellElement) || cell.closest(".starci-core-data-table-scroll") !== event.currentTarget) return
        const row = visibleRows.find((candidate) => candidate.id === cell.dataset.grammarRowId)
        const columnId = cell.dataset.grammarColumnId
        if (row === undefined || columnId === undefined) return
        const action = getCellInteraction?.(row, columnId)?.onAction
        if (action === undefined) return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) action()
    }
    return (
        <HeroTable
            aria-busy={isLoading || undefined}
            className="starci-core-data-table"
            variant="secondary"
            data-grammar-table-surface={surface}
            data-component="DataTable"
            data-tier="branch"
            data-grammar-table-state={state}
            data-grammar-table-sticky={stickyHeader ? "true" : "false"}
            data-grammar-table-bounded={maxBlockSize === undefined ? "false" : "true"}
            data-grammar-table-narrow={narrow ? "true" : "false"}
            data-grammar-table-editors={hasEditors ? "true" : "false"}
            data-grammar-table-fit={shown.length <= FIT_COLUMNS ? "true" : "false"}
        >
            <HeroTable.ScrollContainer ref={scrollRef} className="starci-core-data-table-scroll" data-contract="LAYOUT-3" data-grammar-table-scroll="true" style={scrollStyle} onKeyDownCapture={onCellKeyDown}>
                <HeroTable.Content
                    aria-label={label}
                    {...(hasEditors ? { keyboardNavigationBehavior: "tab" as const } : getCellInteraction === undefined ? {} : { keyboardNavigationBehavior: "arrow" as const })}
                    className="starci-core-data-table-content"
                    data-contract="FOCUS-2 STATE-1"
                    selectionMode={isLoading ? "none" : selectionMode}
                    {...(sort === undefined ? {} : { sortDescriptor: toSortDescriptor(sort) })}
                    {...(onSortChange === undefined ? {} : {
                        onSortChange: (descriptor: SortDescriptor) => onSortChange({ columnId: String(descriptor.column), direction: descriptor.direction }),
                    })}
                    selectedKeys={toSelection(selection)}
                    onSelectionChange={(next: Selection) => {
                        const ids = toIds(next)
                        if (selectedIds === undefined) setUncontrolledSelection(ids)
                        onSelectionChange?.(ids)
                    }}
                    {...(onRowAction === undefined ? {} : { onRowAction: (key: string | number) => onRowAction(String(key)) })}
                >
                    <HeroTable.Header className="starci-core-data-table-header">
                        {multiple ? (
                            <HeroTable.Column className="starci-core-data-table-column" data-grammar-table-selection="true" id={SELECTION_COLUMN}>
                                <SelectionCheckbox label={selectAllLabel} />
                            </HeroTable.Column>
                        ) : null}
                        {shown.map((column) => (
                            <HeroTable.Column
                                key={column.id}
                                id={column.id}
                                allowsSorting={column.allowsSorting === true}
                                className="starci-core-data-table-column"
                                data-grammar-table-align={column.align ?? (column.isNumeric === true ? "end" : "start")}
                                {...(column.isNumeric === true ? { "data-grammar-table-numeric": "true" } : {})}
                                isRowHeader={column.id === rowHeaderId}
                                textValue={column.label}
                            >
                                {({ sortDirection }: { readonly sortDirection: "ascending" | "descending" | undefined }) => column.allowsSorting === true
                                    ? <HeroTable.SortableColumnHeader className="starci-core-data-table-sort" {...(sortDirection === undefined ? {} : { sortDirection })}>{column.label}</HeroTable.SortableColumnHeader>
                                    : column.isLabelHidden === true ? <span className="starci-core-visually-hidden">{column.label}</span> : column.label}
                            </HeroTable.Column>
                        ))}
                    </HeroTable.Header>
                    <HeroTable.Body
                        className="starci-core-data-table-body"
                        renderEmptyState={() => failed
                            ? <div className="starci-core-data-table-placeholder" data-grammar-table-error="true"><ErrorView error={error} /></div>
                            : <div className="starci-core-data-table-placeholder" data-contract="STATE-3" data-grammar-table-empty="true">{emptyContent}</div>}
                    >
                        {skeletonRows.map((row) => (
                            <HeroTable.Row key={row.id} id={row.id} ref={hideFromAssistiveTechnology} className="starci-core-data-table-row" data-grammar-table-row="true" data-grammar-skeleton="true" data-grammar-selected="false">
                                {multiple ? <HeroTable.Cell className="starci-core-data-table-cell" data-grammar-table-selection="true">{null}</HeroTable.Cell> : null}
                                {shown.map((column) => (
                                    <HeroTable.Cell key={column.id} className="starci-core-data-table-cell" data-grammar-table-align={column.align ?? "start"}><Skeleton shape="text" /></HeroTable.Cell>
                                ))}
                            </HeroTable.Row>
                        ))}
                        {entries.map(({ group, row }) => group !== undefined ? (
                            <HeroTable.Row key={`group-${group.id}`} id={`group-${group.id}`} textValue={group.label} className="starci-core-data-table-row starci-core-data-table-group-row" data-grammar-table-group="true" data-grammar-selected="false">
                                <HeroTable.Cell className="starci-core-data-table-cell starci-core-data-table-group-cell" colSpan={columnCount}>
                                    <div className="starci-core-data-table-group-line">
                                        <span className="starci-core-data-table-group-label">{group.label}</span>
                                        {group.fact === undefined ? null : <span className="starci-core-data-table-group-fact" data-grammar-table-numeric="true">{group.fact}</span>}
                                    </div>
                                </HeroTable.Cell>
                            </HeroTable.Row>
                        ) : row === undefined ? null : (
                            <HeroTable.Row
                                key={row.id}
                                id={row.id}
                                className="starci-core-data-table-row"
                                data-contract="FOCUS-1"
                                data-grammar-table-row="true"
                                {...(row.href === undefined ? {} : { href: row.href })}
                                data-grammar-table-row-link={row.href === undefined ? "false" : "true"}
                                data-grammar-table-row-pressable={row.href !== undefined || onRowAction !== undefined ? "true" : "false"}
                                data-grammar-selected={selectionMode !== "none" && isRowSelected(row.id) ? "true" : "false"}
                            >
                                {multiple ? (
                                        <HeroTable.Cell className="starci-core-data-table-cell" data-grammar-table-selection="true">
                                            <SelectionCheckbox label={selectRowLabel?.(row)} />
                                        </HeroTable.Cell>
                                    ) : null}
                                    {shown.map((column) => {
                                        const interaction = getCellInteraction?.(row, column.id)
                                        return <HeroTable.Cell
                                            key={column.id}
                                            className="starci-core-data-table-cell"
                                            data-grammar-table-align={column.align ?? (column.isNumeric === true ? "end" : "start")}
                                            {...(column.isNumeric === true ? { "data-grammar-table-numeric": "true" } : {})}
                                            data-grammar-cell-interaction={interaction === undefined ? "false" : "true"}
                                            data-grammar-row-id={row.id}
                                            data-grammar-column-id={column.id}
                                            {...(column.id === rowHeaderId ? { "data-grammar-table-row-header": "true" } : {})}
                                            {...(interaction?.onAction === undefined ? {} : {
                                                focusMode: "cell" as const,
                                                onClick: (event: MouseEvent<HTMLTableCellElement>) => {
                                                    // Descendant controls keep their own actions; plain cell content activates the cell.
                                                    if (isNestedCellControl(event.target, event.currentTarget)) return
                                                    event.stopPropagation()
                                                    interaction.onAction?.()
                                                },
                                            })}
                                        >
                                            <ButtonPlacementProvider placement="item">
                                            {interaction === undefined ? <CellBody row={row} column={column} renderBody={renderBody} collapsed={column.id === hostColumnId ? collapsed : []} renderCell={renderCell} /> : (
                                                <div
                                                    className="starci-core-data-table-cell-content"
                                                    {...(interaction.onDragOver === undefined ? {} : { onDragOver: interaction.onDragOver })}
                                                    {...(interaction.onDragLeave === undefined ? {} : { onDragLeave: interaction.onDragLeave })}
                                                    {...(interaction.onDrop === undefined ? {} : { onDrop: interaction.onDrop })}
                                                >
                                                    <CellBody row={row} column={column} renderBody={renderBody} collapsed={column.id === hostColumnId ? collapsed : []} renderCell={renderCell} />
                                                </div>
                                            )}
                                            </ButtonPlacementProvider>
                                        </HeroTable.Cell>
                                    })}
                            </HeroTable.Row>
                        ))}
                    </HeroTable.Body>
                </HeroTable.Content>
            </HeroTable.ScrollContainer>
        </HeroTable>
    )
}
