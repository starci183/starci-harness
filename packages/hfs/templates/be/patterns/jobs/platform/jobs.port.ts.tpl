import type {
    AdvanceWrite,
    ClaimedJob,
    ClaimParams,
    ClaimResult,
    FailWrite,
    GuardedWrite,
    ParkedFlowAlert,
    ParkedJob,
    ParkResult,
    ParkWrite,
    ResumedJob,
    ResumeFilter,
    RunKey,
} from "./jobs.contracts"
import type { FencedProcessor } from "./fenced.processor"

/** The one door to the job row; `platform/jobs` implements it and nothing else writes the table. */
export interface JobClaims {
    /** Claims the delivery in one atomic statement and bumps the fencing token; null when the job is done or another worker holds a live claim. */
    claim(params: ClaimParams): Promise<ClaimResult>
    /** Records a finished step; throws `JobFencedOut` when the token is stale. */
    advance(write: AdvanceWrite): Promise<void>
    /** Completes the job; throws `JobFencedOut` when the token is stale. */
    complete(write: GuardedWrite): Promise<void>
    /** Fails the job so BullMQ can retry it; throws `JobFencedOut` when the token is stale. */
    fail(write: FailWrite): Promise<void>
    /** Parks the job as `failed_awaiting_fix` until a resume; throws `JobFencedOut` when the token is stale. */
    park(write: ParkWrite): Promise<ParkResult>
    /** Marks the parked jobs the filter names as resumed and answers each with the delivery id it goes back to its queue under. */
    resume(filter: ResumeFilter): Promise<ReadonlyArray<ResumedJob>>
    /** The parked jobs, oldest first: the owner's work items. */
    awaitingFix(): Promise<ReadonlyArray<ParkedJob>>
    /** The idempotency key of one step of this claim: `<jobId>:<step>:<fencingToken>`. */
    runKey(job: ClaimedJob, step: string): RunKey
}

/** One external effect of a job. */
export interface JobStep {
    /** Performs the effect of the step for the claimed job. */
    run(job: ClaimedJob): Promise<void>
}

/** Where the one alert of a parked job goes: the app binds it to the owner's work items or notifier. */
export interface FlowAlerts {
    /** Raises the work item of a parked job; it is called once per park. */
    raise(alert: ParkedFlowAlert): Promise<void>
}

/** Where a job module registers its processor. */
export interface JobProcessorRegistry {
    /** Subscribes the processor to its queue. */
    add(processor: FencedProcessor): void
}
