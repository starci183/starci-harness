import type { DisabledReason, MaybePromise } from "./types.ts"

/**
 * The shared health of one key, one provider or one key and model ("lane"). Every field is a JSON number, string or
 * null, so an adapter can store it anywhere. Times are epoch milliseconds; 0 means "not set".
 */
export interface HealthRecord {
    /** `open` past `openUntil` is reported as half-open and admits one probe. */
    readonly breaker: "closed" | "open"
    /** Consecutive transient failures since the last success. */
    readonly failures: number
    readonly openUntil: number
    /** The cooldown the breaker last opened with; the next failed probe doubles it. */
    readonly cooldownMs: number
    /** A blacklisted key is no candidate until then; `Number.MAX_SAFE_INTEGER` means until its secret changes or `reset()`. */
    readonly disabledUntil: number
    readonly disabledReason: DisabledReason | null
    /** The provider's error code that blacklisted the key, for health and telemetry. */
    readonly disabledCode: string | null
    /**
     * A 64-bit fingerprint (SHA-256, truncated) of the secret the key held when it was blacklisted, `""` when it had
     * none: a different secret lifts the blacklist. Never the secret.
     */
    readonly fingerprint: string | null
    /** The lane's last reported remaining requests, or null when the provider never said. */
    readonly remainingRequests: number | null
    readonly requestsResetAt: number
    readonly remainingTokens: number | null
    readonly tokensResetAt: number
    /** A 429 keeps the lane out until then. */
    readonly cooldownUntil: number
    /** A provider's spend this UTC day (`YYYY-MM-DD`) and month (`YYYY-MM`), against its `budget`. */
    readonly spendDay: string
    readonly spendDayCost: number
    readonly spendMonth: string
    readonly spendMonthCost: number
}

/**
 * Where breaker, blacklist, headroom and budget state lives. The in-memory store is the default; `openSqliteStateStore`
 * and `redisStateStore` keep it across restarts and share it between processes. Methods may be synchronous or async.
 */
export interface StateStore {
    get(key: string): MaybePromise<HealthRecord | undefined>
    set(key: string, record: HealthRecord): MaybePromise<void>
    delete(key: string): MaybePromise<void>
    /** Every key that starts with the prefix; `reset()` uses it. */
    keys(prefix: string): MaybePromise<readonly string[]>
    /** Takes the lease if it is free or expired and returns true; returns false while another holder has it. Must be atomic. */
    lease(key: string, ttlMs: number): MaybePromise<boolean>
    release(key: string): MaybePromise<void>
}

/** A record with nothing known: a closed breaker, an enabled key, unknown headroom, nothing spent. */
export const EMPTY_RECORD: HealthRecord = Object.freeze({
    breaker: "closed",
    failures: 0,
    openUntil: 0,
    cooldownMs: 0,
    disabledUntil: 0,
    disabledReason: null,
    disabledCode: null,
    fingerprint: null,
    remainingRequests: null,
    requestsResetAt: 0,
    remainingTokens: null,
    tokensResetAt: 0,
    cooldownUntil: 0,
    spendDay: "",
    spendDayCost: 0,
    spendMonth: "",
    spendMonthCost: 0,
})

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function numOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

function str(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback
}

function strOrNull(value: unknown): string | null {
    return typeof value === "string" ? value : null
}

function reason(value: unknown): DisabledReason | null {
    return value === "auth" || value === "missing" || value === "quota" ? value : null
}

/**
 * Reads a stored record field by field, filling what an older version did not write with the empty record's value; a
 * value that is not a record at all reads as undefined. Durable adapters parse their JSON through it.
 */
export function toHealthRecord(value: unknown): HealthRecord | undefined {
    if (!isRecord(value)) return undefined
    return {
        breaker: value.breaker === "open" ? "open" : "closed",
        failures: num(value.failures, 0),
        openUntil: num(value.openUntil, 0),
        cooldownMs: num(value.cooldownMs, 0),
        disabledUntil: num(value.disabledUntil, 0),
        disabledReason: reason(value.disabledReason),
        disabledCode: strOrNull(value.disabledCode),
        fingerprint: strOrNull(value.fingerprint),
        remainingRequests: numOrNull(value.remainingRequests),
        requestsResetAt: num(value.requestsResetAt, 0),
        remainingTokens: numOrNull(value.remainingTokens),
        tokensResetAt: num(value.tokensResetAt, 0),
        cooldownUntil: num(value.cooldownUntil, 0),
        spendDay: str(value.spendDay, ""),
        spendDayCost: num(value.spendDayCost, 0),
        spendMonth: str(value.spendMonth, ""),
        spendMonthCost: num(value.spendMonthCost, 0),
    }
}

/** Parses a record a durable adapter stored as JSON; unreadable text reads as undefined. */
export function parseHealthRecord(text: string | null | undefined): HealthRecord | undefined {
    if (text === null || text === undefined) return undefined
    try {
        return toHealthRecord(JSON.parse(text))
    } catch {
        return undefined
    }
}

/** The default store: one process's memory. A restart forgets every blacklist; use a durable store in production. */
export class MemoryStateStore implements StateStore {
    readonly #records = new Map<string, HealthRecord>()
    readonly #leases = new Map<string, number>()

    /** Reads a record. */
    get(key: string): HealthRecord | undefined {
        return this.#records.get(key)
    }

    /** Writes a record. */
    set(key: string, record: HealthRecord): void {
        this.#records.set(key, record)
    }

    /** Removes a record. */
    delete(key: string): void {
        this.#records.delete(key)
    }

    /** Lists the record keys under a prefix. */
    keys(prefix: string): readonly string[] {
        return [...this.#records.keys()].filter((key) => key.startsWith(prefix))
    }

    /** Takes a lease when free or expired. */
    lease(key: string, ttlMs: number): boolean {
        const now = Date.now()
        const held = this.#leases.get(key)
        if (held !== undefined && held > now) return false
        this.#leases.set(key, now + ttlMs)
        return true
    }

    /** Frees a lease. */
    release(key: string): void {
        this.#leases.delete(key)
    }
}
