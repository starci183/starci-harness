import type { GoogleProfile } from "../../server/ports.ts"
import type { IssuerEndpoints, IssuerPreset } from "./issuer.ts"
import { mapped, unmapped } from "./issuer.ts"

/** Google's issuer, as its discovery document names it. */
export const GOOGLE_ISSUER = "https://accounts.google.com"
/** The other spelling Google puts in `iss`. */
export const GOOGLE_ISSUER_ALIAS = "accounts.google.com"
/** Google's signing keys. */
export const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs"

/** What a Google ID token must say. */
export interface GoogleIssuerOptions {
    /** The app's OAuth client id(s): the `aud` of its ID tokens. */
    readonly clientId: string | readonly string[]
    /** When set, the Workspace domain the account must belong to (the `hd` claim). */
    readonly hostedDomain?: string | undefined
    /** Refuse a token whose address Google has not verified (true). */
    readonly requireVerifiedEmail?: boolean | undefined
    /** A test double's addresses. */
    readonly endpoints?: IssuerEndpoints | undefined
}

/** The person a Google ID token stands for: the profile the passport flow gives, with the Workspace domain. */
export interface GoogleIdentity extends GoogleProfile {
    /** The Workspace domain (`hd`), or null for a consumer account. */
    readonly hostedDomain: string | null
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)

/**
 * The Google preset: ID tokens of Google sign-in (One Tap, the Identity Services button, a mobile client), RS256 against Google's pinned key
 * set, issued for the app's client id. It maps to the same profile the lite Google flow gives the authenticator, so one `signInWithGoogle`
 * serves both.
 */
export const googleIssuer = (options: GoogleIssuerOptions): IssuerPreset<GoogleIdentity> => {
    const audience = typeof options.clientId === "string" ? [options.clientId] : options.clientId
    const verifiedOnly = options.requireVerifiedEmail ?? true
    return {
        name: "google",
        issuer: options.endpoints?.issuer ?? GOOGLE_ISSUER,
        issuerAliases: options.endpoints === undefined ? [GOOGLE_ISSUER_ALIAS] : [],
        keys: { kind: "jwks", uri: options.endpoints?.jwksUri ?? GOOGLE_JWKS_URI },
        algorithms: ["RS256"],
        audience,
        requiredClaims: ["iat"],
        identityOf: (claims) => {
            const subject = text(claims.sub)
            if (subject === null) return unmapped("claims", "sub")
            const verified = claims.email_verified === true || claims.email_verified === "true"
            const email = text(claims.email)
            if (verifiedOnly && (email === null || !verified)) return unmapped("policy", "email_verified")
            const hostedDomain = text(claims.hd)
            if (options.hostedDomain !== undefined && hostedDomain !== options.hostedDomain) return unmapped("policy", "hd")
            return mapped({ subject, email, emailVerified: verified, name: text(claims.name), picture: text(claims.picture), hostedDomain })
        },
    }
}
