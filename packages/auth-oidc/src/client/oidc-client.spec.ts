import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AuthOutcome } from "@starci/auth/contracts"
import { OIDC_CLIENT_CODES } from "../contracts/index.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import type { FakeTokenClaims } from "../testing/index.ts"
import { createOidcClient } from "./oidc-client.ts"
import type { OidcAuthClient, OidcClientOptions, OidcEvent, OidcStorage } from "./oidc-client.ts"
import { challengeOf, claimsOf, randomText, sameSitePath } from "./pkce.ts"

const REDIRECT = "https://app.example.test/callback"
const LOGOUT = "https://app.example.test/signed-out"

interface World {
    readonly issuer: FakeOidcIssuer
    readonly client: OidcAuthClient
    readonly navigations: string[]
    readonly storage: Map<string, string>
    readonly sleeps: number[]
    readonly clock: FakeClock
    readonly calls: () => string[]
    readonly bend: { current: ((url: string, init?: RequestInit) => Response | undefined) | undefined }
}

const mapStorage = (held: Map<string, string>): OidcStorage => ({
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
        held.set(key, value)
    },
    removeItem: (key) => {
        held.delete(key)
    },
})

const setup = async (overrides: Partial<OidcClientOptions> = {}, claims: FakeTokenClaims = { sub: "user-1", email: "a@example.test" }): Promise<World & { readonly claims: FakeTokenClaims }> => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, accessTtlSeconds: 300 })
    const navigations: string[] = []
    const storage = new Map<string, string>()
    const sleeps: number[] = []
    const seen: string[] = []
    const bend: World["bend"] = { current: undefined }
    const client = createOidcClient({
        issuer: issuer.issuer,
        clientId: "test-client",
        redirectUri: REDIRECT,
        postLogoutRedirectUri: LOGOUT,
        fetch: async (input, init) => {
            seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
            return bend.current?.(url, init) ?? issuer.fetch(input, init)
        },
        storage: mapStorage(storage),
        navigate: (url) => navigations.push(url),
        now: () => clock.now().getTime(),
        sleep: (ms) => {
            sleeps.push(ms)
            return Promise.resolve()
        },
        ...overrides,
    })
    return { issuer, client, navigations, storage, sleeps, clock, claims, calls: () => seen, bend }
}

/** Plays the whole redirect: sign in, the provider's page, the callback. */
const signedIn = async (world: World & { readonly claims: FakeTokenClaims }, returnTo = "/inbox"): Promise<void> => {
    await world.client.signIn({ returnTo })
    const callback = world.issuer.authorize(world.navigations.at(-1) ?? "", world.claims)
    const outcome = await world.client.completeSignIn(callback)
    assert.equal(outcome.success, true)
}

const tokenCalls = (world: World): number => world.issuer.count("/protocol/openid-connect/token")

describe("PKCE helpers", () => {
    it("makes 43-character URL-safe random text and the S256 challenge of RFC 7636", async () => {
        assert.match(randomText(), /^[A-Za-z0-9_-]{43}$/u)
        assert.notEqual(randomText(), randomText())
        assert.equal(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    })

    it("reads the claims of a token without trusting it and survives text that is not a token", () => {
        const payload = Buffer.from(JSON.stringify({ sub: "ünï", n: 1 })).toString("base64url")
        assert.deepEqual(claimsOf(`h.${payload}.s`), { sub: "ünï", n: 1 })
        for (const junk of ["", "a", "a.!!!.c", `a.${Buffer.from("[1]").toString("base64url")}.c`]) assert.deepEqual(claimsOf(junk), {})
    })

    it("keeps a return address on the site", () => {
        assert.equal(sameSitePath("/a/b?x=1", "/"), "/a/b?x=1")
        for (const outside of ["//evil.test", "https://evil.test", "/\\evil", "/a\nb", undefined, 3]) assert.equal(sameSitePath(outside, "/"), "/")
    })
})

describe("signIn: the redirect to the provider", () => {
    it("goes to the authorization endpoint with the exact registration, S256, a state and a nonce, and keeps the transaction in storage", async () => {
        const world = await setup()
        assert.deepEqual(await world.client.signIn({ returnTo: "/inbox" }), { success: true, message: "ok", data: true })
        const url = new URL(world.navigations[0] ?? "")
        assert.equal(url.origin + url.pathname, `${world.issuer.issuer}/protocol/openid-connect/auth`)
        const query = Object.fromEntries(url.searchParams)
        assert.deepEqual({ ...query, state: "-", nonce: "-", code_challenge: "-" }, {
            response_type: "code",
            client_id: "test-client",
            redirect_uri: REDIRECT,
            scope: "openid",
            state: "-",
            nonce: "-",
            code_challenge: "-",
            code_challenge_method: "S256",
        })
        const stored = JSON.parse(world.storage.get(`starci.oidc.tx.${query.state ?? ""}`) ?? "{}") as { verifier: string; nonce: string; returnTo: string }
        assert.equal(await challengeOf(stored.verifier), query.code_challenge)
        assert.equal(stored.nonce, query.nonce)
        assert.equal(stored.returnTo, "/inbox")
        assert.equal(world.client.peek(), undefined)
    })

    it("never takes a return address off the site, reads function-valued settings, and passes the prompt and scope through", async () => {
        const issuer = await FakeOidcIssuer.create()
        const gone: string[] = []
        const held = new Map<string, string>()
        const client = createOidcClient({ issuer: () => issuer.issuer, clientId: "test-client", redirectUri: () => REDIRECT, scope: "openid email", fetch: issuer.fetch, storage: mapStorage(held), navigate: (url) => gone.push(url) })
        await client.signIn({ returnTo: "https://evil.test", prompt: "login" })
        const url = new URL(gone[0] ?? "")
        assert.equal(url.searchParams.get("prompt"), "login")
        assert.equal(url.searchParams.get("scope"), "openid email")
        assert.equal(url.searchParams.get("redirect_uri"), REDIRECT)
        const [stored] = [...held.values()]
        assert.equal((JSON.parse(stored ?? "{}") as { returnTo: string }).returnTo, "/")
    })

    it("answers unavailable, without navigating, when the provider cannot be reached or its document is wrong", async () => {
        const world = await setup()
        world.issuer.setDown(true)
        assert.deepEqual(await world.client.signIn(), { success: false, message: "unavailable", error: OIDC_CLIENT_CODES.Transport })
        assert.deepEqual(world.navigations, [])
        world.issuer.setDown(false)
        assert.equal((await world.client.signIn()).success, true)
        const wrong = await setup({ issuer: "https://other.example.test/realms/x", fetch: () => Promise.resolve(Response.json({ issuer: "https://elsewhere.test" })) })
        assert.equal((await wrong.client.signIn()).success, false)
    })
})

describe("completeSignIn: the callback", () => {
    it("exchanges the code once, keeps the grant in memory only and answers the person and where to go", async () => {
        const world = await setup()
        await world.client.signIn({ returnTo: "/inbox" })
        const callback = world.issuer.authorize(world.navigations[0] ?? "", { sub: "user-1", email: "a@example.test" })
        const events: [OidcEvent, string | null][] = []
        world.client.subscribe((event, id) => events.push([event, id]))
        const outcome = await world.client.completeSignIn(callback)
        assert.deepEqual(outcome, { success: true, message: "ok", data: { user: { id: "user-1", email: "a@example.test" }, returnTo: "/inbox" } })
        assert.ok(world.client.peek())
        assert.deepEqual(world.client.getSnapshot(), { status: "signed-in", user: { id: "user-1", email: "a@example.test" } })
        assert.ok(events.some(([event, id]) => event === "SIGNED_IN" && id === "user-1"))
        assert.deepEqual([...world.storage.keys()], ["starci.oidc.hint"])
        for (const value of world.storage.values()) assert.doesNotMatch(value, /eyJ/u)
        assert.equal(tokenCalls(world), 1)
        // The transaction is spent: the same callback is refused.
        assert.deepEqual(await world.client.completeSignIn(callback), { success: false, message: "invalid", error: OIDC_CLIENT_CODES.State })
    })

    it("refuses a callback whose state it never issued, or whose transaction has expired", async () => {
        const world = await setup()
        assert.equal((await world.client.completeSignIn(`${REDIRECT}?code=c&state=forged`)).success, false)
        assert.equal((await world.client.completeSignIn(`${REDIRECT}?code=c`)).success, false)
        await world.client.signIn()
        const callback = world.issuer.authorize(world.navigations[0] ?? "")
        world.clock.advance(601_000)
        assert.deepEqual(await world.client.completeSignIn(callback), { success: false, message: "invalid", error: OIDC_CLIENT_CODES.State })
        assert.equal(tokenCalls(world), 0)
    })

    it("refuses a callback from another issuer and a callback without a code", async () => {
        const world = await setup()
        await world.client.signIn()
        const callback = new URL(world.issuer.authorize(world.navigations[0] ?? ""))
        callback.searchParams.set("iss", "https://evil.example.test/realms/test")
        assert.deepEqual(await world.client.completeSignIn(callback.toString()), { success: false, message: "invalid", error: OIDC_CLIENT_CODES.Issuer })
        await world.client.signIn()
        const bare = new URL(world.issuer.authorize(world.navigations[1] ?? ""))
        bare.searchParams.delete("code")
        assert.deepEqual(await world.client.completeSignIn(bare.toString()), { success: false, message: "invalid", error: OIDC_CLIENT_CODES.Token })
    })

    it("refuses an ID token whose nonce is not the one it sent", async () => {
        const world = await setup()
        await world.client.signIn()
        const [key] = [...world.storage.keys()]
        const stored = JSON.parse(world.storage.get(key ?? "") ?? "{}") as Record<string, unknown>
        world.storage.set(key ?? "", JSON.stringify({ ...stored, nonce: "another" }))
        const outcome = await world.client.completeSignIn(world.issuer.authorize(world.navigations[0] ?? ""))
        assert.deepEqual(outcome, { success: false, message: "invalid", error: OIDC_CLIENT_CODES.Nonce })
        assert.equal(world.client.peek(), undefined)
    })

    it("answers the provider's refusal as a refusal, and forgets the sign-in hint after a silent attempt found no session", async () => {
        const world = await setup()
        world.storage.set("starci.oidc.hint", "1")
        await world.client.signIn({ prompt: "none" })
        const state = new URL(world.navigations[0] ?? "").searchParams.get("state")
        const outcome = await world.client.completeSignIn(`${REDIRECT}?error=login_required&state=${state ?? ""}`)
        assert.deepEqual(outcome, { success: false, message: "refused", error: "login_required" })
        assert.equal(world.storage.has("starci.oidc.hint"), false)
        assert.equal(world.client.getSnapshot().status, "signed-out")
    })

    it("answers a token endpoint failure as refused, or unavailable for a server error", async () => {
        const world = await setup()
        await world.client.signIn()
        const callback = world.issuer.authorize(world.navigations[0] ?? "")
        world.issuer.failNext({ status: 502 })
        // The discovery of signIn is cached, so the failure lands on the token request.
        assert.deepEqual(await world.client.completeSignIn(callback), { success: false, message: "unavailable", error: OIDC_CLIENT_CODES.Transport })
        await world.client.signIn()
        const rejected = `${REDIRECT}?code=bogus&state=${new URL(world.navigations[1] ?? "").searchParams.get("state") ?? ""}`
        assert.deepEqual(await world.client.completeSignIn(rejected), { success: false, message: "refused", error: OIDC_CLIENT_CODES.Provider })
        await world.client.signIn()
        const network = world.issuer.authorize(world.navigations[2] ?? "")
        world.issuer.failNext("network")
        assert.deepEqual(await world.client.completeSignIn(network), { success: false, message: "unavailable", error: OIDC_CLIENT_CODES.Transport })
    })

    it("fits the shape of AuthOutcome of @starci/auth", async () => {
        const world = await setup()
        const outcome: AuthOutcome<true> = await world.client.signIn()
        assert.equal(outcome.success, true)
    })
})

describe("refresh: one refresh, ahead of expiry, and sign-out only when the provider ends the session", () => {
    it("shares one refresh between overlapping callers", async () => {
        const world = await setup()
        await signedIn(world)
        const before = tokenCalls(world)
        const results = await Promise.all([world.client.renew(), world.client.renew(), world.client.renew()])
        assert.equal(tokenCalls(world) - before, 1)
        assert.equal(new Set(results).size, 1)
        assert.ok(results[0])
    })

    it("returns the held token while it is fresh and refreshes ahead of its expiry", async () => {
        const world = await setup({ refreshAheadMs: 15_000 })
        await signedIn(world)
        const held = world.client.peek()
        const before = tokenCalls(world)
        assert.equal(await world.client.accessToken(), held)
        assert.equal(tokenCalls(world), before)
        world.clock.advance(290_000)
        const fresh = await world.client.accessToken()
        assert.notEqual(fresh, held)
        assert.equal(tokenCalls(world), before + 1)
        assert.deepEqual(await world.client.headers(), { authorization: `Bearer ${fresh ?? ""}` })
        assert.deepEqual(await world.client.user(), { id: "user-1", email: "a@example.test" })
    })

    it("keeps the session across several refreshes, each presenting the refresh token the previous one rotated in", async () => {
        const world = await setup()
        await signedIn(world)
        await world.client.renew()
        await world.client.renew()
        assert.equal(world.client.getSnapshot().status, "signed-in")
        assert.equal(tokenCalls(world), 3)
    })

    const failures = [
        ["a 401", { status: 401 }],
        ["a 403", { status: 403 }],
    ] as const
    for (const [name, failure] of failures) {
        it(`signs out on ${name} from the token endpoint and forgets the hint`, async () => {
            const world = await setup()
            await signedIn(world)
            world.issuer.failNext(failure)
            const events: OidcEvent[] = []
            world.client.subscribe((event) => events.push(event))
            assert.equal(await world.client.renew(), undefined)
            assert.equal(world.client.getSnapshot().status, "signed-out")
            assert.equal(world.client.peek(), undefined)
            assert.ok(events.includes("SIGNED_OUT"))
            assert.equal(world.storage.has("starci.oidc.hint"), false)
        })
    }

    it("signs out on 400 invalid_grant, the answer of a provider whose refresh token is expired or revoked", async () => {
        const world = await setup()
        await signedIn(world)
        world.issuer.revokeRefreshTokens()
        assert.equal(await world.client.renew(), undefined)
        assert.equal(world.client.getSnapshot().status, "signed-out")
        assert.equal(world.storage.has("starci.oidc.hint"), false)
    })

    it("keeps the session on a 429, a 5xx, a lost connection or a malformed answer, retrying with backoff", async () => {
        const world = await setup({ retryAttempts: 3, retryBaseMs: 100 })
        await signedIn(world)
        world.issuer.failNext({ status: 503 }, 2)
        assert.ok(await world.client.renew())
        assert.deepEqual(world.sleeps, [100, 200])
        assert.equal(world.client.getSnapshot().status, "signed-in")

        world.issuer.failNext({ status: 429 }, 3)
        assert.equal(await world.client.renew(), undefined)
        assert.equal(world.client.getSnapshot().status, "signed-in")
        assert.ok(world.client.peek())

        world.issuer.failNext("network", 3)
        assert.equal(await world.client.renew(), undefined)
        assert.equal(world.client.getSnapshot().status, "signed-in")
        world.issuer.failNext({ status: 400 })
        assert.equal(await world.client.renew(), undefined)
        assert.equal(world.client.getSnapshot().status, "signed-in")
        assert.ok(await world.client.renew())
    })

    it("treats a signed-out browser as signed out at the first question, without asking the provider for a token", async () => {
        const world = await setup()
        assert.equal(await world.client.accessToken(), undefined)
        assert.equal(tokenCalls(world), 0)
        assert.deepEqual(await world.client.headers(), {})
        assert.equal(await world.client.user(), null)
        assert.equal(world.client.getSnapshot().status, "signed-out")
    })

    it("answers a refresh that returns a grant of the wrong shape with nothing, leaving the session", async () => {
        const world = await setup()
        await signedIn(world)
        world.bend.current = (url, init) => (url.endsWith("/token") && typeof init?.body === "string" && init.body.includes("refresh_token") ? Response.json({ nope: true }) : undefined)
        assert.equal(await world.client.renew(), undefined)
        assert.equal(world.client.getSnapshot().status, "signed-in")
    })
})

describe("snapshots, subscribers and watchers", () => {
    it("is loading on the server, and loading until the first answer in the browser", async () => {
        const world = await setup()
        assert.equal(world.client.getServerSnapshot().status, "loading")
        assert.equal(world.client.getSnapshot().status, "loading")
    })

    it("tells a subscriber the initial session: signed out when nothing is held, signed in when a session exists", async () => {
        const out = await setup()
        const heard: [OidcEvent, string | null][] = []
        out.client.subscribe((event, id) => heard.push([event, id]))
        await out.client.renew()
        await new Promise((resolve) => setImmediate(resolve))
        assert.deepEqual(heard, [["INITIAL_SESSION", null]])

        const inn = await setup()
        await signedIn(inn)
        const later: [OidcEvent, string | null][] = []
        const stop = inn.client.subscribe((event, id) => later.push([event, id]))
        assert.deepEqual(later, [["INITIAL_SESSION", "user-1"]])
        stop()
        await inn.client.renew()
        assert.equal(later.length, 1)
    })

    it("wakes a watcher on every change of the snapshot, and only then", async () => {
        const world = await setup()
        let wakes = 0
        const stop = world.client.watch(() => {
            wakes += 1
        })
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(wakes, 1)
        await signedIn(world)
        assert.equal(wakes, 2)
        await world.client.renew()
        assert.equal(wakes, 2)
        stop()
        world.client.drop()
        assert.equal(wakes, 2)
    })
})

describe("restore: signing in again after a reload", () => {
    it("redirects once without a page when this browser signed in before and holds no session now", async () => {
        const world = await setup()
        world.storage.set("starci.oidc.hint", "1")
        assert.deepEqual(await world.client.restore(), { success: true, message: "ok", data: "redirected" })
        assert.equal(new URL(world.navigations[0] ?? "").searchParams.get("prompt"), "none")
        assert.deepEqual(await world.client.restore(), { success: true, message: "ok", data: "skipped" })
        assert.equal(world.navigations.length, 1)
    })

    it("skips when there is no hint or a session is held", async () => {
        const world = await setup()
        assert.deepEqual(await world.client.restore(), { success: true, message: "ok", data: "skipped" })
        assert.equal(world.navigations.length, 0)
        await signedIn(world)
        world.storage.set("starci.oidc.hint", "1")
        assert.deepEqual(await world.client.restore(), { success: true, message: "ok", data: "skipped" })
    })

    it("lets a later attempt run when the redirect could not start", async () => {
        const world = await setup()
        world.storage.set("starci.oidc.hint", "1")
        world.issuer.setDown(true)
        assert.equal((await world.client.restore()).success, false)
        world.issuer.setDown(false)
        assert.deepEqual(await world.client.restore(), { success: true, message: "ok", data: "redirected" })
    })
})

describe("signOut", () => {
    it("forgets the session and takes the browser to the provider's logout address with the hint and the registered return", async () => {
        const world = await setup()
        await signedIn(world)
        await world.client.signOut()
        assert.equal(world.client.peek(), undefined)
        assert.equal(world.client.getSnapshot().status, "signed-out")
        assert.equal(world.storage.has("starci.oidc.hint"), false)
        const url = new URL(world.navigations.at(-1) ?? "")
        assert.equal(url.origin + url.pathname, `${world.issuer.issuer}/protocol/openid-connect/logout`)
        assert.equal(url.searchParams.get("client_id"), "test-client")
        assert.equal(url.searchParams.get("post_logout_redirect_uri"), LOGOUT)
        assert.match(url.searchParams.get("id_token_hint") ?? "", /^eyJ/u)
    })

    it("still forgets the session when the provider cannot be reached, and when no return address is registered", async () => {
        const down = await setup()
        down.issuer.setDown(true)
        await down.client.signOut()
        assert.equal(down.client.getSnapshot().status, "signed-out")
        assert.deepEqual(down.navigations, [])

        const quiet = await setup({ postLogoutRedirectUri: undefined })
        await signedIn(quiet)
        const count = quiet.navigations.length
        await quiet.client.signOut()
        assert.equal(quiet.client.peek(), undefined)
        assert.equal(quiet.navigations.length, count)
    })
})

describe("platform defaults", () => {
    it("uses memory when the platform has no session storage and does nothing when it has no location", async () => {
        const issuer = await FakeOidcIssuer.create()
        const client = createOidcClient({ issuer: issuer.issuer, clientId: "test-client", redirectUri: REDIRECT, fetch: issuer.fetch })
        assert.equal((await client.signIn({ returnTo: "/x" })).success, true)
        assert.equal(client.getSnapshot().status, "loading")
    })

    it("uses the sessionStorage and location of the platform when it has them", async () => {
        const issuer = await FakeOidcIssuer.create()
        const held = new Map<string, string>()
        const gone: string[] = []
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: mapStorage(held) })
        Object.defineProperty(globalThis, "location", { configurable: true, value: { assign: (url: string) => gone.push(url), pathname: "/here" } })
        try {
            const client = createOidcClient({ issuer: issuer.issuer, clientId: "test-client", redirectUri: REDIRECT, fetch: issuer.fetch })
            await client.signIn()
            assert.equal(gone.length, 1)
            assert.equal(held.size, 1)
            held.set("starci.oidc.hint", "1")
            await client.restore()
            const transactions = [...held].filter(([key]) => key.startsWith("starci.oidc.tx."))
            assert.equal((JSON.parse(transactions[1]?.[1] ?? "{}") as { returnTo?: string }).returnTo, "/here")
        } finally {
            Reflect.deleteProperty(globalThis, "sessionStorage")
            Reflect.deleteProperty(globalThis, "location")
        }
    })
})
