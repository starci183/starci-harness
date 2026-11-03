import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decodeProtectedHeader, jwtVerify, createLocalJWKSet } from "jose"
import type { JSONWebKeySet } from "jose"
import { createOidc } from "../server/oidc.ts"
import { fetchHttp } from "../server/options.ts"
import { pkceChallenge, randomReference } from "../server/primitives.ts"
import { FakeClock, FakeOidcIssuer } from "./index.ts"

const CALLBACK = "https://app.example.test/callback"

describe("FakeOidcIssuer in memory", () => {
    it("answers the discovery document, whose endpoints sit on the issuer", async () => {
        const issuer = await FakeOidcIssuer.create({ realm: "shop", origin: "https://sso.example.test" })
        assert.equal(issuer.issuer, "https://sso.example.test/realms/shop")
        const metadata = await issuer.http.request({ method: "GET", url: `${issuer.issuer}/.well-known/openid-configuration`, timeoutMs: 1000 })
        assert.equal(metadata.status, 200)
        assert.deepEqual(metadata.body, issuer.metadata())
        const unknown = await issuer.http.request({ method: "GET", url: `${issuer.issuer}/nothing`, timeoutMs: 1000 })
        assert.equal(unknown.status, 404)
    })

    it("publishes a key set that verifies the tokens it mints, for RS256 and ES256", async () => {
        for (const algorithm of ["RS256", "ES256"] as const) {
            const issuer = await FakeOidcIssuer.create({ algorithm })
            const token = await issuer.mintAccessToken({ sub: "u" })
            assert.equal(decodeProtectedHeader(token).alg, algorithm)
            assert.equal(decodeProtectedHeader(token).kid, issuer.keyId)
            const verified = await jwtVerify(token, createLocalJWKSet(issuer.jwks() as JSONWebKeySet), { issuer: issuer.issuer, audience: "test-client" })
            assert.equal(verified.payload.sub, "u")
        }
    })

    it("rotates the signing key, keeping the old key published unless told to drop it", async () => {
        const issuer = await FakeOidcIssuer.create()
        const first = issuer.keyId
        const second = await issuer.rotateKeys()
        assert.notEqual(first, second)
        assert.deepEqual(issuer.jwks().keys.map((key) => key.kid), [second, first])
        assert.equal(issuer.keyId, second)
        await issuer.rotateKeys({ keepOld: false })
        assert.equal(issuer.jwks().keys.length, 1)
    })

    it("mints tokens a spec can bend: kid, issuer, audience, validity, signer, type", async () => {
        const clock = new FakeClock()
        const issuer = await FakeOidcIssuer.create({ clock, audience: "api", accessTtlSeconds: 60 })
        const read = async (token: string): Promise<Record<string, unknown>> => {
            const verified = await jwtVerify(token, createLocalJWKSet(issuer.jwks() as JSONWebKeySet), { currentDate: new Date(clock.now().getTime() - 1000), clockTolerance: 1e6 })
            return verified.payload
        }
        const plain = await read(await issuer.mintAccessToken({ clientRoles: { api: ["r"] } }))
        assert.equal(plain.aud, "api")
        assert.equal(plain.typ, "Bearer")
        assert.equal(Number(plain.exp) - Number(plain.iat), 60)
        assert.deepEqual(plain.resource_access, { api: { roles: ["r"] } })
        assert.equal(decodeProtectedHeader(await issuer.mintAccessToken({}, { kid: null })).kid, undefined)
        assert.equal(decodeProtectedHeader(await issuer.mintAccessToken({}, { kid: "x" })).kid, "x")
        const bent = await read(await issuer.mintAccessToken({}, { issuer: "https://other.test", audience: ["a", "b"], expiresInSeconds: 5, issuedAt: new Date(clock.now().getTime() - 10_000) }))
        assert.deepEqual([bent.iss, bent.aud], ["https://other.test", ["a", "b"]])
        const foreign = await issuer.mintAccessToken({}, { signer: "foreign" })
        await assert.rejects(jwtVerify(foreign, createLocalJWKSet(issuer.jwks() as JSONWebKeySet), { clockTolerance: 1e6 }))
        assert.equal((await read(await issuer.mintIdToken({}, "n1"))).nonce, "n1")
    })

    it("counts the requests it answers and can fail the next ones or go down", async () => {
        const issuer = await FakeOidcIssuer.create()
        const url = `${issuer.issuer}/.well-known/openid-configuration`
        issuer.failNext({ status: 500 }, 2)
        assert.equal((await issuer.http.request({ method: "GET", url, timeoutMs: 1 })).status, 500)
        assert.equal((await issuer.http.request({ method: "GET", url, timeoutMs: 1 })).status, 500)
        issuer.failNext("network")
        await assert.rejects(issuer.http.request({ method: "GET", url, timeoutMs: 1 }), /connection reset/u)
        assert.equal((await issuer.http.request({ method: "GET", url, timeoutMs: 1 })).status, 200)
        issuer.setDown(true)
        await assert.rejects(issuer.http.request({ method: "GET", url, timeoutMs: 1 }), /connection refused/u)
        issuer.setDown(false)
        assert.equal(issuer.count("/.well-known/openid-configuration"), 5)
        assert.equal(issuer.requests.length, 5)
    })

    it("runs the code flow: PKCE is checked, a code is one-use, the refresh token rotates and a spent one is refused", async () => {
        const issuer = await FakeOidcIssuer.create({ clientSecret: "shh" })
        const verifier = randomReference()
        const address = `${issuer.issuer}/protocol/openid-connect/auth?${new URLSearchParams({ response_type: "code", client_id: "test-client", redirect_uri: CALLBACK, state: "st", nonce: "no", code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" }).toString()}`
        const code = new URL(issuer.authorize(address, { sub: "u-2" })).searchParams.get("code") ?? ""
        const token = (form: Record<string, string>): ReturnType<FakeOidcIssuer["http"]["request"]> =>
            issuer.http.request({ method: "POST", url: `${issuer.issuer}/protocol/openid-connect/token`, timeoutMs: 1, form: { client_id: "test-client", client_secret: "shh", ...form } })
        assert.equal((await token({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: "wrong" })).status, 400)
        const granted = await token({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier })
        assert.equal(granted.status, 200)
        assert.equal((await token({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier })).status, 400)
        const first = (granted.body as { refresh_token: string }).refresh_token
        const refreshed = await token({ grant_type: "refresh_token", refresh_token: first })
        assert.equal(refreshed.status, 200)
        assert.notEqual((refreshed.body as { refresh_token: string }).refresh_token, first)
        assert.equal((await token({ grant_type: "refresh_token", refresh_token: first })).status, 400)
        assert.equal((await token({ grant_type: "client_credentials" })).status, 400)
        assert.equal((await issuer.http.request({ method: "POST", url: `${issuer.issuer}/protocol/openid-connect/token`, timeoutMs: 1, form: { client_id: "test-client", grant_type: "refresh_token" } })).status, 401)
    })

    it("refuses an authorization request that is not a registered S256 code flow", async () => {
        const issuer = await FakeOidcIssuer.create()
        assert.throws(() => issuer.authorize(`${issuer.issuer}/auth?client_id=other`), /registered S256 code flow/u)
    })

    it("serves a front-end client's fetch with the same endpoints", async () => {
        const issuer = await FakeOidcIssuer.create()
        const response = await issuer.fetch(`${issuer.issuer}/protocol/openid-connect/certs`)
        assert.deepEqual(await response.json(), issuer.jwks())
        const post = await issuer.fetch(new URL(`${issuer.issuer}/protocol/openid-connect/token`), { method: "POST", body: "client_id=test-client&grant_type=none" })
        assert.equal(post.status, 400)
        const request = await issuer.fetch(new Request(`${issuer.issuer}/.well-known/openid-configuration`))
        assert.equal(request.status, 200)
    })

    it("builds registration options for the code under test, against its own port and clock", async () => {
        const issuer = await FakeOidcIssuer.create({ clientSecret: "x" })
        const options = issuer.options({ callbackUri: CALLBACK })
        assert.equal(options.client?.postLogoutUri, "https://app.example.test/signed-out")
        assert.equal(options.client.clientSecret, "x")
        assert.equal((await createOidc(options).verifier.verify(await issuer.mintAccessToken())).kind, "ok")
    })
})

describe("FakeOidcIssuer behind a host", () => {
    it("moves to the origin its host listens on, and answers the requests the host passes to serve", async () => {
        const issuer = await FakeOidcIssuer.create({ audience: "api" })
        issuer.rebase("https://127.0.0.1:41001")
        assert.equal(issuer.issuer, "https://127.0.0.1:41001/realms/test")
        const document = await issuer.serve({ method: "GET", url: `${issuer.issuer}/.well-known/openid-configuration`, timeoutMs: 1 })
        assert.equal((document.body as { issuer: string }).issuer, issuer.issuer)
        const oidc = createOidc(issuer.options({ http: { request: (request) => issuer.serve(request) } }))
        assert.equal((await oidc.verifier.verify(await issuer.mintAccessToken())).kind, "ok")
    })
})

describe("FakeOidcIssuer on a socket", () => {
    it("serves the same issuer over http on 127.0.0.1, for the platform fetch and a browser", async () => {
        const issuer = await FakeOidcIssuer.create({ listen: true })
        try {
            assert.match(issuer.issuer, /^http:\/\/127\.0\.0\.1:\d+\/realms\/test$/u)
            const oidc = createOidc({ issuer: issuer.issuer, audience: "test-client", allowInsecureHttp: true, http: fetchHttp })
            const outcome = await oidc.verifier.verify(await issuer.mintAccessToken({ sub: "socket" }))
            assert.equal(outcome.kind === "ok" && outcome.value.id, "socket")
            const preflight = await fetch(`${issuer.issuer}/protocol/openid-connect/token`, { method: "OPTIONS" })
            assert.equal(preflight.status, 204)
            assert.equal(preflight.headers.get("access-control-allow-origin"), "*")
            const token = await fetch(`${issuer.issuer}/protocol/openid-connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "client_id=test-client&grant_type=refresh_token&refresh_token=x" })
            assert.equal(token.status, 400)
            issuer.setDown(true)
            await assert.rejects(fetch(`${issuer.issuer}/.well-known/openid-configuration`))
        } finally {
            await issuer.close()
        }
        await issuer.close()
    })
})
