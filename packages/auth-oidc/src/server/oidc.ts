import { OidcClient } from "./client.ts"
import { OidcDiscovery } from "./discovery.ts"
import { OidcKeys } from "./jwks.ts"
import { resolveOptions } from "./options.ts"
import type { OidcOptions, ResolvedOidcOptions } from "./options.ts"
import { OidcTokenVerifier } from "./tokens.ts"
import { OidcPrincipalVerifier } from "./verifier.ts"

/** The parts of one OIDC registration, built from validated options. */
export interface Oidc {
    /** The options after validation, defaults applied. */
    readonly options: ResolvedOidcOptions
    /** The discovery document of the issuer. */
    readonly discovery: OidcDiscovery
    /** The provider's signing keys. */
    readonly keys: OidcKeys
    /** The verifier of the provider's signed tokens. */
    readonly tokens: OidcTokenVerifier
    /** The `PrincipalVerifier` guards inject. */
    readonly verifier: OidcPrincipalVerifier
    /** The authorization code flow client; null when the registration declares no client. */
    readonly client: OidcClient | null
}

/** Builds one registration without Nest: the module uses it, and so can a script or a spec. Invalid options throw a `ConfigurationInvalid` error. */
export const createOidc = (input: OidcOptions): Oidc => {
    const options = resolveOptions(input)
    const discovery = new OidcDiscovery(options)
    const keys = new OidcKeys(options, discovery)
    const tokens = new OidcTokenVerifier(options, keys)
    return {
        options,
        discovery,
        keys,
        tokens,
        verifier: new OidcPrincipalVerifier(options, tokens),
        client: options.client === undefined ? null : new OidcClient(options, discovery, tokens),
    }
}
