/**
 * The contract both sides of the sign-in share: the door paths, the wire codes, the claim names and the shapes of the answers.
 * The server controller and the front-end client read these constants, so a door can never drift between them.
 */

/** The path prefix of every auth door. */
export const AUTH_PREFIX = "auth"

/** The REST doors of sign-in, relative to the API origin. */
export const AUTH_DOORS = {
    login: "/auth/login",
    signup: "/auth/signup",
    resend: "/auth/resend",
    confirm: "/auth/confirm",
    refresh: "/auth/refresh",
    session: "/auth/session",
    logout: "/auth/logout",
    forgot: "/auth/forgot",
    reset: "/auth/reset",
    google: "/auth/google",
    googleCallback: "/auth/google/callback",
    jwks: "/auth/jwks",
} as const

/** The name of one door. */
export type AuthDoorName = keyof typeof AUTH_DOORS

/** The `role` claim every access token carries; any other role is refused. */
export const AUTH_ROLE = "authenticated"

/** The audience every access token names. */
export const AUTH_AUDIENCE = "authenticated"

/** The claim names of an access token beyond the registered ones. */
export const AUTH_CLAIMS = {
    role: "role",
    sessionId: "session_id",
    email: "email",
    name: "name",
} as const

/** The signature algorithm of every access token: pinned, never negotiated. */
export const AUTH_ALGORITHM = "EdDSA"

/** The codes the doors answer on the wire; the front end maps them to its sentences. */
export const AUTH_ERROR_CODES = {
    Unauthenticated: "IDENTITY_UNAUTHENTICATED",
    AccessTokenInvalid: "PASSPORT_ACCESS_TOKEN_INVALID",
    KeyInvalid: "PASSPORT_KEY_INVALID",
    MissingCredentials: "PASSPORT_MISSING_CREDENTIALS",
    GoogleStateInvalid: "PASSPORT_GOOGLE_STATE_INVALID",
    GoogleRejected: "PASSPORT_GOOGLE_REJECTED",
    GoogleUnavailable: "PASSPORT_GOOGLE_UNAVAILABLE",
    RefreshInvalid: "IDENTITY_REFRESH_INVALID",
    RefreshReused: "IDENTITY_REFRESH_REUSED",
    AccountDisabled: "IDENTITY_ACCOUNT_DISABLED",
    TooManyAttempts: "IDENTITY_TOO_MANY_ATTEMPTS",
    InvalidCredentials: "IDENTITY_INVALID_CREDENTIALS",
    EmailNotConfirmed: "IDENTITY_EMAIL_NOT_CONFIRMED",
    PasswordInvalid: "IDENTITY_PASSWORD_INVALID",
    ResetTokenInvalid: "IDENTITY_RESET_TOKEN_INVALID",
} as const

/** One wire code of sign-in. */
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES]

/** How a code travels: the family of status the transport maps it to. */
export type AuthErrorKind = "unauthenticated" | "forbidden" | "invalid" | "rate-limited" | "internal" | "unavailable"

/** The kind of every code. */
export const AUTH_ERROR_KINDS: Readonly<Record<AuthErrorCode, AuthErrorKind>> = {
    [AUTH_ERROR_CODES.Unauthenticated]: "unauthenticated",
    [AUTH_ERROR_CODES.AccessTokenInvalid]: "unauthenticated",
    [AUTH_ERROR_CODES.KeyInvalid]: "internal",
    [AUTH_ERROR_CODES.MissingCredentials]: "invalid",
    [AUTH_ERROR_CODES.GoogleStateInvalid]: "unauthenticated",
    [AUTH_ERROR_CODES.GoogleRejected]: "unauthenticated",
    [AUTH_ERROR_CODES.GoogleUnavailable]: "unavailable",
    [AUTH_ERROR_CODES.RefreshInvalid]: "unauthenticated",
    [AUTH_ERROR_CODES.RefreshReused]: "unauthenticated",
    [AUTH_ERROR_CODES.AccountDisabled]: "forbidden",
    [AUTH_ERROR_CODES.TooManyAttempts]: "rate-limited",
    [AUTH_ERROR_CODES.InvalidCredentials]: "unauthenticated",
    [AUTH_ERROR_CODES.EmailNotConfirmed]: "forbidden",
    [AUTH_ERROR_CODES.PasswordInvalid]: "invalid",
    [AUTH_ERROR_CODES.ResetTokenInvalid]: "invalid",
}

/** The person a session belongs to. */
export interface SessionUser {
    /** The user id. */
    readonly id: string
    /** The account email. */
    readonly email: string
    /** The person's full name, when the account has one. */
    readonly name?: string
}

/** What a sign-in, refresh or session door answers in the body. */
export interface AccessGrant {
    /** The access JWT, to be sent as a Bearer token. */
    readonly accessToken: string
    /** How many seconds the access token lives. */
    readonly expiresIn: number
    /** When the access token stops being accepted, ISO 8601. */
    readonly expiresAt: string
    /** The signed-in person. */
    readonly user: SessionUser
}

/** The attempts a sign-in budget counts separately. */
export type AttemptKind = "login" | "reset" | "signup"

/** One public key of the JWKS document. */
export type PublicJwk = Readonly<Record<string, string>>

/** The public key document served at the JWKS door. */
export interface JwksDocument {
    /** The public keys access tokens verify against. */
    readonly keys: readonly PublicJwk[]
}

/** Where the browser goes after the Google round trip. */
export interface GoogleRedirect {
    /** The absolute address. */
    readonly url: string
    /** The redirect status. */
    readonly statusCode: number
}

/** The kinds of failure a front-end call ends with, as the doors' statuses stand for them. */
export type AuthFailureKind = "refused" | "not-found" | "invalid" | "unavailable"

/** The outcome of a front-end auth call: a value, or a failure carrying its kind and the wire code. */
export type AuthOutcome<T> =
    | { readonly success: true; readonly message: "ok"; readonly data: T }
    | { readonly success: false; readonly message: AuthFailureKind; readonly error: string }

/** The facts both sides hold about a password. */
export const PASSWORD_BOUNDS = { min: 8, max: 256, bcryptMaxBytes: 72 } as const
