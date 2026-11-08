import type { AttemptKind, SessionUser } from "../contracts/index.ts"

/** The person a sign-in method established; the session is opened for them. */
export interface AuthSubject {
    /** The account id. */
    readonly userId: string
    /** The account email. */
    readonly email: string
    /** The person's full name, when the account has one. */
    readonly name?: string | undefined
}

/** What Google told us about the person who consented. */
export interface GoogleProfile {
    /** Google's stable account id (`sub`). */
    readonly subject: string
    /** The Google email, when released. */
    readonly email: string | null
    /** True when Google verified that mailbox. */
    readonly emailVerified: boolean
    /** The display name, when released. */
    readonly name: string | null
    /** The picture address, when released. */
    readonly picture: string | null
}

/** What any sign-in provider told us about the person who consented: Google's facts, with the provider that told them. */
export interface ProviderProfile extends GoogleProfile {
    /** The provider id (`github`); with `subject` it names the external account. */
    readonly provider: string
}

/** The sign-in decisions the app makes for the strategies; each throws the app's error when it refuses. */
export interface AuthAuthenticator {
    /** Verifies an email and password; answers the person or throws. */
    verifyPassword(email: string, password: string): Promise<AuthSubject>
    /** Finds, links or creates the person a verified Google profile stands for; answers the person or throws. */
    signInWithGoogle(profile: GoogleProfile): Promise<AuthSubject>
    /** Finds, links or creates the person another provider's profile stands for (GitHub); needed only when the app registers such a provider. */
    signInWithProvider?(profile: ProviderProfile): Promise<AuthSubject>
}

/** The account facts a refresh needs to decide that a session may go on. */
export interface AccountStanding {
    /** The account id. */
    readonly id: string
    /** The address, or null. */
    readonly email: string | null
    /** Whether the account is disabled or gone. */
    readonly disabled: boolean
    /** The person's full name, when the account has one (the session answers and the access token carry it). */
    readonly name?: string | undefined
}

/** The app's user table, seen only as far as sessions need it. */
export interface AccountDirectory {
    /** The standing of one account, or undefined when it does not exist. */
    find(userId: string): Promise<AccountStanding | undefined>
}

/** One refresh token as the store keeps it: only its digest, and a spent token is kept for replay detection. */
export interface RefreshTokenRecord {
    readonly id: string
    readonly sessionId: string
    readonly userId: string
    readonly tokenHash: string
    readonly expiresAt: Date
    /** When the token was rotated away, or null while it is the live one. */
    readonly usedAt: Date | null
    /** How many successors replays of this token obtained within the grace window after its rotation (bounded). */
    readonly racedCount: number
}

/** A device session to open. */
export interface NewSession {
    readonly id: string
    readonly userId: string
    readonly now: Date
    readonly userAgent: string | null
    readonly ip: string | null
}

/** The writes of one rotation, applied atomically by the store. */
export interface SessionTransaction {
    /** Opens a device session. */
    openSession(session: NewSession): Promise<void>
    /** Stores a live refresh token. */
    insertToken(token: Omit<RefreshTokenRecord, "usedAt" | "racedCount">): Promise<void>
    /** The token with this digest, locked for update (a pessimistic write lock), or null. */
    findTokenForUpdate(tokenHash: string): Promise<RefreshTokenRecord | null>
    /** Marks a token as rotated away at `at`. */
    markTokenUsed(tokenId: string, at: Date): Promise<void>
    /** Records how many successors replays of a rotated token obtained within the grace window. */
    markTokenRaced(tokenId: string, racedCount: number): Promise<void>
    /** Deletes the tokens of an account that expired before `before`. */
    deleteExpiredTokens(userId: string, before: Date): Promise<void>
}

/** The tables the package owns (`identity_sessions`, `identity_refresh_tokens`), behind the app's ORM. */
export interface SessionStore {
    /** Runs `work` in one database transaction. */
    transaction<T>(work: (tx: SessionTransaction) => Promise<T>): Promise<T>
    /** The token with this digest, or null. */
    findToken(tokenHash: string): Promise<RefreshTokenRecord | null>
    /** Marks a session refreshed. */
    touchSession(sessionId: string, now: Date): Promise<void>
    /** Ends one session and revokes every token of it (logout, reuse, a gone or disabled account). */
    closeSession(sessionId: string): Promise<void>
    /** Ends every session of an account but one. */
    closeOtherSessions(userId: string, keepSessionId: string): Promise<void>
}

/** A counter every replica shares (the app's rate-limit store). */
export interface RateCounter {
    /** Counts one hit in the window; false when the key is over `limit`. */
    consume(key: string, windowMs: number, limit: number): Promise<boolean>
    /** Forgets a key. */
    clear(key: string): Promise<void>
}

/** The clock the package reads. */
export interface AuthClock {
    now(): Date
}

/** The source of ids the package mints. */
export interface AuthIds {
    next(): string
}

/** Where the package reports a security event (a replayed refresh token). */
export interface AuthLogger {
    warn(event: string, context?: Readonly<Record<string, unknown>>): void
}

/** The device a request comes from. */
export interface DeviceMeta {
    readonly userAgent: string | null
    readonly ip: string | null
}

/** The tokens one sign-in or refresh produces; the refresh token only ever leaves in the cookie. */
export interface SessionTokens {
    readonly accessToken: string
    readonly accessExpiresAt: string
    readonly accessExpiresIn: number
    /** The opaque token the refresh cookie carries. */
    readonly cookieToken: string
    readonly refreshMaxAgeSeconds: number
    readonly user: SessionUser
}

/** The claims of one of our access tokens after verification. */
export interface AccessClaims {
    /** The user id. */
    readonly sub: string
    /** The email at issue time, when the account has one. */
    readonly email?: string | undefined
    /** The device session the token belongs to. */
    readonly sessionId: string
    /** The person's full name at issue time, when the account has one. */
    readonly name?: string | undefined
}

/** The principal domain code builds from a verified access token. */
export interface AuthPrincipal {
    readonly id: string
    readonly role: "authenticated"
    readonly sessionId: string
    readonly email?: string
    readonly name?: string
}

/** A freshly signed access token. */
export interface IssuedAccessToken {
    readonly token: string
    readonly expiresAt: Date
}

/** The kinds of attempt a budget counts. */
export type { AttemptKind }
