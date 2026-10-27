/**
 * `recordingQueueOutbox()` -- a `QueueOutbox` double that records what a typed queue producer writes, so a spec asserts on `outbox.jobs`.
 *
 * `write(tx, queue, payload)` records the job with the manager it was written through. `jobs` is every job in order, `jobsOf(queue)`
 * the jobs of one queue, and `entries` adds `inTransaction`: whether `tx` was the view a `fakeTransaction` body received, so a spec proves
 * a job is enqueued in the transaction of the change that needs it. `failNext('write', error)` makes the next write reject once.
 */
import { isTransactionManager } from "./entity-manager.ts"

/** One recorded job write. */
export interface QueueWrite {
  readonly queue: string
  readonly payload: object
  readonly tx: unknown
  /** Whether `tx` was the view a `fakeTransaction` body received. */
  readonly inTransaction: boolean
}

/** A `QueueOutbox` double that records the jobs a typed producer writes. */
export interface RecordingQueueOutbox {
  write(tx: unknown, queue: string, payload: object): Promise<void>
  /** Every job written, in order. */
  readonly jobs: ReadonlyArray<{ readonly queue: string; readonly payload: object }>
  /** Every write with its manager. */
  readonly entries: ReadonlyArray<QueueWrite>
  jobsOf(queue: string): ReadonlyArray<{ readonly queue: string; readonly payload: object }>
  /** True when something was written and every write went through a `fakeTransaction` manager. */
  readonly allInTransaction: boolean
  /** Makes the next write reject with `error`, once. */
  failNext(operation: "write", error: Error): void
  clear(): void
}

/** The queue outbox double. */
export function recordingQueueOutbox(): RecordingQueueOutbox {
  const written: QueueWrite[] = []
  const failures = new Map<"write", Error>()
  return {
    async write(tx, queue, payload) {
      const error = failures.get("write")
      if (error !== undefined) {
        failures.delete("write")
        throw error
      }
      written.push({ queue, payload, tx, inTransaction: isTransactionManager(tx) })
    },
    /** Every job written, in order: `{ queue, payload }`. */
    get jobs() {
      return written.map(({ queue, payload }) => ({ queue, payload }))
    },
    /** Every write with its manager and `inTransaction`. */
    get entries() {
      return [...written]
    },
    /** The jobs of one queue. */
    jobsOf(queue) {
      return this.jobs.filter((job) => job.queue === queue)
    },
    /** True when something was written and every write went through a transaction manager. */
    get allInTransaction() {
      return written.length > 0 && written.every((entry) => entry.inTransaction)
    },
    /** Makes the next write reject with `error`, once. */
    failNext(operation, error) {
      failures.set(operation, error)
    },
    clear() {
      written.length = 0
      failures.clear()
    },
  }
}
