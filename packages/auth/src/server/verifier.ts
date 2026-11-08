import { AUTH_ERROR_CODES, AUTH_ROLE } from "../contracts/index.ts"
import { ok, refused } from "./errors.ts"
import type { Outcome } from "./errors.ts"
import type { AuthClock, AuthPrincipal } from "./ports.ts"
import { systemClock } from "./runtime.ts"
import type { AuthTokens } from "./tokens.ts"

/**
 * What `domain/identity` asks of an identity source: the principal of a bearer token, or a refusal. The lite edition's source is
 * `AuthPrincipalVerifier`; the full edition's is the OIDC verifier of `@starci/auth/oidc` behind this same interface, so guards,
 * `@Public` and `@Credential` do not change between editions.
 */
export interface PrincipalVerifier {
    /** Verifies one token at one instant. */
    verify(token: string, now?: Date): Promise<Outcome<AuthPrincipal>>
}

/** The verifier of the app that signs people in: our own access token, checked against our key set, issuer, audience and expiry. */
export class AuthPrincipalVerifier implements PrincipalVerifier {
    readonly #tokens: AuthTokens
    readonly #clock: AuthClock

    constructor(tokens: AuthTokens, clock: AuthClock = systemClock) {
        this.#tokens = tokens
        this.#clock = clock
    }

    async verify(token: string, now: Date = this.#clock.now()): Promise<Outcome<AuthPrincipal>> {
        const verified = await this.#tokens.verify(token, now)
        if (verified.kind === "refused") return refused(AUTH_ERROR_CODES.AccessTokenInvalid)
        const { sub, email, name, sessionId } = verified.value
        return ok({ id: sub, role: AUTH_ROLE, sessionId, ...(email === undefined ? {} : { email }), ...(name === undefined ? {} : { name }) })
    }
}

/** The verifier of an app that serves no user session: every access token is refused, so the default-deny guard admits only its public and credential doors. */
export const refuseSessions: PrincipalVerifier = {
    verify: () => Promise.resolve(refused(AUTH_ERROR_CODES.AccessTokenInvalid)),
}
