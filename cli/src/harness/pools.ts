import type { DatabaseSync } from "node:sqlite"
import { textOf } from "./machine.js"
import { minutesMs } from "./routing.js"
import type { Routing } from "./routing.js"

/** A pool's concurrency now: its AIMD cap, its configured max and the times of the last throttle and steps. */
export interface PoolConcurrency {
    readonly pool: string
    readonly cap: number
    readonly max: number
    readonly halvings: number
    readonly lastThrottleAt: string | null
    readonly lastDecreaseAt: string | null
    readonly lastIncreaseAt: string | null
}

/** One AIMD step: the cap before and after, and why it moved or held. */
export interface ConcurrencyChange {
    readonly pool: string
    readonly from: number
    readonly to: number
    readonly max: number
    readonly reason: string
}

const ms = (at: string | null): number => (at === null ? 0 : Date.parse(at))

/** The pool's concurrency; a pool with no row runs at its maxParallel, and a lowered maxParallel lowers the cap with it. */
export const poolConcurrency = (db: DatabaseSync | undefined, routing: Routing, pool: string): PoolConcurrency => {
    const max = routing.pools[pool]?.maxParallel ?? 1
    const row = db?.prepare("SELECT * FROM pool_concurrency WHERE pool = ?").get(pool)
    if (row === undefined) return { pool, cap: max, max, halvings: 0, lastThrottleAt: null, lastDecreaseAt: null, lastIncreaseAt: null }
    return {
        pool,
        cap: Math.min(max, Number(row.cap)),
        max,
        halvings: Number(row.halvings),
        lastThrottleAt: textOf(row.last_throttle_at),
        lastDecreaseAt: textOf(row.last_decrease_at),
        lastIncreaseAt: textOf(row.last_increase_at),
    }
}

const save = (db: DatabaseSync, next: PoolConcurrency, at: string): void => {
    db.prepare(
        `INSERT INTO pool_concurrency (pool, cap, max, halvings, last_throttle_at, last_decrease_at, last_increase_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pool) DO UPDATE SET cap = excluded.cap, max = excluded.max, halvings = excluded.halvings, last_throttle_at = excluded.last_throttle_at,
         last_decrease_at = excluded.last_decrease_at, last_increase_at = excluded.last_increase_at, updated_at = excluded.updated_at`,
    ).run(next.pool, next.cap, next.max, next.halvings, next.lastThrottleAt, next.lastDecreaseAt, next.lastIncreaseAt, at)
}

/**
 * One AIMD step of a pool. A throttle (a rate or capacity failure) halves the cap, never below the floor, at most once per
 * decreaseCooldown so one burst counts once. A success adds 1 when the pool has been quiet (no throttle) for quietMinutes
 * and its last step is increaseStep old; the cap never passes maxParallel.
 */
export const stepConcurrency = (db: DatabaseSync, routing: Routing, pool: string, signal: "throttle" | "success", at: string): ConcurrencyChange => {
    const current = poolConcurrency(db, routing, pool)
    const { floor, decreaseCooldownMinutes, quietMinutes, increaseStepMinutes } = routing.concurrency
    const now = Date.parse(at)
    const lowest = Math.min(current.max, floor)
    const held = (reason: string): ConcurrencyChange => ({ pool, from: current.cap, to: current.cap, max: current.max, reason })
    if (signal === "throttle") {
        if (current.lastDecreaseAt !== null && now - ms(current.lastDecreaseAt) < minutesMs(decreaseCooldownMinutes)) {
            save(db, { ...current, lastThrottleAt: at }, at)
            return held(`throttled again within ${String(decreaseCooldownMinutes)} min of the last halving; cap held`)
        }
        const cap = Math.max(lowest, Math.floor(current.cap / 2))
        save(db, { ...current, cap, halvings: current.halvings + 1, lastThrottleAt: at, lastDecreaseAt: at }, at)
        return { pool, from: current.cap, to: cap, max: current.max, reason: `throttled: halved${cap === lowest ? " to the floor" : ""}` }
    }
    if (current.cap >= current.max) return held("at maxParallel")
    const quietFor = now - Math.max(ms(current.lastThrottleAt), ms(current.lastDecreaseAt))
    if (quietFor < minutesMs(quietMinutes)) return held(`quiet ${String(Math.floor(quietFor / 60_000))} of ${String(quietMinutes)} min; cap held`)
    if (now - Math.max(ms(current.lastIncreaseAt), ms(current.lastDecreaseAt)) < minutesMs(increaseStepMinutes)) return held(`last step under ${String(increaseStepMinutes)} min ago; cap held`)
    const cap = current.cap + 1
    save(db, { ...current, cap, lastIncreaseAt: at }, at)
    return { pool, from: current.cap, to: cap, max: current.max, reason: "quiet success: +1" }
}
