import { IdempotencyError, IdempotencyErrorCode } from "@modules/platform/idempotency"
import type { ClientOperation } from "./inbox.port"

/** Builds the authenticated operation scope after checking that its separators and bounded key are unambiguous. */
export const clientSource = (request: ClientOperation): string => {
    if (
        !request.principalId.trim() ||
        request.principalId.includes(":") ||
        !request.operation.trim() ||
        request.operation.includes(":") ||
        !request.idempotencyKey.trim() ||
        request.idempotencyKey.length > 64
    ) {
        throw new IdempotencyError({ code: IdempotencyErrorCode.RequestInvalid })
    }
    return `client:${request.principalId}:${request.operation}`
}
