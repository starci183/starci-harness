import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import type { OidcAdminClient, OidcCreatedUser, OidcFoundUser, OidcNewUser } from "./admin.ts"
import type { OidcClient } from "./client.ts"
import { OidcError } from "./errors.ts"
import type { OidcGrant, OidcTokenClient } from "./grants.ts"

/** What a sign-in, a refresh or a social callback answers: the account, its roles and email, and the provider session's refresh token. No access token. */
export interface OidcBrokerSession {
    readonly subject: string
    readonly roles: readonly string[]
    readonly email: string | null
    readonly refreshToken: string
    readonly refreshExpiresAt: Date
}

/** The proof values of a federated sign-in the app owns, and the identity provider the realm brokers. */
export interface OidcSocialRequest {
    /** The alias of the identity provider in the realm (`google`, `github`), sent as `kc_idp_hint`. */
    readonly provider: string
    readonly state: string
    readonly nonce: string
    /** The S256 challenge of the PKCE verifier the app keeps (`pkceChallenge`). */
    readonly codeChallenge: string
}

/** The callback of a federated sign-in, with the proof values the app kept. */
export interface OidcSocialCallback {
    readonly code: string
    readonly codeVerifier: string
    readonly nonce: string
}

const session = (grant: OidcGrant): OidcBrokerSession => ({
    subject: grant.subject,
    roles: grant.roles,
    email: grant.email,
    refreshToken: grant.refreshToken,
    refreshExpiresAt: grant.refreshExpiresAt,
})

/**
 * The one facade an app binds its identity port to when Keycloak sits behind the back end: the password grant, the refresh and the
 * revocation of the provider session; the federated sign-in (the authorization address with `kc_idp_hint` and the code exchange); and the
 * account administration (create, find by email, reset the password, end every session). The tokens stay on the server: a session answer
 * carries the verified account, the refresh token and its expiry, never an access token.
 *
 * Failures are `OidcError`s: `unavailable` (the provider is down or throttling), `credentials-rejected` (a bad password or a dead refresh
 * token), `email-registered`, `password-invalid` and `social-rejected` (a code, nonce or state the provider or the check refused).
 */
export class OidcBroker {
    readonly #tokens: OidcTokenClient
    readonly #client: OidcClient | null
    readonly #admin: OidcAdminClient

    constructor(tokens: OidcTokenClient, client: OidcClient | null, admin: OidcAdminClient) {
        this.#tokens = tokens
        this.#client = client
        this.#admin = admin
    }

    /** Signs in with a username or email and a password. */
    async passwordGrant(identifier: string, password: string): Promise<OidcBrokerSession> {
        return session(await this.#tokens.passwordGrant(identifier, password))
    }

    /** Renews a session from its refresh token; the answer holds the rotated refresh token. */
    async refresh(refreshToken: string): Promise<OidcBrokerSession> {
        return session(await this.#tokens.refresh(refreshToken))
    }

    /** Ends the provider session of a refresh token. */
    async revoke(refreshToken: string): Promise<void> {
        await this.#tokens.revoke(refreshToken)
    }

    /** The address the browser goes to for a federated sign-in at the identity provider `provider`. */
    async socialAuthorizationUrl(input: OidcSocialRequest): Promise<string> {
        return this.#registered().authorization({ state: input.state, nonce: input.nonce, challenge: input.codeChallenge, idpHint: input.provider })
    }

    /** Exchanges the code of a federated sign-in once. A code, nonce or answer the provider or the check refuses throws `social-rejected`; an outage stays `unavailable`. */
    async exchangeSocialCode(input: OidcSocialCallback): Promise<OidcBrokerSession> {
        const rejected = new OidcError(OIDC_ERROR_CODES.SocialRejected)
        const identity = await this.#registered()
            .exchange({ code: input.code, verifier: input.codeVerifier, nonce: input.nonce })
            .catch((cause: unknown) => {
                throw cause instanceof OidcError && cause.code === OIDC_ERROR_CODES.Rejected ? rejected : cause
            })
        if (identity.refreshToken === undefined || identity.refreshExpiresAt === undefined) throw rejected
        return { subject: identity.subject, roles: identity.roles, email: identity.email ?? null, refreshToken: identity.refreshToken, refreshExpiresAt: identity.refreshExpiresAt }
    }

    /** Creates an account with a permanent password. */
    createUser(input: OidcNewUser): Promise<OidcCreatedUser> {
        return this.#admin.createUser(input)
    }

    /** The account an email belongs to, or null. */
    findUserByEmail(email: string): Promise<OidcFoundUser | null> {
        return this.#admin.findUserByEmail(email)
    }

    /** Sets a permanent password. */
    resetPassword(subject: string, password: string): Promise<void> {
        return this.#admin.resetPassword(subject, password)
    }

    /** Ends every provider session of the account. */
    logoutAll(subject: string): Promise<void> {
        return this.#admin.logoutAll(subject)
    }

    #registered(): OidcClient {
        if (this.#client === null) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "client" } })
        return this.#client
    }
}
