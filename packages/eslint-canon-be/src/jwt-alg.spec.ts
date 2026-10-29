// proves: BE_JWT_ALG_PINNED@lite BE_JWT_ALG_PINNED@full
import assert from "node:assert/strict"
import test from "node:test"
import { at, typedTester } from "../fixtures/typed/tester.mjs"
import { appDeclaration } from "../fixtures/app.mjs"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { jwtAlgPinned, recommended, rules } from "./jwt-alg.ts"

const SRC = at("src/modules/integrations/passport/passport.tokens.ts")
const verifier = ({ algorithms = "['ES256']", issuer = "options.url", guard = "if (payload.role !== 'authenticated') throw new Error('invalid role')", importLine = "import {jwtVerify} from 'jose'", call = "jwtVerify", before = "" } = {}) => `
${importLine}
interface ProviderOptions { url: string }
const keys = {}
${before}
export async function verify(token: string, options: ProviderOptions) {
  const {payload} = await ${call}(token, keys, {issuer: ${issuer}, audience: 'authenticated', algorithms: ${algorithms}})
  ${guard}
  return {id: payload.sub, role: payload.role}
}`

test("R260 BE_JWT_ALG_PINNED exports the registered rule at error", () => {
    assert.equal(rules["jwt-alg-pinned"], jwtAlgPinned)
    assert.equal(recommended["starci-be/jwt-alg-pinned"], "error")
})

for (const edition of ["lite", "full"] as const) {
    test(`R260 BE_JWT_ALG_PINNED accepts literal secure algorithms and rejects unsigned/shared-secret verification (${edition})`, () => {
        const declaration = { ...appDeclaration("be", { apps: [{ name: "api", kind: "api" }] }), edition }
        const settings = { starci: { hfs: hfsFromDeclaration(declaration, at("")) } }
        assert.doesNotThrow(() => {
            typedTester().run("jwt-alg-pinned", jwtAlgPinned, {
                valid: [
                    { filename: SRC, settings, code: verifier() },
                    { filename: SRC, settings, code: verifier({ algorithms: "['RS256', 'EdDSA']" }) },
                    { filename: SRC, settings, code: verifier({ issuer: "`${options.url.replace(/\\/$/, '')}/auth/v1`" }) },
                    { filename: SRC, settings, code: verifier({ importLine: "import {jwtVerify as check} from 'jose'", call: "check" }) },
                    { filename: SRC, settings, code: verifier({ importLine: "import * as jose from 'jose'", call: "jose.jwtVerify" }) },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role !== 'authenticated') return null" }) },
                    { filename: SRC, settings, code: verifier({ guard: "if (!payload.sub) return null; if (payload.role !== 'authenticated') throw new Error('invalid')" }) },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role === 'authenticated') { console.log('valid') } else throw new Error('invalid')" }) },
                    { filename: SRC, settings, code: "const jwtVerify = (a: string) => a; jwtVerify('local')" },
                ],
                invalid: [
                    ...["['none']", "['HS256']", "['ES256', 'HS256']", "[]", "algorithms", "['ES256', ...extra]"].map(algorithms => ({
                        filename: SRC, settings, code: verifier({ algorithms }), errors: [{ message: /BE_JWT_ALG_PINNED: algorithms/ }],
                    })),
                    { filename: SRC, settings, code: verifier({ issuer: "'https://literal.invalid/auth/v1'" }), errors: [{ message: /issuer must derive/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role === 'service_role') throw new Error('invalid')" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role !== 'authenticated') { console.log('rejected') }" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "return {id: payload.sub}; if (payload.role !== 'authenticated') throw new Error('late')" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role !== 'authenticated' && enabled) throw new Error('partial')" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "if (other.role !== 'authenticated') throw new Error('unrelated')" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role === 'service_role') return {id: payload.sub}; if (payload.role !== 'authenticated') throw new Error('late')" }), errors: [{ message: /reject every role/ }] },
                    { filename: SRC, settings, code: verifier({ guard: "if (payload.role !== 'authenticated') { return {id: payload.sub}; throw new Error('unreachable') }" }), errors: [{ message: /reject every role/ }] },
                ],
            })
        })
    })
}

const OIDC = at("src/modules/integrations/keycloak/keycloak.client.ts")
const oidcVerifier = ({ audience = "this.options.clientId", issuer = "this.options.issuer", algorithms = "['RS256']", importLine = "import {jwtVerify} from 'jose'", call = "jwtVerify", before = "", guard = "" } = {}) => `
${importLine}
interface KeycloakOptions { issuer: string; clientId: string; audiences: string[] }
const keys = {}
export class KeycloakClient {
  constructor(private readonly options: KeycloakOptions) {}
  async exchange(token: string) {
    ${before}
    const verified = await ${call}(token, keys, {issuer: ${issuer}, ${audience ? `audience: ${audience},` : ""} algorithms: ${algorithms}, requiredClaims: ['sub', 'exp', 'nonce']})
      .catch((cause: unknown) => { throw new Error('rejected', {cause}) })
    ${guard}
    return {issuer: verified.payload.iss, subject: verified.payload.sub}
  }
}`

for (const edition of ["lite", "full"] as const) {
    test(`R260 BE_JWT_ALG_PINNED admits a role-free OIDC principal only with an audience from typed configuration (${edition})`, () => {
        const declaration = { ...appDeclaration("be", { apps: [{ name: "api", kind: "api" }] }), edition }
        const settings = { starci: { hfs: hfsFromDeclaration(declaration, at("")) } }
        typedTester().run("jwt-alg-pinned", jwtAlgPinned, {
            valid: [
                { filename: OIDC, settings, code: oidcVerifier() },
                { filename: OIDC, settings, code: oidcVerifier({ algorithms: "['ES256', 'RS256', 'EdDSA']" }) },
                { filename: OIDC, settings, code: oidcVerifier({ audience: "this.options.audiences" }) },
                { filename: OIDC, settings, code: oidcVerifier({ before: "const audience = this.options.clientId", audience: "audience" }) },
                { filename: OIDC, settings, code: oidcVerifier({ importLine: "import {jwtVerify as check} from 'jose'", call: "check" }) },
                { filename: OIDC, settings, code: oidcVerifier({ importLine: "import * as jose from 'jose'", call: "jose.jwtVerify" }) },
                // The app's own Passport access tokens (lite): the configured audience binds them like any OIDC client.
                { filename: SRC, settings, code: verifier({ guard: "" }).replace("audience: 'authenticated'", "audience: options.url") },
            ],
            invalid: [
                ...["'literal-client'", "'authenticated'", "", "input.clientId"].map(audience => ({
                    filename: OIDC, settings, code: oidcVerifier({ audience }), errors: [{ message: /audience must derive from typed configuration/ }],
                })),
                { filename: OIDC, settings, code: oidcVerifier({ issuer: "'https://literal.invalid/realm'" }), errors: [{ message: /issuer must derive/ }] },
                ...["['none']", "['HS256']", "[]", "['RS256', ...extra]"].map(algorithms => ({
                    filename: OIDC, settings, code: oidcVerifier({ algorithms }), errors: [{ message: /BE_JWT_ALG_PINNED: algorithms/ }],
                })),
            ],
        })
    })
}
