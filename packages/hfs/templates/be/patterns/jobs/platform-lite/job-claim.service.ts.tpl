import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { callDbFunction } from "@modules/platform/database"
import { isRunKey } from "./jobs.contracts"
import type {
    AdvanceWrite,
    ClaimedJob,
    ClaimParams,
    ClaimResult,
    FailWrite,
    GuardedWrite,
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
        const rows = await callDbFunction<ClaimedRecord>(this.writer(), "job_claim", [
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
        return this.guarded("job_advance", [write.jobId, write.expectedFencingToken, write.step, this.clock.now()], write)
    }

    /** Completes the job under the token the caller holds. */
    complete(write: GuardedWrite): Promise<void> {
        return this.guarded("job_complete", [write.jobId, write.expectedFencingToken, this.clock.now()], write)
    }

    /** Marks the job failed under the token the caller holds, so BullMQ can retry it. */
    fail(write: FailWrite): Promise<void> {
        return this.guarded("job_fail", [write.jobId, write.expectedFencingToken, write.reason, this.clock.now()], write)
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

    /** Runs a guarded function that updates only when the token still matches; no row back means a newer worker owns the job. */
    private async guarded(
        fn: "job_advance" | "job_complete" | "job_fail",
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
