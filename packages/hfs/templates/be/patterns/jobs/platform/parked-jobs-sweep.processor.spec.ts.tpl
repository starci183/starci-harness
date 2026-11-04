import { mock } from "@starci/jest-preset"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import type { ClaimedJob } from "./jobs.contracts"
import type { JobProcessorRegistry } from "./jobs.port"
import type { ParkedJobResumer } from "./parked-job-resumer.service"
import { ParkedJobsSweepProcessor } from "./parked-jobs-sweep.processor"

const delivery = (payload: object): ClaimedJob => ({
    correlationId: "c-1",
    jobId: "sweep-1",
    kind: PARKED_JOBS_SWEEP_QUEUE,
    fencingToken: 1,
    currentStep: null,
    payload,
})

describe("ParkedJobsSweepProcessor", () => {
    it("registers itself on the sweep queue and resumes every parked job when it runs", async () => {
        const resumer = mock<ParkedJobResumer>()
        resumer.resume.mockResolvedValue(0)
        const registry = mock<JobProcessorRegistry>()
        const sweep = new ParkedJobsSweepProcessor(resumer, registry)

        sweep.onModuleInit()
        await sweep.process(delivery({}))

        expect(sweep.queue).toBe(PARKED_JOBS_SWEEP_QUEUE)
        expect(registry.add).toHaveBeenCalledWith(sweep)
        expect(resumer.resume).toHaveBeenCalledWith({ sweep: true })
    })

    it("resumes the one job a delivery names, and sweeps for an empty or foreign id", async () => {
        const resumer = mock<ParkedJobResumer>()
        resumer.resume.mockResolvedValue(1)
        const sweep = new ParkedJobsSweepProcessor(resumer, mock<JobProcessorRegistry>())

        await sweep.process(delivery({ jobId: "job-7" }))
        await sweep.process(delivery({ jobId: "" }))
        await sweep.process(delivery({ jobId: 7 }))

        expect(resumer.resume.mock.calls).toEqual([[{ jobId: "job-7" }], [{ sweep: true }], [{ sweep: true }]])
    })
})
