import type { EnvSource } from "@modules/platform/config"
import type { HttpOptions } from "./http.options"

/**
 * Reads the http options: `HTTP_TRUSTED_CA` (or the file `HTTP_TRUSTED_CA_FILE` names) is the PEM of one more certificate
 * authority the outbound client trusts beside Node's bundled roots; undeclared, the client trusts the bundled roots alone.
 */
export const parseHttpConfig = (env: EnvSource): HttpOptions => {
    const trustedCa = env.optional("HTTP_TRUSTED_CA")
    return trustedCa === undefined ? {} : { trustedCa }
}
