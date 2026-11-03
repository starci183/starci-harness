import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { FakeClock, sequentialIds, testSigningKey } from "../testing/index.ts"
import { GOOGLE_STATE_PATH, GOOGLE_STATE_TTL_MS, GoogleStateClient } from "./google-state.ts"
import type { CookieWrite, HttpRequest } from "./http.ts"
import { AuthTokens } from "./tokens.ts"

const must = <T>(value: T | undefined): T => {
    assert.ok(value !== undefined)
    return value
}

interface Written {
    readonly name: string
    readonly value: string
    readonly options: CookieWrite
}

const build = (stateCookie?: string) => {
    const clock = new FakeClock()
    const tokens = new AuthTokens({ issuer: "https://api.example.test", keys: [testSigningKey()], accessTtlSeconds: 60 })
    const options = {
        returnOrigin: "https://app.example.test",
        google: { clientId: "id", clientSecret: "secret", callbackUrl: "https://api.example.test/auth/google/callback", ...(stateCookie === undefined ? {} : { stateCookie }) },
    }
    const state = new GoogleStateClient({ tokens, clock, ids: sequentialIds("h"), options })
    const written: Written[] = []
    const cleared: Written[] = []
    const res = {
        cookie: (name: string, value: string, cookieOptions: CookieWrite) => written.push({ name, value, options: cookieOptions }),
        clearCookie: (name: string, cookieOptions: Omit<CookieWrite, "maxAge">) => cleared.push({ name, value: "", options: cookieOptions }),
        once: () => undefined,
    }
    const request = (query: Record<string, unknown> = {}, cookie?: string): HttpRequest => ({
        headers: cookie === undefined ? {} : { cookie },
        query,
        res,
    })
    const begin = (query?: Record<string, unknown>): { handle: string; cookie: Written } => {
        let handle = ""
        state.store(request(query), "pkce-verifier", undefined, undefined, (error, issued) => {
            assert.equal(error, null)
            handle = issued ?? ""
        })
        return { handle, cookie: must(written.at(-1)) }
    }
    const back = (provided: string, cookie: string | undefined) => {
        let result: { verifier?: unknown; context?: unknown; failed: boolean } = { failed: true }
        state.verify(request({}, cookie), provided, undefined, (error, verifier, context) => {
            assert.equal(error, null)
            result = { verifier, context, failed: verifier === false }
        })
        return result
    }
    return { clock, state, begin, back, cleared }
}

describe("GoogleStateClient (state and PKCE without a server session)", () => {
    it("keeps the handle, the PKCE verifier and the landing path in a signed httpOnly cookie sent only to the Google door", () => {
        const { begin } = build()
        const { handle, cookie } = begin({ next: "/inbox?tab=1" })
        assert.equal(cookie.name, "auth_google_state")
        assert.deepEqual(cookie.options, { httpOnly: true, secure: true, sameSite: "lax", path: GOOGLE_STATE_PATH, maxAge: GOOGLE_STATE_TTL_MS })
        assert.equal(GOOGLE_STATE_PATH, "/auth/google")
        assert.match(handle, /^h-1-/u)
        assert.equal(cookie.value.includes("pkce-verifier"), false, "the verifier is not readable in the cookie value")
    })

    it("hands the PKCE verifier and the landing path back when the cookie and the state belong together, and clears the cookie", () => {
        const { begin, back, cleared } = build("custom_state")
        const { handle, cookie } = begin({ returnTo: "https://app.example.test/billing?x=1" })
        assert.equal(cookie.name, "custom_state")
        const result = back(handle, `custom_state=${cookie.value}`)
        assert.equal(result.verifier, "pkce-verifier")
        assert.deepEqual(result.context, { next: "/billing?x=1" })
        assert.equal(must(cleared[0]).name, "custom_state")
        assert.equal(must(cleared[0]).options.path, "/auth/google")
    })

    it("never lands off the web origin or off the site", () => {
        const { begin, back } = build()
        for (const wanted of ["https://evil.test/steal", "//evil.test", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=1", 7]) {
            const { handle, cookie } = begin({ next: wanted })
            assert.deepEqual(back(handle, `auth_google_state=${cookie.value}`).context, { next: "/" }, String(wanted))
        }
        const { handle, cookie } = begin({})
        assert.deepEqual(back(handle, `auth_google_state=${cookie.value}`).context, { next: "/" })
    })

    it("refuses a missing cookie, a state that is not the handle, a tampered cookie and an expired round trip", () => {
        const { begin, back, clock } = build()
        const { handle, cookie } = begin()
        assert.equal(back(handle, undefined).failed, true)
        assert.equal(back("another-handle", `auth_google_state=${cookie.value}`).failed, true)
        assert.equal(back(handle, `auth_google_state=${cookie.value}x`).failed, true)
        assert.equal(back(handle, "other=1").failed, true)
        clock.advance(GOOGLE_STATE_TTL_MS + 1)
        assert.equal(back(handle, `auth_google_state=${cookie.value}`).failed, true)
    })

    it("refuses a state signed for another purpose", () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens({ issuer: "i", keys: [testSigningKey()], accessTtlSeconds: 60 })
        const state = new GoogleStateClient({ tokens, clock, ids: sequentialIds(), options: { returnOrigin: "https://app.example.test", google: null } })
        const forged = tokens.signState({ w: "h", u: "v", r: "/", e: clock.now().getTime() + 1000, p: "something-else" })
        let verifier: unknown = "unset"
        state.verify({ headers: { cookie: [`${state.cookieName}=${forged}`] } }, "h", undefined, (_error, value) => {
            verifier = value
        })
        assert.equal(verifier, false)
    })
})
