import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_REDELIVERY } from "@modules/platform/queue"
import type { QueueRedelivery } from "@modules/platform/queue"
import type { ResumedJob } from "./jobs.contracts"
import { JOB_CLAIMS, JOBS_OPTIONS } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import type { JobClaims } from "./jobs.port"
import { ParkedJobResumer } from "./parked-job-resumer.service"

const options: JobsOptions = { connection: "primary", workerId: "w-1", leaseMs: 60000, build: "b-2" }
const resumed = (jobId: string): ResumedJob => ({ jobId, kind: "mail", deliveryId: `k-${jobId}-r1`, payload: { id: jobId }, correlationId: `resume:${jobId}` })

const build = async () => {
    const claims = mock<JobClaims>()
    claims.resume.mockResolvedValue([])
    const redelivery = mock<QueueRedelivery>()
    redelivery.redeliver.mockResolvedValue(undefined)
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ParkedJobResumer,
            { provide: JOBS_OPTIONS, useValue: options },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: QUEUE_REDELIVERY, useValue: redelivery },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { resumer: moduleRef.get(ParkedJobResumer), claims, redelivery, logger }
}

describe("ParkedJobResumer", () => {
    it("resumes at boot the jobs parked under an earlier build", async () => {
        const { resumer, claims, logger } = await build()

        await resumer.onApplicationBootstrap()

        expect(claims.resume).toHaveBeenCalledWith({ parkedBefore: "b-2" })
        expect(logger.info).not.toHaveBeenCalled()
    })

    it("hands each resumed job back to its queue under its new delivery id and counts them", async () => {
        const { resumer, claims, redelivery, logger } = await build()
        claims.resume.mockResolvedValue([resumed("j-1"), resumed("j-2")])

        await expect(resumer.resume({ sweep: true })).resolves.toBe(2)

        expect(redelivery.redeliver).toHaveBeenCalledWith("mail", "k-j-1-r1", { id: "j-1" }, "resume:j-1")
        expect(logger.info).toHaveBeenCalledWith(JobsLogEvent.Resumed, { count: 2, of: 2 })
    })

    it("leaves a job it cannot hand back parked and logs it", async () => {
        const { resumer, claims, redelivery, logger } = await build()
        claims.resume.mockResolvedValue([resumed("j-1")])
        const down = new Error("redis down")
        redelivery.redeliver.mockRejectedValue(down)

        await expect(resumer.resume({ jobId: "j-1" })).resolves.toBe(0)

        expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.ResumeFailed, down, { jobId: "j-1" })
    })
})
