/**
 * `recordingEventBus()` -- an `EventBus` double that records what a domain service publishes, so a spec asserts on `bus.events`.
 *
 * `publish(event, tx)` records the event with the manager it was written through. `events` is what the outbox would hold: one
 * event per (event name, event id), like the real unique key, so a duplicate publication keeps one. `writes` is every call, duplicates
 * included, and `entries` adds `inTransaction`: whether `tx` was the view a `fakeTransaction` body received, so a spec proves an event
 * is published in the transaction of the change that caused it. The name of an event is the static `eventName` of its class.
 *
 * The read side is scripted: `setPendingRetries(count)` sets what `pendingRetries(eventClass)` answers, `deadLetters(eventClass)`
 * returns what `queueDeadLetters(...letters)` filled, `requeue(id)` records the id, and `failNext(operation, error)` makes the next
 * call of that operation reject once, so a spec drives the failure path.
 */
import { isTransactionManager } from "./entity-manager.ts"

/** An event as the bus port takes it: a class instance with a stable id; its name is the static `eventName` of its class. */
export interface RecordedEvent {
  readonly eventId: string
}
/** The static side of an event class. */
export interface RecordedEventClass {
  readonly eventName: string
}
/** One recorded publication. */
export interface EventWrite<E extends RecordedEvent = RecordedEvent> {
  readonly event: E
  readonly tx: unknown
  /** Whether `tx` was the view a `fakeTransaction` body received. */
  readonly inTransaction: boolean
}
/** A dead letter as the bus port returns it. */
export interface RecordedDeadLetter {
  readonly id: string
  readonly eventName: string
  readonly eventId: string
  readonly reason: string
  readonly attempts: number
}
/** The bus operations `failNext` can make reject. */
export type EventBusOperation = "publish" | "pendingRetries" | "deadLetters" | "requeue"

/** An `EventBus` double that records publications and scripts the read side. */
export interface RecordingEventBus<E extends RecordedEvent = RecordedEvent> {
  publish(event: E, tx: unknown): Promise<void>
  pendingRetries(eventClass: RecordedEventClass): Promise<number>
  deadLetters(eventClass: RecordedEventClass): Promise<ReadonlyArray<RecordedDeadLetter>>
  requeue(id: string): Promise<void>
  /** What the outbox would hold: the first publication of each (event name, event id). */
  readonly events: ReadonlyArray<E>
  /** Every publication with its manager, duplicates included. */
  readonly entries: ReadonlyArray<EventWrite<E>>
  /** Every event published, duplicates included. */
  readonly writes: ReadonlyArray<E>
  /** True when something was published and every publication went through a `fakeTransaction` manager. */
  readonly allInTransaction: boolean
  eventsOf(eventClass: RecordedEventClass): ReadonlyArray<E>
  /** Sets the answer of `pendingRetries`. */
  setPendingRetries(count: number): void
  /** Adds dead letters `deadLetters` hands out. */
  queueDeadLetters(...items: ReadonlyArray<RecordedDeadLetter>): void
  /** The ids passed to `requeue`. */
  readonly requeued: ReadonlyArray<string>
  /** Makes the next call of `operation` reject with `error`, once. */
  failNext(operation: EventBusOperation, error: Error): void
  clear(): void
}

/** The name of an event: the static `eventName` of its class. */
const nameOf = (event: RecordedEvent): unknown => {
  const eventClass: unknown = event.constructor
  return typeof eventClass === "function" && "eventName" in eventClass ? eventClass.eventName : undefined
}

/** The event bus double. */
export function recordingEventBus<E extends RecordedEvent = RecordedEvent>(): RecordingEventBus<E> {
  const written: Array<EventWrite<E>> = []
  const letters: RecordedDeadLetter[] = []
  const requeued: string[] = []
  const failures = new Map<EventBusOperation, Error>()
  let pending = 0
  const failIfScripted = (operation: EventBusOperation): void => {
    const error = failures.get(operation)
    if (error === undefined) return
    failures.delete(operation)
    throw error
  }
  return {
    async publish(event, tx) {
      failIfScripted("publish")
      written.push({ event, tx, inTransaction: isTransactionManager(tx) })
    },
    async pendingRetries() {
      failIfScripted("pendingRetries")
      return pending
    },
    async deadLetters(eventClass) {
      failIfScripted("deadLetters")
      return letters.filter((letter) => letter.eventName === eventClass.eventName)
    },
    async requeue(id) {
      failIfScripted("requeue")
      requeued.push(id)
    },
    /** The events the outbox would hold: the first publication of each (event name, event id). */
    get events() {
      const seen = new Set<string>()
      return written
        .filter(({ event }) => {
          const key = `${String(nameOf(event))}\u0000${event.eventId}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map(({ event }) => event)
    },
    /** Every publication, in order: `{ event, tx, inTransaction }`. */
    get entries() {
      return [...written]
    },
    /** Every event published, duplicates included. */
    get writes() {
      return written.map(({ event }) => event)
    },
    /** True when something was published and every publication went through a transaction manager. */
    get allInTransaction() {
      return written.length > 0 && written.every((entry) => entry.inTransaction)
    },
    /** The stored events of one class. */
    eventsOf(eventClass) {
      return this.events.filter((event) => nameOf(event) === eventClass.eventName)
    },
    /** Sets the answer of `pendingRetries`. */
    setPendingRetries(count) {
      pending = count
    },
    /** Adds dead letters `deadLetters` hands out. */
    queueDeadLetters(...items) {
      letters.push(...items)
    },
    /** The ids passed to `requeue`, in order. */
    get requeued() {
      return [...requeued]
    },
    /** Makes the next call of `operation` reject with `error`, once. */
    failNext(operation, error) {
      failures.set(operation, error)
    },
    clear() {
      written.length = 0
      letters.length = 0
      requeued.length = 0
      pending = 0
      failures.clear()
    },
  }
}
