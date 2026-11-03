import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createAuthClient } from "./auth-client.ts"
import type { AuthEvent } from "./auth-client.ts"

const must = <T>(value: T | undefined): T => {
    assert.ok(value !== undefined)
    return value
}

const urlOf = (input: string | URL | Request): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url)

const jwt = (claims: Record<string, unknown>): string =>
    `${Buffer.from('{"alg":"EdDSA"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`

const grant = (id = "user-1", expiresIn = 900) => ({
    accessToken: jwt({ sub: id, email: `${id}@example.test` }),
    expiresIn,
    expiresAt: "2026-01-01T00:15:00.000Z",
    user: { id, email: `${id}@example.test` },
})

type Reply = { status: number; body?: unknown } | Error

const harness = (replies: (call: { url: string; method: string; headers: Record<string, string> }, index: number) => Reply, gate?: Promise<void>) => {
    const calls: { url: string; method: string; headers: Record<string, string>; credentials: string | undefined; body: string | undefined }[] = []
    let nowMs = 1_000_000
    const sleeps: number[] = []
    const fetcher: typeof fetch = async (input, init) => {
        await gate
        const call = {
            url: urlOf(input),
            method: init?.method ?? "GET",
            headers: (init?.headers ?? {}) as Record<string, string>,
            credentials: init?.credentials,
            body: typeof init?.body === "string" ? init.body : undefined,
        }
        calls.push(call)
        const reply = replies(call, calls.length - 1)
        if (reply instanceof Error) throw reply
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status })
    }
    const client = createAuthClient({
        apiOrigin: "https://api.example.test",
        fetch: fetcher,
        now: () => nowMs,
        sleep: (ms) => {
            sleeps.push(ms)
            return Promise.resolve()
        },
    })
    const events: [AuthEvent, string | null][] = []
    return { client, calls, sleeps, events, advance: (ms: number) => (nowMs += ms), listen: () => client.subscribe((event, id) => events.push([event, id])) }
}

const refreshCalls = (calls: { url: string }[]): number => calls.filter((call) => call.url.endsWith("/auth/refresh")).length

describe("AuthClient shared refresh", () => {
    it("answers many overlapping requests for a token with ONE refresh call (the racing refresh)", async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const { client, calls } = harness(() => ({ status: 200, body: grant() }), gate)
        const pending = [client.accessToken(), client.accessToken(), client.renew(), client.headers(), client.user()]
        release()
        const [a, b, c, header, user] = await Promise.all(pending)
        assert.equal(typeof a, "string")
        assert.equal(refreshCalls(calls), 1)
        assert.equal(a, b)
        assert.equal(b, c)
        assert.deepEqual(header, { authorization: `Bearer ${a as string}` })
        assert.deepEqual(user, { id: "user-1", email: "user-1@example.test" })
        await client.renew()
        assert.equal(refreshCalls(calls), 2, "a later call starts a new refresh")
    })

    it("renews with ONE refresh call when two requests are answered 401 at once", async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const { client, calls } = harness(() => ({ status: 200, body: grant() }), gate)
        const pending = [client.renew(), client.renew()]
        release()
        const [a, b] = await Promise.all(pending)
        assert.equal(refreshCalls(calls), 1)
        assert.equal(a, b)
    })

    it("refreshes again after the first refresh finished and the token is about to expire, not before", async () => {
        const { client, calls, advance } = harness(() => ({ status: 200, body: grant("user-1", 100) }))
        await client.accessToken()
        await client.accessToken()
        assert.equal(refreshCalls(calls), 1)
        advance(84_000)
        await client.accessToken()
        assert.equal(refreshCalls(calls), 1, "still fresh 16 seconds before expiry")
        advance(2_000)
        await client.accessToken()
        assert.equal(refreshCalls(calls), 2, "inside the refresh-ahead window")
    })

    it("sends the refresh as a credentialed POST to the contract's door", async () => {
        const { client, calls } = harness(() => ({ status: 200, body: grant() }))
        await client.renew()
        assert.equal(must(calls[0]).url, "https://api.example.test/auth/refresh")
        assert.equal(must(calls[0]).method, "POST")
        assert.equal(must(calls[0]).credentials, "include")
    })
})

describe("AuthClient signs out only on 401 or 403", () => {
    it("forgets the session on 401 and on 403", async () => {
        for (const status of [401, 403]) {
            const { client, events, listen } = harness((_call, index) => (index === 0 ? { status: 200, body: grant() } : { status }))
            listen()
            await client.renew()
            assert.equal(client.getSnapshot().status, "signed-in")
            assert.equal(await client.renew(), undefined)
            assert.equal(client.peek(), undefined)
            assert.deepEqual(client.getSnapshot(), { status: "signed-out", user: null })
            assert.deepEqual(events.map(([event]) => event), ["INITIAL_SESSION", "SIGNED_OUT"])
        }
    })

    it("keeps the session through 429, 500 and a lost connection, retrying with backoff", async () => {
        for (const failure of [{ status: 429 }, { status: 500 }, { status: 503 }, new Error("offline")] as Reply[]) {
            const { client, calls, sleeps } = harness((_call, index) => (index === 0 ? { status: 200, body: grant() } : failure))
            await client.renew()
            const kept = client.peek()
            assert.equal(await client.renew(), undefined)
            assert.equal(client.peek(), kept, "the token is still held")
            assert.equal(client.getSnapshot().status, "signed-in")
            assert.equal(calls.length, 1 + 4, "four tries")
            assert.deepEqual(sleeps, [400, 800, 1200])
        }
    })

    it("recovers when a retry succeeds", async () => {
        const { client, calls } = harness((_call, index) => (index < 2 ? { status: 502 } : { status: 200, body: grant() }))
        assert.ok(await client.renew())
        assert.equal(calls.length, 3)
    })

    it("does not retry a 400, and does not sign out for it either", async () => {
        const { client, calls } = harness((_call, index) => (index === 0 ? { status: 200, body: grant() } : { status: 400 }))
        await client.renew()
        assert.equal(await client.renew(), undefined)
        assert.equal(calls.length, 2)
        assert.equal(client.getSnapshot().status, "signed-in")
    })

    it("waits between retries on its own timer when no sleep is given", async () => {
        let calls = 0
        const client = createAuthClient({
            apiOrigin: "https://api.example.test",
            retryBaseMs: 1,
            fetch: () => {
                calls += 1
                return Promise.resolve(calls === 1 ? new Response(null, { status: 503 }) : new Response(JSON.stringify(grant()), { status: 200 }))
            },
        })
        assert.ok(await client.renew())
        assert.equal(calls, 2)
    })

    it("treats an answer that is no grant as no token without signing out", async () => {
        const { client } = harness(() => ({ status: 200, body: { nope: true } }))
        assert.equal(await client.renew(), undefined)
        assert.equal(client.getSnapshot().status, "loading")
    })
})

describe("AuthClient events and snapshots", () => {
    it("announces the first answer, a sign-in, a renewal and a sign-out in order", async () => {
        const { client, events, listen, calls } = harness((call) =>
            call.url.endsWith("/auth/login") ? { status: 200, body: grant("user-2") } : call.url.endsWith("/auth/logout") ? { status: 204 } : { status: 200, body: grant("user-1", 1) },
        )
        const stop = listen()
        await new Promise((resolve) => setTimeout(resolve, 5))
        await client.renew()
        await client.renew()
        assert.equal(calls.filter((call) => call.url.endsWith("/auth/refresh")).length, 3)
        await client.signOut()
        const person = await client.signIn({ email: "x@example.test", password: "pw" })
        assert.deepEqual(person, { success: true, message: "ok", data: { id: "user-2", email: "user-2@example.test" } })
        stop()
        await client.signOut()
        assert.deepEqual(events, [
            ["INITIAL_SESSION", "user-1"],
            ["TOKEN_REFRESHED", "user-1"],
            ["TOKEN_REFRESHED", "user-1"],
            ["SIGNED_OUT", null],
            ["SIGNED_IN", "user-2"],
        ])
    })

    it("answers INITIAL_SESSION with null when the first refresh finds nobody signed in", async () => {
        const { events, listen } = harness(() => ({ status: 401 }))
        listen()
        await new Promise((resolve) => setTimeout(resolve, 5))
        assert.deepEqual(events, [["INITIAL_SESSION", null]])
    })

    it("announces nobody when the first answer is no grant", async () => {
        const { client, events, listen } = harness(() => ({ status: 200, body: { nope: true } }))
        listen()
        await new Promise((resolve) => setTimeout(resolve, 5))
        assert.deepEqual(events, [["INITIAL_SESSION", null]])
        assert.equal(client.getSnapshot().status, "signed-out")
    })

    it("tells a late listener the current session at once", async () => {
        const { client, events, listen } = harness(() => ({ status: 200, body: grant() }))
        await client.renew()
        listen()
        assert.deepEqual(events, [["INITIAL_SESSION", "user-1"]])
    })

    it("keeps one snapshot object until the session changes, and a server snapshot that is always loading", async () => {
        const { client } = harness(() => ({ status: 200, body: grant() }))
        let notified = 0
        const stop = client.watch(() => {
            notified += 1
        })
        const loading = client.getSnapshot()
        assert.equal(loading.status, "loading")
        await new Promise((resolve) => setTimeout(resolve, 5))
        const signedIn = client.getSnapshot()
        assert.equal(signedIn.status, "signed-in")
        client.keep(grant())
        assert.equal(client.getSnapshot(), signedIn, "the same grant does not change the snapshot")
        assert.equal(client.getServerSnapshot().status, "loading")
        assert.equal(notified, 1)
        client.keep(grant("user-9"))
        assert.notEqual(client.getSnapshot(), signedIn)
        stop()
        client.drop()
        assert.equal(notified, 2)
    })

    it("reads no person from a grant with no user and a token whose claims are no JSON", async () => {
        const { client } = harness(() => ({ status: 200, body: { accessToken: "head.%%%.sig", expiresIn: 900, expiresAt: "2026-01-01T00:15:00.000Z" } }))
        await client.renew()
        assert.equal(await client.user(), null)
    })

    it("reads the person from the token when the grant carries no user", async () => {
        const { client } = harness(() => ({ status: 200, body: { accessToken: jwt({ sub: "u-claims", email: "c@example.test" }), expiresIn: 60 } }))
        assert.deepEqual(await client.user(), { id: "u-claims", email: "c@example.test" })
        const { client: bare } = harness(() => ({ status: 200, body: { accessToken: "opaque", expiresIn: 60 } }))
        assert.equal(await bare.user(), null)
    })
})

describe("AuthClient doors", () => {
    it("maps a refused sign-in to an outcome carrying the wire code, and a transport failure to unavailable", async () => {
        const refused = harness(() => ({ status: 401, body: { code: "IDENTITY_INVALID_CREDENTIALS" } }))
        assert.deepEqual(await refused.client.signIn({ email: "a", password: "b" }), { success: false, message: "refused", error: "IDENTITY_INVALID_CREDENTIALS" })
        const lost = harness(() => new Error("down"))
        assert.deepEqual(await lost.client.signIn({}), { success: false, message: "unavailable", error: "transport" })
        const odd = harness(() => ({ status: 200, body: { hello: 1 } }))
        assert.deepEqual(await odd.client.signIn({}), { success: false, message: "unavailable", error: "grant" })
        const nameless = harness(() => ({ status: 200, body: { accessToken: "opaque", expiresIn: 5 } }))
        assert.equal((await nameless.client.signIn({})).success, false)
    })

    it("sends door bodies as JSON and falls back to the status when the body names no code", async () => {
        const { client, calls } = harness(() => ({ status: 429 }))
        assert.deepEqual(await client.send("forgot", { email: "a@example.test" }), { success: false, message: "unavailable", error: "429" })
        assert.deepEqual(await client.send("reset", {}, { 429: "IDENTITY_TOO_MANY_ATTEMPTS" }), { success: false, message: "unavailable", error: "IDENTITY_TOO_MANY_ATTEMPTS" })
        assert.equal(must(calls[0]).body, '{"email":"a@example.test"}')
        assert.equal(must(calls[0]).headers["content-type"], "application/json")
    })

    it("forgets the token on sign-out even when the door cannot be reached", async () => {
        const { client } = harness((_call, index) => (index === 0 ? { status: 200, body: grant() } : new Error("down")))
        await client.renew()
        await client.signOut()
        assert.equal(client.peek(), undefined)
        assert.equal(client.getSnapshot().status, "signed-out")
    })

    it("asks the session door with the forwarded cookie on the server and never rotates", async () => {
        const ok = harness(() => ({ status: 200, body: grant() }))
        assert.deepEqual(await ok.client.checkSession("auth_refresh=abc"), { success: true, message: "ok", data: true })
        assert.equal(must(ok.calls[0]).method, "GET")
        assert.equal(must(ok.calls[0]).url, "https://api.example.test/auth/session")
        assert.equal(must(ok.calls[0]).headers.cookie, "auth_refresh=abc")
        assert.deepEqual(await ok.client.checkSession(null), { success: false, message: "refused", error: "no-session" })
        assert.deepEqual(await ok.client.checkSession(""), { success: false, message: "refused", error: "no-session" })
        assert.deepEqual(await harness(() => ({ status: 401 })).client.checkSession("a=b"), { success: false, message: "refused", error: "401" })
        assert.deepEqual(await harness(() => ({ status: 503 })).client.checkSession("a=b"), { success: false, message: "unavailable", error: "503" })
        assert.deepEqual(await harness(() => new Error("down")).client.checkSession("a=b"), { success: false, message: "unavailable", error: "transport" })
    })

    it("resolves the API origin lazily", async () => {
        const urls: string[] = []
        let origin = "https://one.example.test"
        const client = createAuthClient({
            apiOrigin: () => origin,
            fetch: (input) => {
                urls.push(urlOf(input))
                return Promise.resolve(new Response(null, { status: 204 }))
            },
        })
        await client.door("logout")
        origin = "https://two.example.test"
        await client.door("jwks")
        assert.deepEqual(urls, ["https://one.example.test/auth/logout", "https://two.example.test/auth/jwks"])
    })

    it("falls back to an empty header and a null person while signed out", async () => {
        const { client } = harness(() => ({ status: 401 }))
        assert.deepEqual(await client.headers(), {})
        assert.equal(await client.user(), null)
    })
})
