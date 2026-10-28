import { createHash, randomBytes } from "node:crypto"
import type { MaybePromise, RouterCatalog } from "../types.ts"

/** The limits of one virtual key; an absent field is no limit. Days and months are UTC. */
export interface KeyQuota {
    readonly requestsPerMinute?: number
    /** Prompt plus completion tokens the provider reported. */
    readonly tokensPerDay?: number
    /** Estimated cost, from usage and the model's configured cost; a model without a cost counts 0. */
    readonly costPerDay?: number
    readonly costPerMonth?: number
}

/** A virtual key as every surface shows it: its bindings and state, never its secret or hash. */
export interface VirtualKey {
    /** The public id admin operations name it by (`key_<hex>`). */
    readonly id: string
    readonly label: string
    readonly owner: string | null
    /** The key's prefix and last four characters, enough to recognise it: `sk-starci-<label>-...abcd`. */
    readonly hint: string
    /** Profile names the key may call, or `*` for every profile. */
    readonly profiles: readonly string[]
    /** Model ids or aliases the key may call directly, or `*` for every model. */
    readonly models: readonly string[]
    /** False pins every call to the profile's or the named model; no fallback model is tried. */
    readonly allowFallback: boolean
    readonly quota: KeyQuota
    readonly enabled: boolean
    /** Epoch milliseconds. */
    readonly createdAt: number
    readonly rotatedAt: number | null
    readonly revokedAt: number | null
}

/** A virtual key as a store holds it: the public record plus the SHA-256 of its secret. */
export interface StoredKey extends VirtualKey {
    readonly hash: string
}

/** What a new key is bound to. */
export interface KeySpec {
    /** Lowercase letters, digits and underscores, 1 to 32 characters; it becomes part of the secret. */
    readonly label: string
    readonly owner?: string
    readonly profiles?: readonly string[]
    readonly models?: readonly string[]
    /** Default true. */
    readonly allowFallback?: boolean
    readonly quota?: KeyQuota
    /** Default true. */
    readonly enabled?: boolean
}

/** The bindings of a key an update may change; the label and the secret stay. */
export type KeyPatch = Omit<KeySpec, "label">

/** One settled request of a key: how it ended and what it consumed. No prompt, no end-user identifier. */
export interface UsageDelta {
    /** `success`, `error:<class>` for a pool failure, `rejected:<reason>` for a request the gateway refused. */
    readonly outcome: string
    readonly promptTokens: number
    readonly completionTokens: number
    readonly cost: number
    readonly latencyMs: number
}

/** A key's usage over one UTC day. */
export interface UsageRow {
    readonly keyId: string
    /** `YYYY-MM-DD`. */
    readonly day: string
    readonly requests: number
    readonly succeeded: number
    readonly failed: number
    readonly promptTokens: number
    readonly completionTokens: number
    readonly cost: number
    /** The sum of every request's latency; divide by `requests` for the mean. */
    readonly latencyMs: number
    readonly outcomes: Readonly<Record<string, number>>
}

/**
 * Where virtual keys and their usage live. The in-memory store is the default; `openSqliteKeyStore` is the durable
 * one, and an adapter over another database implements the same methods (the SQLite schema is its reference).
 */
export interface KeyStore {
    /** Inserts or replaces a key by id. */
    put(key: StoredKey): MaybePromise<void>
    get(id: string): MaybePromise<StoredKey | undefined>
    byHash(hash: string): MaybePromise<StoredKey | undefined>
    list(): MaybePromise<readonly StoredKey[]>
    /** Counts one request in the key's minute (epoch minutes) and returns the minute's count; a new minute starts at 1. Atomic. */
    hit(id: string, minute: number): MaybePromise<number>
    /** Adds one settled request to the key's day. Atomic. */
    record(id: string, day: string, delta: UsageDelta): MaybePromise<void>
    /** The key's days from `from` to `to`, both inclusive, oldest first. */
    usage(id: string, from: string, to: string): MaybePromise<readonly UsageRow[]>
    close?(): MaybePromise<void>
}

/** Adds a request to a day row; the stores share it so a row means the same everywhere. */
export function addToRow(row: UsageRow | undefined, keyId: string, day: string, delta: UsageDelta): UsageRow {
    const success = delta.outcome === "success"
    return {
        keyId,
        day,
        requests: (row?.requests ?? 0) + 1,
        succeeded: (row?.succeeded ?? 0) + (success ? 1 : 0),
        failed: (row?.failed ?? 0) + (success ? 0 : 1),
        promptTokens: (row?.promptTokens ?? 0) + delta.promptTokens,
        completionTokens: (row?.completionTokens ?? 0) + delta.completionTokens,
        cost: (row?.cost ?? 0) + delta.cost,
        latencyMs: (row?.latencyMs ?? 0) + delta.latencyMs,
        outcomes: { ...row?.outcomes, [delta.outcome]: (row?.outcomes[delta.outcome] ?? 0) + 1 },
    }
}

/** The default key store: one process's memory, lost on restart. */
export class MemoryKeyStore implements KeyStore {
    readonly #keys = new Map<string, StoredKey>()
    readonly #rate = new Map<string, { minute: number; count: number }>()
    readonly #usage = new Map<string, UsageRow>()

    /** Inserts or replaces a key. */
    put(key: StoredKey): void {
        this.#keys.set(key.id, key)
    }

    /** Reads a key by id. */
    get(id: string): StoredKey | undefined {
        return this.#keys.get(id)
    }

    /** Reads a key by the hash of its secret. */
    byHash(hash: string): StoredKey | undefined {
        for (const key of this.#keys.values()) if (key.hash === hash) return key
        return undefined
    }

    /** Lists every key. */
    list(): readonly StoredKey[] {
        return [...this.#keys.values()]
    }

    /** Counts a request in the key's minute. */
    hit(id: string, minute: number): number {
        const held = this.#rate.get(id)
        const count = held?.minute === minute ? held.count + 1 : 1
        this.#rate.set(id, { minute, count })
        return count
    }

    /** Adds a settled request to the key's day. */
    record(id: string, day: string, delta: UsageDelta): void {
        const name = `${id}/${day}`
        this.#usage.set(name, addToRow(this.#usage.get(name), id, day, delta))
    }

    /** The key's day rows in a range. */
    usage(id: string, from: string, to: string): readonly UsageRow[] {
        return [...this.#usage.values()].filter((row) => row.keyId === id && row.day >= from && row.day <= to).sort((a, b) => a.day.localeCompare(b.day))
    }
}

/** Why an admin operation was refused: an unknown id, an invalid spec, or a change to a revoked key. */
export class KeyAdminError extends Error {
    readonly code: "not_found" | "invalid" | "revoked"

    /** Builds the error. */
    constructor(code: KeyAdminError["code"], message: string) {
        super(message)
        this.name = "KeyAdminError"
        this.code = code
    }
}

/** A newly issued or rotated key: the record, and the secret shown this once. */
export interface IssuedKey {
    readonly key: VirtualKey
    readonly secret: string
}

/** A key's usage over a range of days, with the totals of the range. */
export interface KeyUsage {
    readonly key: VirtualKey
    readonly from: string
    readonly to: string
    readonly rows: readonly UsageRow[]
    readonly totals: Omit<UsageRow, "keyId" | "day">
}

const LABEL = /^[a-z0-9_]{1,32}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The SHA-256 hex of a secret: what a store keeps instead of it. Keys are 192 random bits, so a fast hash is enough. */
export function hashSecret(secret: string): string {
    return createHash("sha256").update(secret, "utf8").digest("hex")
}

/** The UTC day of an epoch time, `YYYY-MM-DD`. */
export function dayOf(time: number): string {
    return new Date(time).toISOString().slice(0, 10)
}

/** The public view of a stored key. */
export function publicKey(key: StoredKey): VirtualKey {
    return {
        id: key.id,
        label: key.label,
        owner: key.owner,
        hint: key.hint,
        profiles: key.profiles,
        models: key.models,
        allowFallback: key.allowFallback,
        quota: key.quota,
        enabled: key.enabled,
        createdAt: key.createdAt,
        rotatedAt: key.rotatedAt,
        revokedAt: key.revokedAt,
    }
}

function invalid(message: string): KeyAdminError {
    return new KeyAdminError("invalid", message)
}

function names(value: readonly string[] | undefined, field: string, known: ReadonlySet<string> | null): readonly string[] {
    // A spec arrives as JSON from the admin API, so its types are checked, not trusted.
    const raw: unknown = value ?? []
    if (!Array.isArray(raw)) throw invalid(`${field} must be a list of names`)
    const list = raw.filter((name): name is string => typeof name === "string" && name !== "")
    if (list.length !== raw.length) throw invalid(`${field} must be a list of names`)
    for (const name of list) {
        if (name !== "*" && known !== null && !known.has(name)) throw invalid(`${field} names "${name}", which the pool does not serve`)
    }
    return [...new Set(list)]
}

function quotaOf(value: KeyQuota | undefined): KeyQuota {
    const quota = value ?? {}
    const out: Record<string, number> = {}
    for (const [field, integer] of [
        ["requestsPerMinute", true],
        ["tokensPerDay", true],
        ["costPerDay", false],
        ["costPerMonth", false],
    ] as const) {
        const limit = quota[field]
        if (limit === undefined) continue
        if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || (integer && !Number.isInteger(limit))) {
            throw invalid(`quota.${field} must be a positive ${integer ? "integer" : "number"}`)
        }
        out[field] = limit
    }
    const unknown = Object.keys(quota).filter((field) => !(field in out) && quota[field as keyof KeyQuota] !== undefined)
    if (unknown.length > 0) throw invalid(`quota has unknown fields: ${unknown.join(", ")}`)
    return out
}

function bool(value: boolean | undefined, field: string, fallback: boolean): boolean {
    if (value === undefined) return fallback
    if (typeof value !== "boolean") throw invalid(`${field} must be true or false`)
    return value
}

/** Issues, lists, revokes, rotates and updates virtual keys over a store, and reports their usage. */
export class KeyAdmin {
    readonly store: KeyStore
    readonly #clock: () => number
    readonly #profiles: ReadonlySet<string> | null
    readonly #models: ReadonlySet<string> | null

    /** Binds the admin to a store; with a catalog, a key may only name the pool's profiles and models. */
    constructor(store: KeyStore, options: { readonly catalog?: RouterCatalog; readonly clock?: () => number } = {}) {
        this.store = store
        this.#clock = options.clock ?? Date.now
        const catalog = options.catalog
        this.#profiles = catalog === undefined ? null : new Set(catalog.profiles.map((profile) => profile.name))
        this.#models = catalog === undefined ? null : new Set(catalog.models.flatMap((model) => [model.id, ...model.aliases]))
    }

    #issue(label: string): { secret: string; hash: string; hint: string } {
        const secret = `sk-starci-${label}-${randomBytes(24).toString("hex")}`
        return { secret, hash: hashSecret(secret), hint: `sk-starci-${label}-...${secret.slice(-4)}` }
    }

    #bindings(spec: KeyPatch, base: VirtualKey | null): Pick<VirtualKey, "owner" | "profiles" | "models" | "allowFallback" | "quota" | "enabled"> {
        const owner = spec.owner ?? base?.owner ?? null
        if (owner !== null && (typeof owner !== "string" || owner.length > 200)) throw invalid("owner must be a string of at most 200 characters")
        const profiles = spec.profiles === undefined && base !== null ? base.profiles : names(spec.profiles, "profiles", this.#profiles)
        const models = spec.models === undefined && base !== null ? base.models : names(spec.models, "models", this.#models)
        if (profiles.length === 0 && models.length === 0) throw invalid("a key needs at least one profile or model it may call")
        return {
            owner,
            profiles,
            models,
            allowFallback: bool(spec.allowFallback, "allowFallback", base?.allowFallback ?? true),
            quota: spec.quota === undefined && base !== null ? base.quota : quotaOf(spec.quota),
            enabled: bool(spec.enabled, "enabled", base?.enabled ?? true),
        }
    }

    async #find(id: string): Promise<StoredKey> {
        const key = await this.store.get(id)
        if (key === undefined) throw new KeyAdminError("not_found", `no key has id "${id}"`)
        return key
    }

    /** Issues a key; the secret is returned now and never again. */
    async create(spec: KeySpec): Promise<IssuedKey> {
        if (typeof spec.label !== "string" || !LABEL.test(spec.label)) throw invalid("label must be 1 to 32 lowercase letters, digits or underscores")
        const issued = this.#issue(spec.label)
        const key: StoredKey = {
            id: `key_${randomBytes(8).toString("hex")}`,
            label: spec.label,
            hint: issued.hint,
            ...this.#bindings(spec, null),
            createdAt: this.#clock(),
            rotatedAt: null,
            revokedAt: null,
            hash: issued.hash,
        }
        await this.store.put(key)
        return { key: publicKey(key), secret: issued.secret }
    }

    /** Lists every key, oldest first. */
    async list(): Promise<VirtualKey[]> {
        const keys = await this.store.list()
        return [...keys].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(publicKey)
    }

    /** Reads one key. */
    async get(id: string): Promise<VirtualKey> {
        return publicKey(await this.#find(id))
    }

    /** Revokes a key for good: its secret answers 401 from now on. Revoking twice is a no-op. */
    async revoke(id: string): Promise<VirtualKey> {
        const key = await this.#find(id)
        if (key.revokedAt !== null) return publicKey(key)
        const revoked: StoredKey = { ...key, enabled: false, revokedAt: this.#clock() }
        await this.store.put(revoked)
        return publicKey(revoked)
    }

    /** Replaces a key's secret, keeping its id, bindings and usage; the old secret answers 401 from now on. */
    async rotate(id: string): Promise<IssuedKey> {
        const key = await this.#find(id)
        if (key.revokedAt !== null) throw new KeyAdminError("revoked", `key "${id}" is revoked`)
        const issued = this.#issue(key.label)
        const rotated: StoredKey = { ...key, hash: issued.hash, hint: issued.hint, rotatedAt: this.#clock() }
        await this.store.put(rotated)
        return { key: publicKey(rotated), secret: issued.secret }
    }

    /** Changes a key's bindings; a field left out keeps its value. */
    async update(id: string, patch: KeyPatch): Promise<VirtualKey> {
        const key = await this.#find(id)
        if (key.revokedAt !== null) throw new KeyAdminError("revoked", `key "${id}" is revoked`)
        const updated: StoredKey = { ...key, ...this.#bindings(patch, key) }
        await this.store.put(updated)
        return publicKey(updated)
    }

    /** A key's usage per UTC day from `from` to `to` (default: the current month), with the totals. */
    async usage(id: string, range: { readonly from?: string; readonly to?: string } = {}): Promise<KeyUsage> {
        const key = await this.#find(id)
        const today = dayOf(this.#clock())
        const from = range.from ?? `${today.slice(0, 8)}01`
        const to = range.to ?? today
        if (!DAY.test(from) || !DAY.test(to)) throw invalid("from and to must be days, YYYY-MM-DD")
        const rows = await this.store.usage(id, from, to)
        const outcomes: Record<string, number> = {}
        const totals = { requests: 0, succeeded: 0, failed: 0, promptTokens: 0, completionTokens: 0, cost: 0, latencyMs: 0 }
        for (const row of rows) {
            totals.requests += row.requests
            totals.succeeded += row.succeeded
            totals.failed += row.failed
            totals.promptTokens += row.promptTokens
            totals.completionTokens += row.completionTokens
            totals.cost += row.cost
            totals.latencyMs += row.latencyMs
            for (const [outcome, count] of Object.entries(row.outcomes)) outcomes[outcome] = (outcomes[outcome] ?? 0) + count
        }
        return { key: publicKey(key), from, to, rows, totals: { ...totals, outcomes } }
    }

    /** The stored key a secret names, or undefined; the caller decides what a revoked or disabled key means. */
    async authenticate(secret: string): Promise<StoredKey | undefined> {
        if (!secret.startsWith("sk-starci-")) return undefined
        return this.store.byHash(hashSecret(secret))
    }
}
