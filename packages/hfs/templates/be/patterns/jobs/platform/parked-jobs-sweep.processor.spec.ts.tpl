import { mock } from "@starci/jest-preset"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import type { JobProcessorRegistry } from "./jobs.port"
import type { ParkedJobResumer } from "./parked-job-resumer.service"
import { ParkedJobsSweepProcessor } from "./parked-jobs-sweep.processor"

describe("ParkedJobsSweepProcessor", () => {
    it("registers itself on the sweep queue and resumes every parked job when it runs", async () => {
        const resumer = mock<ParkedJobResumer>()
        resumer.resume.mockResolvedValue(0)
        const registry = mock<JobProcessorRegistry>()
        const sweep = new ParkedJobsSweepProcessor(resumer, registry)

        sweep.onModuleInit()
        await sweep.process()

        expect(sweep.queue).toBe(PARKED_JOBS_SWEEP_QUEUE)
        expect(registry.add).toHaveBeenCalledWith(sweep)
        expect(resumer.resume).toHaveBeenCalledWith({ sweep: true })
    })
})
