import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import type { FakeTokenClaims } from "../testing/index.ts"
import type { OidcBroker } from "./broker.ts"
import { OidcError } from "./errors.ts"
import { createOidc } from "./oidc.ts"
import { pkceChallenge, randomReference } from "./primitives.ts"

const CALLBACK = "https://app.example.test/api/session/callback"

const thrown = (kind: string): ((error: unknown) => boolean) => (error: unknown) => error instanceof OidcError && error.kind === kind

const setup = async (): Promise<{ issuer: FakeOidcIssuer; broker: OidcBroker; clock: FakeClock }> => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, clientSecret: "s3cret", identityProviders: ["google", "github"] })
    issuer.seedUser({ id: "user-9", username: "mai", email: "mai@example.test", password: "correct horse", roles: ["learner"] })
    return { issuer, clock, broker: createOidc(issuer.options({ callbackUri: CALLBACK })).broker }
}

describe("OidcBroker sessions", () => {
    it("answers exactly the account, roles, email, refresh token and expiry for a password grant and a refresh", async () => {
        const { broker, clock } = await setup()
        const first = await broker.passwordGrant("mai@example.test", "correct horse")
        assert.deepEqual(Object.keys(first).sort(), ["email", "refreshExpiresAt", "refreshToken", "roles", "subject"])
        assert.equal(first.subject, "user-9")
        assert.deepEqual(first.roles, ["learner"])
        assert.equal(first.email, "mai@example.test")
        assert.equal(first.refreshExpiresAt.getTime(), clock.now().getTime() + 1_800_000)
        const second = await broker.refresh(first.refreshToken)
        assert.equal(second.subject, "user-9")
        assert.notEqual(second.refreshToken, first.refreshToken)
    })

    it("maps a refusal of the credentials, of a dead refresh token and an outage to their kinds", async () => {
        const { issuer, broker } = await setup()
        await assert.rejects(broker.passwordGrant("mai", "wrong"), thrown("credentials-rejected"))
        await assert.rejects(broker.refresh("dead"), thrown("credentials-rejected"))
        issuer.setDown(true)
        await assert.rejects(broker.passwordGrant("mai", "correct horse"), thrown("unavailable"))
    })

    it("revokes a session so its refresh token stops working", async () => {
        const { broker } = await setup()
        const session = await broker.passwordGrant("mai", "correct horse")
        await broker.revoke(session.refreshToken)
        await assert.rejects(broker.refresh(session.refreshToken), thrown("credentials-rejected"))
    })
})

describe("OidcBroker social sign-in", () => {
    const begin = async (broker: OidcBroker, issuer: FakeOidcIssuer, claims: FakeTokenClaims = { sub: "social-1", email: "g@example.test", roles: ["learner"] }) => {
        const verifier = randomReference()
        const nonce = randomReference()
        const state = randomReference()
        const address = await broker.socialAuthorizationUrl({ provider: "google", state, nonce, codeChallenge: pkceChallenge(verifier) })
        const back = new URL(issuer.authorize(address, claims))
        return { address, code: back.searchParams.get("code") ?? "", verifier, nonce, state }
    }

    it("builds the authorization address with the provider as kc_idp_hint and exchanges the code for the session", async () => {
        const { issuer, broker, clock } = await setup()
        const flow = await begin(broker, issuer)
        const url = new URL(flow.address)
        assert.equal(url.searchParams.get("kc_idp_hint"), "google")
        assert.equal(url.searchParams.get("state"), flow.state)
        assert.deepEqual(issuer.idpHints, ["google"])
        const session = await broker.exchangeSocialCode({ code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce })
        assert.equal(session.subject, "social-1")
        assert.equal(session.email, "g@example.test")
        assert.deepEqual(session.roles, ["learner"])
        assert.ok(session.refreshToken.length > 0)
        assert.equal(session.refreshExpiresAt.getTime(), clock.now().getTime() + 1_800_000)
    })

    it("answers a null email for an identity without one", async () => {
        const { issuer, broker } = await setup()
        const flow = await begin(broker, issuer, { sub: "social-2" })
        const session = await broker.exchangeSocialCode({ code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce })
        assert.equal(session.email, null)
    })

    it("throws social-rejected for a bad code, a replayed code, a wrong verifier and a wrong nonce", async () => {
        const { issuer, broker } = await setup()
        const flow = await begin(broker, issuer)
        const other = await begin(broker, issuer)
        await assert.rejects(broker.exchangeSocialCode({ code: other.code, codeVerifier: other.verifier, nonce: "another" }), thrown("social-rejected"))
        await assert.rejects(broker.exchangeSocialCode({ code: "forged", codeVerifier: flow.verifier, nonce: flow.nonce }), thrown("social-rejected"))
        await assert.rejects(broker.exchangeSocialCode({ code: flow.code, codeVerifier: "wrong", nonce: flow.nonce }), thrown("social-rejected"))
        await broker.exchangeSocialCode({ code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce })
        await assert.rejects(broker.exchangeSocialCode({ code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce }), thrown("social-rejected"))
    })

    it("keeps an outage unavailable and refuses an answer with no dated refresh token as social-rejected", async () => {
        const { issuer, broker } = await setup()
        const flow = await begin(broker, issuer)
        issuer.failNext({ status: 503 })
        await assert.rejects(broker.exchangeSocialCode({ code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce }), thrown("unavailable"))
        const bare = createOidc(
            issuer.options({
                callbackUri: CALLBACK,
                http: {
                    request: async (request) => {
                        const answer = await issuer.http.request(request)
                        if (!request.url.endsWith("/token") || typeof answer.body !== "object" || answer.body === null) return answer
                        return { status: answer.status, body: { ...answer.body, refresh_token: undefined } }
                    },
                },
            }),
        ).broker
        const again = await begin(bare, issuer)
        await assert.rejects(bare.exchangeSocialCode({ code: again.code, codeVerifier: again.verifier, nonce: again.nonce }), thrown("social-rejected"))
    })

    it("needs a registered client", async () => {
        const issuer = await FakeOidcIssuer.create()
        const { broker } = createOidc(issuer.options())
        await assert.rejects(broker.socialAuthorizationUrl({ provider: "google", state: "s", nonce: "n", codeChallenge: "c" }), thrown("invalid"))
        await assert.rejects(broker.exchangeSocialCode({ code: "c", codeVerifier: "v", nonce: "n" }), thrown("invalid"))
    })
})

describe("OidcBroker accounts", () => {
    it("creates, finds, resets and signs out an account through the admin API", async () => {
        const { issuer, broker } = await setup()
        const created = await broker.createUser({ email: "new@example.test", username: "newbie", password: "long enough 1" })
        assert.deepEqual(await broker.findUserByEmail("new@example.test"), { subject: created.subject, username: "newbie" })
        const session = await broker.passwordGrant("newbie", "long enough 1")
        await broker.resetPassword(created.subject, "another long one")
        assert.ok(issuer.passwordMatches("newbie", "another long one"))
        await broker.logoutAll(created.subject)
        await assert.rejects(broker.refresh(session.refreshToken), thrown("credentials-rejected"))
    })

    it("maps a taken email and a refused password to their kinds", async () => {
        const { broker } = await setup()
        await assert.rejects(broker.createUser({ email: "mai@example.test", username: "mai2", password: "long enough 1" }), thrown("email-registered"))
        await assert.rejects(broker.createUser({ email: "q@example.test", username: "q", password: "x" }), thrown("password-invalid"))
        await assert.rejects(broker.resetPassword("user-9", "x"), thrown("password-invalid"))
    })

    it("carries the kinds on the codes", () => {
        assert.equal(new OidcError(OIDC_ERROR_CODES.CredentialsRejected).kind, "credentials-rejected")
        assert.equal(new OidcError(OIDC_ERROR_CODES.EmailRegistered).kind, "email-registered")
        assert.equal(new OidcError(OIDC_ERROR_CODES.PasswordInvalid).kind, "password-invalid")
        assert.equal(new OidcError(OIDC_ERROR_CODES.SocialRejected).kind, "social-rejected")
        assert.equal(new OidcError(OIDC_ERROR_CODES.Unavailable).kind, "unavailable")
    })
})
