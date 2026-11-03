/**
 * Twin tests for the lite identity law (R329 `BE_AUTH_JWT_OWN_JWKS`, R330 `BE_AUTH_REFRESH_COOKIE`) and the infrastructure rows
 * it leans on (R328 `BE_AUTH_PASSPORT_OWNER`, judged by `infra-import-owner`).
 *
 *   node --test src/auth-passport.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { ownJwksOnly, refreshTokenCookieOnly, rules } from "./auth-passport.ts"
import { infraImportOwner } from "./infra-owner.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const PASSPORT = at("src/modules/integrations/passport/passport.kit.ts")
const STORAGE = at("src/modules/integrations/object-storage/object-storage.client.ts")
const IDENTITY = at("src/modules/domain/identity/auth.guard.ts")
const DOMAIN = at("src/modules/domain/order/order.service.ts")

test("the law publishes its two rules under their names", () => {
    assert.equal(rules["own-jwks-only"], ownJwksOnly)
    assert.equal(rules["refresh-token-cookie-only"], refreshTokenCookieOnly)
})

test("own-jwks-only: no app file verifies or decodes a token with jose, whatever its folder", () => {
    tester.run("own-jwks-only", ownJwksOnly, {
        valid: [
            { filename: PASSPORT, code: `import { AuthPrincipalVerifier } from "@starci/auth/server"; export const v = AuthPrincipalVerifier` },
            { filename: IDENTITY, code: `import type { VerifyAccessToken } from "@modules/integrations/passport"; export type V = VerifyAccessToken` },
        ],
        invalid: [
            { filename: PASSPORT, code: `import { createRemoteJWKSet } from "jose"; export const k = createRemoteJWKSet`, errors: [{ messageId: "forbidden" }] },
            { filename: PASSPORT, code: `import { decodeJwt } from "jose"; export const d = decodeJwt`, errors: [{ messageId: "forbidden" }] },
            { filename: PASSPORT, code: `import { jwtVerify } from "jose"; export const v = jwtVerify`, errors: [{ messageId: "forbidden" }] },
            { filename: IDENTITY, code: `import { jwtVerify } from "jose"; export const v = jwtVerify`, errors: [{ messageId: "forbidden" }] },
        ],
    })
})

test("refresh-token-cookie-only: the refresh token is never a body field and no app file names its cookie", () => {
    tester.run("refresh-token-cookie-only", refreshTokenCookieOnly, {
        valid: [
            { filename: DOMAIN, code: `export const body = { accessToken: "x" }; export const set = (r: { cookie(n: string, v: string): void }) => r.cookie("locale", "vi")` },
        ],
        invalid: [
            { filename: DOMAIN, code: `export const body = { refreshToken: "x" }`, errors: [{ messageId: "field" }] },
            { filename: PASSPORT, code: `export const body = { refreshToken: "x" }`, errors: [{ messageId: "field" }] },
            { filename: DOMAIN, code: `export interface Session { readonly refresh_token: string }`, errors: [{ messageId: "field" }] },
            { filename: DOMAIN, code: `export class Out { refreshToken = "" }`, errors: [{ messageId: "field" }] },
            { filename: DOMAIN, code: `export const set = (r: { cookie(n: string, v: string): void }) => r.cookie("refresh_token", "v")`, errors: [{ messageId: "cookie" }] },
            { filename: PASSPORT, code: `export const clear = (r: { clearCookie(n: string): void }) => r.clearCookie("app_refresh")`, errors: [{ messageId: "cookie" }] },
        ],
    })
})

test("infra-import-owner: the identity libraries belong to no app file, @starci/auth to integrations/passport, and @starci/object-storage to integrations/object-storage (the S3 libraries to no app file)", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: PASSPORT, code: `import { AuthModule } from "@starci/auth/server"; export const m = AuthModule` },
            { filename: PASSPORT, code: `import { generateTestKeyPair } from "@starci/auth/testing"; export const g = generateTestKeyPair` },
            { filename: STORAGE, code: `import { ObjectStorageModule } from "@starci/object-storage"; export const s = ObjectStorageModule` },
        ],
        invalid: [
            { filename: DOMAIN, code: `import { AuthModule } from "@starci/auth/server"; export const m = AuthModule`, errors: [{ messageId: "foreign" }] },
            { filename: IDENTITY, code: `import { FakeClock } from "@starci/auth/testing"; export const c = FakeClock`, errors: [{ messageId: "foreign" }] },
            { filename: PASSPORT, code: `import { PassportStrategy } from "@nestjs/passport"; export const p = PassportStrategy`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { compare } from "bcryptjs"; export const c = compare`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { SignJWT } from "jose"; export const s = SignJWT`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import { JwtService } from "@nestjs/jwt"; export const j = JwtService`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import { S3Client } from "@aws-sdk/client-s3"; export const s = S3Client`, errors: [{ messageId: "nowhere" }] },
            { filename: STORAGE, code: `import { Client } from "minio"; export const c = Client`, errors: [{ messageId: "nowhere" }] },
            { filename: STORAGE, code: `import { S3Client } from "@aws-sdk/client-s3"; export const s = S3Client`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { hash } from "bcrypt"; export const h = hash`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { createClient } from "@supabase/supabase-js"; export const c = createClient`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})
