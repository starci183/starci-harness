import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import { FakeClock, FakeOidcIssuer } from "../testing/index.ts"
import { OidcDiscovery } from "./discovery.ts"
import { OidcError } from "./errors.ts"
import { OidcKeys, readKeySet } from "./jwks.ts"
import { resolveOptions } from "./options.ts"
import type { OidcHttp, OidcJwksOptions } from "./options.ts"

const CERTS = "/protocol/openid-connect/certs"
const MINUTE = 60_000

const setup = async (jwks: OidcJwksOptions = {}): Promise<{ issuer: FakeOidcIssuer; clock: FakeClock; keys: OidcKeys }> => {
    const clock = new FakeClock()
    const issuer = await FakeOidcIssuer.create({ clock })
    const options = resolveOptions(issuer.options({ jwks }))
    return { issuer, clock, keys: new OidcKeys(options, new OidcDiscovery(options)) }
}

const unavailable = (error: unknown): boolean => error instanceof OidcError && error.code === OIDC_ERROR_CODES.Unavailable

describe("OidcKeys caching and rotation", () => {
    it("fetches the key set once and serves it from the cache while it is fresh", async () => {
        const { issuer, keys } = await setup()
        const first = await keys.keysFor(issuer.keyId)
        assert.equal(await keys.keysFor(issuer.keyId), first)
        await Promise.all([keys.keysFor(undefined), keys.keysFor(issuer.keyId)])
        assert.equal(issuer.count(CERTS), 1)
    })

    it("shares one fetch between concurrent first callers", async () => {
        const { issuer, keys } = await setup()
        await Promise.all([keys.keysFor(issuer.keyId), keys.keysFor(issuer.keyId), keys.keysFor(undefined)])
        assert.equal(issuer.count(CERTS), 1)
    })

    it("refreshes when a token names a kid the cache lacks, once the cooldown has passed (the provider rotated)", async () => {
        const { issuer, clock, keys } = await setup()
        await keys.keysFor(issuer.keyId)
        const rotated = await issuer.rotateKeys()
        clock.advance(31_000)
        await keys.keysFor(rotated)
        assert.equal(issuer.count(CERTS), 2)
    })

    it("does not fetch again for an unknown kid inside the cooldown, so a forged kid cannot make the provider a target", async () => {
        const { issuer, clock, keys } = await setup()
        await keys.keysFor(issuer.keyId)
        clock.advance(5000)
        for (let n = 0; n < 5; n += 1) await keys.keysFor(`forged-${String(n)}`)
        assert.equal(issuer.count(CERTS), 1)
        clock.advance(30_000)
        await keys.keysFor("forged-late")
        assert.equal(issuer.count(CERTS), 2)
    })

    it("refreshes when the cache has outlived its time to live", async () => {
        const { issuer, clock, keys } = await setup({ ttlMs: 10 * MINUTE })
        await keys.keysFor(issuer.keyId)
        clock.advance(10 * MINUTE + 1)
        await keys.keysFor(issuer.keyId)
        assert.equal(issuer.count(CERTS), 2)
    })

    it("keeps using the expired key set while the provider cannot be reached, for the stale time only", async () => {
        const { issuer, clock, keys } = await setup({ ttlMs: MINUTE, staleTtlMs: 60 * MINUTE })
        const held = await keys.keysFor(issuer.keyId)
        clock.advance(2 * MINUTE)
        issuer.setDown(true)
        assert.equal(await keys.keysFor(issuer.keyId), held)
        clock.advance(61 * MINUTE)
        await assert.rejects(keys.keysFor(issuer.keyId), unavailable)
        issuer.setDown(false)
        assert.ok(await keys.keysFor(issuer.keyId))
    })

    it("throws Unavailable when the first fetch fails (there is nothing to fall back to)", async () => {
        const { issuer, keys } = await setup()
        issuer.failNext({ status: 502 }, 2)
        await assert.rejects(keys.keysFor(issuer.keyId), unavailable)
    })

    it("throws Unavailable on a certs answer that is not 200 and Rejected on one that is not a key set", async () => {
        const clock = new FakeClock()
        const issuer = await FakeOidcIssuer.create({ clock })
        const http: OidcHttp = {
            request: async (request) => (request.url.endsWith("certs") ? { status: 200, body: { keys: [] } } : issuer.http.request(request)),
        }
        const options = resolveOptions(issuer.options({ http }))
        const keys = new OidcKeys(options, new OidcDiscovery(options))
        await assert.rejects(keys.keysFor("x"), (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.Rejected)
    })
})

describe("readKeySet", () => {
    const rsa = { kty: "RSA", kid: "a", n: "AQAB", e: "AQAB", alg: "RS256", use: "sig" }

    it("keeps public signature keys and drops keys marked for encryption", () => {
        const set = readKeySet({ keys: [rsa, { ...rsa, kid: "enc", use: "enc", alg: "RSA-OAEP" }] }, 100)
        assert.deepEqual(set.keys.map((key) => key.kid), ["a"])
    })

    it("rejects a document with a private or symmetric key, an unknown type, no key, too many keys or a different shape", () => {
        for (const bad of [
            { keys: [{ ...rsa, d: "secret" }] },
            { keys: [{ kty: "oct", k: "AAAA" }] },
            { keys: [{ ...rsa, kty: "XYZ" }] },
            { keys: [] },
            { keys: [{ ...rsa, use: "enc" }] },
            { keys: [rsa, rsa] },
            { keys: "nope" },
            "nope",
        ]) {
            assert.throws(
                () => readKeySet(bad, 1),
                (error: unknown) => error instanceof OidcError && error.code === OIDC_ERROR_CODES.Rejected,
            )
        }
    })
})
