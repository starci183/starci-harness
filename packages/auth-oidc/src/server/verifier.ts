import { OIDC_ACCESS_TOKEN_INVALID, OIDC_CLAIMS, OIDC_ROLE, OIDC_SUBJECT_MAX_LENGTH } from "../contracts/index.ts"
import type { OidcOutcome, OidcPrincipal, OidcRefusalReason, PrincipalVerifier } from "../contracts/index.ts"
import type { ResolvedOidcOptions } from "./options.ts"
import { rolesOf } from "./roles.ts"
import type { OidcTokenVerifier } from "./tokens.ts"

/** The `typ` claim of an access token Keycloak issues. An ID token (`ID`) or a refresh token presented as a bearer is not one. */
const ACCESS_TOKEN_TYPE = "Bearer"

const refuse = (reason: OidcRefusalReason): OidcOutcome<never> => ({ kind: "refused", code: OIDC_ACCESS_TOKEN_INVALID, detail: { reason } })

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/**
 * The `PrincipalVerifier` of the full edition: a bearer access token of the provider, checked against the discovered issuer's JWKS
 * (algorithm pinned, issuer, audience, expiry), becomes the principal a guard reads. The principal has the shape of `@starci/auth`'s, with
 * the roles the issuer granted added, so guards, `@Public` and `@Credential` do not change between editions.
 */
export class OidcPrincipalVerifier implements PrincipalVerifier {
    readonly #options: ResolvedOidcOptions
    readonly #tokens: OidcTokenVerifier

    constructor(options: ResolvedOidcOptions, tokens: OidcTokenVerifier) {
        this.#options = options
        this.#tokens = tokens
    }

    async verify(token: string, now: Date = this.#options.clock.now()): Promise<OidcOutcome<OidcPrincipal>> {
        const verified = await this.#tokens.verify(token, { audience: this.#options.audience }, now)
        if (verified.kind === "refused") return verified
        const claims = verified.value
        const subject = text(claims.sub)
        if (subject === undefined || subject.length > OIDC_SUBJECT_MAX_LENGTH || typeof claims.exp !== "number") return refuse("claims")
        const type = claims[OIDC_CLAIMS.tokenType]
        if (type !== undefined && type !== ACCESS_TOKEN_TYPE) return refuse("token-type")
        const party = this.#options.authorizedParty
        if (party !== undefined && claims[OIDC_CLAIMS.authorizedParty] !== party) return refuse("authorized-party")
        const roles = rolesOf(claims, { realm: this.#options.realmRoles, clients: this.#options.roleClients, claims: this.#options.roleClaims })
        if (roles === undefined) return refuse("claims")
        const email = text(claims[OIDC_CLAIMS.email])
        const name = text(claims[OIDC_CLAIMS.name])
        const username = text(claims[OIDC_CLAIMS.username])
        return {
            kind: "ok",
            value: {
                id: subject,
                role: OIDC_ROLE,
                sessionId: text(claims[OIDC_CLAIMS.sessionId]) ?? text(claims[OIDC_CLAIMS.tokenId]) ?? subject,
                ...(email === undefined ? {} : { email }),
                ...(name === undefined ? {} : { name }),
                ...(username === undefined ? {} : { username }),
                roles,
                issuer: this.#options.issuer,
                expiresAt: new Date(claims.exp * 1000),
            },
        }
    }
}

/** The verifier of an app that serves no user session: every token is refused, so the default-deny guard admits only its public and credential doors. */
export const refuseSessions: PrincipalVerifier = {
    verify: () => Promise.resolve(refuse("claims")),
}
