import { Injectable } from "@nestjs/common"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { ATTEMPTS, classifyFailure, InjectQueueWorkerRegistry } from "@modules/platform/queue"
import type { FailureClass, QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { jobKeyOf } from "./jobs.contracts"
import type { ClaimedJob } from "./jobs.contracts"
import { InjectFlowAlerts, InjectJobClaims, InjectJobsOptions } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import type { FlowAlerts, JobClaims, JobProcessorRegistry } from "./jobs.port"
import type { FencedProcessor } from "./fenced.processor"

const isFencedOut = (cause: unknown): boolean => cause instanceof JobsError && cause.code === JobsErrorCode.FencedOut

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

@Injectable()
/**
 * The runner of fenced jobs: it subscribes each registered processor to its queue and, for every delivery, claims the job (bumping the
 * fencing token), calls the processor and settles the job through the guarded writes. A `JobFencedOut` means a newer worker owns the
 * job: this worker stops with no further effect and the delivery is acknowledged. A transient failure with attempts left marks the job
 * failed and is rethrown, so BullMQ retries it with backoff; any other failure, or a transient one on the last attempt, parks the job
 * as `failed_awaiting_fix` with its one alert and acknowledges the delivery, so no failure ends as a silent dead letter
 * (BE-RESILIENCE-2). A resumed delivery (`<jobKey>-r<n>`) claims the same row, which keeps its recorded steps.
 */
export class JobRunnerService implements JobProcessorRegistry {
    constructor(
        @InjectJobsOptions() private readonly options: JobsOptions,
        @InjectJobClaims() private readonly claims: JobClaims,
        @InjectQueueWorkerRegistry() private readonly queues: QueueWorkerRegistry,
        @InjectFlowAlerts() private readonly alerts: FlowAlerts,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Subscribes the processor to its queue. */
    add(processor: FencedProcessor): void {
        this.queues.add({ queue: processor.queue, handle: (delivery) => this.run(processor, delivery) })
    }

    /** Runs one delivery of the processor's queue. */
    async run(processor: FencedProcessor, delivery: QueueDelivery): Promise<void> {
        const job = await this.claims.claim({
            kind: processor.queue,
            jobKey: jobKeyOf(delivery.id),
            correlationId: delivery.correlationId,
            payload: delivery.payload,
            workerId: this.options.workerId,
            leaseMs: this.options.leaseMs,
        })
        if (job === null) return
        try {
            await processor.process(job)
            await this.claims.complete({ jobId: job.jobId, expectedFencingToken: job.fencingToken })
        } catch (cause) {
            if (isFencedOut(cause)) {
                this.logger.warn(JobsLogEvent.FencedOut, { jobId: job.jobId })
                return
            }
            const failureClass = classifyFailure(cause)
            if (failureClass === "transient" && delivery.attempt < ATTEMPTS) {
                await this.recordFailure(job, cause)
                throw cause
            }
            await this.park(job, failureClass, cause)
        }
    }

    private async recordFailure(job: ClaimedJob, cause: unknown): Promise<void> {
        this.logger.error(JobsLogEvent.DeliveryFailed, cause, { jobId: job.jobId })
        await this.claims
            .fail({ jobId: job.jobId, expectedFencingToken: job.fencingToken, reason: reasonOf(cause) })
            .catch((error_: unknown) => {
                if (isFencedOut(error_)) this.logger.warn(JobsLogEvent.FencedOut, { jobId: job.jobId })
                else this.logger.error(JobsLogEvent.FailureNotRecorded, error_, { jobId: job.jobId })
            })
    }

    /** Parks the job under this build and raises its one alert; a park that cannot be written fails the delivery so BullMQ retries it. */
    private async park(job: ClaimedJob, failureClass: FailureClass, cause: unknown): Promise<void> {
        const reason = reasonOf(cause)
        this.logger.error(JobsLogEvent.Parked, cause, { jobId: job.jobId, failureClass })
        const { alertDue } = await this.claims.park({
            jobId: job.jobId,
            expectedFencingToken: job.fencingToken,
            failureClass,
            reason,
            build: this.options.build,
        })
        if (!alertDue) return
        await this.alerts
            .raise({
                kind: "flow-parked",
                jobId: job.jobId,
                flowKind: job.kind,
                failureClass,
                reason,
                correlationId: job.correlationId,
                build: this.options.build,
                action: "resume",
            })
            .catch((error_: unknown) => {
                this.logger.error(JobsLogEvent.AlertFailed, error_, { jobId: job.jobId })
            })
    }
}
