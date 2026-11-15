/**
 * What the outbox needs of a connection: one statement with positional parameters. A TypeORM `EntityManager` or `DataSource`, a
 * node-postgres `Pool`, `PoolClient` or `Client` all have this shape, so a caller hands its own transaction as it is.
 */
export interface Queryable {
    query(sql: string, params?: unknown[]): Promise<unknown>
}

/**
 * The database the outbox runs its own work on: statements, and transactions it opens itself (the claim, the handler with the mark of
 * its job). A TypeORM `DataSource` or `EntityManager` has this shape; a node-postgres pool takes `pgDatabase(pool)`.
 */
export interface OutboxDatabase extends Queryable {
    transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>
}

/** One row as the driver answers it. */
export type Row = Readonly<Record<string, unknown>>

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The rows of a driver's answer, whichever driver gave it: node-postgres answers `{ rows }`, TypeORM answers the rows themselves, or, for an
 * UPDATE or DELETE, the pair `[rows, affected]`.
 */
export const rowsOf = (answer: unknown): readonly Row[] => {
    if (Array.isArray(answer)) {
        const [first, second] = answer as unknown[]
        if (answer.length === 2 && Array.isArray(first) && typeof second === "number") return first.filter(isRow)
        return answer.filter(isRow)
    }
    if (isRow(answer) && Array.isArray(answer.rows)) return (answer.rows as unknown[]).filter(isRow)
    return []
}

/** Runs one statement and answers its rows. */
export const run = async (on: Queryable, sql: string, params: unknown[] = []): Promise<readonly Row[]> => rowsOf(await on.query(sql, params))

/** What `pgDatabase` needs of a node-postgres pool. */
export interface PgPoolLike extends Queryable {
    connect(): Promise<PgClientLike>
}

/** What `pgDatabase` needs of a pooled node-postgres client. */
export interface PgClientLike extends Queryable {
    release(destroy?: boolean | Error): void
}

/**
 * The outbox database over a node-postgres pool: a transaction is BEGIN, the work and COMMIT on one client, ROLLBACK and the same error
 * when the work throws; a client whose rollback failed is destroyed, never returned to the pool.
 */
export const pgDatabase = (pool: PgPoolLike): OutboxDatabase => ({
    query: (sql, params) => pool.query(sql, params),
    transaction: async <T>(work: (tx: Queryable) => Promise<T>): Promise<T> => {
        const client = await pool.connect()
        try {
            await client.query("BEGIN")
            const result = await work(client)
            await client.query("COMMIT")
            client.release()
            return result
        } catch (failure) {
            try {
                await client.query("ROLLBACK")
                client.release()
            } catch (rollback) {
                client.release(rollback instanceof Error ? rollback : true)
            }
            throw failure
        }
    },
})
