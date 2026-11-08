import { Injectable, type OnModuleInit } from "@nestjs/common"
import { FencedProcessor } from "./fenced.processor"
import { PARKED_JOBS_SWEEP_QUEUE, sweepFilter, type ClaimedJob } from "./jobs.contracts"
import { InjectJobProcessorRegistry } from "./jobs.decorators"
import type { JobProcessorRegistry } from "./jobs.port"
import { ParkedJobResumerService } from "./parked-job-resumer.service"

@Injectable()
/**
 * The sweep of parked jobs: on its tick every parked job goes back to its queue, so a fix that needed no deploy (data, config) is
 * picked up; a delivery that names one job (the owner's "resume now") resumes that job alone.
 */
export class ParkedJobsSweepProcessor extends FencedProcessor implements OnModuleInit {
    readonly queue: string = PARKED_JOBS_SWEEP_QUEUE

    constructor(
        private readonly resumer: ParkedJobResumerService,
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
    ) {
        super()
    }

    /** Registers the sweep with the runner. */
    onModuleInit(): void {
        this.registry.add(this)
    }

    /** Resumes the job the delivery names, or every parked job. */
    async process(job: ClaimedJob): Promise<void> {
        await this.resumer.resume(sweepFilter(job.payload))
    }
}
