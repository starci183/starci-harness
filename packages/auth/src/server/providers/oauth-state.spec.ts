import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { describe, it } from "node:test"
import { FakeClock, generateTestKeyPair, sequentialIds, testSigningKey } from "../../testing/index.ts"
import { GOOGLE_STATE_PATH, GOOGLE_STATE_TTL_MS, GoogleStateClient } from "./google.ts"
import { OAUTH_STATE_TTL_MS, OAuthStateClient, oauthStateCookie } from "./oauth-state.ts"
import type { CookieWrite, HttpRequest } from "../http.ts"
import { AuthTokens } from "../tokens.ts"

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

describe("OAuthStateClient (the round trip of any provider)", () => {
    const pair = generateTestKeyPair()
    const options = { returnOrigin: "https://app.example.test", google: null }
    const res = (written: { name: string; value: string; options: CookieWrite }[]) => ({
        cookie: (name: string, value: string, cookieOptions: CookieWrite) => written.push({ name, value, options: cookieOptions }),
        clearCookie: () => undefined,
        once: () => undefined,
    })

    it("writes Google's cookie exactly as 0.5.0 did: base64url of {w,u,r,e,p} and the HMAC under the key derived from the signing key", () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens({ issuer: "i", keys: [testSigningKey(pair)], accessTtlSeconds: 60 })
        const written: { name: string; value: string; options: CookieWrite }[] = []
        new GoogleStateClient({ tokens, clock, ids: { next: () => "handle-1" }, options }).store({ headers: {}, query: { next: "/inbox" }, res: res(written) }, "verifier-1", undefined, undefined, () => undefined)
        const body = Buffer.from(JSON.stringify({ w: "handle-1", u: "verifier-1", r: "/inbox", e: clock.now().getTime() + 600_000, p: "google" })).toString("base64url")
        const key = createHmac("sha256", createHash("sha256").update(pair.privateKey, "utf8").digest()).update("passport.google-state").digest()
        const cookie = must(written[0])
        assert.equal(cookie.value, `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`)
        assert.deepEqual([cookie.name, cookie.options], ["auth_google_state", { httpOnly: true, secure: true, sameSite: "lax", path: "/auth/google", maxAge: 600_000 }])
        assert.equal(OAUTH_STATE_TTL_MS, GOOGLE_STATE_TTL_MS)
    })

    it("keeps each provider's round trip under its own cookie, path and purpose, so one provider's state never passes another's callback", () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens({ issuer: "i", keys: [testSigningKey(pair)], accessTtlSeconds: 60 })
        const github = new OAuthStateClient({ tokens, clock, ids: sequentialIds("gh"), state: { provider: "github", cookie: oauthStateCookie("github"), path: "/auth/github", returnOrigin: "https://app.example.test" } })
        const googleState = new GoogleStateClient({ tokens, clock, ids: sequentialIds("g"), options })
        assert.deepEqual([github.provider, github.cookieName, googleState.provider, googleState.cookieName], ["github", "auth_github_state", "google", "auth_google_state"])
        const written: { name: string; value: string; options: CookieWrite }[] = []
        let handle = ""
        github.store({ headers: {}, query: { returnTo: "https://evil.test/x" }, res: res(written) }, "pkce", undefined, undefined, (_error, issued) => {
            handle = issued ?? ""
        })
        const cookie = must(written[0])
        assert.deepEqual([cookie.name, cookie.options.path], ["auth_github_state", "/auth/github"])
        const results: unknown[] = []
        github.verify({ headers: { cookie: `auth_github_state=${cookie.value}` } }, handle, undefined, (_error, verifier, context) => results.push([verifier, context]))
        googleState.verify({ headers: { cookie: `auth_google_state=${cookie.value}` } }, handle, undefined, (_error, verifier) => results.push(verifier))
        assert.deepEqual(results, [["pkce", { next: "/" }], false])
    })
})
