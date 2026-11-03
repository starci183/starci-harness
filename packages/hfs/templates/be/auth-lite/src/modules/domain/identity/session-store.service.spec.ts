// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { LessThan, Not } from "typeorm"
import { fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IdentityRefreshTokenEntity, IdentitySessionEntity } from "./persistence/entities"
import { IdentitySessionStoreService } from "./session-store.service"

const NOW = new Date("2026-02-03T04:05:06.000Z")
const LATER = new Date("2026-03-03T04:05:06.000Z")

const row = (usedAt: Date | null): IdentityRefreshTokenEntity => ({
    id: "t-1",
    sessionId: "s-1",
    userId: "u-1",
    tokenHash: "h-1",
    createdAt: NOW,
    expiresAt: LATER,
    usedAt,
})

const build = async (entityManager: MockEntityManager = mockEntityManager()) => {
    const transaction = fakeTransaction(entityManager)
    const moduleRef = await Test.createTestingModule({
        providers: [IdentitySessionStoreService, { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager }],
    }).compile()
    return { subject: moduleRef.get(IdentitySessionStoreService), entityManager, transaction }
}

describe("IdentitySessionStoreService.transaction", () => {
    it("opens a session and stores a live token in one transaction", async () => {
        const { subject, entityManager, transaction } = await build(mockEntityManager({ insert: [[IdentitySessionEntity, {}], [IdentityRefreshTokenEntity, {}]] }))

        await subject.transaction(async (tx) => {
            await tx.openSession({ id: "s-1", userId: "u-1", now: NOW, userAgent: "agent", ip: "203.0.113.9" })
            await tx.insertToken({ id: "t-1", sessionId: "s-1", userId: "u-1", tokenHash: "h-1", expiresAt: LATER })
        })

        expect(entityManager.insert).toHaveBeenCalledWith(IdentitySessionEntity, { id: "s-1", userId: "u-1", createdAt: NOW, refreshedAt: NOW, userAgent: "agent", ip: "203.0.113.9" })
        expect(entityManager.insert).toHaveBeenCalledWith(IdentityRefreshTokenEntity, { id: "t-1", sessionId: "s-1", userId: "u-1", tokenHash: "h-1", expiresAt: LATER, usedAt: null })
        expect(transaction.commits).toBe(1)
    })

    it("reads the token for update, marks it used and drops the expired ones", async () => {
        const { subject, entityManager } = await build(
            mockEntityManager({
                findOne: [[IdentityRefreshTokenEntity, row(NOW)], [IdentityRefreshTokenEntity, null]],
                update: [IdentityRefreshTokenEntity, {}],
                delete: [IdentityRefreshTokenEntity, {}],
            }),
        )

        const found = await subject.transaction((tx) => tx.findTokenForUpdate("h-1"))
        const missing = await subject.transaction((tx) => tx.findTokenForUpdate("h-2"))
        await subject.transaction(async (tx) => {
            await tx.markTokenUsed("t-1", NOW)
            await tx.deleteExpiredTokens("u-1", NOW)
        })

        expect(found).toEqual({ id: "t-1", sessionId: "s-1", userId: "u-1", tokenHash: "h-1", expiresAt: LATER, usedAt: NOW })
        expect(missing).toBeNull()
        expect(entityManager.findOne).toHaveBeenCalledWith(IdentityRefreshTokenEntity, { where: { tokenHash: "h-1" }, lock: { mode: "pessimistic_write" } })
        expect(entityManager.update).toHaveBeenCalledWith(IdentityRefreshTokenEntity, { id: "t-1" }, { usedAt: NOW })
        expect(entityManager.delete).toHaveBeenCalledWith(IdentityRefreshTokenEntity, { userId: "u-1", expiresAt: LessThan(NOW) })
    })

    it("rolls the transaction back when the work throws", async () => {
        const { subject, transaction } = await build()

        await expect(subject.transaction(() => Promise.reject(new Error("disk full")))).rejects.toThrow("disk full")

        expect(transaction.rollbacks).toBe(1)
    })
})

describe("IdentitySessionStoreService", () => {
    it("finds a token outside a transaction, or none", async () => {
        const { subject } = await build(mockEntityManager({ findOne: [[IdentityRefreshTokenEntity, row(null)], [IdentityRefreshTokenEntity, null]] }))

        expect(await subject.findToken("h-1")).toMatchObject({ id: "t-1", usedAt: null })
        expect(await subject.findToken("h-2")).toBeNull()
    })

    it("touches, closes and closes the others of a session", async () => {
        const { subject, entityManager } = await build(mockEntityManager({ update: [IdentitySessionEntity, {}], delete: [IdentitySessionEntity, {}] }))

        await subject.touchSession("s-1", NOW)
        await subject.closeSession("s-1")
        await subject.closeOtherSessions("u-1", "s-1")

        expect(entityManager.update).toHaveBeenCalledWith(IdentitySessionEntity, { id: "s-1" }, { refreshedAt: NOW })
        expect(entityManager.delete).toHaveBeenCalledWith(IdentitySessionEntity, { id: "s-1" })
        expect(entityManager.delete).toHaveBeenCalledWith(IdentitySessionEntity, { userId: "u-1", id: Not("s-1") })
    })
})
