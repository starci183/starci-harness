import { fakeInbox, fakeTransaction, mockEntityManager, recordingEventBus } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { DatabaseErrorCode, PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { @@Provider@@DeliveryRecordedEvent } from "@modules/events/@@provider@@"
import { EVENT_BUS } from "@modules/platform/event-bus"
import { INBOX } from "@modules/platform/inbox"
import { @@Provider@@InboxEntity } from "./persistence/entities/@@provider@@-inbox.entity"
import { @@Provider@@InboxService } from "./@@provider@@-inbox.service"

const DELIVERY = { id: "delivery-1" }
const SOURCE = "webhook.@@provider@@"

const build = async () => {
    const entityManager = mockEntityManager()
    const transaction = fakeTransaction(entityManager)
    const claims = fakeInbox()
    const events = recordingEventBus<@@Provider@@DeliveryRecordedEvent>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            @@Provider@@InboxService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: INBOX, useValue: claims },
            { provide: EVENT_BUS, useValue: events },
        ],
    }).compile()
    return { inbox: moduleRef.get(@@Provider@@InboxService), claims, events, entityManager, transaction }
}

describe("@@Provider@@InboxService", () => {
    describe("record@@Provider@@Delivery", () => {
        it("claims, records the receipt row and publishes a typed event in the same transaction", async () => {
            const { inbox, claims, events, entityManager, transaction } = await build()

            await inbox.record@@Provider@@Delivery({ eventId: "delivery-1", delivery: DELIVERY, correlationId: "request-1" })

            expect(claims.claims).toEqual([{ source: SOURCE, eventId: "delivery-1" }])
            expect(claims.receipts).toEqual([
                {
                    id: "receipt-1",
                    source: SOURCE,
                    eventId: "delivery-1",
                    entity: @@Provider@@InboxEntity,
                    row: { provider: "@@provider@@", deliveryId: "delivery-1", payload: DELIVERY },
                    tx: events.entries[0]?.tx,
                    inTransaction: true,
                },
            ])
            expect(events.events).toEqual([@@Provider@@DeliveryRecordedEvent.create({ receiptId: "receipt-1" })])
            expect(events.allInTransaction).toBe(true)
            expect(events.entries[0]?.tx).not.toBe(entityManager)
            expect(transaction.commits).toBe(1)
        })

        it("acknowledges a duplicate @@provider@@ delivery without further work", async () => {
            const { inbox, claims, events, transaction } = await build()
            claims.seen(SOURCE, "delivery-1")

            await inbox.record@@Provider@@Delivery({ eventId: "delivery-1", delivery: DELIVERY, correlationId: "request-1" })

            expect(claims.receipts).toEqual([])
            expect(events.events).toEqual([])
            expect(transaction.commits).toBe(1)
        })

        it("does not publish for an already recorded receipt", async () => {
            const { inbox, claims, events, transaction } = await build()
            claims.receiptExists(SOURCE, "delivery-1")

            await inbox.record@@Provider@@Delivery({ eventId: "delivery-1", delivery: DELIVERY, correlationId: "request-1" })

            expect(claims.receipts).toEqual([])
            expect(events.events).toEqual([])
            expect(transaction.commits).toBe(1)
        })

        it("refuses a delivery without an id before recording anything", async () => {
            const { inbox, claims, events, transaction } = await build()

            await expect(inbox.record@@Provider@@Delivery({ eventId: undefined, delivery: DELIVERY, correlationId: "request-1" })).rejects.toMatchObject({
                code: DatabaseErrorCode.WebhookDeliveryIdRequired,
            })

            expect(claims.receipts).toEqual([])
            expect(events.events).toEqual([])
            expect(transaction.rollbacks).toBe(1)
        })

        it("rolls back the receipt when publishing fails", async () => {
            const { inbox, events, transaction } = await build()
            const failure = new Error("event bus unavailable")
            events.failNext("publish", failure)

            await expect(inbox.record@@Provider@@Delivery({ eventId: "delivery-1", delivery: DELIVERY, correlationId: "request-1" })).rejects.toBe(failure)

            expect(transaction.rollbacks).toBe(1)
            expect(transaction.commits).toBe(0)
        })
    })
})
