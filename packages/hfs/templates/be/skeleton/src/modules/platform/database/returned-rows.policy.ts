import { isRecord } from "@modules/platform/primitives"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"

/** What node-postgres hands back for one returned column; a kind ending in `?` also admits SQL null. */
interface ColumnTypes {
    readonly string: string
    readonly number: number
    readonly boolean: boolean
    readonly date: Date
    readonly json: unknown
    readonly "string?": string | null
    readonly "number?": number | null
    readonly "boolean?": boolean | null
    readonly "date?": Date | null
}

/** The kind one returned column is checked against. */
type ColumnKind = keyof ColumnTypes

/** The returned columns of one statement, each named as the database returns it (snake_case) with its kind. */
type ColumnShape = Readonly<Record<string, ColumnKind>>

/** The row a shape describes: every named column, typed by its kind. */
type RowOf<Shape extends ColumnShape> = { readonly [Column in keyof Shape]: ColumnTypes[Shape[Column]] }

/** A guard that proves one returned row has the shape its returned columns give it. */
type RowGuard<Row> = (value: unknown) => value is Row

/** Whether `value` is of the non-null part of a kind. */
const KIND_CHECKS: Readonly<Record<ColumnKind, (value: unknown) => boolean>> = {
    string: (value) => typeof value === "string",
    number: (value) => typeof value === "number",
    boolean: (value) => typeof value === "boolean",
    date: (value) => value instanceof Date,
    json: (value) => value !== undefined,
    "string?": (value) => value === null || typeof value === "string",
    "number?": (value) => value === null || typeof value === "number",
    "boolean?": (value) => value === null || typeof value === "boolean",
    "date?": (value) => value === null || value instanceof Date,
}

/**
 * The guard of the rows a RETURNING clause answers for `shape`: an object holding every named column with a value of its kind.
 * A column the statement does not return is refused, so the shape and the RETURNING list cannot drift apart unseen.
 */
export const rowShape =
    <Shape extends ColumnShape>(shape: Shape): RowGuard<RowOf<Shape>> =>
    (value: unknown): value is RowOf<Shape> =>
        isRecord(value) && Object.entries(shape).every(([column, kind]) => KIND_CHECKS[kind](value[column]))

/**
 * The rows a RETURNING statement answered, each proven by `isRow`: the result of `manager.query` for an INSERT or a CTE-wrapped
 * UPDATE or DELETE, or the `raw` of a query builder's `execute()`. A result that is not a list of rows, or a row the guard
 * refuses, throws `DATABASE_RETURNING_ROW_REJECTED`: the statement and the shape its caller expects disagree.
 */
export const returnedRows = <Row>(raw: unknown, isRow: RowGuard<Row>): Array<Row> => {
    if (!Array.isArray(raw)) throw new DatabaseError({ code: DatabaseErrorCode.ReturningRowRejected })
    const rows: ReadonlyArray<unknown> = raw
    if (!rows.every(isRow)) throw new DatabaseError({ code: DatabaseErrorCode.ReturningRowRejected })
    return [...rows]
}
