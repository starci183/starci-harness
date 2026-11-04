import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { callDbFunction } from "@modules/platform/database"
import type { FailureClass } from "@starci/nest-kit"
import { isEffectKey, isRunKey, resumedDeliveryId } from "./jobs.contracts"
import type {
    AdvanceWrite,
    ClaimedJob,
    ClaimParams,
    ClaimResult,
    EffectKey,
    FailWrite,
    GuardedWrite,
    ParkedJob,
    ParkResult,
    ParkWrite,
    ResumedJob,
    ResumeFilter,
    RunKey,
} from "./jobs.contracts"
import { InjectJobsManagers } from "./jobs.decorators"
import type { JobClaims } from "./jobs.port"

/** The record job_claim returns (a bigint arrives as text). */
interface ClaimedRecord {
    /** The id of the job row. */
    readonly id: string
    /** The kind of the job. */
    readonly kind: string
    /** The fencing token after the claim. */
    readonly fencing_token: string
    /** The last recorded step, or null. */
    readonly current_step: string | null
    /** The payload, as the database returns the jsonb value. */
    readonly payload: object
}

/** The record job_resume returns. */
interface ResumedRecord {
    /** The id of the job row. */
    readonly id: string
    /** The kind of the job. */
    readonly kind: string
    /** The key the job was first delivered under. */
    readonly job_key: string
    /** The payload, as the database returns the jsonb value. */
    readonly payload: object
    /** The resume number after this resume. */
    readonly resume_count: number
}

/** The record job_awaiting_fix returns. */
interface ParkedRecord {
    /** The id of the job row. */
    readonly id: string
    /** The kind of the job. */
    readonly kind: string
    /** The class of its failure. */
    readonly failure_class: FailureClass
    /** Why it failed. */
    readonly error: string
    /** When it parked. */
    readonly parked_at: Date
    /** The build it parked under. */
    readonly parked_build: string
    /** How many times it was resumed. */
    readonly resume_count: number
}

/** A resumed row as the resumer hands it back: the correlation id of a resume is the job's own id, the delivery id carries the resume number. */
const resumedOf = (row: ResumedRecord): ResumedJob => ({
    jobId: row.id,
    kind: row.kind,
    deliveryId: resumedDeliveryId(row.job_key, row.resume_count),
    payload: row.payload,
    correlationId: `resume:${row.id}`,
})

/** A parked row as the owner's work item. */
const parkedOf = (row: ParkedRecord): ParkedJob => ({
    jobId: row.id,
    kind: row.kind,
    failureClass: row.failure_class,
    reason: row.error,
    parkedAt: row.parked_at,
    parkedBuild: row.parked_build,
    resumeCount: row.resume_count,
})

@Injectable()
/**
 * The one owner of the job row, through the job_* functions of its migration (R334). A claim is one atomic upsert that bumps the fencing token in the store, so two workers can never
 * hold the same token; every other write is `WHERE fencing_token = <expected>`, so a worker that lost its claim (a zombie) changes
 * nothing and learns it from `JobFencedOut`.
 */
export class JobClaimService implements JobClaims {
    constructor(
        @InjectJobsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** Claims the delivery; null when the job is done or another worker holds a claim that has not expired. */
    async claim(params: ClaimParams): Promise<ClaimResult> {
        const now = this.clock.now()
        const rows = await callDbFunction<ClaimedRecord>(this.writer(), "public.job_claim", [
            params.kind,
            params.jobKey,
            params.workerId,
            new Date(now.getTime() + params.leaseMs),
            JSON.stringify(params.payload),
            now,
        ])
        const row = rows[0]
        if (row === undefined) return null
        // The durable delivery supplies the same request id on every retry; the job fence identifies a claim separately.
        return {
            jobId: row.id,
            correlationId: params.correlationId,
            kind: row.kind,
            fencingToken: Number(row.fencing_token),
            currentStep: row.current_step,
            payload: row.payload,
        }
    }

    /** Records a finished step under the token the caller holds. */
    advance(write: AdvanceWrite): Promise<void> {
        return this.guarded("public.job_advance", [write.jobId, write.expectedFencingToken, write.step, this.clock.now()], write)
    }

    /** Completes the job under the token the caller holds. */
    complete(write: GuardedWrite): Promise<void> {
        return this.guarded("public.job_complete", [write.jobId, write.expectedFencingToken, this.clock.now()], write)
    }

    /** Marks the job failed under the token the caller holds, so BullMQ can retry it. */
    fail(write: FailWrite): Promise<void> {
        return this.guarded("public.job_fail", [write.jobId, write.expectedFencingToken, write.reason, this.clock.now()], write)
    }

    /** Parks the job as failed_awaiting_fix under the token the caller holds; answers whether its one alert is still due. */
    async park(write: ParkWrite): Promise<ParkResult> {
        const rows = await callDbFunction<{ readonly alert_due: boolean }>(this.writer(), "public.job_park", [
            write.jobId,
            write.expectedFencingToken,
            write.failureClass,
            write.reason,
            write.build,
            this.clock.now(),
        ])
        const row = rows[0]
        if (row === undefined) {
            throw new JobsError({ code: JobsErrorCode.FencedOut, params: { jobId: write.jobId, token: write.expectedFencingToken } })
        }
        return { alertDue: row.alert_due }
    }

    /** Marks the parked jobs the filter names as resumed and answers each with the delivery id it goes back under. */
    async resume(filter: ResumeFilter): Promise<ReadonlyArray<ResumedJob>> {
        const rows = await callDbFunction<ResumedRecord>(this.writer(), "public.job_resume", [
            "jobId" in filter ? filter.jobId : null,
            "parkedBefore" in filter ? filter.parkedBefore : null,
            "sweep" in filter,
            this.clock.now(),
        ])
        return rows.map(resumedOf)
    }

    /** The parked jobs, oldest first. */
    async awaitingFix(): Promise<ReadonlyArray<ParkedJob>> {
        const rows = await callDbFunction<ParkedRecord>(this.writer(), "public.job_awaiting_fix", [])
        return rows.map(parkedOf)
    }

    /** The idempotency key of one step of this claim: it includes the token, so a zombie's repeat is a different key than the live worker's. */
    runKey(job: ClaimedJob, step: string): RunKey {
        const key = `${job.jobId}:${step}:${job.fencingToken}`
        if (!isRunKey(key))
            throw new JobsError({ code: JobsErrorCode.RunKeyInvalid, params: { jobId: job.jobId, step } })
        return key
    }

    /** The ledger key of one effect of this job: it leaves the token out, so a resumed job (a new claim) finds the effect it already made. */
    effectKey(job: ClaimedJob, step: string): EffectKey {
        const key = `${job.jobId}:${step}`
        if (!isEffectKey(key))
            throw new JobsError({ code: JobsErrorCode.RunKeyInvalid, params: { jobId: job.jobId, step } })
        return key
    }

    /** The entity manager of the connection that holds the job table. */
    private writer(): EntityManager {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        return manager
    }

    /** Runs a guarded function that updates only when the token still matches; no row back means a newer worker owns the job. */
    private async guarded(
        fn: "public.job_advance" | "public.job_complete" | "public.job_fail",
        parameters: Array<unknown>,
        write: GuardedWrite,
    ): Promise<void> {
        const rows = await callDbFunction<object>(this.writer(), fn, parameters)
        if (rows.length === 0) {
            throw new JobsError({
                code: JobsErrorCode.FencedOut,
                params: { jobId: write.jobId, token: write.expectedFencingToken },
            })
        }
    }
}
