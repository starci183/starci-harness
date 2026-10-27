/**
 * `fakeLock(clock)` -- a behavioural in-memory double of a lease (cross-replica lock with fencing).
 *
 * `acquire({ name, holder, ttlMs, at? })` grants `{ name, holder, fence }` when nobody holds the name (or the previous
 * ttl ran out on the clock) and answers `null` on contention; the fence grows with every grant of one name.
 * `release({ grant })` lets go only when the grant is still current. A holder acquiring its own live lease renews it.
 * Inspection: `isHeld(name)`, `holderOf(name)`, `fenceOf(name)`. Expiry is driven by the `FakeClock`; a request may carry
 * its own `at`, which wins.
 */

/** What a caller asks for when it wants a named lease. */
export interface FakeLockAcquire {
  readonly name: string
  readonly holder: string
  readonly ttlMs: number
  /** The instant of the request; defaults to the clock of the double. */
  readonly at?: Date
}
/** A granted lease. */
export interface FakeLockGrant {
  readonly name: string
  readonly holder: string
  readonly fence: number
}

/** A behavioural in-memory lease: acquire, contention, release, ttl expiry on the clock, growing fence. */
export interface FakeLock {
  acquire(params: FakeLockAcquire): Promise<FakeLockGrant | null>
  release(params: { readonly grant: FakeLockGrant }): Promise<void>
  isHeld(name: string): boolean
  holderOf(name: string): string | null
  fenceOf(name: string): number | null
}

interface Hold {
  readonly holder: string
  readonly fence: number
  readonly expiresAt: number
}

/** The lock double; expiry follows `clock`, so `clock.advance(ms)` frees a lease whose ttl ran out. */
export function fakeLock(clock?: { now(): Date }): FakeLock {
  const state = new Map<string, Hold>()
  const fences = new Map<string, number>()
  const nowOf = (params: FakeLockAcquire): number => {
    const at = params.at ?? clock?.now()
    if (at === undefined) throw new Error("fakeLock: pass the FakeClock, fakeLock(clock), or an `at` on each acquire")
    return at.getTime()
  }
  const liveHold = (name: string): Hold | undefined => {
    const hold = state.get(name)
    if (hold === undefined) return undefined
    if (clock !== undefined && clock.now().getTime() >= hold.expiresAt) {
      state.delete(name)
      return undefined
    }
    return hold
  }

  return {
    async acquire(params) {
      const at = nowOf(params)
      const held = state.get(params.name)
      const alive = held !== undefined && at < held.expiresAt
      if (alive && held.holder !== params.holder) return null
      const fence = alive ? held.fence : (fences.get(params.name) ?? 0) + 1
      fences.set(params.name, fence)
      state.set(params.name, { holder: params.holder, fence, expiresAt: at + params.ttlMs })
      return { name: params.name, holder: params.holder, fence }
    },
    async release({ grant }) {
      const held = state.get(grant.name)
      if (held !== undefined && held.fence === grant.fence && held.holder === grant.holder) state.delete(grant.name)
    },
    /** Whether a live lease exists for `name`. */
    isHeld: (name) => liveHold(name) !== undefined,
    /** The holder of the live lease, or null. */
    holderOf: (name) => liveHold(name)?.holder ?? null,
    /** The fence of the latest grant of `name`, or null when it was never granted. */
    fenceOf: (name) => fences.get(name) ?? null,
  }
}
