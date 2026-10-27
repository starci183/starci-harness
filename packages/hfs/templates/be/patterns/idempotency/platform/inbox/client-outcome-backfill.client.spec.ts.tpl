import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { InboxErrorCode } from "./errors/inbox.error"
import { requestFingerprint } from "./request-fingerprint.policy"
import { backfillClientOutcome } from "./client-outcome-backfill.client"
import { BACKFILL_CLIENT_OUTCOME } from "./persistence/inbox.sql"

const BACKFILL = Symbol("client-outcome-backfill")
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: BACKFILL, useValue: backfillClientOutcome }],
    }).compile()
    return moduleRef.get<typeof backfillClientOutcome>(BACKFILL)
}

const OPERATION = {
    principalId: "person-1",
    operation: "checkout.place-order",
    idempotencyKey: "legacy-key",
    request: {},
}
const OUTCOME = { kind: "ok", value: { orderId: "old-order", status: "pending" } }

describe("backfillClientOutcome", () => {
    it("records the legacy scoped key, original instant, fingerprint and original JSON outcome through the migration transaction", async () => {
        const backfill = await build()
        const manager = mockEntityManager({ query: [BACKFILL_CLIENT_OUTCOME, []] })
        const transaction = fakeTransaction(manager)
        const instant = new FakeClock("2026-01-01T00:00:00.000Z").now()

        await transaction.em.transaction((tx) => backfill(tx, OPERATION, OUTCOME, instant))

        expect(transaction.em.query).toHaveBeenCalledWith(BACKFILL_CLIENT_OUTCOME, [
            "client:person-1:checkout.place-order",
            "legacy-key",
            requestFingerprint({}),
            instant,
            '{"value":{"kind":"ok","value":{"orderId":"old-order","status":"pending"}}}',
        ])
        expect(transaction.commits).toBe(1)
    })

    it("refuses a migration outside its active transaction before recording anything", async () => {
        const backfill = await build()
        const manager = mockEntityManager()

        await expect(backfill(manager, OPERATION, OUTCOME, new FakeClock().now())).rejects.toMatchObject({
            code: InboxErrorCode.TransactionRequired,
        })

        expect(manager.query).not.toHaveBeenCalled()
    })

    it("propagates a failed insert so the domain migration rolls back", async () => {
        const backfill = await build()
        const manager = mockEntityManager()
        const failure = new Error("backfill insert failed")
        manager.query.mockRejectedValueOnce(failure)
        const transaction = fakeTransaction(manager)

        await expect(
            transaction.em.transaction((tx) => backfill(tx, OPERATION, OUTCOME, new FakeClock().now())),
        ).rejects.toBe(failure)
        expect(transaction.rollbacks).toBe(1)
    })
})
