/**
 * The suffix of a consumer's dead-letter queue: a delivery past its consumer's maxDeliveries moves from `<topic>__<consumer>` to
 * `<topic>__<consumer>__dead`, which an operator reads and replays (BE-EVENT-BUS-4).
 */
export const DEAD_QUEUE_SUFFIX = "__dead"

/** The deliveries a consumer gets before its message moves to the dead-letter queue, when its subscription names none. */
export const DEFAULT_MAX_DELIVERIES = 5

/** What every event payload carries: the business key a consumer's inbox claims, stable across redelivery and replay. */
export interface EventPayload {
    /** The business identity of the fact (an order id, a receipt id): the consumer claims (consumer, dedupeKey) once. */
    readonly dedupeKey: string
}

/** The base of each typed event in modules/events: its stable identity, name and payload. */
export abstract class BaseEvent {
    /** The stable identity of this event, carried for logs and tracing. */
    abstract readonly eventId: string
    /** The event name listed by the service's vendored event contract; it is the pgmq topic the event is sent to. */
    abstract readonly eventName: string
    /** The fact that a reactor processes after commit, with its business dedupe key. */
    abstract readonly payload: EventPayload
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
    /** The stable identity of the event. */
    readonly eventId: string
    /** The consumer's queue, `<topic>__<consumer>`: the first half of the inbox claim. */
    readonly consumer: string
    /** The payload's business key: the second half of the inbox claim. */
    readonly dedupeKey: string
    /** The typed event. */
    readonly event: Event
    /** The number of deliveries, including this one. */
    readonly attempt: number
}

/** Explicit request context carried independently of the business payload. */
export interface EventMetadata {
    /** The originating request or promoted event identity. */
    readonly correlationId: string
}

/** The typed event's envelope, sent once to its topic in the publisher's transaction and routed to every bound consumer queue. */
export interface EventEnvelope {
    /** The originating request context, independent of the business payload. */
    readonly metadata: EventMetadata
    /** The stable event id. */
    readonly eventId: string
    /** The contract's event name. */
    readonly eventName: string
    /** The data of the fact. */
    readonly payload: EventPayload
}

/** One message of a consumer's queue, as event_bus_read returns it. */
export interface EventMessage {
    /** The pgmq message id within its queue. */
    readonly msgId: string
    /** How many times the message has been read, including this read. */
    readonly readCt: number
    /** The envelope as the publisher sent it; untrusted until parsed. */
    readonly message: unknown
}

/** What a reactor's subscription may tune; every field is a literal of the subscription. */
export interface EventSubscriptionOptions {
    /** The deliveries before the message moves to the dead-letter queue. Default DEFAULT_MAX_DELIVERIES. */
    readonly maxDeliveries?: number
}

/** A delivery a consumer gave up on, as its dead-letter queue holds it. */
export interface DeadLetter {
    /** The message id in the dead-letter queue: what requeue takes. */
    readonly id: string
    /** Why it was moved: its deliveries ran out, or its envelope was malformed. */
    readonly reason: string
    /** The deliveries it had. */
    readonly readCount: number
    /** The envelope as it was read. */
    readonly message: unknown
}
