# Changelog

## 0.2.0 - 2026-11-08

Keycloak behind the back end: the sign-in, the sign-up and the federated sign-in of an app whose tokens never reach a browser. Additive; every existing export and behaviour is unchanged.

- Added: `OidcAuthorization.idpHint`, sent as `kc_idp_hint`, so the provider skips its own login page for a brokered identity provider.
- Added: `OidcClient.exchange` also answers `refreshToken` and `refreshExpiresAt` (a new field pair on the result, `OidcExchangeResult`) when the provider issued a refresh token that can be dated (`refresh_expires_in`, else the token's own `exp`).
- Added: `OidcTokenClient` (`OIDC_TOKEN_CLIENT`, `Oidc.tokenClient`): `passwordGrant(username, password)`, `refresh(refreshToken)` and `revoke(refreshToken)` (the discovered `revocation_endpoint`, RFC 7009, else the end-session endpoint with the refresh token). A grant is checked by the registration's `PrincipalVerifier` and answers `OidcGrant` (principal, subject, roles, email, `refreshToken`, `refreshExpiresAt`); the access token is dropped.
- Added: `OidcAdminClient` (`OIDC_ADMIN_CLIENT`, `Oidc.admin`): the realm admin API (`<origin>/admin/realms/<realm>`, derived from the issuer) as the client's service account (client credentials, cached until about to expire, renewed once on a 401): `createUser`, `findUserByEmail`, `resetPassword`, `logoutAll`.
- Added: `OidcBroker` (`OIDC_BROKER`, `Oidc.broker`), the one facade an app binds its identity port to: `passwordGrant`, `refresh`, `revoke`, `socialAuthorizationUrl`, `exchangeSocialCode`, `createUser`, `findUserByEmail`, `resetPassword`, `logoutAll`.
- Added: error codes `OIDC_CREDENTIALS_REJECTED`, `OIDC_EMAIL_REGISTERED`, `OIDC_PASSWORD_INVALID`, `OIDC_SOCIAL_REJECTED`, whose `OidcError.kind` is `credentials-rejected`, `email-registered`, `password-invalid` and `social-rejected` (`OidcErrorKind` grows by these four; `unavailable` is the existing kind of an outage, a 5xx or a 429).
- Added: `OidcHttpRequest` takes `PUT`, a JSON `body` and `headers`; `OidcHttpResponse` may carry `location`; `OidcMetadata.revocationEndpoint`. A port that ignores the new fields still serves every call that existed.
- Added: `FakeOidcIssuer` answers the password grant (`seedUser`, `findUser`, `passwordMatches`), `client_credentials`, the revocation endpoint, the end-session POST, the admin users endpoints (create, search, reset password, logout), `refresh_expires_in` and `kc_idp_hint` (`idpHints`, the `identityProviders` option), with the options `refreshTtlSeconds`, `revocation` and `minPasswordLength` and the existing failure injection.

## 0.1.3 - 2026-11-04

- Changed: requires `@starci/auth` 0.4.0 (the refresh cookie's domain by request host). Nothing of this package reads it.

## 0.1.2 - 2026-11-03

- Changed: requires `@starci/auth` 0.3.0 (the optional person name of a session). Nothing of this package reads it.

## 0.1.1 - 2026-11-03

- Changed: requires `@starci/auth` 0.2.1 (the raced refresh gets its own successor cookie; `SessionTokens.cookieKept` is gone). Nothing of this package reads it.

## 0.1.0 - 2026-11-03

The OIDC client of a full StarCi app (Keycloak) in one package, behind the `PrincipalVerifier` interface of `@starci/auth`. Lifted from the Keycloak integration of the first full app and generalised: no product names, every setting a typed option, no environment read.

- Added: `@starci/auth-oidc/server`, the NestJS module `OidcModule.register` / `registerAsync` (and `createOidc` without Nest). `OidcDiscovery` reads the discovery document of the exact issuer and trusts its endpoints only on the issuer's origin over https. `OidcKeys` fetches the JWKS, caches it, refreshes it on an unknown `kid` at most once per cooldown, rejects private and symmetric keys and keeps the cached keys through a provider outage. `OidcTokenVerifier` pins the algorithms before any key is looked up and checks issuer, audience, expiry and not-before. `OidcPrincipalVerifier` implements `PrincipalVerifier`: the principal has the shape of `@starci/auth`'s with the roles the issuer granted, an ID or refresh token presented as a bearer is refused, and a provider outage throws an `unavailable` error instead of refusing. `OidcClient` is the authorization code flow of a registered client: S256 PKCE, state, nonce, one code exchange, ID token verification, RP-initiated logout.
- Added: `@starci/auth-oidc/client`, `createOidcClient`: PKCE redirect, callback, `restore` (a `prompt=none` redirect), one shared refresh with refresh-ahead and backoff, the tokens in memory only, signed out only on a 401, a 403 or a 400 `invalid_grant`, a stable snapshot, an event listener and logout.
- Changed: the client keeps no copy of the session snapshot or of the refresh-race guard: it imports `createSessionStore` and `createSingleFlight` from `@starci/auth/client` and requires `@starci/auth` 0.2.0.
- Added: `@starci/auth-oidc/contracts` and `@starci/auth-oidc/testing` (`FakeOidcIssuer`: discovery, JWKS with rotation, access and ID token minting a spec can bend, the token endpoint with PKCE and rotating refresh tokens, failure injection, an in-memory port and a socket).
