/**
 * The rules of the lite identity (catalog R329 `BE_AUTH_JWT_OWN_JWKS`, R330 `BE_AUTH_REFRESH_COOKIE`; contexts/code/be/api-auth.md
 * BE-AUTH-2 and BE-AUTH-3). Which owner may import the identity and S3 libraries at all is the infrastructure table of the slot
 * manifest (`ruleParams.be.infraOwners`, judged by `infra-import-owner`: R328 `BE_AUTH_PASSPORT_OWNER`, R331 `BE_STORAGE_OWNER`): the
 * identity libraries belong to `@starci/auth` and to no app file, and `@starci/auth` itself only to `integrations/passport`.
 *
 *   - `own-jwks-only`: the app verifies no token itself. `createRemoteJWKSet` (a remote identity provider's key set), `decodeJwt`,
 *     `decodeProtectedHeader` (a token read without its signature) and `jwtVerify` are refused wherever jose is imported; the package
 *     verifies against its own key set. The architecture machine (`own-jwks-principal`) proves the same on the call sites.
 *   - `refresh-token-cookie-only`: a refresh token never travels in a body. No object literal, class property or type member is
 *     named `refreshToken` or `refresh_token`, and no `.cookie()`/`.clearCookie()` call names a refresh cookie: `@starci/auth` sets,
 *     rotates and clears it. Its attributes and rotation with reuse detection are the package's own specs.
 */
import { keyName, staticText } from "./lib/ast.ts"
import type { Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** The jose exports no app file uses: a remote key set, the unverified decoders and the verifier itself. */
const FORBIDDEN_JOSE = new Set(["createRemoteJWKSet", "decodeJwt", "decodeProtectedHeader", "jwtVerify"])
const REFRESH_NAME = /^refresh_?token$/i
const REFRESH_COOKIE = /refresh/i

const WHY: Readonly<Record<string, string>> = {
    createRemoteJWKSet: "trusts another issuer's key set",
    jwtVerify: "verifies a token in the app",
}

/** A lite principal comes only from the app's own token, verified by the package. */
export const ownJwksOnly: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "No app file verifies or decodes a token with jose: `@starci/auth` verifies the app's own access tokens against its own key set." },
        schema: [],
        messages: {
            forbidden: "`{{name}}` of jose {{why}}. The app verifies only its own access tokens, and `@starci/auth` does it (the verifier of `integrations/passport`, `OWN_TOKEN_VERIFIER`, which `domain/identity` turns into the principal).",
        },
    },
    create(context) {
        return {
            ImportDeclaration(node) {
                if (node.source.value !== "jose") return
                for (const specifier of node.specifiers) {
                    if (specifier.type !== "ImportSpecifier") continue
                    const name = keyName(specifier.imported)
                    if (name !== null && FORBIDDEN_JOSE.has(name)) {
                        context.report({ node: specifier, messageId: "forbidden", data: { name, why: WHY[name] ?? "reads a token without proving its signature" } })
                    }
                }
            },
        }
    },
}

/** A refresh token lives only in the package's httpOnly cookie. */
export const refreshTokenCookieOnly: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A refresh token never appears as a body field, and no app file sets or clears the refresh cookie: `@starci/auth` does." },
        schema: [],
        messages: {
            field: "`{{name}}` carries a refresh token in a body. The refresh token lives only in the httpOnly, Secure cookie that `@starci/auth` sets, rotates and clears.",
            cookie: "`{{call}}` names the refresh cookie in the app. `@starci/auth` sets and clears it through `AuthDoors`; the app never writes it.",
        },
    },
    create(context) {
        const field = (node: Node, key: Node, computed: boolean) => {
            const name = computed ? null : keyName(key)
            if (name !== null && REFRESH_NAME.test(name)) context.report({ node, messageId: "field", data: { name } })
        }
        return {
            Property(node) {
                field(node, node.key, node.computed)
            },
            PropertyDefinition(node) {
                field(node, node.key, node.computed)
            },
            TSPropertySignature(node) {
                field(node, node.key, node.computed)
            },
            CallExpression(node) {
                if (node.callee.type !== "MemberExpression" || node.callee.computed) return
                const method = keyName(node.callee.property)
                if (method !== "cookie" && method !== "clearCookie") return
                const [first] = node.arguments
                const name = first === undefined ? null : staticText(first)
                if (name !== null && REFRESH_COOKIE.test(name)) context.report({ node, messageId: "cookie", data: { call: `.${method}("${name}")` } })
            },
        }
    },
}

/** The rules of the lite identity law, by name. */
export const rules = { "own-jwks-only": ownJwksOnly, "refresh-token-cookie-only": refreshTokenCookieOnly } satisfies Rules
/** Both rules on at error. */
export const recommended: Recommended = { "starci-be/own-jwks-only": "error", "starci-be/refresh-token-cookie-only": "error" }
