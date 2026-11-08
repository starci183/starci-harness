import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/** A value read out of a secret holder (the app's `Secret` class has this shape). */
export interface Revealable {
    reveal(): string
}

/** A secret given as text or as a holder the app already keeps. */
export type SecretInput = string | Revealable

/** The text of a secret input; called only where the secret is sent. */
export const revealed = (secret: SecretInput): string => (typeof secret === "string" ? secret : secret.reveal())

/** A record: a non-null object that is not an array (`isPlainRecord` of `@starci/common`). */
export { isPlainRecord as isRecord } from "@starci/common"

/** True when two texts are equal, compared in constant time over equal-length buffers. */
export const sameValue = (given: string, expected: string): boolean => {
    const left = Buffer.from(given)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
}

/** 256 unpredictable bits as base64url: a state, a nonce, a PKCE verifier or an opaque reference. */
export const randomReference = (): string => randomBytes(32).toString("base64url")

/** The S256 challenge of a PKCE verifier: base64url(SHA-256(verifier)). */
export const pkceChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url")

/** The clock the package reads. */
export interface OidcClock {
    now(): Date
}

/** The system clock. */
export const systemClock: OidcClock = { now: () => new Date() }
