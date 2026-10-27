import { Injectable } from "@nestjs/common"
import { eachInOrder, isRecord } from "@modules/platform/primitives"
import { InjectLogger, isCorrelationId } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { InjectIds } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { QueueError, QueueErrorCode } from "./errors/queue.error"
import { InjectQueueFactory, InjectQueueOptions } from "./queue.decorators"
import { BULLMQ_JOB_SCHEMA } from "./queue.contracts"
import type { QueueDelivery, QueueHandler, QueueSchedulerDefinition } from "./queue.contracts"
import { QueueLogEvent } from "./queue.log-events"
import type { QueueOptions } from "./queue.options"
import { ATTEMPTS, BACKOFF_MS, KEEP_COMPLETED_SECONDS, jobNameOf } from "./queue.policy"
import type {
    BullmqCommands,
    BullmqConnection,
    BullmqJob,
    BullmqQueue,
    BullmqWorker,
    QueuedJob,
    QueueFactory,
    QueueTransport,
} from "./queue-transport.port"

/** How long the relay waits for Redis to write its jobs to the append-only file; `appendfsync everysec` writes within a second. */
const PERSIST_TIMEOUT_MS = 5000

/** A WAITAOF reply that counts the local append-only file among the writes it waited for. */
const writtenLocally = (reply: unknown): boolean => Array.isArray(reply) && Number(reply.at(0)) >= 1

/** True for a connection that sends a raw command. */
const sendsCommands = (client: object): client is BullmqCommands =>
    "call" in client && typeof client.call === "function"

@Injectable()
/** The QueueTransport port over the declared Redis the app names in its options; the BullMQ objects come from the injected factory the module composes. */
export class BullmqQueueTransportClient implements QueueTransport {
    private readonly queues = new Map<string, BullmqQueue>()
    private readonly workers: Array<BullmqWorker> = []

    constructor(
        @InjectQueueOptions() private readonly options: QueueOptions,
        @InjectQueueFactory() private readonly factory: QueueFactory,
        @InjectIds() private readonly ids: Ids,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Adds the job with the outbox row id as its BullMQ id, so adding it twice leaves one job. */
    async add(queue: string, jobId: string, payload: object, correlationId: string): Promise<void> {
        if (!isCorrelationId(correlationId)) throw new QueueError({ code: QueueErrorCode.CorrelationInvalid })
        await this.queueOf(queue).add(
            jobNameOf(queue),
            { schema: BULLMQ_JOB_SCHEMA, kind: "enqueued", payload, correlationId },
            {
                jobId,
                attempts: ATTEMPTS,
                backoff: { type: "exponential", delay: BACKOFF_MS },
                removeOnComplete: { age: KEEP_COMPLETED_SECONDS },
            },
        )
    }

    /**
     * Waits until Redis has written each queue's jobs to its append-only file, then checks it still holds every job: a Redis that
     * restarted meanwhile answers the wait at once on its new connection, and only a job it reloaded from the file is still there.
     */
    async persist(jobs: ReadonlyArray<QueuedJob>): Promise<void> {
        await eachInOrder([...new Set(jobs.map((job) => job.queue))], async (queue) => {
            const client = await this.queueOf(queue).getBackend().client
            const written =
                sendsCommands(client) && writtenLocally(await client.call("WAITAOF", 1, 0, PERSIST_TIMEOUT_MS))
            if (!written) throw new QueueError({ code: QueueErrorCode.NotPersisted, params: { queue } })
        })
        await eachInOrder(jobs, async (job) => {
            if ((await this.queueOf(job.queue).getJobState(job.jobId)) === "unknown")
                throw new QueueError({ code: QueueErrorCode.JobLost, params: { queue: job.queue, jobId: job.jobId } })
        })
    }

    /** Creates or updates the scheduler; BullMQ keeps one per id however many replicas call this. */
    async upsertScheduler(scheduler: QueueSchedulerDefinition): Promise<void> {
        await this.queueOf(scheduler.queue).upsertJobScheduler(
            scheduler.id,
            { every: scheduler.everyMs },
            {
                name: jobNameOf(scheduler.queue),
                data: { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: scheduler.payload ?? {} },
                opts: { attempts: ATTEMPTS },
            },
        )
    }

    /** Starts a worker of the queue. */
    work(handler: QueueHandler, concurrency: number): Promise<void> {
        const worker = this.factory.worker(
            handler.queue,
            async (job) => {
                await handler.handle(this.deliveryOf(handler.queue, job))
            },
            { ...this.connection(), concurrency },
        )
        worker.on("error", (cause) => this.logger.error(QueueLogEvent.WorkerFailed, cause, { queue: handler.queue }))
        this.workers.push(worker)
        return Promise.resolve()
    }

    /** Resolves after `ms` milliseconds. */
    wait(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    /** Closes the workers first, then the queues. */
    async close(): Promise<void> {
        await Promise.all(this.workers.map((worker) => worker.close(true)))
        await Promise.all([...this.queues.values()].map((queue) => queue.close()))
    }

    /** Reads current envelopes and stored raw payloads without changing the identity of a retried job. */
    private deliveryOf(queue: string, job: BullmqJob): QueueDelivery {
        const data = job.data
        if (!isRecord(data)) throw new QueueError({ code: QueueErrorCode.MalformedMessage })
        let payload: object = data
        let correlationId = job.id
        const schema = data.schema
        const schemaPrefix = BULLMQ_JOB_SCHEMA.slice(0, BULLMQ_JOB_SCHEMA.lastIndexOf("@") + 1)
        if (typeof schema === "string" && schema.startsWith(schemaPrefix)) {
            if (
                schema !== BULLMQ_JOB_SCHEMA ||
                (data.kind !== "enqueued" && data.kind !== "scheduled") ||
                !isRecord(data.payload)
            ) {
                throw new QueueError({ code: QueueErrorCode.MalformedMessage })
            }
            payload = data.payload
            if (data.kind === "enqueued" || "correlationId" in data) {
                if (!isCorrelationId(data.correlationId)) {
                    throw new QueueError({ code: QueueErrorCode.MalformedMessage })
                }
                correlationId = data.correlationId
            }
        }
        return {
            id: job.id ?? "",
            queue,
            correlationId: correlationId ?? this.ids.next(),
            payload,
            attempt: job.attemptsMade + 1,
        }
    }

    private connection(): BullmqConnection {
        return {
            prefix: this.options.prefix,
            connection: {
                host: this.options.redisHost,
                port: this.options.redisPort,
                db: this.options.redisDb,
                ...(this.options.redisPassword === undefined ? {} : { password: this.options.redisPassword.reveal() }),
                maxRetriesPerRequest: null,
            },
        }
    }

    private queueOf(name: string): BullmqQueue {
        const known = this.queues.get(name)
        if (known !== undefined) return known
        const created = this.factory.queue(name, this.connection())
        created.on("error", (cause) => this.logger.error(QueueLogEvent.QueueFailed, cause, { queue: name }))
        this.queues.set(name, created)
        return created
    }
}
