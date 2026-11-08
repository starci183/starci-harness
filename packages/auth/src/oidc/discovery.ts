import { OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import { OidcError } from "./errors.ts"
import { isAdmissibleUrl } from "./options.ts"
import type { ResolvedOidcOptions } from "./options.ts"
import { isRecord } from "./primitives.ts"

/** The endpoints of the discovery document the package uses, each validated against the issuer. */
export interface OidcMetadata {
    readonly issuer: string
    readonly authorizationEndpoint: string
    readonly tokenEndpoint: string
    readonly jwksUri: string
    /** Absent when the provider offers no RP-initiated logout. */
    readonly endSessionEndpoint: string | undefined
    /** The RFC 7009 token revocation endpoint; absent when the provider advertises none. */
    readonly revocationEndpoint: string | undefined
}

const DISCOVERY_PATH = "/.well-known/openid-configuration"

/** The discovery address of an issuer. */
export const discoveryUrl = (issuer: string): string => `${issuer.replace(/\/$/u, "")}${DISCOVERY_PATH}`

const rejected = (): OidcError => new OidcError(OIDC_ERROR_CODES.Rejected)

/**
 * An endpoint the provider advertises is trusted only on the issuer's own origin, over the admitted scheme, without credentials or a
 * fragment: a discovery document cannot send the client secret or the browser to another host.
 */
const endpointOf = (value: unknown, options: ResolvedOidcOptions): string => {
    if (typeof value !== "string" || !isAdmissibleUrl(value, options.allowInsecureHttp)) throw rejected()
    if (new URL(value).origin !== new URL(options.issuer).origin) throw rejected()
    return value
}

/** Narrows a discovery document: its `issuer` is the configured issuer exactly, and every endpoint passes `endpointOf`. */
export const readMetadata = (value: unknown, options: ResolvedOidcOptions): OidcMetadata => {
    if (!isRecord(value) || value.issuer !== options.issuer) throw rejected()
    return {
        issuer: options.issuer,
        authorizationEndpoint: endpointOf(value.authorization_endpoint, options),
        tokenEndpoint: endpointOf(value.token_endpoint, options),
        jwksUri: endpointOf(value.jwks_uri, options),
        endSessionEndpoint: value.end_session_endpoint === undefined ? undefined : endpointOf(value.end_session_endpoint, options),
        revocationEndpoint: value.revocation_endpoint === undefined ? undefined : endpointOf(value.revocation_endpoint, options),
    }
}

interface Held {
    readonly metadata: OidcMetadata
    readonly at: number
}

/** Fetches and caches the discovery document of the issuer; concurrent callers share one request. */
export class OidcDiscovery {
    readonly #options: ResolvedOidcOptions
    #held: Held | undefined
    #pending: Promise<OidcMetadata> | undefined

    constructor(options: ResolvedOidcOptions) {
        this.#options = options
    }

    /** The metadata: the cached document while it is fresh, else a new one. A provider that cannot be asked throws `Unavailable`; the cached document is never used past its life, so an outage never keeps stale endpoints. */
    async get(): Promise<OidcMetadata> {
        const now = this.#options.clock.now().getTime()
        if (this.#held !== undefined && now - this.#held.at < this.#options.discoveryTtlMs) return this.#held.metadata
        this.#pending ??= this.#fetch().finally(() => {
            this.#pending = undefined
        })
        return this.#pending
    }

    async #fetch(): Promise<OidcMetadata> {
        const options = this.#options
        const response = await options.http
            .request({ method: "GET", url: discoveryUrl(options.issuer), timeoutMs: options.timeoutMs })
            .catch((cause: unknown) => {
                throw new OidcError(OIDC_ERROR_CODES.Unavailable, { cause })
            })
        if (response.status !== 200) throw new OidcError(OIDC_ERROR_CODES.Unavailable)
        const metadata = readMetadata(response.body, options)
        this.#held = { metadata, at: options.clock.now().getTime() }
        return metadata
    }
}
