/** Log events of the queues. */
export enum QueueLogEvent {
    /** A scheduler could not be registered at boot. */
    SchedulerFailed = "queue.scheduler.failed",
    /** The producer's BullMQ driver reported an infrastructure error. */
    QueueFailed = "queue.driver.failed",
    /** A worker's BullMQ driver reported an infrastructure error. */
    WorkerFailed = "queue.worker.failed",
}
