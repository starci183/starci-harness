import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { sql } from "@modules/platform/database"
import type { FailureClass } from "@modules/platform/queue"
import { isRunKey, resumedDeliveryId } from "./jobs.contracts"
import type {
    AdvanceWrite,
    ClaimedJob,
    ClaimParams,
    ClaimResult,
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
import { ADVANCE_JOB, AWAITING_FIX_JOBS, CLAIM_JOB, COMPLETE_JOB, FAIL_JOB, PARK_JOB, RESUME_JOBS } from "./persistence/jobs.sql"
import type { ClaimedRow } from "./persistence/jobs.rows"

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
 * The one owner of the job row. A claim is one atomic upsert that bumps the fencing token in the store, so two workers can never
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
        const rows: Array<ClaimedRow> = await this.writer().query(CLAIM_JOB, [
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
        return this.guarded(ADVANCE_JOB, [write.jobId, write.expectedFencingToken, write.step, this.clock.now()], write)
    }

    /** Completes the job under the token the caller holds. */
    complete(write: GuardedWrite): Promise<void> {
        return this.guarded(COMPLETE_JOB, [write.jobId, write.expectedFencingToken, this.clock.now()], write)
    }

    /** Marks the job failed under the token the caller holds, so BullMQ can retry it. */
    fail(write: FailWrite): Promise<void> {
        return this.guarded(FAIL_JOB, [write.jobId, write.expectedFencingToken, write.reason, this.clock.now()], write)
    }

    /** Parks the job as failed_awaiting_fix under the token the caller holds; answers whether its one alert is still due. */
    async park(write: ParkWrite): Promise<ParkResult> {
        const rows: Array<{ readonly alert_due: boolean }> = await this.writer().query(PARK_JOB, [
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
        const rows: Array<ResumedRecord> = await this.writer().query(RESUME_JOBS, [
            "jobId" in filter ? filter.jobId : null,
            "parkedBefore" in filter ? filter.parkedBefore : null,
            "sweep" in filter,
            this.clock.now(),
        ])
        return rows.map(resumedOf)
    }

    /** The parked jobs, oldest first. */
    async awaitingFix(): Promise<ReadonlyArray<ParkedJob>> {
        const rows: Array<ParkedRecord> = await this.writer().query(AWAITING_FIX_JOBS, [])
        return rows.map(parkedOf)
    }

    /** The idempotency key of one step of this claim: it includes the token, so a zombie's repeat is a different key than the live worker's. */
    runKey(job: ClaimedJob, step: string): RunKey {
        const key = `${job.jobId}:${step}:${job.fencingToken}`
        if (!isRunKey(key))
            throw new JobsError({ code: JobsErrorCode.RunKeyInvalid, params: { jobId: job.jobId, step } })
        return key
    }

    /** The entity manager of the connection that holds the job table. */
    private writer(): EntityManager {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        return manager
    }

    /** Runs a statement that updates only when the token still matches; no row updated means a newer worker owns the job. */
    private async guarded(
        statement: ReturnType<typeof sql>,
        parameters: Array<unknown>,
        write: GuardedWrite,
    ): Promise<void> {
        const rows: Array<object> = await this.writer().query(statement, parameters)
        if (rows.length === 0) {
            throw new JobsError({
                code: JobsErrorCode.FencedOut,
                params: { jobId: write.jobId, token: write.expectedFencingToken },
            })
        }
    }
}
