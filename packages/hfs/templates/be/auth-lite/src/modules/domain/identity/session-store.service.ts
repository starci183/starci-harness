// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import { LessThan, Not } from "typeorm"
import type { EntityManager } from "typeorm"
import type { NewSession, RefreshTokenRecord, SessionStore, SessionTransaction } from "@modules/integrations/passport"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { IdentityRefreshTokenEntity, IdentitySessionEntity } from "./persistence/entities"

const recordOf = (row: IdentityRefreshTokenEntity): RefreshTokenRecord => ({
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
})

const transactionOf = (scoped: EntityManager): SessionTransaction => ({
    openSession: async (session: NewSession) => {
        await scoped.insert(IdentitySessionEntity, {
            id: session.id,
            userId: session.userId,
            createdAt: session.now,
            refreshedAt: session.now,
            userAgent: session.userAgent,
            ip: session.ip,
        })
    },
    insertToken: async (token) => {
        await scoped.insert(IdentityRefreshTokenEntity, {
            id: token.id,
            sessionId: token.sessionId,
            userId: token.userId,
            tokenHash: token.tokenHash,
            expiresAt: token.expiresAt,
            usedAt: null,
        })
    },
    findTokenForUpdate: async (tokenHash) => {
        const row = await scoped.findOne(IdentityRefreshTokenEntity, { where: { tokenHash }, lock: { mode: "pessimistic_write" } })
        return row === null ? null : recordOf(row)
    },
    markTokenUsed: async (tokenId, at) => {
        await scoped.update(IdentityRefreshTokenEntity, { id: tokenId }, { usedAt: at })
    },
    deleteExpiredTokens: async (userId, before) => {
        await scoped.delete(IdentityRefreshTokenEntity, { userId, expiresAt: LessThan(before) })
    },
})

@Injectable()
/** The package's session store over the entities of its tables: one transaction per rotation, the token row locked for update. */
export class IdentitySessionStoreService implements SessionStore {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** Runs the work in one database transaction. */
    transaction<T>(work: (tx: SessionTransaction) => Promise<T>): Promise<T> {
        return this.entityManager.transaction((scoped) => work(transactionOf(scoped)))
    }

    /** The token with this digest, or null. */
    async findToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
        const row = await this.entityManager.findOne(IdentityRefreshTokenEntity, { where: { tokenHash } })
        return row === null ? null : recordOf(row)
    }

    /** Marks a session refreshed. */
    async touchSession(sessionId: string, now: Date): Promise<void> {
        await this.entityManager.update(IdentitySessionEntity, { id: sessionId }, { refreshedAt: now })
    }

    /** Ends one session; its tokens go with it (the foreign key cascades). */
    async closeSession(sessionId: string): Promise<void> {
        await this.entityManager.delete(IdentitySessionEntity, { id: sessionId })
    }

    /** Ends every session of an account but one. */
    async closeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
        await this.entityManager.delete(IdentitySessionEntity, { userId, id: Not(keepSessionId) })
    }
}
