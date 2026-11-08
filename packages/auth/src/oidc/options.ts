import { OIDC_ALGORITHMS, OIDC_DEFAULT_ALGORITHMS, OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import type { OidcAlgorithm } from "../contracts/oidc.ts"
import { OidcError } from "./errors.ts"
import type { OidcClock, SecretInput } from "./primitives.ts"
import { systemClock } from "./primitives.ts"

/** One outbound request of the provider protocol. */
export interface OidcHttpRequest {
    readonly method: "GET" | "POST" | "PUT"
    readonly url: string
    /** The deadline of this request, in milliseconds. */
    readonly timeoutMs: number
    /** A form-encoded body (`application/x-www-form-urlencoded`) for a POST. */
    readonly form?: Readonly<Record<string, string>>
    /** A JSON body (`application/json`) for a POST or a PUT; use either `body` or `form`, not both. The provider's admin API takes JSON. */
    readonly body?: unknown
    /** Extra request headers (`authorization` of the admin API). */
    readonly headers?: Readonly<Record<string, string>>
}

/** The answer to an outbound request: the status and the parsed JSON body (`undefined` when the body is not JSON). */
export interface OidcHttpResponse {
    readonly status: number
    readonly body: unknown
    /** The `Location` header of the answer, when it has one and the port reads it (a created user's address); optional, nothing depends on it. */
    readonly location?: string | undefined
}

/**
 * The outbound HTTP port. An app passes its own bounded client (`platform/http`) through its glue, so the provider is spoken to
 * through the one door the app owns; a registration without it uses the platform `fetch` with the request's deadline.
 */
export interface OidcHttp {
    /** Sends one request; a transport failure rejects, any answer resolves. */
    request(request: OidcHttpRequest): Promise<OidcHttpResponse>
}

/** Which roles of a token become the principal's roles. */
export interface OidcRoleMapping {
    /** Read `realm_access.roles` (true when absent). */
    readonly realm?: boolean | undefined
    /** Read `resource_access.<client>.roles` of each of these clients. */
    readonly clients?: readonly string[] | undefined
    /** Read these flat claims, each an array of text (`groups`, `roles`). */
    readonly claims?: readonly string[] | undefined
}

/** How the JWKS is cached. */
export interface OidcJwksOptions {
    /** How long a fetched key set is used without asking again (10 minutes). */
    readonly ttlMs?: number | undefined
    /** The least time between two fetches that an unknown `kid` may cause, so a forged `kid` cannot make the provider a target (30 seconds). */
    readonly refreshCooldownMs?: number | undefined
    /** How long an expired key set is still used when the provider cannot be reached (24 hours). */
    readonly staleTtlMs?: number | undefined
    /** The most keys a set may hold (100). */
    readonly maxKeys?: number | undefined
}

/** The registered client of the authorization code flow. Absent for an API that only verifies bearer tokens. */
export interface OidcClientRegistration {
    /** The client id; the audience of the ID token. */
    readonly clientId: string
    /** The client secret of a confidential client, revealed only for the token request. Absent for a public client. */
    readonly clientSecret?: SecretInput | undefined
    /** The exact registered redirect address. */
    readonly callbackUri: string
    /** The exact registered address the provider returns to after logout. */
    readonly postLogoutUri: string
    /** The requested scope (`openid`). */
    readonly scope?: string | undefined
}

/** Everything the package needs, typed and parsed by the app (the package reads no environment). */
export interface OidcOptions {
    /** The exact issuer: the `iss` claim of every token and the `issuer` of the discovery document. */
    readonly issuer: string
    /** The audience an access token must name: one of these. */
    readonly audience: string | readonly string[]
    /** The algorithms a token may be signed with (`RS256`). Asymmetric only. */
    readonly algorithms?: readonly OidcAlgorithm[] | undefined
    /** When set, an access token's `azp` claim must equal it. */
    readonly authorizedParty?: string | undefined
    /** The authorization code flow client; needed to build an authorization address, exchange a code or build a logout address. */
    readonly client?: OidcClientRegistration | undefined
    /** Which roles become the principal's roles (the realm roles). */
    readonly roles?: OidcRoleMapping | undefined
    /** The deadline of every provider request, in milliseconds (10000). */
    readonly timeoutMs?: number | undefined
    /** The clock skew a token's `exp` and `nbf` tolerate, in seconds (5). */
    readonly clockToleranceSeconds?: number | undefined
    /** How long a discovery document is used (1 hour). */
    readonly discoveryTtlMs?: number | undefined
    /** The JWKS cache. */
    readonly jwks?: OidcJwksOptions | undefined
    /** Admit `http:` addresses. Only for a provider on a developer machine or a test double; never in a deployment. */
    readonly allowInsecureHttp?: boolean | undefined
    /** The outbound HTTP port (the platform `fetch` when absent). */
    readonly http?: OidcHttp | undefined
    /** The clock (system time when absent). */
    readonly clock?: OidcClock | undefined
}

/** The options after validation, with every default applied. */
export interface ResolvedOidcOptions {
    readonly issuer: string
    readonly audience: readonly string[]
    readonly algorithms: readonly OidcAlgorithm[]
    readonly authorizedParty: string | undefined
    readonly client: OidcClientRegistration | undefined
    readonly realmRoles: boolean
    readonly roleClients: readonly string[]
    readonly roleClaims: readonly string[]
    readonly timeoutMs: number
    readonly clockToleranceSeconds: number
    readonly discoveryTtlMs: number
    readonly jwksTtlMs: number
    readonly jwksCooldownMs: number
    readonly jwksStaleMs: number
    readonly jwksMaxKeys: number
    readonly allowInsecureHttp: boolean
    readonly http: OidcHttp
    readonly clock: OidcClock
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

const invalid = (key: string): OidcError => new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key } })

/** True when the address is an absolute, credential-free URL on the scheme the registration admits (https; http only when allowed). */
export const isAdmissibleUrl = (value: string, insecure: boolean): boolean => {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    const scheme = url.protocol === "https:" || (insecure && url.protocol === "http:")
    return scheme && url.username === "" && url.password === "" && url.hash === ""
}

const positive = (value: number | undefined, fallback: number, key: string): number => {
    const chosen = value ?? fallback
    if (!Number.isFinite(chosen) || chosen <= 0) throw invalid(key)
    return chosen
}

const toleranceOf = (value: number | undefined): number => {
    const chosen = value ?? 5
    if (!Number.isFinite(chosen) || chosen < 0) throw invalid("clockToleranceSeconds")
    return chosen
}

const audiencesOf = (audience: string | readonly string[]): readonly string[] => {
    const list = typeof audience === "string" ? [audience] : audience
    if (list.length === 0 || list.some((entry) => entry === "")) throw invalid("audience")
    return list
}

const algorithmsOf = (algorithms: readonly OidcAlgorithm[] | undefined): readonly OidcAlgorithm[] => {
    const list = algorithms ?? OIDC_DEFAULT_ALGORITHMS
    const admitted: readonly string[] = OIDC_ALGORITHMS
    if (list.length === 0 || list.some((algorithm) => !admitted.includes(algorithm))) throw invalid("algorithms")
    return list
}

const checkClient = (client: OidcClientRegistration, insecure: boolean): void => {
    if (client.clientId === "") throw invalid("client.clientId")
    for (const key of ["callbackUri", "postLogoutUri"] as const) {
        const value = client[key]
        if (!isAdmissibleUrl(value, insecure) || new URL(value).search !== "") throw invalid(`client.${key}`)
    }
}

/** The platform `fetch` as the outbound port: JSON answers are parsed, the request's deadline aborts it. */
export const fetchHttp: OidcHttp = {
    async request(request) {
        const response = await fetch(request.url, {
            method: request.method,
            redirect: "manual",
            signal: AbortSignal.timeout(request.timeoutMs),
            headers: {
                accept: "application/json",
                ...(request.form === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
                ...(request.body === undefined ? {} : { "content-type": "application/json" }),
                ...request.headers,
            },
            ...(request.form === undefined ? {} : { body: new URLSearchParams(request.form).toString() }),
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        })
        const body: unknown = await response.json().catch(() => undefined)
        const location = response.headers.get("location")
        return { status: response.status, body, ...(location === null ? {} : { location }) }
    },
}

/** Validates the registration and applies the defaults. A key that does not meet the contract throws a `ConfigurationInvalid` error naming it. */
export const resolveOptions = (options: OidcOptions): ResolvedOidcOptions => {
    const insecure = options.allowInsecureHttp ?? false
    if (!isAdmissibleUrl(options.issuer, insecure) || new URL(options.issuer).search !== "") throw invalid("issuer")
    if (options.client !== undefined) checkClient(options.client, insecure)
    const jwks = options.jwks
    return {
        issuer: options.issuer,
        audience: audiencesOf(options.audience),
        algorithms: algorithmsOf(options.algorithms),
        authorizedParty: options.authorizedParty,
        client: options.client,
        realmRoles: options.roles?.realm ?? true,
        roleClients: options.roles?.clients ?? [],
        roleClaims: options.roles?.claims ?? [],
        timeoutMs: positive(options.timeoutMs, 10_000, "timeoutMs"),
        clockToleranceSeconds: toleranceOf(options.clockToleranceSeconds),
        discoveryTtlMs: positive(options.discoveryTtlMs, HOUR_MS, "discoveryTtlMs"),
        jwksTtlMs: positive(jwks?.ttlMs, 10 * MINUTE_MS, "jwks.ttlMs"),
        jwksCooldownMs: positive(jwks?.refreshCooldownMs, MINUTE_MS / 2, "jwks.refreshCooldownMs"),
        jwksStaleMs: positive(jwks?.staleTtlMs, 24 * HOUR_MS, "jwks.staleTtlMs"),
        jwksMaxKeys: positive(jwks?.maxKeys, 100, "jwks.maxKeys"),
        allowInsecureHttp: insecure,
        http: options.http ?? fetchHttp,
        clock: options.clock ?? systemClock,
    }
}
