import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { isCorrelationId } from "@modules/platform/logging"
import { callDbFunction, InjectPrimaryEntityManager } from "@modules/platform/database"
import { EventBusError, EventBusErrorCode } from "./errors/event-bus.error"
import type { BaseEvent, DeadLetter, EventEnvelope } from "./event-bus.contracts"
import type { EventBus } from "./event-bus.port"

/** One row of event_bus_dead_letters: pgmq returns the bigint id as text. */
interface DeadLetterRow {
    readonly msg_id: string
    readonly message: { readonly queue?: unknown; readonly reason?: unknown; readonly message?: unknown }
}

/** The one row event_bus_requeue answers. */
interface RequeueRow {
    readonly event_bus_requeue: boolean | null
}

@Injectable()
/** Sends a typed event to its pgmq topic inside the publisher's transaction; no outbox and no relay stand between them. */
export class EventBusService implements EventBus {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The send commits or rolls back with the change; every queue bound to the event's name receives it once. */
    async publish(event: BaseEvent, tx: EntityManager, correlationId: string): Promise<void> {
        if (!isCorrelationId(correlationId)) throw new EventBusError({ code: EventBusErrorCode.CorrelationInvalid })
        const envelope: EventEnvelope = {
            metadata: { correlationId },
            eventId: event.eventId,
            eventName: event.eventName,
            payload: event.payload,
        }
        await callDbFunction(tx, "event_bus_send", [event.eventName, JSON.stringify(envelope)])
    }

    async deadLetters(limit: number): Promise<ReadonlyArray<DeadLetter>> {
        const rows = await callDbFunction<DeadLetterRow>(this.entityManager, "event_bus_dead_letters", [limit])
        return rows.map((row) => ({
            id: row.msg_id,
            queue: String(row.message.queue),
            reason: String(row.message.reason),
            message: row.message.message,
        }))
    }

    async requeue(id: string): Promise<boolean> {
        const [row] = await callDbFunction<RequeueRow>(this.entityManager, "event_bus_requeue", [id])
        return row?.event_bus_requeue === true
    }
}
