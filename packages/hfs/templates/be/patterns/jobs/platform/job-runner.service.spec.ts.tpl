import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { FencedProcessor } from "./fenced.processor"
import type { ClaimedJob } from "./jobs.contracts"
import { FLOW_ALERTS, JOB_CLAIMS, JOBS_OPTIONS } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import type { FlowAlerts, JobClaims } from "./jobs.port"
import { JobRunnerService } from "./job-runner.service"

const options: JobsOptions = { connection: "primary", workerId: "w-1", leaseMs: 60000, build: "b-2" }
const delivery: QueueDelivery = { correlationId: "request-1", id: "k-1", queue: "mail", payload: { id: "m-1" }, attempt: 1 }
const job: ClaimedJob = { correlationId: "request-1", jobId: "j-1", kind: "mail", fencingToken: 2, currentStep: null, payload: { id: "m-1" } }
const transient = (): Error => Object.assign(new Error("provider down"), { code: "ECONNRESET" })
const fenced = (): JobsError => new JobsError({ code: JobsErrorCode.FencedOut, params: { jobId: "j-1", token: 2 } })

const build = async () => {
    const claims = mock<JobClaims>()
    claims.fail.mockResolvedValue(undefined)
    claims.park.mockResolvedValue({ alertDue: true })
    const alerts = mock<FlowAlerts>()
    alerts.raise.mockResolvedValue(undefined)
    const queues = mock<QueueWorkerRegistry>()
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobRunnerService,
            { provide: JOBS_OPTIONS, useValue: options },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: QUEUE_WORKER_REGISTRY, useValue: queues },
            { provide: FLOW_ALERTS, useValue: alerts },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return {
        runner: moduleRef.get(JobRunnerService),
        claims,
        alerts,
        queues,
        logger,
        processor: mock<FencedProcessor>({ queue: "mail" }),
    }
}

describe("JobRunnerService", () => {
    describe("add", () => {
        it("subscribes the processor to its queue, and the handler runs a delivery through the fence", async () => {
            const { runner, claims, queues, processor } = await build()
            claims.claim.mockResolvedValue(job)
            runner.add(processor)
            const handler = queues.add.mock.calls[0]?.[0]

            await handler?.handle(delivery)

            expect(handler?.queue).toBe("mail")
            expect(processor.process).toHaveBeenCalledWith(job)
        })
    })

    describe("run", () => {
        it("claims the delivery with the job key and the lease, processes it and completes it under the claimed token", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)

            await runner.run(processor, delivery)

            expect(claims.claim).toHaveBeenCalledWith({
                kind: "mail",
                jobKey: "k-1",
                correlationId: "request-1",
                payload: { id: "m-1" },
                workerId: "w-1",
                leaseMs: 60000,
            })
            expect(processor.process).toHaveBeenCalledWith(job)
            expect(claims.complete).toHaveBeenCalledWith({ jobId: "j-1", expectedFencingToken: 2 })
            expect(claims.fail).not.toHaveBeenCalled()
        })

        it("retains the original request correlation when a retry claims a newer fence", async () => {
            const { runner, claims, processor } = await build()
            const failure = transient()
            claims.claim.mockResolvedValueOnce(job).mockResolvedValueOnce({ ...job, fencingToken: 3 })
            processor.process.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)

            await expect(runner.run(processor, delivery)).rejects.toBe(failure)
            await runner.run(processor, { ...delivery, attempt: 2 })

            expect(processor.process.mock.calls.map(([claimed]) => claimed.correlationId)).toEqual([
                "request-1",
                "request-1",
            ])
            expect(processor.process.mock.calls.map(([claimed]) => claimed.fencingToken)).toEqual([2, 3])
            expect(claims.complete).toHaveBeenCalledWith({ jobId: "j-1", expectedFencingToken: 3 })
        })

        it("does nothing when the job is done or another worker holds a live claim", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(null)

            await runner.run(processor, delivery)

            expect(processor.process).not.toHaveBeenCalled()
            expect(claims.complete).not.toHaveBeenCalled()
        })

        it("stops quietly when a write is fenced out: a newer worker owns the job and this one causes no further effect", async () => {
            const { runner, claims, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            claims.complete.mockRejectedValue(fenced())

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.FencedOut, { jobId: "j-1" })
            expect(claims.fail).not.toHaveBeenCalled()
        })

        it("claims a resumed delivery under the job key it was first delivered with", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)

            await runner.run(processor, { ...delivery, id: "k-1-r2" })

            expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ jobKey: "k-1" }))
        })

        it("marks a transient failure failed under its token and rethrows while attempts are left, so BullMQ retries", async () => {
            const { runner, claims, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            const failure = transient()
            processor.process.mockRejectedValue(failure)

            await expect(runner.run(processor, delivery)).rejects.toBe(failure)

            expect(claims.fail).toHaveBeenCalledWith({ jobId: "j-1", expectedFencingToken: 2, reason: "provider down" })
            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.DeliveryFailed, failure, { jobId: "j-1" })
            expect(claims.park).not.toHaveBeenCalled()
        })

        it("still rethrows a transient failure when recording it is fenced out, and logs when recording it fails otherwise", async () => {
            const { runner, claims, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            const failure = transient()
            processor.process.mockRejectedValue(failure)
            claims.fail.mockRejectedValueOnce(fenced())

            await expect(runner.run(processor, delivery)).rejects.toBe(failure)
            expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.FencedOut, { jobId: "j-1" })

            const storeDown = new Error("store down")
            claims.fail.mockRejectedValueOnce(storeDown)

            await expect(runner.run(processor, delivery)).rejects.toBe(failure)
            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.FailureNotRecorded, storeDown, { jobId: "j-1" })
        })

        it("parks a failure a retry cannot fix under this build, raises its one alert and acknowledges the delivery", async () => {
            const { runner, claims, alerts, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(new Error("undefined is not a function"))

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledWith({
                jobId: "j-1",
                expectedFencingToken: 2,
                failureClass: "code",
                reason: "undefined is not a function",
                build: "b-2",
            })
            expect(alerts.raise).toHaveBeenCalledWith({
                kind: "flow-parked",
                jobId: "j-1",
                flowKind: "mail",
                failureClass: "code",
                reason: "undefined is not a function",
                correlationId: "request-1",
                build: "b-2",
                action: "resume",
            })
            expect(claims.fail).not.toHaveBeenCalled()
        })

        it("parks a transient failure on its last attempt, records a thrown text, and raises no second alert", async () => {
            const { runner, claims, alerts, processor } = await build()
            claims.claim.mockResolvedValue(job)
            claims.park.mockResolvedValue({ alertDue: false })
            processor.process.mockRejectedValueOnce(transient()).mockRejectedValueOnce("plain text")

            await runner.run(processor, { ...delivery, attempt: 5 })
            await runner.run(processor, delivery)

            expect(claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
            expect(claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "code", reason: "plain text" }))
            expect(alerts.raise).not.toHaveBeenCalled()
        })

        it("keeps the job parked and logs when its alert cannot be raised", async () => {
            const { runner, claims, alerts, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(new Error("bad row"))
            const down = new Error("notifier down")
            alerts.raise.mockRejectedValue(down)

            await runner.run(processor, delivery)

            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.AlertFailed, down, { jobId: "j-1" })
        })
    })
})
