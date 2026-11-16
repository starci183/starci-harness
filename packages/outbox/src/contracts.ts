import type { FailureClass } from "@starci/nest-kit"
import type { JobLadder } from "./ladders.ts"
import type { OutboxDatabase, Queryable } from "./sql.ts"
import type { OutboxTables } from "./tables.ts"

/** The state of one job row. `closed` is a dead letter a person ended for good. */
export type JobState = "queued" | "running" | "done" | "parked" | "closed"

/** A state change of a job a notification may be asked for: claimed by a worker, done, failed and retried later, parked. */
export type NotifyState = "claimed" | "done" | "failed" | "parked"

/** The notification of one job: its state changes are published as events `job.<state>` on this topic of the job's scope. */
export interface JobNotify {
    /** The topic of the job's scope the events go to (`jobs`, `imports`); a client follows it through `sse`. */
    readonly topic: string
    /** The state changes published; all four by default. */
    readonly on?: readonly NotifyState[]
}

/** What a transaction enqueues: one job, kept once by its once key. */
export interface EnqueueJob {
    /** The scope the job's concurrency is counted in (a tenant, an account), or null for an unscoped queue with no slots. */
    readonly scope: string | null
    /** The queue; concurrency is per queue per scope. */
    readonly queue: string
    /** The name of the handler that runs it. */
    readonly name: string
    /** The input document of the job (ids, not copies of rows). */
    readonly payload: object
    /** The once key, parts separated by `:`; a second enqueue under the same key inserts nothing. */
    readonly onceKey: string
    /** The job is not started before this instant; now when absent. */
    readonly notBefore?: Date | undefined
    /**
     * Publishes the job's state changes as events of its scope (a job with a null scope is refused `OUTBOX_EVENT_INVALID`), so a client
     * follows its progress through `sse` instead of polling. Kept with the job: a second enqueue under the once key changes nothing.
     */
    readonly notify?: JobNotify | undefined
}

/**
 * What an enqueue did: the id of the job under the once key (null in the rare case that job committed after the caller's snapshot),
 * and whether this call created it.
 */
export interface Enqueued {
    readonly id: string | null
    readonly created: boolean
}

/** One claimed job: the row as the claim left it, with the fence of its lease. */
export interface ClaimedJob {
    readonly id: string
    readonly scope: string | null
    readonly queue: string
    readonly name: string
    readonly payload: unknown
    readonly onceKey: string
    /** The start number in this episode, from 1, counted before the work runs. */
    readonly attempt: number
    /** The fence this claim bumped: only a write that names it lands. */
    readonly fence: number
    /** How many times the job was handed back from a dead letter. */
    readonly resumeCount: number
    /** The notification its enqueue asked for, with every state it publishes; absent when none. */
    readonly notify?: { readonly topic: string; readonly on: readonly NotifyState[] }
}

/** What a transaction publishes: one event of a scope's topic, written with the caller's change and announced after it commits. */
export interface PublishEvent {
    /** The scope the event belongs to (a tenant, an account): only a subscriber of this scope receives it. */
    readonly scope: string
    /** The topic within the scope (`jobs`, `orders`). */
    readonly topic: string
    /** What happened (`order.paid`); the client switches on it. */
    readonly type: string
    /** The document the client receives (ids and states, never a secret). */
    readonly data?: object
}

/** One event as a subscriber receives it. `seq` is its place in the stream, the SSE `id` a client resumes after (`Last-Event-ID`). */
export interface OutboxEvent {
    readonly seq: string
    readonly scope: string
    readonly topic: string
    readonly type: string
    readonly data: unknown
    readonly createdAt: string
}

/** What a subscriber follows: one scope, which the server takes from the caller's own principal, never from the request. */
export interface Subscription {
    /** The scope; required. */
    readonly scope: string
    /** The topics of the scope; at least one. */
    readonly topics: readonly string[]
    /** Resume after this seq: every event of the scope's topics after it is replayed first, in order. Digits only; anything else starts live. */
    readonly lastEventId?: string | undefined
}

/** How a subscriber hears its events, and the end of its subscription when the outbox closes it. */
export interface SubscriptionHandlers {
    readonly onEvent: (event: OutboxEvent) => void
    /** The outbox stopped (or lost its listener for good): the subscription is over. */
    readonly onClose?: (cause?: unknown) => void
}

/** A notification as the listening connection hands it over. */
export interface Notification {
    readonly channel: string
    readonly payload?: string | undefined
}

/**
 * The dedicated connection that LISTENs: a connected node-postgres `Client` has this shape. It is never a pooled connection, since a pool
 * hands it to other work and a LISTEN lives as long as the connection.
 */
export interface NotificationClient {
    query(sql: string): Promise<unknown>
    on(event: "notification", listener: (message: Notification) => void): unknown
    on(event: "error", listener: (error: Error) => void): unknown
    on(event: "end", listener: () => void): unknown
    end(): Promise<void>
}

/** The settings of the event streams a process serves. */
export interface StreamOptions {
    /** Opens the dedicated listening connection, connected (`async () => { const c = new pg.Client(config); await c.connect(); return c }`). */
    readonly listener?: () => Promise<NotificationClient>
    /** The comment line that keeps an idle stream alive, every so many ms (15000; the client's heartbeat timeout is 45000). */
    readonly heartbeatMs?: number
    /** The bytes a stream may hold unsent before its client is dropped as too slow (1048576). */
    readonly maxBufferedBytes?: number
    /** How long a stream may stay full before its client is dropped, ms (10000). */
    readonly drainTimeoutMs?: number
    /** The `retry:` the stream sends, the client's first reconnect delay, ms (2000). */
    readonly retryMs?: number
    /** The first wait before the listening connection is opened again after it broke, ms (1000; doubled up to 30000). */
    readonly reconnectMs?: number
}

/** What a handler gets besides its job. */
export interface JobContext {
    /** The transaction of the job: what the handler writes commits or rolls back with the mark of the job itself. */
    readonly tx: Queryable
    /** Enqueues a next job in the same transaction. */
    enqueue(job: EnqueueJob): Promise<Enqueued>
    /**
     * The idempotency key of one outside effect of this job, `<jobId>:<effect>`: the same on every retry and resume, never carrying the
     * fence, so an effect a provider keys by it is made once (BE-JOBS-3).
     */
    effectKey(effect: string): string
    /** Aborted when the lease is lost (a newer claim owns the row) or the worker shuts down past its grace: stop and throw. */
    readonly signal: AbortSignal
}

const DEFERRAL: unique symbol = Symbol.for("@starci/outbox/defer")

/** A handler's answer that asks to run the job again later, keeping what the handler wrote, without spending a start or writing a failure. */
export interface Deferral {
    readonly [DEFERRAL]: number
}

/** Answers from a handler: come back after `seconds` ("someone else holds this"); any other answer means the job is done. */
export const defer = (seconds: number): Deferral => ({ [DEFERRAL]: seconds })

/** The pause a handler's answer asks for, or undefined when the answer is no deferral. */
export const deferralOf = (answer: unknown): number | undefined => {
    if (typeof answer !== "object" || answer === null) return undefined
    const seconds: unknown = Reflect.get(answer, DEFERRAL)
    return typeof seconds === "number" ? seconds : undefined
}

/** The handler of one job name. The outbox knows no job of the app's: the app registers its handlers with `handle`. */
export interface JobHandler<P = unknown> {
    /** The job name it runs. */
    readonly name: string
    /** The ladder of its class of flow, a key of the outbox's `ladders` (`background` or `waited` by default). */
    readonly ladder?: string
    /** The guard of its payload; a payload it refuses is a dead letter at once, class `input`. */
    accepts?(payload: unknown): payload is P
    /**
     * Runs the job. A thrown failure is judged by `classify` (a `failureClass` the error carries wins: `transient` is retried on the
     * ladder, any other class parks at once); the handler never catches to wait or retry. Answering `defer(seconds)` hands the job back
     * for later; any other answer marks it done.
     */
    handle(job: ClaimedJob & { readonly payload: P }, context: JobContext): Promise<unknown>
}

/** A dead letter, as the alert and the person's list see it. */
export interface ParkedJob {
    readonly id: string
    readonly scope: string | null
    readonly queue: string
    readonly name: string
    readonly payload: unknown
    readonly attempts: number
    readonly reason: string
    readonly failureClass: FailureClass
    /** Why it parked: its class cannot be retried, or the ladder ran out. */
    readonly why: "class" | "exhausted"
    readonly parkedAt: Date
    readonly parkedBuild: string | null
    readonly resumeCount: number
}

/** How one start ended. */
export type RunResult = "done" | "deferred" | "retried" | "parked" | "lost"

/** What one drain did. */
export interface DrainReport {
    readonly done: number
    readonly deferred: number
    readonly retried: number
    readonly parked: number
    readonly lost: number
    readonly timersFired: number
}

/** What arming a timer takes: a pending timer of the same (scope, key) is moved to the new time and job. */
export interface ArmTimer {
    readonly scope: string | null
    /** Unique among the pending timers of the scope. */
    readonly key: string
    readonly dueAt: Date
    /** The queue of the job it fires; `TIMER_QUEUE` by default. */
    readonly queue?: string
    /** The name of the job it fires; `TIMER_FIRED_JOB` by default. */
    readonly name?: string
    /** What the firing carries, as `data` of the fired job's payload `{ timerId, key, data }`. */
    readonly payload: object
}

/** The queue a fired timer is delivered on when its arm names none. */
export const TIMER_QUEUE = "timers"
/** The job name of a fired timer when its arm names none. */
export const TIMER_FIRED_JOB = "timer.fired"

/** The instant source; the system clock by default, a fixed one in specs. */
export interface Clock {
    now(): Date
}

/** The scheduling seam of the worker loop and the lease renewal; real timers by default. Answers a cancel. */
export type Schedule = (work: () => void, afterMs: number) => () => void

/** Who resumes a dead letter: a person opens a new episode (and a new alert); the machine (a new build, the sweep) keeps the episode. */
export type ResumedBy = "person" | "machine"

/** The settings of an outbox. */
export interface OutboxOptions extends OutboxTables {
    /** The database it claims and settles on. */
    readonly database: OutboxDatabase
    /** The ladders by name; `DEFAULT_LADDERS` when absent. A handler with no ladder takes `background`. */
    readonly ladders?: Readonly<Record<string, JobLadder>>
    /** The failure class of a thrown value; `classifyFailure(cause, DomainError)` of `@starci/nest-kit` by default. */
    readonly classify?: (cause: unknown) => FailureClass
    /** Called once per park episode, after the park committed. A throw is reported to `onError`, never undoes the park. */
    readonly onParked?: (job: ParkedJob) => Promise<void>
    /** Every failure the worker cannot hand to a job (a tick, a settle, a hook); a warning on the process by default. */
    readonly onError?: (event: string, cause: unknown, fields?: Readonly<Record<string, string>>) => void
    /** Scrubs a failure's text before a row keeps it. */
    readonly redact?: (text: string) => string
    /** The build this process runs; at `start` every job parked under another build is handed back. */
    readonly buildId?: string
    /** Names this worker on the rows it claims; host, pid and a random suffix by default. */
    readonly workerId?: string
    /** How long a claim holds its lease, ms (300000). It is renewed every third of it while the handler runs. */
    readonly leaseMs?: number
    /** The pause between worker ticks when nothing was due, ms (1000). */
    readonly pollMs?: number
    /** Rows one claim takes at most (20). */
    readonly batch?: number
    /** Jobs this worker runs at once (the batch). */
    readonly maxInFlight?: number
    /** Concurrent starts per scope of a queue the map does not name (4). */
    readonly defaultConcurrency?: number
    /** Concurrent starts per scope, by queue. */
    readonly queueConcurrency?: Readonly<Record<string, number>>
    /** How often the timers are swept, ms (5000). */
    readonly timerSweepMs?: number
    /** How often transient dead letters are handed back, ms (300000); a dead letter waits at least this long before it goes back. */
    readonly resumeSweepMs?: number
    /** How many times the sweep hands one transient dead letter back by itself (3); after that only a person or a new build does. */
    readonly autoResumes?: number
    /** How long `stop` waits for running jobs before it aborts them and hands their rows back, ms (30000). */
    readonly shutdownGraceMs?: number
    /** How long an event is kept for a client to resume after, ms (86400000, a day); the worker deletes older ones. */
    readonly eventRetentionMs?: number
    /** How often the worker deletes events past their retention, ms (600000). */
    readonly eventSweepMs?: number
    /** The event streams this process serves (`sse`, `subscribe`). */
    readonly stream?: StreamOptions
    readonly clock?: Clock
    readonly schedule?: Schedule
}
