"use client"

import { Checkbox as HeroCheckbox, Table as HeroTable, type Selection, type SortDescriptor } from "@heroui/react"
import { useEffect, useRef, useState, type CSSProperties, type DragEventHandler, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Skeleton } from "../../primitive/Skeleton/index.js"
import { navigationClassName } from "../../navigationClassNames.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"

export type DataTableColumn<Row extends DataTableRow = DataTableRow> = {
    readonly id: string
    readonly label: string
    /** The column that names each row for assistive technology. Defaults to the first column. */
    readonly isRowHeader?: boolean
    readonly allowsSorting?: boolean
    readonly align?: "start" | "end"
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

export type DataTableProps<Row extends DataTableRow> = {
    /** Names the table, e.g. "Invoices". */
    readonly label: string
    readonly columns: ReadonlyArray<DataTableColumn<Row>>
    readonly rows: ReadonlyArray<Row>
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
     * Marks the table busy and replaces the rows (knowledge STATE-8). With no `loadingContent` the real column headers stay
     * and the body draws `loadingRows` skeleton rows; `loadingContent` replaces the body with that content instead.
     */
    readonly isLoading?: boolean
    /** Skeleton rows drawn while loading without `loadingContent` (default 3, 1 to 12). */
    readonly loadingRows?: number
    readonly loadingContent?: ReactNode
    /** Shown when there are no rows and the table is not loading. */
    readonly emptyContent: ReactNode
    /** Keep the column header visible while the body scrolls inside `maxBlockSize`. */
    readonly stickyHeader?: boolean
    /** Bounds the body so the table owns vertical scroll, e.g. "24rem". */
    readonly maxBlockSize?: string
    /** Runs when a row is activated (click, Enter), alongside a row `href` when both are given. */
    readonly onRowAction?: (id: string) => void
    /** Container inline size in px below which `low` priority columns collapse into the row. Default 640. */
    readonly collapseBelow?: number
    readonly className?: string
}

/** The row primitive filters aria-hidden out of its props, so the skeleton rows take it by ref (knowledge STATE-8). */
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
    rows,
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
    isLoading = false,
    loadingContent,
    loadingRows = 3,
    emptyContent,
    stickyHeader = false,
    maxBlockSize,
    onRowAction,
    collapseBelow = DEFAULT_COLLAPSE_BELOW,
    className,
}: DataTableProps<Row>) => {
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
    const isSkeleton = isLoading && loadingContent === undefined
    const skeletonRows = isSkeleton ? Array.from({ length: Math.min(12, Math.max(1, Math.floor(Number.isFinite(loadingRows) ? loadingRows : 3))) }, (_, index) => ({ id: `starci-skeleton-${index}` })) : []
    const visibleRows = isLoading ? [] : rows
    const state = isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"
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
            className={navigationClassName("starci-core-data-table", className)}
            data-component="DataTable"
            data-tier="branch"
            data-grammar-table-state={state}
            data-grammar-table-sticky={stickyHeader ? "true" : "false"}
            data-grammar-table-bounded={maxBlockSize === undefined ? "false" : "true"}
            data-grammar-table-narrow={narrow ? "true" : "false"}
            data-grammar-table-editors={hasEditors ? "true" : "false"}
        >
            <HeroTable.ScrollContainer ref={scrollRef} className="starci-core-data-table-scroll" data-contract="LAYOUT-3" data-grammar-table-scroll="true" style={scrollStyle} onKeyDownCapture={onCellKeyDown}>
                <HeroTable.Content
                    aria-label={label}
                    {...(hasEditors ? { keyboardNavigationBehavior: "tab" as const } : getCellInteraction === undefined ? {} : { keyboardNavigationBehavior: "arrow" as const })}
                    className="starci-core-data-table-content"
                    data-contract="FOCUS-2 STATE-1"
                    selectionMode={isSkeleton ? "none" : selectionMode}
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
                                data-grammar-table-align={column.align ?? "start"}
                                isRowHeader={column.id === rowHeaderId}
                                textValue={column.label}
                            >
                                {({ sortDirection }: { readonly sortDirection: "ascending" | "descending" | undefined }) => column.allowsSorting === true
                                    ? <HeroTable.SortableColumnHeader className="starci-core-data-table-sort" {...(sortDirection === undefined ? {} : { sortDirection })}>{column.label}</HeroTable.SortableColumnHeader>
                                    : column.label}
                            </HeroTable.Column>
                        ))}
                    </HeroTable.Header>
                    <HeroTable.Body
                        className="starci-core-data-table-body"
                        renderEmptyState={() => isLoading
                            ? <div className="starci-core-data-table-placeholder" data-grammar-table-loading="true" role="status">{loadingContent}</div>
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
                        {visibleRows.map((row) => (
                            <HeroTable.Row
                                key={row.id}
                                id={row.id}
                                className="starci-core-data-table-row"
                                data-contract="FOCUS-1"
                                data-grammar-table-row="true"
                                {...(row.href === undefined ? {} : { href: row.href })}
                                data-grammar-table-row-link={row.href === undefined ? "false" : "true"}
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
                                            data-grammar-table-align={column.align ?? "start"}
                                            data-grammar-cell-interaction={interaction === undefined ? "false" : "true"}
                                            data-grammar-row-id={row.id}
                                            data-grammar-column-id={column.id}
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
