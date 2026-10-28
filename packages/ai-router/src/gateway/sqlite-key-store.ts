import type { DatabaseSync, SQLOutputValue } from "node:sqlite"
import { addToRow } from "./keys.ts"
import type { KeyQuota, KeyStore, StoredKey, UsageDelta, UsageRow } from "./keys.ts"

/**
 * The schema of the durable key store. It is plain SQL (SQLite here; the same tables carry over to Postgres with
 * `BIGINT` times, `DOUBLE PRECISION` cost and `JSONB` lists), so an adapter for another database starts from it.
 */
export const KEY_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_router_keys (
    id             TEXT PRIMARY KEY,
    hash           TEXT NOT NULL UNIQUE,
    label          TEXT NOT NULL,
    owner          TEXT,
    hint           TEXT NOT NULL,
    profiles       TEXT NOT NULL,
    models         TEXT NOT NULL,
    allow_fallback INTEGER NOT NULL,
    quota          TEXT NOT NULL,
    enabled        INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    rotated_at     INTEGER,
    revoked_at     INTEGER
);
CREATE TABLE IF NOT EXISTS ai_router_key_rate (
    key_id TEXT PRIMARY KEY,
    minute INTEGER NOT NULL,
    count  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_router_key_usage (
    key_id            TEXT NOT NULL,
    day               TEXT NOT NULL,
    requests          INTEGER NOT NULL,
    succeeded         INTEGER NOT NULL,
    failed            INTEGER NOT NULL,
    prompt_tokens     INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost              REAL NOT NULL,
    latency_ms        INTEGER NOT NULL,
    outcomes          TEXT NOT NULL,
    PRIMARY KEY (key_id, day)
);
`

type Row = Record<string, SQLOutputValue>

function text(row: Row, column: string): string {
    const value = row[column]
    if (typeof value !== "string") throw new Error(`column ${column} is not text`)
    return value
}

function number(row: Row, column: string): number {
    const value = row[column]
    if (typeof value === "bigint") return Number(value)
    if (typeof value !== "number") throw new Error(`column ${column} is not a number`)
    return value
}

function optionalNumber(row: Row, column: string): number | null {
    return row[column] === null ? null : number(row, column)
}

function parsed(row: Row, column: string): unknown {
    return JSON.parse(text(row, column))
}

function toKey(row: Row): StoredKey {
    return {
        id: text(row, "id"),
        hash: text(row, "hash"),
        label: text(row, "label"),
        owner: row.owner === null ? null : text(row, "owner"),
        hint: text(row, "hint"),
        profiles: parsed(row, "profiles") as string[],
        models: parsed(row, "models") as string[],
        allowFallback: number(row, "allow_fallback") === 1,
        quota: parsed(row, "quota") as KeyQuota,
        enabled: number(row, "enabled") === 1,
        createdAt: number(row, "created_at"),
        rotatedAt: optionalNumber(row, "rotated_at"),
        revokedAt: optionalNumber(row, "revoked_at"),
    }
}

function toUsage(row: Row): UsageRow {
    return {
        keyId: text(row, "key_id"),
        day: text(row, "day"),
        requests: number(row, "requests"),
        succeeded: number(row, "succeeded"),
        failed: number(row, "failed"),
        promptTokens: number(row, "prompt_tokens"),
        completionTokens: number(row, "completion_tokens"),
        cost: number(row, "cost"),
        latencyMs: number(row, "latency_ms"),
        outcomes: parsed(row, "outcomes") as Record<string, number>,
    }
}

/** The durable key store over one SQLite file (`node:sqlite`, Node 22.13 or newer); several processes may share the file. */
class SqliteKeyStore implements KeyStore {
    readonly #db: DatabaseSync

    constructor(db: DatabaseSync) {
        this.#db = db
    }

    #transaction<T>(work: () => T): T {
        this.#db.exec("BEGIN IMMEDIATE")
        try {
            const out = work()
            this.#db.exec("COMMIT")
            return out
        } catch (error) {
            this.#db.exec("ROLLBACK")
            throw error
        }
    }

    put(key: StoredKey): void {
        this.#db
            .prepare(
                `INSERT INTO ai_router_keys (id, hash, label, owner, hint, profiles, models, allow_fallback, quota, enabled, created_at, rotated_at, revoked_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET hash = excluded.hash, owner = excluded.owner, hint = excluded.hint, profiles = excluded.profiles,
                 models = excluded.models, allow_fallback = excluded.allow_fallback, quota = excluded.quota, enabled = excluded.enabled,
                 rotated_at = excluded.rotated_at, revoked_at = excluded.revoked_at`,
            )
            .run(
                key.id,
                key.hash,
                key.label,
                key.owner,
                key.hint,
                JSON.stringify(key.profiles),
                JSON.stringify(key.models),
                key.allowFallback ? 1 : 0,
                JSON.stringify(key.quota),
                key.enabled ? 1 : 0,
                key.createdAt,
                key.rotatedAt,
                key.revokedAt,
            )
    }

    get(id: string): StoredKey | undefined {
        const row = this.#db.prepare("SELECT * FROM ai_router_keys WHERE id = ?").get(id)
        return row === undefined ? undefined : toKey(row)
    }

    byHash(hash: string): StoredKey | undefined {
        const row = this.#db.prepare("SELECT * FROM ai_router_keys WHERE hash = ?").get(hash)
        return row === undefined ? undefined : toKey(row)
    }

    list(): readonly StoredKey[] {
        return this.#db.prepare("SELECT * FROM ai_router_keys ORDER BY created_at, id").all().map(toKey)
    }

    hit(id: string, minute: number): number {
        const row = this.#db
            .prepare(
                `INSERT INTO ai_router_key_rate (key_id, minute, count) VALUES (?, ?, 1)
                 ON CONFLICT (key_id) DO UPDATE SET count = CASE WHEN minute = excluded.minute THEN count + 1 ELSE 1 END, minute = excluded.minute
                 RETURNING count`,
            )
            .get(id, minute)
        return row === undefined ? 1 : number(row, "count")
    }

    record(id: string, day: string, delta: UsageDelta): void {
        this.#transaction(() => {
            const held = this.#db.prepare("SELECT * FROM ai_router_key_usage WHERE key_id = ? AND day = ?").get(id, day)
            const row = addToRow(held === undefined ? undefined : toUsage(held), id, day, delta)
            this.#db
                .prepare(
                    `INSERT INTO ai_router_key_usage (key_id, day, requests, succeeded, failed, prompt_tokens, completion_tokens, cost, latency_ms, outcomes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (key_id, day) DO UPDATE SET requests = excluded.requests, succeeded = excluded.succeeded, failed = excluded.failed,
                     prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens, cost = excluded.cost,
                     latency_ms = excluded.latency_ms, outcomes = excluded.outcomes`,
                )
                .run(id, day, row.requests, row.succeeded, row.failed, row.promptTokens, row.completionTokens, row.cost, row.latencyMs, JSON.stringify(row.outcomes))
        })
    }

    usage(id: string, from: string, to: string): readonly UsageRow[] {
        return this.#db.prepare("SELECT * FROM ai_router_key_usage WHERE key_id = ? AND day >= ? AND day <= ? ORDER BY day").all(id, from, to).map(toUsage)
    }

    close(): void {
        this.#db.close()
    }
}

/** Opens (and creates) the durable key store at a SQLite file path; `:memory:` gives a throwaway database. */
export async function openSqliteKeyStore(path: string): Promise<KeyStore> {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(path)
    db.exec("PRAGMA busy_timeout = 5000")
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL")
    db.exec(KEY_STORE_SCHEMA)
    return new SqliteKeyStore(db)
}
