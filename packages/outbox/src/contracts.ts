import type { FailureClass } from "@starci/nest-kit"
import type { JobLadder } from "./ladders.ts"
import type { OutboxDatabase, Queryable } from "./sql.ts"
import type { OutboxTables } from "./tables.ts"

/** The state of one job row. `closed` is a dead letter a person ended for good. */
export type JobState = "queued" | "running" | "done" | "parked" | "closed"

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
    readonly clock?: Clock
    readonly schedule?: Schedule
}
