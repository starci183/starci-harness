import { generateKeyPairSync, randomUUID } from "node:crypto"
import type { AuthOptions, SigningKeyOptions } from "../server/options.ts"
import type { AccountDirectory, AccountStanding, AuthClock, AuthIds, NewSession, RateCounter, RefreshTokenRecord, SessionStore, SessionTransaction } from "../server/ports.ts"

/** The fake OIDC issuer of the full edition (Keycloak-shaped discovery, JWKS, token and admin endpoints), for the specs of an `integrations/keycloak` glue. */
export { FakeOidcIssuer } from "./oidc.ts"
export type { FakeFailure, FakeOidcIssuerOptions, FakeRequest, FakeSeededUser, FakeTokenClaims, FakeUser, MintOverrides } from "./oidc.ts"

/** A generated Ed25519 key pair as the PEM texts the options take. */
export interface TestKeyPair {
    readonly privateKey: string
    readonly publicKey: string
}

/** Generates an Ed25519 key pair (PKCS#8 private PEM, SPKI public PEM). */
export const generateTestKeyPair = (): TestKeyPair => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    return {
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }
}

/** A signing key for the options; `signer: false` makes it a verify-only (retired) key. */
export const testSigningKey = (pair: TestKeyPair = generateTestKeyPair(), keyId?: string, signer = true): SigningKeyOptions => ({
    publicKey: pair.publicKey,
    ...(signer ? { privateKey: pair.privateKey } : {}),
    ...(keyId === undefined ? {} : { keyId }),
})

/** A clock the test moves by hand. */
export class FakeClock implements AuthClock {
    #at: number

    constructor(start: Date | number = Date.UTC(2026, 0, 1)) {
        this.#at = typeof start === "number" ? start : start.getTime()
    }

    now(): Date {
        return new Date(this.#at)
    }

    /** Moves time forward. */
    advance(milliseconds: number): void {
        this.#at += milliseconds
    }
}

/** Ids that count up, so a spec reads them. */
export const sequentialIds = (prefix = "id"): AuthIds => {
    let n = 0
    return { next: () => `${prefix}-${String(++n)}-${randomUUID().slice(0, 8)}` }
}

/** An in-memory `SessionStore` with the same rotation semantics the SQL tables give (a transaction applies all or none of its writes). */
export class MemorySessionStore implements SessionStore {
    readonly sessions = new Map<string, NewSession>()
    readonly tokens = new Map<string, RefreshTokenRecord>()

    async transaction<T>(work: (tx: SessionTransaction) => Promise<T>): Promise<T> {
        const sessions = new Map(this.sessions)
        const tokens = new Map(this.tokens)
        const tx: SessionTransaction = {
            openSession: (session) => {
                this.sessions.set(session.id, session)
                return Promise.resolve()
            },
            insertToken: (token) => {
                this.tokens.set(token.id, { ...token, usedAt: null, racedCount: 0 })
                return Promise.resolve()
            },
            findTokenForUpdate: (tokenHash) => Promise.resolve(this.#byHash(tokenHash)),
            markTokenUsed: (tokenId, at) => {
                const row = this.tokens.get(tokenId)
                if (row !== undefined) this.tokens.set(tokenId, { ...row, usedAt: at })
                return Promise.resolve()
            },
            markTokenRaced: (tokenId, racedCount) => {
                const row = this.tokens.get(tokenId)
                if (row !== undefined) this.tokens.set(tokenId, { ...row, racedCount })
                return Promise.resolve()
            },
            deleteExpiredTokens: (userId, before) => {
                for (const [id, row] of this.tokens) if (row.userId === userId && row.expiresAt < before) this.tokens.delete(id)
                return Promise.resolve()
            },
        }
        try {
            return await work(tx)
        } catch (cause) {
            this.sessions.clear()
            this.tokens.clear()
            for (const [id, row] of sessions) this.sessions.set(id, row)
            for (const [id, row] of tokens) this.tokens.set(id, row)
            throw cause
        }
    }

    findToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
        return Promise.resolve(this.#byHash(tokenHash))
    }

    touchSession(): Promise<void> {
        return Promise.resolve()
    }

    closeSession(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId)
        for (const [id, row] of this.tokens) if (row.sessionId === sessionId) this.tokens.delete(id)
        return Promise.resolve()
    }

    closeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
        for (const [id, row] of this.sessions) if (row.userId === userId && id !== keepSessionId) void this.closeSession(id)
        return Promise.resolve()
    }

    #byHash(tokenHash: string): RefreshTokenRecord | null {
        for (const row of this.tokens.values()) if (row.tokenHash === tokenHash) return row
        return null
    }
}

/** An in-memory account directory. */
export class MemoryAccounts implements AccountDirectory {
    readonly accounts = new Map<string, AccountStanding>()

    /** Adds or replaces an account. */
    set(account: AccountStanding): this {
        this.accounts.set(account.id, account)
        return this
    }

    find(userId: string): Promise<AccountStanding | undefined> {
        return Promise.resolve(this.accounts.get(userId))
    }
}

/** An in-memory rate counter with fixed windows that the clock moves. */
export class MemoryRateCounter implements RateCounter {
    readonly #clock: AuthClock
    readonly #hits = new Map<string, { count: number; resetAt: number }>()

    constructor(clock: AuthClock) {
        this.#clock = clock
    }

    consume(key: string, windowMs: number, limit: number): Promise<boolean> {
        const at = this.#clock.now().getTime()
        const current = this.#hits.get(key)
        const entry = current === undefined || current.resetAt <= at ? { count: 0, resetAt: at + windowMs } : current
        entry.count += 1
        this.#hits.set(key, entry)
        return Promise.resolve(entry.count <= limit)
    }

    clear(key: string): Promise<void> {
        this.#hits.delete(key)
        return Promise.resolve()
    }
}

/** Options for a spec: one fresh signing key, in-memory stores and a fake clock. Override any field. */
export const testAuthOptions = (overrides: Partial<Omit<AuthOptions, "clock" | "sessions" | "accounts">> = {}): AuthOptions & { readonly clock: FakeClock; readonly sessions: MemorySessionStore; readonly accounts: MemoryAccounts } => {
    const clock = new FakeClock()
    const sessions = new MemorySessionStore()
    const accounts = new MemoryAccounts()
    return {
        issuer: "https://api.example.test",
        keys: [testSigningKey()],
        accessTtlSeconds: 900,
        refreshTtlSeconds: 2_592_000,
        bcryptCost: 4,
        returnOrigin: "https://app.example.test",
        google: null,
        cookie: { name: "auth_refresh" },
        budget: { loginAttempts: 3, resetAttempts: 2, windowMs: 900_000 },
        rate: new MemoryRateCounter(clock),
        ids: sequentialIds(),
        ...overrides,
        clock,
        sessions,
        accounts,
    }
}
