import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose"
import type { CryptoKey, JWK, KeyObject } from "jose"
import { OIDC_CLAIMS } from "../contracts/index.ts"
import type { OidcHttp, OidcHttpRequest, OidcHttpResponse, OidcOptions } from "../server/options.ts"
import type { OidcClock } from "../server/primitives.ts"

/** A clock the test moves by hand. */
export class FakeClock implements OidcClock {
    #at: number

    constructor(start: Date | number = Date.UTC(2026, 0, 1)) {
        this.#at = typeof start === "number" ? start : start.getTime()
    }

    now(): Date {
        return new Date(this.#at)
    }

    /** Moves time forward. */
    advance(milliseconds: number): void {
        this.#at += milliseconds
    }
}

/** The claims of a token the fake issuer mints. */
export interface FakeTokenClaims {
    /** The subject (`user-1`). */
    readonly sub?: string | undefined
    readonly email?: string | undefined
    readonly name?: string | undefined
    readonly username?: string | undefined
    /** The realm roles (`realm_access.roles`). */
    readonly roles?: readonly string[] | undefined
    /** The client roles (`resource_access.<client>.roles`). */
    readonly clientRoles?: Readonly<Record<string, readonly string[]>> | undefined
    /** The provider session (`sid`); one is generated when absent. */
    readonly sessionId?: string | undefined
    /** Further claims, copied as they are. */
    readonly extra?: Readonly<Record<string, unknown>> | undefined
}

/** What a spec bends in one token to prove a refusal. */
export interface MintOverrides {
    /** The `iss` claim (the issuer's own when absent). */
    readonly issuer?: string | undefined
    /** The `aud` claim (the issuer's `audience`, else its client id). */
    readonly audience?: string | readonly string[] | undefined
    /** Seconds the token lives from `issuedAt` (the issuer's access TTL). Negative mints an expired token. */
    readonly expiresInSeconds?: number | undefined
    /** The `iat` instant (the clock's now). */
    readonly issuedAt?: Date | undefined
    /** The `nbf` instant. */
    readonly notBefore?: Date | undefined
    /** The `kid` header: a text, or `null` to omit it (the signing key's id when absent). */
    readonly kid?: string | null | undefined
    /** `foreign` signs with a key the issuer does not publish. */
    readonly signer?: "current" | "foreign" | undefined
    /** The `typ` claim (`Bearer` for an access token, `ID` for an ID token). */
    readonly type?: string | undefined
}

/** The options of a fake issuer. */
export interface FakeOidcIssuerOptions {
    /** The realm segment of the issuer address (`test`). */
    readonly realm?: string | undefined
    /** The origin of an in-memory issuer (`https://idp.test`); ignored with `listen`. */
    readonly origin?: string | undefined
    /** The registered client id (`test-client`). */
    readonly clientId?: string | undefined
    /** The client secret the token endpoint requires; none makes the client public. */
    readonly clientSecret?: string | undefined
    /** The audience of access tokens (the client id). */
    readonly audience?: string | undefined
    /** The signature algorithm (`RS256`). */
    readonly algorithm?: "RS256" | "ES256" | undefined
    /** The clock token times are read from (the system clock). */
    readonly clock?: OidcClock | undefined
    /** How long an access token lives, in seconds (300). */
    readonly accessTtlSeconds?: number | undefined
    /** Serves the issuer over a real HTTP socket on 127.0.0.1, for a browser or a process that cannot use the in-memory port. */
    readonly listen?: boolean | undefined
}

/** What a failure injection does to the next requests. */
export type FakeFailure = { readonly status: number } | "network"

interface RingKey {
    readonly kid: string
    readonly privateKey: CryptoKey | KeyObject
    readonly jwk: JWK
}

interface PendingCode {
    readonly claims: FakeTokenClaims
    readonly nonce: string
    readonly challenge: string
    readonly redirectUri: string
    used: boolean
}

interface HandledResponse {
    readonly status: number
    readonly body: unknown
}

/** A recorded request, for a spec to count what the code under test asked. */
export interface FakeRequest {
    readonly method: string
    readonly path: string
}

const KEYCLOAK_PATHS = {
    authorization: "/protocol/openid-connect/auth",
    token: "/protocol/openid-connect/token",
    certs: "/protocol/openid-connect/certs",
    logout: "/protocol/openid-connect/logout",
} as const

const DISCOVERY = "/.well-known/openid-configuration"

const SECOND_MS = 1000

const s256 = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url")

const generateKey = async (algorithm: "RS256" | "ES256"): Promise<RingKey> => {
    const pair = await generateKeyPair(algorithm, { extractable: true })
    const exported = await exportJWK(pair.publicKey)
    const kid = await calculateJwkThumbprint(exported)
    return { kid, privateKey: pair.privateKey, jwk: { ...exported, kid, alg: algorithm, use: "sig" } }
}

const form = (value: string): Readonly<Record<string, string>> => Object.fromEntries(new URLSearchParams(value))

const readBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
    return Buffer.concat(chunks).toString("utf8")
}

/**
 * A fake OIDC provider that behaves like Keycloak for what the package uses: the discovery document, the JWKS, the token endpoint (authorization
 * code with PKCE, refresh token with rotation) and the logout endpoint, with keys that rotate and tokens a spec can bend (expired, wrong
 * audience, wrong issuer, unknown key, foreign signature). Its `http` is an in-memory `OidcHttp` (no socket, no port), so an app's spec registers
 * the module against it and needs no Keycloak; `listen: true` serves the same issuer on a real socket for a browser.
 */
export class FakeOidcIssuer {
    readonly clientId: string
    readonly #realm: string
    readonly #algorithm: "RS256" | "ES256"
    readonly #audience: string
    readonly #secret: string | undefined
    readonly #clock: OidcClock
    readonly #accessTtl: number
    readonly #ring: RingKey[] = []
    readonly #codes = new Map<string, PendingCode>()
    readonly #refreshTokens = new Map<string, { readonly claims: FakeTokenClaims; used: boolean }>()
    readonly #failures: FakeFailure[] = []
    readonly #requests: FakeRequest[] = []
    #issuer: string
    #server: Server | undefined
    #down = false
    #idOverrides: MintOverrides = {}

    private constructor(options: FakeOidcIssuerOptions, issuer: string) {
        this.clientId = options.clientId ?? "test-client"
        this.#realm = options.realm ?? "test"
        this.#algorithm = options.algorithm ?? "RS256"
        this.#audience = options.audience ?? this.clientId
        this.#secret = options.clientSecret
        this.#clock = options.clock ?? { now: () => new Date() }
        this.#accessTtl = options.accessTtlSeconds ?? 300
        this.#issuer = issuer
    }

    /** Creates an issuer with one signing key, and starts its socket when `listen` is set. */
    static async create(options: FakeOidcIssuerOptions = {}): Promise<FakeOidcIssuer> {
        const realm = options.realm ?? "test"
        const issuer = new FakeOidcIssuer(options, `${options.origin ?? "https://idp.test"}/realms/${realm}`)
        issuer.#ring.push(await generateKey(issuer.#algorithm))
        if (options.listen === true) await issuer.#start()
        return issuer
    }

    /** The exact issuer: the `iss` claim and the `issuer` of the discovery document. */
    get issuer(): string {
        return this.#issuer
    }

    /** The in-memory outbound port: answers like the issuer's endpoints, with the failures the spec injected. */
    get http(): OidcHttp {
        return { request: (request) => this.#serve(request) }
    }

    /** The same endpoints as a `fetch`, for a front-end client under test (the browser client takes a `fetch`, not an `OidcHttp`). */
    get fetch(): typeof fetch {
        return async (input, init) => {
            const method = init?.method === "POST" ? "POST" : "GET"
            const text = typeof init?.body === "string" ? init.body : ""
            const answer = await this.#serve({ method, url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, timeoutMs: 1000, ...(text === "" ? {} : { form: form(text) }) })
            return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } })
        }
    }

    /** The requests the issuer has answered, oldest first. */
    get requests(): readonly FakeRequest[] {
        return this.#requests
    }

    /** How many requests asked this path (`/protocol/openid-connect/certs`, `/.well-known/openid-configuration`). */
    count(path: string): number {
        return this.#requests.filter((request) => request.path === path).length
    }

    /** The options a registration against this issuer takes: the issuer, the audience, the in-memory port, the clock, and the client when `callbackUri` is given. */
    options(overrides: Partial<OidcOptions> & { readonly callbackUri?: string; readonly postLogoutUri?: string } = {}): OidcOptions {
        const { callbackUri, postLogoutUri, ...rest } = overrides
        return {
            issuer: this.#issuer,
            audience: this.#audience,
            http: this.http,
            clock: this.#clock,
            allowInsecureHttp: this.#issuer.startsWith("http:"),
            ...(callbackUri === undefined
                ? {}
                : {
                      client: {
                          clientId: this.clientId,
                          ...(this.#secret === undefined ? {} : { clientSecret: this.#secret }),
                          callbackUri,
                          postLogoutUri: postLogoutUri ?? new URL("/signed-out", callbackUri).toString(),
                      },
                  }),
            ...rest,
        }
    }

    /** The discovery document. */
    metadata(): Readonly<Record<string, unknown>> {
        const base = `${this.#issuer}/protocol/openid-connect`
        return {
            issuer: this.#issuer,
            authorization_endpoint: `${base}/auth`,
            token_endpoint: `${base}/token`,
            jwks_uri: `${base}/certs`,
            end_session_endpoint: `${base}/logout`,
            id_token_signing_alg_values_supported: [this.#algorithm],
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
        }
    }

    /** The published key set: every key of the ring. */
    jwks(): { readonly keys: readonly JWK[] } {
        return { keys: this.#ring.map((key) => key.jwk) }
    }

    /** The `kid` of the key that signs now. */
    get keyId(): string {
        return this.#signer().kid
    }

    /** Rotates the signing key: a new key signs from now on. The old keys stay published (so tokens already minted verify) unless `keepOld` is false. Answers the new `kid`. */
    async rotateKeys(options: { readonly keepOld?: boolean } = {}): Promise<string> {
        const fresh = await generateKey(this.#algorithm)
        if (options.keepOld === false) this.#ring.length = 0
        this.#ring.unshift(fresh)
        return fresh.kid
    }

    /** Mints an access token for the claims, signed by the current key unless an override bends it. */
    mintAccessToken(claims: FakeTokenClaims = {}, overrides: MintOverrides = {}): Promise<string> {
        return this.#mint(claims, { type: "Bearer", ...overrides }, {})
    }

    /** Mints an ID token for the client, carrying the nonce of the transaction. */
    mintIdToken(claims: FakeTokenClaims = {}, nonce?: string, overrides: MintOverrides = {}): Promise<string> {
        return this.#mint(claims, { type: "ID", audience: this.clientId, ...overrides }, nonce === undefined ? {} : { nonce })
    }

    /**
     * Plays the browser of a code flow: reads the authorization address the code under test built, registers a one-use code for the claims, and
     * answers the address the provider would redirect the browser to (the redirect address with `code`, `state` and `iss`).
     */
    authorize(authorizationUrl: string, claims: FakeTokenClaims = {}): string {
        const query = new URL(authorizationUrl).searchParams
        const redirectUri = query.get("redirect_uri")
        const state = query.get("state")
        if (redirectUri === null || state === null || query.get("client_id") !== this.clientId || query.get("code_challenge_method") !== "S256") {
            throw new Error("fake OIDC issuer: the authorization request is not a registered S256 code flow")
        }
        const code = randomUUID()
        this.#codes.set(code, { claims, nonce: query.get("nonce") ?? "", challenge: query.get("code_challenge") ?? "", redirectUri, used: false })
        const back = new URL(redirectUri)
        back.search = new URLSearchParams({ code, state, iss: this.#issuer }).toString()
        return back.toString()
    }

    /** Makes the next `count` requests fail: with an HTTP status, or as a lost connection. */
    failNext(failure: FakeFailure = { status: 503 }, count = 1): void {
        for (let n = 0; n < count; n += 1) this.#failures.push(failure)
    }

    /** Bends every ID token the token endpoint mints from now on (an empty object restores them). */
    bendIdTokens(overrides: MintOverrides = {}): void {
        this.#idOverrides = overrides
    }

    /** Ends every refresh token the issuer holds, as an administrator signing the person out of the provider would: the next refresh answers `invalid_grant`. */
    revokeRefreshTokens(): void {
        this.#refreshTokens.clear()
    }

    /** While down, every request fails as a lost connection (an outage); `false` brings the issuer back. */
    setDown(down: boolean): void {
        this.#down = down
    }

    /** Stops the socket, when there is one. */
    async close(): Promise<void> {
        const server = this.#server
        if (server === undefined) return
        this.#server = undefined
        server.closeAllConnections()
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve()
            })
        })
    }

    #signer(): RingKey {
        const [key] = this.#ring
        if (key === undefined) throw new Error("fake OIDC issuer: no signing key")
        return key
    }

    async #mint(claims: FakeTokenClaims, overrides: MintOverrides, extra: Readonly<Record<string, unknown>>): Promise<string> {
        const signer = overrides.signer === "foreign" ? await generateKey(this.#algorithm) : this.#signer()
        const issuedAt = Math.floor((overrides.issuedAt ?? this.#clock.now()).getTime() / SECOND_MS)
        const subject = claims.sub ?? "user-1"
        const realm = claims.roles === undefined ? {} : { [OIDC_CLAIMS.realmAccess]: { roles: claims.roles } }
        const clients =
            claims.clientRoles === undefined
                ? {}
                : { [OIDC_CLAIMS.resourceAccess]: Object.fromEntries(Object.entries(claims.clientRoles).map(([client, roles]) => [client, { roles }])) }
        const jwt = new SignJWT({
            ...realm,
            ...clients,
            [OIDC_CLAIMS.sessionId]: claims.sessionId ?? `sid-${subject}`,
            [OIDC_CLAIMS.authorizedParty]: this.clientId,
            ...(overrides.type === undefined ? {} : { [OIDC_CLAIMS.tokenType]: overrides.type }),
            ...(claims.email === undefined ? {} : { [OIDC_CLAIMS.email]: claims.email }),
            ...(claims.name === undefined ? {} : { [OIDC_CLAIMS.name]: claims.name }),
            ...(claims.username === undefined ? {} : { [OIDC_CLAIMS.username]: claims.username }),
            ...claims.extra,
            ...extra,
        })
            .setProtectedHeader({ alg: this.#algorithm, typ: "JWT", ...(overrides.kid === null ? {} : { kid: overrides.kid ?? signer.kid }) })
            .setSubject(subject)
            .setIssuer(overrides.issuer ?? this.#issuer)
            .setAudience(overrides.audience === undefined ? this.#audience : typeof overrides.audience === "string" ? overrides.audience : [...overrides.audience])
            .setJti(randomUUID())
            .setIssuedAt(issuedAt)
            .setExpirationTime(issuedAt + (overrides.expiresInSeconds ?? this.#accessTtl))
        if (overrides.notBefore !== undefined) jwt.setNotBefore(Math.floor(overrides.notBefore.getTime() / SECOND_MS))
        return jwt.sign(signer.privateKey)
    }

    async #serve(request: OidcHttpRequest): Promise<OidcHttpResponse> {
        const url = new URL(request.url)
        const path = url.pathname.startsWith(new URL(this.#issuer).pathname) ? url.pathname.slice(new URL(this.#issuer).pathname.length) : url.pathname
        this.#requests.push({ method: request.method, path })
        if (this.#down) throw new Error("fake OIDC issuer: connection refused")
        const failure = this.#failures.shift()
        if (failure === "network") throw new Error("fake OIDC issuer: connection reset")
        if (failure !== undefined) return { status: failure.status, body: { error: "server_error" } }
        return this.#handle(request.method, path, request.form ?? {})
    }

    async #handle(method: string, path: string, params: Readonly<Record<string, string>>): Promise<HandledResponse> {
        if (method === "GET" && path === DISCOVERY) return { status: 200, body: this.metadata() }
        if (method === "GET" && path === KEYCLOAK_PATHS.certs) return { status: 200, body: this.jwks() }
        if (method === "GET" && path === KEYCLOAK_PATHS.logout) return { status: 200, body: {} }
        if (method === "POST" && path === KEYCLOAK_PATHS.token) return this.#token(params)
        return { status: 404, body: { error: "not_found" } }
    }

    async #token(params: Readonly<Record<string, string>>): Promise<HandledResponse> {
        if (params.client_id !== this.clientId || (this.#secret !== undefined && params.client_secret !== this.#secret)) return { status: 401, body: { error: "invalid_client" } }
        if (params.grant_type === "authorization_code") return this.#exchangeCode(params)
        if (params.grant_type === "refresh_token") return this.#refresh(params.refresh_token)
        return { status: 400, body: { error: "unsupported_grant_type" } }
    }

    async #exchangeCode(params: Readonly<Record<string, string>>): Promise<HandledResponse> {
        const pending = this.#codes.get(params.code ?? "")
        const verifier = params.code_verifier ?? ""
        if (pending === undefined || pending.used || pending.redirectUri !== params.redirect_uri || s256(verifier) !== pending.challenge) {
            return { status: 400, body: { error: "invalid_grant" } }
        }
        pending.used = true
        return { status: 200, body: await this.#grant(pending.claims, pending.nonce) }
    }

    async #refresh(token: string | undefined): Promise<HandledResponse> {
        const held = token === undefined ? undefined : this.#refreshTokens.get(token)
        if (held === undefined || held.used) return { status: 400, body: { error: "invalid_grant" } }
        held.used = true
        return { status: 200, body: await this.#grant(held.claims, undefined) }
    }

    async #grant(claims: FakeTokenClaims, nonce: string | undefined): Promise<Readonly<Record<string, unknown>>> {
        const refreshToken = randomUUID()
        this.#refreshTokens.set(refreshToken, { claims, used: false })
        return {
            token_type: "Bearer",
            access_token: await this.mintAccessToken(claims),
            id_token: await this.mintIdToken(claims, nonce, this.#idOverrides),
            refresh_token: refreshToken,
            expires_in: this.#accessTtl,
        }
    }

    async #start(): Promise<void> {
        const server = createServer((request, response) => {
            void this.#respond(request, response)
        })
        this.#server = server
        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve)
        })
        const { port } = server.address() as AddressInfo
        this.#issuer = `http://127.0.0.1:${String(port)}/realms/${this.#realm}`
    }

    async #respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" }
        if (request.method === "OPTIONS") {
            response.writeHead(204, cors).end()
            return
        }
        const text = request.method === "POST" ? await readBody(request) : ""
        try {
            const answer = await this.#serve({
                method: request.method === "POST" ? "POST" : "GET",
                url: `${this.#issuer.slice(0, this.#issuer.indexOf("/realms/"))}${request.url ?? "/"}`,
                timeoutMs: 1000,
                ...(text === "" ? {} : { form: form(text) }),
            })
            response.writeHead(answer.status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(answer.body))
        } catch {
            response.destroy()
        }
    }
}
