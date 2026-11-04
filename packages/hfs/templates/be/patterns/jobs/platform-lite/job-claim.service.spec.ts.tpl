import { Test } from "@nestjs/testing"
import { FakeClock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { ClaimedJob } from "./jobs.contracts"
import { JOBS_MANAGERS } from "./jobs.decorators"
import { JobClaimService } from "./job-claim.service"

// The statements callDbFunction of platform/database sends for each job function.
const CLAIM_JOB = 'SELECT * FROM "public"."job_claim"($1, $2, $3, $4, $5, $6)'
const ADVANCE_JOB = 'SELECT * FROM "public"."job_advance"($1, $2, $3, $4)'
const COMPLETE_JOB = 'SELECT * FROM "public"."job_complete"($1, $2, $3)'
const FAIL_JOB = 'SELECT * FROM "public"."job_fail"($1, $2, $3, $4)'
const PARK_JOB = 'SELECT * FROM "public"."job_park"($1, $2, $3, $4, $5, $6)'
const RESUME_JOB = 'SELECT * FROM "public"."job_resume"($1, $2, $3, $4)'
const AWAITING_FIX = 'SELECT * FROM "public"."job_awaiting_fix"()'

const AT = "2026-02-03T04:05:06.000Z"

const build = async (manager: MockEntityManager) => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobClaimService,
            { provide: JOBS_MANAGERS, useValue: [manager] },
            { provide: CLOCK, useValue: new FakeClock(AT) },
        ],
    }).compile()
    return { claims: moduleRef.get(JobClaimService) }
}

const buildWithoutConnection = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobClaimService,
            { provide: JOBS_MANAGERS, useValue: [] },
            { provide: CLOCK, useValue: new FakeClock(AT) },
        ],
    }).compile()
    return { claims: moduleRef.get(JobClaimService) }
}

const claimed: ClaimedJob = { correlationId: "request-1", jobId: "j-1", kind: "mail", fencingToken: 3, currentStep: null, payload: { id: "m-1" } }

describe("JobClaimService", () => {
    describe("claim", () => {
        it("claims the delivery in one statement and returns the job with the bumped token", async () => {
            const manager = mockEntityManager({
                query: [
                    CLAIM_JOB,
                    [{ id: "j-1", kind: "mail", fencing_token: "3", current_step: null, payload: { id: "m-1" } }],
                ],
            })
            const { claims } = await build(manager)

            const job = await claims.claim({
                kind: "mail",
                jobKey: "k-1",
                correlationId: "request-1",
                payload: { id: "m-1" },
                workerId: "w-1",
                leaseMs: 60000,
            })

            expect(job).toEqual(claimed)
            expect(manager.query).toHaveBeenCalledWith(CLAIM_JOB, [
                "mail",
                "k-1",
                "w-1",
                new Date("2026-02-03T04:06:06.000Z"),
                JSON.stringify({ id: "m-1" }),
                new Date(AT),
            ])
        })

        it("answers null when the job is done or another worker holds a live claim", async () => {
            const manager = mockEntityManager({ query: [CLAIM_JOB, []] })
            const { claims } = await build(manager)

            await expect(
                claims.claim({ correlationId: "request-1", kind: "mail", jobKey: "k-1", payload: {}, workerId: "w-1", leaseMs: 1000 }),
            ).resolves.toBeNull()
        })
    })

    describe("guarded writes", () => {
        it("records a step, completes and fails under the token the caller holds", async () => {
            const manager = mockEntityManager({
                query: [
                    [ADVANCE_JOB, [{ id: "j-1" }]],
                    [COMPLETE_JOB, [{ id: "j-1" }]],
                    [FAIL_JOB, [{ id: "j-1" }]],
                ],
            })
            const { claims } = await build(manager)

            await claims.advance({ jobId: "j-1", expectedFencingToken: 3, step: "send" })
            await claims.complete({ jobId: "j-1", expectedFencingToken: 3 })
            await claims.fail({ jobId: "j-1", expectedFencingToken: 3, reason: "boom" })

            expect(manager.query).toHaveBeenNthCalledWith(1, ADVANCE_JOB, ["j-1", 3, "send", new Date(AT)])
            expect(manager.query).toHaveBeenNthCalledWith(2, COMPLETE_JOB, ["j-1", 3, new Date(AT)])
            expect(manager.query).toHaveBeenNthCalledWith(3, FAIL_JOB, ["j-1", 3, "boom", new Date(AT)])
        })

        it("throws JobFencedOut when a write finds no row at its token: a newer worker owns the job", async () => {
            const manager = mockEntityManager({
                query: [
                    [ADVANCE_JOB, []],
                    [COMPLETE_JOB, []],
                    [FAIL_JOB, []],
                ],
            })
            const { claims } = await build(manager)

            const attempts = [
                claims.advance({ jobId: "j-1", expectedFencingToken: 2, step: "send" }),
                claims.complete({ jobId: "j-1", expectedFencingToken: 2 }),
                claims.fail({ jobId: "j-1", expectedFencingToken: 2, reason: "boom" }),
            ]

            for (const attempt of attempts) {
                await expect(attempt).rejects.toMatchObject({
                    code: JobsErrorCode.FencedOut,
                    params: { jobId: "j-1", token: 2 },
                })
                await expect(attempt).rejects.toBeInstanceOf(JobsError)
            }
        })
    })

    describe("effectKey", () => {
        it("names the job and the step but not the token, so a resumed job's new claim keeps the key of the effect it made", async () => {
            const { claims } = await build(mockEntityManager())

            expect(claims.effectKey(claimed, "send")).toBe("j-1:send")
            expect(claims.effectKey({ ...claimed, fencingToken: 9 }, "send")).toBe("j-1:send")
        })

        it("refuses a step name that carries the separator", async () => {
            const { claims } = await build(mockEntityManager())

            expect(() => claims.effectKey(claimed, "send:twice")).toThrow(JobsErrorCode.RunKeyInvalid)
        })
    })

    describe("runKey", () => {
        it("includes the job, the step and the fencing token, so a zombie's key differs from the live worker's", async () => {
            const { claims } = await build(mockEntityManager())

            expect(claims.runKey(claimed, "send")).toBe("j-1:send:3")
            expect(claims.runKey({ ...claimed, fencingToken: 4 }, "send")).toBe("j-1:send:4")
        })

        it("refuses a step name that carries the separator, because the key would be ambiguous", async () => {
            const { claims } = await build(mockEntityManager())

            expect(() => claims.runKey(claimed, "send:twice")).toThrow(JobsError)
            expect(() => claims.runKey(claimed, "send:twice")).toThrow(JobsErrorCode.RunKeyInvalid)
        })
    })

    describe("park, resume and the work items", () => {
        it("parks the job under its token and answers whether its one alert is due; a stale token is fenced out", async () => {
            const manager = mockEntityManager({ query: [[PARK_JOB, [{ alert_due: true }]], [PARK_JOB, []]] })
            const { claims } = await build(manager)
            const write = { jobId: "j-1", expectedFencingToken: 3, failureClass: "code" as const, reason: "boom", build: "b-2" }

            await expect(claims.park(write)).resolves.toEqual({ alertDue: true })
            await expect(claims.park(write)).rejects.toMatchObject({ code: JobsErrorCode.FencedOut })

            expect(manager.query).toHaveBeenCalledWith(PARK_JOB, ["j-1", 3, "code", "boom", "b-2", new Date(AT)])
        })

        it("resumes by id, by build or for the sweep and answers each job with its next delivery id", async () => {
            const row = { id: "j-1", kind: "mail", job_key: "k-1", payload: { id: "m-1" }, resume_count: 2 }
            const manager = mockEntityManager({ query: [RESUME_JOB, [row]] })
            const { claims } = await build(manager)

            await expect(claims.resume({ jobId: "j-1" })).resolves.toEqual([
                { jobId: "j-1", kind: "mail", deliveryId: "k-1-r2", payload: { id: "m-1" }, correlationId: "resume:j-1" },
            ])
            await claims.resume({ parkedBefore: "b-2" })
            await claims.resume({ sweep: true })

            expect(manager.query).toHaveBeenCalledWith(RESUME_JOB, ["j-1", null, false, new Date(AT)])
            expect(manager.query).toHaveBeenCalledWith(RESUME_JOB, [null, "b-2", false, new Date(AT)])
            expect(manager.query).toHaveBeenCalledWith(RESUME_JOB, [null, null, true, new Date(AT)])
        })

        it("lists the parked jobs as the owner's work items", async () => {
            const parkedAt = new Date(AT)
            const row = { id: "j-1", kind: "mail", failure_class: "input", error: "bad row", parked_at: parkedAt, parked_build: "b-1", resume_count: 0 }
            const { claims } = await build(mockEntityManager({ query: [AWAITING_FIX, [row]] }))

            await expect(claims.awaitingFix()).resolves.toEqual([
                { jobId: "j-1", kind: "mail", failureClass: "input", reason: "bad row", parkedAt, parkedBuild: "b-1", resumeCount: 0 },
            ])
        })
    })

    describe("registration", () => {
        it("refuses to claim with no connection to hold the job table", async () => {
            const { claims } = await buildWithoutConnection()

            await expect(
                claims.claim({ correlationId: "request-1", kind: "mail", jobKey: "k-1", payload: {}, workerId: "w-1", leaseMs: 1000 }),
            ).rejects.toMatchObject({
                code: JobsErrorCode.ConnectionMissing,
            })
        })
    })
})
