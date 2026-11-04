import { Injectable } from "@nestjs/common"
import type { OnApplicationBootstrap } from "@nestjs/common"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { InjectQueueRedelivery } from "@modules/platform/queue"
import type { QueueRedelivery } from "@modules/platform/queue"
import type { ResumedJob, ResumeFilter } from "./jobs.contracts"
import { InjectJobClaims, InjectJobsOptions } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import type { JobClaims } from "./jobs.port"

@Injectable()
/**
 * Resumes parked jobs (BE-RESILIENCE-2): at boot every job parked under another build, on the sweep every parked job, and one job on
 * the owner's demand. Each goes back to its queue under a new delivery id and claims its own row again, which keeps its recorded
 * steps; a job that cannot be handed back stays parked for the next resume.
 */
export class ParkedJobResumerService implements OnApplicationBootstrap {
    constructor(
        @InjectJobsOptions() private readonly options: JobsOptions,
        @InjectJobClaims() private readonly claims: JobClaims,
        @InjectQueueRedelivery() private readonly redelivery: QueueRedelivery,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Resumes the jobs parked under an earlier build: a deploy is the usual fix of a code or config failure. */
    async onApplicationBootstrap(): Promise<void> {
        await this.resume({ parkedBefore: this.options.build })
    }

    /** Resumes the jobs the filter names and answers how many went back to their queues. */
    async resume(filter: ResumeFilter): Promise<number> {
        const jobs = await this.claims.resume(filter)
        let handed = 0
        await eachInOrder(jobs, async (job) => {
            if (await this.handBack(job)) handed += 1
        })
        if (jobs.length > 0) this.logger.info(JobsLogEvent.Resumed, { count: handed, of: jobs.length })
        return handed
    }

    private async handBack(job: ResumedJob): Promise<boolean> {
        try {
            await this.redelivery.redeliver(job.kind, job.deliveryId, job.payload, job.correlationId)
            return true
        } catch (cause) {
            this.logger.error(JobsLogEvent.ResumeFailed, cause, { jobId: job.jobId })
            return false
        }
    }
}
