import { Injectable } from "@nestjs/common"
import type { OnModuleInit } from "@nestjs/common"
import { FencedProcessor } from "./fenced.processor"
import { PARKED_JOBS_SWEEP_QUEUE } from "./jobs.contracts"
import { InjectJobProcessorRegistry } from "./jobs.decorators"
import type { JobProcessorRegistry } from "./jobs.port"
import { ParkedJobResumer } from "./parked-job-resumer.service"

@Injectable()
/** The scheduled sweep of parked jobs: every parked job goes back to its queue, so a fix that needed no deploy (data, config) is picked up. */
export class ParkedJobsSweepProcessor extends FencedProcessor implements OnModuleInit {
    readonly queue = PARKED_JOBS_SWEEP_QUEUE

    constructor(
        private readonly resumer: ParkedJobResumer,
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
    ) {
        super()
    }

    /** Registers the sweep with the runner. */
    onModuleInit(): void {
        this.registry.add(this)
    }

    /** Resumes every parked job. */
    async process(): Promise<void> {
        await this.resumer.resume({ sweep: true })
    }
}
