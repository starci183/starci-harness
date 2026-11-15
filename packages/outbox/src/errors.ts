import { DomainError } from "@starci/common"
import type { ErrorKind } from "@starci/common"

/** The codes of the outbox. */
export const OutboxErrorCode = {
    /** An option is out of its range: a table name that is no plain identifier, a count or a duration that is no positive whole number. */
    OptionsInvalid: "OUTBOX_OPTIONS_INVALID",
    /** The once key holds no `:` between its parts, or the queue or the job name is empty. */
    JobInvalid: "OUTBOX_JOB_INVALID",
    /** Two handlers were given one job name. */
    HandlerDuplicate: "OUTBOX_HANDLER_DUPLICATE",
    /** No handler is registered under the name of a claimed job. */
    HandlerMissing: "OUTBOX_HANDLER_MISSING",
    /** A handler names a ladder the outbox does not declare. */
    LadderUnknown: "OUTBOX_LADDER_UNKNOWN",
    /** The payload guard of the handler refused the job's payload. */
    PayloadRefused: "OUTBOX_PAYLOAD_REFUSED",
    /** The lease of the job was lost before it settled: a newer claim owns the row now. */
    LeaseLost: "OUTBOX_LEASE_LOST",
} as const

/** One code of the outbox. */
export type OutboxErrorCode = (typeof OutboxErrorCode)[keyof typeof OutboxErrorCode]

/** How each outbox code travels. */
export const OUTBOX_ERROR_KINDS: Readonly<Record<OutboxErrorCode, ErrorKind>> = {
    OUTBOX_OPTIONS_INVALID: "internal",
    OUTBOX_JOB_INVALID: "invalid",
    OUTBOX_HANDLER_DUPLICATE: "internal",
    OUTBOX_HANDLER_MISSING: "internal",
    OUTBOX_LADDER_UNKNOWN: "internal",
    OUTBOX_PAYLOAD_REFUSED: "invalid",
    OUTBOX_LEASE_LOST: "unavailable",
}

/** The one error class of the outbox, a coded `DomainError` of `@starci/common`. */
export class OutboxError extends DomainError<OutboxErrorCode> {
    /** The failure class a runner reads (BE-RESILIENCE-2): a missing handler is a defect of the code, a refused payload is input. */
    get failureClass(): "code" | "input" | undefined {
        if (this.code === OutboxErrorCode.HandlerMissing) return "code"
        return this.code === OutboxErrorCode.PayloadRefused ? "input" : undefined
    }
}
