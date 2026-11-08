/**
 * Twin tests for the sign-in owner law of both editions (R328 `BE_AUTH_PASSPORT_OWNER`, judged by `infra-import-owner`) over the one
 * package `@starci/auth`: `integrations/keycloak` (full) may import `@starci/auth/oidc`, its issuer presets and the shared contracts and
 * doubles; `integrations/passport` (lite) may import `@starci/auth` and `@starci/auth/server`; any other file is refused; `jose` is refused
 * everywhere; and the retired `@starci/auth-oidc` is refused in every file, its old glue included.
 *
 *   node --test src/auth-full-owner.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { infraImportOwner } from "./infra-owner.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const KEYCLOAK = at("src/modules/integrations/keycloak/keycloak.registration.ts")
const KEYCLOAK_SPEC = at("src/modules/integrations/keycloak/keycloak.registration.spec.ts")
const ATTESTATION = at("src/modules/integrations/keycloak/keycloak.attestation.ts")
const PASSPORT = at("src/modules/integrations/passport/passport.kit.ts")
const STORAGE = at("src/modules/integrations/object-storage/object-storage.client.ts")
const DOMAIN = at("src/modules/domain/identity/auth.guard.ts")

const OIDC = `import { OidcModule } from "@starci/auth/oidc"; export const m = OidcModule`
const CI_ATTESTATION = `import { createIssuerVerifier, githubActionsIssuer } from "@starci/auth/oidc"; export const v = createIssuerVerifier(githubActionsIssuer({ audience: "ci", repository: "o/r" }))`
const SERVER = `import { AuthModule } from "@starci/auth/server"; export const m = AuthModule`
const CONTRACTS = `import type { OidcPrincipal } from "@starci/auth/contracts"; export type P = OidcPrincipal`
const TESTING = `import { FakeOidcIssuer } from "@starci/auth/testing"; export const i = FakeOidcIssuer`

test("the slot manifest gives each entry of @starci/auth to its edition's glue, and jose and the retired @starci/auth-oidc to nobody", () => {
    const table = fixtureHfs().ruleParams.infraOwners
    assert.deepEqual(table["@starci/auth"], ["integrations/passport"])
    assert.deepEqual(table["@starci/auth/server"], ["integrations/passport"])
    assert.deepEqual(table["@starci/auth/oidc"], ["integrations/keycloak"])
    assert.deepEqual(table["@starci/auth/contracts"], ["integrations/passport", "integrations/keycloak"])
    assert.deepEqual(table["@starci/auth/testing"], ["integrations/passport", "integrations/keycloak"])
    assert.deepEqual(table["@starci/auth-oidc"], [])
    assert.equal(table["@starci/auth-oidc/testing"], undefined, "the retired key covers its subpaths")
    assert.deepEqual(table.jose, [])
    assert.deepEqual(table["passport-oauth2"], [])
})

test("infra-import-owner: integrations/keycloak imports @starci/auth/oidc (the CI attestation preset included), integrations/passport @starci/auth/server", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: KEYCLOAK, code: OIDC },
            { filename: KEYCLOAK, code: CI_ATTESTATION },
            { filename: ATTESTATION, code: CI_ATTESTATION },
            { filename: KEYCLOAK, code: `import type { OidcOptions } from "@starci/auth/oidc"; export type O = OidcOptions` },
            { filename: KEYCLOAK, code: CONTRACTS },
            { filename: KEYCLOAK_SPEC, code: TESTING },
            { filename: PASSPORT, code: SERVER },
            { filename: PASSPORT, code: `import { AuthError } from "@starci/auth"; export const e = AuthError` },
            { filename: PASSPORT, code: CONTRACTS },
            { filename: PASSPORT, code: `import { generateTestKeyPair } from "@starci/auth/testing"; export const g = generateTestKeyPair` },
        ],
        invalid: [
            { filename: PASSPORT, code: OIDC, errors: [{ messageId: "foreign" }] },
            { filename: PASSPORT, code: CI_ATTESTATION, errors: [{ messageId: "foreign" }] },
            { filename: KEYCLOAK, code: SERVER, errors: [{ messageId: "foreign" }] },
            { filename: KEYCLOAK, code: `import { AuthError } from "@starci/auth"; export const e = AuthError`, errors: [{ messageId: "foreign" }] },
        ],
    })
})

test("infra-import-owner: any other integration or module is refused every entry of @starci/auth", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [],
        invalid: [
            { filename: STORAGE, code: OIDC, errors: [{ messageId: "foreign" }] },
            { filename: STORAGE, code: SERVER, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: OIDC, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: CI_ATTESTATION, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: CONTRACTS, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: TESTING, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: `export { OidcModule } from "@starci/auth/oidc"`, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: `export const load = () => import("@starci/auth/oidc")`, errors: [{ messageId: "foreign" }] },
        ],
    })
})

test("infra-import-owner: jose and passport-oauth2 are refused everywhere, the glues included", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [],
        invalid: [
            { filename: KEYCLOAK, code: `import { createRemoteJWKSet } from "jose"; export const k = createRemoteJWKSet`, errors: [{ messageId: "nowhere" }] },
            { filename: KEYCLOAK, code: `import { jwtVerify } from "jose"; export const v = jwtVerify`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { SignJWT } from "jose"; export const s = SignJWT`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import { decodeJwt } from "jose"; export const d = decodeJwt`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import OAuth2Strategy from "passport-oauth2"; export const s = OAuth2Strategy`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import jwt from "jsonwebtoken"; export const j = jwt`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})

test("infra-import-owner: the retired @starci/auth-oidc is refused in every file, its old glue included", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [],
        invalid: [
            { filename: KEYCLOAK, code: `import { OidcModule } from "@starci/auth-oidc/server"; export const m = OidcModule`, errors: [{ messageId: "nowhere" }] },
            { filename: KEYCLOAK, code: `import type { OidcOptions } from "@starci/auth-oidc"; export type O = OidcOptions`, errors: [{ messageId: "nowhere" }] },
            { filename: KEYCLOAK_SPEC, code: `import { FakeOidcIssuer } from "@starci/auth-oidc/testing"; export const i = FakeOidcIssuer`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import type { OidcPrincipal } from "@starci/auth-oidc/contracts"; export type P = OidcPrincipal`, errors: [{ messageId: "nowhere" }] },
            { filename: PASSPORT, code: `import { OidcModule } from "@starci/auth-oidc/server"; export const m = OidcModule`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})
