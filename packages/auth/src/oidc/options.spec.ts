import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import type { OidcAlgorithm } from "../contracts/oidc.ts"
import { OidcError } from "./errors.ts"
import { isAdmissibleUrl, resolveOptions } from "./options.ts"
import type { OidcOptions } from "./options.ts"

const base: OidcOptions = { issuer: "https://idp.example.test/realms/app", audience: "api" }

const refusal = (options: OidcOptions, key: string): void => {
    assert.throws(
        () => resolveOptions(options),
        (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.ConfigurationInvalid && error.kind === "invalid" && error.params.key === key,
    )
}

describe("resolveOptions", () => {
    it("applies the defaults: RS256, the realm roles, ten seconds, five seconds of skew", () => {
        const resolved = resolveOptions(base)
        assert.deepEqual(resolved.algorithms, ["RS256"])
        assert.deepEqual(resolved.audience, ["api"])
        assert.equal(resolved.realmRoles, true)
        assert.equal(resolved.timeoutMs, 10_000)
        assert.equal(resolved.clockToleranceSeconds, 5)
        assert.equal(resolved.client, undefined)
    })

    it("refuses an issuer that is not https, carries credentials, a query or a fragment", () => {
        for (const issuer of ["http://idp.example.test/realms/app", "https://user:pw@idp.example.test/realms/app", "https://idp.example.test/realms/app?x=1", "https://idp.example.test/realms/app#f", "not a url"]) {
            refusal({ ...base, issuer }, "issuer")
        }
    })

    it("admits http only when the registration says it is a developer machine or a double", () => {
        assert.equal(resolveOptions({ ...base, issuer: "http://127.0.0.1:8080/realms/app", allowInsecureHttp: true }).allowInsecureHttp, true)
        assert.equal(isAdmissibleUrl("http://127.0.0.1/x", false), false)
        assert.equal(isAdmissibleUrl("ftp://127.0.0.1/x", true), false)
    })

    it("refuses an empty audience and an unknown, symmetric or unsigned algorithm", () => {
        refusal({ ...base, audience: [] }, "audience")
        refusal({ ...base, audience: [""] }, "audience")
        refusal({ ...base, algorithms: [] }, "algorithms")
        for (const algorithm of ["none", "HS256", "HS512"]) refusal({ ...base, algorithms: [algorithm as OidcAlgorithm] }, "algorithms")
        assert.deepEqual(resolveOptions({ ...base, audience: ["a", "b"], algorithms: ["ES256", "EdDSA"] }).algorithms, ["ES256", "EdDSA"])
    })

    it("refuses a non-positive deadline or cache time and a negative skew", () => {
        refusal({ ...base, timeoutMs: 0 }, "timeoutMs")
        refusal({ ...base, discoveryTtlMs: -1 }, "discoveryTtlMs")
        refusal({ ...base, jwks: { ttlMs: 0 } }, "jwks.ttlMs")
        refusal({ ...base, jwks: { refreshCooldownMs: Number.NaN } }, "jwks.refreshCooldownMs")
        refusal({ ...base, clockToleranceSeconds: -1 }, "clockToleranceSeconds")
        assert.equal(resolveOptions({ ...base, clockToleranceSeconds: 0 }).clockToleranceSeconds, 0)
    })

    it("validates the client registration: an id, an https callback and post-logout address without a query", () => {
        const client = { clientId: "web", callbackUri: "https://app.example.test/callback", postLogoutUri: "https://app.example.test/signed-out" }
        assert.equal(resolveOptions({ ...base, client }).client?.clientId, "web")
        refusal({ ...base, client: { ...client, clientId: "" } }, "client.clientId")
        refusal({ ...base, client: { ...client, callbackUri: "http://app.example.test/callback" } }, "client.callbackUri")
        refusal({ ...base, client: { ...client, callbackUri: "https://app.example.test/callback?x=1" } }, "client.callbackUri")
        refusal({ ...base, client: { ...client, postLogoutUri: "https://app.example.test/out#frag" } }, "client.postLogoutUri")
    })

    it("maps the roles it reads: the realm by default, the named clients and flat claims", () => {
        const resolved = resolveOptions({ ...base, roles: { realm: false, clients: ["api"], claims: ["groups"] } })
        assert.deepEqual([resolved.realmRoles, resolved.roleClients, resolved.roleClaims], [false, ["api"], ["groups"]])
    })
})
