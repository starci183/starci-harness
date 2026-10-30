import { Test } from "@nestjs/testing"
import { hashPassword, verifyPassword } from "./passport.password"

const PASSWORD: unique symbol = Symbol("passport.password")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: PASSWORD, useValue: { hashPassword, verifyPassword } }],
    }).compile()
    return moduleRef.get<{ hashPassword: typeof hashPassword; verifyPassword: typeof verifyPassword }>(PASSWORD)
}

describe("hashPassword and verifyPassword", () => {
    it("hashes at bcrypt cost 12 and verifies only the password it hashed", async () => {
        const subject = await build()
        const stored = await subject.hashPassword("correct horse")

        expect(stored.slice(0, 7)).toBe("$2b$12$")
        expect(await subject.verifyPassword("correct horse", stored)).toBe(true)
        expect(await subject.verifyPassword("wrong horse", stored)).toBe(false)
    })

    it("never matches an account that has no password hash", async () => {
        const subject = await build()

        expect(await subject.verifyPassword("correct horse", null)).toBe(false)
    })
})
