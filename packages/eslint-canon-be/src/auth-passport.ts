/**
 * The rules of the lite identity (catalog R329 `BE_AUTH_JWT_OWN_JWKS`, R330 `BE_AUTH_REFRESH_COOKIE`; contexts/code/be/api-auth.md
 * BE-AUTH-2 and BE-AUTH-3). Which owner may import the identity and S3 libraries at all is the infrastructure table of the slot
 * manifest (`ruleParams.be.infraOwners`, judged by `infra-import-owner`: R328 `BE_AUTH_PASSPORT_OWNER`, R331 `BE_STORAGE_OWNER`).
 *
 *   - `own-jwks-only`: the app verifies only its own access tokens. `createRemoteJWKSet` (a remote identity provider's key set),
 *     `decodeJwt` and `decodeProtectedHeader` (a token read without its signature) are refused wherever jose is imported, and
 *     `jwtVerify` is imported only by `integrations/passport`. The architecture machine (`own-jwks-principal`) proves the rest:
 *     the verifier checks `createLocalJWKSet` over the app's keys with issuer, audience and algorithms pinned.
 *   - `refresh-token-cookie-only`: a refresh token never travels in a body. Outside `integrations/passport` no object literal,
 *     class property or type member is named `refreshToken` or `refresh_token`, and no `.cookie()`/`.clearCookie()` call names a
 *     refresh cookie: the cookie is set, rotated and cleared only by the integration's `setRefreshCookie`/`clearRefreshCookie`.
 *     Its attributes (httpOnly, Secure, SameSite=Strict, the refresh path) are `response-cookie-attributes` (R141) and the
 *     integration's own spec; rotation with reuse detection is held by the identity domain's spec and review.
 */
import { keyName, staticText } from "./lib/ast.ts"
import { hfsOf } from "./lib/hfs.ts"
import type { Context, Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** The owner id (`<tier>/<capability>`) of the lite identity integration. */
export const PASSPORT_OWNER = "integrations/passport"

/** The jose exports no file uses: a remote key set and the unverified decoders. */
const FORBIDDEN_JOSE = new Set(["createRemoteJWKSet", "decodeJwt", "decodeProtectedHeader"])
const REFRESH_NAME = /^refresh_?token$/i
const REFRESH_COOKIE = /refresh/i

/** The owner id of a file: the last two segments of its owner root, or null when no owner holds it. */
const ownerIdOf = (context: Context, filename: string): string | null => {
    const root = hfsOf(context).ownerOf(filename)
    return root === null ? null : root.split("/").slice(-2).join("/")
}

/** A lite principal comes only from the app's own verified token. */
export const ownJwksOnly: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Only integrations/passport verifies a token (jose jwtVerify over the app's own key set); no remote JWKS and no unverified decode anywhere." },
        schema: [],
        messages: {
            forbidden: "`{{name}}` of jose {{why}}. The app verifies only its own access tokens through the token kit of `integrations/passport` (jwtVerify over createLocalJWKSet).",
            verifier: "`jwtVerify` is imported outside `integrations/passport`. Verify a token through the integration's verifier (`OWN_TOKEN_VERIFIER`), which domain/identity turns into the principal.",
        },
    },
    create(context) {
        const owner = ownerIdOf(context, context.filename) === PASSPORT_OWNER
        return {
            ImportDeclaration(node) {
                if (node.source.value !== "jose") return
                for (const specifier of node.specifiers) {
                    if (specifier.type !== "ImportSpecifier") continue
                    const name = keyName(specifier.imported)
                    if (name !== null && FORBIDDEN_JOSE.has(name)) {
                        context.report({ node: specifier, messageId: "forbidden", data: { name, why: name === "createRemoteJWKSet" ? "trusts another issuer's key set" : "reads a token without proving its signature" } })
                    } else if (name === "jwtVerify" && !owner) context.report({ node: specifier, messageId: "verifier" })
                }
            },
        }
    },
}

/** A refresh token lives only in the integration's httpOnly cookie. */
export const refreshTokenCookieOnly: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A refresh token never appears as a body field, and only integrations/passport sets or clears the refresh cookie." },
        schema: [],
        messages: {
            field: "`{{name}}` carries a refresh token in a body. The refresh token lives only in the httpOnly, Secure, SameSite=Strict cookie that `integrations/passport` rotates (`setRefreshCookie`).",
            cookie: "`{{call}}` names the refresh cookie outside `integrations/passport`. Set and clear it only through `setRefreshCookie` and `clearRefreshCookie`.",
        },
    },
    create(context) {
        if (ownerIdOf(context, context.filename) === PASSPORT_OWNER) return {}
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
