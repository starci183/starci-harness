import { Test } from "@nestjs/testing"
import type { Request, Response } from "express"
import { mock } from "@starci/jest-preset"
import { clearRefreshCookie, newRefreshToken, refreshTokenHash, setRefreshCookie } from "./passport.cookie"
import { CookieStateStore } from "./strategies/oauth-state.store"

const COOKIE: unique symbol = Symbol("passport.cookie")

const OPTIONS = { name: "refresh", path: "/auth/refresh", ttlSeconds: 600 }

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: COOKIE, useValue: { clearRefreshCookie, newRefreshToken, refreshTokenHash, setRefreshCookie } }],
    }).compile()
    return moduleRef.get<{
        clearRefreshCookie: typeof clearRefreshCookie
        newRefreshToken: typeof newRefreshToken
        refreshTokenHash: typeof refreshTokenHash
        setRefreshCookie: typeof setRefreshCookie
    }>(COOKIE)
}

describe("refresh tokens", () => {
    it("stores the sha256 of a token, never the token", async () => {
        const subject = await build()

        expect(subject.refreshTokenHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    })

    it("mints a 256-bit base64url token paired with its own hash", async () => {
        const subject = await build()
        const minted = subject.newRefreshToken()

        expect(Buffer.from(minted.token, "base64url")).toHaveLength(32)
        expect(minted.hash).toBe(subject.refreshTokenHash(minted.token))
        expect(subject.newRefreshToken().token).not.toBe(minted.token)
    })
})

describe("refresh cookie", () => {
    it("sets the rotated token httpOnly, Secure, SameSite=Strict on the refresh path for its lifetime", async () => {
        const subject = await build()
        const response = mock<Response>()

        subject.setRefreshCookie(response, OPTIONS, "token-1")

        expect(response.cookie).toHaveBeenCalledWith("refresh", "token-1", { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/refresh", maxAge: 600_000 })
    })

    it("clears the cookie with the attributes it was set with", async () => {
        const subject = await build()
        const response = mock<Response>()

        subject.clearRefreshCookie(response, OPTIONS)

        expect(response.clearCookie).toHaveBeenCalledWith("refresh", { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/refresh" })
    })

    it("stays host-only: no Domain attribute is set or cleared when no cookie domain is configured", async () => {
        const subject = await build()
        const response = mock<Response>()

        subject.setRefreshCookie(response, OPTIONS, "token-1")
        subject.clearRefreshCookie(response, OPTIONS)

        expect(response.cookie).toHaveBeenCalledWith("refresh", "token-1", expect.not.objectContaining({ domain: expect.anything() }))
        expect(response.clearCookie).toHaveBeenCalledWith("refresh", expect.not.objectContaining({ domain: expect.anything() }))
    })

    it("sets the rotated token with Domain=<cookieDomain> so a sibling host can forward it", async () => {
        const subject = await build()
        const response = mock<Response>()

        subject.setRefreshCookie(response, { ...OPTIONS, cookieDomain: "example.com" }, "token-1")

        expect(response.cookie).toHaveBeenCalledWith("refresh", "token-1", { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/refresh", domain: "example.com", maxAge: 600_000 })
    })

    it("clears the cookie with the same Domain it was set with, or the browser keeps it", async () => {
        const subject = await build()
        const response = mock<Response>()

        subject.clearRefreshCookie(response, { ...OPTIONS, cookieDomain: "example.com" })

        expect(response.clearCookie).toHaveBeenCalledWith("refresh", { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/refresh", domain: "example.com" })
    })
})

describe("oauth state cookie", () => {
    const request = (response: Response): Request => ({ res: response, headers: {} }) as unknown as Request

    it("is host-only without a cookie domain and carries Domain=<cookieDomain> with one, on set and on clear", () => {
        const hostOnly = mock<Response>()
        const shared = mock<Response>()

        new CookieStateStore("/auth/google/callback").store(request(hostOnly), "verifier", undefined, undefined, () => undefined)
        new CookieStateStore("/auth/google/callback", "example.com").store(request(shared), "verifier", undefined, undefined, () => undefined)
        new CookieStateStore("/auth/google/callback", "example.com").verify(request(shared), "state", () => undefined)

        expect(hostOnly.cookie).toHaveBeenCalledWith("oauth_state", expect.stringMatching(/^[A-Za-z0-9_-]{32}[.]verifier$/), expect.not.objectContaining({ domain: expect.anything() }))
        expect(shared.cookie).toHaveBeenCalledWith("oauth_state", expect.stringMatching(/^[A-Za-z0-9_-]{32}[.]verifier$/), expect.objectContaining({ domain: "example.com" }))
        expect(shared.clearCookie).toHaveBeenCalledWith("oauth_state", expect.objectContaining({ domain: "example.com" }))
    })
})
