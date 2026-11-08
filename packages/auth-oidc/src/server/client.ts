import { OIDC_CLAIMS, OIDC_ERROR_CODES, OIDC_SUBJECT_MAX_LENGTH } from "../contracts/index.ts"
import type { OidcIdentity } from "../contracts/index.ts"
import type { OidcDiscovery } from "./discovery.ts"
import { OidcError } from "./errors.ts"
import type { ResolvedOidcOptions } from "./options.ts"
import { isRecord, revealed, sameValue } from "./primitives.ts"
import { refreshOf } from "./refresh.ts"
import { rolesOf } from "./roles.ts"
import type { OidcTokenVerifier } from "./tokens.ts"

/** The proof values the app owns and sends to the authorization endpoint. */
export interface OidcAuthorization {
    /** One-use transaction state. */
    readonly state: string
    /** Binds the ID token to the browser transaction. */
    readonly nonce: string
    /** The base64url SHA-256 digest of the retained PKCE verifier (`pkceChallenge`). */
    readonly challenge: string
    /** `none`, `login`, `consent` or `select_account`, when the flow must not (or must) show a login page. */
    readonly prompt?: "none" | "login" | "consent" | "select_account" | undefined
    /** The alias of an identity provider the realm brokers (`google`), sent as `kc_idp_hint` so the provider skips its own login page for it. */
    readonly idpHint?: string | undefined
}

/** A claimed callback, exchanged exactly once. */
export interface OidcExchange {
    /** The transient authorization code; never returned to the browser. */
    readonly code: string
    /** The retained PKCE verifier. */
    readonly verifier: string
    /** The nonce retained with the transaction. */
    readonly nonce: string
    /** The `iss` of the authorization response, when the provider sent one; a supplied issuer must equal the configured one. */
    readonly issuer?: string | undefined
}

/** What a completed code exchange established: the identity, and the provider's refresh token when it issued one. The refresh token stays on the server. */
export interface OidcExchangeResult extends OidcIdentity {
    /** The refresh token of the provider session; absent when the provider issued none or none that can be dated. */
    readonly refreshToken?: string
    /** When the refresh token stops being accepted; present with `refreshToken`. */
    readonly refreshExpiresAt?: Date
}

/** The address a browser is sent to for RP-initiated logout. */
export interface OidcLogout {
    /** Sent as `id_token_hint` when the app retained the ID token. */
    readonly idTokenHint?: string | undefined
    /** Sent as `state`. */
    readonly state?: string | undefined
}

const rejected = (cause?: unknown): OidcError => new OidcError(OIDC_ERROR_CODES.Rejected, cause === undefined ? {} : { cause })

/**
 * The authorization code flow of one registered client: it builds the authorization address (S256 PKCE, nonce, state), exchanges a
 * code once at the token endpoint and verifies the ID token (signature, issuer, audience = the client, expiry, nonce) before it answers
 * an identity, and builds the RP-initiated logout address. It never logs a provider token; the refresh token a code exchange answers is for the
 * server's own store, never for a browser.
 */
export class OidcClient {
    readonly #options: ResolvedOidcOptions
    readonly #discovery: OidcDiscovery
    readonly #tokens: OidcTokenVerifier

    constructor(options: ResolvedOidcOptions, discovery: OidcDiscovery, tokens: OidcTokenVerifier) {
        this.#options = options
        this.#discovery = discovery
        this.#tokens = tokens
    }

    /** The address the browser goes to for the registered code flow. */
    async authorization(input: OidcAuthorization): Promise<string> {
        const client = this.#registration()
        const metadata = await this.#discovery.get()
        const url = new URL(metadata.authorizationEndpoint)
        url.search = new URLSearchParams({
            response_type: "code",
            client_id: client.clientId,
            redirect_uri: client.callbackUri,
            scope: client.scope ?? "openid",
            state: input.state,
            nonce: input.nonce,
            code_challenge: input.challenge,
            code_challenge_method: "S256",
            ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
            ...(input.idpHint === undefined ? {} : { kc_idp_hint: input.idpHint }),
        }).toString()
        return url.toString()
    }

    /** Exchanges a claimed code once, then verifies the ID token and answers the identity it asserts. */
    async exchange(input: OidcExchange): Promise<OidcExchangeResult> {
        const client = this.#registration()
        if (input.issuer !== undefined && input.issuer !== this.#options.issuer) throw rejected()
        const metadata = await this.#discovery.get()
        const response = await this.#options.http
            .request({
                method: "POST",
                url: metadata.tokenEndpoint,
                timeoutMs: this.#options.timeoutMs,
                form: {
                    grant_type: "authorization_code",
                    client_id: client.clientId,
                    ...(client.clientSecret === undefined ? {} : { client_secret: revealed(client.clientSecret) }),
                    redirect_uri: client.callbackUri,
                    code: input.code,
                    code_verifier: input.verifier,
                },
            })
            .catch((cause: unknown) => {
                throw new OidcError(OIDC_ERROR_CODES.Unavailable, { cause })
            })
        if (response.status >= 500) throw new OidcError(OIDC_ERROR_CODES.Unavailable)
        if (response.status !== 200 || !isRecord(response.body) || typeof response.body.id_token !== "string") throw rejected()
        const identity = await this.#identityOf(response.body.id_token, input.nonce)
        const refresh = refreshOf(response.body, this.#options.clock.now())
        return refresh === undefined ? identity : { ...identity, ...refresh }
    }

    /** The RP-initiated logout address of the registered client. */
    async logout(input: OidcLogout = {}): Promise<string> {
        const client = this.#registration()
        const { endSessionEndpoint } = await this.#discovery.get()
        if (endSessionEndpoint === undefined) throw rejected()
        const url = new URL(endSessionEndpoint)
        url.search = new URLSearchParams({
            client_id: client.clientId,
            post_logout_redirect_uri: client.postLogoutUri,
            ...(input.idTokenHint === undefined ? {} : { id_token_hint: input.idTokenHint }),
            ...(input.state === undefined ? {} : { state: input.state }),
        }).toString()
        return url.toString()
    }

    #registration(): NonNullable<ResolvedOidcOptions["client"]> {
        const client = this.#options.client
        if (client === undefined) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "client" } })
        return client
    }

    async #identityOf(idToken: string, nonce: string): Promise<OidcIdentity> {
        const client = this.#registration()
        const verified = await this.#tokens.verify(idToken, { audience: [client.clientId], requiredClaims: [OIDC_CLAIMS.nonce] })
        if (verified.kind === "refused") throw rejected()
        const claims = verified.value
        const received = claims[OIDC_CLAIMS.nonce]
        if (typeof received !== "string" || !sameValue(received, nonce)) throw rejected()
        const { sub, exp } = claims
        if (typeof sub !== "string" || sub === "" || sub.length > OIDC_SUBJECT_MAX_LENGTH || typeof exp !== "number" || !Number.isSafeInteger(exp)) throw rejected()
        const roles = rolesOf(claims, { realm: this.#options.realmRoles, clients: this.#options.roleClients, claims: this.#options.roleClaims })
        if (roles === undefined) throw rejected()
        const email = claims[OIDC_CLAIMS.email]
        const sessionId = claims[OIDC_CLAIMS.sessionId]
        return {
            issuer: this.#options.issuer,
            subject: sub,
            roles,
            ...(typeof email === "string" && email !== "" ? { email } : {}),
            ...(typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}),
            expiresAt: new Date(exp * 1000),
        }
    }
}
