import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Stable refusals and integrity errors of the shared client inbox. */
export enum InboxErrorCode {
    /** The caller supplied a manager outside an active domain transaction. */
    TransactionRequired = "INBOX_TRANSACTION_REQUIRED",
    /** The effect returned a value that is not plain JSON data, so no outcome can be stored or replayed. */
    OutcomeInvalid = "INBOX_OUTCOME_INVALID",
    /** The atomic claim or outcome write returned no completed row. */
    OutcomeMissing = "INBOX_OUTCOME_MISSING",
}

/** The shared transport mapping of inbox errors. */
export const INBOX_ERROR_KINDS: Record<InboxErrorCode, ErrorKind> = {
    [InboxErrorCode.OutcomeInvalid]: "internal",
    [InboxErrorCode.OutcomeMissing]: "internal",
    [InboxErrorCode.TransactionRequired]: "internal",
}

/** The error family of the inbox owner. */
export class InboxError extends DomainError<InboxErrorCode> {}
