/** The pgmq queue that holds a delivery a consumer group gave up on, read and requeued by an operator (BE-EVENT-BUS-4). */
export const EVENT_BUS_DEAD_LETTER_TOPIC_QUEUE = "event_bus_dead_letter"

/** The base of each typed event in modules/events: its stable identity, name and payload. */
export abstract class BaseEvent {
    /** A receiver uses this stable identity to deduplicate redelivery. */
    abstract readonly eventId: string
    /** The event name listed by the service's vendored event contract; it is the pgmq topic routing key. */
    abstract readonly eventName: string
    /** The fact that a reactor processes after commit. */
    abstract readonly payload: object
}

/** Parsing either returns the event or refuses a mismatched envelope. */
export type ParsedEvent<Event extends BaseEvent> = Event | null

/** The class side of a typed event, shared by publishers and consumers. */
export interface EventClass<Event extends BaseEvent> {
    /** The contract's event name. */
    readonly eventName: string
    /** The contract's payload version. */
    readonly version: number
    /** Reads the event from its envelope. */
    parse(envelope: unknown): ParsedEvent<Event>
}

/** One committed delivery received by a reactor. */
export interface EventDelivery<Event extends BaseEvent> {
    /** The request id carried explicitly from intake to delivery. */
    readonly correlationId: string
    /** The consumer's idempotency key. */
    readonly eventId: string
    /** The typed event. */
    readonly event: Event
    /** The number of attempts, including this one. */
    readonly attempt: number
}

/** Explicit request context carried independently of the business payload. */
export interface EventMetadata {
    /** The originating request or promoted event identity. */
    readonly correlationId: string
}

/** The typed event's envelope, sent to every queue bound to its name in the publisher's transaction. */
export interface EventEnvelope {
    /** The originating request context, independent of the business payload. */
    readonly metadata: EventMetadata
    /** The stable event id. */
    readonly eventId: string
    /** The contract's event name. */
    readonly eventName: string
    /** The data of the fact. */
    readonly payload: object
}

/** One message of a consumer group's queue, as event_bus_read returns it. */
export interface EventMessage {
    /** The pgmq message id within its queue. */
    readonly msgId: string
    /** How many times the message has been read, including this read. */
    readonly readCt: number
    /** The envelope as the publisher sent it; untrusted until parsed. */
    readonly message: unknown
}

/** A delivery a consumer group buried, as the dead-letter queue holds it. */
export interface DeadLetter {
    /** The message id in the dead-letter queue: what requeue takes. */
    readonly id: string
    /** The consumer group's queue the delivery came from. */
    readonly queue: string
    /** Why it was buried: its attempts ran out, or its envelope was malformed. */
    readonly reason: string
    /** The envelope as it was read. */
    readonly message: unknown
}
