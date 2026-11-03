import type { AuthOptions } from "@starci/auth/server"
import type { Outcome } from "@modules/platform/primitives"
import type { PassportErrorCode } from "./errors/passport.error"

/**
 * The typed settings of the sign-in, parsed once at boot by `passport.config.ts` and handed to @starci/auth: the signing keys
 * (the first with a private key signs; every key verifies and is published as the JWKS), the access and refresh lifetimes, the
 * Google client, the refresh cookie and the sign-in budget. The stores the package needs (sessions, accounts, rate counter)
 * are not settings: `domain/identity` provides them.
 */
export type PassportOptions = Pick<
    AuthOptions,
    | "issuer"
    | "audience"
    | "keys"
    | "accessTtlSeconds"
    | "refreshTtlSeconds"
    | "reuseGraceMs"
    | "bcryptCost"
    | "returnOrigin"
    | "google"
    | "cookie"
    | "budget"
>

/** The claims admitted from one of the app's own access tokens after every cryptographic and semantic check. */
export interface OwnPrincipal {
    /** The user identifier from the verified `sub` claim (a row of auth.users). */
    readonly id: string
    /** The verified email claim when the user has one. */
    readonly email?: string
    /** The device session the token belongs to, when the token names one. */
    readonly sessionId?: string
    /** The role every access token the app issues carries; any other role is refused. */
    readonly role: "authenticated"
}

/** Verifies one bearer token against the app's own key set and returns only claims that passed every check. */
export type VerifyAccessToken = (token: string) => Promise<Outcome<OwnPrincipal, PassportErrorCode>>
