/**
 * Twin tests for the lite identity law (R329 `BE_AUTH_JWT_OWN_JWKS`, R330 `BE_AUTH_REFRESH_COOKIE`) and the infrastructure rows
 * it leans on (R328 `BE_AUTH_PASSPORT_OWNER`, R331 `BE_STORAGE_OWNER`, judged by `infra-import-owner`).
 *
 *   node --test src/auth-passport.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.mjs"
import { at, fixtureHfs } from "../fixtures/typed/tester.mjs"
import { ownJwksOnly, refreshTokenCookieOnly, rules } from "./auth-passport.ts"
import { infraImportOwner } from "./infra-owner.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const PASSPORT = at("src/modules/integrations/passport/passport.tokens.ts")
const STORAGE = at("src/modules/integrations/storage/storage.client.ts")
const IDENTITY = at("src/modules/domain/identity/auth.guard.ts")
const DOMAIN = at("src/modules/domain/order/order.service.ts")

test("the law publishes its two rules under their names", () => {
    assert.equal(rules["own-jwks-only"], ownJwksOnly)
    assert.equal(rules["refresh-token-cookie-only"], refreshTokenCookieOnly)
})

test("own-jwks-only: only integrations/passport verifies, and nothing trusts a remote key set or an unverified decode", () => {
    tester.run("own-jwks-only", ownJwksOnly, {
        valid: [
            { filename: PASSPORT, code: `import { createLocalJWKSet, jwtVerify } from "jose"; export const k = [createLocalJWKSet, jwtVerify]` },
            { filename: IDENTITY, code: `import type { VerifyAccessToken } from "@modules/integrations/passport"; export type V = VerifyAccessToken` },
        ],
        invalid: [
            { filename: PASSPORT, code: `import { createRemoteJWKSet } from "jose"; export const k = createRemoteJWKSet`, errors: [{ messageId: "forbidden" }] },
            { filename: PASSPORT, code: `import { decodeJwt } from "jose"; export const d = decodeJwt`, errors: [{ messageId: "forbidden" }] },
            { filename: IDENTITY, code: `import { jwtVerify } from "jose"; export const v = jwtVerify`, errors: [{ messageId: "verifier" }] },
        ],
    })
})

test("refresh-token-cookie-only: the refresh token is never a body field and only the integration names its cookie", () => {
    tester.run("refresh-token-cookie-only", refreshTokenCookieOnly, {
        valid: [
            { filename: PASSPORT, code: `export const body = { refreshToken: "x" }; export const set = (r: { cookie(n: string, v: string): void }) => r.cookie("refresh_token", "v")` },
            { filename: DOMAIN, code: `export const body = { accessToken: "x" }; export const set = (r: { cookie(n: string, v: string): void }) => r.cookie("locale", "vi")` },
        ],
        invalid: [
            { filename: DOMAIN, code: `export const body = { refreshToken: "x" }`, errors: [{ messageId: "field" }] },
            { filename: DOMAIN, code: `export interface Session { readonly refresh_token: string }`, errors: [{ messageId: "field" }] },
            { filename: DOMAIN, code: `export class Out { refreshToken = "" }`, errors: [{ messageId: "field" }] },
            { filename: DOMAIN, code: `export const set = (r: { cookie(n: string, v: string): void }) => r.cookie("refresh_token", "v")`, errors: [{ messageId: "cookie" }] },
        ],
    })
})

test("infra-import-owner: the identity libraries belong to integrations/passport and the S3 client to integrations/storage", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: PASSPORT, code: `import { PassportStrategy } from "@nestjs/passport"; import { compare } from "bcryptjs"; export const p = [PassportStrategy, compare]` },
            { filename: STORAGE, code: `import { S3Client } from "@aws-sdk/client-s3"; import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; export const s = [S3Client, getSignedUrl]` },
        ],
        invalid: [
            { filename: DOMAIN, code: `import { PassportStrategy } from "@nestjs/passport"; export const p = PassportStrategy`, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: `import { JwtService } from "@nestjs/jwt"; export const j = JwtService`, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: `import { S3Client } from "@aws-sdk/client-s3"; export const s = S3Client`, errors: [{ messageId: "foreign" }] },
            { filename: STORAGE, code: `import { Client } from "minio"; export const c = Client`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { hash } from "bcrypt"; export const h = hash`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { createClient } from "@supabase/supabase-js"; export const c = createClient`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})
