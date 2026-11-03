// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { PASSPORT_PASSWORDS, PASSPORT_SIGN_IN_BUDGET, PassportError, PassportErrorCode } from "@modules/integrations/passport"
import type { AuthPasswords, GoogleProfile, SignInBudget } from "@modules/integrations/passport"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IDS } from "@modules/platform/ids"
import { IdentityAuthenticatorService } from "./authenticator.service"
import { AuthIdentityEntity, AuthUserEntity } from "./persistence/entities"

const AT = "2026-02-03T04:05:06.000Z"
const NOW = new Date(AT)
const BEFORE = new Date("2026-02-03T04:00:00.000Z")
const AFTER = new Date("2026-02-03T05:00:00.000Z")

const user = (patch: Partial<AuthUserEntity> = {}): AuthUserEntity => ({
    id: "u-1",
    aud: "authenticated",
    role: "authenticated",
    email: "a@example.test",
    encryptedPassword: "hash",
    emailConfirmedAt: BEFORE,
    lastSignInAt: null,
    bannedUntil: null,
    deletedAt: null,
    isAnonymous: false,
    createdAt: BEFORE,
    updatedAt: BEFORE,
    ...patch,
})

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
            { provide: PASSPORT_PASSWORDS, useValue: passwords },
            { provide: PASSPORT_SIGN_IN_BUDGET, useValue: budget },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: IDS, useValue: { next: () => "new-id" } },
        ],
    }).compile()
    return { subject: moduleRef.get(IdentityAuthenticatorService), passwords, budget }
}

const refusal = (code: string) => expect.objectContaining({ code }) as unknown

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

        await expect(unknown.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(PassportErrorCode.InvalidCredentials))
        await expect(wrong.subject.verifyPassword("a@example.test", "pw")).rejects.toBeInstanceOf(PassportError)
        expect(unknown.passwords.verify).toHaveBeenCalledWith("pw", "")
    })

    it("compares an empty password for one bcrypt cannot read, an account without a hash against the decoy", async () => {
        const { subject, passwords } = await build(mockEntityManager({ findOne: [AuthUserEntity, user({ encryptedPassword: null })] }), false)

        await expect(subject.verifyPassword("a@example.test", "x".repeat(100))).rejects.toBeInstanceOf(PassportError)

        expect(passwords.verify).toHaveBeenCalledWith("", "")
    })

    it("refuses a banned or deleted account and an unconfirmed one after the password was right", async () => {
        const banned = await build(mockEntityManager({ findOne: [AuthUserEntity, user({ bannedUntil: AFTER })] }))
        const unconfirmed = await build(mockEntityManager({ findOne: [AuthUserEntity, user({ emailConfirmedAt: null })] }))
        const addressless = await build(mockEntityManager({ findOne: [AuthUserEntity, user({ email: null })] }))

        await expect(banned.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(PassportErrorCode.AccountDisabled))
        await expect(unconfirmed.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(PassportErrorCode.EmailNotConfirmed))
        await expect(addressless.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(PassportErrorCode.EmailNotConfirmed))
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
        const entityManager = mockEntityManager({ findOne: [[AuthIdentityEntity, linked], [AuthUserEntity, user({ emailConfirmedAt: null })]], update: [AuthUserEntity, {}] })
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

        expect(entityManager.insert).toHaveBeenCalledWith(AuthIdentityEntity, expect.objectContaining({ id: "new-id", providerId: "g-1", userId: "u-1", provider: "google" }))
        expect(entityManager.update).toHaveBeenCalledWith(AuthUserEntity, { id: "u-1" }, { lastSignInAt: NOW, emailConfirmedAt: BEFORE })
    })

    it("creates the account of a new person and links their Google identity", async () => {
        const entityManager = mockEntityManager({
            findOne: [[AuthIdentityEntity, null], [AuthUserEntity, null], [AuthUserEntity, user({ id: "new-id", encryptedPassword: null })]],
            insert: [[AuthUserEntity, {}], [AuthIdentityEntity, {}]],
            update: [AuthUserEntity, {}],
        })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: "new-id", email: "a@example.test" })

        expect(entityManager.insert).toHaveBeenCalledWith(AuthUserEntity, expect.objectContaining({ id: "new-id", email: "a@example.test", encryptedPassword: null, emailConfirmedAt: NOW }))
    })

    it("refuses a disabled account and an account that cannot be read back", async () => {
        const disabled = mockEntityManager({ findOne: [[AuthIdentityEntity, null], [AuthUserEntity, user({ deletedAt: BEFORE })]], insert: [AuthIdentityEntity, {}], update: [AuthUserEntity, {}] })
        fakeTransaction(disabled)
        const missing = mockEntityManager({ findOne: [[AuthIdentityEntity, null], [AuthUserEntity, null]], insert: [[AuthUserEntity, {}], [AuthIdentityEntity, {}]], update: [AuthUserEntity, {}] })
        fakeTransaction(missing)

        await expect((await build(disabled)).subject.signInWithGoogle(profile())).rejects.toEqual(refusal(PassportErrorCode.AccountDisabled))
        await expect((await build(missing)).subject.signInWithGoogle(profile())).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
    })
})
