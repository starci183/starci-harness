"use strict"

const { isDeepStrictEqual } = require("node:util")
const { isTransactionManager } = require("./entity-manager.cjs")
const CLIENT_SWEEP_BATCH = 500

/** The fake carries the production refusal code without depending on an application's error family. */
const inboxError = (code) => Object.assign(new Error(code), { code })

/** Clone JSON values directly so toJSON cannot change the request or the stored outcome. */
const snapshot = (value, ancestors = new Set()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value === 0 ? 0 : value
  if (typeof value !== "object" || ancestors.has(value)) throw inboxError("IDEMPOTENCY_REQUEST_INVALID")
  ancestors.add(value)
  let result
  if (Array.isArray(value)) result = Array.from(value, (member) => snapshot(member, ancestors))
  else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw inboxError("IDEMPOTENCY_REQUEST_INVALID")
    result = Object.fromEntries(Object.entries(value).map(([key, member]) => [key, snapshot(member, ancestors)]))
  }
  ancestors.delete(value)
  return result
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
function fakeInbox(clock) {
  const held = new Set()
  const claims = []
  const released = []
  const clients = new Map()
  const clientEntries = []
  const sweeps = []
  const failures = new Map()
  const keyOf = (source, eventId) => `${source}\u0000${eventId}`
  const failIfScripted = (operation) => {
    if (!failures.has(operation)) return
    const error = failures.get(operation)
    failures.delete(operation)
    throw error
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
    async runClient(request, tx, effect) {
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
      const entry = { request: body, claimedAt: clock === undefined ? new Date(0) : clock.now(), completed: false }
      held.add(key)
      clients.set(key, entry)
      entry.result = Promise.resolve().then(effect).then((value) => {
        const stored = snapshot(value)
        entry.completed = true
        return stored
      }).catch((error) => {
        if (clients.get(key) === entry) {
          clients.delete(key)
          held.delete(key)
        }
        throw error
      })
      return snapshot(await entry.result)
    },
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
        const [source, eventId] = key.split("\u0000")
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

module.exports = { fakeInbox }
