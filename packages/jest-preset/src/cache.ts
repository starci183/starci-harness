/**
 * `fakeCache(clock)` -- a behavioural in-memory double of a cache port.
 *
 * It keeps entries as JSON text (like a Redis-backed cache, so a Date comes back as a string and a `key.parse` narrows
 * what was stored), expires them from the `FakeClock` (`clock.advance(ms)` is a TTL expiry, no sleep), and offers the
 * inspection a spec needs: `has(key)`, `ttlOf(key)`, `keys()`.
 *
 * Two call shapes are served by the same object, so it stands in for either kind of cache dependency:
 *   - the typed-key port: `get({ key, args })`, `set({ key, args, value })`, `del({ key, args })`, where `key` is
 *     `{ name, ttl: { seconds }, parse? }` and the entry text is `<name>:<arg>:...`;
 *   - the cache-manager shape: `get(text)`, `set(text, value, ttlMs?)`, `del(text)`.
 * `has`, `ttlOf` and `del` accept a request or the entry text.
 */

/** The declared key of a typed cache entry: `{ name, ttl, parse? }`. */
export interface FakeCacheKey<TValue = unknown> {
  readonly name: string
  readonly ttl: { readonly seconds: number }
  readonly parse?: (stored: unknown) => TValue | null
}
/** The typed-key request: the key plus the arguments that make the entry unique. */
export interface FakeCacheRequest<TValue = unknown> {
  readonly key: FakeCacheKey<TValue>
  readonly args?: ReadonlyArray<string>
}
export type FakeCacheEntry<TValue = unknown> = FakeCacheRequest<TValue> & { readonly value: TValue }

/** A behavioural in-memory cache: JSON round trip, expiry driven by the clock, inspection helpers. */
export interface FakeCache {
  get<TValue>(request: FakeCacheRequest<TValue>): Promise<TValue | null>
  get(text: string): Promise<unknown>
  set<TValue>(entry: FakeCacheEntry<TValue>): Promise<void>
  set(text: string, value: unknown, ttlMs?: number): Promise<void>
  del(request: FakeCacheRequest | string): Promise<void>
  /** Whether a live (not expired) entry exists. */
  has(request: FakeCacheRequest | string): boolean
  /** Seconds left before the entry expires (rounded up); null when absent, expired or without a ttl. */
  ttlOf(request: FakeCacheRequest | string): number | null
  /** The texts of the live entries. */
  keys(): string[]
  clear(): void
}

interface StoredEntry {
  readonly json: string
  readonly expiresAt: number | null
}

const textOf = (request: FakeCacheRequest | string): string =>
  typeof request === "string" ? request : [request.key.name, ...(request.args ?? [])].join(":")

/** The cache double; `clock` is the `FakeClock` of the spec, so `clock.advance(ms)` expires entries. */
export function fakeCache(clock: { now(): Date }): FakeCache {
  if (!clock || typeof clock.now !== "function") throw new Error("fakeCache: pass the FakeClock the spec drives, fakeCache(clock)")
  const entries = new Map<string, StoredEntry>()

  const live = (text: string): StoredEntry | undefined => {
    const entry = entries.get(text)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== null && clock.now().getTime() >= entry.expiresAt) {
      entries.delete(text)
      return undefined
    }
    return entry
  }

  async function get<TValue>(request: FakeCacheRequest<TValue>): Promise<TValue | null>
  async function get(text: string): Promise<unknown>
  async function get(request: FakeCacheRequest | string): Promise<unknown> {
    const entry = live(textOf(request))
    if (entry === undefined) return null
    const stored: unknown = JSON.parse(entry.json)
    return typeof request === "string" || typeof request.key.parse !== "function" ? stored : request.key.parse(stored)
  }

  async function set<TValue>(entry: FakeCacheEntry<TValue>): Promise<void>
  async function set(text: string, value: unknown, ttlMs?: number): Promise<void>
  async function set(request: FakeCacheEntry | string, value?: unknown, ttlMs?: number): Promise<void> {
    const text = textOf(request)
    const stored = typeof request === "string" ? value : request.value
    const lifetimeMs = typeof request === "string" ? ttlMs : request.key.ttl.seconds * 1000
    if (lifetimeMs !== undefined && !(lifetimeMs > 0)) throw new Error(`fakeCache: the ttl of ${text} must be positive`)
    entries.set(text, { json: JSON.stringify(stored), expiresAt: lifetimeMs === undefined ? null : clock.now().getTime() + lifetimeMs })
  }

  return {
    get,
    set,
    async del(request) {
      entries.delete(textOf(request))
    },
    /** Whether a live (not expired) entry exists. */
    has: (request) => live(textOf(request)) !== undefined,
    /** Seconds left before the entry expires (rounded up), null when there is no live entry or it never expires. */
    ttlOf(request) {
      const entry = live(textOf(request))
      if (entry === undefined || entry.expiresAt === null) return null
      return Math.ceil((entry.expiresAt - clock.now().getTime()) / 1000)
    },
    /** The texts of the live entries. */
    keys: () => [...entries.keys()].filter((text) => live(text) !== undefined),
    /** Drops every entry. */
    clear: () => entries.clear(),
  }
}
