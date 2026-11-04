import type { FailureClass } from "@modules/platform/queue"

/** A job a worker claimed: the token it must pass to every write. */
export interface ClaimedJob {
    /** The originating request id carried explicitly by the durable queue delivery. */
    readonly correlationId: string
    /** The id of the job row. */
    readonly jobId: string
    /** The kind of the job: the queue its processor consumes. */
    readonly kind: string
    /** The fencing token of this claim; the claim bumped it, so an older worker holds a smaller one. */
    readonly fencingToken: number
    /** The last step a worker recorded, or null before the first. */
    readonly currentStep: string | null
    /** The payload the producer wrote. */
    readonly payload: object
}

/** What a worker asks for when it claims a delivery. */
export interface ClaimParams {
    /** The originating request id retained across delivery retries. */
    readonly correlationId: string
    /** The kind of the job. */
    readonly kind: string
    /** The key of the delivery: the BullMQ job id. A second claim of the same key bumps the token of the same row. */
    readonly jobKey: string
    /** The payload to store on the first claim. */
    readonly payload: object
    /** The name of the claiming worker. */
    readonly workerId: string
    /** How long the claim lasts. */
    readonly leaseMs: number
}

/** The target of one guarded write: the job and the token the writer holds. Required in the type, never optional. */
export interface GuardedWrite {
    /** The id of the job row. */
    readonly jobId: string
    /** The token the writer received from its claim. */
    readonly expectedFencingToken: number
}

/** A guarded write that records a step. */
export interface AdvanceWrite extends GuardedWrite {
    /** The step that finished. */
    readonly step: string
}

/** A guarded write that fails the job. */
export interface FailWrite extends GuardedWrite {
    /** Why the job failed. */
    readonly reason: string
}

/** A guarded write that parks the job as `failed_awaiting_fix` (BE-RESILIENCE-2). */
export interface ParkWrite extends GuardedWrite {
    /** The class `classifyFailure` gave the failure. */
    readonly failureClass: FailureClass
    /** Why the job failed. */
    readonly reason: string
    /** The build the job parked under: a later build resumes it. */
    readonly build: string
}

/** What a park answers: whether this park is the first since the job last ran, so its one alert is still due. */
export interface ParkResult {
    /** True when no alert was raised for this park yet. */
    readonly alertDue: boolean
}

/**
 * Which parked jobs to resume: one by id (the owner's "resume now"), every one parked under another build than `parkedBefore` (a
 * deploy), or every parked one (the sweep, which keeps their alert raised so a failure that persists does not alert again).
 */
export type ResumeFilter = { readonly jobId: string } | { readonly parkedBefore: string } | { readonly sweep: true }

/** The queue of the scheduled sweep of parked jobs; its tick is in JOB_TICKS (lite) or the app's schedulers (full). */
export const PARKED_JOBS_SWEEP_QUEUE = "platform.jobs.sweep"

/**
 * The resume a sweep delivery asks for: the one job its payload names (`{ jobId }`, the owner's "resume now" written to the sweep
 * queue through the outbox), else every parked job.
 */
export const sweepFilter = (payload: object): ResumeFilter => {
    const jobId: unknown = Reflect.get(payload, "jobId")
    return typeof jobId === "string" && jobId !== "" ? { jobId } : { sweep: true }
}

/** A parked job handed back to its queue: the queue and the delivery id it is added under, and what its handler receives. */
export interface ResumedJob {
    /** The id of the job row. */
    readonly jobId: string
    /** The queue the job runs on. */
    readonly kind: string
    /** The delivery id of this resume: `<jobKey>-r<resumeCount>`. */
    readonly deliveryId: string
    /** The payload the producer wrote. */
    readonly payload: object
    /** The originating request id. */
    readonly correlationId: string
}

/** A job parked as `failed_awaiting_fix`: one work item of the owner, resumed by `resume({ jobId })`. */
export interface ParkedJob {
    /** The id of the job row. */
    readonly jobId: string
    /** The queue the job runs on. */
    readonly kind: string
    /** The class of its failure. */
    readonly failureClass: FailureClass
    /** Why it failed. */
    readonly reason: string
    /** When it parked. */
    readonly parkedAt: Date
    /** The build it parked under. */
    readonly parkedBuild: string
    /** How many times it was resumed before. */
    readonly resumeCount: number
}

/** The one alert of a parked job: the owner's work item, whose action resumes it. */
export interface ParkedFlowAlert {
    /** The kind of the work item. */
    readonly kind: "flow-parked"
    /** The id of the job row, which `resume({ jobId })` takes. */
    readonly jobId: string
    /** The queue the job runs on. */
    readonly flowKind: string
    /** The class of its failure. */
    readonly failureClass: FailureClass
    /** Why it failed. */
    readonly reason: string
    /** The originating request id. */
    readonly correlationId: string
    /** The build it parked under. */
    readonly build: string
    /** The action the work item offers. */
    readonly action: "resume"
}

/** The suffix of the delivery id of a resumed job: `<jobKey>-r<n>`. */
const RESUMED_DELIVERY = /-r\d+$/u

/** The job key a delivery claims: the delivery id, without the suffix a resume added. */
export const jobKeyOf = (deliveryId: string): string => deliveryId.replace(RESUMED_DELIVERY, "")

/** The delivery id of the `resumeCount`th resume of a job. */
export const resumedDeliveryId = (jobKey: string, resumeCount: number): string => `${jobKey}-r${String(resumeCount)}`

/** The idempotency key of an external effect: only `JobClaims.runKey` makes one. */
export type RunKey = string & {
    /** The brand that keeps a plain string from passing as a run key; it never exists at run time. */
    readonly __runKey: unique symbol
}

/** The shape of a run key: `<jobId>:<step>:<fencingToken>`. */
const RUN_KEY = /^[^:]+:[^:]+:\d+$/u

/** True when the text has the shape of a run key; the one place a string becomes a `RunKey`. */
export const isRunKey = (text: string): text is RunKey => RUN_KEY.test(text)

/** What a claim answers: the claimed job, or null when the job is done or another worker holds a live claim. */
export type ClaimResult = ClaimedJob | null
