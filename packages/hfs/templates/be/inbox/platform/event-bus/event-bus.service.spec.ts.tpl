import { Test } from "@nestjs/testing"
import { fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { EventBusErrorCode } from "./errors/event-bus.error"
import { BaseEvent } from "./event-bus.contracts"
import { EventBusService } from "./event-bus.service"

// The statement callDbFunction of platform/database sends for event_bus_write.
const INSERT_OUTBOX_EVENT = "SELECT * FROM event_bus_write($1, $2, $3, $4)"

class ReceiptRecordedEvent extends BaseEvent {
    readonly eventId = "receipt-1"
    readonly eventName = "spec.delivery-recorded"
    readonly payload = { receiptId: "receipt-1" }
}

describe("EventBusService", () => {
    const build = async () => {
        const module = await Test.createTestingModule({ providers: [EventBusService] }).compile()
        return module.get(EventBusService)
    }

    it.each(["", "unsafe\nid", "x".repeat(129)])("refuses invalid correlation before SQL: %s", async (correlationId) => {
        const subject = await build()
        const manager = mockEntityManager({ query: [INSERT_OUTBOX_EVENT, []] })

        await expect(subject.publish(new ReceiptRecordedEvent(), manager, correlationId)).rejects.toMatchObject({
            code: EventBusErrorCode.CorrelationInvalid,
        })
        expect(manager.query).not.toHaveBeenCalled()
    })

    it("writes the typed envelope through the receipt transaction", async () => {
        const subject = await build()
        const transaction = fakeTransaction(mockEntityManager({ query: [INSERT_OUTBOX_EVENT, []] }))
        const event = new ReceiptRecordedEvent()

        await transaction.em.transaction((manager) => subject.publish(event, manager, "request-1"))

        expect(transaction.em.query).toHaveBeenCalledWith(INSERT_OUTBOX_EVENT, [
            "receipt-1",
            "spec.delivery-recorded",
            JSON.stringify({ metadata: { correlationId: "request-1" }, eventId: event.eventId, eventName: event.eventName, payload: event.payload }),
            "request-1",
        ])
        expect(transaction.commits).toBe(1)
    })

    it("propagates an outbox failure so the receipt transaction rolls back", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [INSERT_OUTBOX_EVENT, []] })
        jest.spyOn(manager, "query").mockRejectedValue(new Error("outbox unavailable"))
        const transaction = fakeTransaction(manager)

        await expect(transaction.em.transaction((tx) => subject.publish(new ReceiptRecordedEvent(), tx, "request-1"))).rejects.toThrow("outbox unavailable")

        expect(transaction.commits).toBe(0)
        expect(transaction.rollbacks).toBe(1)
    })
})
