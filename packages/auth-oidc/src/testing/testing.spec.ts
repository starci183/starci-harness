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
        assert.equal((await token({ grant_type: "implicit" })).status, 400)
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

describe("FakeOidcIssuer grants and admin API", () => {
    const base = (issuer: FakeOidcIssuer): string => `${new URL(issuer.issuer).origin}/admin/realms/test`
    const tokenUrl = (issuer: FakeOidcIssuer): string => `${issuer.issuer}/protocol/openid-connect/token`
    const serviceToken = async (issuer: FakeOidcIssuer): Promise<string> =>
        ((await issuer.http.request({ method: "POST", url: tokenUrl(issuer), timeoutMs: 1, form: { client_id: "test-client", client_secret: "shh", grant_type: "client_credentials" } })).body as { access_token: string }).access_token

    it("answers the password grant for seeded users, with the policy of the realm and failure injection", async () => {
        const issuer = await FakeOidcIssuer.create({ clientSecret: "shh", minPasswordLength: 4 })
        const user = issuer.seedUser({ username: "Mai", email: "mai@example.test", password: "pass", roles: ["r"] })
        assert.equal(issuer.findUser("MAI@example.test")?.id, user.id)
        assert.equal(issuer.findUser(user.id)?.username, "Mai")
        assert.equal(issuer.findUser("ghost"), undefined)
        assert.equal(issuer.passwordMatches("mai", "pass"), true)
        assert.equal(issuer.passwordMatches("ghost", "pass"), false)
        const grant = (form: Record<string, string>): ReturnType<FakeOidcIssuer["http"]["request"]> =>
            issuer.http.request({ method: "POST", url: tokenUrl(issuer), timeoutMs: 1, form: { client_id: "test-client", client_secret: "shh", grant_type: "password", ...form } })
        const ok = await grant({ username: "mai", password: "pass" })
        assert.equal(ok.status, 200)
        assert.equal((ok.body as { refresh_expires_in: number }).refresh_expires_in, 1800)
        assert.equal((await grant({ username: "mai", password: "nope" })).status, 401)
        assert.equal((await grant({ username: "mai" })).status, 401)
        issuer.failNext({ status: 503 })
        assert.equal((await grant({ username: "mai", password: "pass" })).status, 503)
    })

    it("hands a service account token to client_credentials only for a confidential client, and guards the admin API with it", async () => {
        const clock = new FakeClock()
        const issuer = await FakeOidcIssuer.create({ clock, clientSecret: "shh", accessTtlSeconds: 60 })
        const token = await serviceToken(issuer)
        const list = (authorization: string | undefined): ReturnType<FakeOidcIssuer["http"]["request"]> =>
            issuer.http.request({ method: "GET", url: `${base(issuer)}/users?email=a%40b.test`, timeoutMs: 1, ...(authorization === undefined ? {} : { headers: { authorization } }) })
        assert.equal((await list(`Bearer ${token}`)).status, 200)
        assert.equal((await list(undefined)).status, 401)
        assert.equal((await list("Bearer forged")).status, 401)
        clock.advance(61_000)
        assert.equal((await list(`Bearer ${token}`)).status, 401)
        const pub = await FakeOidcIssuer.create()
        const answer = await pub.http.request({ method: "POST", url: tokenUrl(pub), timeoutMs: 1, form: { client_id: "test-client", grant_type: "client_credentials" } })
        assert.equal(answer.status, 400)
    })

    it("refuses an unknown route of the admin API, a user create without credentials and a wrong method", async () => {
        const issuer = await FakeOidcIssuer.create({ clientSecret: "shh" })
        const token = await serviceToken(issuer)
        const call = (method: "GET" | "POST" | "PUT", path: string, body?: unknown): ReturnType<FakeOidcIssuer["http"]["request"]> =>
            issuer.http.request({ method, url: `${base(issuer)}${path}`, timeoutMs: 1, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body }) })
        assert.equal((await call("GET", "/nothing")).status, 404)
        assert.equal((await call("POST", "/users", { username: "u" })).status, 400)
        assert.equal((await call("GET", "/users/x/reset-password")).status, 404)
        assert.equal((await call("PUT", "/users/x/reset-password", { value: "long enough 1" })).status, 404)
    })

    it("refuses a hint of a provider the realm does not broker, and records the ones it does", async () => {
        const issuer = await FakeOidcIssuer.create({ identityProviders: ["google"] })
        const address = (hint: string): string =>
            `${issuer.issuer}/protocol/openid-connect/auth?${new URLSearchParams({ response_type: "code", client_id: "test-client", redirect_uri: CALLBACK, state: "st", nonce: "no", code_challenge: "c", code_challenge_method: "S256", kc_idp_hint: hint }).toString()}`
        assert.throws(() => issuer.authorize(address("github")), /brokers no identity provider/u)
        issuer.authorize(address("google"))
        assert.deepEqual(issuer.idpHints, ["google"])
    })

    it("serves the grants, the admin API and the revocation over a socket for the platform fetch", async () => {
        const issuer = await FakeOidcIssuer.create({ listen: true, clientSecret: "shh" })
        try {
            const oidc = createOidc(issuer.options({ callbackUri: CALLBACK, http: fetchHttp }))
            const created = await oidc.broker.createUser({ email: "s@example.test", username: "sock", password: "long enough 1" })
            assert.equal(issuer.findUser(created.subject)?.username, "sock")
            assert.deepEqual(await oidc.broker.findUserByEmail("s@example.test"), { subject: created.subject, username: "sock" })
            const session = await oidc.broker.passwordGrant("sock", "long enough 1")
            await oidc.broker.resetPassword(created.subject, "another long one")
            await oidc.broker.revoke(session.refreshToken)
            await oidc.broker.logoutAll(created.subject)
            assert.equal(issuer.passwordMatches("sock", "another long one"), true)
        } finally {
            await issuer.close()
        }
    })
})
