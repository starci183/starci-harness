import { Test } from "@nestjs/testing"
import type { Response } from "express"
import { mock } from "@starci/jest-preset"
import { clearRefreshCookie, newRefreshToken, refreshTokenHash, setRefreshCookie } from "./passport.cookie"

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
})
