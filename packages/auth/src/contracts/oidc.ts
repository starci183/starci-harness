/**
 * What both sides of an OIDC sign-in share: the algorithms a token may be signed with, the wire codes, the claim names and the
 * shapes of the answers. The server module and the front-end client read these constants, so the two never drift.
 */

/** The signature algorithms a verifier may be pinned to: asymmetric only. `none` and every HMAC algorithm are not in the list and are refused at registration. */
export const OIDC_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"] as const

/** One admitted signature algorithm. */
export type OidcAlgorithm = (typeof OIDC_ALGORITHMS)[number]

/** The algorithm list a registration pins when it names none: what Keycloak signs with by default. */
export const OIDC_DEFAULT_ALGORITHMS: readonly OidcAlgorithm[] = ["RS256"]

/** The `role` every verified principal carries, the one `@starci/auth` gives its principals, so a guard reads one value in both editions. */
export const OIDC_ROLE = "authenticated"

/**
 * The wire code a verifier refuses a token with: the code `@starci/auth`'s verifier uses, so the guard and the filter that map it
 * to a 401 are the same in both editions. The specific reason travels in the refusal's `detail.reason`, for the log, never for the client.
 */
export const OIDC_ACCESS_TOKEN_INVALID = "PASSPORT_ACCESS_TOKEN_INVALID"

/**
 * The codes of the errors the package throws: a provider that cannot be reached is `Unavailable`, a response that cannot be trusted is `Rejected`.
 * The server-side grants add the four a sign-in, a sign-up and a social callback end with: `CredentialsRejected` (the provider refused the
 * username and password, or the refresh token), `EmailRegistered` (the provider already holds the account), `PasswordInvalid` (its policy
 * refuses the password) and `SocialRejected` (a code, nonce or state of a federated sign-in the provider or the check refused).
 */
export const OIDC_ERROR_CODES = {
    ConfigurationInvalid: "OIDC_CONFIGURATION_INVALID",
    Unavailable: "OIDC_UNAVAILABLE",
    Rejected: "OIDC_REJECTED",
    CredentialsRejected: "OIDC_CREDENTIALS_REJECTED",
    EmailRegistered: "OIDC_EMAIL_REGISTERED",
    PasswordInvalid: "OIDC_PASSWORD_INVALID",
    SocialRejected: "OIDC_SOCIAL_REJECTED",
} as const

/** One code a thrown OIDC error carries. */
export type OidcErrorCode = (typeof OIDC_ERROR_CODES)[keyof typeof OIDC_ERROR_CODES]

/** How a thrown code travels: the same families as `@starci/auth`'s error kinds. */
export type OidcErrorKind = "invalid" | "unavailable" | "unauthenticated" | "credentials-rejected" | "email-registered" | "password-invalid" | "social-rejected"

/** The kind of every thrown code. */
export const OIDC_ERROR_KINDS: Readonly<Record<OidcErrorCode, OidcErrorKind>> = {
    [OIDC_ERROR_CODES.ConfigurationInvalid]: "invalid",
    [OIDC_ERROR_CODES.Unavailable]: "unavailable",
    [OIDC_ERROR_CODES.Rejected]: "unauthenticated",
    [OIDC_ERROR_CODES.CredentialsRejected]: "credentials-rejected",
    [OIDC_ERROR_CODES.EmailRegistered]: "email-registered",
    [OIDC_ERROR_CODES.PasswordInvalid]: "password-invalid",
    [OIDC_ERROR_CODES.SocialRejected]: "social-rejected",
}

/** Why a token was refused: the reason a refusal's detail names. */
export type OidcRefusalReason =
    | "malformed"
    | "algorithm"
    | "unknown-key"
    | "signature"
    | "issuer"
    | "audience"
    | "authorized-party"
    | "expired"
    | "not-yet-valid"
    | "token-type"
    | "claims"
    /** A well-formed token of the right issuer whose claims an issuer preset's policy refuses (another repository, workflow or ref); `detail.claim` names it. */
    | "policy"

/** The claim names read beyond the registered ones. */
export const OIDC_CLAIMS = {
    sessionId: "sid",
    tokenId: "jti",
    email: "email",
    emailVerified: "email_verified",
    name: "name",
    username: "preferred_username",
    authorizedParty: "azp",
    realmAccess: "realm_access",
    resourceAccess: "resource_access",
    tokenType: "typ",
    nonce: "nonce",
} as const

/** The most roles a token may carry and the longest a role may be: a token past either is refused, so a claim cannot grow without bound. */
export const OIDC_ROLE_BOUNDS = { maxRoles: 128, maxLength: 256 } as const

/** The longest `sub` a principal may have. */
export const OIDC_SUBJECT_MAX_LENGTH = 255

/** The principal a verified access token stands for. Assignable to `@starci/auth`'s `AuthPrincipal`, with the roles the issuer granted. */
export interface OidcPrincipal {
    /** The account: the `sub` claim. */
    readonly id: string
    /** Always `authenticated`: a guard that checks the role of the lite principal checks this one the same way. */
    readonly role: typeof OIDC_ROLE
    /** The provider session: the `sid` claim, else the token id (`jti`), else the subject. */
    readonly sessionId: string
    /** The verified `email` claim, when the token has one. */
    readonly email?: string
    /** The display name, when the token has one. */
    readonly name?: string
    /** The `preferred_username`, when the token has one. */
    readonly username?: string
    /** The roles the issuer granted, from the realm and from the clients the registration maps, sorted and without repeats. */
    readonly roles: readonly string[]
    /** The issuer that signed the token. */
    readonly issuer: string
    /** When the token stops being accepted. */
    readonly expiresAt: Date
}

/** The refusal of a verifier. */
export interface OidcRefusal {
    readonly kind: "refused"
    readonly code: typeof OIDC_ACCESS_TOKEN_INVALID
    readonly detail?: Readonly<Record<string, unknown>>
}

/** The result of a check that can refuse: the same two shapes as `@starci/auth`'s `Outcome`. */
export type OidcOutcome<T> = { readonly kind: "ok"; readonly value: T } | OidcRefusal

/**
 * What a guard asks of an identity source: the principal of a bearer token, or a refusal. The same interface as
 * `PrincipalVerifier` of `@starci/auth/server` (the package's own specs hold that this verifier is assignable to that one, and its principal to `AuthPrincipal`), so
 * guards, `@Public` and `@Credential` do not change between editions.
 */
export interface PrincipalVerifier {
    /** Verifies one token at one instant. A provider that cannot be reached throws an `OidcError` of kind `unavailable`; an untrusted token is a refusal. */
    verify(token: string, now?: Date): Promise<OidcOutcome<OidcPrincipal>>
}

/** What a completed authorization-code flow established, after the ID token passed signature, issuer, audience, expiry and nonce. */
export interface OidcIdentity {
    /** The issuer that signed the ID token. */
    readonly issuer: string
    /** The verified account subject. */
    readonly subject: string
    /** The roles the ID token carries. */
    readonly roles: readonly string[]
    /** The verified email, when the token has one. */
    readonly email?: string
    /** The provider session, when the token names one. */
    readonly sessionId?: string
    /** The verified token expiry, which bounds a local session. */
    readonly expiresAt: Date
}

/** The person a front-end session belongs to. */
export interface OidcSessionUser {
    /** The subject. */
    readonly id: string
    /** The email, or empty text when the token has none. */
    readonly email: string
}

/** The kinds of failure a front-end call ends with. */
export type OidcFailureKind = "refused" | "not-found" | "invalid" | "unavailable"

/** The outcome of a front-end call: a value, or a failure carrying its kind and a code. The same shape as `AuthOutcome` of `@starci/auth/contracts`. */
export type OidcClientOutcome<T> =
    | { readonly success: true; readonly message: "ok"; readonly data: T }
    | { readonly success: false; readonly message: OidcFailureKind; readonly error: string }

/** The codes a front-end failure carries. */
export const OIDC_CLIENT_CODES = {
    State: "OIDC_STATE_INVALID",
    Nonce: "OIDC_NONCE_INVALID",
    Issuer: "OIDC_ISSUER_MISMATCH",
    Provider: "OIDC_PROVIDER_REFUSED",
    Token: "OIDC_TOKEN_RESPONSE_INVALID",
    Transport: "OIDC_TRANSPORT",
    NoLogout: "OIDC_NO_LOGOUT_ENDPOINT",
} as const
