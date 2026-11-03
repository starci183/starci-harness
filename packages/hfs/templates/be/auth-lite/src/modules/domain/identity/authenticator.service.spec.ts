// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { FakeClock, fakeIds, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { PassportErrorCode } from "@modules/integrations/passport"
import type { AuthPasswords, GoogleProfile, SignInBudget } from "@modules/integrations/passport"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IDS } from "@modules/platform/ids"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { IDENTITY_AUTH_PASSWORDS, IDENTITY_SIGN_IN_BUDGET } from "./identity.decorators"
import { authUserRow as user } from "@tests/fixtures/builders/identity.builder"
import { IdentityAuthenticatorService } from "./authenticator.service"
import { AuthIdentityEntity, AuthUserEntity } from "./persistence/entities"

const NEW_ID = "00000000-0000-4000-8000-000000000001"
const AT = "2026-02-03T04:05:06.000Z"
const NOW = new Date(AT)
const BEFORE = new Date("2026-02-03T04:00:00.000Z")

const profile = (patch: Partial<GoogleProfile> = {}): GoogleProfile => ({
    subject: "g-1",
    email: "A@Example.test",
    emailVerified: true,
    name: "A",
    picture: null,
    ...patch,
})

const build = async (entityManager: MockEntityManager, matches = true) => {
    const passwords = mock<AuthPasswords>()
    passwords.verify.mockResolvedValue(matches)
    const budget = mock<SignInBudget>()
    budget.counted.mockImplementation(async (_kind, _address, check) => (await check()).value)
    const moduleRef = await Test.createTestingModule({
        providers: [
            IdentityAuthenticatorService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: IDENTITY_AUTH_PASSWORDS, useValue: passwords },
            { provide: IDENTITY_SIGN_IN_BUDGET, useValue: budget },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: IDS, useValue: fakeIds() },
        ],
    }).compile()
    return { subject: moduleRef.get(IdentityAuthenticatorService), passwords, budget }
}

const refusal = (code: string): unknown => expect.objectContaining({ code })

describe("IdentityAuthenticatorService.verifyPassword", () => {
    it("answers the person of a right pair, normalising the address, and records the sign-in", async () => {
        const entityManager = mockEntityManager({ findOne: [AuthUserEntity, user()], update: [AuthUserEntity, {}] })
        const { subject, passwords, budget } = await build(entityManager)

        expect(await subject.verifyPassword("  A@Example.test ", "correct horse")).toEqual({ userId: "u-1", email: "a@example.test" })

        expect(budget.counted).toHaveBeenCalledWith("login", "a@example.test", expect.any(Function))
        expect(passwords.verify).toHaveBeenCalledWith("correct horse", "hash")
        expect(entityManager.update).toHaveBeenCalledWith(AuthUserEntity, { id: "u-1" }, { lastSignInAt: NOW })
    })

    it("refuses an unknown address and a wrong password with the same code, and still spends the check on a decoy", async () => {
        const unknown = await build(mockEntityManager({ findOne: [AuthUserEntity, null] }))
        const wrong = await build(mockEntityManager({ findOne: [AuthUserEntity, user()] }), false)

        await expect(unknown.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.PairRefused))
        await expect(wrong.subject.verifyPassword("a@example.test", "pw")).rejects.toBeInstanceOf(IdentityError)
        expect(unknown.passwords.verify).toHaveBeenCalledWith("pw", "")
    })

    it("compares an empty password for one bcrypt cannot read, an account without a hash against the decoy", async () => {
        const { subject, passwords } = await build(mockEntityManager({ findOne: [AuthUserEntity, user("passwordless")] }), false)

        await expect(subject.verifyPassword("a@example.test", "x".repeat(100))).rejects.toBeInstanceOf(IdentityError)

        expect(passwords.verify).toHaveBeenCalledWith("", "")
    })

    it("refuses a banned or deleted account and an unconfirmed one after the password was right", async () => {
        const banned = await build(mockEntityManager({ findOne: [AuthUserEntity, user("banned")] }))
        const unconfirmed = await build(mockEntityManager({ findOne: [AuthUserEntity, user("unconfirmed")] }))
        const addressless = await build(mockEntityManager({ findOne: [AuthUserEntity, user("addressless")] }))

        await expect(banned.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.AccountDisabled))
        await expect(unconfirmed.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.EmailNotConfirmed))
        await expect(addressless.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.EmailNotConfirmed))
    })
})

describe("IdentityAuthenticatorService.signInWithGoogle", () => {
    it("refuses a profile without a verified address", async () => {
        const { subject } = await build(mockEntityManager())

        await expect(subject.signInWithGoogle(profile({ emailVerified: false }))).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
        await expect(subject.signInWithGoogle(profile({ email: null }))).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
    })

    it("signs in the account a Google subject is already linked to", async () => {
        const linked: AuthIdentityEntity = { id: "i-1", providerId: "g-1", userId: "u-1", identityData: {}, provider: "google", lastSignInAt: null, createdAt: BEFORE, updatedAt: BEFORE }
        const entityManager = mockEntityManager({ findOne: [[AuthIdentityEntity, linked], [AuthUserEntity, user("unconfirmed")]], update: [AuthUserEntity, {}] })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: "u-1", email: "a@example.test" })

        expect(entityManager.insert).not.toHaveBeenCalled()
        expect(entityManager.update).toHaveBeenCalledWith(AuthUserEntity, { id: "u-1" }, { lastSignInAt: NOW, emailConfirmedAt: NOW })
    })

    it("links an existing account by its verified address and keeps its confirmation date", async () => {
        const entityManager = mockEntityManager({ findOne: [[AuthIdentityEntity, null], [AuthUserEntity, user()]], insert: [AuthIdentityEntity, {}], update: [AuthUserEntity, {}] })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: "u-1", email: "a@example.test" })

        expect(entityManager.insert).toHaveBeenCalledWith(AuthIdentityEntity, expect.objectContaining({ id: NEW_ID, providerId: "g-1", userId: "u-1", provider: "google" }))
        expect(entityManager.update).toHaveBeenCalledWith(AuthUserEntity, { id: "u-1" }, { lastSignInAt: NOW, emailConfirmedAt: BEFORE })
    })

    it("creates the account of a new person and links their Google identity", async () => {
        const entityManager = mockEntityManager({
            findOne: [[AuthIdentityEntity, null], [AuthUserEntity, null], [AuthUserEntity, user("created")]],
            insert: [[AuthUserEntity, {}], [AuthIdentityEntity, {}]],
            update: [AuthUserEntity, {}],
        })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: NEW_ID, email: "a@example.test" })

        expect(entityManager.insert).toHaveBeenCalledWith(AuthUserEntity, expect.objectContaining({ id: NEW_ID, email: "a@example.test", encryptedPassword: null, emailConfirmedAt: NOW }))
    })

    it("refuses a disabled account and an account that cannot be read back", async () => {
        const disabled = mockEntityManager({ findOne: [[AuthIdentityEntity, null], [AuthUserEntity, user("deleted")]], insert: [AuthIdentityEntity, {}], update: [AuthUserEntity, {}] })
        fakeTransaction(disabled)
        const missing = mockEntityManager({ findOne: [[AuthIdentityEntity, null], [AuthUserEntity, null]], insert: [[AuthUserEntity, {}], [AuthIdentityEntity, {}]], update: [AuthUserEntity, {}] })
        fakeTransaction(missing)

        await expect((await build(disabled)).subject.signInWithGoogle(profile())).rejects.toEqual(refusal(IdentityErrorCode.AccountDisabled))
        await expect((await build(missing)).subject.signInWithGoogle(profile())).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
    })
})
