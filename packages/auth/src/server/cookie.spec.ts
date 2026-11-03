import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { CookieWrite, HttpResponse } from "./http.ts"
import { RefreshCookie } from "./cookie.ts"
import type { SessionTokens } from "./ports.ts"

const tokens: SessionTokens = {
    accessToken: "a",
    accessExpiresAt: "2026-01-01T00:15:00.000Z",
    accessExpiresIn: 900,
    cookieToken: "refresh-value",
    refreshMaxAgeSeconds: 100,
    user: { id: "u", email: "e@example.test" },
}

const recorder = () => {
    const calls: { kind: "set" | "clear"; name: string; value?: string; options: Partial<CookieWrite> }[] = []
    const response: HttpResponse = {
        cookie: (name, value, options) => calls.push({ kind: "set", name, value, options }),
        clearCookie: (name, options) => calls.push({ kind: "clear", name, options }),
        once: () => undefined,
    }
    return { calls, response }
}

describe("RefreshCookie flags", () => {
    it("writes httpOnly, Secure, SameSite=Lax on the root path with the lifetime of the session, and clears the legacy path first", () => {
        const { calls, response } = recorder()
        new RefreshCookie({ name: "app_refresh" }).issue(response, tokens)
        assert.deepEqual(calls, [
            { kind: "clear", name: "app_refresh", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/auth" } },
            { kind: "set", name: "app_refresh", value: "refresh-value", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 100_000 } },
        ])
    })

    it("carries the configured domain, path, legacy paths and SameSite on every write and clear", () => {
        const { calls, response } = recorder()
        const cookie = new RefreshCookie({ name: "r", domain: "example.test", path: "/auth/refresh", legacyPaths: ["/", "/old"], sameSite: "strict" })
        cookie.issue(response, tokens)
        cookie.clear(response)
        assert.equal(calls.length, 2 + 1 + 3)
        for (const call of calls) {
            assert.equal(call.options.httpOnly, true)
            assert.equal(call.options.secure, true)
            assert.equal(call.options.sameSite, "strict")
            assert.equal(call.options.domain, "example.test")
        }
        assert.deepEqual(calls.filter((call) => call.kind === "clear").map((call) => call.options.path), ["/", "/old", "/auth/refresh", "/", "/old"])
        assert.equal(calls.find((call) => call.kind === "set")?.options.path, "/auth/refresh")
    })

    it("clears the root path and the legacy path", () => {
        const { calls, response } = recorder()
        new RefreshCookie({ name: "r" }).clear(response)
        assert.deepEqual(calls.map((call) => call.options.path), ["/", "/auth"])
    })
})

describe("RefreshCookie reading", () => {
    const cookie = new RefreshCookie({ name: "r" })

    it("reads its own cookie from a Cookie header, even one of several or a repeated header", () => {
        assert.equal(cookie.read({ headers: { cookie: "a=1; r=token-1; b=2" } }), "token-1")
        assert.equal(cookie.read({ headers: { cookie: ["a=1", "r=token-2"] } }), "token-2")
        assert.equal(cookie.read({ headers: { cookie: "other=1" } }), "")
        assert.equal(cookie.read({ headers: {} }), "")
    })

    it("bounds the user agent and reports the caller address", () => {
        assert.deepEqual(cookie.deviceOf({ headers: { "user-agent": "x".repeat(900) }, ip: "198.51.100.1" }), { userAgent: "x".repeat(512), ip: "198.51.100.1" })
        assert.deepEqual(cookie.deviceOf({ headers: {} }), { userAgent: null, ip: null })
        assert.equal(cookie.deviceOf({ headers: { "user-agent": ["first", "second"] } }).userAgent, "first")
    })
})
