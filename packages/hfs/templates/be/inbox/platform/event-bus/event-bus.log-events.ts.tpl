/** Log events of the event bus. */
export enum EventBusLogEvent {
    /** A consumer threw; the message reappears after its visibility timeout. */
    ConsumerFailed = "event-bus.consumer.failed",
    /** A delivery ran out of deliveries or was malformed and moved to its consumer's dead-letter queue. */
    DeliveryDead = "event-bus.delivery.dead",
    /** A read of a consumer's queue failed; the loop reads again after its idle pause. */
    ReadFailed = "event-bus.read.failed",
}
