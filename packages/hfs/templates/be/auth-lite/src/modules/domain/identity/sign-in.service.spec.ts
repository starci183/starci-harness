// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { AuthError, PassportError, PassportErrorCode } from "@modules/integrations/passport"
import type { AccessGrant, AuthDoors, AuthSessions, GoogleRedirect, HttpExchange } from "@modules/integrations/passport"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { IDENTITY_AUTH_DOORS, IDENTITY_AUTH_SESSIONS } from "./identity.decorators"
import { IdentitySignInService } from "./sign-in.service"

const GRANT: AccessGrant = { accessToken: "token", expiresIn: 900, expiresAt: "2026-02-03T04:20:06.000Z", user: { id: "u-1", email: "a@example.test" } }
const REDIRECT: GoogleRedirect = { url: "https://app.example.test/", statusCode: 303 }
const EXCHANGE = mock<HttpExchange>()

const build = async () => {
    const doors = mock<AuthDoors>()
    const sessions = mock<AuthSessions>()
    const moduleRef = await Test.createTestingModule({
        providers: [IdentitySignInService, { provide: IDENTITY_AUTH_DOORS, useValue: doors }, { provide: IDENTITY_AUTH_SESSIONS, useValue: sessions }],
    }).compile()
    return { subject: moduleRef.get(IdentitySignInService), doors, sessions }
}

describe("IdentitySignInService", () => {
    it("hands each cookie door the exchange and answers what the package answers", async () => {
        const { subject, doors } = await build()
        doors.login.mockResolvedValue(GRANT)
        doors.refresh.mockResolvedValue(GRANT)
        doors.session.mockResolvedValue(GRANT)
        doors.logout.mockResolvedValue()
        doors.beginGoogle.mockResolvedValue()
        doors.completeGoogle.mockResolvedValue(REDIRECT)

        expect(await subject.login(EXCHANGE)).toBe(GRANT)
        expect(await subject.refresh(EXCHANGE)).toBe(GRANT)
        expect(await subject.session(EXCHANGE)).toBe(GRANT)
        await subject.logout(EXCHANGE)
        await subject.beginGoogle(EXCHANGE)
        expect(await subject.completeGoogle(EXCHANGE)).toBe(REDIRECT)

        for (const door of [doors.login, doors.refresh, doors.session, doors.logout, doors.beginGoogle, doors.completeGoogle]) expect(door).toHaveBeenCalledWith(EXCHANGE)
    })

    it("serves the public keys", async () => {
        const { subject, sessions } = await build()
        sessions.jwks.mockResolvedValue({ keys: [] })

        expect(await subject.jwks()).toEqual({ keys: [] })
    })

    it("signs the caller out of every other device, keeping the session of the token", async () => {
        const { subject, sessions } = await build()
        sessions.endOthers.mockResolvedValue()

        await subject.endOthers({ id: "u-1", role: "authenticated", sessionId: "s-1" })

        expect(sessions.endOthers).toHaveBeenCalledWith("u-1", "s-1")
    })

    it("refuses to sign out the other devices of a token that names no session", async () => {
        const { subject, sessions } = await build()
        sessions.endOthers.mockRejectedValue(new AuthError("IDENTITY_UNAUTHENTICATED"))

        await expect(subject.endOthers({ id: "u-1", role: "authenticated" })).rejects.toMatchObject({ code: IdentityErrorCode.Unauthenticated })
        expect(sessions.endOthers).toHaveBeenCalledWith("u-1", undefined)
    })

    it("turns a refusal of the package into the error family that owns its code", async () => {
        const { subject, doors } = await build()
        doors.refresh.mockRejectedValue(new AuthError("IDENTITY_REFRESH_REUSED"))
        doors.login.mockRejectedValue(new AuthError("PASSPORT_GOOGLE_REJECTED"))

        const identity: unknown = await subject.refresh(EXCHANGE).catch((error: unknown) => error)
        const passport: unknown = await subject.login(EXCHANGE).catch((error: unknown) => error)

        expect(identity).toBeInstanceOf(IdentityError)
        expect(identity).toMatchObject({ code: IdentityErrorCode.RefreshReused })
        expect(passport).toBeInstanceOf(PassportError)
        expect(passport).toMatchObject({ code: PassportErrorCode.GoogleRejected })
    })

    it("reads a code neither family names as unauthenticated", async () => {
        const { subject, doors } = await build()
        doors.login.mockRejectedValue(Object.assign(new AuthError("IDENTITY_REFRESH_REUSED"), { code: "NOT_A_CODE" }))

        await expect(subject.login(EXCHANGE)).rejects.toMatchObject({ code: IdentityErrorCode.Unauthenticated })
    })

    it("rethrows a failure that is not a sign-in refusal as it is", async () => {
        const { subject, doors } = await build()
        doors.login.mockRejectedValue(new Error("boom"))

        await expect(subject.login(EXCHANGE)).rejects.toThrow("boom")
    })
})
