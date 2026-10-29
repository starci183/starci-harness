import type { EntityManager } from "typeorm"
import type { BaseEvent, DeadLetter, EventClass, EventDelivery, EventSubscriptionOptions } from "./event-bus.contracts"

/** The publishing and operator side of the lite event bus on pgmq. */
export interface EventBus {
    /** Sends the typed event once to its topic in the caller's transaction; pgmq routes it to every bound consumer queue, and a rollback sends nothing. */
    publish(event: BaseEvent, tx: EntityManager, correlationId: string): Promise<void>
    /** The oldest deliveries the consumer of `queue` gave up on, at most `limit`, for an operator's cli command. */
    deadLetters(queue: string, limit: number): Promise<ReadonlyArray<DeadLetter>>
    /** Sends one dead letter of `queue` back to that queue; false when it holds no dead letter with the id. */
    requeue(queue: string, id: string): Promise<boolean>
}

/** A reactor's thin door: it reads one typed event and dispatches one command with the delivery's ids. */
export interface EventConsumer<Event extends BaseEvent> {
    /** The event class the consumer reads. */
    readonly event: EventClass<Event>
    /** Applies one delivery; a throw leaves the message to reappear after its visibility timeout. */
    handle(delivery: EventDelivery<Event>): Promise<void>
}

/** Where a reactor subscribes its consumer; reading starts when the app has bootstrapped. */
export interface EventConsumerRegistry {
    /**
     * Reads `queue` for `consumer`. The queue is a literal `<TOPIC>_<CONSUMER>_TOPIC_QUEUE` constant of platform/event-bus whose
     * pgmq queue, dead-letter queue and topic binding a migration declares (R258); the subscription is static (R336).
     */
    subscribe<Event extends BaseEvent>(queue: string, consumer: EventConsumer<Event>, options?: EventSubscriptionOptions): void
}
