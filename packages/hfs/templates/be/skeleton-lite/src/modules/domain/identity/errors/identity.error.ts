import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Codes of the identity capability: the sign-in refusals travel under these wire codes, the same on both sides of the doors. */
export enum IdentityErrorCode {
    /** The door needs a signed-in caller and the request establishes none. */
    Unauthenticated = "IDENTITY_UNAUTHENTICATED",
    /** The refresh token is unknown, expired or already spent. */
    RefreshInvalid = "IDENTITY_REFRESH_INVALID",
    /** A rotated refresh token was presented again: the session was ended. */
    RefreshReused = "IDENTITY_REFRESH_REUSED",
    /** The account is deleted or banned. */
    AccountDisabled = "IDENTITY_ACCOUNT_DISABLED",
    /** Too many failed attempts for this address; try again later. */
    TooManyAttempts = "IDENTITY_TOO_MANY_ATTEMPTS",
    /** The pair of address and password is wrong (the same answer for an unknown address). */
    PairRefused = "IDENTITY_INVALID_CREDENTIALS",
    /** The mailbox was never confirmed. */
    EmailNotConfirmed = "IDENTITY_EMAIL_NOT_CONFIRMED",
}

/** How each identity code travels. */
export const IDENTITY_ERROR_KINDS: Record<IdentityErrorCode, ErrorKind> = {
    [IdentityErrorCode.Unauthenticated]: "unauthenticated",
    [IdentityErrorCode.RefreshInvalid]: "unauthenticated",
    [IdentityErrorCode.RefreshReused]: "unauthenticated",
    [IdentityErrorCode.AccountDisabled]: "forbidden",
    [IdentityErrorCode.TooManyAttempts]: "rate-limited",
    [IdentityErrorCode.PairRefused]: "unauthenticated",
    [IdentityErrorCode.EmailNotConfirmed]: "forbidden",
}

/** The one error class of the identity capability. */
export class IdentityError extends DomainError<IdentityErrorCode> {}
