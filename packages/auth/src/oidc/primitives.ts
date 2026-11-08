import { createHash, randomBytes } from "node:crypto"

/** The secret holder, the secret input, its reveal and the constant-time comparison: one copy for both editions. */
export { revealed, sameValue } from "../server/primitives.ts"
export type { Revealable, SecretInput } from "../server/primitives.ts"

/** A record: a non-null object that is not an array (`isPlainRecord` of `@starci/common`). */
export { isPlainRecord as isRecord } from "@starci/common"

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
