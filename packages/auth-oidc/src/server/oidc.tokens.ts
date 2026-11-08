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
/** Token of `OidcTokenClient`, the server-side password, refresh and revoke grants. */
export const OIDC_TOKEN_CLIENT: unique symbol = Symbol.for("@starci/auth-oidc/token-client")
/** Token of `OidcAdminClient`, the provider's admin API as the client's service account. */
export const OIDC_ADMIN_CLIENT: unique symbol = Symbol.for("@starci/auth-oidc/admin-client")
/** Token of `OidcBroker`, the one facade an app binds its identity port to. */
export const OIDC_BROKER: unique symbol = Symbol.for("@starci/auth-oidc/broker")
/** Token of the `PrincipalVerifier` the identity domain injects. */
export const OIDC_PRINCIPAL_VERIFIER: unique symbol = Symbol.for("@starci/auth-oidc/principal-verifier")
