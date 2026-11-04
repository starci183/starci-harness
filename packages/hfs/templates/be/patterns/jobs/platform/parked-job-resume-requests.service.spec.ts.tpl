import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { Ids } from "@modules/platform/ids"
import type { QueueOutbox } from "@modules/platform/queue"
import { JobsErrorCode } from "./errors/jobs.error"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import { ParkedJobResumeRequests } from "./parked-job-resume-requests.service"

const build = (managers = [mockEntityManager()]) => {
    const [manager] = managers
    if (manager !== undefined) fakeTransaction(manager)
    const outbox = mock<QueueOutbox>()
    const ids = mock<Ids>()
    ids.next.mockReturnValue("id-1")
    return { requests: new ParkedJobResumeRequests(managers, outbox, ids), outbox }
}

describe("ParkedJobResumeRequests", () => {
    it("writes the resume of one job on the sweep queue through the outbox, in one transaction", async () => {
        const { requests, outbox } = build()

        await requests.request("job-7")

        expect(outbox.write).toHaveBeenCalledWith(expect.anything(), PARKED_JOBS_SWEEP_QUEUE, { jobId: "job-7" }, "resume:id-1")
    })

    it("asks for every parked job when no id or an empty one is given", async () => {
        const { requests, outbox } = build()

        await requests.request()
        await requests.request("")

        expect(outbox.write).toHaveBeenNthCalledWith(1, expect.anything(), PARKED_JOBS_SWEEP_QUEUE, {}, "resume:id-1")
        expect(outbox.write).toHaveBeenNthCalledWith(2, expect.anything(), PARKED_JOBS_SWEEP_QUEUE, {}, "resume:id-1")
    })

    it("refuses without the connection of the job table", async () => {
        const { requests } = build([])

        await expect(requests.request("job-7")).rejects.toMatchObject({ code: JobsErrorCode.ConnectionMissing })
    })
})
