import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Codes of the database capability. */
export enum DatabaseErrorCode {
    /** A configured connection has no declared EntityManager injection token. */
    ConnectionUndeclared = "DATABASE_CONNECTION_UNDECLARED",
    /** A dynamic SQL identifier was not on the names its caller allows. */
    IdentifierRejected = "DATABASE_IDENTIFIER_REJECTED",
    /** A RETURNING statement answered something other than rows of the shape its caller expects. */
    ReturningRowRejected = "DATABASE_RETURNING_ROW_REJECTED",
}

/** How each database code travels. */
export const DATABASE_ERROR_KINDS: Record<DatabaseErrorCode, ErrorKind> = {
    [DatabaseErrorCode.ConnectionUndeclared]: "internal",
    [DatabaseErrorCode.IdentifierRejected]: "internal",
    [DatabaseErrorCode.ReturningRowRejected]: "internal",
}

/** The one error class of the database capability. */
export class DatabaseError extends DomainError<DatabaseErrorCode> {}
