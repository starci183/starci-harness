import { Test } from "@nestjs/testing"
import { fakeIds, mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { IDS } from "@modules/platform/ids"
import { QueueErrorCode } from "./errors/queue.error"
import { BullmqQueueTransportClient } from "./bullmq-queue-transport.client"
import { BULLMQ_JOB_SCHEMA } from "./queue.contracts"
import type { QueueHandler } from "./queue.contracts"
import { QUEUE_FACTORY, QUEUE_OPTIONS } from "./queue.decorators"
import { QueueLogEvent } from "./queue.log-events"
import type { QueueOptions } from "./queue.options"
import { ATTEMPTS, BACKOFF_MS, KEEP_COMPLETED_SECONDS } from "./queue.policy"
import type { BullmqJob, BullmqQueue, BullmqWorker, QueueFactory } from "./queue-transport.port"

const MINTED_ID = "00000000-0000-4000-8000-000000000001"

const options: QueueOptions = {
    redisHost: "redis.test",
    redisPort: 6380,
    redisDb: 7,
    prefix: "spec.",
    relayIntervalMs: 100,
    relayBatch: 50,
    concurrency: 4,
    connections: [],
    schedulers: [],
}

const build = async () => {
    const queue = mock<BullmqQueue>()
    const worker = mock<BullmqWorker>()
    const factory = mock<QueueFactory>()
    const ids = fakeIds()
    const logger = mock<Logger>()
    factory.queue.mockReturnValue(queue)
    factory.worker.mockReturnValue(worker)
    const moduleRef = await Test.createTestingModule({
        providers: [
            BullmqQueueTransportClient,
            { provide: QUEUE_OPTIONS, useValue: options },
            { provide: QUEUE_FACTORY, useValue: factory },
            { provide: IDS, useValue: ids },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { client: moduleRef.get(BullmqQueueTransportClient), queue, worker, factory, logger, ids }
}

describe("BullmqQueueTransportClient jobs and schedulers", () => {
    it("adds idempotent jobs with the queue retry and retention policy", async () => {
        const { client, queue, factory } = await build()
        const payload = { orderId: "order-1" }

        await client.add("orders", "outbox-1", payload, "request-1")
        await client.add("orders", "outbox-2", payload, "request-2")

        expect(factory.queue).toHaveBeenCalledTimes(1)
        expect(factory.queue).toHaveBeenCalledWith("orders", {
            prefix: "spec.",
            connection: { host: "redis.test", port: 6380, db: 7, maxRetriesPerRequest: null },
        })
        expect(queue.add).toHaveBeenNthCalledWith(
            1,
            "orders",
            { schema: BULLMQ_JOB_SCHEMA, kind: "enqueued", payload, correlationId: "request-1" },
            {
                jobId: "outbox-1",
                attempts: ATTEMPTS,
                backoff: { type: "exponential", delay: BACKOFF_MS },
                removeOnComplete: { age: KEEP_COMPLETED_SECONDS },
            },
        )
    })

    it("rejects unsafe correlation before writing a new job", async () => {
        const { client, factory } = await build()

        await expect(client.add("orders", "outbox-1", {}, "unsafe\nrequest")).rejects.toMatchObject({
            code: QueueErrorCode.CorrelationInvalid,
        })
        expect(factory.queue).not.toHaveBeenCalled()
    })

    it("upserts schedulers with their payload or an empty payload", async () => {
        const { client, queue } = await build()

        await client.upsertScheduler({ queue: "billing", id: "settlement", everyMs: 60_000, payload: { shard: 2 } })
        await client.upsertScheduler({ queue: "billing", id: "cleanup", everyMs: 120_000 })

        expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
            1,
            "settlement",
            { every: 60_000 },
            {
                name: "billing",
                data: { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: { shard: 2 } },
                opts: { attempts: ATTEMPTS },
            },
        )
        expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
            2,
            "cleanup",
            { every: 120_000 },
            {
                name: "billing",
                data: { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: {} },
                opts: { attempts: ATTEMPTS },
            },
        )
    })
})

describe("BullmqQueueTransportClient worker deliveries", () => {
    it("starts a worker that translates BullMQ jobs into queue deliveries", async () => {
        const { client, factory } = await build()
        const handler = mock<QueueHandler>({ queue: "orders" })
        handler.handle.mockResolvedValue(undefined)

        await client.work(handler, 3)

        expect(factory.worker).toHaveBeenCalledWith("orders", expect.any(Function), {
            prefix: "spec.",
            connection: { host: "redis.test", port: 6380, db: 7, maxRetriesPerRequest: null },
            concurrency: 3,
        })
        const processor = factory.worker.mock.calls[0]?.[1]
        await processor?.(
            mock<BullmqJob>({
                id: "job-1",
                data: {
                    schema: BULLMQ_JOB_SCHEMA,
                    kind: "enqueued",
                    payload: { orderId: "order-1" },
                    correlationId: "request-1",
                },
                attemptsMade: 2,
            }),
        )
        await processor?.({
            data: { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: { orderId: "order-2" } },
            attemptsMade: 0,
        } satisfies BullmqJob)
        await processor?.({
            id: "tick-3",
            data: { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: {} },
            attemptsMade: 1,
        } satisfies BullmqJob)

        expect(handler.handle).toHaveBeenNthCalledWith(1, {
            id: "job-1",
            correlationId: "request-1",
            queue: "orders",
            payload: { orderId: "order-1" },
            attempt: 3,
        })
        expect(handler.handle).toHaveBeenNthCalledWith(2, {
            id: "",
            correlationId: MINTED_ID,
            queue: "orders",
            payload: { orderId: "order-2" },
            attempt: 1,
        })
        expect(handler.handle).toHaveBeenNthCalledWith(3, {
            id: "tick-3",
            correlationId: "tick-3",
            queue: "orders",
            payload: {},
            attempt: 2,
        })
    })
})

describe("BullmqQueueTransportClient stored job upgrades", () => {
    it("preserves raw payloads and the same job correlation through legacy retries", async () => {
        const { client, factory, ids } = await build()
        const handler = mock<QueueHandler>({ queue: "orders" })
        await client.work(handler, 3)
        const processor = factory.worker.mock.calls[0]?.[1]
        const payload = { orderId: "before-upgrade", kind: "expire-order", payload: { reason: "unpaid" } }

        await processor?.({ id: "legacy-job", data: payload, attemptsMade: 0 })
        await processor?.({ id: "legacy-job", data: payload, attemptsMade: 1 })

        expect(handler.handle).toHaveBeenNthCalledWith(1, {
            id: "legacy-job",
            queue: "orders",
            payload,
            correlationId: "legacy-job",
            attempt: 1,
        })
        expect(handler.handle).toHaveBeenNthCalledWith(2, {
            id: "legacy-job",
            queue: "orders",
            payload,
            correlationId: "legacy-job",
            attempt: 2,
        })
        expect(ids.issued).toEqual([])
    })

    it.each(["enqueued", "scheduled"])("keeps legacy business fields even when kind is %s", async (kind) => {
        const { client, factory, ids } = await build()
        const handler = mock<QueueHandler>({ queue: "orders" })
        await client.work(handler, 3)
        const processor = factory.worker.mock.calls[0]?.[1]
        const payload = {
            schema: "order/business@1",
            kind,
            correlationId: "business\nkey",
            payload: { orderId: "legacy-order" },
        }

        await processor?.({ id: "legacy-collision", data: payload, attemptsMade: 0 })

        expect(handler.handle).toHaveBeenCalledWith({
            id: "legacy-collision",
            queue: "orders",
            payload,
            correlationId: "legacy-collision",
            attempt: 1,
        })
        expect(ids.issued).toEqual([])
    })
})

describe("BullmqQueueTransportClient correlation roots and marked envelopes", () => {
    it("mints only when legacy data has no job id and accepts explicit scheduled correlation", async () => {
        const { client, factory, ids } = await build()
        const handler = mock<QueueHandler>({ queue: "orders" })
        await client.work(handler, 3)
        const processor = factory.worker.mock.calls[0]?.[1]

        await processor?.({ data: { orderId: "legacy-no-id" }, attemptsMade: 0 })
        await processor?.({
            data: { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: {}, correlationId: "upstream-tick" },
            attemptsMade: 0,
        })

        expect(handler.handle.mock.calls.map(([delivery]) => delivery.correlationId)).toEqual([
            MINTED_ID,
            "upstream-tick",
        ])
        expect(ids.issued).toEqual([MINTED_ID])
    })

    it.each<unknown>([
        null,
        { schema: "starci/queue@2", kind: "enqueued", payload: {}, correlationId: "request-1" },
        { schema: BULLMQ_JOB_SCHEMA, kind: "unknown", payload: {} },
        { schema: BULLMQ_JOB_SCHEMA, kind: "enqueued", payload: {}, correlationId: undefined },
        { schema: BULLMQ_JOB_SCHEMA, kind: "enqueued", payload: null, correlationId: "request-1" },
        { schema: BULLMQ_JOB_SCHEMA, kind: "enqueued", payload: {}, correlationId: "bad\nidentity" },
        { schema: BULLMQ_JOB_SCHEMA, kind: "scheduled", payload: {}, correlationId: undefined },
    ])("rejects malformed current data before business delivery (%j)", async (data) => {
        const { client, factory } = await build()
        const handler = mock<QueueHandler>({ queue: "orders" })
        await client.work(handler, 3)
        const processor = factory.worker.mock.calls[0]?.[1]

        await expect(processor?.({ id: "stored-job", data, attemptsMade: 0 })).rejects.toMatchObject({
            code: QueueErrorCode.MalformedMessage,
        })
        expect(handler.handle).not.toHaveBeenCalled()
    })
})

describe("BullmqQueueTransportClient driver errors", () => {
    it("routes queue driver errors through the logger once per queue", async () => {
        const { client, queue, logger } = await build()
        await client.add("orders", "outbox-1", {}, "request-1")
        await client.add("orders", "outbox-2", {}, "request-2")
        const cause = new Error("redis connection lost")

        const listener = queue.on.mock.calls[0]?.[1]
        listener?.(cause)

        expect(queue.on).toHaveBeenCalledTimes(1)
        expect(queue.on).toHaveBeenCalledWith("error", expect.any(Function))
        expect(logger.error).toHaveBeenCalledWith(QueueLogEvent.QueueFailed, cause, { queue: "orders" })
    })

    it("routes worker driver errors through the logger", async () => {
        const { client, worker, logger } = await build()
        await client.work(mock<QueueHandler>({ queue: "orders" }), 3)
        const cause = new Error("blocking redis connection lost")

        const listener = worker.on.mock.calls[0]?.[1]
        listener?.(cause)

        expect(worker.on).toHaveBeenCalledWith("error", expect.any(Function))
        expect(logger.error).toHaveBeenCalledWith(QueueLogEvent.WorkerFailed, cause, { queue: "orders" })
    })
})

describe("BullmqQueueTransportClient wait and shutdown", () => {
    it("waits for the requested delay", async () => {
        jest.useFakeTimers()
        try {
            const { client } = await build()

            const waiting = client.wait(250)
            await jest.advanceTimersByTimeAsync(250)

            await expect(waiting).resolves.toBeUndefined()
        } finally {
            jest.useRealTimers()
        }
    })

    it("closes workers before queues", async () => {
        const { client, queue, worker } = await build()
        const handler = mock<QueueHandler>({ queue: "orders" })
        let finishWorkerClose: (() => void) | undefined
        worker.close.mockReturnValue(
            new Promise((resolve) => {
                finishWorkerClose = resolve
            }),
        )
        await client.add("orders", "outbox-1", {}, "request-1")
        await client.work(handler, 3)

        const closing = client.close()

        expect(worker.close).toHaveBeenCalledWith(true)
        expect(queue.close).not.toHaveBeenCalled()
        finishWorkerClose?.()
        await closing
        expect(queue.close).toHaveBeenCalledTimes(1)
    })
})
