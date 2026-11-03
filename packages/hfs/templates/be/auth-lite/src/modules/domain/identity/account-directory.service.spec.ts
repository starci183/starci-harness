// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { mockEntityManager } from "@starci/jest-preset"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { accountByIdRow } from "@tests/fixtures/builders/identity.builder"
import { IdentityAccountDirectoryService } from "./account-directory.service"

const USER_BY_ID = 'SELECT * FROM "public"."be_auth_user_by_id"($1)'

const build = async (rows: unknown) => {
    const entityManager = mockEntityManager({ query: [USER_BY_ID, rows] })
    const moduleRef = await Test.createTestingModule({
        providers: [IdentityAccountDirectoryService, { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager }],
    }).compile()
    return { directory: moduleRef.get(IdentityAccountDirectoryService), entityManager }
}

describe("IdentityAccountDirectoryService.find", () => {
    it("answers the standing of a live account through the door", async () => {
        const { directory, entityManager } = await build([accountByIdRow("live")])

        expect(await directory.find("u-1")).toEqual({ id: "u-1", email: "a@example.test", disabled: false })
        expect(entityManager.query).toHaveBeenCalledWith(USER_BY_ID, ["u-1"])
    })

    it("answers a disabled account as disabled, and an account without an address with none", async () => {
        const banned = await build([accountByIdRow("disabled")])
        const addressless = await build([accountByIdRow("addressless")])

        expect((await banned.directory.find("u-1"))?.disabled).toBe(true)
        expect(await addressless.directory.find("u-1")).toEqual({ id: "u-1", email: null, disabled: false })
    })

    it("answers the full name the profile keys hold, and none for an empty or a missing one", async () => {
        const named = await build([accountByIdRow("named")])
        const blank = await build([{ ...accountByIdRow(), meta: { full_name: "" } }])
        const raw = await build([{ ...accountByIdRow(), meta: null }])

        expect(await named.directory.find("u-1")).toEqual({
            id: "u-1",
            email: "a@example.test",
            disabled: false,
            name: "Ada Lovelace",
        })
        expect((await blank.directory.find("u-1"))?.name).toBeUndefined()
        expect((await raw.directory.find("u-1"))?.name).toBeUndefined()
    })

    it("answers undefined for an account that does not exist", async () => {
        const { directory } = await build([])

        expect(await directory.find("u-2")).toBeUndefined()
    })

    it("refuses a door answer that is not the account shape", async () => {
        const { directory } = await build([{ id: "u-1", email: "a@example.test", disabled: "no" }])

        await expect(directory.find("u-1")).rejects.toMatchObject({ code: "DATABASE_RETURNING_ROW_REJECTED" })
    })
})
