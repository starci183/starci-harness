import { Injectable } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Strategy } from "passport-google-oauth20"
import type { Profile } from "passport-google-oauth20"
import { InjectPassportOptions } from "../passport.decorators"
import type { PassportOptions } from "../passport.options"
import { CookieStateStore } from "./oauth-state.store"

/** The Google identity a callback proves: the provider subject and the verified email when Google states one. */
export interface GoogleIdentity {
    /** Google's stable subject id (auth.identities.provider_id). */
    readonly providerId: string
    /** The verified email, when present. */
    readonly email?: string
}

@Injectable()
/** Google OAuth 2.0 (authorization code with state and PKCE): it proves the Google identity and never signs the user in itself. */
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
    constructor(@InjectPassportOptions() options: PassportOptions) {
        super({
            clientID: options.google.clientId,
            clientSecret: options.google.clientSecret.reveal(),
            callbackURL: options.google.callbackUrl,
            scope: ["openid", "email"],
            pkce: true,
            state: true,
            store: new CookieStateStore(new URL(options.google.callbackUrl).pathname, options.refresh.cookieDomain),
        })
    }

    /** The identity of the callback; the identity domain links it to a user and issues the session. */
    validate(_accessToken: string, _refreshToken: string, profile: Profile): GoogleIdentity {
        const email = profile.emails?.find((entry) => entry.verified)?.value
        return { providerId: profile.id, ...(email === undefined ? {} : { email }) }
    }
}
