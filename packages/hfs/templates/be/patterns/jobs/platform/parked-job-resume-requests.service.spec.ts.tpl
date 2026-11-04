import { Test } from "@nestjs/testing"
import { fakeIds, fakeTransaction, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { IDS } from "@modules/platform/ids"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { JobsErrorCode } from "./errors/jobs.error"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import { JOBS_MANAGERS } from "./jobs.decorators"
import { ParkedJobResumeRequestsService } from "./parked-job-resume-requests.service"

const build = async (connected = true) => {
    const manager = mockEntityManager()
    fakeTransaction(manager)
    const outbox = recordingQueueOutbox()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ParkedJobResumeRequestsService,
            connected ? { provide: JOBS_MANAGERS, useValue: [manager] } : { provide: JOBS_MANAGERS, useValue: [] },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: IDS, useValue: fakeIds() },
        ],
    }).compile()
    return { requests: moduleRef.get(ParkedJobResumeRequestsService), outbox }
}

describe("ParkedJobResumeRequestsService", () => {
    it("writes the resume of one job on the sweep queue through the outbox, in one transaction", async () => {
        const { requests, outbox } = await build()

        await requests.request("job-7")

        expect(outbox.jobs).toEqual([{ queue: PARKED_JOBS_SWEEP_QUEUE, payload: { jobId: "job-7" } }])
        expect(outbox.allInTransaction).toBe(true)
    })

    it("asks for every parked job when no id or an empty one is given", async () => {
        const { requests, outbox } = await build()

        await requests.request()
        await requests.request("")

        expect(outbox.jobsOf(PARKED_JOBS_SWEEP_QUEUE)).toEqual([
            { queue: PARKED_JOBS_SWEEP_QUEUE, payload: {} },
            { queue: PARKED_JOBS_SWEEP_QUEUE, payload: {} },
        ])
    })

    it("refuses without the connection of the job table", async () => {
        const { requests } = await build(false)

        await expect(requests.request("job-7")).rejects.toMatchObject({ code: JobsErrorCode.ConnectionMissing })
    })
})
