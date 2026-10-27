import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Codes of the queue capability. */
export enum QueueErrorCode {
    /** Redis did not write the jobs the relay added to its append-only file in time, so their outbox rows stay waiting. */
    NotPersisted = "QUEUE_NOT_PERSISTED",
    /** Redis no longer holds a job the relay added: it restarted before the job reached its append-only file. */
    JobLost = "QUEUE_JOB_LOST",
    /** Stored job data does not satisfy the delivery envelope contract. */
    MalformedMessage = "QUEUE_MALFORMED_MESSAGE",
    /** A producer supplied an identity that is unsafe or unbounded. */
    CorrelationInvalid = "QUEUE_CORRELATION_INVALID",
}

/** How each queue code travels. */
export const QUEUE_ERROR_KINDS: Record<QueueErrorCode, ErrorKind> = {
    [QueueErrorCode.NotPersisted]: "unavailable",
    [QueueErrorCode.JobLost]: "unavailable",
    [QueueErrorCode.MalformedMessage]: "internal",
    [QueueErrorCode.CorrelationInvalid]: "invalid",
}

/** The one error class of the queue capability. */
export class QueueError extends DomainError<QueueErrorCode> {}
