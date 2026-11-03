import { PassportStrategy } from "@nestjs/passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import type { Profile } from "passport-google-oauth20"
import { Strategy as LocalStrategy } from "passport-local"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { AuthError } from "./errors.ts"
import type { GoogleStateClient } from "./google-state.ts"
import type { GoogleOptions } from "./options.ts"
import type { AuthAuthenticator, AuthSubject, GoogleProfile } from "./ports.ts"
import { revealed } from "./primitives.ts"

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

/** The email and password strategy; the app decides whether the pair is right. */
export class PassportLocalStrategy extends PassportStrategy(LocalStrategy, "local") {
    readonly #authenticator: AuthAuthenticator

    constructor(authenticator: AuthAuthenticator) {
        super({ usernameField: "email", passwordField: "password", session: false })
        this.#authenticator = authenticator
    }

    /** Called by passport with the posted pair; answers the person or throws the app's refusal. */
    validate(email: string, password: string): Promise<AuthSubject> {
        return this.#authenticator.verifyPassword(email, password)
    }
}

/** The Google OAuth 2.0 strategy: authorization code with `state` and PKCE (S256), the round trip held in a signed cookie. */
export class PassportGoogleStrategy extends PassportStrategy(GoogleStrategy, "google") {
    readonly #authenticator: AuthAuthenticator

    constructor(google: GoogleOptions, authenticator: AuthAuthenticator, state: GoogleStateClient) {
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
