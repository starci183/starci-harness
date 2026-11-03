import type { SecretInput } from "./primitives.ts"
import type { AccountDirectory, AuthClock, AuthIds, AuthLogger, RateCounter, SessionStore } from "./ports.ts"

/** One signing key of the key set. */
export interface SigningKeyOptions {
    /** The public key (SPKI PEM) published at the JWKS door. Derived from the private key when absent; a verify-only key needs it. */
    readonly publicKey?: string | undefined
    /** The Ed25519 private key (PKCS#8 PEM). Exactly one key of the set carries it: the active signer. A key without it only verifies. */
    readonly privateKey?: SecretInput | undefined
    /** The `kid` of the key; the RFC 7638 thumbprint of the public key when absent. */
    readonly keyId?: string | undefined
}

/** The Google OAuth client and where Google sends the browser back. */
export interface GoogleOptions {
    /** The public client id. */
    readonly clientId: string
    /** The client secret. */
    readonly clientSecret: SecretInput
    /** The registered callback address (`<api>/auth/google/callback`). */
    readonly callbackUrl: string
    /** The name of the cookie that carries one Google round trip. */
    readonly stateCookie?: string | undefined
}

/** The refresh cookie. */
export interface RefreshCookieOptions {
    /** The cookie name. */
    readonly name: string
    /** The `Domain` of the cookie when the request host is under none of `domains`; undefined keeps it host-only. */
    readonly domain?: string | undefined
    /**
     * The domains a request host may set the cookie on: a host equal to one, or ending in "." and one, gets that one as the `Domain`
     * (the longest that fits), so one api serves sign-in on localhost (host-only) and on a tunnel origin (its parent domain).
     */
    readonly domains?: readonly string[] | undefined
    /** The path the cookie is sent on (the web app's server reads it on its own pages and forwards it to the api). */
    readonly path?: string | undefined
    /** The paths older sessions wrote the cookie under; each is cleared so a stale copy never shadows the live one. */
    readonly legacyPaths?: readonly string[] | undefined
    /** `lax` (default) or `strict`. */
    readonly sameSite?: "lax" | "strict" | undefined
}

/** The budget of sign-in failures. */
export interface BudgetOptions {
    /** Sign-in failures per address in one window. */
    readonly loginAttempts: number
    /** Reset and signup requests per address in one window. */
    readonly resetAttempts: number
    /** The window, in milliseconds. */
    readonly windowMs: number
}

/** Everything the package needs, typed and parsed by the app (the package reads no environment). */
export interface AuthOptions {
    /** The `iss` claim. */
    readonly issuer: string
    /** The `aud` claim; `authenticated` when absent. */
    readonly audience?: string | undefined
    /** The signing keys: the first with a private key signs, every key verifies and is published, so a retired key stays valid until its tokens expire. */
    readonly keys: readonly SigningKeyOptions[]
    /** How long an access token lives, in seconds. */
    readonly accessTtlSeconds: number
    /** How long a refresh token lives, in seconds. */
    readonly refreshTtlSeconds: number
    /** A rotated refresh token presented again within this many milliseconds is a racing tab, not a theft (30 seconds when absent). */
    readonly reuseGraceMs?: number | undefined
    /** The bcrypt cost of a new password hash. */
    readonly bcryptCost: number
    /** The origin of the web app: a return address is accepted only on this origin, and the Google callback lands there. */
    readonly returnOrigin: string
    /** The Google client; null when the deployment has none (the Google door is then unavailable). */
    readonly google: GoogleOptions | null
    /** The refresh cookie. */
    readonly cookie: RefreshCookieOptions
    /** The sign-in budget. */
    readonly budget: BudgetOptions
    /** The session tables behind the app's ORM. */
    readonly sessions: SessionStore
    /** The app's user table, as far as sessions need it. */
    readonly accounts: AccountDirectory
    /** The counter the budget uses. */
    readonly rate: RateCounter
    /** The clock (system time when absent). */
    readonly clock?: AuthClock | undefined
    /** The id source (random UUIDs when absent). */
    readonly ids?: AuthIds | undefined
    /** The security-event log (silent when absent). */
    readonly logger?: AuthLogger | undefined
}
