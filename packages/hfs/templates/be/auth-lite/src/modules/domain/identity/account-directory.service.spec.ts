// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { FakeClock, mockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IdentityAccountDirectoryService, isDisabled } from "./account-directory.service"
import { AuthUserEntity } from "./persistence/entities"

const AT = "2026-02-03T04:05:06.000Z"
const BEFORE = new Date("2026-02-03T04:00:00.000Z")
const AFTER = new Date("2026-02-03T05:00:00.000Z")

const user = (patch: Partial<AuthUserEntity>): AuthUserEntity => ({
    id: "u-1",
    aud: "authenticated",
    role: "authenticated",
    email: "a@example.test",
    encryptedPassword: null,
    emailConfirmedAt: BEFORE,
    lastSignInAt: null,
    bannedUntil: null,
    deletedAt: null,
    isAnonymous: false,
    createdAt: BEFORE,
    updatedAt: BEFORE,
    ...patch,
})

const build = async (rows: ReadonlyArray<AuthUserEntity | null>) => {
    const entityManager = mockEntityManager({ findOne: rows.map((result) => [AuthUserEntity, result] as const) })
    const moduleRef = await Test.createTestingModule({
        providers: [
            IdentityAccountDirectoryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: CLOCK, useValue: new FakeClock(AT) },
        ],
    }).compile()
    return moduleRef.get(IdentityAccountDirectoryService)
}

describe("IdentityAccountDirectoryService.find", () => {
    it("answers the standing of a live account, a banned one, a deleted one and a missing one", async () => {
        const subject = await build([user({}), user({ bannedUntil: AFTER }), user({ bannedUntil: BEFORE }), user({ deletedAt: BEFORE }), null])

        expect(await subject.find("u-1")).toEqual({ id: "u-1", email: "a@example.test", disabled: false })
        expect((await subject.find("u-1"))?.disabled).toBe(true)
        expect((await subject.find("u-1"))?.disabled).toBe(false)
        expect((await subject.find("u-1"))?.disabled).toBe(true)
        expect(await subject.find("u-2")).toBeUndefined()
    })
})

describe("isDisabled", () => {
    it("is true for a deleted account and for a ban that has not ended", () => {
        const now = new Date(AT)

        expect(isDisabled(user({ deletedAt: BEFORE }), now)).toBe(true)
        expect(isDisabled(user({ bannedUntil: AFTER }), now)).toBe(true)
        expect(isDisabled(user({ bannedUntil: BEFORE }), now)).toBe(false)
        expect(isDisabled(user({}), now)).toBe(false)
    })
})
