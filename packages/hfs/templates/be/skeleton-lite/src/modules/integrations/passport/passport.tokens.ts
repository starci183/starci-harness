import { createLocalJWKSet, exportJWK, importPKCS8, jwtVerify, SignJWT } from "jose"
import type { JSONWebKeySet } from "jose"
import { ok, refused } from "@modules/platform/primitives"
import { PassportErrorCode } from "./errors/passport.error"
import type { IssueAccessToken, OwnPrincipal, TokenOptions, VerifyAccessToken } from "./passport.options"

const ALGORITHM = "ES256"
const ROLE = "authenticated"

/** The app's own token kit: the signer, the verifier over its own key set, and the public JWKS the API serves. */
export interface TokenKit {
    /** Signs one access token. */
    readonly issue: IssueAccessToken
    /** Verifies one access token against the app's own keys. */
    readonly verify: VerifyAccessToken
    /** The public key set served at `/.well-known/jwks.json`. */
    readonly jwks: JSONWebKeySet
}

/** Builds the token kit from the ES256 private key; the verifier checks the app's own key set, never a remote one. */
export const createTokenKit = async (options: TokenOptions): Promise<TokenKit> => {
    const privateKey = await importPKCS8(options.privateKey.reveal(), ALGORITHM, { extractable: true })
    const { d: _private, ...publicJwk } = await exportJWK(privateKey)
    const jwks: JSONWebKeySet = { keys: [{ ...publicJwk, kid: options.keyId, alg: ALGORITHM, use: "sig" }] }
    const keys = createLocalJWKSet(jwks)
    const issue: IssueAccessToken = (user) =>
        new SignJWT({ role: ROLE, ...(user.email === undefined ? {} : { email: user.email }) })
            .setProtectedHeader({ alg: ALGORITHM, kid: options.keyId })
            .setSubject(user.id)
            .setIssuer(options.issuer)
            .setAudience(options.audience)
            .setIssuedAt()
            .setExpirationTime(`${String(options.accessTtlSeconds)}s`)
            .sign(privateKey)
    const verify: VerifyAccessToken = async (token) => {
        try {
            const { payload } = await jwtVerify(token, keys, {
                algorithms: ["ES256"],
                audience: options.audience,
                issuer: options.issuer,
            })
            if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.role !== ROLE) {
                return refused(PassportErrorCode.AccessTokenInvalid)
            }
            const principal: OwnPrincipal = {
                id: payload.sub,
                role: ROLE,
                ...(typeof payload.email === "string" ? { email: payload.email } : {}),
            }
            return ok(principal)
        } catch (cause) {
            return refused(PassportErrorCode.AccessTokenInvalid, { cause: String(cause) })
        }
    }
    return { issue, verify, jwks }
}

/**
 * The token kit of a composition root that registers synchronously: each call awaits the one key import started here, so a
 * bad key fails the first verification instead of hiding behind a default.
 */
export const tokenKit = (options: TokenOptions): { readonly issue: IssueAccessToken; readonly verify: VerifyAccessToken; readonly jwks: () => Promise<JSONWebKeySet> } => {
    const kit = createTokenKit(options)
    return {
        issue: async (user) => (await kit).issue(user),
        verify: async (token) => (await kit).verify(token),
        jwks: async () => (await kit).jwks,
    }
}
