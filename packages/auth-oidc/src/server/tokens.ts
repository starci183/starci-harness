import { decodeProtectedHeader, errors, jwtVerify } from "jose"
import type { JWTPayload } from "jose"
import { OIDC_ACCESS_TOKEN_INVALID } from "../contracts/index.ts"
import type { OidcAlgorithm, OidcOutcome, OidcRefusalReason } from "../contracts/index.ts"
import type { OidcKeys } from "./jwks.ts"
import type { ResolvedOidcOptions } from "./options.ts"

/** What one verification expects beyond the issuer and the pinned algorithms. */
export interface TokenExpectations {
    /** The audience: the token must name one of these. */
    readonly audience: readonly string[]
    /** Claims the token must carry. */
    readonly requiredClaims?: readonly string[] | undefined
}

const refuse = (reason: OidcRefusalReason): OidcOutcome<never> => ({ kind: "refused", code: OIDC_ACCESS_TOKEN_INVALID, detail: { reason } })

/** The reason a jose error stands for. */
const reasonOf = (error: unknown): OidcRefusalReason => {
    if (error instanceof errors.JWTExpired) return "expired"
    if (error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) return "signature"
    if (error instanceof errors.JOSEAlgNotAllowed) return "algorithm"
    if (error instanceof errors.JWTClaimValidationFailed) {
        switch (error.claim) {
            case "iss":
                return "issuer"
            case "aud":
                return "audience"
            case "nbf":
            case "iat":
                return "not-yet-valid"
            case "exp":
                return "expired"
            default:
                return "claims"
        }
    }
    return error instanceof errors.JWTInvalid || error instanceof errors.JWSInvalid ? "malformed" : "signature"
}

/** The header of a token read without trusting it, only to pick the verification key; `undefined` when it is not a JWS header. */
const headerOf = (token: string): { readonly alg: string | undefined; readonly kid: string | undefined } | undefined => {
    try {
        const header = decodeProtectedHeader(token)
        return { alg: header.alg, kid: header.kid }
    } catch {
        return undefined
    }
}

/**
 * The one verifier of the provider's signed tokens (access tokens and ID tokens). The algorithm is pinned to the registration's list
 * before any key is looked up (so `none` and a symmetric algorithm never reach a key), the key comes from the provider's JWKS by `kid`,
 * and the issuer, audience, expiry and not-before are checked against the registration and the clock.
 */
export class OidcTokenVerifier {
    readonly #options: ResolvedOidcOptions
    readonly #keys: OidcKeys

    constructor(options: ResolvedOidcOptions, keys: OidcKeys) {
        this.#options = options
        this.#keys = keys
    }

    /** The algorithms this verifier admits. */
    get algorithms(): readonly OidcAlgorithm[] {
        return this.#options.algorithms
    }

    /** The claims of a token that passed every check, or a refusal naming why. A provider that cannot be reached throws `Unavailable`. */
    async verify(token: string, expectations: TokenExpectations, now: Date = this.#options.clock.now()): Promise<OidcOutcome<JWTPayload>> {
        const header = headerOf(token)
        if (header === undefined) return refuse("malformed")
        const admitted: readonly string[] = this.#options.algorithms
        if (header.alg === undefined || !admitted.includes(header.alg)) return refuse("algorithm")
        const keys = await this.#keys.keysFor(header.kid)
        try {
            const { payload } = await jwtVerify(token, keys, {
                algorithms: [...this.#options.algorithms],
                issuer: this.#options.issuer,
                audience: [...expectations.audience],
                currentDate: now,
                clockTolerance: this.#options.clockToleranceSeconds,
                requiredClaims: ["exp", "sub", ...(expectations.requiredClaims ?? [])],
            })
            return { kind: "ok", value: payload }
        } catch (error) {
            return refuse(reasonOf(error))
        }
    }
}
