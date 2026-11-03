import { randomUUID } from "node:crypto"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import type { JwksDocument } from "../contracts/index.ts"
import { AuthError } from "./errors.ts"
import type { AuthOptions } from "./options.ts"
import type { AuthClock, AuthIds, AuthLogger, AuthSubject, DeviceMeta, RefreshTokenRecord, SessionTokens } from "./ports.ts"
import { digestOf } from "./primitives.ts"
import type { AuthTokens } from "./tokens.ts"

/** A rotated token presented again this soon after its rotation is a racing tab, not a theft. */
export const DEFAULT_REUSE_GRACE_MS = 30_000

/** The log event of a replayed refresh token. */
export const REFRESH_REUSE_EVENT = "auth.refresh-reuse-detected"

const MILLISECONDS = 1000

type Rotation =
    | { readonly kind: "rotated"; readonly row: RefreshTokenRecord; readonly next: string }
    | { readonly kind: "invalid" }
    | { readonly kind: "raced"; readonly row: RefreshTokenRecord }
    | { readonly kind: "reused"; readonly sessionId: string }

/** What the sessions need from the module. */
export interface SessionsDeps {
    readonly options: Pick<AuthOptions, "refreshTtlSeconds" | "reuseGraceMs" | "sessions" | "accounts">
    readonly tokens: AuthTokens
    readonly clock: AuthClock
    readonly ids: AuthIds
    readonly logger?: AuthLogger | undefined
}

/** The default id source. */
export const randomIds: AuthIds = { next: () => randomUUID() }

/** The system clock. */
export const systemClock: AuthClock = { now: () => new Date() }

/**
 * Device sessions: opens one at sign-in, rotates its refresh token on every refresh (a replayed token ends the session) and ends it
 * at sign-out. A token rotated within the grace window is a racing request: it is answered with an access token only, the cookie
 * is left as the winner wrote it.
 */
export class AuthSessions {
    readonly #deps: SessionsDeps

    constructor(deps: SessionsDeps) {
        this.#deps = deps
    }

    get #store(): AuthOptions["sessions"] {
        return this.#deps.options.sessions
    }

    get #graceMs(): number {
        return this.#deps.options.reuseGraceMs ?? DEFAULT_REUSE_GRACE_MS
    }

    /** Opens a device session for a person who just proved who they are, and answers its first tokens. */
    async start(subject: AuthSubject, device: DeviceMeta): Promise<SessionTokens> {
        const now = this.#deps.clock.now()
        const sessionId = this.#deps.ids.next()
        const refreshToken = this.#mintToken()
        await this.#store.transaction(async (tx) => {
            await tx.openSession({ id: sessionId, userId: subject.userId, now, userAgent: device.userAgent, ip: device.ip })
            await tx.insertToken({
                id: this.#deps.ids.next(),
                sessionId,
                userId: subject.userId,
                tokenHash: digestOf(refreshToken),
                expiresAt: this.#refreshExpiry(now),
            })
        })
        return this.#tokensFor(subject, sessionId, refreshToken, now)
    }

    /**
     * Exchanges a refresh token for a new pair; the presented token is spent. Throws when it is unknown, expired, or rotated long
     * ago (reuse ends the session). A token a sibling request rotated within the grace window answers an access token marked
     * `cookieKept`, so the caller leaves the cookie alone: the sibling already wrote the successor.
     */
    async refresh(presented: string): Promise<SessionTokens> {
        if (presented === "") throw new AuthError(AUTH_ERROR_CODES.RefreshInvalid)
        const now = this.#deps.clock.now()
        const nextToken = this.#mintToken()
        const rotation = await this.#store.transaction(async (tx): Promise<Rotation> => {
            const row = await tx.findTokenForUpdate(digestOf(presented))
            if (row === null || row.expiresAt <= now) return { kind: "invalid" }
            if (row.usedAt !== null) {
                return now.getTime() - row.usedAt.getTime() <= this.#graceMs
                    ? { kind: "raced", row }
                    : { kind: "reused", sessionId: row.sessionId }
            }
            await tx.markTokenUsed(row.id, now)
            await tx.insertToken({
                id: this.#deps.ids.next(),
                sessionId: row.sessionId,
                userId: row.userId,
                tokenHash: digestOf(nextToken),
                expiresAt: this.#refreshExpiry(now),
            })
            await tx.deleteExpiredTokens(row.userId, now)
            return { kind: "rotated", row, next: nextToken }
        })
        if (rotation.kind === "reused") {
            await this.#store.closeSession(rotation.sessionId)
            this.#deps.logger?.warn(REFRESH_REUSE_EVENT, { sessionId: rotation.sessionId })
            throw new AuthError(AUTH_ERROR_CODES.RefreshReused)
        }
        if (rotation.kind === "invalid") throw new AuthError(AUTH_ERROR_CODES.RefreshInvalid)
        if (rotation.kind === "raced") return this.#accessOf(rotation.row, presented, now)
        const user = await this.#deps.options.accounts.find(rotation.row.userId)
        if (user === undefined || user.disabled || user.email === null) {
            await this.#store.closeSession(rotation.row.sessionId)
            throw new AuthError(AUTH_ERROR_CODES.AccountDisabled)
        }
        await this.#store.touchSession(rotation.row.sessionId, now)
        return this.#tokensFor({ userId: user.id, email: user.email }, rotation.row.sessionId, rotation.next, now)
    }

    /**
     * Answers a fresh access token for the session of a refresh token WITHOUT rotating it, so parallel gated requests of one browser
     * can ask at once. A token rotated within the grace window still counts (a sibling request just rotated it); an older replay
     * ends the session.
     */
    async access(presented: string): Promise<SessionTokens> {
        if (presented === "") throw new AuthError(AUTH_ERROR_CODES.RefreshInvalid)
        const now = this.#deps.clock.now()
        const row = await this.#store.findToken(digestOf(presented))
        if (row === null || row.expiresAt <= now) throw new AuthError(AUTH_ERROR_CODES.RefreshInvalid)
        if (row.usedAt !== null && now.getTime() - row.usedAt.getTime() > this.#graceMs) {
            await this.#store.closeSession(row.sessionId)
            this.#deps.logger?.warn(REFRESH_REUSE_EVENT, { sessionId: row.sessionId })
            throw new AuthError(AUTH_ERROR_CODES.RefreshReused)
        }
        return this.#accessOf(row, presented, now)
    }

    /** The public key document access tokens verify against. */
    jwks(): Promise<JwksDocument> {
        return this.#deps.tokens.jwks()
    }

    /** Signs the person out of every other device; the session of the caller stays. */
    async endOthers(userId: string, keepSessionId: string | undefined): Promise<void> {
        if (keepSessionId === undefined) throw new AuthError(AUTH_ERROR_CODES.Unauthenticated)
        await this.#store.closeOtherSessions(userId, keepSessionId)
    }

    /** Ends the session a refresh token belongs to (an empty or unknown token changes nothing). */
    async end(presented: string): Promise<void> {
        if (presented === "") return
        const row = await this.#store.findToken(digestOf(presented))
        if (row !== null) await this.#store.closeSession(row.sessionId)
    }

    /** An access token for the session of a token row, without rotating; an account that is gone or disabled ends the session. */
    async #accessOf(row: RefreshTokenRecord, presented: string, now: Date): Promise<SessionTokens> {
        const user = await this.#deps.options.accounts.find(row.userId)
        if (user === undefined || user.disabled || user.email === null) {
            await this.#store.closeSession(row.sessionId)
            throw new AuthError(AUTH_ERROR_CODES.AccountDisabled)
        }
        const tokens = await this.#tokensFor({ userId: user.id, email: user.email }, row.sessionId, presented, now)
        return { ...tokens, cookieKept: true }
    }

    async #tokensFor(subject: AuthSubject, sessionId: string, refreshToken: string, now: Date): Promise<SessionTokens> {
        const access = await this.#deps.tokens.sign({ sub: subject.userId, email: subject.email, sessionId }, now)
        return {
            accessToken: access.token,
            accessExpiresAt: access.expiresAt.toISOString(),
            accessExpiresIn: Math.round((access.expiresAt.getTime() - now.getTime()) / MILLISECONDS),
            cookieToken: refreshToken,
            refreshMaxAgeSeconds: this.#deps.options.refreshTtlSeconds,
            user: { id: subject.userId, email: subject.email },
        }
    }

    #refreshExpiry(now: Date): Date {
        return new Date(now.getTime() + this.#deps.options.refreshTtlSeconds * MILLISECONDS)
    }

    #mintToken(): string {
        return `${this.#deps.ids.next()}${this.#deps.ids.next()}`.replaceAll("-", "")
    }
}
