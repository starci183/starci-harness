import { createHash, createHmac } from "node:crypto"
import { SignJWT, calculateJwkThumbprint, createLocalJWKSet, exportJWK, importPKCS8, importSPKI, jwtVerify } from "jose"
import type { CryptoKey, KeyObject } from "jose"
import { AUTH_ALGORITHM, AUTH_AUDIENCE, AUTH_CLAIMS, AUTH_ERROR_CODES, AUTH_ROLE } from "../contracts/index.ts"
import type { JwksDocument, PublicJwk } from "../contracts/index.ts"
import { AuthError, ok, refused } from "./errors.ts"
import type { Outcome } from "./errors.ts"
import type { AuthOptions } from "./options.ts"
import type { AccessClaims, IssuedAccessToken } from "./ports.ts"
import { revealed, signStateToken, verifyStateToken } from "./primitives.ts"
import type { SignedState } from "./primitives.ts"

const STATE_LABEL = "passport.google-state"

type PrivateKey = CryptoKey | KeyObject
interface LoadedKey { readonly keyId: string; readonly jwk: PublicJwk; readonly privateKey: PrivateKey | undefined }
interface KeyRing {
    readonly signer: LoadedKey & { readonly privateKey: PrivateKey }
    readonly verifyingSet: ReturnType<typeof createLocalJWKSet>
    readonly document: JwksDocument
}

const pemOf = (value: string): string => value.replaceAll(String.raw`\n`, "\n")

/** The options this signer needs. */
export type TokenOptions = Pick<AuthOptions, "issuer" | "audience" | "keys" | "accessTtlSeconds">

/**
 * The one signer and verifier of our access tokens (Ed25519 JWTs, the algorithm pinned) and of the short-lived Google state.
 * The key set holds one signing key and any number of retired keys: all of them verify and are published as the JWKS, so a key
 * rotates without signing anybody out (add the new key first, make it the signer, drop the old one when its tokens have expired).
 */
export class AuthTokens {
    readonly #options: TokenOptions
    #ring: Promise<KeyRing> | undefined

    constructor(options: TokenOptions) {
        this.#options = options
    }

    /** Signs an access token for one device session. */
    async sign(claims: AccessClaims, now: Date): Promise<IssuedAccessToken> {
        const { signer } = await this.#keys()
        const issuedAt = Math.floor(now.getTime() / 1000)
        const expiresAt = issuedAt + this.#options.accessTtlSeconds
        const token = await new SignJWT({
            [AUTH_CLAIMS.role]: AUTH_ROLE,
            [AUTH_CLAIMS.sessionId]: claims.sessionId,
            ...(claims.email === undefined ? {} : { [AUTH_CLAIMS.email]: claims.email }),
        })
            .setProtectedHeader({ alg: AUTH_ALGORITHM, kid: signer.keyId, typ: "JWT" })
            .setSubject(claims.sub)
            .setIssuer(this.#options.issuer)
            .setAudience(this.#options.audience ?? AUTH_AUDIENCE)
            .setIssuedAt(issuedAt)
            .setExpirationTime(expiresAt)
            .sign(signer.privateKey)
        return { token, expiresAt: new Date(expiresAt * 1000) }
    }

    /** The claims of a token that passed signature (against any key of the set), issuer, audience and expiry, or a refusal. */
    async verify(token: string, now: Date): Promise<Outcome<AccessClaims>> {
        const { verifyingSet } = await this.#keys()
        try {
            const { payload } = await jwtVerify(token, verifyingSet, {
                algorithms: [AUTH_ALGORITHM],
                issuer: this.#options.issuer,
                audience: this.#options.audience ?? AUTH_AUDIENCE,
                currentDate: now,
            })
            const sessionId = payload[AUTH_CLAIMS.sessionId]
            if (payload[AUTH_CLAIMS.role] !== AUTH_ROLE || typeof payload.sub !== "string" || typeof sessionId !== "string") {
                return refused(AUTH_ERROR_CODES.AccessTokenInvalid)
            }
            const email = payload[AUTH_CLAIMS.email]
            return ok({ sub: payload.sub, sessionId, ...(typeof email === "string" ? { email } : {}) })
        } catch (cause) {
            return refused(AUTH_ERROR_CODES.AccessTokenInvalid, { cause: String(cause) })
        }
    }

    /** The public key document: every key of the set. */
    async jwks(): Promise<JwksDocument> {
        return (await this.#keys()).document
    }

    /** Signs the state of a Google round trip (an HMAC under a key derived from the signing key). */
    signState(state: SignedState): string {
        return signStateToken(this.#stateKey(), state)
    }

    /** The state when the value is ours, unexpired and untampered; otherwise null. */
    verifyState(value: string, now: Date): SignedState | null {
        return verifyStateToken(this.#stateKey(), value, now.getTime())
    }

    #stateKey(): Buffer {
        const signer = this.#options.keys.find((key) => key.privateKey !== undefined)
        if (signer?.privateKey === undefined) throw new AuthError(AUTH_ERROR_CODES.KeyInvalid, { context: { reason: "no signing key" } })
        const pem = pemOf(revealed(signer.privateKey))
        const material = createHash("sha256").update(pem, "utf8").digest()
        return createHmac("sha256", material).update(STATE_LABEL).digest()
    }

    #keys(): Promise<KeyRing> {
        this.#ring ??= this.#load()
        return this.#ring
    }

    async #load(): Promise<KeyRing> {
        const loaded = await Promise.all(this.#options.keys.map((key) => loadKey(key)))
        const signers = loaded.filter((key) => key.privateKey !== undefined)
        const [signer] = signers
        if (signers.length !== 1 || signer?.privateKey === undefined) {
            throw new AuthError(AUTH_ERROR_CODES.KeyInvalid, { context: { reason: "the key set needs exactly one signing key", signers: signers.length } })
        }
        const ids = new Set(loaded.map((key) => key.keyId))
        if (ids.size !== loaded.length) throw new AuthError(AUTH_ERROR_CODES.KeyInvalid, { context: { reason: "two keys share a kid" } })
        const keys = loaded.map((key) => ({ ...key.jwk }))
        return {
            signer: { ...signer, privateKey: signer.privateKey },
            verifyingSet: createLocalJWKSet({ keys }),
            document: { keys: loaded.map((key) => key.jwk) },
        }
    }
}

const publicJwkOf = async (publicKey: string, keyId: string | undefined): Promise<{ jwk: PublicJwk; keyId: string }> => {
    const key = await importSPKI(pemOf(publicKey), AUTH_ALGORITHM, { extractable: true })
    const exported = await exportJWK(key)
    const kid = keyId ?? (await calculateJwkThumbprint(exported))
    const jwk: Record<string, string> = {}
    for (const [name, value] of Object.entries({ ...exported, kid, alg: AUTH_ALGORITHM, use: "sig" })) {
        if (typeof value === "string") jwk[name] = value
    }
    return { jwk, keyId: kid }
}

const loadKey = async (key: AuthOptions["keys"][number]): Promise<LoadedKey> => {
    try {
        const [privateKey, published] = await Promise.all([
            key.privateKey === undefined ? Promise.resolve(undefined) : importPKCS8(pemOf(revealed(key.privateKey)), AUTH_ALGORITHM),
            publicJwkOf(key.publicKey, key.keyId),
        ])
        return { keyId: published.keyId, jwk: published.jwk, privateKey }
    } catch (cause) {
        throw new AuthError(AUTH_ERROR_CODES.KeyInvalid, { cause })
    }
}
