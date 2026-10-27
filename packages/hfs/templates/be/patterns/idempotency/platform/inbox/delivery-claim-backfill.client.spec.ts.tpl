import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { InboxErrorCode } from "./errors/inbox.error"
import { backfillDeliveryClaim } from "./delivery-claim-backfill.client"
import { CLAIM_EVENT } from "./persistence/inbox.sql"

const BACKFILL_DELIVERY = Symbol("delivery-claim-backfill")
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: BACKFILL_DELIVERY, useValue: backfillDeliveryClaim }],
    }).compile()
    return moduleRef.get<typeof backfillDeliveryClaim>(BACKFILL_DELIVERY)
}

const CLAIM = {
    source: "saga:place-order",
    eventId: "event-1",
    claimedAt: new FakeClock("2026-01-01T00:00:00.000Z").now(),
}

describe("backfillDeliveryClaim", () => {
    it.each([{ rows: [{ event_id: "event-1" }] }, { rows: [] }])(
        "preserves the legacy scope and instant without replacing an existing receipt: %p",
        async ({ rows }) => {
            const backfill = await build()
            const transaction = fakeTransaction(mockEntityManager({ query: [CLAIM_EVENT, rows] }))

            await expect(transaction.em.transaction((manager) => backfill(manager, CLAIM))).resolves.toBeUndefined()

            expect(transaction.em.query).toHaveBeenCalledWith(CLAIM_EVENT, [
                CLAIM.source,
                CLAIM.eventId,
                CLAIM.claimedAt,
            ])
            expect(transaction.commits).toBe(1)
        },
    )

    it("refuses a manager outside an active migration transaction before transferring a claim", async () => {
        const backfill = await build()
        const manager = mockEntityManager()

        await expect(backfill(manager, CLAIM)).rejects.toMatchObject({ code: InboxErrorCode.TransactionRequired })

        expect(manager.query).not.toHaveBeenCalled()
    })

    it("propagates a failed claim statement so the capability migration rolls back", async () => {
        const backfill = await build()
        const manager = mockEntityManager()
        const failure = new Error("delivery claim transfer failed")
        manager.query.mockRejectedValueOnce(failure)
        const transaction = fakeTransaction(manager)

        await expect(transaction.em.transaction((tx) => backfill(tx, CLAIM))).rejects.toBe(failure)

        expect(transaction.rollbacks).toBe(1)
        expect(transaction.committedWrites).toEqual([])
    })
})
