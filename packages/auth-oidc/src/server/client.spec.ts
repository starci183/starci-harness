import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import type { FakeTokenClaims } from "../testing/index.ts"
import { OidcClient } from "./client.ts"
import { OidcDiscovery } from "./discovery.ts"
import { OidcKeys } from "./jwks.ts"
import { OidcTokenVerifier } from "./tokens.ts"
import { resolveOptions } from "./options.ts"
import { OidcError } from "./errors.ts"
import { createOidc } from "./oidc.ts"
import type { OidcOptions } from "./options.ts"
import { pkceChallenge, randomReference } from "./primitives.ts"

const CALLBACK = "https://app.example.test/api/session/callback"

interface World {
    readonly issuer: FakeOidcIssuer
    readonly client: OidcClient
    readonly clock: FakeClock
}

const setup = async (overrides: Partial<OidcOptions> = {}, secret?: string): Promise<World> => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, ...(secret === undefined ? {} : { clientSecret: secret }) })
    const oidc = createOidc(issuer.options({ callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/sign-in", ...overrides }))
    assert.ok(oidc.client)
    return { issuer, client: oidc.client, clock }
}

const refused = (code: string): ((error: unknown) => boolean) => (error: unknown) => error instanceof OidcError && error.code === code

/** Runs the browser half of the flow: the authorization address in, the callback parameters out. */
const flow = async (world: World, claims: FakeTokenClaims = { sub: "user-1", roles: ["member"], email: "a@example.test" }): Promise<{ code: string; state: string; nonce: string; verifier: string; issuer: string }> => {
    const verifier = randomReference()
    const nonce = randomReference()
    const state = randomReference()
    const address = await world.client.authorization({ state, nonce, challenge: pkceChallenge(verifier) })
    const back = new URL(world.issuer.authorize(address, claims))
    return { code: back.searchParams.get("code") ?? "", state: back.searchParams.get("state") ?? "", nonce, verifier, issuer: back.searchParams.get("iss") ?? "" }
}

describe("OidcClient authorization", () => {
    it("builds the code flow address on the discovered endpoint with the exact registration, S256 and the proof values", async () => {
        const { client, issuer } = await setup()
        const url = new URL(await client.authorization({ state: "s", nonce: "n", challenge: "c" }))
        assert.equal(url.origin + url.pathname, `${issuer.issuer}/protocol/openid-connect/auth`)
        assert.deepEqual(Object.fromEntries(url.searchParams), {
            response_type: "code",
            client_id: "test-client",
            redirect_uri: CALLBACK,
            scope: "openid",
            state: "s",
            nonce: "n",
            code_challenge: "c",
            code_challenge_method: "S256",
        })
    })

    it("sends the identity provider hint as kc_idp_hint", async () => {
        const { client } = await setup()
        const url = new URL(await client.authorization({ state: "s", nonce: "n", challenge: "c", idpHint: "google" }))
        assert.equal(url.searchParams.get("kc_idp_hint"), "google")
        assert.equal(new URL(await client.authorization({ state: "s", nonce: "n", challenge: "c" })).searchParams.has("kc_idp_hint"), false)
    })

    it("sends the prompt and the scope the caller asks for", async () => {
        const { client } = await setup({ client: { clientId: "test-client", callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/out", scope: "openid email" } })
        const url = new URL(await client.authorization({ state: "s", nonce: "n", challenge: "c", prompt: "none" }))
        assert.equal(url.searchParams.get("prompt"), "none")
        assert.equal(url.searchParams.get("scope"), "openid email")
    })

    it("throws Unavailable when the provider cannot be asked for its endpoints", async () => {
        const { client, issuer } = await setup()
        issuer.setDown(true)
        await assert.rejects(client.authorization({ state: "s", nonce: "n", challenge: "c" }), refused(OIDC_ERROR_CODES.Unavailable))
    })
})

describe("OidcClient exchange", () => {
    it("trades a claimed code once for the verified identity and answers no provider token", async () => {
        const world = await setup()
        const { code, nonce, verifier, issuer } = await flow(world, { sub: "user-7", email: "b@example.test", roles: ["learner", "admin"], sessionId: "sid-7" })
        const identity = await world.client.exchange({ code, nonce, verifier, issuer })
        assert.deepEqual(identity, {
            issuer: world.issuer.issuer,
            subject: "user-7",
            roles: ["admin", "learner"],
            email: "b@example.test",
            sessionId: "sid-7",
            expiresAt: new Date(world.clock.now().getTime() + 300_000),
            refreshToken: identity.refreshToken,
            refreshExpiresAt: new Date(world.clock.now().getTime() + 1_800_000),
        })
        assert.ok(identity.refreshToken)
        assert.equal(JSON.stringify(identity).includes("eyJ"), false)
    })

    it("answers no refresh token when the provider issues none that can be dated", async () => {
        const world = await setup()
        const bare = createOidc(
            world.issuer.options({
                callbackUri: CALLBACK,
                http: {
                    request: async (request) => {
                        const answer = await world.issuer.http.request(request)
                        if (!request.url.endsWith("/token") || typeof answer.body !== "object" || answer.body === null) return answer
                        return { status: answer.status, body: { ...answer.body, refresh_token: "opaque", refresh_expires_in: 0 } }
                    },
                },
            }),
        )
        assert.ok(bare.client)
        const verifier = randomReference()
        const nonce = randomReference()
        const address = await bare.client.authorization({ state: "s", nonce, challenge: pkceChallenge(verifier) })
        const back = new URL(world.issuer.authorize(address, { sub: "user-3" }))
        const identity = await bare.client.exchange({ code: back.searchParams.get("code") ?? "", nonce, verifier })
        assert.equal(identity.subject, "user-3")
        assert.equal("refreshToken" in identity, false)
        assert.equal("refreshExpiresAt" in identity, false)
    })

    it("refuses a replayed code, a wrong PKCE verifier and a code of another transaction", async () => {
        const world = await setup()
        const first = await flow(world)
        await world.client.exchange({ code: first.code, nonce: first.nonce, verifier: first.verifier })
        await assert.rejects(world.client.exchange({ code: first.code, nonce: first.nonce, verifier: first.verifier }), refused(OIDC_ERROR_CODES.Rejected))
        const second = await flow(world)
        await assert.rejects(world.client.exchange({ code: second.code, nonce: second.nonce, verifier: randomReference() }), refused(OIDC_ERROR_CODES.Rejected))
        await assert.rejects(world.client.exchange({ code: "unknown", nonce: second.nonce, verifier: second.verifier }), refused(OIDC_ERROR_CODES.Rejected))
    })

    it("refuses an ID token whose nonce is not the browser's", async () => {
        const world = await setup()
        const { code, verifier } = await flow(world)
        await assert.rejects(world.client.exchange({ code, nonce: randomReference(), verifier }), refused(OIDC_ERROR_CODES.Rejected))
    })

    it("refuses an authorization response of another issuer before any request", async () => {
        const world = await setup()
        const { code, nonce, verifier } = await flow(world)
        await assert.rejects(world.client.exchange({ code, nonce, verifier, issuer: "https://evil.example.test/realms/test" }), refused(OIDC_ERROR_CODES.Rejected))
        assert.equal(world.issuer.count("/protocol/openid-connect/token"), 0)
    })

    it("sends the client secret of a confidential client, text or holder, and the provider refuses a wrong one", async () => {
        const good = await setup({}, "s3cret")
        const accepted = await flow(good)
        assert.equal((await good.client.exchange({ code: accepted.code, nonce: accepted.nonce, verifier: accepted.verifier })).subject, "user-1")
        const wrong = await setup({ client: { clientId: "test-client", clientSecret: { reveal: () => "wrong" }, callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/out" } }, "s3cret")
        const refusedFlow = await flow(wrong)
        await assert.rejects(wrong.client.exchange({ code: refusedFlow.code, nonce: refusedFlow.nonce, verifier: refusedFlow.verifier }), refused(OIDC_ERROR_CODES.Rejected))
    })

    it("throws Unavailable on a provider error or a lost connection at the token endpoint", async () => {
        const world = await setup()
        const { code, nonce, verifier } = await flow(world)
        world.issuer.failNext({ status: 503 }, 1)
        // The first request after the injection is the discovery fetch (cached from the flow), so the failure lands on the token request.
        await assert.rejects(world.client.exchange({ code, nonce, verifier }), refused(OIDC_ERROR_CODES.Unavailable))
        world.issuer.failNext("network")
        await assert.rejects(world.client.exchange({ code, nonce, verifier }), refused(OIDC_ERROR_CODES.Unavailable))
    })

    it("refuses an ID token the verifier refuses: wrong audience, expired, foreign signature", async () => {
        const world = await setup()
        for (const bend of [{ audience: "someone-else" }, { signer: "foreign" as const }, { expiresInSeconds: -120 }]) {
            world.issuer.bendIdTokens(bend)
            const { code, nonce, verifier } = await flow(world)
            await assert.rejects(world.client.exchange({ code, nonce, verifier }), refused(OIDC_ERROR_CODES.Rejected), JSON.stringify(bend))
        }
    })

    it("refuses an ID token with malformed role claims", async () => {
        const world = await setup()
        const { code, nonce, verifier } = await flow(world, { extra: { realm_access: "x" } })
        await assert.rejects(world.client.exchange({ code, nonce, verifier }), refused(OIDC_ERROR_CODES.Rejected))
    })
})

describe("OidcClient logout and registration", () => {
    it("builds the RP-initiated logout address with the client and the registered return, and the hint and state when given", async () => {
        const { client, issuer } = await setup()
        const bare = new URL(await client.logout())
        assert.equal(bare.origin + bare.pathname, `${issuer.issuer}/protocol/openid-connect/logout`)
        assert.deepEqual(Object.fromEntries(bare.searchParams), { client_id: "test-client", post_logout_redirect_uri: "https://app.example.test/sign-in" })
        const full = new URL(await client.logout({ idTokenHint: "hint", state: "s" }))
        assert.equal(full.searchParams.get("id_token_hint"), "hint")
        assert.equal(full.searchParams.get("state"), "s")
    })

    it("is absent from a registration that declares no client", async () => {
        const issuer = await FakeOidcIssuer.create()
        assert.equal(createOidc(issuer.options()).client, null)
    })

    it("refuses to build a logout address when the provider offers no end-session endpoint", async () => {
        const issuer = await FakeOidcIssuer.create()
        const http = {
            request: async (request: Parameters<FakeOidcIssuer["http"]["request"]>[0]) => {
                const answer = await issuer.http.request(request)
                if (!request.url.endsWith("openid-configuration") || typeof answer.body !== "object" || answer.body === null) return answer
                return { status: answer.status, body: Object.fromEntries(Object.entries(answer.body).filter(([key]) => key !== "end_session_endpoint")) }
            },
        }
        const client = createOidc(issuer.options({ callbackUri: CALLBACK, http })).client
        assert.ok(client)
        await assert.rejects(client.logout(), refused(OIDC_ERROR_CODES.Rejected))
    })

    it("a client-less registration refuses the code flow as a configuration error", async () => {
        const issuer = await FakeOidcIssuer.create()
        const options = resolveOptions(issuer.options())
        const discovery = new OidcDiscovery(options)
        const client = new OidcClient(options, discovery, new OidcTokenVerifier(options, new OidcKeys(options, discovery)))
        await assert.rejects(client.logout(), refused(OIDC_ERROR_CODES.ConfigurationInvalid))
    })
})
