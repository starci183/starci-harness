import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/oidc.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import { OidcDiscovery, discoveryUrl, readMetadata } from "./discovery.ts"
import { OidcError } from "./errors.ts"
import { resolveOptions } from "./options.ts"
import type { OidcHttp } from "./options.ts"

const DISCOVERY = "/.well-known/openid-configuration"

const setup = async (): Promise<{ issuer: FakeOidcIssuer; clock: FakeClock; discovery: OidcDiscovery }> => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock })
    return { issuer, clock, discovery: new OidcDiscovery(resolveOptions(issuer.options())) }
}

const rejects = (code: string): ((error: unknown) => boolean) => (error: unknown) => error instanceof OidcError && error.code === code

describe("OidcDiscovery", () => {
    it("builds the discovery address of an issuer, with or without a trailing slash", () => {
        assert.equal(discoveryUrl("https://idp.test/realms/a"), "https://idp.test/realms/a/.well-known/openid-configuration")
        assert.equal(discoveryUrl("https://idp.test/realms/a/"), "https://idp.test/realms/a/.well-known/openid-configuration")
    })

    it("reads the endpoints of the issuer's own document", async () => {
        const { issuer, discovery } = await setup()
        const metadata = await discovery.get()
        assert.equal(metadata.issuer, issuer.issuer)
        assert.equal(metadata.jwksUri, `${issuer.issuer}/protocol/openid-connect/certs`)
        assert.equal(metadata.tokenEndpoint, `${issuer.issuer}/protocol/openid-connect/token`)
        assert.equal(metadata.authorizationEndpoint, `${issuer.issuer}/protocol/openid-connect/auth`)
        assert.equal(metadata.endSessionEndpoint, `${issuer.issuer}/protocol/openid-connect/logout`)
    })

    it("asks once for concurrent callers and once per cache life", async () => {
        const { issuer, clock, discovery } = await setup()
        await Promise.all([discovery.get(), discovery.get(), discovery.get()])
        await discovery.get()
        assert.equal(issuer.count(DISCOVERY), 1)
        clock.advance(3_600_001)
        await discovery.get()
        assert.equal(issuer.count(DISCOVERY), 2)
    })

    it("throws Unavailable when the provider is down or answers an error, and recovers when it is back", async () => {
        const { issuer, discovery } = await setup()
        issuer.setDown(true)
        await assert.rejects(discovery.get(), rejects(OIDC_ERROR_CODES.Unavailable))
        issuer.setDown(false)
        issuer.failNext({ status: 503 })
        await assert.rejects(discovery.get(), rejects(OIDC_ERROR_CODES.Unavailable))
        assert.equal((await discovery.get()).issuer, issuer.issuer)
    })

    it("never keeps stale endpoints through an outage: past its life the document is asked for again", async () => {
        const { issuer, clock, discovery } = await setup()
        await discovery.get()
        clock.advance(3_600_001)
        issuer.setDown(true)
        await assert.rejects(discovery.get(), rejects(OIDC_ERROR_CODES.Unavailable))
    })

    const options = resolveOptions({ issuer: "https://idp.example.test/realms/app", audience: "api" })
    const document = {
        issuer: options.issuer,
        authorization_endpoint: `${options.issuer}/auth`,
        token_endpoint: `${options.issuer}/token`,
        jwks_uri: `${options.issuer}/certs`,
    }

    it("rejects a document of another issuer", () => {
        assert.throws(() => readMetadata({ ...document, issuer: "https://evil.example.test/realms/app" }, options), rejects(OIDC_ERROR_CODES.Rejected))
        assert.throws(() => readMetadata("nope", options), rejects(OIDC_ERROR_CODES.Rejected))
    })

    it("rejects an endpoint on another origin, over http, with credentials or a fragment, or one that is not text", () => {
        for (const jwks_uri of ["https://evil.example.test/certs", `http://idp.example.test/certs`, "https://u:p@idp.example.test/certs", `${options.issuer}/certs#x`, 12, undefined]) {
            assert.throws(() => readMetadata({ ...document, jwks_uri }, options), rejects(OIDC_ERROR_CODES.Rejected))
        }
        assert.throws(() => readMetadata({ ...document, end_session_endpoint: "https://evil.example.test/logout" }, options), rejects(OIDC_ERROR_CODES.Rejected))
    })

    it("accepts a provider without an end-session endpoint", () => {
        assert.equal(readMetadata(document, options).endSessionEndpoint, undefined)
    })

    it("reports a transport failure of the injected port as Unavailable with the cause", async () => {
        const cause = new Error("boom")
        const http: OidcHttp = { request: () => Promise.reject(cause) }
        const discovery = new OidcDiscovery(resolveOptions({ issuer: "https://idp.example.test/realms/app", audience: "api", http }))
        await assert.rejects(discovery.get(), (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.Unavailable && error.cause === cause)
    })
})
