import { decodeJwt } from "jose"
import { isRecord } from "./primitives.ts"

/** The refresh token of a token response and the instant it stops being accepted. */
export interface OidcRefresh {
    readonly refreshToken: string
    readonly refreshExpiresAt: Date
}

const SECOND_MS = 1000

/** The `exp` of a refresh token, read without trusting it: it only dates a token the provider itself just issued over the verified channel. */
const expiryOf = (token: string): number | undefined => {
    try {
        const { exp } = decodeJwt(token)
        return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * SECOND_MS : undefined
    } catch {
        return undefined
    }
}

/**
 * The refresh token of a token endpoint answer and its expiry: `refresh_expires_in` (seconds from `now`), else the token's own `exp`.
 * `undefined` when the answer holds no refresh token or no way to date it (an offline token has neither), so the caller refuses it.
 */
export const refreshOf = (body: unknown, now: Date): OidcRefresh | undefined => {
    if (!isRecord(body) || typeof body.refresh_token !== "string" || body.refresh_token === "") return undefined
    const lifetime = body.refresh_expires_in
    const expiresAt = typeof lifetime === "number" && Number.isFinite(lifetime) && lifetime > 0 ? now.getTime() + lifetime * SECOND_MS : expiryOf(body.refresh_token)
    return expiresAt === undefined ? undefined : { refreshToken: body.refresh_token, refreshExpiresAt: new Date(expiresAt) }
}
