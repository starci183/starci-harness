/** Token of the `Oidc` registration (the parts below are its fields). */
export const OIDC_REGISTRATION: unique symbol = Symbol.for("@starci/auth-oidc/registration")
/** Token of `OidcDiscovery`. */
export const OIDC_DISCOVERY: unique symbol = Symbol.for("@starci/auth-oidc/discovery")
/** Token of `OidcKeys`, the provider's signing keys. */
export const OIDC_KEYS: unique symbol = Symbol.for("@starci/auth-oidc/keys")
/** Token of `OidcTokenVerifier`. */
export const OIDC_TOKEN_VERIFIER: unique symbol = Symbol.for("@starci/auth-oidc/token-verifier")
/** Token of `OidcClient`, the authorization code flow; null when the registration declares no client. */
export const OIDC_CLIENT: unique symbol = Symbol.for("@starci/auth-oidc/client")
/** Token of the `PrincipalVerifier` the identity domain injects. */
export const OIDC_PRINCIPAL_VERIFIER: unique symbol = Symbol.for("@starci/auth-oidc/principal-verifier")
