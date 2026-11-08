import { PassportStrategy } from "@nestjs/passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import type { Profile } from "passport-google-oauth20"
import { AUTH_DOORS, AUTH_ERROR_CODES } from "../../contracts/index.ts"
import { AuthError } from "../errors.ts"
import type { AuthOptions } from "../options.ts"
import type { AuthAuthenticator, AuthClock, AuthIds, AuthSubject, GoogleProfile } from "../ports.ts"
import { revealed } from "../primitives.ts"
import type { SecretInput } from "../primitives.ts"
import type { AuthTokens } from "../tokens.ts"
import { OAUTH_STATE_TTL_MS, OAuthStateClient } from "./oauth-state.ts"
import { defineProvider } from "./provider.ts"
import type { ProviderCodes, SignInProvider } from "./provider.ts"

/** The id of the Google provider: its passport strategy, its state purpose and its doors (`/auth/google`). */
export const GOOGLE_PROVIDER_ID = "google"
/** The cookie that carries one Google round trip, when the options name none. */
export const DEFAULT_GOOGLE_STATE_COOKIE = "auth_google_state"
/** The only path the state cookie is sent to. */
export const GOOGLE_STATE_PATH = AUTH_DOORS.google
/** How long a Google round trip may take, in milliseconds. */
export const GOOGLE_STATE_TTL_MS = OAUTH_STATE_TTL_MS

/** The codes the Google doors refuse with: the ones 0.5.0 answered, so a front end maps them as before. */
export const GOOGLE_CODES: ProviderCodes = {
    unavailable: AUTH_ERROR_CODES.GoogleUnavailable,
    stateInvalid: AUTH_ERROR_CODES.GoogleStateInvalid,
    rejected: AUTH_ERROR_CODES.GoogleRejected,
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

/**
 * The state store of the Google round trip: the provider-neutral store with Google's cookie (`auth_google_state` on `/auth/google`) and
 * purpose (`p: "google"`), built from the options as in 0.5.0.
 */
export class GoogleStateClient extends OAuthStateClient {
    constructor(deps: {
        readonly tokens: AuthTokens
        readonly clock: AuthClock
        readonly ids: AuthIds
        readonly options: Pick<AuthOptions, "returnOrigin" | "google">
    }) {
        super({
            tokens: deps.tokens,
            clock: deps.clock,
            ids: deps.ids,
            state: {
                provider: GOOGLE_PROVIDER_ID,
                cookie: deps.options.google?.stateCookie ?? DEFAULT_GOOGLE_STATE_COOKIE,
                path: GOOGLE_STATE_PATH,
                returnOrigin: deps.options.returnOrigin,
            },
        })
    }
}

const verifiedOf = (profile: Profile): boolean => {
    const claim: unknown = profile._json.email_verified
    return claim === true || claim === "true"
}

/** The facts the app needs from a Google profile; an account without a subject is refused. */
export const googleProfileOf = (profile: Profile): GoogleProfile => {
    if (profile.id === "") throw new AuthError(AUTH_ERROR_CODES.GoogleRejected)
    return {
        subject: profile.id,
        email: profile.emails?.[0]?.value ?? null,
        emailVerified: verifiedOf(profile),
        name: profile.displayName === "" ? null : profile.displayName,
        picture: profile.photos?.[0]?.value ?? null,
    }
}

/** The Google OAuth 2.0 strategy: authorization code with `state` and PKCE (S256), the round trip held in a signed cookie. */
export class PassportGoogleStrategy extends PassportStrategy(GoogleStrategy, GOOGLE_PROVIDER_ID) {
    readonly #authenticator: AuthAuthenticator

    constructor(google: GoogleOptions, authenticator: AuthAuthenticator, state: OAuthStateClient) {
        super({
            clientID: google.clientId,
            clientSecret: revealed(google.clientSecret),
            callbackURL: google.callbackUrl,
            scope: ["openid", "email", "profile"],
            state: true,
            pkce: true,
        })
        this.#authenticator = authenticator
        // passport-oauth2 types describe only its session stores; the stateless PKCE store replaces the one it built.
        Object.assign(this, { _stateStore: state })
    }

    /** Called by passport with Google's profile; answers the person the app stands it for. */
    validate(_accessToken: string, _refreshToken: string, profile: Profile): Promise<AuthSubject> {
        return this.#authenticator.signInWithGoogle(googleProfileOf(profile))
    }
}

/** The Google provider: `AuthModule.register({ providers: [google({ clientId, clientSecret, callbackUrl })] })`, or the `google` option of 0.5.0. */
export const google = (options: GoogleOptions): SignInProvider<GoogleOptions, Profile> =>
    defineProvider({
        id: GOOGLE_PROVIDER_ID,
        options,
        stateCookie: options.stateCookie ?? DEFAULT_GOOGLE_STATE_COOKIE,
        authorizeParams: { prompt: "select_account" },
        codes: GOOGLE_CODES,
        profileOf: (raw) => ({ provider: GOOGLE_PROVIDER_ID, ...googleProfileOf(raw) }),
        strategy: ({ authenticator, state }) => new PassportGoogleStrategy(options, authenticator, state),
    })
