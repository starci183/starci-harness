import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SignJWT, generateKeyPair } from "jose"
import { OIDC_ACCESS_TOKEN_INVALID, OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import type { OidcOutcome, OidcPrincipal } from "../contracts/oidc.ts"
import type { OidcOptions } from "./options.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import type { FakeTokenClaims, MintOverrides } from "../testing/index.ts"
import { OidcError } from "./errors.ts"
import { createOidc } from "./oidc.ts"
import { refuseSessions } from "./verifier.ts"

const setup = async (overrides: Partial<OidcOptions> = {}): Promise<{ issuer: FakeOidcIssuer; clock: FakeClock; verify: (token: string) => Promise<OidcOutcome<OidcPrincipal>> }> => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock, audience: "api" })
    const oidc = createOidc(issuer.options(overrides))
    return { issuer, clock, verify: (token) => oidc.verifier.verify(token) }
}

const reasonOf = (outcome: OidcOutcome<unknown>): unknown => (outcome.kind === "refused" ? outcome.detail?.reason : "accepted")

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url")

describe("OidcPrincipalVerifier accepts a good bearer token", () => {
    it("answers the principal a guard reads: id, authenticated role, session, email, roles, issuer and expiry", async () => {
        const { issuer, clock, verify } = await setup()
        const token = await issuer.mintAccessToken({ sub: "user-9", email: "a@example.test", name: "Ada", username: "ada", roles: ["member", "admin"], sessionId: "sid-1" })
        const outcome = await verify(token)
        assert.equal(outcome.kind, "ok")
        assert.deepEqual(outcome.value, {
            id: "user-9",
            role: "authenticated",
            sessionId: "sid-1",
            email: "a@example.test",
            name: "Ada",
            username: "ada",
            roles: ["admin", "member"],
            issuer: issuer.issuer,
            expiresAt: new Date(clock.now().getTime() + 300_000),
        })
    })

    it("falls back from sid to jti for the session id, and omits the optional claims it lacks", async () => {
        const { issuer, verify } = await setup()
        const noSid = await verify(await issuer.mintAccessToken({ sub: "u", extra: { sid: undefined } }))
        assert.equal(noSid.kind === "ok" && noSid.value.sessionId.length > 0 && noSid.value.sessionId !== "u", true)
        const bare = await verify(await issuer.mintAccessToken({ sub: "u" }))
        assert.equal(bare.kind === "ok" && "email" in bare.value, false)
    })

    it("accepts a token whose audience list names the audience among others", async () => {
        const { issuer, verify } = await setup()
        assert.equal((await verify(await issuer.mintAccessToken({}, { audience: ["account", "api"] }))).kind, "ok")
    })
})

describe("OidcPrincipalVerifier refuses what it must not trust", () => {
    const cases: readonly (readonly [string, MintOverrides, string])[] = [
        ["an expired token", { expiresInSeconds: -60 }, "expired"],
        ["a token from the wrong issuer", { issuer: "https://evil.example.test/realms/test" }, "issuer"],
        ["a token for another audience", { audience: "another-api" }, "audience"],
        ["a token not valid yet", { notBefore: new Date(Date.UTC(2026, 0, 2)) }, "not-yet-valid"],
        ["a token signed by a key the issuer does not publish", { signer: "foreign" }, "signature"],
        ["a token whose kid the issuer does not publish", { kid: "no-such-key" }, "signature"],
        ["an ID token presented as a bearer", { type: "ID" }, "token-type"],
        ["a refresh token presented as a bearer", { type: "Refresh" }, "token-type"],
    ]
    for (const [name, overrides, reason] of cases) {
        it(`refuses ${name}`, async () => {
            const { issuer, verify } = await setup()
            const outcome = await verify(await issuer.mintAccessToken({}, overrides))
            assert.equal(outcome.kind, "refused")
            assert.equal(outcome.code, OIDC_ACCESS_TOKEN_INVALID)
            assert.equal(reasonOf(outcome), reason)
        })
    }

    it("refuses an alg none token before any key is looked up", async () => {
        const { issuer, verify } = await setup()
        const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: issuer.issuer, sub: "u", aud: "api", exp: Math.floor(Date.now() / 1000) + 600 })}.`
        assert.equal(reasonOf(await verify(unsigned)), "algorithm")
        assert.equal(issuer.count("/protocol/openid-connect/certs"), 0)
    })

    it("refuses an HS256 token signed with a secret (the key confusion), and every algorithm the registration did not pin", async () => {
        const { issuer, verify } = await setup()
        const symmetric = await new SignJWT({ sub: "u" })
            .setProtectedHeader({ alg: "HS256", kid: issuer.keyId })
            .setIssuer(issuer.issuer)
            .setAudience("api")
            .setExpirationTime("10m")
            .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-length-0123456789"))
        assert.equal(reasonOf(await verify(symmetric)), "algorithm")
        const other = await setup({ algorithms: ["ES256"] })
        assert.equal(reasonOf(await other.verify(await other.issuer.mintAccessToken())), "algorithm")
    })

    it("refuses text that is not a token, a token with a tampered payload, and a token without a subject", async () => {
        const { issuer, verify } = await setup()
        for (const junk of ["", "abc", "a.b.c", "....", `${b64({ alg: "RS256" })}.e30.AAAA`]) assert.equal((await verify(junk)).kind, "refused")
        const [header, payload, signature] = (await issuer.mintAccessToken({ sub: "u" })).split(".")
        const forged = `${header ?? ""}.${b64({ ...(JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as object), sub: "admin" })}.${signature ?? ""}`
        assert.equal(reasonOf(await verify(forged)), "signature")
        const noSub = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(issuer.issuer).setAudience("api").setExpirationTime("10m").sign((await generateKeyPair("RS256")).privateKey)
        assert.equal((await verify(noSub)).kind, "refused")
    })

    it("applies the authorized party when the registration names one", async () => {
        const { issuer, verify } = await setup({ authorizedParty: "other-client" })
        assert.equal(reasonOf(await verify(await issuer.mintAccessToken())), "authorized-party")
        const same = await setup({ authorizedParty: "test-client" })
        assert.equal((await same.verify(await same.issuer.mintAccessToken())).kind, "ok")
    })

    it("tolerates the configured clock skew and no more", async () => {
        const { issuer, clock, verify } = await setup({ clockToleranceSeconds: 5 })
        const token = await issuer.mintAccessToken({}, { expiresInSeconds: 10 })
        clock.advance(13_000)
        assert.equal((await verify(token)).kind, "ok")
        clock.advance(3000)
        assert.equal(reasonOf(await verify(token)), "expired")
    })
})

describe("OidcPrincipalVerifier rotation and outage", () => {
    it("verifies tokens of the old key and the new one after the provider rotates", async () => {
        const { issuer, clock, verify } = await setup()
        const before = await issuer.mintAccessToken({ sub: "old" })
        assert.equal((await verify(before)).kind, "ok")
        await issuer.rotateKeys()
        clock.advance(31_000)
        const after = await issuer.mintAccessToken({ sub: "new" })
        assert.equal((await verify(after)).kind, "ok")
        assert.equal((await verify(before)).kind, "ok")
        assert.equal(issuer.count("/protocol/openid-connect/certs"), 2)
    })

    it("refuses a token of a key the provider retired", async () => {
        const { issuer, clock, verify } = await setup()
        const before = await issuer.mintAccessToken()
        assert.equal((await verify(before)).kind, "ok")
        await issuer.rotateKeys({ keepOld: false })
        // The cached key set serves until its time to live ends; after it the retired key is gone.
        assert.equal((await verify(before)).kind, "ok")
        clock.advance(10 * 60_000 + 1000)
        assert.equal(reasonOf(await verify(before)), "signature")
    })

    it("throws an unavailable error, never a refusal, when the provider cannot be asked and nothing is cached", async () => {
        const { issuer, verify } = await setup()
        const token = await issuer.mintAccessToken()
        issuer.setDown(true)
        await assert.rejects(verify(token), (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.Unavailable && error.kind === "unavailable")
    })

    it("keeps verifying from the cached keys through an outage", async () => {
        const { issuer, clock, verify } = await setup()
        const token = await issuer.mintAccessToken({}, { expiresInSeconds: 3600 })
        assert.equal((await verify(token)).kind, "ok")
        clock.advance(11 * 60_000)
        issuer.setDown(true)
        assert.equal((await verify(token)).kind, "ok")
    })
})

describe("role mapping", () => {
    it("reads the realm roles, the roles of each mapped client and each mapped flat claim, sorted without repeats", async () => {
        const { issuer, verify } = await setup({ roles: { clients: ["api"], claims: ["groups"] } })
        const claims: FakeTokenClaims = { roles: ["b", "a"], clientRoles: { api: ["a", "c"], other: ["z"] }, extra: { groups: ["/team", "b"] } }
        const outcome = await verify(await issuer.mintAccessToken(claims))
        assert.deepEqual(outcome.kind === "ok" && outcome.value.roles, ["/team", "a", "b", "c"])
    })

    it("reads no realm role when the mapping turns the realm off, and no roles when a token has none", async () => {
        const { issuer, verify } = await setup({ roles: { realm: false, clients: ["api"] } })
        const outcome = await verify(await issuer.mintAccessToken({ roles: ["realm-only"], clientRoles: { api: ["c"] } }))
        assert.deepEqual(outcome.kind === "ok" && outcome.value.roles, ["c"])
        const none = await verify(await issuer.mintAccessToken({}))
        assert.deepEqual(none.kind === "ok" && none.value.roles, [])
    })

    it("refuses a token whose role claims have the wrong shape or exceed the bounds", async () => {
        const wrong: readonly FakeTokenClaims[] = [
            { extra: { realm_access: "admin" } },
            { extra: { realm_access: { roles: "admin" } } },
            { extra: { realm_access: { roles: [1, 2] } } },
            { extra: { realm_access: { roles: [""] } } },
            { extra: { realm_access: { roles: ["x".repeat(257)] } } },
            { roles: Array.from({ length: 129 }, (_, n) => `r${String(n)}`) },
            { extra: { resource_access: "api" } },
            { extra: { resource_access: { api: { roles: "x" } } } },
            { extra: { groups: "x" } },
        ]
        const { issuer, verify } = await setup({ roles: { clients: ["api"], claims: ["groups"] } })
        for (const claims of wrong) assert.equal(reasonOf(await verify(await issuer.mintAccessToken(claims))), "claims", JSON.stringify(claims).slice(0, 60))
    })

    it("refuses a token whose roles together pass the bound although no claim does", async () => {
        const { issuer, verify } = await setup({ roles: { clients: ["api"] } })
        const many = (prefix: string): string[] => Array.from({ length: 100 }, (_, n) => `${prefix}${String(n)}`)
        assert.equal(reasonOf(await verify(await issuer.mintAccessToken({ roles: many("a"), clientRoles: { api: many("b") } }))), "claims")
    })
})

describe("refuseSessions", () => {
    it("refuses every token, so the default-deny guard admits only public and credential doors", async () => {
        const outcome = await refuseSessions.verify("anything")
        assert.equal(outcome.kind, "refused")
    })
})
