import { Test } from "@nestjs/testing"
import { mockEntityManager } from "@starci/jest-preset"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import { BaseEvent } from "./event-bus.contracts"
import type { EventDelivery, ParsedEvent } from "./event-bus.contracts"
import { MODULE_OPTIONS_TOKEN } from "./event-bus.module-definition"
import type { EventConsumer } from "./event-bus.port"
import { EventConsumerService } from "./event-consumer.service"

// The statements callDbFunction of platform/database sends for the bus functions of the migration.
const READ = "SELECT * FROM event_bus_read($1, $2, $3)"
const ARCHIVE = "SELECT * FROM event_bus_archive($1, $2)"
const BURY = "SELECT * FROM event_bus_bury($1, $2, $3, $4, $5)"
const QUEUE = "spec_delivery_recorded__mailer"

class ReceiptRecordedEvent extends BaseEvent {
    static readonly eventName = "spec.delivery-recorded"
    static readonly version = 1
    readonly eventName = ReceiptRecordedEvent.eventName

    constructor(
        readonly eventId: string,
        readonly payload: { readonly dedupeKey: string; readonly receiptId: string },
    ) {
        super()
    }

    static parse(envelope: unknown): ParsedEvent<ReceiptRecordedEvent> {
        if (typeof envelope !== "object" || envelope === null || !("eventId" in envelope) || typeof envelope.eventId !== "string") return null
        if (!("payload" in envelope) || typeof envelope.payload !== "object" || envelope.payload === null || !("dedupeKey" in envelope.payload)) return null
        const dedupeKey = envelope.payload.dedupeKey
        return typeof dedupeKey === "string" ? new ReceiptRecordedEvent(envelope.eventId, { dedupeKey, receiptId: dedupeKey }) : null
    }
}

const envelope = {
    metadata: { correlationId: "request-1" },
    eventId: "event-1",
    eventName: "spec.delivery-recorded",
    payload: { dedupeKey: "receipt-1", receiptId: "receipt-1" },
}

class RecordingConsumer implements EventConsumer<ReceiptRecordedEvent> {
    readonly event = ReceiptRecordedEvent
    readonly deliveries: Array<EventDelivery<ReceiptRecordedEvent>> = []
    failing = false

    handle(delivery: EventDelivery<ReceiptRecordedEvent>): Promise<void> {
        if (this.failing) return Promise.reject(new Error("consumer down"))
        this.deliveries.push(delivery)
        return Promise.resolve()
    }
}

describe("EventConsumerService", () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

    const build = async (primary: ReturnType<typeof mockEntityManager>) => {
        const module = await Test.createTestingModule({
            providers: [
                EventConsumerService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: primary },
                { provide: MODULE_OPTIONS_TOKEN, useValue: {} },
                { provide: LOGGER, useValue: logger },
            ],
        }).compile()
        return module.get(EventConsumerService)
    }

    it("delivers a committed event once to the consumer with its inbox claim keys and archives it", async () => {
        const primary = mockEntityManager({
            query: [
                [READ, [{ msg_id: "1", read_ct: 1, message: envelope }]],
                [ARCHIVE, [{ event_bus_archive: true }]],
            ],
        })
        const subject = await build(primary)
        const consumer = new RecordingConsumer()

        await expect(subject.drain({ queue: QUEUE, consumer, maxDeliveries: 5 })).resolves.toBe(1)

        expect(consumer.deliveries).toEqual([
            { correlationId: "request-1", eventId: "event-1", consumer: QUEUE, dedupeKey: "receipt-1", event: expect.any(ReceiptRecordedEvent), attempt: 1 },
        ])
        expect(primary.query).toHaveBeenCalledWith(READ, [QUEUE, 30, 10])
        expect(primary.query).toHaveBeenCalledWith(ARCHIVE, [QUEUE, "1"])
    })

    it("leaves a failed delivery to reappear after its visibility timeout", async () => {
        const primary = mockEntityManager({ query: [READ, [{ msg_id: "1", read_ct: 2, message: envelope }]] })
        const subject = await build(primary)
        const consumer = new RecordingConsumer()
        consumer.failing = true

        await subject.drain({ queue: QUEUE, consumer, maxDeliveries: 5 })

        expect(primary.query).toHaveBeenCalledTimes(1)
        expect(logger.error).toHaveBeenCalled()
    })

    it.each([
        ["max-deliveries", { msg_id: "1", read_ct: 4, message: envelope }],
        ["malformed", { msg_id: "1", read_ct: 1, message: { eventId: 42 } }],
        ["malformed", { msg_id: "1", read_ct: 1, message: { ...envelope, payload: { dedupeKey: " ", receiptId: "receipt-1" } } }],
        ["malformed", { msg_id: "1", read_ct: 1, message: { ...envelope, metadata: { correlationId: "unsafe\nid" } } }],
    ])("moves a delivery to the consumer's dead-letter queue: %s", async (reason, row) => {
        const primary = mockEntityManager({ query: [[READ, [row]], [BURY, [{ event_bus_bury: true }]]] })
        const subject = await build(primary)
        const consumer = new RecordingConsumer()

        await subject.drain({ queue: QUEUE, consumer, maxDeliveries: 3 })

        expect(consumer.deliveries).toEqual([])
        expect(primary.query).toHaveBeenCalledWith(BURY, [QUEUE, "1", row.read_ct, JSON.stringify(row.message), reason])
    })

    it("takes the default delivery budget of a subscription that names none", async () => {
        const primary = mockEntityManager({ query: [[READ, [{ msg_id: "1", read_ct: 6, message: envelope }]], [BURY, [{ event_bus_bury: true }]]] })
        const subject = await build(primary)
        const consumer = new RecordingConsumer()
        subject.subscribe(QUEUE, consumer)

        await subject.drain({ queue: QUEUE, consumer, maxDeliveries: 5 })

        expect(primary.query).toHaveBeenCalledWith(BURY, [QUEUE, "1", 6, JSON.stringify(envelope), "max-deliveries"])
    })

    it("delivers a redelivery again, leaving its dedupe to the consumer's inbox claim", async () => {
        const primary = mockEntityManager({
            query: [
                [READ, [{ msg_id: "1", read_ct: 2, message: envelope }]],
                [ARCHIVE, [{ event_bus_archive: true }]],
            ],
        })
        const subject = await build(primary)
        const consumer = new RecordingConsumer()

        await subject.drain({ queue: QUEUE, consumer, maxDeliveries: 5 })

        expect(consumer.deliveries.map((delivery) => [delivery.consumer, delivery.dedupeKey, delivery.attempt])).toEqual([[QUEUE, "receipt-1", 2]])
    })
})
