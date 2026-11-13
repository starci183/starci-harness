import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { inspect } from "node:util"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { AuthError, ok, refused } from "./errors.ts"
import type { Outcome } from "./errors.ts"
import type { AuthClock, AuthLogger } from "./ports.ts"
import type { Revealable } from "./primitives.ts"
import { systemClock } from "./runtime.ts"

/** The bytes of entropy of an issued key's secret (43 base64url characters). */
export const API_KEY_SECRET_BYTES = 32

/** The request header a key may also be sent in, when the verifier accepts it. */
export const API_KEY_HEADER = "x-api-key"

/** The event a refused key is logged under; its context carries the reason and the key id, never key material. */
export const API_KEY_REJECTED_EVENT = "auth.api-key-rejected"

/** The longest key text read from a header or from stdin; anything longer is malformed before it is parsed. */
export const API_KEY_TEXT_MAX = 1024

const KEY_ID = /^[A-Za-z0-9_-]{1,128}$/u
const SECRET = /^[A-Za-z0-9_-]{22,256}$/u
const PREFIX = /^[A-Za-z0-9_-]{0,32}$/u
const SHA256_HEX = /^[0-9a-f]{64}$/iu
const BEARER = /^bearer +(\S+)$/iu

/** Why a presented key was refused; for the log only, every reason travels as `PASSPORT_API_KEY_REJECTED`. */
export type ApiKeyRefusal = "missing" | "malformed" | "ambiguous" | "unknown" | "secret" | "revoked" | "expired"

/** A key split into the id the store is asked for and the secret whose SHA-256 is compared. */
export interface PresentedApiKey {
    readonly keyId: string
    readonly secret: string
}

/**
 * One key as the app stores it: the id, the hex SHA-256 of the secret (the only form stored), when it was revoked or expires, and
 * the app's own scope (workspace, holder, scopes: whatever its table holds), handed back untouched in the principal.
 */
export interface ApiKeyRecord<S> {
    readonly id: string
    readonly secretSha256: string
    readonly revokedAt?: Date | null
    readonly expiresAt?: Date | null
    readonly scope: S
}

/** The port the app implements over its own key table: the record of one key id, or null when it has none. */
export interface ApiKeyStore<S> {
    findApiKey(keyId: string): Promise<ApiKeyRecord<S> | null>
}

/** What a verified key stands for: its id as the store holds it and the app's scope, which the app maps to its own principal. */
export interface ApiKeyPrincipal<S> {
    readonly keyId: string
    readonly scope: S
}

/** The request headers a key is read from, as Node and Express answer them. */
export type ApiKeyHeaders = Readonly<Record<string, string | readonly string[] | undefined>>

/** The settings of one verifier. */
export interface ApiKeyVerifierOptions<S> {
    /** The app's key table. */
    readonly store: ApiKeyStore<S>
    /** A fixed text every key starts with, so a leaked key is recognisable (`[A-Za-z0-9_-]{0,32}`); none by default. */
    readonly prefix?: string
    /** Also read the key from `X-Api-Key`; a request naming both headers is refused. Off by default. */
    readonly acceptApiKeyHeader?: boolean
    readonly clock?: AuthClock
    readonly logger?: AuthLogger
}

/** The SHA-256 of a secret, as raw bytes. */
const sha256 = (text: string): Buffer => createHash("sha256").update(text, "utf8").digest()

/** The hex SHA-256 of a key's secret: the only form an app stores. */
export const apiKeySecretSha256 = (secret: string): string => sha256(secret).toString("hex")

/** A digest no secret is known to hash to: compared on a miss, so an unknown key costs the same compare as a wrong secret. */
const NO_KEY = sha256(randomBytes(API_KEY_SECRET_BYTES).toString("base64url"))

/** The stored digest as bytes; a stored value that is not a hex SHA-256 is a fault of the app's table. */
const storedDigest = (secretSha256: string): Buffer => {
    if (!SHA256_HEX.test(secretSha256)) throw new AuthError(AUTH_ERROR_CODES.ApiKeyRecordInvalid)
    return Buffer.from(secretSha256, "hex")
}

/** True when the secret's SHA-256 equals the stored digest, compared with `timingSafeEqual` over 32 bytes (BE-AUTH-3). */
export const apiKeySecretMatches = (secret: string, secretSha256: string): boolean => timingSafeEqual(sha256(secret), storedDigest(secretSha256))

const validPrefix = (prefix: string): string => {
    if (!PREFIX.test(prefix)) throw new AuthError(AUTH_ERROR_CODES.ApiKeyMalformed, { context: { field: "prefix" } })
    return prefix
}

/** The id and secret of `<prefix><keyId>.<secret>`, or null for any other text (an over-long text is never parsed). */
export const parseApiKey = (text: string, prefix = ""): PresentedApiKey | null => {
    if (text.length > API_KEY_TEXT_MAX || !text.startsWith(prefix)) return null
    const body = text.slice(prefix.length)
    const dot = body.indexOf(".")
    const keyId = body.slice(0, dot)
    const secret = body.slice(dot + 1)
    return dot > 0 && KEY_ID.test(keyId) && SECRET.test(secret) ? { keyId, secret } : null
}

/** The text of a key in the request: `Authorization: Bearer <key>` or, when accepted, `X-Api-Key: <key>`. */
export const apiKeyTextOf = (headers: ApiKeyHeaders, acceptApiKeyHeader = false): Outcome<string, ApiKeyRefusal> => {
    const authorization = headers.authorization
    const header = acceptApiKeyHeader ? headers[API_KEY_HEADER] : undefined
    if (typeof authorization === "object" || typeof header === "object") return refused("ambiguous")
    const bearer = authorization === undefined || authorization === "" ? undefined : authorization
    const named = header === undefined || header.trim() === "" ? undefined : header.trim()
    if (bearer !== undefined && named !== undefined) return refused("ambiguous")
    if (named !== undefined) return ok(named)
    if (bearer === undefined) return refused("missing")
    if (bearer.length > API_KEY_TEXT_MAX) return refused("malformed")
    const token = BEARER.exec(bearer.trim())?.[1]
    return token === undefined ? refused("malformed") : ok(token)
}

/**
 * The API-key strategy: reads `Authorization: Bearer <prefix><keyId>.<secret>` (and `X-Api-Key` when accepted), asks the app's
 * store for the key id, compares the secret's SHA-256 with the stored one in constant time (an unknown id is compared too), then
 * refuses a revoked or expired key. Every refusal is `PASSPORT_API_KEY_REJECTED` with the reason in its detail; the log carries the
 * reason and the key id, never the key text or its secret.
 */
export class ApiKeyVerifier<S> {
    readonly #store: ApiKeyStore<S>
    readonly #prefix: string
    readonly #acceptApiKeyHeader: boolean
    readonly #clock: AuthClock
    readonly #logger: AuthLogger | undefined

    constructor(options: ApiKeyVerifierOptions<S>) {
        this.#store = options.store
        this.#prefix = validPrefix(options.prefix ?? "")
        this.#acceptApiKeyHeader = options.acceptApiKeyHeader ?? false
        this.#clock = options.clock ?? systemClock
        this.#logger = options.logger
    }

    /** Verifies the key a request carries in its headers. */
    verify(headers: ApiKeyHeaders, now: Date = this.#clock.now()): Promise<Outcome<ApiKeyPrincipal<S>>> {
        const text = apiKeyTextOf(headers, this.#acceptApiKeyHeader)
        return text.kind === "ok" ? this.verifyKey(text.value, now) : Promise.resolve(this.#refuse(text.code))
    }

    /** Verifies one key text (no scheme), for a transport that carries the key elsewhere. */
    async verifyKey(text: string, now: Date = this.#clock.now()): Promise<Outcome<ApiKeyPrincipal<S>>> {
        const presented = parseApiKey(text, this.#prefix)
        if (presented === null) return this.#refuse("malformed")
        const record = await this.#store.findApiKey(presented.keyId)
        const expected = record === null ? NO_KEY : storedDigest(record.secretSha256)
        const matches = timingSafeEqual(sha256(presented.secret), expected)
        if (record === null) return this.#refuse("unknown", presented.keyId)
        if (!matches) return this.#refuse("secret", presented.keyId)
        if (record.revokedAt !== undefined && record.revokedAt !== null) return this.#refuse("revoked", record.id)
        if (record.expiresAt !== undefined && record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime()) {
            return this.#refuse("expired", record.id)
        }
        return ok({ keyId: record.id, scope: record.scope })
    }

    /** Verifies the request's key and answers its principal, or throws `AuthError(PASSPORT_API_KEY_REJECTED)` with the reason in its context. */
    async authenticate(headers: ApiKeyHeaders, now?: Date): Promise<ApiKeyPrincipal<S>> {
        const outcome = await this.verify(headers, now)
        if (outcome.kind === "ok") return outcome.value
        throw new AuthError(outcome.code, { context: outcome.detail ?? {} })
    }

    #refuse(reason: ApiKeyRefusal, keyId?: string): Outcome<never> {
        const detail = keyId === undefined ? { reason } : { reason, keyId }
        this.#logger?.warn(API_KEY_REJECTED_EVENT, detail)
        return refused(AUTH_ERROR_CODES.ApiKeyRejected, detail)
    }
}

const REDACTED = "[api key]"

/** The plaintext of a key just issued: read once with `reveal()`; printing, logging or serialising it shows `[api key]`. */
export class ApiKeyPlaintext implements Revealable {
    readonly #text: string

    constructor(text: string) {
        this.#text = text
    }

    reveal(): string {
        return this.#text
    }

    toString(): string {
        return REDACTED
    }

    toJSON(): string {
        return REDACTED
    }

    [inspect.custom](): string {
        return REDACTED
    }
}

/** The row an app stores for a key: its id and the hex SHA-256 of its secret, never the secret. */
export interface ApiKeyHash {
    readonly id: string
    readonly secretSha256: string
}

/** A key just issued: the row to store and the plaintext to show the holder once. */
export interface IssuedApiKey extends ApiKeyHash {
    readonly key: ApiKeyPlaintext
}

/** How a key is issued. */
export interface IssueApiKeyOptions {
    /** The key id (`[A-Za-z0-9_-]{1,128}`); a random UUID by default. */
    readonly id?: string
    /** The prefix of the verifier the key is for. */
    readonly prefix?: string
}

/** Issues a key: a random id (or the given one) and a fresh 32-byte secret; answers the hash to store and the plaintext to show once. */
export const issueApiKey = (options: IssueApiKeyOptions = {}): IssuedApiKey => {
    const prefix = validPrefix(options.prefix ?? "")
    const id = options.id ?? randomUUID()
    if (!KEY_ID.test(id)) throw new AuthError(AUTH_ERROR_CODES.ApiKeyMalformed, { context: { field: "id" } })
    const secret = randomBytes(API_KEY_SECRET_BYTES).toString("base64url")
    return { id, secretSha256: apiKeySecretSha256(secret), key: new ApiKeyPlaintext(`${prefix}${id}.${secret}`) }
}

/**
 * Registers a key given as text (a key made elsewhere, read from stdin): its id and the hash of its secret, nothing else kept.
 * Surrounding white space (the newline of a pipe) is dropped; any other text is `PASSPORT_API_KEY_MALFORMED`, whose context never holds it.
 */
export const registerApiKey = (text: string, options: { readonly prefix?: string } = {}): ApiKeyHash => {
    const presented = parseApiKey(text.trim(), validPrefix(options.prefix ?? ""))
    if (presented === null) throw new AuthError(AUTH_ERROR_CODES.ApiKeyMalformed, { context: { field: "key" } })
    return { id: presented.keyId, secretSha256: apiKeySecretSha256(presented.secret) }
}

/** Reads a key's text from a stream (stdin), bounded by `API_KEY_TEXT_MAX` bytes; a longer input is `PASSPORT_API_KEY_MALFORMED`. */
export const readApiKeyText = async (input: AsyncIterable<string | Uint8Array>): Promise<string> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of input) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk)
        size += bytes.length
        if (size > API_KEY_TEXT_MAX + 2) throw new AuthError(AUTH_ERROR_CODES.ApiKeyMalformed, { context: { field: "key" } })
        chunks.push(bytes)
    }
    return Buffer.concat(chunks).toString("utf8").trim()
}
