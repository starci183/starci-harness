import type { BULLMQ_JOB_SCHEMA, QueueHandler, QueueSchedulerDefinition } from "./queue.contracts"

/** A job the relay added: its queue and its id, the outbox row id. */
export interface QueuedJob {
    /** The queue the job was added to. */
    readonly queue: string
    /** The job id, which is the outbox row id. */
    readonly jobId: string
}

/** BullMQ as the queue capability sees it: the one port the BullMQ client implements. */
export interface QueueTransport {
    /** Adds the job to its queue with `jobId`; adding an id BullMQ already holds changes nothing, so a repeated relay pass is harmless. */
    add(queue: string, jobId: string, payload: object, correlationId: string): Promise<void>
    /**
     * Resolves once Redis has written the jobs to its append-only file and still holds each of them; it throws otherwise, so the
     * relay marks an outbox row sent only when its job survives a Redis crash.
     */
    persist(jobs: ReadonlyArray<QueuedJob>): Promise<void>
    /** Creates or updates a job scheduler by its id. */
    upsertScheduler(scheduler: QueueSchedulerDefinition): Promise<void>
    /** Starts a worker of the queue the handler names that runs it for every job, `concurrency` at a time. */
    work(handler: QueueHandler, concurrency: number): Promise<void>
    /** Resolves after `ms` milliseconds: the only clock of the relay loop. */
    wait(ms: number): Promise<void>
    /** Closes every queue and worker. */
    close(): Promise<void>
}

/** The Redis a driver object connects to. */
export interface BullmqRedis {
    /** The host. */
    readonly host: string
    /** The port. */
    readonly port: number
    /** The Redis database that holds this app's queue state. */
    readonly db: number
    /** The password of the declared Redis; absent for a local Redis without auth. */
    readonly password?: string
    /** BullMQ answers to commands only through a client that does not retry on its own. */
    readonly maxRetriesPerRequest: number | null
}

/** The Redis options every queue and worker of the app shares. */
export interface BullmqConnection {
    /** The key prefix of the app. */
    readonly prefix: string
    /** The Redis the driver connects to. */
    readonly connection: BullmqRedis
}

/** The options a worker is built with: the shared connection plus its concurrency. */
export interface BullmqWorkerOptions extends BullmqConnection {
    /** How many jobs the worker runs at a time. */
    readonly concurrency: number
}

/** The wait between two tries of a job. */
export interface BullmqBackoff {
    /** The backoff shape. */
    readonly type: string
    /** The first wait, in milliseconds. */
    readonly delay: number
}

/** How long a finished job is kept. */
export interface BullmqRetention {
    /** The seconds a finished job is kept. */
    readonly age: number
}

/** The options the transport fixes on every job it adds. */
export interface BullmqJobOptions {
    /** The id BullMQ dedupes on: the outbox row id. */
    readonly jobId: string
    /** How many times BullMQ tries the job. */
    readonly attempts: number
    /** The wait between two tries. */
    readonly backoff: BullmqBackoff
    /** How long a finished job is kept. */
    readonly removeOnComplete: BullmqRetention
}

/** The options a scheduler fixes on the jobs it fires. */
export interface BullmqSchedulerJobOptions {
    /** How many times BullMQ tries the tick. */
    readonly attempts: number
}

/** The job a scheduler fires. */
export interface BullmqJobTemplate {
    /** The job name, which is the queue name. */
    readonly name: string
    /** The payload of every tick. */
    readonly data: BullmqJobData
    /** The options of every tick. */
    readonly opts: BullmqSchedulerJobOptions
}

/** A Redis connection that sends a raw command: BullMQ's ioredis client forwards `call` to ioredis. */
export interface BullmqCommands {
    /** Sends one command with its arguments and answers its reply. */
    call(command: string, ...args: Array<string | number>): Promise<unknown>
}

/** The Redis backend of a queue: it owns the connection the queue adds its jobs through. */
export interface BullmqBackend {
    /** The connection the queue adds its jobs through; BullMQ types it without its raw `call`. */
    readonly client: Promise<object>
}

/** A BullMQ driver whose infrastructure failures must use the application logger. */
export interface BullmqErrorSource {
    /** Subscribes before asynchronous driver errors can fall back to the driver's raw console. */
    on(event: "error", listener: (cause: Error) => void): unknown
}

/** A queue as the transport uses it. */
export interface BullmqQueue extends BullmqErrorSource {
    /** The Redis backend of the queue. */
    getBackend(): BullmqBackend
    /** Adds the job; an id BullMQ already holds makes the add a no-op. */
    add(name: string, payload: BullmqJobData, options: BullmqJobOptions): Promise<unknown>
    /** The state of the job, `unknown` when Redis does not hold it. */
    getJobState(jobId: string): Promise<string>
    /** Creates or updates the scheduler by its id. */
    upsertJobScheduler(id: string, repeat: { readonly every: number }, template: BullmqJobTemplate): Promise<unknown>
    /** Closes the queue. */
    close(): Promise<void>
}

/** A job as a worker receives it: the fields the transport translates into a QueueDelivery. */
export interface BullmqJob {
    /** The job id; a tick the scheduler fires can have none. */
    readonly id?: string
    /** Stored data is untrusted: queued jobs can also carry the raw payload written before envelopes. */
    readonly data: unknown
    /** How many deliveries were started before this one. */
    readonly attemptsMade: number
}

/** The durable job data: an enqueued job propagates its id; a scheduler starts a new root per tick. */
export type BullmqJobData = {
    /** Distinguishes infrastructure envelopes from arbitrary raw payload fields. */
    readonly schema: typeof BULLMQ_JOB_SCHEMA
} & (
    | { readonly kind: "enqueued"; readonly correlationId: string; readonly payload: object }
    | { readonly kind: "scheduled"; readonly payload: object }
)

/** A worker as the transport uses it. */
export interface BullmqWorker extends BullmqErrorSource {
    /** Stops the worker; `force` drops the jobs it is still running. */
    close(force?: boolean): Promise<void>
}

/** Builds the BullMQ objects; the module provides it so a spec can double it through the injection token. */
export interface QueueFactory {
    /** The queue of the name over the shared connection. */
    queue(name: string, options: BullmqConnection): BullmqQueue
    /** A worker that runs the processor for every job of the queue. */
    worker(name: string, processor: (job: BullmqJob) => Promise<void>, options: BullmqWorkerOptions): BullmqWorker
}
