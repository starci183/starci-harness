import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { isCorrelationId } from "@modules/platform/logging"
import { EventBusError, EventBusErrorCode } from "./errors/event-bus.error"
import type { BaseEvent, EventEnvelope } from "./event-bus.contracts"
import type { EventBus } from "./event-bus.port"
import { callDbFunction } from "@modules/platform/database"

@Injectable()
/** Writes a receipt event into the same transaction as its inbox receipt, without running any consumer. */
export class EventBusService implements EventBus {
    /** The outbox commits or rolls back with the receipt; only a later reactor or job processes it. */
    async publish(event: BaseEvent, tx: EntityManager, correlationId: string): Promise<void> {
        if (!isCorrelationId(correlationId)) throw new EventBusError({ code: EventBusErrorCode.CorrelationInvalid })
        const envelope: EventEnvelope = {
            metadata: { correlationId },
            eventId: event.eventId,
            eventName: event.eventName,
            payload: event.payload,
        }
        await callDbFunction(tx, "event_bus_write", [event.eventId, event.eventName, JSON.stringify(envelope), correlationId])
    }
}
