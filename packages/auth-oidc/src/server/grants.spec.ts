import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import { OidcError } from "./errors.ts"
import { createOidc } from "./oidc.ts"
import type { OidcOptions } from "./options.ts"
import { refreshOf } from "./refresh.ts"

const CALLBACK = "https://app.example.test/api/session/callback"
const TOKEN = "/protocol/openid-connect/token"

const thrown = (code: string): ((error: unknown) => boolean) => (error: unknown) => error instanceof OidcError && error.code === code

const setup = async (overrides: Partial<OidcOptions> = {}, issuerOptions: Parameters<typeof FakeOidcIssuer.create>[0] = {}) => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, clientSecret: "s3cret", ...issuerOptions })
    const oidc = createOidc(issuer.options({ callbackUri: CALLBACK, ...overrides }))
    issuer.seedUser({ id: "user-9", username: "mai", email: "mai@example.test", password: "correct horse", roles: ["learner"] })
    return { issuer, clock, tokens: oidc.tokenClient }
}

describe("OidcTokenClient passwordGrant", () => {
    it("signs in by username or email and answers the verified principal, the refresh token and its expiry, never the access token", async () => {
        const { issuer, clock, tokens } = await setup()
        for (const identifier of ["mai", "MAI@example.test"]) {
            const grant = await tokens.passwordGrant(identifier, "correct horse")
            assert.equal(grant.subject, "user-9")
            assert.deepEqual(grant.roles, ["learner"])
            assert.equal(grant.email, "mai@example.test")
            assert.equal(grant.principal.id, "user-9")
            assert.equal(grant.principal.username, "mai")
            assert.equal(grant.refreshExpiresAt.getTime(), clock.now().getTime() + 1800 * 1000)
            assert.ok(grant.refreshToken.length > 0)
            assert.equal(Object.values(grant).includes("access_token"), false)
            assert.equal("accessToken" in grant, false)
        }
        assert.equal(issuer.count(TOKEN), 2)
    })

    it("sends the client registration, the grant and the configured scope with the secret only in the form", async () => {
        const seen: Record<string, string>[] = []
        const { issuer } = await setup()
        const oidc = createOidc(
            issuer.options({
                callbackUri: CALLBACK,
                http: {
                    request: (request) => {
                        if (request.form !== undefined) seen.push({ ...request.form })
                        return issuer.http.request(request)
                    },
                },
            }),
        )
        await oidc.tokenClient.passwordGrant("mai", "correct horse")
        assert.deepEqual(seen[0], { client_id: "test-client", client_secret: "s3cret", grant_type: "password", username: "mai", password: "correct horse", scope: "openid" })
    })

    it("answers null for a token without an email", async () => {
        const { issuer, tokens } = await setup()
        issuer.seedUser({ username: "noemail", password: "password-1" })
        assert.equal((await tokens.passwordGrant("noemail", "password-1")).email, null)
    })

    it("throws CredentialsRejected for a wrong password, an unknown account and a disabled one", async () => {
        const { issuer, tokens } = await setup()
        issuer.seedUser({ username: "off", password: "password-1", enabled: false })
        for (const [name, password] of [["mai", "wrong"], ["nobody", "x"], ["off", "password-1"]] as const) {
            await assert.rejects(tokens.passwordGrant(name, password), thrown(OIDC_ERROR_CODES.CredentialsRejected))
        }
    })

    it("throws Unavailable for an outage, a lost connection and a throttle, and Rejected for a client the provider does not know", async () => {
        const { issuer, tokens } = await setup()
        issuer.failNext({ status: 503 })
        await assert.rejects(tokens.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Unavailable))
        issuer.failNext({ status: 429 })
        await assert.rejects(tokens.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Unavailable))
        issuer.failNext("network")
        await assert.rejects(tokens.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Unavailable))
        issuer.setDown(true)
        await assert.rejects(tokens.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Unavailable))
        const wrongSecret = createOidc(issuer.options({ callbackUri: CALLBACK, client: { clientId: "test-client", clientSecret: "other", callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/out" } }))
        issuer.setDown(false)
        await assert.rejects(wrongSecret.tokenClient.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Rejected))
    })

    it("refuses an answer whose access token the verifier refuses, one without a refresh token and one that is not an object", async () => {
        const { issuer } = await setup()
        const wrongAudience = createOidc(issuer.options({ callbackUri: CALLBACK, audience: "someone-else" }))
        await assert.rejects(wrongAudience.tokenClient.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Rejected))
        // the discovery document comes from the issuer, only the token endpoint answers the bent body
        for (const body of [{ access_token: "x" }, "text", { refresh_token: "r", refresh_expires_in: 10 }, { access_token: "x", refresh_token: "r", refresh_expires_in: 10 }]) {
            const bent = createOidc(issuer.options({ callbackUri: CALLBACK, http: { request: (request) => (request.url.endsWith(TOKEN) ? Promise.resolve({ status: 200, body }) : issuer.http.request(request)) } }))
            await assert.rejects(bent.tokenClient.passwordGrant("mai", "correct horse"), thrown(OIDC_ERROR_CODES.Rejected))
        }
    })

    it("needs a registered client", async () => {
        const issuer = await FakeOidcIssuer.create()
        const { tokenClient } = createOidc(issuer.options())
        await assert.rejects(tokenClient.passwordGrant("mai", "x"), thrown(OIDC_ERROR_CODES.ConfigurationInvalid))
        await assert.rejects(tokenClient.refresh("r"), thrown(OIDC_ERROR_CODES.ConfigurationInvalid))
        await assert.rejects(tokenClient.revoke("r"), thrown(OIDC_ERROR_CODES.ConfigurationInvalid))
    })
})

describe("OidcTokenClient refresh", () => {
    it("rotates the refresh token and answers the same account", async () => {
        const { tokens } = await setup()
        const first = await tokens.passwordGrant("mai", "correct horse")
        const second = await tokens.refresh(first.refreshToken)
        assert.equal(second.subject, "user-9")
        assert.notEqual(second.refreshToken, first.refreshToken)
        await assert.rejects(tokens.refresh(first.refreshToken), thrown(OIDC_ERROR_CODES.CredentialsRejected))
    })

    it("throws CredentialsRejected once the provider ended the session, and Unavailable in an outage", async () => {
        const { issuer, tokens } = await setup()
        const grant = await tokens.passwordGrant("mai", "correct horse")
        issuer.failNext({ status: 502 })
        await assert.rejects(tokens.refresh(grant.refreshToken), thrown(OIDC_ERROR_CODES.Unavailable))
        issuer.revokeRefreshTokens()
        await assert.rejects(tokens.refresh(grant.refreshToken), thrown(OIDC_ERROR_CODES.CredentialsRejected))
    })
})

describe("OidcTokenClient revoke", () => {
    it("ends the session at the advertised revocation endpoint, so the refresh token no longer works", async () => {
        const { issuer, tokens } = await setup()
        const grant = await tokens.passwordGrant("mai", "correct horse")
        await tokens.revoke(grant.refreshToken)
        assert.equal(issuer.count("/protocol/openid-connect/revoke"), 1)
        await assert.rejects(tokens.refresh(grant.refreshToken), thrown(OIDC_ERROR_CODES.CredentialsRejected))
        await tokens.revoke("never-issued")
    })

    it("falls back to the end-session endpoint with the refresh token when no revocation endpoint is advertised, and a token it no longer knows is already ended", async () => {
        const { issuer, tokens } = await setup({}, { revocation: false })
        const grant = await tokens.passwordGrant("mai", "correct horse")
        await tokens.revoke(grant.refreshToken)
        assert.equal(issuer.count("/protocol/openid-connect/logout"), 1)
        assert.equal(issuer.count("/protocol/openid-connect/revoke"), 0)
        await assert.rejects(tokens.refresh(grant.refreshToken), thrown(OIDC_ERROR_CODES.CredentialsRejected))
        await tokens.revoke(grant.refreshToken)
    })

    it("is Rejected when the provider advertises neither endpoint or refuses the client, and Unavailable in an outage", async () => {
        const { issuer, tokens } = await setup()
        const bare = createOidc(
            issuer.options({
                callbackUri: CALLBACK,
                http: {
                    request: async (request) => {
                        const answer = await issuer.http.request(request)
                        if (!request.url.endsWith("/.well-known/openid-configuration") || typeof answer.body !== "object" || answer.body === null) return answer
                        return { status: answer.status, body: { ...answer.body, end_session_endpoint: undefined, revocation_endpoint: undefined } }
                    },
                },
            }),
        )
        await assert.rejects(bare.tokenClient.revoke("r"), thrown(OIDC_ERROR_CODES.Rejected))
        const wrongSecret = createOidc(issuer.options({ callbackUri: CALLBACK, client: { clientId: "test-client", clientSecret: "other", callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/out" } }))
        await assert.rejects(wrongSecret.tokenClient.revoke("r"), thrown(OIDC_ERROR_CODES.Rejected))
        issuer.failNext({ status: 500 })
        await assert.rejects(tokens.revoke("r"), thrown(OIDC_ERROR_CODES.Unavailable))
    })
})

describe("refreshOf", () => {
    const now = new Date(Date.UTC(2026, 0, 1))

    it("dates a refresh token by refresh_expires_in, else by its own exp, else not at all", () => {
        assert.equal(refreshOf({ refresh_token: "r", refresh_expires_in: 60 }, now)?.refreshExpiresAt.getTime(), now.getTime() + 60_000)
        const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url")}.sig`
        assert.equal(refreshOf({ refresh_token: jwt, refresh_expires_in: 0 }, now)?.refreshExpiresAt.getTime(), 2_000_000_000_000)
        assert.equal(refreshOf({ refresh_token: "opaque" }, now), undefined)
        assert.equal(refreshOf({ refresh_token: "", refresh_expires_in: 5 }, now), undefined)
        assert.equal(refreshOf(undefined, now), undefined)
    })
})
