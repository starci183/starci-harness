import type { MaybePromise } from "./types.ts"

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
    /** A disabled key is no candidate until then; `Number.MAX_SAFE_INTEGER` means until `reset()`. */
    readonly disabledUntil: number
    readonly disabledReason: "auth" | "missing" | null
    /** The lane's last reported remaining requests, or null when the provider never said. */
    readonly remainingRequests: number | null
    readonly requestsResetAt: number
    readonly remainingTokens: number | null
    readonly tokensResetAt: number
    /** A 429 keeps the lane out until then. */
    readonly cooldownUntil: number
}

/**
 * Where breaker, disabled-key and headroom state lives. The in-memory store is the default; an adapter over Redis, a
 * database or any shared map lets several processes see each other's breakers. Methods may be synchronous or async.
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

/** A record with nothing known: a closed breaker, an enabled key, unknown headroom. */
export const EMPTY_RECORD: HealthRecord = Object.freeze({
    breaker: "closed",
    failures: 0,
    openUntil: 0,
    cooldownMs: 0,
    disabledUntil: 0,
    disabledReason: null,
    remainingRequests: null,
    requestsResetAt: 0,
    remainingTokens: null,
    tokensResetAt: 0,
    cooldownUntil: 0,
})

/** The default store: one process's memory. */
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
