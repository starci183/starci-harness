import { AuthPrincipalVerifier, AuthTokens } from "@starci/auth/server"
import { ok, refused } from "@modules/platform/primitives"
import { PassportErrorCode } from "./errors/passport.error"
import type { PassportOptions, VerifyAccessToken } from "./passport.options"

/** The signer of the app's own access tokens (it also serves the JWKS) and the verifier `domain/identity` turns into a principal. */
export interface PassportKit {
    /** Signs access tokens and publishes every key of the set. */
    readonly tokens: AuthTokens
    /** Verifies one bearer token against the app's own key set. */
    readonly verify: VerifyAccessToken
}

/**
 * Builds the kit from the typed options. The key set is imported on the first use, so a bad key fails the first verification
 * instead of hiding behind a default; the package verifies against its own key set only, never a remote one.
 */
export const passportKit = (options: PassportOptions): PassportKit => {
    const tokens = new AuthTokens(options)
    const verifier = new AuthPrincipalVerifier(tokens)
    const verify: VerifyAccessToken = async (token) => {
        const verified = await verifier.verify(token)
        return verified.kind === "ok" ? ok(verified.value) : refused(PassportErrorCode.AccessTokenInvalid)
    }
    return { tokens, verify }
}
