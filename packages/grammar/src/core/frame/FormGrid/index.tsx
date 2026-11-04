import { Children, isValidElement, type ReactNode } from "react"

/** How many fields share a row once the grid's own width holds them. */
export type FormGridColumns = 1 | 2

export type FormGridProps = {
    /** The fields, in reading order; they fill the rows left to right. */
    readonly children: ReactNode
    /** Fields per row at a wide container; below it every row is one column (RESPONSIVE-1). Default 2. */
    readonly columns?: FormGridColumns
}

/**
 * The form column layout. Fields fill rows of `columns`; every row is a grid of four tracks (label, control, description,
 * error) that each field takes as a subgrid, so the controls of one row stand on one line whether or not a neighbour
 * carries a description, an error or a two-line label. The columns come from a container query on the grid itself, never
 * from the viewport, so a form in a narrow owner (drawer, rail, dialog) stays one column.
 */
export const FormGrid = ({ children, columns = 2 }: FormGridProps) => {
    const fields = Children.toArray(children)
    const rows: ReactNode[][] = []
    const isFull = (field: ReactNode) => isValidElement<{ readonly span?: string }>(field) && field.props.span === "full"
    let current: ReactNode[] = []
    for (const field of fields) {
        if (isFull(field)) {
            if (current.length > 0) rows.push(current)
            current = []
            rows.push([field])
        } else {
            current.push(field)
            if (current.length === columns) {
                rows.push(current)
                current = []
            }
        }
    }
    if (current.length > 0) rows.push(current)
    return (
        <div
            data-tier="frame"
            data-component="FormGrid"
            data-contract="RESPONSIVE-1"
            data-grammar-form-grid-columns={String(columns)}
            className="starci-core-form-grid"
        >
            {rows.map((row) => (
                <div
                    key={row.map((field) => (isValidElement(field) ? String(field.key) : "")).join("|")}
                    className="starci-core-form-grid-row"
                    data-grammar-form-grid-row="true"
                    {...(row.length === 1 && isFull(row[0]) ? { "data-grammar-form-grid-full": "true" } : {})}
                >
                    {row}
                </div>
            ))}
        </div>
    )
}
