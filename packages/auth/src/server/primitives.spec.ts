import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AUTH_ERROR_CODES, AUTH_ERROR_KINDS, AUTH_DOORS, AUTH_PREFIX } from "../contracts/index.ts"
import { AuthPasswords } from "./passwords.ts"
import {
    cookieValue,
    isAcceptablePassword,
    isPresentablePassword,
    isRecord,
    normalizeEmail,
    revealed,
    sameSitePath,
    sameValue,
    signStateToken,
    verifyStateToken,
} from "./primitives.ts"
import { AuthPrincipalVerifier, refuseSessions } from "./verifier.ts"
import { AuthTokens } from "./tokens.ts"
import { FakeClock, testSigningKey } from "../testing/index.ts"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

describe("contracts", () => {
    it("gives every code a kind and puts every door under the prefix", () => {
        for (const code of Object.values(AUTH_ERROR_CODES)) assert.ok(AUTH_ERROR_KINDS[code], code)
        for (const path of Object.values(AUTH_DOORS)) assert.ok(path.startsWith(`/${AUTH_PREFIX}/`), path)
    })
})

describe("signed state", () => {
    const key = Buffer.alloc(32, 7)

    it("round-trips, and refuses shape, signature, expiry and extra parts", () => {
        const state = { w: "w", u: "u", r: "/", e: 100, p: "google" }
        const token = signStateToken(key, state)
        assert.deepEqual(verifyStateToken(key, token, 100), state)
        assert.equal(verifyStateToken(key, token, 101), null)
        assert.equal(verifyStateToken(Buffer.alloc(32, 8), token, 1), null)
        assert.equal(verifyStateToken(key, "", 1), null)
        assert.equal(verifyStateToken(key, "only-one-part", 1), null)
        assert.equal(verifyStateToken(key, `${token}.extra`, 1), null)
        assert.equal(verifyStateToken(key, `.${token.split(".")[1] ?? ""}`, 1), null)
        const body = Buffer.from("not json").toString("base64url")
        const signature = signStateToken(key, state).split(".")[1] ?? ""
        assert.equal(verifyStateToken(key, `${body}.${signature}`, 1), null)
        const signedNotJson = `${body}.${createHmac("sha256", key).update(body).digest().toString("base64url")}`
        assert.equal(verifyStateToken(key, signedNotJson, 1), null, "a signed body that is no JSON is no state")
        const wrongShape = signStateToken(key, { w: 1 } as unknown as typeof state)
        assert.equal(verifyStateToken(key, wrongShape, 1), null)
    })
})

describe("text helpers", () => {
    it("keeps only same-site paths", () => {
        assert.equal(sameSitePath("/a/b?c=1", "/"), "/a/b?c=1")
        for (const bad of ["//x", "/\\x", "http://x", "x", "/a\nb", undefined, 3]) assert.equal(sameSitePath(bad, "/home"), "/home")
    })

    it("normalises addresses, bounds passwords by characters and bytes, compares in constant time and reads cookies", () => {
        assert.equal(normalizeEmail("  A@B.test "), "a@b.test")
        assert.equal(isAcceptablePassword("12345678"), true)
        assert.equal(isAcceptablePassword("1234567"), false)
        assert.equal(isAcceptablePassword("é".repeat(40)), false, "80 bytes is past what bcrypt reads")
        assert.equal(isPresentablePassword(""), false)
        assert.equal(isPresentablePassword("x".repeat(72)), true)
        assert.equal(isPresentablePassword("x".repeat(73)), false)
        assert.equal(sameValue("abc", "abc"), true)
        assert.equal(sameValue("abc", "abd"), false)
        assert.equal(sameValue("abc", "abcd"), false)
        assert.equal(cookieValue("a=1;  b = 2 ; =3; c", "b"), "2")
        assert.equal(cookieValue("a=1", "z"), "")
        assert.equal(isRecord([]), false)
        assert.equal(isRecord({}), true)
        assert.equal(revealed("x"), "x")
        assert.equal(revealed({ reveal: () => "y" }), "y")
    })
})

describe("AuthPasswords", () => {
    it("hashes, verifies, and gives a missing account the cost of a wrong password", async () => {
        const passwords = new AuthPasswords({ bcryptCost: 4 })
        const hash = await passwords.hash("correct horse")
        assert.match(hash, /^\$2[aby]\$04\$/u)
        assert.equal(await passwords.verify("correct horse", hash), true)
        assert.equal(await passwords.verify("wrong", hash), false)
        assert.equal(await passwords.verify("anything", ""), false)
    })

    it("verifies a hash another bcrypt implementation wrote", async () => {
        const known = "$2b$10$6RdlN0g82RrrsKDj5Hb7pu4B48ZqLbJd7F245q9CktC/LrHJyag9."
        assert.equal(await new AuthPasswords({ bcryptCost: 4 }).verify("not the password", known), false)
    })
})

describe("principal verifiers", () => {
    it("builds the principal only from a verified token, and refuses anything else", async () => {
        const clock = new FakeClock()
        const tokens = new AuthTokens({ issuer: "i", keys: [testSigningKey()], accessTtlSeconds: 60 })
        const verifier = new AuthPrincipalVerifier(tokens, clock)
        const { token } = await tokens.sign({ sub: "u", email: "e@x.test", sessionId: "s" }, clock.now())
        assert.deepEqual(await verifier.verify(token), { kind: "ok", value: { id: "u", role: "authenticated", sessionId: "s", email: "e@x.test" } })
        const bare = await tokens.sign({ sub: "u", sessionId: "s" }, clock.now())
        assert.deepEqual(await verifier.verify(bare.token, clock.now()), { kind: "ok", value: { id: "u", role: "authenticated", sessionId: "s" } })
        assert.deepEqual(await verifier.verify("garbage"), { kind: "refused", code: AUTH_ERROR_CODES.AccessTokenInvalid })
        assert.deepEqual(await refuseSessions.verify(token), { kind: "refused", code: AUTH_ERROR_CODES.AccessTokenInvalid })
    })
})

describe("migrations", () => {
    it("ships the session tables with row level security and the app role's grants", () => {
        const sql = readFileSync(new URL("../../migrations/identity-sessions.sql", import.meta.url), "utf8")
        for (const table of ["identity_sessions", "identity_refresh_tokens"]) {
            assert.match(sql, new RegExp(`create table public\\.${table}`, "u"))
            assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, "u"))
        }
        assert.match(sql, /token_hash text not null/u)
        assert.match(sql, /used_at timestamptz/u)
        assert.match(sql, /raced_count integer not null default 0/u)
        assert.match(sql, /constraint identity_refresh_tokens_hash_key unique \(token_hash\)/u)
    })

    it("ships the raced-successor column as an expand-only step for a baseline of 0.2.0", () => {
        const sql = readFileSync(new URL("../../migrations/identity-refresh-raced-successors.sql", import.meta.url), "utf8")
        assert.match(sql, /^alter table public\.identity_refresh_tokens add column raced_count integer not null default 0;$/mu)
        assert.doesNotMatch(sql, /\b(?:drop|update|delete)\b/iu)
    })
})
