import { isDeepStrictEqual } from "node:util"
import { isTransactionManager } from "./entity-manager.ts"
const CLIENT_SWEEP_BATCH = 500

/** One claim or release of a delivery. */
export interface InboxEntry {
  readonly source: string
  readonly eventId: string
}
/** The inbox operations `failNext` can make reject. */
export type InboxOperation = "claim" | "release" | "runClient" | "sweepClients"

/** The client operation namespace, exact key and JSON request whose outcome the inbox stores. */
export interface InboxClientOperation {
  readonly principalId: string
  readonly operation: string
  readonly idempotencyKey: string
  readonly request: unknown
}

/** A client claim with the manager passed by its caller. */
export interface InboxClientEntry extends InboxEntry {
  readonly tx: unknown
  readonly inTransaction: boolean
}

/** One retention sweep with the cutoff instant and manager passed by its caller. */
export interface InboxSweep {
  readonly cutoff: Date
  readonly tx: unknown
  readonly inTransaction: boolean
}

/** An `Inbox` double with the behaviour of the real claim. */
export interface FakeInbox {
  /** True for the first claim of a (source, eventId) pair, false for every later one until it is released. */
  claim(source: string, eventId: string): Promise<boolean>
  /** Gives an ordinary delivery claim back while preserving client receipts and their outcomes. */
  release(source: string, eventId: string): Promise<void>
  /** Runs once for the client namespace and key, replays the JSON outcome and refuses a different body. */
  runClient<T>(request: InboxClientOperation, tx: unknown, effect: () => Promise<T>): Promise<T>
  /** Deletes at most one batch of completed client claims older than the cutoff. */
  sweepClients(cutoff: Date, tx: unknown): Promise<number>
  /** Marks a pair as already claimed (a redelivery). */
  seen(source: string, eventId: string): void
  /** Makes the next call of `operation` reject with `error`, once. */
  failNext(operation: InboxOperation, error: Error): void
  /** Every claim, in order, duplicates included. */
  readonly claims: ReadonlyArray<InboxEntry>
  /** The pairs held now: claimed and not released. */
  readonly claimed: ReadonlyArray<InboxEntry>
  /** Every release, in order. */
  readonly released: ReadonlyArray<InboxEntry>
  /** Every client claim with its manager; this double records transaction ownership, not database commit semantics. */
  readonly clientEntries: ReadonlyArray<InboxClientEntry>
  /** Every sweep attempt with its cutoff and transaction, including a scripted failure. */
  readonly sweeps: ReadonlyArray<InboxSweep>
  clear(): void
}

/** The fake carries the production refusal code without depending on an application's error family. */
const inboxError = (code: string): Error & { code: string } => Object.assign(new Error(code), { code })

/** Clone JSON values directly so toJSON cannot change the request or the stored outcome. */
const snapshot = (value: unknown, ancestors = new Set<object>()): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value === 0 ? 0 : value
  if (typeof value !== "object" || ancestors.has(value)) throw inboxError("IDEMPOTENCY_REQUEST_INVALID")
  ancestors.add(value)
  let result: unknown
  if (Array.isArray(value)) result = Array.from(value, (member: unknown) => snapshot(member, ancestors))
  else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw inboxError("IDEMPOTENCY_REQUEST_INVALID")
    result = Object.fromEntries(Object.entries(value).map(([key, member]) => [key, snapshot(member, ancestors)]))
  }
  ancestors.delete(value)
  return result
}

interface ClientClaim {
  readonly request: unknown
  readonly claimedAt: Date
  completed: boolean
  result?: Promise<unknown>
}

/**
 * `fakeInbox(clock?)` records delivery and client claims, so a spec asserts deduplication and the transaction passed by
 * its service. Client calls replay JSON outcomes; `clock` gives retention tests a driven claim timestamp.
 *
 * `claim(source, eventId)` answers `true` for the first call of a (source, eventId) pair and `false` for every later one, like the
 * real unique key; `release(source, eventId)` gives an ordinary delivery claim back while preserving client outcomes.
 * `claims` is every claim in order, `claimed` the pairs that are held now, `released` every release, `seen(source, eventId)` marks a
 * pair as already delivered (a redelivery), and `failNext(operation, error)` makes the next call of that operation reject once, so
 * a spec drives the failure path.
 */
/** The inbox double. Pass a driven clock to test retention; omitted clocks stamp client claims at the Unix epoch. */
export function fakeInbox(clock?: { now(): Date }): FakeInbox {
  const held = new Set<string>()
  const claims: InboxEntry[] = []
  const released: InboxEntry[] = []
  const clients = new Map<string, ClientClaim>()
  const clientEntries: InboxClientEntry[] = []
  const sweeps: InboxSweep[] = []
  const failures = new Map<InboxOperation, Error>()
  const keyOf = (source: string, eventId: string): string => `${source}\u0000${eventId}`
  const failIfScripted = (operation: InboxOperation): void => {
    const error = failures.get(operation)
    if (error === undefined) return
    failures.delete(operation)
    throw error
  }

  async function runClient<T>(request: InboxClientOperation, tx: unknown, effect: () => Promise<T>): Promise<T>
  async function runClient(request: InboxClientOperation, tx: unknown, effect: () => Promise<unknown>): Promise<unknown> {
    failIfScripted("runClient")
    const { principalId, operation, idempotencyKey } = request
    if (!principalId.trim() || principalId.includes(":") || !operation.trim() || operation.includes(":")
      || !idempotencyKey.trim() || idempotencyKey.length > 64) {
      throw inboxError("IDEMPOTENCY_REQUEST_INVALID")
    }
    const source = `client:${principalId}:${operation}`
    const key = keyOf(source, idempotencyKey)
    const body = snapshot(request.request)
    claims.push({ source, eventId: idempotencyKey })
    clientEntries.push({ source, eventId: idempotencyKey, tx, inTransaction: isTransactionManager(tx) })
    const previous = clients.get(key)
    if (previous !== undefined) {
      if (!isDeepStrictEqual(previous.request, body)) throw inboxError("IDEMPOTENCY_KEY_REUSED")
      return snapshot(await previous.result)
    }
    if (held.has(key)) throw inboxError("IDEMPOTENCY_KEY_REUSED")
    const entry: ClientClaim = { request: body, claimedAt: clock === undefined ? new Date(0) : clock.now(), completed: false }
    held.add(key)
    clients.set(key, entry)
    entry.result = Promise.resolve().then(effect).then((value) => {
      let stored: unknown
      try {
        stored = snapshot(value)
      } catch (cause) {
        throw Object.assign(inboxError("INBOX_OUTCOME_INVALID"), { cause })
      }
      entry.completed = true
      return stored
    }).catch((error: unknown) => {
      if (clients.get(key) === entry) {
        clients.delete(key)
        held.delete(key)
      }
      throw error
    })
    return snapshot(await entry.result)
  }

  return {
    async claim(source, eventId) {
      failIfScripted("claim")
      claims.push({ source, eventId })
      const key = keyOf(source, eventId)
      if (held.has(key)) return false
      held.add(key)
      return true
    },
    async release(source, eventId) {
      failIfScripted("release")
      released.push({ source, eventId })
      const key = keyOf(source, eventId)
      if (!clients.has(key)) held.delete(key)
    },
    runClient,
    async sweepClients(cutoff, tx) {
      sweeps.push({ cutoff: new Date(cutoff), tx, inTransaction: isTransactionManager(tx) })
      failIfScripted("sweepClients")
      let swept = 0
      for (const [key, entry] of clients) {
        if (swept === CLIENT_SWEEP_BATCH) break
        if (!entry.completed || entry.claimedAt >= cutoff) continue
        clients.delete(key)
        held.delete(key)
        swept += 1
      }
      return swept
    },
    /** Marks a pair as already claimed, so the next `claim` of it answers `false` (a redelivery). */
    seen(source, eventId) {
      held.add(keyOf(source, eventId))
    },
    /** Makes the next call of `operation` reject with `error`, once. */
    failNext(operation, error) {
      failures.set(operation, error)
    },
    /** Every `claim`, in order, duplicates included. */
    get claims() {
      return [...claims]
    },
    /** The pairs held now: claimed and not released. */
    get claimed() {
      return [...held].map((key) => {
        const [source = "", eventId = ""] = key.split("\u0000")
        return { source, eventId }
      })
    },
    /** Every `release`, in order. */
    get released() {
      return [...released]
    },
    /** Every client claim, including repeats, with the domain transaction it used. */
    get clientEntries() {
      return [...clientEntries]
    },
    /** Every retention attempt with its cutoff and domain transaction, including a scripted failure. */
    get sweeps() {
      return [...sweeps]
    },
    clear() {
      held.clear()
      claims.length = 0
      released.length = 0
      failures.clear()
      clients.clear()
      clientEntries.length = 0
      sweeps.length = 0
    },
  }
}
