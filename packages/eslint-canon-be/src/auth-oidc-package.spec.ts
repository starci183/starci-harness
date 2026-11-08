/**
 * Twin tests for the full sign-in owner law (R328 `BE_AUTH_PASSPORT_OWNER` for the full edition, judged by `infra-import-owner`):
 * `jose` is a dependency of `@starci/auth-oidc` and no app file imports it, and the package is imported only by
 * `integrations/keycloak`, its one glue.
 *
 *   node --test src/auth-oidc-package.spec.ts
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

const GLUE = at("src/modules/integrations/keycloak/keycloak.module.ts")
const GLUE_SPEC = at("src/modules/integrations/keycloak/keycloak.module.spec.ts")
const DOMAIN = at("src/modules/domain/identity/auth.guard.ts")
const PASSPORT = at("src/modules/integrations/passport/passport.kit.ts")

const PACKAGE = `import { OidcModule } from "@starci/auth-oidc/server"; export const m = OidcModule`
const TESTING = `import { FakeOidcIssuer } from "@starci/auth-oidc/testing"; export const i = FakeOidcIssuer`
const CONTRACTS = `import type { OidcPrincipal } from "@starci/auth-oidc/contracts"; export type P = OidcPrincipal`

test("the slot manifest gives the package to integrations/keycloak and jose to nobody", () => {
    const table = fixtureHfs().ruleParams.infraOwners
    assert.deepEqual(table["@starci/auth-oidc"], ["integrations/keycloak"])
    assert.deepEqual(table["@starci/auth-oidc/testing"], ["integrations/keycloak"])
    assert.deepEqual(table.jose, [])
    assert.deepEqual(table["@starci/auth"], ["integrations/passport"])
})

test("infra-import-owner: the package belongs to integrations/keycloak and jose to nobody", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: GLUE, code: PACKAGE },
            { filename: GLUE, code: `import type { OidcOptions } from "@starci/auth-oidc/server"; export type O = OidcOptions` },
            { filename: GLUE_SPEC, code: TESTING },
        ],
        invalid: [
            { filename: DOMAIN, code: PACKAGE, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: TESTING, errors: [{ messageId: "foreign" }] },
            { filename: DOMAIN, code: CONTRACTS, errors: [{ messageId: "foreign" }] },
            { filename: PASSPORT, code: PACKAGE, errors: [{ messageId: "foreign" }] },
            { filename: GLUE, code: `import { createRemoteJWKSet } from "jose"; export const k = createRemoteJWKSet`, errors: [{ messageId: "nowhere" }] },
            { filename: GLUE, code: `import { jwtVerify } from "jose"; export const v = jwtVerify`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import { decodeJwt } from "jose"; export const d = decodeJwt`, errors: [{ messageId: "nowhere" }] },
            { filename: DOMAIN, code: `import jwt from "jsonwebtoken"; export const j = jwt`, errors: [{ messageId: "nowhere" }] },
        ],
    })
})
