import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import { adminBaseOf } from "./admin.ts"
import { OidcError } from "./errors.ts"
import { createOidc } from "./oidc.ts"
import type { OidcHttp, OidcOptions } from "./options.ts"

const CALLBACK = "https://app.example.test/api/session/callback"
const TOKEN = "/protocol/openid-connect/token"

const thrown = (code: string): ((error: unknown) => boolean) => (error: unknown) => error instanceof OidcError && error.code === code

const setup = async (overrides: Partial<OidcOptions> = {}) => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, clientSecret: "s3cret" })
    const oidc = createOidc(issuer.options({ callbackUri: CALLBACK, ...overrides }))
    return { issuer, clock, admin: oidc.admin }
}

describe("adminBaseOf", () => {
    it("derives the realm admin base from the issuer, keeping a path prefix", () => {
        assert.equal(adminBaseOf("https://sso.example.test/realms/academy"), "https://sso.example.test/admin/realms/academy")
        assert.equal(adminBaseOf("https://sso.example.test/auth/realms/academy/"), "https://sso.example.test/auth/admin/realms/academy")
    })

    it("refuses an issuer that is not shaped like a realm", () => {
        for (const issuer of ["https://sso.example.test", "https://sso.example.test/realms/", "https://sso.example.test/realms/a/b"]) {
            assert.throws(() => adminBaseOf(issuer), thrown(OIDC_ERROR_CODES.ConfigurationInvalid))
        }
    })
})

describe("OidcAdminClient createUser", () => {
    it("creates an account with a permanent password and answers its subject", async () => {
        const { issuer, admin } = await setup()
        const created = await admin.createUser({ email: "new@example.test", username: "newbie", password: "long enough 1" })
        assert.equal(issuer.findUser(created.subject)?.email, "new@example.test")
        assert.ok(issuer.passwordMatches("newbie", "long enough 1"))
        assert.ok(issuer.requests.some((request) => request.method === "POST" && request.path === "/admin/realms/test/users"))
    })

    it("reads the subject from a lookup by username when the answer carries no Location", async () => {
        const { issuer } = await setup()
        const stripped: OidcHttp = {
            request: async (request) => {
                const answer = await issuer.http.request(request)
                return { status: answer.status, body: answer.body }
            },
        }
        const wired = createOidc(issuer.options({ callbackUri: CALLBACK, http: stripped })).admin
        const created = await wired.createUser({ email: "a@example.test", username: "alpha", password: "long enough 1" })
        assert.equal(issuer.findUser("alpha")?.id, created.subject)
    })

    it("throws EmailRegistered on a conflict, PasswordInvalid when the policy refuses and Rejected for another refusal", async () => {
        const { issuer, admin } = await setup()
        issuer.seedUser({ username: "taken", email: "taken@example.test", password: "long enough 1" })
        await assert.rejects(admin.createUser({ email: "TAKEN@example.test", username: "other", password: "long enough 1" }), thrown(OIDC_ERROR_CODES.EmailRegistered))
        await assert.rejects(admin.createUser({ email: "x@example.test", username: "taken", password: "long enough 1" }), thrown(OIDC_ERROR_CODES.EmailRegistered))
        await assert.rejects(admin.createUser({ email: "y@example.test", username: "yy", password: "short" }), thrown(OIDC_ERROR_CODES.PasswordInvalid))
        const refusing = createOidc(issuer.options({ callbackUri: CALLBACK, http: { request: (request) => (request.method === "POST" && request.url.endsWith("/users") ? Promise.resolve({ status: 400, body: { error: "invalid_email" } }) : issuer.http.request(request)) } })).admin
        await assert.rejects(refusing.createUser({ email: "z@example.test", username: "zz", password: "long enough 1" }), thrown(OIDC_ERROR_CODES.Rejected))
    })
})

describe("OidcAdminClient findUserByEmail", () => {
    it("finds the account by its exact email, case-insensitively, and answers null for a stranger", async () => {
        const { issuer, admin } = await setup()
        const seeded = issuer.seedUser({ username: "mai", email: "Mai@Example.test", password: "long enough 1" })
        assert.deepEqual(await admin.findUserByEmail("mai@example.TEST"), { subject: seeded.id, username: "mai" })
        assert.equal(await admin.findUserByEmail("nobody@example.test"), null)
    })

    it("is Rejected for an answer that is not a user list and ignores entries without an id", async () => {
        const { issuer } = await setup()
        const answering = (body: unknown): ReturnType<typeof createOidc>["admin"] =>
            createOidc(issuer.options({ callbackUri: CALLBACK, http: { request: (request) => (request.url.includes("/admin/") && request.method === "GET" ? Promise.resolve({ status: 200, body }) : issuer.http.request(request)) } })).admin
        await assert.rejects(answering({ not: "a list" }).findUserByEmail("a@example.test"), thrown(OIDC_ERROR_CODES.Rejected))
        assert.equal(await answering([{ username: "no-id", email: "a@example.test" }, 7]).findUserByEmail("a@example.test"), null)
    })
})

describe("OidcAdminClient resetPassword and logoutAll", () => {
    it("sets a new password, so the old one stops working", async () => {
        const { issuer, admin } = await setup()
        const user = issuer.seedUser({ username: "mai", email: "mai@example.test", password: "old password" })
        await admin.resetPassword(user.id, "brand new password")
        assert.ok(issuer.passwordMatches("mai", "brand new password"))
        assert.equal(issuer.passwordMatches("mai", "old password"), false)
    })

    it("throws PasswordInvalid for a refused password and Rejected for an unknown account", async () => {
        const { issuer, admin } = await setup()
        const user = issuer.seedUser({ username: "mai", password: "old password" })
        await assert.rejects(admin.resetPassword(user.id, "short"), thrown(OIDC_ERROR_CODES.PasswordInvalid))
        await assert.rejects(admin.resetPassword("ghost", "long enough 1"), thrown(OIDC_ERROR_CODES.Rejected))
        await assert.rejects(admin.logoutAll("ghost"), thrown(OIDC_ERROR_CODES.Rejected))
    })

    it("ends every session of the account", async () => {
        const { issuer } = await setup()
        const oidc = createOidc(issuer.options({ callbackUri: CALLBACK }))
        const user = issuer.seedUser({ username: "mai", password: "long enough 1" })
        const grant = await oidc.tokenClient.passwordGrant("mai", "long enough 1")
        assert.equal(issuer.liveRefreshTokens, 1)
        await oidc.admin.logoutAll(user.id)
        assert.equal(issuer.liveRefreshTokens, 0)
        await assert.rejects(oidc.tokenClient.refresh(grant.refreshToken), thrown(OIDC_ERROR_CODES.CredentialsRejected))
    })
})

describe("OidcAdminClient service account", () => {
    it("takes one client-credentials token for concurrent calls and keeps it until it is about to expire", async () => {
        const { issuer, clock, admin } = await setup()
        await Promise.all([admin.findUserByEmail("a@example.test"), admin.findUserByEmail("b@example.test")])
        await admin.findUserByEmail("c@example.test")
        assert.equal(issuer.count(TOKEN), 1)
        clock.advance(295 * 1000)
        await admin.findUserByEmail("d@example.test")
        assert.equal(issuer.count(TOKEN), 2)
    })

    it("renews a token the provider turns away and repeats the request once", async () => {
        const { issuer, admin } = await setup()
        await admin.findUserByEmail("a@example.test")
        issuer.failNext({ status: 401 })
        assert.equal(await admin.findUserByEmail("a@example.test"), null)
        assert.equal(issuer.count(TOKEN), 2)
    })

    it("sends the token as a bearer and the realm admin address derived from the issuer", async () => {
        const sent: { url: string; authorization: string | undefined }[] = []
        const { issuer } = await setup()
        const admin = createOidc(
            issuer.options({
                callbackUri: CALLBACK,
                http: {
                    request: (request) => {
                        if (request.url.includes("/admin/")) sent.push({ url: request.url, authorization: request.headers?.authorization })
                        return issuer.http.request(request)
                    },
                },
            }),
        ).admin
        await admin.findUserByEmail("a@example.test")
        assert.equal(sent[0]?.url, "https://idp.test/admin/realms/test/users?email=a%40example.test&exact=true")
        assert.match(sent.at(0)?.authorization ?? "", /^Bearer ey/u)
    })

    it("is a configuration error without a client secret, Rejected when the provider refuses the client, Unavailable in an outage", async () => {
        const { issuer } = await setup()
        const noSecret = createOidc(issuer.options({ callbackUri: CALLBACK, client: { clientId: "test-client", callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/out" } })).admin
        await assert.rejects(noSecret.findUserByEmail("a@example.test"), thrown(OIDC_ERROR_CODES.ConfigurationInvalid))
        const none = createOidc(issuer.options()).admin
        await assert.rejects(none.findUserByEmail("a@example.test"), thrown(OIDC_ERROR_CODES.ConfigurationInvalid))
        const wrong = createOidc(issuer.options({ callbackUri: CALLBACK, client: { clientId: "test-client", clientSecret: "other", callbackUri: CALLBACK, postLogoutUri: "https://app.example.test/out" } })).admin
        await assert.rejects(wrong.findUserByEmail("a@example.test"), thrown(OIDC_ERROR_CODES.Rejected))
        const { issuer: down, admin } = await setup()
        down.setDown(true)
        await assert.rejects(admin.findUserByEmail("a@example.test"), thrown(OIDC_ERROR_CODES.Unavailable))
    })

    it("a token the provider turns away twice is Rejected", async () => {
        const { issuer } = await setup()
        const admin = createOidc(issuer.options({ callbackUri: CALLBACK, http: { request: (request) => (request.url.includes("/admin/") ? Promise.resolve({ status: 401, body: undefined }) : issuer.http.request(request)) } })).admin
        await assert.rejects(admin.logoutAll("u"), thrown(OIDC_ERROR_CODES.Rejected))
    })
})
