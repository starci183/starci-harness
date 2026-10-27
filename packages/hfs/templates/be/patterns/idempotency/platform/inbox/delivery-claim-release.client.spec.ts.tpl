import { Test } from "@nestjs/testing"
import { fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { InboxErrorCode } from "./errors/inbox.error"
import { releaseDeliveryClaim } from "./delivery-claim-release.client"
import { RELEASE_EVENT } from "./persistence/inbox.sql"

const RELEASE_DELIVERY = Symbol("delivery-claim-release")
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: RELEASE_DELIVERY, useValue: releaseDeliveryClaim }],
    }).compile()
    return moduleRef.get<typeof releaseDeliveryClaim>(RELEASE_DELIVERY)
}

const CLAIM = { source: "saga:place-order", eventId: "event-1" }

describe("releaseDeliveryClaim", () => {
    it("uses the protected delivery delete through the migration's transaction", async () => {
        const release = await build()
        const transaction = fakeTransaction(mockEntityManager({ query: [RELEASE_EVENT, []] }))

        await transaction.em.transaction((manager) => release(manager, CLAIM))

        expect(transaction.em.query).toHaveBeenCalledWith(RELEASE_EVENT, [CLAIM.source, CLAIM.eventId])
        expect(transaction.commits).toBe(1)
    })

    it("refuses to release a receipt outside an active migration transaction", async () => {
        const release = await build()
        const manager = mockEntityManager()

        await expect(release(manager, CLAIM)).rejects.toMatchObject({ code: InboxErrorCode.TransactionRequired })

        expect(manager.query).not.toHaveBeenCalled()
    })

    it("propagates a failed delete so restoring and releasing the receipt roll back together", async () => {
        const release = await build()
        const manager = mockEntityManager()
        const failure = new Error("delivery claim release failed")
        manager.query.mockRejectedValueOnce(failure)
        const transaction = fakeTransaction(manager)

        await expect(transaction.em.transaction((tx) => release(tx, CLAIM))).rejects.toBe(failure)

        expect(transaction.rollbacks).toBe(1)
        expect(transaction.committedWrites).toEqual([])
    })
})
