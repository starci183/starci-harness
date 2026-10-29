import type { Secret } from "@modules/platform/config"
import type { Outcome } from "@modules/platform/primitives"
import type { PassportErrorCode } from "./errors/passport.error"

/** The claims admitted from one of the app's own access tokens after every cryptographic and semantic check. */
export interface OwnPrincipal {
    /** The user identifier from the verified `sub` claim (a row of auth.users). */
    readonly id: string
    /** The verified email claim when the user has one. */
    readonly email?: string
    /** The role every access token the app issues carries; any other role is refused. */
    readonly role: "authenticated"
}

/** Verifies one bearer token against the app's own key set and returns only claims that passed every check. */
export type VerifyAccessToken = (token: string) => Promise<Outcome<OwnPrincipal, PassportErrorCode>>

/** Issues one short-lived access token for a signed-in user. */
export type IssueAccessToken = (user: { readonly id: string; readonly email?: string }) => Promise<string>

/** Google OAuth 2.0 client configuration (authorization code with state and PKCE). */
export interface GoogleOptions {
    /** The OAuth client id. */
    readonly clientId: string
    /** The OAuth client secret. */
    readonly clientSecret: Secret
    /** The absolute callback URL of the back end's Google callback door. */
    readonly callbackUrl: string
}

/** The app's own asymmetric access tokens and the JWKS that publishes their public key. */
export interface TokenOptions {
    /** The issuer (`iss`), the app's public API origin. */
    readonly issuer: string
    /** The audience (`aud`) every token names. */
    readonly audience: string
    /** The ES256 private key in PKCS#8 PEM; its public half is served as the JWKS. */
    readonly privateKey: Secret
    /** The key id (`kid`) of the signing key. */
    readonly keyId: string
    /** The access-token lifetime in seconds. */
    readonly accessTtlSeconds: number
}

/** The rotating refresh token: an opaque value held only in an httpOnly, Secure, SameSite=Strict cookie. */
export interface RefreshCookieOptions {
    /** The cookie name. */
    readonly name: string
    /** The path the browser sends the cookie to: the refresh door only. */
    readonly path: string
    /** The refresh-token lifetime in seconds. */
    readonly ttlSeconds: number
}

/** The passport integration configuration parsed once at API boot. */
export interface PassportOptions {
    /** Google OAuth 2.0. */
    readonly google: GoogleOptions
    /** The app's own access tokens. */
    readonly tokens: TokenOptions
    /** The refresh cookie. */
    readonly refresh: RefreshCookieOptions
}
