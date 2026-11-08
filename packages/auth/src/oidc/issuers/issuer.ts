import type { JWTPayload } from "jose"
import { OIDC_ACCESS_TOKEN_INVALID, OIDC_ERROR_CODES } from "../../contracts/oidc.ts"
import type { OidcAlgorithm, OidcOutcome, OidcRefusalReason } from "../../contracts/oidc.ts"
import { OidcDiscovery } from "../discovery.ts"
import { OidcError } from "../errors.ts"
import { OidcKeys } from "../jwks.ts"
import type { OidcKeySource } from "../jwks.ts"
import { isAdmissibleUrl, resolveOptions } from "../options.ts"
import type { OidcHttp, OidcJwksOptions, ResolvedOidcOptions } from "../options.ts"
import type { OidcClock } from "../primitives.ts"
import { OidcTokenVerifier } from "../tokens.ts"

/** Where an issuer's keys come from: an address the preset pins (Google, GitHub Actions), or the issuer's discovery document (Keycloak). */
export type IssuerKeys = { readonly kind: "jwks"; readonly uri: string } | { readonly kind: "discovery" }

/** The addresses of a test double standing in for an issuer (the fake issuer of `@starci/auth/testing`); a deployment never sets them. */
export interface IssuerEndpoints {
    /** The `iss` the double signs with. */
    readonly issuer: string
    /** The double's key set address. */
    readonly jwksUri: string
}

/**
 * One identity issuer whose signed tokens an app verifies: who signs (issuer), with what (algorithms, pinned before any key is looked up),
 * for whom (audience, never empty), where the keys are, which claims a token must carry, and how verified claims become what the app reads
 * (`identityOf`, which may refuse a token whose claims break the preset's policy). A preset is data plus one mapping; the verifier is the
 * package's (`createIssuerVerifier`).
 */
export interface IssuerPreset<T> {
    /** The preset name, for a log line (`github-actions`). */
    readonly name: string
    /** The exact issuer. */
    readonly issuer: string
    /** Other spellings of the same issuer the `iss` claim may carry (`accounts.google.com`). */
    readonly issuerAliases: readonly string[]
    /** Where the keys come from. */
    readonly keys: IssuerKeys
    /** The algorithms a token may be signed with. */
    readonly algorithms: readonly OidcAlgorithm[]
    /** The audience a token must name: one of these. */
    readonly audience: readonly string[]
    /** Claims a token must carry beyond `exp` and `sub`. */
    readonly requiredClaims: readonly string[]
    /** What the verified claims stand for, or a refusal naming the reason and the claim. */
    readonly identityOf: (claims: JWTPayload) => IssuerMapping<T>
}

/** The result of a preset's claim mapping. */
export type IssuerMapping<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "refused"; readonly reason: OidcRefusalReason; readonly claim?: string }

/** A mapped identity. */
export const mapped = <T>(value: T): IssuerMapping<T> => ({ kind: "ok", value })

/** A refused mapping: the reason, and the claim that decided it. */
export const unmapped = (reason: OidcRefusalReason, claim?: string): IssuerMapping<never> => (claim === undefined ? { kind: "refused", reason } : { kind: "refused", reason, claim })

/** The transport and timing of an issuer verifier; the preset decides everything that is trust. */
export interface IssuerVerifierOptions {
    /** The outbound HTTP port (the platform `fetch` when absent): the app's bounded client. */
    readonly http?: OidcHttp | undefined
    /** The clock (system time when absent). */
    readonly clock?: OidcClock | undefined
    /** The deadline of every key or discovery request, in milliseconds (10000). */
    readonly timeoutMs?: number | undefined
    /** The clock skew a token's `exp` and `nbf` tolerate, in seconds (5). */
    readonly clockToleranceSeconds?: number | undefined
    /** The key set cache. */
    readonly jwks?: OidcJwksOptions | undefined
    /** Admit `http:` addresses: only for a test double on a developer machine. */
    readonly allowInsecureHttp?: boolean | undefined
}

/** A verifier of one issuer's tokens. */
export interface IssuerVerifier<T> {
    /** The preset it verifies for. */
    readonly preset: IssuerPreset<T>
    /** What a token stands for when it passes the algorithm pin, the signature against the issuer's keys, issuer, audience, expiry, the required claims and the preset's policy; else a refusal. An issuer that cannot be reached throws `Unavailable`. */
    verify(token: string, now?: Date): Promise<OidcOutcome<T>>
}

const refuse = (reason: OidcRefusalReason, claim?: string): OidcOutcome<never> => ({
    kind: "refused",
    code: OIDC_ACCESS_TOKEN_INVALID,
    detail: claim === undefined ? { reason } : { reason, claim },
})

const keySourceOf = (preset: IssuerPreset<unknown>, options: ResolvedOidcOptions): OidcKeySource => {
    if (preset.keys.kind === "discovery") return new OidcDiscovery(options)
    const uri = preset.keys.uri
    if (!isAdmissibleUrl(uri, options.allowInsecureHttp)) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "keys.uri" } })
    return { get: () => Promise.resolve({ jwksUri: uri }) }
}

/** Builds the verifier of one preset; a preset that does not meet the contract (no audience, an admitted algorithm list, an address) throws `ConfigurationInvalid`. */
export const createIssuerVerifier = <T>(preset: IssuerPreset<T>, options: IssuerVerifierOptions = {}): IssuerVerifier<T> => {
    const resolved = resolveOptions({ ...options, issuer: preset.issuer, audience: preset.audience, algorithms: preset.algorithms })
    const tokens = new OidcTokenVerifier(resolved, new OidcKeys(resolved, keySourceOf(preset, resolved)))
    const issuers = [preset.issuer, ...preset.issuerAliases]
    return {
        preset,
        async verify(token, now = resolved.clock.now()) {
            const verified = await tokens.verify(token, { audience: resolved.audience, issuer: issuers, requiredClaims: preset.requiredClaims }, now)
            if (verified.kind === "refused") return verified
            const identity = preset.identityOf(verified.value)
            return identity.kind === "ok" ? { kind: "ok", value: identity.value } : refuse(identity.reason, identity.claim)
        },
    }
}
