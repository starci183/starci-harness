import { SchedulerRegistry } from "@nestjs/schedule"
import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { LOGGER } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import type { JobTick } from "./job-ticks.contracts"
import { JOBS_MANAGERS } from "./jobs.decorators"
import { JobTickService, tickMinute } from "./job-tick.service"

// The statements advisoryXactLock and callDbFunction of platform/database send for one firing.
const LOCK_TICK = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"
const CLAIM_TICK = "SELECT * FROM job_tick_claim($1, $2)"

const AT = "2026-02-03T04:05:06.000Z"
const TICK: JobTick = { name: "nightly-digest", cron: "0 2 * * *", timeZone: "UTC", queue: "digests", payload: { kind: "nightly" } }

const build = async (claimed: boolean) => {
    const transaction = fakeTransaction(mockEntityManager({ query: [[LOCK_TICK, []], [CLAIM_TICK, [{ claimed }]]] }))
    const outbox = { write: jest.fn().mockResolvedValue(undefined) }
    const registry = { addCronJob: jest.fn() }
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobTickService,
            { provide: SchedulerRegistry, useValue: registry },
            { provide: JOBS_MANAGERS, useValue: [transaction.em] },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: LOGGER, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        ],
    }).compile()
    return { ticks: moduleRef.get(JobTickService), transaction, outbox, registry }
}

describe("JobTickService", () => {
    it("names a tick's slot by its UTC minute", () => {
        expect(tickMinute(new Date(AT))).toBe("2026-02-03T04:05")
    })

    it("locks the tick, claims its minute and enqueues one job in the same transaction", async () => {
        const { ticks, transaction, outbox } = await build(true)

        await expect(ticks.fire(TICK)).resolves.toBe(true)

        expect(transaction.em.query).toHaveBeenNthCalledWith(1, LOCK_TICK, ["tick:nightly-digest"])
        expect(transaction.em.query).toHaveBeenNthCalledWith(2, CLAIM_TICK, ["nightly-digest", "2026-02-03T04:05"])
        expect(outbox.write).toHaveBeenCalledWith(expect.anything(), "digests", { kind: "nightly" }, "tick:nightly-digest:2026-02-03T04:05")
    })

    it("enqueues nothing when another replica already fired the tick this minute", async () => {
        const { ticks, outbox } = await build(false)

        await expect(ticks.fire(TICK)).resolves.toBe(false)

        expect(outbox.write).not.toHaveBeenCalled()
    })

    it("registers no cron job while the tick list is empty", async () => {
        const { ticks, registry } = await build(true)

        ticks.onApplicationBootstrap()

        expect(registry.addCronJob).not.toHaveBeenCalled()
    })
})
