import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Codes of the queue capability. */
export enum QueueErrorCode {
    /** Stored job data does not satisfy the delivery envelope contract. */
    MalformedMessage = "QUEUE_MALFORMED_MESSAGE",
    /** A producer supplied an identity that is unsafe or unbounded. */
    CorrelationInvalid = "QUEUE_CORRELATION_INVALID",
}

/** How each queue code travels. */
export const QUEUE_ERROR_KINDS: Record<QueueErrorCode, ErrorKind> = {
    [QueueErrorCode.MalformedMessage]: "internal",
    [QueueErrorCode.CorrelationInvalid]: "invalid",
}

/** The queue capability's failures, retained by the broker for inspection and retry. */
export class QueueError extends DomainError<QueueErrorCode> {}
