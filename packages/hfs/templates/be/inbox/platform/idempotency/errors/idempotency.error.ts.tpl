import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Stable client-operation refusals shared by transports and durable inbox adapters. */
export enum IdempotencyErrorCode {
    /** This principal's operation key was already used for a different request. */
    KeyReused = "IDEMPOTENCY_KEY_REUSED",
    /** The key, authenticated scope or JSON data cannot identify a valid operation. */
    RequestInvalid = "IDEMPOTENCY_REQUEST_INVALID",
}

/** Transport kinds of the public idempotency refusals. */
export const IDEMPOTENCY_ERROR_KINDS: Record<IdempotencyErrorCode, ErrorKind> = {
    [IdempotencyErrorCode.KeyReused]: "conflict",
    [IdempotencyErrorCode.RequestInvalid]: "invalid",
}

/** The public idempotency error family. */
export class IdempotencyError extends DomainError<IdempotencyErrorCode> {}
