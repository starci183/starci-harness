import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the passport integration: the wire codes @starci/auth names for the token, key, Google, sign-in provider and API-key legs (the kit spec holds the parity). */
export enum PassportErrorCode {
    /** The access token failed signature, issuer, audience or expiry verification. */
    AccessTokenInvalid = "PASSPORT_ACCESS_TOKEN_INVALID",
    /** The signing key set is unusable. */
    KeyInvalid = "PASSPORT_KEY_INVALID",
    /** The request carried no email or password. */
    MissingCredentials = "PASSPORT_MISSING_CREDENTIALS",
    /** The Google round trip could not be proven to be ours (state, PKCE or cookie). */
    GoogleStateInvalid = "PASSPORT_GOOGLE_STATE_INVALID",
    /** Google refused the consent or answered no usable account. */
    GoogleRejected = "PASSPORT_GOOGLE_REJECTED",
    /** This deployment has no Google client. */
    GoogleUnavailable = "PASSPORT_GOOGLE_UNAVAILABLE",
    /** A sign-in provider round trip could not be proven to be ours (state, PKCE or cookie). */
    ProviderStateInvalid = "PASSPORT_PROVIDER_STATE_INVALID",
    /** A sign-in provider refused the consent or answered no usable account. */
    ProviderRejected = "PASSPORT_PROVIDER_REJECTED",
    /** This deployment has no client for the named sign-in provider. */
    ProviderUnavailable = "PASSPORT_PROVIDER_UNAVAILABLE",
    /** The configured sign-in providers cannot be served (one named twice, or an id that cannot be a door path). */
    ProvidersInvalid = "PASSPORT_PROVIDERS_INVALID",
    /** An API key was refused (missing, malformed, ambiguous, unknown, wrong secret, revoked or expired); the reason stays in the log and never reaches the wire. */
    ApiKeyRejected = "PASSPORT_API_KEY_REJECTED",
    /** A key text, id or prefix is outside the API-key format. */
    ApiKeyMalformed = "PASSPORT_API_KEY_MALFORMED",
    /** A stored API-key record is unusable (its hash is no SHA-256). */
    ApiKeyRecordInvalid = "PASSPORT_API_KEY_RECORD_INVALID",
}

/** How each passport code travels. */
export const PASSPORT_ERROR_KINDS: Record<PassportErrorCode, ErrorKind> = {
    [PassportErrorCode.AccessTokenInvalid]: "unauthenticated",
    [PassportErrorCode.KeyInvalid]: "internal",
    [PassportErrorCode.MissingCredentials]: "invalid",
    [PassportErrorCode.GoogleStateInvalid]: "unauthenticated",
    [PassportErrorCode.GoogleRejected]: "unauthenticated",
    [PassportErrorCode.GoogleUnavailable]: "unavailable",
    [PassportErrorCode.ProviderStateInvalid]: "unauthenticated",
    [PassportErrorCode.ProviderRejected]: "unauthenticated",
    [PassportErrorCode.ProviderUnavailable]: "unavailable",
    [PassportErrorCode.ProvidersInvalid]: "internal",
    [PassportErrorCode.ApiKeyRejected]: "unauthenticated",
    [PassportErrorCode.ApiKeyMalformed]: "invalid",
    [PassportErrorCode.ApiKeyRecordInvalid]: "internal",
}

/** The one error class of the passport integration. */
export class PassportError extends DomainError<PassportErrorCode> {}
