// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { FakeClock, fakeIds, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { MAILER } from "@modules/integrations/mail"
import type { Mailer, MailOptions } from "@modules/integrations/mail"
import { AuthError, digestOf } from "@modules/integrations/passport"
import type { AuthPasswords, SignInBudget } from "@modules/integrations/passport"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { IDS } from "@modules/platform/ids"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { MAIL_SETTINGS } from "@modules/integrations/mail"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { IDENTITY_AUTH_PASSWORDS, IDENTITY_SIGN_IN_BUDGET } from "./identity.decorators"
import { IdentityEmailService } from "./identity-email.service"
import { IdentityEmailTokenEntity } from "./persistence/entities"
import { IdentitySessionStoreService } from "./session-store.service"
import { accountByEmailRow as account } from "@tests/fixtures/builders/identity.builder"

/** The statements callDbFunction sends for the account doors the email doors use. */
const USER_BY_EMAIL = 'SELECT * FROM "public"."be_auth_user_by_email"($1)'
const CREATE_USER = 'SELECT * FROM "public"."be_auth_create_user"($1, $2, $3, $4, $5, $6)'
const CONFIRM_USER = 'SELECT * FROM "public"."be_auth_confirm_user"($1, $2)'
const SET_PASSWORD = 'SELECT * FROM "public"."be_auth_set_password"($1, $2, $3, $4)'

const NEW_ID = "00000000-0000-4000-8000-000000000001"
const AT = "2026-02-03T04:05:06.000Z"
const NOW = new Date(AT)
const SETTINGS = mock<MailOptions>({
    webOrigin: "https://app.example.test",
    brandName: "Acme",
    defaultLanguage: "en",
    confirmTtlSeconds: 86_400,
    resetTtlSeconds: 3_600,
})

const refusal = (code: string): unknown => expect.objectContaining({ code })
const tokenRow = (purpose: string): IdentityEmailTokenEntity => ({
    id: "t-1",
    userId: "u-1",
    purpose,
    tokenHash: "h",
    expiresAt: new Date("2026-02-04T00:00:00.000Z"),
    usedAt: null,
    createdAt: NOW,
})

const build = async (entityManager: MockEntityManager) => {
    const passwords = mock<AuthPasswords>()
    passwords.hash.mockResolvedValue("new-hash")
    const budget = mock<SignInBudget>()
    budget.admit.mockResolvedValue(undefined)
    const mailer = mock<Mailer>()
    mailer.send.mockResolvedValue({ messageId: "<m>", accepted: ["a@example.test"] })
    const sessions = mock<IdentitySessionStoreService>()
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            IdentityEmailService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: IDENTITY_AUTH_PASSWORDS, useValue: passwords },
            { provide: IDENTITY_SIGN_IN_BUDGET, useValue: budget },
            { provide: MAILER, useValue: mailer },
            { provide: MAIL_SETTINGS, useValue: SETTINGS },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: IDS, useValue: fakeIds() },
            { provide: LOGGER, useValue: logger },
            { provide: IdentitySessionStoreService, useValue: sessions },
        ],
    }).compile()
    return { subject: moduleRef.get(IdentityEmailService), passwords, budget, mailer, sessions, logger }
}

describe("IdentityEmailService.signup", () => {
    it("creates an unconfirmed account through the door, stores only the digest of the link token and mails the link", async () => {
        const entityManager = mockEntityManager({
            query: [
                [USER_BY_EMAIL, []],
                [CREATE_USER, [{ be_auth_create_user: NEW_ID }]],
            ],
            insert: [IdentityEmailTokenEntity, {}],
            update: [IdentityEmailTokenEntity, {}],
        })
        fakeTransaction(entityManager)
        const { subject, budget, mailer } = await build(entityManager)

        await subject.signup(" New@Example.test ", "correct horse")

        expect(budget.admit).toHaveBeenCalledWith("signup", "new@example.test")
        expect(entityManager.query).toHaveBeenCalledWith(CREATE_USER, [
            NEW_ID,
            "new@example.test",
            "new-hash",
            false,
            "{}",
            NOW,
        ])
        const sent = mailer.send.mock.calls[0]?.[0]
        const url = /https:\/\/[^\s"<]+/u.exec(sent?.message.text ?? "")?.[0] ?? ""
        const token = new URL(url).searchParams.get("token") ?? ""
        expect(new URL(url).pathname).toBe("/auth/confirm")
        expect(token).toHaveLength(64)
        expect(entityManager.insert).toHaveBeenCalledWith(
            IdentityEmailTokenEntity,
            expect.objectContaining({ userId: NEW_ID, purpose: "confirm", tokenHash: digestOf(token), usedAt: null }),
        )
        expect(sent?.to).toBe("new@example.test")
    })

    it("keeps the generated id when the create door answers no row, and the full name in the profile keys", async () => {
        const entityManager = mockEntityManager({
            query: [
                [USER_BY_EMAIL, []],
                [CREATE_USER, []],
            ],
            insert: [IdentityEmailTokenEntity, {}],
            update: [IdentityEmailTokenEntity, {}],
        })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        await subject.signup("new@example.test", "correct horse", "en", "Ada Lovelace")

        expect(entityManager.query).toHaveBeenCalledWith(CREATE_USER, [
            NEW_ID,
            "new@example.test",
            "new-hash",
            false,
            JSON.stringify({ full_name: "Ada Lovelace", name: "Ada Lovelace" }),
            NOW,
        ])
        expect(entityManager.insert).toHaveBeenCalledWith(
            IdentityEmailTokenEntity,
            expect.objectContaining({ userId: NEW_ID }),
        )
    })

    it("refuses a password the policy rejects before it touches an account", async () => {
        const { subject, mailer } = await build(mockEntityManager())

        await expect(subject.signup("a@example.test", "short")).rejects.toEqual(
            refusal(IdentityErrorCode.PasswordInvalid),
        )
        expect(mailer.send).not.toHaveBeenCalled()
    })
})

describe("IdentityEmailService.signup (an address already known, a failing mail server, a spent budget)", () => {
    it("mails a new link to an unconfirmed account and says nothing about a confirmed one", async () => {
        const unconfirmed = mockEntityManager({
            query: [USER_BY_EMAIL, [account("unconfirmed")]],
            insert: [IdentityEmailTokenEntity, {}],
            update: [IdentityEmailTokenEntity, {}],
        })
        fakeTransaction(unconfirmed)
        const confirmed = mockEntityManager({ query: [USER_BY_EMAIL, [account()]] })
        const first = await build(unconfirmed)
        const second = await build(confirmed)

        await first.subject.signup("a@example.test", "correct horse")
        await second.subject.signup("a@example.test", "correct horse")

        expect(first.mailer.send).toHaveBeenCalledTimes(1)
        expect(second.mailer.send).not.toHaveBeenCalled()
        expect(confirmed.query).not.toHaveBeenCalledWith(CREATE_USER, expect.anything())
    })

    it("answers as if the mail was sent when the mail server fails, and logs the failure", async () => {
        const entityManager = mockEntityManager({
            query: [
                [USER_BY_EMAIL, []],
                [CREATE_USER, [{ be_auth_create_user: NEW_ID }]],
            ],
            insert: [IdentityEmailTokenEntity, {}],
            update: [IdentityEmailTokenEntity, {}],
        })
        fakeTransaction(entityManager)
        const { subject, mailer, logger } = await build(entityManager)
        mailer.send.mockRejectedValue(new Error("down"))

        await expect(subject.signup("a@example.test", "correct horse", "vi")).resolves.toBeUndefined()
        expect(logger.error).toHaveBeenCalledWith("identity.email.mail_failed", expect.any(Error), { kind: "confirm" })
    })

    it("turns a spent budget into the too-many-attempts refusal", async () => {
        const { subject, budget } = await build(mockEntityManager())
        budget.admit.mockRejectedValue(new AuthError(IdentityErrorCode.TooManyAttempts))

        await expect(subject.signup("a@example.test", "correct horse")).rejects.toEqual(
            refusal(IdentityErrorCode.TooManyAttempts),
        )
        budget.admit.mockRejectedValue(new Error("store down"))
        await expect(subject.resend("a@example.test")).rejects.toThrow("store down")
    })
})

describe("IdentityEmailService.resend", () => {
    it("mails only an unconfirmed password account", async () => {
        const entityManager = mockEntityManager({
            query: [USER_BY_EMAIL, [account("unconfirmed")]],
            insert: [IdentityEmailTokenEntity, {}],
            update: [IdentityEmailTokenEntity, {}],
        })
        fakeTransaction(entityManager)
        const { subject, mailer } = await build(entityManager)
        await subject.resend("a@example.test")
        expect(mailer.send).toHaveBeenCalledTimes(1)

        for (const rows of [[], [account()], [account("invited")]]) {
            const other = await build(mockEntityManager({ query: [USER_BY_EMAIL, rows] }))
            await other.subject.resend("a@example.test")
            expect(other.mailer.send).not.toHaveBeenCalled()
        }
    })
})

describe("IdentityEmailService.confirm", () => {
    it("spends a live link and stamps the confirmation through the door", async () => {
        const entityManager = mockEntityManager({
            findOne: [IdentityEmailTokenEntity, tokenRow("confirm")],
            update: [IdentityEmailTokenEntity, {}],
            query: [CONFIRM_USER, []],
        })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        await subject.confirm("the-token-of-the-link")

        expect(entityManager.findOne).toHaveBeenCalledWith(
            IdentityEmailTokenEntity,
            expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
        )
        expect(entityManager.query).toHaveBeenCalledWith(CONFIRM_USER, ["u-1", NOW])
    })

    it("refuses an unknown, spent or expired link with the reset-token code", async () => {
        const entityManager = mockEntityManager({ findOne: [IdentityEmailTokenEntity, null] })
        fakeTransaction(entityManager)
        const { subject } = await build(entityManager)

        await expect(subject.confirm("nothing")).rejects.toEqual(refusal(IdentityErrorCode.ResetTokenInvalid))
    })
})

describe("IdentityEmailService.forgot", () => {
    it("mails a reset link to a live account and to nobody else, with the same answer", async () => {
        const entityManager = mockEntityManager({
            query: [USER_BY_EMAIL, [account()]],
            insert: [IdentityEmailTokenEntity, {}],
            update: [IdentityEmailTokenEntity, {}],
        })
        fakeTransaction(entityManager)
        const known = await build(entityManager)
        await known.subject.forgot("a@example.test", "vi")
        expect(known.budget.admit).toHaveBeenCalledWith("reset", "a@example.test")
        expect(known.mailer.send.mock.calls[0]?.[0].message.text).toContain(
            "https://app.example.test/auth/reset?token=",
        )
        await known.subject.forgot("a@example.test")
        expect(known.mailer.send).toHaveBeenCalledTimes(2)

        for (const rows of [[], [account("disabled")]]) {
            const other = await build(mockEntityManager({ query: [USER_BY_EMAIL, rows] }))
            await expect(other.subject.forgot("a@example.test")).resolves.toBeUndefined()
            expect(other.mailer.send).not.toHaveBeenCalled()
        }
    })
})

describe("IdentityEmailService.reset", () => {
    it("sets the new password and confirms the mailbox its link proved through the door, then ends every session of the person", async () => {
        const entityManager = mockEntityManager({
            findOne: [IdentityEmailTokenEntity, tokenRow("reset")],
            update: [IdentityEmailTokenEntity, {}],
            query: [SET_PASSWORD, []],
        })
        fakeTransaction(entityManager)
        const { subject, sessions } = await build(entityManager)

        await subject.reset("the-token-of-the-link", "a better password")

        expect(entityManager.query).toHaveBeenCalledWith(SET_PASSWORD, ["u-1", "new-hash", true, NOW])
        expect(sessions.closeOtherSessions).toHaveBeenCalledWith("u-1", "00000000-0000-0000-0000-000000000000")
    })

    it("refuses a weak password and a link that is not live", async () => {
        const weak = await build(mockEntityManager())
        await expect(weak.subject.reset("t", "short")).rejects.toEqual(refusal(IdentityErrorCode.PasswordInvalid))

        const entityManager = mockEntityManager({ findOne: [IdentityEmailTokenEntity, null] })
        fakeTransaction(entityManager)
        const dead = await build(entityManager)
        await expect(dead.subject.reset("t", "a better password")).rejects.toBeInstanceOf(IdentityError)
    })
})

describe("IdentityEmailService language", () => {
    it("writes the mail in the language the request names, and in the default one when it names none the mails are written in", async () => {
        const subjectFor = async (language?: string): Promise<string | undefined> => {
            const entityManager = mockEntityManager({
                query: [
                    [USER_BY_EMAIL, []],
                    [CREATE_USER, [{ be_auth_create_user: NEW_ID }]],
                ],
                insert: [IdentityEmailTokenEntity, {}],
                update: [IdentityEmailTokenEntity, {}],
            })
            fakeTransaction(entityManager)
            const { subject, mailer } = await build(entityManager)
            await subject.signup("a@example.test", "correct horse", language)
            return mailer.send.mock.calls[0]?.[0].message.subject
        }
        const english = await subjectFor("en")
        expect(await subjectFor("vi")).not.toBe(english)
        expect(await subjectFor("xx")).toBe(english)
        expect(await subjectFor()).toBe(english)
    })
})
