import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Codes of the event-bus capability. */
export enum EventBusErrorCode {
    /** A publisher supplied an unsafe or unbounded request identity. */
    CorrelationInvalid = "EVENT_BUS_CORRELATION_INVALID",
}

/** How each event-bus code travels. */
export const EVENT_BUS_ERROR_KINDS: Record<EventBusErrorCode, ErrorKind> = {
    [EventBusErrorCode.CorrelationInvalid]: "invalid",
}

/** The one error class of the event-bus capability. */
export class EventBusError extends DomainError<EventBusErrorCode> {}
