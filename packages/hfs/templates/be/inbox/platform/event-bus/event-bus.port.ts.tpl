import type { EntityManager } from "typeorm"
import type { BaseEvent, DeadLetter, EventClass, EventDelivery } from "./event-bus.contracts"

/** The publishing and operator side of the lite event bus on pgmq. */
export interface EventBus {
    /** Sends the typed event to every queue bound to its name in the caller's transaction; a rollback sends nothing. */
    publish(event: BaseEvent, tx: EntityManager, correlationId: string): Promise<void>
    /** The oldest buried deliveries, at most `limit`, for an operator's cli command. */
    deadLetters(limit: number): Promise<ReadonlyArray<DeadLetter>>
    /** Sends one buried delivery back to the queue it came from; false when no dead letter has the id. */
    requeue(id: string): Promise<boolean>
}

/** A reactor's thin door: it reads one typed event and dispatches one command with the delivery's ids. */
export interface EventConsumer<Event extends BaseEvent> {
    /** The event class the consumer reads. */
    readonly event: EventClass<Event>
    /** Applies one delivery; a throw leaves the message to reappear after its visibility timeout. */
    handle(delivery: EventDelivery<Event>): Promise<void>
}

/** Where a reactor subscribes its consumer to its consumer group's queue; reading starts when the app has bootstrapped. */
export interface EventConsumerRegistry {
    /** Reads `queue` (a literal *_TOPIC_QUEUE constant a migration creates and binds to the event's name) for `consumer`. */
    subscribe<Event extends BaseEvent>(queue: string, consumer: EventConsumer<Event>): void
}
