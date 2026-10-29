import { Test } from "@nestjs/testing"
import { DatabaseErrorCode } from "./errors/database.error"
import { returnedRows, rowShape } from "./returned-rows.policy"

const RETURNED_ROWS_POLICY: unique symbol = Symbol("database.returned-rows")

/** The policy under test, resolved through a testing module as the unit spec standard asks. */
interface ReturnedRowsPolicy {
    readonly returnedRows: typeof returnedRows
    readonly rowShape: typeof rowShape
}

const AT = new Date("2026-02-03T04:05:06.000Z")

describe("returned rows", () => {
    let subject: ReturnedRowsPolicy

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [{ provide: RETURNED_ROWS_POLICY, useFactory: (): ReturnedRowsPolicy => ({ returnedRows, rowShape }) }],
        }).compile()
        subject = moduleRef.get<ReturnedRowsPolicy>(RETURNED_ROWS_POLICY)
    })

    describe("rowShape", () => {
        it("admits a row holding every named column with a value of its kind", () => {
            const isRow = subject.rowShape({ id: "string", hits: "number", open: "boolean", created_at: "date", payload: "json" })

            expect(isRow({ id: "row-1", hits: 2, open: true, created_at: AT, payload: { a: 1 }, extra: "kept" })).toBe(true)
        })

        it("admits null only for a kind that ends in ?", () => {
            const isRow = subject.rowShape({ note: "string?", hits: "number?", open: "boolean?", seen_at: "date?" })

            expect(isRow({ note: null, hits: null, open: null, seen_at: null })).toBe(true)
            expect(isRow({ note: "n", hits: 1, open: false, seen_at: AT })).toBe(true)
            expect(subject.rowShape({ note: "string" })({ note: null })).toBe(false)
            expect(subject.rowShape({ payload: "json" })({ payload: null })).toBe(true)
        })

        it.each([
            ["a column the statement did not return", { hits: 1 }],
            ["a value of another kind", { id: 7, hits: 1 }],
            ["a number returned as text", { id: "row-1", hits: "1" }],
            ["a value that is not a row", "row-1"],
            ["null", null],
        ])("refuses %s", (_case, value) => {
            expect(subject.rowShape({ id: "string", hits: "number" })(value)).toBe(false)
        })

        it("refuses a json column the statement did not return", () => {
            expect(subject.rowShape({ payload: "json" })({})).toBe(false)
        })
    })

    describe("returnedRows", () => {
        it("answers every row, typed by its guard, in the order the statement returned them", () => {
            const rows = subject.returnedRows([{ id: "a" }, { id: "b" }], subject.rowShape({ id: "string" }))

            expect(rows.map((row) => row.id)).toEqual(["a", "b"])
        })

        it("answers no rows for a statement that returned none", () => {
            expect(subject.returnedRows([], subject.rowShape({ id: "string" }))).toEqual([])
        })

        it("refuses a row of another shape instead of reading it", () => {
            expect(() => subject.returnedRows([{ id: "a" }, { id: 2 }], subject.rowShape({ id: "string" }))).toThrow(
                expect.objectContaining({ code: DatabaseErrorCode.ReturningRowRejected }),
            )
        })

        it("refuses a result that is not a list of rows, such as the [rows, count] of a bare UPDATE", () => {
            const isRow = subject.rowShape({ id: "string" })

            expect(() => subject.returnedRows({ id: "a" }, isRow)).toThrow(
                expect.objectContaining({ code: DatabaseErrorCode.ReturningRowRejected }),
            )
            expect(() => subject.returnedRows([[{ id: "a" }], 1], isRow)).toThrow(
                expect.objectContaining({ code: DatabaseErrorCode.ReturningRowRejected }),
            )
        })
    })
})
