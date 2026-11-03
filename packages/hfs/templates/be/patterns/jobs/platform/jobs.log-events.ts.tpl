/** Log events of the jobs. */
export enum JobsLogEvent {
    /** A write of a stale worker was refused: a newer worker owns the job and this one stopped with no further effect. */
    FencedOut = "jobs.fenced-out",
    /** A delivery failed and the job was marked failed for BullMQ to retry. */
    DeliveryFailed = "jobs.delivery.failed",
    /** A failed delivery could not even be recorded as failed; the lease will expire and the job will be claimed again. */
    FailureNotRecorded = "jobs.delivery.failure-not-recorded",
    /** A job failed in a way a retry cannot fix and was parked as failed_awaiting_fix with its one alert. */
    Parked = "jobs.parked",
    /** The alert of a parked job could not be raised; the job stays parked and the owner list still shows it. */
    AlertFailed = "jobs.parked.alert-failed",
    /** Parked jobs were handed back to their queues: at boot under a new build, by the sweep, or on demand. */
    Resumed = "jobs.resumed",
    /** A parked job could not be handed back to its queue; the next resume tries it again. */
    ResumeFailed = "jobs.resume.failed",
    /** A scheduler tick failed to fire; the next firing claims its own minute (lite, R335). */
    TickFailed = "jobs.tick.failed",
}
