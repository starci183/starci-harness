import { OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import type { OidcPrincipal } from "../contracts/oidc.ts"
import type { OidcDiscovery } from "./discovery.ts"
import { OidcError } from "./errors.ts"
import type { ResolvedOidcOptions } from "./options.ts"
import { isRecord, revealed } from "./primitives.ts"
import { refreshOf } from "./refresh.ts"
import { errorCodeOf, send } from "./transport.ts"
import type { OidcPrincipalVerifier } from "./verifier.ts"

/** What a grant at the token endpoint established: the verified principal and the refresh token of the provider session. The access token is verified here and dropped. */
export interface OidcGrant {
    /** The principal the access token stands for (subject, mapped roles, email, session). */
    readonly principal: OidcPrincipal
    /** The account: the `sub` of the access token. */
    readonly subject: string
    /** The roles the issuer granted, mapped by the registration. */
    readonly roles: readonly string[]
    /** The verified email, or null when the token has none. */
    readonly email: string | null
    /** The refresh token of the provider session. It stays on the server. */
    readonly refreshToken: string
    /** When the refresh token stops being accepted. */
    readonly refreshExpiresAt: Date
}

const rejected = (cause?: unknown): OidcError => new OidcError(OIDC_ERROR_CODES.Rejected, cause === undefined ? {} : { cause })

/**
 * The server-side grants of the registered client at the provider's token endpoint: the resource owner password grant, the refresh
 * token grant and the revocation of a refresh token. Every answer is checked by the registration's `PrincipalVerifier`, so the result
 * carries the same verified principal a bearer token would, plus the refresh token and its expiry; the access token is never returned,
 * so it can never reach a browser. Nothing here logs a password or a token.
 */
export class OidcTokenClient {
    readonly #options: ResolvedOidcOptions
    readonly #discovery: OidcDiscovery
    readonly #verifier: OidcPrincipalVerifier

    constructor(options: ResolvedOidcOptions, discovery: OidcDiscovery, verifier: OidcPrincipalVerifier) {
        this.#options = options
        this.#discovery = discovery
        this.#verifier = verifier
    }

    /**
     * Signs a person in with a username (or the email the realm accepts) and a password. A refusal of the credentials (`invalid_grant`: bad
     * password, unknown or disabled account) throws `CredentialsRejected`; an outage throws `Unavailable`.
     */
    async passwordGrant(username: string, password: string): Promise<OidcGrant> {
        const client = this.#registration()
        return this.#grant({ grant_type: "password", username, password, scope: client.scope ?? "openid" })
    }

    /** Trades a refresh token for a new session grant (the provider rotates the refresh token). A dead refresh token (`invalid_grant`) throws `CredentialsRejected`. */
    async refresh(refreshToken: string): Promise<OidcGrant> {
        this.#registration()
        return this.#grant({ grant_type: "refresh_token", refresh_token: refreshToken })
    }

    /**
     * Ends the provider session of a refresh token. It asks the discovered `revocation_endpoint` (RFC 7009); a provider that advertises none
     * is asked at its end-session endpoint with the refresh token. A token the provider no longer knows is already ended and is no error.
     */
    async revoke(refreshToken: string): Promise<void> {
        const client = this.#registration()
        const metadata = await this.#discovery.get()
        const url = metadata.revocationEndpoint ?? metadata.endSessionEndpoint
        if (url === undefined) throw rejected()
        const credentials = { client_id: client.clientId, ...(client.clientSecret === undefined ? {} : { client_secret: revealed(client.clientSecret) }) }
        const form =
            metadata.revocationEndpoint === undefined ? { ...credentials, refresh_token: refreshToken } : { ...credentials, token: refreshToken, token_type_hint: "refresh_token" }
        const response = await send(this.#options, { method: "POST", url, form })
        if (response.status >= 200 && response.status < 300) return
        if (response.status === 400 && errorCodeOf(response.body) === "invalid_grant") return
        throw rejected()
    }

    #registration(): NonNullable<ResolvedOidcOptions["client"]> {
        const client = this.#options.client
        if (client === undefined) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "client" } })
        return client
    }

    async #grant(params: Readonly<Record<string, string>>): Promise<OidcGrant> {
        const client = this.#registration()
        const { tokenEndpoint } = await this.#discovery.get()
        const response = await send(this.#options, {
            method: "POST",
            url: tokenEndpoint,
            form: { client_id: client.clientId, ...(client.clientSecret === undefined ? {} : { client_secret: revealed(client.clientSecret) }), ...params },
        })
        if (response.status !== 200) throw errorCodeOf(response.body) === "invalid_grant" ? new OidcError(OIDC_ERROR_CODES.CredentialsRejected) : rejected()
        const body = response.body
        if (!isRecord(body) || typeof body.access_token !== "string") throw rejected()
        const refresh = refreshOf(body, this.#options.clock.now())
        if (refresh === undefined) throw rejected()
        const verified = await this.#verifier.verify(body.access_token)
        if (verified.kind === "refused") throw rejected()
        const principal = verified.value
        return { principal, subject: principal.id, roles: principal.roles, email: principal.email ?? null, ...refresh }
    }
}
