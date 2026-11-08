import { PassportStrategy } from "@nestjs/passport"
import { Strategy as LocalStrategy } from "passport-local"
import type { AuthAuthenticator, AuthSubject } from "./ports.ts"

/** The Google strategy and its profile mapping live with the Google provider; named here as 0.5.0 did. */
export { PassportGoogleStrategy, googleProfileOf } from "./providers/google.ts"

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
