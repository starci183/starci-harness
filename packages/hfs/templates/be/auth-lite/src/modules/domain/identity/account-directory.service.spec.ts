// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { FakeClock, mockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { authUserRow as user } from "@tests/fixtures/builders/identity.builder"
import { AuthUserEntity } from "./persistence/entities"
import { IdentityAccountDirectoryService, isDisabled } from "./account-directory.service"

const AT = "2026-02-03T04:05:06.000Z"

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
        const subject = await build([user("live"), user("banned"), user("ban-ended"), user("deleted"), null])

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

        expect(isDisabled(user("deleted"), now)).toBe(true)
        expect(isDisabled(user("banned"), now)).toBe(true)
        expect(isDisabled(user("ban-ended"), now)).toBe(false)
        expect(isDisabled(user("live"), now)).toBe(false)
    })
})
