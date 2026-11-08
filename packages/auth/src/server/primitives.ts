import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { isPlainRecord } from "@starci/common"
import { PASSWORD_BOUNDS } from "../contracts/index.ts"

/** A value read out of a secret holder (the app's `Secret` class has this shape). */
export interface Revealable {
    reveal(): string
}

/** A secret given as text or as a holder the app already keeps. */
export type SecretInput = string | Revealable

/** The text of a secret input. */
export const revealed = (secret: SecretInput): string => (typeof secret === "string" ? secret : secret.reveal())

/** The signed state of one short round trip: the handle, the PKCE verifier, the landing path, the expiry and the purpose. */
export interface SignedState {
    readonly w: string
    readonly u: string
    readonly r: string
    readonly e: number
    readonly p?: string
}

const SAME_SITE_PATH = /^\/(?![/\\])/u
const LINE_BREAK = /[\r\n]/u

/** A same-site path (one leading slash, no line break), else the fallback path. */
export const sameSitePath = (value: unknown, fallback: string): string =>
    typeof value === "string" && SAME_SITE_PATH.test(value) && !LINE_BREAK.test(value) ? value : fallback

const encode = (buffer: Buffer): string => buffer.toString("base64url")

const isSignedState = (value: unknown): value is SignedState =>
    isPlainRecord(value) &&
    typeof value.w === "string" &&
    typeof value.u === "string" &&
    typeof value.r === "string" &&
    typeof value.e === "number" &&
    (value.p === undefined || typeof value.p === "string")

/** Signs a state: base64url(JSON).base64url(HMAC-SHA256). */
export const signStateToken = (key: Buffer, state: SignedState): string => {
    const body = encode(Buffer.from(JSON.stringify(state)))
    return `${body}.${encode(createHmac("sha256", key).update(body).digest())}`
}

const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return undefined
    }
}

/** The state when the signature is valid, the body is a state and it has not expired at `now`; otherwise null. */
export const verifyStateToken = (key: Buffer, value: string, now: number): SignedState | null => {
    if (value === "") return null
    const [body, signature, extra] = value.split(".")
    if (body === undefined || body === "" || signature === undefined || signature === "" || extra !== undefined) return null
    const expected = createHmac("sha256", key).update(body).digest()
    const given = Buffer.from(signature, "base64url")
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    const state = parseJson(Buffer.from(body, "base64url").toString("utf8"))
    return isSignedState(state) && state.e >= now ? state : null
}

/** The SHA-256 hex of an opaque token or an address; only this form is stored or used as a counter key. */
export const digestOf = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")

/** The lower-cased, trimmed sign-in address. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/** True when a new password fits the policy: at least 8 characters, at most the 72 bytes bcrypt reads. */
export const isAcceptablePassword = (password: string): boolean =>
    Array.from(password).length >= PASSWORD_BOUNDS.min && Buffer.byteLength(password, "utf8") <= PASSWORD_BOUNDS.bcryptMaxBytes

/** True when a presented password can possibly match (bcrypt reads 72 bytes at most); longer input is refused before hashing. */
export const isPresentablePassword = (password: string): boolean =>
    password.length > 0 && Buffer.byteLength(password, "utf8") <= PASSWORD_BOUNDS.bcryptMaxBytes

/** True when two texts are equal, compared in constant time over equal-length buffers. */
export const sameValue = (given: string, expected: string): boolean => {
    const left = Buffer.from(given)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
}

/** The value of one cookie in a `Cookie` request header (empty text when the header lacks it); the values we write are URL-safe and need no decoding. */
export const cookieValue = (header: string, name: string): string => {
    for (const part of header.split(";")) {
        const separator = part.indexOf("=")
        if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
    }
    return ""
}
