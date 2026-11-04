import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import type { ClaimedJob } from "./jobs.contracts"
import { JOB_PROCESSOR_REGISTRY } from "./jobs.decorators"
import type { JobProcessorRegistry } from "./jobs.port"
import { ParkedJobResumerService } from "./parked-job-resumer.service"
import { ParkedJobsSweepProcessor } from "./parked-jobs-sweep.processor"

const delivery = (payload: object): ClaimedJob => ({
    correlationId: "c-1",
    jobId: "sweep-1",
    kind: PARKED_JOBS_SWEEP_QUEUE,
    fencingToken: 1,
    currentStep: null,
    payload,
})

const build = async (resumed: number) => {
    const resumer = mock<ParkedJobResumerService>()
    resumer.resume.mockResolvedValue(resumed)
    const registry = mock<JobProcessorRegistry>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ParkedJobsSweepProcessor,
            { provide: ParkedJobResumerService, useValue: resumer },
            { provide: JOB_PROCESSOR_REGISTRY, useValue: registry },
        ],
    }).compile()
    return { sweep: moduleRef.get(ParkedJobsSweepProcessor), resumer, registry }
}

describe("ParkedJobsSweepProcessor", () => {
    it("registers itself on the sweep queue and resumes every parked job when it runs", async () => {
        const { sweep, resumer, registry } = await build(0)

        sweep.onModuleInit()
        await sweep.process(delivery({}))

        expect(sweep.queue).toBe(PARKED_JOBS_SWEEP_QUEUE)
        expect(registry.add).toHaveBeenCalledWith(sweep)
        expect(resumer.resume).toHaveBeenCalledWith({ sweep: true })
    })

    it("resumes the one job a delivery names, and sweeps for an empty or foreign id", async () => {
        const { sweep, resumer } = await build(1)

        await sweep.process(delivery({ jobId: "job-7" }))
        await sweep.process(delivery({ jobId: "" }))
        await sweep.process(delivery({ jobId: 7 }))

        expect(resumer.resume.mock.calls).toEqual([[{ jobId: "job-7" }], [{ sweep: true }], [{ sweep: true }]])
    })
})
