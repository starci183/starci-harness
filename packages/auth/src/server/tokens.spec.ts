import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SignJWT, decodeProtectedHeader } from "jose"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { FakeClock, generateTestKeyPair, testSigningKey } from "../testing/index.ts"
import { AuthError } from "./errors.ts"
import { AuthTokens } from "./tokens.ts"
import type { TokenOptions } from "./tokens.ts"

const options = (keys: TokenOptions["keys"]): TokenOptions => ({ issuer: "https://api.example.test", keys, accessTtlSeconds: 900 })
const claims = { sub: "user-1", email: "a@example.test", sessionId: "session-1" }

describe("AuthTokens sign and verify", () => {
    it("signs an EdDSA token whose header and claims are the ones the contract names", async () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens(options([testSigningKey(undefined, "key-1")]))
        const issued = await tokens.sign(claims, clock.now())
        const header = decodeProtectedHeader(issued.token)
        assert.deepEqual({ alg: header.alg, kid: header.kid, typ: header.typ }, { alg: "EdDSA", kid: "key-1", typ: "JWT" })
        assert.equal(issued.expiresAt.getTime(), clock.now().getTime() + 900_000)
        const verified = await tokens.verify(issued.token, clock.now())
        assert.deepEqual(verified, { kind: "ok", value: claims })
    })

    it("carries the full name as its own claim when the account has one", async () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens(options([testSigningKey()]))
        const { token } = await tokens.sign({ ...claims, name: "Ada Lovelace" }, clock.now())
        assert.deepEqual(await tokens.verify(token, clock.now()), { kind: "ok", value: { ...claims, name: "Ada Lovelace" } })
    })

    it("verifies a token without an email claim", async () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens(options([testSigningKey()]))
        const { token } = await tokens.sign({ sub: "u", sessionId: "s" }, clock.now())
        assert.deepEqual(await tokens.verify(token, clock.now()), { kind: "ok", value: { sub: "u", sessionId: "s" } })
    })

    it("refuses an expired token, a wrong issuer, a wrong audience and a tampered token", async () => {
        const clock = new FakeClock()
        const pair = generateTestKeyPair()
        const tokens = new AuthTokens(options([testSigningKey(pair)]))
        const { token } = await tokens.sign(claims, clock.now())
        clock.advance(901_000)
        assert.equal((await tokens.verify(token, clock.now())).kind, "refused")
        clock.advance(-901_000)
        const otherIssuer = new AuthTokens({ ...options([testSigningKey(pair)]), issuer: "https://elsewhere.test" })
        assert.equal((await otherIssuer.verify(token, clock.now())).kind, "refused")
        const otherAudience = new AuthTokens({ ...options([testSigningKey(pair)]), audience: "someone-else" })
        assert.equal((await otherAudience.verify(token, clock.now())).kind, "refused")
        const [head = "", body = "", signature = ""] = token.split(".")
        const forged = `${head}.${Buffer.from(JSON.stringify({ sub: "admin", role: "authenticated", session_id: "s" })).toString("base64url")}.${signature}`
        assert.equal((await tokens.verify(forged, clock.now())).kind, "refused")
        assert.equal(body.length > 0, true)
        const refusal = await tokens.verify("not-a-jwt", clock.now())
        assert.equal(refusal.kind === "refused" && refusal.code, AUTH_ERROR_CODES.AccessTokenInvalid)
    })

    it("refuses a token signed with another algorithm even when its claims are right", async () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens(options([testSigningKey(undefined, "key-1")]))
        const hmac = await new SignJWT({ role: "authenticated", session_id: "s" })
            .setProtectedHeader({ alg: "HS256", kid: "key-1" })
            .setSubject("u")
            .setIssuer("https://api.example.test")
            .setAudience("authenticated")
            .setExpirationTime(Math.floor(clock.now().getTime() / 1000) + 600)
            .sign(new TextEncoder().encode("a-shared-secret-of-enough-length-0123456789"))
        assert.equal((await tokens.verify(hmac, clock.now())).kind, "refused")
    })

    it("refuses a token that lacks the role or the session claim", async () => {
        const clock = new FakeClock()
        const pair = generateTestKeyPair()
        const key = testSigningKey(pair, "key-1")
        const tokens = new AuthTokens(options([key]))
        const { createPrivateKey } = await import("node:crypto")
        const sign = (payload: Record<string, unknown>): Promise<string> =>
            new SignJWT(payload)
                .setProtectedHeader({ alg: "EdDSA", kid: "key-1" })
                .setSubject("u")
                .setIssuer("https://api.example.test")
                .setAudience("authenticated")
                .setExpirationTime(Math.floor(clock.now().getTime() / 1000) + 600)
                .sign(createPrivateKey(pair.privateKey))
        assert.equal((await tokens.verify(await sign({ role: "anon", session_id: "s" }), clock.now())).kind, "refused")
        assert.equal((await tokens.verify(await sign({ role: "authenticated" }), clock.now())).kind, "refused")
    })
})

describe("AuthTokens key rotation", () => {
    it("publishes every key and keeps a token of the retired key valid until the key is dropped", async () => {
        const clock = new FakeClock()
        const oldPair = generateTestKeyPair()
        const newPair = generateTestKeyPair()
        const before = new AuthTokens(options([testSigningKey(oldPair, "old")]))
        const oldToken = (await before.sign(claims, clock.now())).token

        const during = new AuthTokens(options([testSigningKey(newPair, "new"), testSigningKey(oldPair, "old", false)]))
        const newToken = (await during.sign(claims, clock.now())).token
        assert.equal(decodeProtectedHeader(newToken).kid, "new")
        assert.equal((await during.verify(oldToken, clock.now())).kind, "ok")
        assert.equal((await during.verify(newToken, clock.now())).kind, "ok")
        const document = await during.jwks()
        assert.deepEqual(document.keys.map((key) => key.kid), ["new", "old"])
        assert.deepEqual(document.keys.map((key) => [key.alg, key.use, key.kty, key.crv]), [
            ["EdDSA", "sig", "OKP", "Ed25519"],
            ["EdDSA", "sig", "OKP", "Ed25519"],
        ])
        assert.equal(document.keys.some((key) => "d" in key), false, "no private part is ever published")

        const after = new AuthTokens(options([testSigningKey(newPair, "new")]))
        assert.equal((await after.verify(oldToken, clock.now())).kind, "refused")
        assert.equal((await after.verify(newToken, clock.now())).kind, "ok")
    })

    it("derives the kid from the public key when none is given", async () => {
        const tokens = new AuthTokens(options([testSigningKey()]))
        const [key] = (await tokens.jwks()).keys
        assert.match(key?.kid ?? "", /^[\w-]{43}$/u)
    })

    it("refuses a key set without a signer, with two signers, with a repeated kid or with an unreadable key", async () => {
        const cases: [string, TokenOptions["keys"]][] = [
            ["no signer", [testSigningKey(undefined, "a", false)]],
            ["two signers", [testSigningKey(undefined, "a"), testSigningKey(undefined, "b")]],
            ["repeated kid", [testSigningKey(undefined, "a"), testSigningKey(undefined, "a", false)]],
            ["bad pem", [{ publicKey: "nope", privateKey: "nope" }]],
        ]
        for (const [name, keys] of cases) {
            await assert.rejects(
                new AuthTokens(options(keys)).jwks(),
                (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.KeyInvalid && error.kind === "internal",
                name,
            )
        }
    })

    it("derives the public key from the private key when only the private key is given, and refuses a key with neither", async () => {
        const pair = generateTestKeyPair()
        const derived = new AuthTokens(options([{ privateKey: pair.privateKey, keyId: "d" }]))
        const explicit = new AuthTokens(options([testSigningKey(pair, "d")]))
        assert.deepEqual(await derived.jwks(), await explicit.jwks())
        await assert.rejects(new AuthTokens(options([{ keyId: "none" }])).jwks(), AuthError)
    })

    it("accepts a one-line PEM with escaped line breaks and a secret holder", async () => {
        const pair = generateTestKeyPair()
        const tokens = new AuthTokens(
            options([
                {
                    publicKey: pair.publicKey.replaceAll("\n", String.raw`\n`),
                    privateKey: { reveal: () => pair.privateKey.replaceAll("\n", String.raw`\n`) },
                },
            ]),
        )
        const clock = new FakeClock()
        const { token } = await tokens.sign(claims, clock.now())
        assert.equal((await tokens.verify(token, clock.now())).kind, "ok")
    })
})

describe("AuthTokens signed state", () => {
    it("verifies a state it signed, until it expires, and refuses a foreign or altered one", () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens(options([testSigningKey()]))
        const other = new AuthTokens(options([testSigningKey()]))
        const signed = tokens.signState({ w: "handle", u: "verifier", r: "/home", e: clock.now().getTime() + 1000, p: "google" })
        assert.equal(tokens.verifyState(signed, clock.now())?.w, "handle")
        assert.equal(other.verifyState(signed, clock.now()), null)
        clock.advance(1001)
        assert.equal(tokens.verifyState(signed, clock.now()), null)
        assert.equal(tokens.verifyState(`${signed}x`, new Date(0)), null)
    })

    it("needs a signing key", () => {
        const tokens = new AuthTokens(options([testSigningKey(undefined, "a", false)]))
        assert.throws(() => tokens.signState({ w: "a", u: "b", r: "/", e: 1 }), AuthError)
    })
})
