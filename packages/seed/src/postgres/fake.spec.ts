import { byteOrder } from "../manifest.ts"
import type { PostgresRunner } from "./store.ts"

/* ---------------------------------------------------------------------------------------------------------------
 * An in-memory PostgreSQL for the store's specs: a catalog and tables that answer the exact statements the store
 * sends, told apart by their seed marker. It mimics what the SQL means (byte order of the key, keyset after a key,
 * json_to_record upsert, sequences, rollback), not the SQL text.
 * ------------------------------------------------------------------------------------------------------------- */

export type Row = Record<string, string | null>

export interface FakeTable {
    schema: string
    name: string
    columns: { name: string; type: string; generated?: boolean }[]
    pk: string[] | null
    /** A partition of a partitioned table: the catalog query leaves it out. */
    partition?: boolean
    rows: Row[]
    sequences?: { sequence: string; column: string }[]
}

export interface FakeDb {
    tables: FakeTable[]
    /** Sequence name -> the value the store set it to. */
    sequenceValues: Record<string, number>
    /** Every statement the store sent: marker and the isolation of the transaction it ran in. */
    log: { marker: string; isolation: string | null; params: readonly unknown[] }[]
    /** Answers an error for a statement to throw, or undefined. */
    fail?: (marker: string, table: string) => unknown
    /** Awaited before a statement answers. */
    before?: (marker: string, call: number) => Promise<void>
    /** The page query answers its rows in reverse, as another collation would. */
    reversePages?: boolean
}

export const keyOf = (table: FakeTable, row: Row): string => {
    const pk = table.pk ?? []
    return pk.length === 1 ? (row[pk[0] ?? ""] ?? "") : JSON.stringify(pk.map((name) => row[name]))
}

const tableIn = (db: FakeDb, sql: string): FakeTable => {
    const match = /"([^"]+)"\."([^"]+)"/u.exec(sql)
    const found = db.tables.find((table) => table.schema === match?.[1] && table.name === match[2])
    if (found === undefined) throw new Error("the fake has no such table")
    return found
}

const heldColumns = (table: FakeTable): { name: string; type: string }[] => table.columns.filter((column) => column.generated !== true).map(({ name, type }) => ({ name, type }))

const sameKey = (table: FakeTable, row: Row, params: readonly unknown[]): boolean => (table.pk ?? []).every((name, at) => row[name] === params[at])

export function fakeRunner(db: FakeDb): PostgresRunner {
    const calls = new Map<string, number>()
    let isolation: string | null = null

    const run = async (sql: string, params: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> => {
        const marker = /^\/\* seed:(\w+) \*\//u.exec(sql)?.[1] ?? "unknown"
        db.log.push({ marker, isolation, params })
        const call = (calls.get(marker) ?? 0) + 1
        calls.set(marker, call)
        await db.before?.(marker, call)
        const table = ["session", "replica", "catalog", "sequences"].includes(marker) ? null : tableIn(db, sql)
        const failure = db.fail?.(marker, table === null ? "" : `${table.schema}.${table.name}`)
        if (failure !== undefined) throw failure as Error
        switch (marker) {
            case "session":
            case "replica":
                return []
            case "catalog":
                return [...db.tables]
                    .reverse()
                    .filter((item) => item.partition !== true && (params[0] as string[]).includes(item.schema))
                    .map((item) => ({ schema: item.schema, table: item.name, columns: JSON.stringify(heldColumns(item)), pk: item.pk === null ? null : JSON.stringify(item.pk) }))
            case "page": {
                if (table === null) return []
                const limit = Number(/LIMIT (\d+)$/u.exec(sql)?.[1])
                const after = params[0] as string | undefined
                const sorted = table.rows
                    .map((row) => ({ k: keyOf(table, row), r: JSON.stringify(row) }))
                    .filter((item) => after === undefined || byteOrder(item.k, after) > 0)
                    .sort((left, right) => byteOrder(left.k, right.k))
                    .slice(0, limit)
                return db.reversePages === true ? sorted.reverse() : sorted
            }
            case "get":
                return table?.rows.filter((row) => sameKey(table, row, params)).map((row) => ({ r: JSON.stringify(row) })) ?? []
            case "exists":
                return table?.rows.filter((row) => sameKey(table, row, params)).map(() => ({ present: 1 })) ?? []
            case "delete":
                if (table !== null) table.rows = table.rows.filter((row) => !sameKey(table, row, params))
                return []
            case "keys":
                return table?.rows.map((row) => ({ k: keyOf(table, row), ...Object.fromEntries((table.pk ?? []).map((name, at) => [`p${String(at)}`, row[name]])) })) ?? []
            case "upsert": {
                if (table === null) return []
                const row = JSON.parse(params[0] as string) as Row
                const at = table.rows.findIndex((item) => sameKey(table, item, (table.pk ?? []).map((name) => row[name])))
                if (at < 0) table.rows.push(row)
                else table.rows[at] = row
                return []
            }
            case "sequences":
                return db.tables.find((item) => `"${item.schema}"."${item.name}"` === params[0])?.sequences ?? []
            case "setval": {
                const column = /max\(t\."([^"]+)"\)/u.exec(sql)?.[1] ?? ""
                const values = (table?.rows ?? []).map((row) => Number(row[column]))
                if (values.length === 0) return []
                db.sequenceValues[params[0] as string] = Math.max(...values)
                return [{ value: Math.max(...values) }]
            }
            default:
                throw new Error(`the fake does not know ${marker}`)
        }
    }

    const runner: PostgresRunner = {
        query: run,
        async transaction(level, work) {
            const saved = structuredClone({ tables: db.tables, sequenceValues: db.sequenceValues })
            isolation = level
            try {
                return await work(runner)
            } catch (cause) {
                db.tables = saved.tables
                db.sequenceValues = saved.sequenceValues
                throw cause
            } finally {
                isolation = null
            }
        },
    }
    return runner
}

/** A fresh database: three tables (one key, a composite key, a key-only table), a sequence on the first. */
export function shopDb(filled: boolean): FakeDb {
    const accounts: FakeTable = {
        schema: "public",
        name: "accounts",
        columns: [
            { name: "id", type: "integer" },
            { name: "name", type: "text" },
            { name: "balance", type: "numeric(12,2)" },
            { name: "total", type: "numeric", generated: true },
        ],
        pk: ["id"],
        rows: filled
            ? [
                  { id: "10", name: "ten", balance: "10.50" },
                  { id: "9", name: "nine", balance: null },
                  { id: "2", name: "two", balance: "0.00" },
              ]
            : [],
        sequences: [{ sequence: '"public"."accounts_id_seq"', column: "id" }],
    }
    const memberships: FakeTable = {
        schema: "public",
        name: "memberships",
        columns: [
            { name: "org", type: "text" },
            { name: "user", type: "text" },
            { name: "role", type: "text" },
        ],
        pk: ["org", "user"],
        rows: filled
            ? [
                  { org: "a", user: "b", role: "owner" },
                  { org: "a", user: "a", role: "member" },
              ]
            : [],
    }
    const tags: FakeTable = { schema: "public", name: "tags", columns: [{ name: "tag", type: "text" }], pk: ["tag"], rows: filled ? [{ tag: "x" }] : [] }
    return { tables: [accounts, memberships, tags], sequenceValues: {}, log: [] }
}
