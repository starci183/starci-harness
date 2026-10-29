import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** Codes of the passport integration. */
export enum PassportErrorCode {
    /** The access token failed signature or required-claim verification. */
    AccessTokenInvalid = "PASSPORT_ACCESS_TOKEN_INVALID",
    /** The email and password do not match an account. */
    CredentialsRefused = "PASSPORT_CREDENTIALS_REFUSED",
    /** The OAuth state or PKCE verifier of a callback does not match the request that started it. */
    OAuthStateInvalid = "PASSPORT_OAUTH_STATE_INVALID",
}

/** How each passport integration code travels. */
export const PASSPORT_ERROR_KINDS: Record<PassportErrorCode, ErrorKind> = {
    [PassportErrorCode.AccessTokenInvalid]: "unauthenticated",
    [PassportErrorCode.CredentialsRefused]: "unauthenticated",
    [PassportErrorCode.OAuthStateInvalid]: "unauthenticated",
}

/** The one error class of the passport integration. */
export class PassportError extends DomainError<PassportErrorCode> {}
