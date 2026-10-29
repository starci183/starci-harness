/** Log events of the event bus. */
export enum EventBusLogEvent {
    /** A consumer threw; the message reappears after its visibility timeout. */
    ConsumerFailed = "event-bus.consumer.failed",
    /** A delivery ran out of attempts or was malformed and went to the dead-letter queue. */
    DeliveryBuried = "event-bus.delivery.buried",
    /** A read of a consumer group's queue failed; the loop reads again after its idle pause. */
    ReadFailed = "event-bus.read.failed",
}
