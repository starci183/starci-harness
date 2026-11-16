import { randomBytes } from "node:crypto"
import { hostname } from "node:os"
import { DomainError } from "@starci/common"
import { classifyFailure } from "@starci/nest-kit"
import type { FailureClass } from "@starci/nest-kit"
import type {
    ArmTimer,
    ClaimedJob,
    Clock,
    DrainReport,
    EnqueueJob,
    Enqueued,
    JobContext,
    JobHandler,
    NotifyState,
    OutboxOptions,
    ParkedJob,
    PublishEvent,
    ResumedBy,
    RunResult,
    Schedule,
    Subscription,
    SubscriptionHandlers,
} from "./contracts.ts"
import { TIMER_FIRED_JOB, TIMER_QUEUE, deferralOf } from "./contracts.ts"
import { OutboxError, OutboxErrorCode } from "./errors.ts"
import { EventHub } from "./hub.ts"
import { DEFAULT_LADDERS, isPastLadder, ladderVerdictOf } from "./ladders.ts"
import type { JobLadder } from "./ladders.ts"
import { reasonOf } from "./reason.ts"
import { run } from "./sql.ts"
import type { OutboxDatabase, Queryable, Row } from "./sql.ts"
import { serveSse } from "./sse.ts"
import type { SseLimits, SseRequest, SseResponse } from "./sse.ts"
import { statementsOf } from "./statements.ts"
import type { Statements } from "./statements.ts"
import { NOTIFY_STATES, resolveTables } from "./tables.ts"
import type { ResolvedTables } from "./tables.ts"

/** The limits an outbox runs under, every one resolved. */
interface Limits {
    readonly leaseMs: number
    readonly renewMs: number
    readonly pollMs: number
    readonly batch: number
    readonly maxInFlight: number
    readonly defaultConcurrency: number
    readonly timerSweepMs: number
    readonly resumeSweepMs: number
    readonly autoResumes: number
    readonly shutdownGraceMs: number
    readonly eventRetentionMs: number
    readonly eventSweepMs: number
    readonly reconnectMs: number
    readonly sse: SseLimits
}

/** A bound on one drain, so a handler that chains itself forever cannot spin it without end. */
const MAX_DRAIN_ROUNDS = 10_000
/** Timers one sweep fires at most; the next sweep takes the rest. */
const TIMER_SWEEP_LIMIT = 200
/** Dead letters one resume pass hands back at most. */
const RESUME_BATCH = 100
/** Events one purge round deletes at most; the purge goes on until a round comes back short. */
const EVENT_PURGE_BATCH = 5000
const MAX_EVENT_PURGE_ROUNDS = 100
const SECOND = 1000
const MIN_RENEW_MS = 1000

const positive = (value: number | undefined, fallback: number, option: string): number => {
    const resolved = value ?? fallback
    if (!Number.isInteger(resolved) || resolved < 1) throw new OutboxError({ code: OutboxErrorCode.OptionsInvalid, params: { option, value: String(resolved) } })
    return resolved
}

const limitsOf = (options: OutboxOptions): Limits => {
    const leaseMs = positive(options.leaseMs, 300_000, "leaseMs")
    const batch = positive(options.batch, 20, "batch")
    return {
        leaseMs,
        renewMs: Math.max(MIN_RENEW_MS, Math.floor(leaseMs / 3)),
        pollMs: positive(options.pollMs, 1000, "pollMs"),
        batch,
        maxInFlight: positive(options.maxInFlight, batch, "maxInFlight"),
        defaultConcurrency: positive(options.defaultConcurrency, 4, "defaultConcurrency"),
        timerSweepMs: positive(options.timerSweepMs, 5000, "timerSweepMs"),
        resumeSweepMs: positive(options.resumeSweepMs, 300_000, "resumeSweepMs"),
        autoResumes: positive(options.autoResumes, 3, "autoResumes"),
        shutdownGraceMs: positive(options.shutdownGraceMs, 30_000, "shutdownGraceMs"),
        eventRetentionMs: positive(options.eventRetentionMs, 86_400_000, "eventRetentionMs"),
        eventSweepMs: positive(options.eventSweepMs, 600_000, "eventSweepMs"),
        reconnectMs: positive(options.stream?.reconnectMs, 1000, "stream.reconnectMs"),
        sse: {
            heartbeatMs: positive(options.stream?.heartbeatMs, 15_000, "stream.heartbeatMs"),
            maxBufferedBytes: positive(options.stream?.maxBufferedBytes, 1_048_576, "stream.maxBufferedBytes"),
            drainTimeoutMs: positive(options.stream?.drainTimeoutMs, 10_000, "stream.drainTimeoutMs"),
            retryMs: positive(options.stream?.retryMs, 2000, "stream.retryMs"),
        },
    }
}

const systemClock: Clock = { now: () => new Date() }

const realSchedule: Schedule = (work, afterMs) => {
    const timer = setTimeout(work, afterMs)
    timer.unref()
    return () => {
        clearTimeout(timer)
    }
}

const warn = (event: string, cause: unknown): void => {
    process.emitWarning(`@starci/outbox ${event}: ${reasonOf(cause)}`, "OutboxWarning")
}

const text = (row: Row, column: string): string => {
    const value = row[column]
    return typeof value === "string" ? value : String(value)
}

const textOrNull = (row: Row, column: string): string | null => {
    const value = row[column]
    return value === null || value === undefined ? null : text(row, column)
}

const count = (rows: readonly Row[]): number => Number(rows[0]?.n ?? 0)

const FAILURE_CLASSES: ReadonlySet<string> = new Set(["transient", "input", "code", "config"])

const failureClassOf = (value: string | null): FailureClass => (value !== null && FAILURE_CLASSES.has(value) ? (value as FailureClass) : "code")

const NOTIFY_STATE_SET: ReadonlySet<string> = new Set(NOTIFY_STATES)

const isNotifyState = (value: unknown): value is NotifyState => typeof value === "string" && NOTIFY_STATE_SET.has(value)

const claimedOf = (row: Row): ClaimedJob => {
    const topic = textOrNull(row, "notify_topic")
    const job = {
        id: text(row, "id"),
        scope: textOrNull(row, "scope"),
        queue: text(row, "queue"),
        name: text(row, "name"),
        payload: row.payload,
        onceKey: text(row, "once_key"),
        attempt: Number(row.attempts),
        fence: Number(row.fence),
        resumeCount: Number(row.resume_count),
    }
    if (topic === null) return job
    const on = Array.isArray(row.notify_on) ? (row.notify_on as unknown[]).filter(isNotifyState) : []
    return { ...job, notify: { topic, on } }
}

/** Refuses an event with no scope, topic or type. */
const checkEvent = (event: PublishEvent): void => {
    const fields: readonly unknown[] = [event.scope, event.topic, event.type]
    if (fields.some((field) => typeof field !== "string" || field === "")) {
        throw new OutboxError({ code: OutboxErrorCode.EventInvalid, params: { scope: event.scope, topic: event.topic, type: event.type } })
    }
}

const parkedOf = (row: Row): ParkedJob => ({
    id: text(row, "id"),
    scope: textOrNull(row, "scope"),
    queue: text(row, "queue"),
    name: text(row, "name"),
    payload: row.payload,
    attempts: Number(row.attempts),
    reason: textOrNull(row, "last_error") ?? "",
    failureClass: failureClassOf(textOrNull(row, "failure_class")),
    why: row.park_reason === "exhausted" ? "exhausted" : "class",
    parkedAt: row.parked_at instanceof Date ? row.parked_at : new Date(text(row, "parked_at")),
    parkedBuild: textOrNull(row, "parked_build"),
    resumeCount: Number(row.resume_count),
})

/** The key of the advisory lock that guards the slots of one (queue, scope) of these tables. */
const slotLockKey = (tables: ResolvedTables, queue: string, scope: string): string =>
    `outbox:slots:${tables.bare.schema}.${tables.bare.slots}:${queue}:${scope}`

/** One running job of this worker: how to abort it, and its end. */
interface InFlight {
    readonly job: ClaimedJob
    readonly abort: AbortController
    readonly done: Promise<RunResult>
}

/**
 * The job outbox on Postgres: the write door (`enqueue` in the caller's transaction, `armTimer`), the worker (`start`, `stop`, `drain`,
 * and the steps `claim` and `run` they are made of) and the dead-letter doors (`parked`, `resume`, `close`). It knows no job of the app:
 * the app registers each handler with `handle`.
 */
export class Outbox {
    private readonly database: OutboxDatabase
    private readonly tables: ResolvedTables
    private readonly sql: Statements
    private readonly limits: Limits
    private readonly ladders: Readonly<Record<string, JobLadder>>
    private readonly concurrency: string
    private readonly classify: (cause: unknown) => FailureClass
    private readonly clock: Clock
    private readonly schedule: Schedule
    private readonly workerId: string
    private readonly handlers = new Map<string, JobHandler>()
    private readonly inFlight = new Set<InFlight>()
    private cancelTick: (() => void) | undefined
    private ticking: Promise<void> | undefined
    private running = false
    private lastTimerSweep = Number.NEGATIVE_INFINITY
    private lastResumeSweep = Number.NEGATIVE_INFINITY
    private lastEventSweep = Number.NEGATIVE_INFINITY
    private hub: EventHub | undefined

    private readonly options: OutboxOptions

    constructor(options: OutboxOptions) {
        this.options = options
        this.database = options.database
        this.tables = resolveTables(options)
        this.sql = statementsOf(this.tables)
        this.limits = limitsOf(options)
        this.ladders = options.ladders ?? DEFAULT_LADDERS
        for (const [queue, limit] of Object.entries(options.queueConcurrency ?? {})) positive(limit, 1, `queueConcurrency.${queue}`)
        this.concurrency = JSON.stringify(options.queueConcurrency ?? {})
        this.classify = options.classify ?? ((cause) => classifyFailure(cause, DomainError))
        this.clock = options.clock ?? systemClock
        this.schedule = options.schedule ?? realSchedule
        this.workerId = options.workerId ?? `${hostname()}:${String(process.pid)}:${randomBytes(4).toString("hex")}`
    }

    /* ------------------------------------------------------------------ the write door ------------------------------------------- */

    /**
     * Enqueues a job in the caller's transaction (`tx`: the TypeORM manager or the pg client of that transaction): it exists exactly when
     * the caller's change commits. A second enqueue under the same once key inserts nothing and answers the job that holds the key (`id`
     * is null in the rare case that job committed after the caller's snapshot).
     */
    async enqueue(tx: Queryable, job: EnqueueJob): Promise<Enqueued> {
        if (!job.onceKey.includes(":") || job.queue === "" || job.name === "") {
            throw new OutboxError({ code: OutboxErrorCode.JobInvalid, params: { onceKey: job.onceKey, queue: job.queue, name: job.name } })
        }
        const notify = job.notify
        if (notify !== undefined) {
            const on: readonly unknown[] = notify.on ?? NOTIFY_STATES
            if (job.scope === null || job.scope === "" || notify.topic === "" || on.length === 0 || !on.every(isNotifyState)) {
                throw new OutboxError({ code: OutboxErrorCode.EventInvalid, params: { scope: String(job.scope), topic: notify.topic, on: on.map(String).join(",") } })
            }
        }
        const notBefore = job.notBefore ?? this.clock.now()
        const rows = await run(tx, this.sql.enqueue, [
            job.scope,
            job.queue,
            job.name,
            JSON.stringify(job.payload),
            job.onceKey,
            notBefore,
            notify?.topic ?? null,
            notify === undefined ? null : [...new Set(notify.on ?? NOTIFY_STATES)],
        ])
        const row = rows[0]
        if (row !== undefined) return { id: text(row, "id"), created: row.created === true }
        const held = (await run(tx, this.sql.onceKeyId, [job.onceKey]))[0]
        return { id: held === undefined ? null : text(held, "id"), created: false }
    }

    /** Arms a timer in the caller's transaction; a pending timer of the same (scope, key) is moved to the new time, job and payload. */
    async armTimer(tx: Queryable, timer: ArmTimer): Promise<void> {
        if (timer.key === "") throw new OutboxError({ code: OutboxErrorCode.JobInvalid, params: { key: timer.key } })
        await run(tx, this.sql.armTimer, [
            timer.scope,
            timer.key,
            timer.dueAt,
            timer.queue ?? TIMER_QUEUE,
            timer.name ?? TIMER_FIRED_JOB,
            JSON.stringify(timer.payload),
        ])
    }

    /** Cancels the pending timer of this (scope, key) in the caller's transaction; true when there was one. */
    async cancelTimer(tx: Queryable, scope: string | null, key: string): Promise<boolean> {
        return count(await run(tx, this.sql.cancelTimer, [scope, key, this.clock.now()])) > 0
    }

    /** Cancels every pending timer of the scope whose key starts with the prefix; the count cancelled. */
    async cancelTimersByPrefix(tx: Queryable, scope: string | null, prefix: string): Promise<number> {
        return count(await run(tx, this.sql.cancelTimersByPrefix, [scope, prefix, this.clock.now()]))
    }

    /** Fires every due timer once, each into one job in the same statement; the count fired. */
    async sweepTimers(): Promise<number> {
        return count(await run(this.database, this.sql.sweepTimers, [this.clock.now(), TIMER_SWEEP_LIMIT]))
    }

    /* ------------------------------------------------------------------ events --------------------------------------------------- */

    /**
     * Publishes an event of a scope's topic in the caller's transaction (`tx`): it exists, and its subscribers hear of it, exactly when the
     * caller's change commits; a rollback leaves nothing and wakes nobody. The write takes the advisory lock of its scope until the commit,
     * so the events of one scope commit in seq order (a resume after a seq never skips one): publish last in the transaction, and a
     * transaction that publishes to several scopes publishes them in sorted order. Answers the event's seq.
     */
    async publish(tx: Queryable, event: PublishEvent): Promise<{ readonly seq: string }> {
        checkEvent(event)
        await run(tx, this.sql.lockEvents, [this.eventLockPrefix, event.scope])
        const row = (await run(tx, this.sql.publish, [event.scope, event.topic, event.type, JSON.stringify(event.data ?? {}), this.clock.now(), this.tables.channel]))[0]
        return { seq: row === undefined ? "0" : text(row, "seq") }
    }

    /**
     * Subscribes to one scope's topics through this process's one listening connection (`stream.listener`): the events after
     * `lastEventId` first, in order, then each event as its transaction commits. The scope is the caller's own, taken from its principal on
     * the server, never from the request. Answers the unsubscribe.
     */
    async subscribe(subscription: Subscription, handlers: SubscriptionHandlers): Promise<() => void> {
        return this.events().subscribe(subscription, handlers)
    }

    /**
     * Serves one Server-Sent Events stream of a scope's topics on a Node request and response (Express `req, res`; Fastify `req.raw,
     * reply.raw`): replay after `Last-Event-ID`, live events, a heartbeat, and a slow client dropped without holding the others. Each
     * frame's `id` is the event's seq and its data the JSON of the event, the frame `@starci/event-stream` resumes. A Nest controller is one
     * line: `return this.outbox.sse(req, res, { scope: principal.workspaceId, topics: ["jobs"] })`.
     */
    async sse(request: SseRequest, response: SseResponse, subscription: Subscription): Promise<void> {
        const hub = this.events()
        await serveSse((wanted, handlers) => hub.subscribe(wanted, handlers), request, response, subscription, this.limits.sse, (event, cause) => {
            this.report(event, cause)
        })
    }

    /** Deletes the events created before `before` (now less `eventRetentionMs` by default); the count deleted. The worker runs it every `eventSweepMs`. */
    async purgeEvents(before: Date = new Date(this.clock.now().getTime() - this.limits.eventRetentionMs)): Promise<number> {
        let total = 0
        for (let round = 0; round < MAX_EVENT_PURGE_ROUNDS; round += 1) {
            const deleted = count(await run(this.database, this.sql.purgeEvents, [before, EVENT_PURGE_BATCH]))
            total += deleted
            if (deleted < EVENT_PURGE_BATCH) break
        }
        return total
    }

    private get eventLockPrefix(): string {
        return `outbox:events:${this.tables.bare.schema}.${this.tables.bare.events}:`
    }

    private events(): EventHub {
        const listener = this.options.stream?.listener
        if (listener === undefined) throw new OutboxError({ code: OutboxErrorCode.StreamUnconfigured, params: { option: "stream.listener" } })
        this.hub ??= new EventHub({
            database: this.database,
            sql: this.sql,
            channel: this.tables.channel,
            scopeType: this.tables.scopeType,
            listener,
            reconnectMs: this.limits.reconnectMs,
            report: (event, cause, fields) => {
                this.report(event, cause, fields)
            },
        })
        return this.hub
    }

    /** Whether the job asked to publish this state change. */
    private wants(job: ClaimedJob, state: NotifyState): boolean {
        return job.notify !== undefined && job.scope !== null && job.notify.on.includes(state)
    }

    /** Publishes a state change of a job that asked for it, in `tx`. */
    private async notifyJob(tx: Queryable, job: ClaimedJob, state: NotifyState, extra: Readonly<Record<string, unknown>> = {}): Promise<void> {
        if (job.notify === undefined || job.scope === null || !this.wants(job, state)) return
        await this.publish(tx, {
            scope: job.scope,
            topic: job.notify.topic,
            type: `job.${state}`,
            data: { jobId: job.id, name: job.name, queue: job.queue, state, attempt: job.attempt, ...extra },
        })
    }

    /* ------------------------------------------------------------------ handlers ------------------------------------------------- */

    /** Registers the handler of one job name; a second handler of the name, or a ladder the outbox does not declare, is refused. */
    handle<P>(handler: JobHandler<P>): void {
        if (this.handlers.has(handler.name)) throw new OutboxError({ code: OutboxErrorCode.HandlerDuplicate, params: { name: handler.name } })
        const ladder = handler.ladder ?? "background"
        if (!Object.hasOwn(this.ladders, ladder)) throw new OutboxError({ code: OutboxErrorCode.LadderUnknown, params: { name: handler.name, ladder } })
        this.handlers.set(handler.name, handler)
    }

    /* ------------------------------------------------------------------ the claim ------------------------------------------------ */

    /**
     * Claims up to `limit` due jobs (`queued` past `not_before`, or `running` past its lease: a worker died) in one transaction, fairly:
     * the candidates of each (queue, scope) are ranked and capped by its free slots, so one busy scope cannot fill the batch. The rows are
     * locked `skip locked`; then the advisory lock of every (queue, scope) the claim meets is taken in ONE sorted order before any slot
     * is read or written, so two claimers that meet the same scopes in different row orders never wait on each other in a cycle. A job
     * takes a free slot (one it already names first) and turns `running` with a bumped fence and a new lease; a job with no free slot
     * stays as it was.
     */
    async claim(limit: number = this.limits.batch): Promise<readonly ClaimedJob[]> {
        const now = this.clock.now()
        const leaseUntil = new Date(now.getTime() + this.limits.leaseMs)
        return this.database.transaction(async (tx) => {
            const candidates = (await run(tx, this.sql.candidates, [now, this.concurrency, this.limits.defaultConcurrency, limit])).map((row) => text(row, "id"))
            if (candidates.length === 0) return []
            const due = (await run(tx, this.sql.lockDue, [candidates, now])).map((row) => ({
                id: text(row, "id"),
                scope: textOrNull(row, "scope"),
                queue: text(row, "queue"),
            }))
            if (due.length === 0) return []
            const order = new Map(candidates.map((id, index) => [id, index]))
            due.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
            const pairs = new Map<string, { readonly queue: string; readonly scope: string }>()
            for (const row of due) if (row.scope !== null) pairs.set(slotLockKey(this.tables, row.queue, row.scope), { queue: row.queue, scope: row.scope })
            const keys = [...pairs.keys()].sort()
            for (const key of keys) await run(tx, this.sql.lockSlot, [key])
            const held = new Map<string, Map<number, { readonly jobId: string | null; readonly leaseUntil: Date | null }>>()
            for (const key of keys) {
                const pair = pairs.get(key)
                if (pair === undefined) continue
                const slots = new Map<number, { readonly jobId: string | null; readonly leaseUntil: Date | null }>()
                for (const row of await run(tx, this.sql.slotsOf, [pair.queue, pair.scope])) {
                    slots.set(Number(row.slot), { jobId: textOrNull(row, "job_id"), leaseUntil: row.lease_until instanceof Date ? row.lease_until : null })
                }
                held.set(key, slots)
            }
            const started: string[] = []
            const taken: { readonly queue: string; readonly scope: string; readonly slot: number; readonly jobId: string }[] = []
            for (const row of due) {
                if (row.scope === null) {
                    started.push(row.id)
                    continue
                }
                const slots = held.get(slotLockKey(this.tables, row.queue, row.scope))
                if (slots === undefined) continue
                const slot = this.freeSlot(slots, row.queue, row.id, now)
                if (slot === undefined) continue
                slots.set(slot, { jobId: row.id, leaseUntil })
                taken.push({ queue: row.queue, scope: row.scope, slot, jobId: row.id })
                started.push(row.id)
            }
            if (started.length === 0) return []
            await run(tx, this.sql.freeSlotsOf, [started])
            for (const slot of taken) await run(tx, this.sql.takeSlot, [slot.queue, slot.scope, slot.slot, slot.jobId, leaseUntil])
            const rows = await run(tx, this.sql.start, [started, leaseUntil, this.workerId])
            const byId = new Map(rows.map((row) => [text(row, "id"), claimedOf(row)]))
            return started.flatMap((id) => {
                const job = byId.get(id)
                return job === undefined ? [] : [job]
            })
        })
    }

    /** The slot a job takes under the queue's limit: the one it already names, else the lowest free one; undefined when none is free. */
    private freeSlot(
        slots: ReadonlyMap<number, { readonly jobId: string | null; readonly leaseUntil: Date | null }>,
        queue: string,
        jobId: string,
        now: Date,
    ): number | undefined {
        const limit = this.options.queueConcurrency?.[queue] ?? this.limits.defaultConcurrency
        let free: number | undefined
        for (let slot = 0; slot < limit; slot += 1) {
            const holder = slots.get(slot)
            if (holder?.jobId === jobId) return slot
            const isFree = holder === undefined || holder.jobId === null || (holder.leaseUntil ?? now) < now
            if (isFree && free === undefined) free = slot
        }
        return free
    }

    /* ------------------------------------------------------------------ one start ------------------------------------------------ */

    /**
     * Runs one claimed job and settles it. The handler and the `done` mark of its job share ONE transaction, and the mark lands only while
     * the row still holds this claim's fence, so a worker that lost its lease commits nothing (`lost`). The lease is renewed every third of
     * it while the handler runs. A failure goes through the ladder of the handler: a timed requeue, or a park with one alert per episode.
     */
    async run(job: ClaimedJob, signal?: AbortSignal): Promise<RunResult> {
        const handler = this.handlers.get(job.name)
        if (handler === undefined) {
            return this.park(job, "class", "code", reasonOf(new OutboxError({ code: OutboxErrorCode.HandlerMissing, params: { name: job.name } })))
        }
        const ladder = this.ladders[handler.ladder ?? "background"] ?? { starts: 1, pausesSeconds: [] }
        if (isPastLadder(ladder, job.attempt)) {
            return this.park(job, "exhausted", "transient", "the start budget was spent by workers that died before settling")
        }
        if (handler.accepts !== undefined && !handler.accepts(job.payload)) {
            return this.park(job, "class", "input", reasonOf(new OutboxError({ code: OutboxErrorCode.PayloadRefused, params: { name: job.name } })))
        }
        const abort = new AbortController()
        const forward = (): void => {
            abort.abort(signal?.reason)
        }
        signal?.addEventListener("abort", forward, { once: true })
        const stopRenewing = this.keepLease(job, abort)
        try {
            if (this.wants(job, "claimed")) await this.database.transaction((tx) => this.notifyJob(tx, job, "claimed"))
            return await this.database.transaction(async (tx): Promise<RunResult> => {
                const context: JobContext = {
                    tx,
                    enqueue: (next) => this.enqueue(tx, next),
                    effectKey: (effect) => `${job.id}:${effect}`,
                    signal: abort.signal,
                }
                const answer = await handler.handle(job, context)
                const deferSeconds = deferralOf(answer)
                const now = this.clock.now()
                const settled =
                    deferSeconds === undefined
                        ? count(await run(tx, this.sql.done, [job.id, job.fence, now]))
                        : count(await run(tx, this.sql.requeue, [job.id, job.fence, new Date(now.getTime() + deferSeconds * SECOND), false, null, null]))
                if (settled !== 1) throw new OutboxError({ code: OutboxErrorCode.LeaseLost, params: { jobId: job.id } })
                if (deferSeconds !== undefined) return "deferred"
                await this.notifyJob(tx, job, "done")
                return "done"
            })
        } catch (cause) {
            if (cause instanceof OutboxError && cause.code === OutboxErrorCode.LeaseLost) return "lost"
            const failureClass = this.classify(cause)
            const verdict = ladderVerdictOf(ladder, job.attempt, failureClass === "transient")
            const reason = reasonOf(cause, this.options.redact)
            if (verdict.kind === "park") return await this.park(job, verdict.why, failureClass, reason)
            const notBefore = new Date(this.clock.now().getTime() + verdict.afterSeconds * SECOND)
            const requeue = [job.id, job.fence, notBefore, true, reason, failureClass]
            if (!this.wants(job, "failed")) return count(await run(this.database, this.sql.requeue, requeue)) === 1 ? "retried" : "lost"
            return await this.database.transaction(async (tx): Promise<RunResult> => {
                await run(tx, this.sql.lockEvents, [this.eventLockPrefix, job.scope])
                if (count(await run(tx, this.sql.requeue, requeue)) !== 1) return "lost"
                await this.notifyJob(tx, job, "failed", { failureClass, retryAt: notBefore.toISOString() })
                return "retried"
            })
        } finally {
            stopRenewing()
            signal?.removeEventListener("abort", forward)
        }
    }

    /** Renews the lease every third of it while the job runs; a renewal that finds the fence gone aborts the handler. Answers a stop. */
    private keepLease(job: ClaimedJob, abort: AbortController): () => void {
        let cancel: (() => void) | undefined
        let stopped = false
        const beat = (): void => {
            cancel = this.schedule(() => {
                const until = new Date(this.clock.now().getTime() + this.limits.leaseMs)
                void run(this.database, this.sql.renew, [job.id, job.fence, until])
                    .then((rows) => {
                        if (count(rows) === 1) {
                            if (!stopped) beat()
                            return
                        }
                        abort.abort(new OutboxError({ code: OutboxErrorCode.LeaseLost, params: { jobId: job.id } }))
                    })
                    .catch((cause: unknown) => {
                        this.report("lease-renew", cause, { jobId: job.id })
                        if (!stopped) beat()
                    })
            }, this.limits.renewMs)
        }
        beat()
        return () => {
            stopped = true
            cancel?.()
        }
    }

    /** Parks the job under its fence and tells the hook once per episode, after the park committed. */
    private async park(job: ClaimedJob, why: "class" | "exhausted", failureClass: FailureClass, reason: string): Promise<RunResult> {
        const now = this.clock.now()
        const parkWith = [job.id, job.fence, now, reason, failureClass, why, this.options.buildId ?? null]
        const rows = this.wants(job, "parked")
            ? await this.database.transaction(async (tx) => {
                  // The scope's event lock first, as every event write takes it, so the park and its event keep the scope's seq order.
                  await run(tx, this.sql.lockEvents, [this.eventLockPrefix, job.scope])
                  const parked = await run(tx, this.sql.park, parkWith)
                  if (parked.length > 0) await this.notifyJob(tx, job, "parked", { failureClass, why })
                  return parked
              })
            : await run(this.database, this.sql.park, parkWith)
        const row = rows[0]
        if (row === undefined) return "lost"
        if (row.alert === true && this.options.onParked !== undefined) {
            try {
                await this.options.onParked({
                    id: job.id,
                    scope: job.scope,
                    queue: job.queue,
                    name: job.name,
                    payload: job.payload,
                    attempts: job.attempt,
                    reason,
                    failureClass,
                    why,
                    parkedAt: now,
                    parkedBuild: this.options.buildId ?? null,
                    resumeCount: job.resumeCount,
                })
            } catch (cause) {
                this.report("parked-hook", cause, { jobId: job.id })
            }
        }
        return "parked"
    }

    /* ------------------------------------------------------------------ the worker ----------------------------------------------- */

    /**
     * Runs every due job now, the timers first, until nothing is due (bounded), awaiting each round; what a spec or a one-shot command
     * calls instead of the loop. Time comes from the clock option.
     */
    async drain(): Promise<DrainReport> {
        const report = { done: 0, deferred: 0, retried: 0, parked: 0, lost: 0, timersFired: 0 }
        for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
            const fired = await this.sweepTimers()
            report.timersFired += fired
            const claimed = await this.claim()
            if (claimed.length === 0 && fired === 0) break
            for (const result of await Promise.all(claimed.map((job) => this.runGuarded(job)))) report[result] += 1
        }
        return report
    }

    /** Starts the worker loop; when `buildId` is set it first hands back every job parked under another build. */
    start(): void {
        if (this.running) return
        this.running = true
        const build = this.options.buildId
        if (build === undefined) {
            this.next(0)
            return
        }
        void this.resumeAfterBuild(build)
            .catch((cause: unknown) => {
                this.report("resume-build", cause)
            })
            .finally(() => {
                this.next(0)
            })
    }

    /**
     * Stops the loop: no new claim; the running jobs get `graceMs` to settle, then each is aborted and its row handed back at once with
     * its start not spent (the row leaves `running`, so a handler that still finishes commits nothing). Then every event stream of this
     * process ends (its clients reconnect to another process and resume) and the listening connection closes.
     */
    async stop(graceMs: number = this.limits.shutdownGraceMs): Promise<void> {
        this.running = false
        this.cancelTick?.()
        this.cancelTick = undefined
        await this.ticking
        const ends = [...this.inFlight].map((flight) => flight.done)
        let cancelGrace: (() => void) | undefined
        const graceOver = new Promise<void>((resolve) => {
            cancelGrace = this.schedule(resolve, graceMs)
        })
        await Promise.race([Promise.allSettled(ends), graceOver])
        cancelGrace?.()
        const left = [...this.inFlight]
        // The rows go back first and the handlers are aborted after: a handler that fails on the abort then finds its row no longer running.
        await Promise.all(
            left.map(async (flight) => {
                try {
                    await run(this.database, this.sql.requeue, [flight.job.id, flight.job.fence, this.clock.now(), false, null, null])
                } catch (cause) {
                    this.report("shutdown-release", cause, { jobId: flight.job.id })
                }
            }),
        )
        for (const flight of left) flight.abort.abort(new OutboxError({ code: OutboxErrorCode.LeaseLost, params: { jobId: flight.job.id } }))
        await Promise.allSettled(left.map((flight) => flight.done))
        const hub = this.hub
        this.hub = undefined
        await hub?.close()
    }

    /** How many jobs this worker runs now. */
    get busy(): number {
        return this.inFlight.size
    }

    private next(afterMs: number): void {
        if (!this.running) return
        this.cancelTick = this.schedule(() => {
            this.ticking = this.tick()
        }, afterMs)
    }

    private async tick(): Promise<void> {
        let pause = this.limits.pollMs
        try {
            const now = this.clock.now().getTime()
            if (now - this.lastTimerSweep >= this.limits.timerSweepMs) {
                this.lastTimerSweep = now
                await this.sweepTimers()
            }
            if (now - this.lastResumeSweep >= this.limits.resumeSweepMs) {
                this.lastResumeSweep = now
                await this.resumeTransient()
            }
            if (now - this.lastEventSweep >= this.limits.eventSweepMs) {
                this.lastEventSweep = now
                await this.purgeEvents()
            }
            const room = this.limits.maxInFlight - this.inFlight.size
            if (room > 0 && this.running) {
                const claimed = await this.claim(Math.min(room, this.limits.batch))
                for (const job of claimed) this.track(job)
                if (claimed.length === Math.min(room, this.limits.batch)) pause = 0
            }
        } catch (cause) {
            this.report("tick", cause)
        }
        this.next(pause)
    }

    private track(job: ClaimedJob): void {
        const abort = new AbortController()
        const flight: InFlight = { job, abort, done: this.runGuarded(job, abort.signal) }
        this.inFlight.add(flight)
        void flight.done.finally(() => {
            this.inFlight.delete(flight)
            if (this.running) {
                this.cancelTick?.()
                this.next(0)
            }
        })
    }

    private async runGuarded(job: ClaimedJob, signal?: AbortSignal): Promise<RunResult> {
        try {
            return await this.run(job, signal)
        } catch (cause) {
            this.report("settle", cause, { jobId: job.id, name: job.name })
            return "lost"
        }
    }

    private report(event: string, cause: unknown, fields?: Readonly<Record<string, string>>): void {
        if (this.options.onError === undefined) warn(event, cause)
        else this.options.onError(event, cause, fields)
    }

    /* ------------------------------------------------------------------ dead letters --------------------------------------------- */

    /** The dead letters, oldest park first, of one scope or of all. */
    async parked(filter: { readonly scope?: string | null; readonly limit?: number } = {}): Promise<readonly ParkedJob[]> {
        return (await run(this.database, this.sql.parked, [filter.scope ?? null, filter.limit ?? RESUME_BATCH])).map(parkedOf)
    }

    /**
     * Hands one dead letter back from its first start; false when it is not parked. A person's resume opens a new episode (the next park
     * alerts again); the machine's keeps the episode.
     */
    async resume(jobId: string, by: ResumedBy = "person"): Promise<boolean> {
        return count(await run(this.database, this.sql.resumeOne, [this.clock.now(), by === "person", jobId])) === 1
    }

    /** Hands back every transient dead letter parked at least one sweep ago that the machine has handed back fewer than `autoResumes` times. */
    async resumeTransient(): Promise<number> {
        const now = this.clock.now()
        const cutoff = new Date(now.getTime() - this.limits.resumeSweepMs)
        return count(await run(this.database, this.sql.resumeTransient, [now, false, this.limits.autoResumes, cutoff, RESUME_BATCH]))
    }

    /** Hands back every dead letter of any class parked under another build than `build` (its cause may be fixed); the count. */
    async resumeAfterBuild(build: string): Promise<number> {
        let total = 0
        for (;;) {
            const moved = count(await run(this.database, this.sql.resumeBuild, [this.clock.now(), false, build, RESUME_BATCH]))
            total += moved
            if (moved < RESUME_BATCH) return total
        }
    }

    /** Ends one dead letter for good with a person's reason; false when it is not parked. */
    async close(jobId: string, reason: string): Promise<boolean> {
        return count(await run(this.database, this.sql.close, [jobId, reason.slice(0, 2000), this.clock.now()])) === 1
    }

    /** Deletes up to `limit` finished jobs (done or closed) and the fired or cancelled timers that ended before `before`; the jobs deleted. */
    async purge(before: Date, limit = 1000): Promise<number> {
        return count(await run(this.database, this.sql.purge, [before, limit]))
    }

    /** The jobs by queue and state. */
    async stats(): Promise<readonly { readonly queue: string; readonly state: string; readonly count: number }[]> {
        return (await run(this.database, this.sql.stats)).map((row) => ({ queue: text(row, "queue"), state: text(row, "state"), count: Number(row.n) }))
    }
}
