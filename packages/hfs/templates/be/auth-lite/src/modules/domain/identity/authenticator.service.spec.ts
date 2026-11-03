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
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { IDENTITY_AUTH_PASSWORDS, IDENTITY_SIGN_IN_BUDGET } from "./identity.decorators"
import { IdentitySignInLogEvent } from "./identity-sign-in.log-events"
import { accountByEmailRow, accountByIdRow } from "@tests/fixtures/builders/identity.builder"
import { IdentityAuthenticatorService } from "./authenticator.service"

/** The statements callDbFunction sends for the account doors. */
const USER_BY_EMAIL = 'SELECT * FROM "public"."be_auth_user_by_email"($1)'
const USER_BY_ID = 'SELECT * FROM "public"."be_auth_user_by_id"($1)'
const USER_BY_GOOGLE = 'SELECT * FROM "public"."be_auth_user_by_google"($1)'
const CREATE_USER = 'SELECT * FROM "public"."be_auth_create_user"($1, $2, $3, $4, $5, $6)'
const LINK_GOOGLE = 'SELECT * FROM "public"."be_auth_link_google"($1, $2, $3, $4)'
const TOUCH_USER = 'SELECT * FROM "public"."be_auth_touch_user"($1, $2, $3, $4)'

const NEW_ID = "00000000-0000-4000-8000-000000000001"
const AT = "2026-02-03T04:05:06.000Z"
const NOW = new Date(AT)

const profile = (patch: Partial<GoogleProfile> = {}): GoogleProfile => ({
    subject: "g-1",
    email: "A@Example.test",
    emailVerified: true,
    name: "A",
    picture: null,
    ...patch,
})

type Stubs = ReadonlyArray<readonly [string, unknown]>

const build = async (answers: Stubs, matches = true) => {
    const entityManager: MockEntityManager = answers.length === 0 ? mockEntityManager() : mockEntityManager({ query: answers })
    fakeTransaction(entityManager)
    const passwords = mock<AuthPasswords>()
    passwords.verify.mockResolvedValue(matches)
    const budget = mock<SignInBudget>()
    budget.counted.mockImplementation(async (_kind, _address, check) => (await check()).value)
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            IdentityAuthenticatorService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: IDENTITY_AUTH_PASSWORDS, useValue: passwords },
            { provide: IDENTITY_SIGN_IN_BUDGET, useValue: budget },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: IDS, useValue: fakeIds() },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { subject: moduleRef.get(IdentityAuthenticatorService), entityManager, passwords, budget, logger }
}

const refusal = (code: string): unknown => expect.objectContaining({ code })

describe("IdentityAuthenticatorService.verifyPassword", () => {
    it("answers the person of a right pair, normalising the address, and records the sign-in through the door", async () => {
        const { subject, entityManager, passwords, budget } = await build([
            [USER_BY_EMAIL, [accountByEmailRow()]],
            [TOUCH_USER, []],
        ])

        expect(await subject.verifyPassword("  A@Example.test ", "correct horse")).toEqual({ userId: "u-1", email: "a@example.test" })

        expect(budget.counted).toHaveBeenCalledWith("login", "a@example.test", expect.any(Function))
        expect(passwords.verify).toHaveBeenCalledWith("correct horse", "hash")
        expect(entityManager.query).toHaveBeenCalledWith(USER_BY_EMAIL, ["a@example.test"])
        expect(entityManager.query).toHaveBeenCalledWith(TOUCH_USER, ["u-1", NOW, false, "{}"])
    })

    it("refuses an unknown address and a wrong password with the same code, and still spends the check on a decoy", async () => {
        const unknown = await build([[USER_BY_EMAIL, []]])
        const wrong = await build([[USER_BY_EMAIL, [accountByEmailRow()]]], false)

        await expect(unknown.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.PairRefused))
        await expect(wrong.subject.verifyPassword("a@example.test", "pw")).rejects.toBeInstanceOf(IdentityError)
        expect(unknown.passwords.verify).toHaveBeenCalledWith("pw", "")
        expect(wrong.entityManager.query).not.toHaveBeenCalledWith(TOUCH_USER, expect.anything())
    })

    it("compares an empty password for one bcrypt cannot read, an account without a hash against the decoy", async () => {
        const { subject, passwords } = await build([[USER_BY_EMAIL, [accountByEmailRow("passwordless")]]], false)

        await expect(subject.verifyPassword("a@example.test", "x".repeat(100))).rejects.toBeInstanceOf(IdentityError)

        expect(passwords.verify).toHaveBeenCalledWith("", "")
    })

    it("refuses a disabled account and an unconfirmed one after the password was right, recording no sign-in", async () => {
        const disabled = await build([[USER_BY_EMAIL, [accountByEmailRow("disabled")]]])
        const unconfirmed = await build([[USER_BY_EMAIL, [accountByEmailRow("unconfirmed")]]])

        await expect(disabled.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.AccountDisabled))
        await expect(unconfirmed.subject.verifyPassword("a@example.test", "pw")).rejects.toEqual(refusal(IdentityErrorCode.EmailNotConfirmed))
        expect(disabled.entityManager.query).not.toHaveBeenCalledWith(TOUCH_USER, expect.anything())
        expect(unconfirmed.entityManager.query).not.toHaveBeenCalledWith(TOUCH_USER, expect.anything())
    })
})

describe("IdentityAuthenticatorService.signInWithGoogle", () => {
    it("refuses a profile without a verified address, and calls no door", async () => {
        const { subject, entityManager } = await build([])

        await expect(subject.signInWithGoogle(profile({ emailVerified: false }))).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
        await expect(subject.signInWithGoogle(profile({ email: null }))).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
        expect(entityManager.query).not.toHaveBeenCalled()
    })

    it("signs in the account a Google subject is already linked to, confirming its mailbox", async () => {
        const { subject, entityManager } = await build([
            [USER_BY_GOOGLE, [{ be_auth_user_by_google: "u-1" }]],
            [LINK_GOOGLE, []],
            [TOUCH_USER, []],
            [USER_BY_ID, [accountByIdRow()]],
        ])

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: "u-1", email: "a@example.test" })

        expect(entityManager.query).not.toHaveBeenCalledWith(USER_BY_EMAIL, expect.anything())
        expect(entityManager.query).not.toHaveBeenCalledWith(CREATE_USER, expect.anything())
        expect(entityManager.query).toHaveBeenCalledWith(TOUCH_USER, ["u-1", NOW, true, expect.stringContaining('"full_name":"A"')])
    })

    it("links an existing account by its verified address", async () => {
        const { subject, entityManager } = await build([
            [USER_BY_GOOGLE, [{ be_auth_user_by_google: null }]],
            [USER_BY_EMAIL, [accountByEmailRow()]],
            [LINK_GOOGLE, []],
            [TOUCH_USER, []],
            [USER_BY_ID, [accountByIdRow()]],
        ])

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: "u-1", email: "a@example.test" })

        expect(entityManager.query).toHaveBeenCalledWith(USER_BY_EMAIL, ["a@example.test"])
        expect(entityManager.query).toHaveBeenCalledWith(LINK_GOOGLE, ["u-1", "g-1", expect.stringContaining('"sub":"g-1"'), NOW])
        expect(entityManager.query).not.toHaveBeenCalledWith(CREATE_USER, expect.anything())
    })

})

describe("IdentityAuthenticatorService.signInWithGoogle (new accounts and refusals)", () => {
    it("creates the account of a new person, links their Google identity and logs the id alone", async () => {
        const { subject, entityManager, logger } = await build([
            [USER_BY_GOOGLE, [{ be_auth_user_by_google: null }]],
            [USER_BY_EMAIL, []],
            [CREATE_USER, [{ be_auth_create_user: NEW_ID }]],
            [LINK_GOOGLE, []],
            [TOUCH_USER, []],
            [USER_BY_ID, [accountByIdRow("live", NEW_ID)]],
        ])

        expect(await subject.signInWithGoogle(profile())).toEqual({ userId: NEW_ID, email: "a@example.test" })

        expect(entityManager.query).toHaveBeenCalledWith(CREATE_USER, [NEW_ID, "a@example.test", null, true, expect.stringContaining('"full_name":"A"'), NOW])
        expect(entityManager.query).toHaveBeenCalledWith(LINK_GOOGLE, [NEW_ID, "g-1", expect.stringContaining("g-1"), NOW])
        expect(logger.info).toHaveBeenCalledWith(IdentitySignInLogEvent.AccountCreated, { userId: NEW_ID })
    })

    it("fills only the profile keys the Google profile has", async () => {
        const { subject, entityManager } = await build([
            [USER_BY_GOOGLE, [{ be_auth_user_by_google: "u-1" }]],
            [LINK_GOOGLE, []],
            [TOUCH_USER, []],
            [USER_BY_ID, [accountByIdRow()]],
        ])

        await subject.signInWithGoogle(profile({ name: null, picture: "https://img.example.test/a.png" }))

        const keys = { avatar_url: "https://img.example.test/a.png", picture: "https://img.example.test/a.png", email: "A@Example.test", email_verified: true }
        expect(entityManager.query).toHaveBeenCalledWith(TOUCH_USER, ["u-1", NOW, true, JSON.stringify(keys)])
    })

    it("refuses when the create door answers no account", async () => {
        const { subject, entityManager } = await build([
            [USER_BY_GOOGLE, [{ be_auth_user_by_google: null }]],
            [USER_BY_EMAIL, []],
            [CREATE_USER, []],
        ])

        await expect(subject.signInWithGoogle(profile())).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
        expect(entityManager.query).not.toHaveBeenCalledWith(LINK_GOOGLE, expect.anything())
    })

    it("refuses a disabled account and an account that cannot be read back", async () => {
        const linked: Stubs = [
            [USER_BY_GOOGLE, [{ be_auth_user_by_google: "u-1" }]],
            [LINK_GOOGLE, []],
            [TOUCH_USER, []],
        ]
        const disabled = await build([...linked, [USER_BY_ID, [accountByIdRow("disabled")]]])
        const gone = await build([...linked, [USER_BY_ID, []]])
        const addressless = await build([...linked, [USER_BY_ID, [accountByIdRow("addressless")]]])

        await expect(disabled.subject.signInWithGoogle(profile())).rejects.toEqual(refusal(IdentityErrorCode.AccountDisabled))
        await expect(gone.subject.signInWithGoogle(profile())).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
        await expect(addressless.subject.signInWithGoogle(profile())).rejects.toEqual(refusal(PassportErrorCode.GoogleRejected))
    })
})
