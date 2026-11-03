import { createLocalJWKSet } from "jose"
import type { JSONWebKeySet } from "jose"
import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import type { OidcDiscovery } from "./discovery.ts"
import { OidcError } from "./errors.ts"
import type { ResolvedOidcOptions } from "./options.ts"
import { isRecord } from "./primitives.ts"

/** The key set jose selects a verification key from. */
export type OidcKeySet = ReturnType<typeof createLocalJWKSet>

/** The members that make a JWK private or symmetric: a key set carrying one is never verification input. */
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k", "oth"] as const

const KEY_TYPES: readonly string[] = ["RSA", "EC", "OKP"]

const isPublicKey = (key: unknown): key is Readonly<Record<string, unknown>> =>
    isRecord(key) && typeof key.kty === "string" && KEY_TYPES.includes(key.kty) && PRIVATE_MEMBERS.every((member) => key[member] === undefined)

/**
 * Narrows a fetched document to public signature keys. Keys the provider marks for encryption are dropped (Keycloak publishes
 * them beside its signing keys); a document with no key left, with more than `maxKeys`, or with a private or symmetric key is rejected.
 */
export const readKeySet = (value: unknown, maxKeys: number): JSONWebKeySet => {
    if (!isRecord(value) || !Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > maxKeys) throw new OidcError(OIDC_ERROR_CODES.Rejected)
    const keys: unknown[] = value.keys
    if (!keys.every(isPublicKey)) throw new OidcError(OIDC_ERROR_CODES.Rejected)
    const signing = keys.filter(isPublicKey).filter((key) => key.use !== "enc")
    if (signing.length === 0) throw new OidcError(OIDC_ERROR_CODES.Rejected)
    // Every key was checked above to be public key material of a known type; jose checks the members it needs when it selects a key.
    return { keys: signing.map((key) => ({ ...key })) }
}

interface Held {
    readonly set: JSONWebKeySet
    readonly local: OidcKeySet
    readonly at: number
}

/** The key ids a held set publishes. */
const kidsOf = (set: JSONWebKeySet): ReadonlySet<string> => new Set(set.keys.flatMap((key) => (typeof key.kid === "string" ? [key.kid] : [])))

/**
 * The provider's signing keys: fetched from the discovered `jwks_uri`, cached for `ttlMs`, and refreshed when a token names a `kid` the
 * cache lacks (the provider rotated), at most once per `refreshCooldownMs`. When the provider cannot be reached the expired set is still
 * used for `staleTtlMs`, so a provider outage does not sign everybody out; past that the call throws `Unavailable`. Concurrent callers share one fetch.
 */
export class OidcKeys {
    readonly #options: ResolvedOidcOptions
    readonly #discovery: OidcDiscovery
    #held: Held | undefined
    #pending: Promise<Held> | undefined

    constructor(options: ResolvedOidcOptions, discovery: OidcDiscovery) {
        this.#options = options
        this.#discovery = discovery
    }

    /** The key set to verify a token whose header names `kid` (undefined when it names none). */
    async keysFor(kid: string | undefined): Promise<OidcKeySet> {
        const options = this.#options
        const now = options.clock.now().getTime()
        const held = this.#held
        if (held !== undefined) {
            const age = now - held.at
            const known = kid === undefined || kidsOf(held.set).has(kid)
            if (age < options.jwksTtlMs && (known || age < options.jwksCooldownMs)) return held.local
        }
        try {
            return (await this.#refresh()).local
        } catch (cause) {
            if (held !== undefined && now - held.at < options.jwksStaleMs) return held.local
            throw cause
        }
    }

    #refresh(): Promise<Held> {
        this.#pending ??= this.#fetch().finally(() => {
            this.#pending = undefined
        })
        return this.#pending
    }

    async #fetch(): Promise<Held> {
        const options = this.#options
        const { jwksUri } = await this.#discovery.get()
        const response = await options.http.request({ method: "GET", url: jwksUri, timeoutMs: options.timeoutMs }).catch((cause: unknown) => {
            throw new OidcError(OIDC_ERROR_CODES.Unavailable, { cause })
        })
        if (response.status !== 200) throw new OidcError(OIDC_ERROR_CODES.Unavailable)
        const set = readKeySet(response.body, options.jwksMaxKeys)
        const held: Held = { set, local: createLocalJWKSet(set), at: options.clock.now().getTime() }
        this.#held = held
        return held
    }
}
