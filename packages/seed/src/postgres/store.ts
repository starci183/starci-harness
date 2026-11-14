import { causeLabel } from "../copies.ts"
import { DataRefusal } from "../driver.ts"
import type { DataEntry, JsonValue, Selection } from "../manifest.ts"
import { byteOrder, canonicalJson, recordEntry, recordValue } from "../manifest.ts"
import type { ImportOptions, ImportReport, Inability, RefusedKey, SetImport, StoreAdapter, StoreDescription } from "../store.ts"
import { importOutcome } from "../store.ts"
import { Cancelled, streamed } from "./pipe.ts"
import type { Column, Table } from "./sql.ts"
import * as sql from "./sql.ts"

/*
 * THE DECISION (taken by HARNESS-DATA): this store copies the whole relational database as a per-table row export through
 * SQL that THIS package owns. It is neither of the two obvious alternatives, for these reasons:
 *   - an opaque pg_dump archive: the file changes bytes on every run and is one blob, so an unchanged database would still
 *     be a changed copy, and nothing could be skipped, sharded or compared per table;
 *   - the app's entity layer: it covers only the entities the app models and runs under the app role, which row level
 *     security and grants restrict, so the copy would silently miss data.
 * The SQL is built here from the catalog with quoted identifiers only (never in app code: the app hands a connection and
 * nothing else). The schema comes from the app's migrations; the copy holds DATA only.
 *
 * Ordering: entries must come in (set, key) UTF-8 byte order, and SQL order is not byte order (collation, "10" before "9").
 * The store orders each table IN SQL by the byte order of the key text (`ORDER BY convert_to(<key text>, 'UTF8')`) and pages
 * by keyset on the same expression, so memory stays flat (one page, plus one prefetched page) whatever the table's size;
 * the price is that a page cannot use the primary key index and is found by a top-N scan, so the cost is
 * rows x pages, which is fine at the size a git copy may hold (500 MiB of snapshot). Each page is sorted again in the store
 * by byte order, so a runner whose database orders differently still yields the contract order inside a page.
 *
 * Values: every held column is read as text (`col::text`) under fixed session settings (UTC, ISO dates, ISO 8601 intervals,
 * hex bytea, shortest floats), so a number never passes through a JS number and a timestamp never depends on a session
 * zone; json and jsonb travel as their exact text. Import casts the text back to the column's own type.
 */

/** Runs statements against one PostgreSQL connection or pool: the only thing the app hands this package. */
export interface PostgresRunner {
    /** Runs one statement with positional parameters and answers its rows as plain objects. */
    query(sql: string, params?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>
    /**
     * Runs `work` in ONE transaction (REPEATABLE READ for an export: one consistent snapshot; READ COMMITTED for an import)
     * and commits, or rolls back and rethrows the same error when `work` throws.
     */
    transaction<T>(isolation: "repeatable read" | "read committed", work: (tx: PostgresRunner) => Promise<T>): Promise<T>
}

/** A table the copy leaves out, with the reason shown in `describe().cannot`. */
export interface ExcludedTable {
    /** `<schema>.<table>`. */
    readonly table: string
    /** Why it is rebuildable or not worth keeping: a queue, a cache, vectors, a finished checkpoint, raw data past retention. */
    readonly reason: string
}

/** What `postgresStore` needs. */
export interface PostgresStoreOptions {
    /** The store id the stack declares, e.g. `database`. */
    readonly id: string
    /** The connection. An export needs only read access (a role that bypasses row level security to see every row); an import needs the owner role. */
    readonly run: PostgresRunner
    /** The schemas to copy; `["public"]` by default. */
    readonly schemas?: readonly string[]
    /** Rebuildable tables, each with its reason. */
    readonly exclude?: readonly ExcludedTable[]
    /** Rows per keyset page; 5000 by default. */
    readonly pageRows?: number
}

const SET_NAME = /^[A-Za-z0-9_$.-]+$/u

/** A dry run's result, thrown out of the transaction so it rolls back. */
class DryRun extends Error {
    readonly report: ImportReport
    constructor(report: ImportReport) {
        super("dry run")
        this.report = report
    }
}

const text = (value: unknown): string => value as string

interface Tally {
    created: number
    updated: number
    unchanged: number
    removed: number
    readonly refused: RefusedKey[]
    readonly seen: Set<string>
}

interface Catalog {
    readonly held: readonly Table[]
    readonly cannot: readonly Inability[]
}

/** The store that copies the whole relational database behind the `StoreAdapter` port (kind `database`, level `physical`). */
export function postgresStore(options: PostgresStoreOptions): StoreAdapter {
    const { id, run } = options
    const schemas = options.schemas ?? ["public"]
    const exclude = options.exclude ?? []
    const pageRows = options.pageRows ?? 5000
    if (!Number.isInteger(pageRows) || pageRows < 1) throw new TypeError("pageRows is a whole number of at least 1")

    const refuse = (cause: unknown, table?: string): Error => {
        if (cause instanceof DataRefusal || cause instanceof Cancelled) return cause
        const params = table === undefined ? { store: id, cause: causeLabel(cause) } : { store: id, table, cause: causeLabel(cause) }
        return new DataRefusal("DATA_STORE_FAILED", "configuration", params, cause)
    }

    async function loadCatalog(from: PostgresRunner): Promise<Catalog> {
        const excluded = new Set(exclude.map((item) => item.table))
        const cannot: Inability[] = exclude.map((item) => ({ what: `export and import of table ${item.table}`, reason: `excluded by the app: ${item.reason}` }))
        const held: Table[] = []
        const rows = [...(await from.query(sql.CATALOG, [schemas]))].map((row) => ({ schema: text(row.schema), table: text(row.table), row }))
        for (const { schema, table, row } of rows.sort((left, right) => byteOrder(`${left.schema}.${left.table}`, `${right.schema}.${right.table}`))) {
            const set = `${schema}.${table}`
            const skip = (reason: string): void => {
                cannot.push({ what: `export and import of table ${set}`, reason })
            }
            if (excluded.has(set)) continue
            if (!SET_NAME.test(set)) {
                skip("its name has characters a set name cannot hold (only letters, digits, _ $ . and -)")
                continue
            }
            if (row.pk === null) {
                skip("it has no primary key, so a row cannot keep its identity")
                continue
            }
            const columns = JSON.parse(text(row.columns)) as Column[]
            const names = JSON.parse(text(row.pk)) as string[]
            const pk = names.flatMap((name) => columns.filter((column) => column.name === name))
            if (pk.length !== names.length) {
                skip("its primary key holds a generated column")
                continue
            }
            held.push({ schema, table, set, columns, pk })
        }
        return { held, cannot: cannot.sort((left, right) => byteOrder(left.what, right.what)) }
    }

    /** The key's primary key column texts, or null when the key is not one of this table's. */
    function partsOf(table: Table, key: string): string[] | null {
        if (table.pk.length === 1) return [key]
        try {
            const parts = JSON.parse(key) as unknown
            return Array.isArray(parts) && parts.length === table.pk.length && parts.every((part) => typeof part === "string") ? parts : null
        } catch {
            return null
        }
    }

    /** The row object of an entry when it is a whole row of this table under this key, else null. */
    function rowOf(table: Table, entry: DataEntry): Record<string, string | null> | null {
        let value: JsonValue
        try {
            value = recordValue(entry)
        } catch {
            return null
        }
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null
        const row = value as Record<string, JsonValue>
        const names = Object.keys(row).sort(byteOrder)
        const wanted = table.columns.map((column) => column.name).sort(byteOrder)
        if (names.length !== wanted.length || names.some((name, at) => name !== wanted[at])) return null
        if (!Object.values(row).every((item) => item === null || typeof item === "string")) return null
        const parts = partsOf(table, entry.key)
        if (parts === null || table.pk.some((column, at) => row[column.name] !== parts[at])) return null
        return row as Record<string, string | null>
    }

    async function* exportEntries(selection: Selection): AsyncGenerator<DataEntry, void, undefined> {
        const batches = streamed<DataEntry[]>(async (send) => {
            let current: string | undefined
            try {
                await run.transaction("repeatable read", async (tx) => {
                    await tx.query(sql.SESSION)
                    for (const table of (await loadCatalog(tx)).held) {
                        if (selection.sets !== undefined && !selection.sets.includes(table.set)) continue
                        current = table.set
                        let after: string | null = null
                        for (;;) {
                            const rows = await tx.query(sql.page(table, pageRows, after !== null), after === null ? [] : [after])
                            const entries = rows.map((row) => recordEntry(table.set, text(row.k), JSON.parse(text(row.r)) as JsonValue)).sort((left, right) => byteOrder(left.key, right.key))
                            if (entries.length > 0) await send(entries)
                            if (rows.length < pageRows) break
                            after = entries.reduce((_, entry) => entry.key, "")
                        }
                    }
                })
            } catch (cause) {
                throw refuse(cause, current)
            }
        })
        for await (const batch of batches) yield* batch
    }

    async function importEntries(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
        const tallies = new Map<string, Tally>()
        let current: string | undefined
        try {
            return await run.transaction("read committed", async (tx) => {
                await tx.query(sql.SESSION)
                await tx.query(sql.REPLICA)
                const byName = new Map((await loadCatalog(tx)).held.map((table) => [table.set, table]))
                for await (const entry of entries) {
                    const tally = tallies.get(entry.set) ?? { created: 0, updated: 0, unchanged: 0, removed: 0, refused: [], seen: new Set<string>() }
                    tallies.set(entry.set, tally)
                    tally.seen.add(entry.key)
                    const table = byName.get(entry.set)
                    if (table === undefined) {
                        tally.refused.push({ key: entry.key, code: "DATA_TABLE_NOT_HELD" })
                        continue
                    }
                    current = table.set
                    const row = rowOf(table, entry)
                    if (row === null) {
                        tally.refused.push({ key: entry.key, code: "DATA_ROW_INVALID" })
                        continue
                    }
                    const [stored] = await tx.query(sql.get(table), table.pk.map((column) => row[column.name]))
                    if (stored === undefined) tally.created += 1
                    else if (canonicalJson(JSON.parse(text(stored.r))) === canonicalJson(row)) {
                        tally.unchanged += 1
                        continue
                    } else tally.updated += 1
                    await tx.query(sql.upsert(table), [JSON.stringify(row)])
                }
                const held = [...tallies].flatMap(([set, tally]) => {
                    const table = byName.get(set)
                    return table === undefined ? [] : [{ table, tally }]
                })
                for (const { table, tally } of held) {
                    current = table.set
                    if (options.mode === "mirror") {
                        for (const row of await tx.query(sql.keys(table))) {
                            if (tally.seen.has(text(row.k))) continue
                            await tx.query(sql.remove(table), table.pk.map((_, at) => row[`p${String(at)}`]))
                            tally.removed += 1
                        }
                    }
                    // setval is not transactional: a dry run must not move a sequence.
                    if (options.dryRun) continue
                    for (const owned of await tx.query(sql.SEQUENCES, [sql.qualified(table)])) await tx.query(sql.setval(table, text(owned.column)), [text(owned.sequence)])
                }
                const sets: SetImport[] = [...tallies]
                    .map(([set, tally]) => ({ set, created: tally.created, updated: tally.updated, unchanged: tally.unchanged, removed: tally.removed, refused: [...tally.refused].sort((left, right) => byteOrder(left.key, right.key)) }))
                    .sort((left, right) => byteOrder(left.set, right.set))
                const report: ImportReport = { sets, outcome: importOutcome(sets) }
                // A dry run did every write above, counted it, and now rolls the transaction back.
                if (options.dryRun) throw new DryRun(report)
                return report
            })
        } catch (cause) {
            if (cause instanceof DryRun) return cause.report
            throw refuse(cause, current)
        }
    }

    return {
        id,
        kind: "database",
        level: "physical",

        async describe(): Promise<StoreDescription> {
            try {
                const catalog = await loadCatalog(run)
                return {
                    sets: catalog.held.map((table) => ({ set: table.set, schema: `postgres/${table.set}@1`, form: "record" as const })),
                    purposes: ["seed-backup"],
                    canExport: true,
                    canImport: true,
                    cannot: catalog.cannot,
                }
            } catch (cause) {
                throw refuse(cause)
            }
        },

        export: (selection: Selection): AsyncIterable<DataEntry> => exportEntries(selection),

        import: importEntries,

        async identityOf(set: string, key: string): Promise<string | null> {
            try {
                const table = (await loadCatalog(run)).held.find((item) => item.set === set)
                const parts = table === undefined ? null : partsOf(table, key)
                if (table === undefined || parts === null) return null
                return (await run.query(sql.exists(table), parts)).length > 0 ? key : null
            } catch (cause) {
                throw refuse(cause, set)
            }
        },
    }
}
