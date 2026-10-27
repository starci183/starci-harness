import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { CORRELATION_RUNNER, LOGGER } from "@modules/platform/logging"
import type { CorrelationRunner, Logger } from "@modules/platform/logging"
import type { QueueHandler } from "./queue.contracts"
import { QUEUE_OPTIONS, QUEUE_TRANSPORT } from "./queue.decorators"
import { QueueLogEvent } from "./queue.log-events"
import type { QueueOptions } from "./queue.options"
import type { QueueTransport } from "./queue-transport.port"
import { QueueWorkerService } from "./queue-worker.service"

const options: QueueOptions = {
    redisHost: "localhost",
    redisPort: 6379,
    redisDb: 0,
    prefix: "test",
    relayIntervalMs: 100,
    relayBatch: 2,
    concurrency: 3,
    connections: [],
    schedulers: [{ queue: "sweep", id: "sweep-every-minute", everyMs: 60000 }],
}

const handlerOf = (queue: string): QueueHandler => ({ queue, handle: () => Promise.resolve() })

const build = async () => {
    const transport = mock<QueueTransport>()
    transport.upsertScheduler.mockResolvedValue(undefined)
    const logger = mock<Logger>()
    const correlation = mock<CorrelationRunner>()
    correlation.run.mockImplementation((_id, work) => work())
    const moduleRef = await Test.createTestingModule({
        providers: [
            QueueWorkerService,
            { provide: QUEUE_OPTIONS, useValue: options },
            { provide: QUEUE_TRANSPORT, useValue: transport },
            { provide: LOGGER, useValue: logger },
            { provide: CORRELATION_RUNNER, useValue: correlation },
        ],
    }).compile()
    return { workers: moduleRef.get(QueueWorkerService), transport, logger, correlation }
}

describe("QueueWorkerService", () => {
    describe("onApplicationBootstrap", () => {
        it("starts one worker per registered queue with the configured concurrency and registers the schedulers", async () => {
            const { workers, transport } = await build()
            const mailHandler = handlerOf("mail")
            const sweepHandler = handlerOf("sweep")
            workers.add(mailHandler)
            workers.add(sweepHandler)

            await workers.onApplicationBootstrap()

            expect(transport.work).toHaveBeenCalledWith(expect.objectContaining({ queue: "mail" }), 3)
            expect(transport.work).toHaveBeenCalledWith(expect.objectContaining({ queue: "sweep" }), 3)
            expect(transport.upsertScheduler).toHaveBeenCalledWith(options.schedulers[0])
        })

        it("keeps the last handler registered for a queue", async () => {
            const { workers, transport } = await build()
            const first = mock<QueueHandler>({ queue: "mail" })
            const second = mock<QueueHandler>({ queue: "mail" })
            second.handle.mockResolvedValue(undefined)
            workers.add(first)
            workers.add(second)

            await workers.onApplicationBootstrap()

            expect(transport.work).toHaveBeenCalledTimes(1)
            const delivery = { id: "job-1", queue: "mail", payload: {}, attempt: 1, correlationId: "request-1" }
            await transport.work.mock.calls[0]?.[0].handle(delivery)
            expect(second.handle).toHaveBeenCalledWith(delivery)
            expect(first.handle).not.toHaveBeenCalled()
        })

        it("runs each delivery within its explicitly carried logging context", async () => {
            const { workers, transport, correlation } = await build()
            const handler = mock<QueueHandler>({ queue: "mail" })
            handler.handle.mockResolvedValue(undefined)
            workers.add(handler)
            await workers.onApplicationBootstrap()
            const delivery = { id: "job-1", queue: "mail", payload: {}, attempt: 2, correlationId: "request-1" }

            await transport.work.mock.calls[0]?.[0].handle(delivery)

            expect(correlation.run).toHaveBeenCalledWith("request-1", expect.any(Function))
            expect(handler.handle).toHaveBeenCalledWith(delivery)
        })

        it("logs a scheduler that cannot be registered and still starts the app", async () => {
            const { workers, transport, logger } = await build()
            const failure = new Error("redis down")
            transport.upsertScheduler.mockRejectedValue(failure)

            await expect(workers.onApplicationBootstrap()).resolves.toBeUndefined()

            expect(logger.error).toHaveBeenCalledWith(QueueLogEvent.SchedulerFailed, failure, {
                scheduler: "sweep-every-minute",
            })
        })
    })

    describe("onApplicationShutdown", () => {
        it("closes the workers and the queues", async () => {
            const { workers, transport } = await build()

            await workers.onApplicationShutdown()

            expect(transport.close).toHaveBeenCalledTimes(1)
        })
    })
})
