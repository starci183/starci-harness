import { Test } from "@nestjs/testing"
import { fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { EventBusErrorCode } from "./errors/event-bus.error"
import { BaseEvent } from "./event-bus.contracts"
import { EventBusService } from "./event-bus.service"

// The statements callDbFunction of platform/database sends for the bus functions of the migration.
const SEND = "SELECT * FROM event_bus_send($1, $2)"
const DEAD_LETTERS = "SELECT * FROM event_bus_dead_letters($1)"
const REQUEUE = "SELECT * FROM event_bus_requeue($1)"

class ReceiptRecordedEvent extends BaseEvent {
    readonly eventId = "receipt-1"
    readonly eventName = "spec.delivery-recorded"
    readonly payload = { receiptId: "receipt-1" }
}

describe("EventBusService", () => {
    const build = async (primary = mockEntityManager({})) => {
        const module = await Test.createTestingModule({
            providers: [EventBusService, { provide: PRIMARY_ENTITY_MANAGER, useValue: primary }],
        }).compile()
        return module.get(EventBusService)
    }

    it.each(["", "unsafe\nid", "x".repeat(129)])("refuses invalid correlation before SQL: %s", async (correlationId) => {
        const subject = await build()
        const manager = mockEntityManager({ query: [SEND, [{ event_bus_send: 1 }]] })

        await expect(subject.publish(new ReceiptRecordedEvent(), manager, correlationId)).rejects.toMatchObject({
            code: EventBusErrorCode.CorrelationInvalid,
        })
        expect(manager.query).not.toHaveBeenCalled()
    })

    it("sends the typed envelope to the event's topic through the publisher's transaction", async () => {
        const subject = await build()
        const transaction = fakeTransaction(mockEntityManager({ query: [SEND, [{ event_bus_send: 1 }]] }))
        const event = new ReceiptRecordedEvent()

        await transaction.em.transaction((manager) => subject.publish(event, manager, "request-1"))

        expect(transaction.em.query).toHaveBeenCalledWith(SEND, [
            "spec.delivery-recorded",
            JSON.stringify({ metadata: { correlationId: "request-1" }, eventId: event.eventId, eventName: event.eventName, payload: event.payload }),
        ])
        expect(transaction.commits).toBe(1)
    })

    it("propagates a send failure so the publisher's transaction rolls back and nothing is sent", async () => {
        const subject = await build()
        const manager = mockEntityManager({ query: [SEND, []] })
        jest.spyOn(manager, "query").mockRejectedValue(new Error("pgmq unavailable"))
        const transaction = fakeTransaction(manager)

        await expect(transaction.em.transaction((tx) => subject.publish(new ReceiptRecordedEvent(), tx, "request-1"))).rejects.toThrow("pgmq unavailable")

        expect(transaction.commits).toBe(0)
        expect(transaction.rollbacks).toBe(1)
    })

    it("lists buried deliveries and requeues one by its dead-letter id", async () => {
        const primary = mockEntityManager({
            query: [
                [DEAD_LETTERS, [{ msg_id: "7", message: { queue: "spec_delivery_recorded_mailer", reason: "attempts", message: { eventId: "receipt-1" } } }]],
                [REQUEUE, [{ event_bus_requeue: true }]],
            ],
        })
        const subject = await build(primary)

        await expect(subject.deadLetters(10)).resolves.toEqual([
            { id: "7", queue: "spec_delivery_recorded_mailer", reason: "attempts", message: { eventId: "receipt-1" } },
        ])
        await expect(subject.requeue("7")).resolves.toBe(true)
        expect(primary.query).toHaveBeenCalledWith(REQUEUE, ["7"])
    })
})
