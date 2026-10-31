import type { DatabaseSync } from "node:sqlite"
import { parseHealthRecord } from "./store.ts"
import type { HealthRecord, StateStore } from "./store.ts"

/** The schema of the durable state store: one JSON record per key, and the half-open probe leases. */
export const STATE_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_router_state (
    key        TEXT PRIMARY KEY,
    record     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_router_leases (
    key   TEXT PRIMARY KEY,
    until INTEGER NOT NULL
);
`

/** The SQLite state store: a `StateStore` whose methods answer at once, and that can be closed. */
export interface ClosableStateStore extends StateStore {
    get(key: string): HealthRecord | undefined
    set(key: string, record: HealthRecord): void
    delete(key: string): void
    keys(prefix: string): readonly string[]
    lease(key: string, ttlMs: number): boolean
    release(key: string): void
    close(): void
}

/** The pool's state over one SQLite file: breakers, blacklists, headroom and budgets survive a restart; processes on one host may share the file. */
class SqliteStateStore implements ClosableStateStore {
    readonly #db: DatabaseSync

    constructor(db: DatabaseSync) {
        this.#db = db
    }

    get(key: string): HealthRecord | undefined {
        const row = this.#db.prepare("SELECT record FROM ai_router_state WHERE key = ?").get(key)
        const text = row?.record
        return typeof text === "string" ? parseHealthRecord(text) : undefined
    }

    set(key: string, record: HealthRecord): void {
        this.#db
            .prepare("INSERT INTO ai_router_state (key, record, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at")
            .run(key, JSON.stringify(record), Date.now())
    }

    delete(key: string): void {
        this.#db.prepare("DELETE FROM ai_router_state WHERE key = ?").run(key)
    }

    keys(prefix: string): readonly string[] {
        // A range scan, not LIKE: a prefix may hold `%` or `_`.
        return this.#db
            .prepare("SELECT key FROM ai_router_state WHERE key >= ? AND key < ? ORDER BY key")
            .all(prefix, `${prefix}\u{10FFFF}`)
            .map((row) => row.key)
            .filter((key): key is string => typeof key === "string")
    }

    lease(key: string, ttlMs: number): boolean {
        const now = Date.now()
        // One statement: it inserts a free lease or takes over an expired one, and returns a row only when it did.
        const row = this.#db
            .prepare("INSERT INTO ai_router_leases (key, until) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET until = excluded.until WHERE ai_router_leases.until <= ? RETURNING key")
            .get(key, now + ttlMs, now)
        return row !== undefined
    }

    release(key: string): void {
        this.#db.prepare("DELETE FROM ai_router_leases WHERE key = ?").run(key)
    }

    close(): void {
        this.#db.close()
    }
}

/**
 * Opens (and creates) the durable state store at a SQLite file path (`node:sqlite`, Node 22.13 or newer); `:memory:`
 * gives a throwaway one. It may share the key store's file: the tables differ.
 */
export async function openSqliteStateStore(path: string): Promise<ClosableStateStore> {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(path)
    db.exec("PRAGMA busy_timeout = 5000")
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL")
    db.exec(STATE_STORE_SCHEMA)
    return new SqliteStateStore(db)
}

/**
 * The few Redis commands the state store needs, so any client fits in a few lines (node-redis:
 * `{ get: (k) => c.get(k), set: (k, v) => c.set(k, v), setIfAbsent: async (k, v, ms) => (await c.set(k, v, { NX: true, PX: ms })) === "OK", del: (k) => c.del(k), keys: (p) => c.keys(p) }`).
 */
export interface RedisLike {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<unknown>
    /** `SET key value NX PX ttlMs`: true when it was set. */
    setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>
    del(key: string): Promise<unknown>
    /** `KEYS pattern` (or a SCAN loop): the keys matching a glob. */
    keys(pattern: string): Promise<readonly string[]>
}

/** Escapes a Redis glob's special characters so a prefix matches literally. */
function globPrefix(prefix: string): string {
    return `${prefix.replace(/[*?[\]\\]/g, (char) => `\\${char}`)}*`
}

/**
 * A `StateStore` over Redis: one JSON string per record and `SET NX PX` leases, so every gateway process of an app sees
 * the same breakers and blacklists. `prefix` (default `state:`) separates it from the lease keys.
 */
export function redisStateStore(client: RedisLike, options: { readonly prefix?: string } = {}): StateStore {
    const records = options.prefix ?? "state:"
    const leases = "lease:"
    return {
        async get(key) {
            return parseHealthRecord(await client.get(`${records}${key}`))
        },
        async set(key, record) {
            await client.set(`${records}${key}`, JSON.stringify(record))
        },
        async delete(key) {
            await client.del(`${records}${key}`)
        },
        async keys(prefix) {
            const found = await client.keys(globPrefix(`${records}${prefix}`))
            return found.map((key) => key.slice(records.length)).sort()
        },
        lease(key, ttlMs) {
            return client.setIfAbsent(`${leases}${key}`, "1", ttlMs)
        },
        async release(key) {
            await client.del(`${leases}${key}`)
        },
    }
}
