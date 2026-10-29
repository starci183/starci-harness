import { BaseEvent } from "@modules/platform/event-bus"
import type { ParsedEvent } from "@modules/platform/event-bus"

/** A durable receipt reference; processing reads the provider payload after the intake commits. */
export interface @@Provider@@DeliveryRecordedPayload {
    /** The business key a consumer's inbox claims: the receipt, once per consumer however often it is delivered. */
    readonly dedupeKey: string
    readonly receiptId: string
}

/** Version 1 of `@@provider@@.delivery-recorded`, published once by the provider inbox intake. */
export class @@Provider@@DeliveryRecordedEvent extends BaseEvent {
    static readonly eventName = "@@provider@@.delivery-recorded"
    static readonly version = 1

    readonly eventName = @@Provider@@DeliveryRecordedEvent.eventName

    private constructor(
        readonly eventId: string,
        readonly payload: @@Provider@@DeliveryRecordedPayload,
    ) {
        super()
    }

    /** The receipt identity is stable across redeliveries and distinct from a consumer's inbox source. */
    static create(payload: Omit<@@Provider@@DeliveryRecordedPayload, "dedupeKey">): @@Provider@@DeliveryRecordedEvent {
        return new @@Provider@@DeliveryRecordedEvent(payload.receiptId, { dedupeKey: payload.receiptId, receiptId: payload.receiptId })
    }

    /** Reads the event envelope; malformed deliveries never reach a processing consumer. */
    static parse(envelope: unknown): ParsedEvent<@@Provider@@DeliveryRecordedEvent> {
        if (typeof envelope !== "object" || envelope === null || !("eventId" in envelope) || !("payload" in envelope)) return null
        const { eventId, payload } = envelope
        if (typeof eventId !== "string" || !eventId.trim() || typeof payload !== "object" || payload === null || !("receiptId" in payload)) return null
        if (typeof payload.receiptId !== "string" || !payload.receiptId.trim()) return null
        return new @@Provider@@DeliveryRecordedEvent(eventId, { dedupeKey: payload.receiptId, receiptId: payload.receiptId })
    }
}
