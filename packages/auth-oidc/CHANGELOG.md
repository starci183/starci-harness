# Changelog

## 0.1.1 - 2026-11-03

- Changed: requires `@starci/auth` 0.2.1 (the raced refresh gets its own successor cookie; `SessionTokens.cookieKept` is gone). Nothing of this package reads it.

## 0.1.0 - 2026-11-03

The OIDC client of a full StarCi app (Keycloak) in one package, behind the `PrincipalVerifier` interface of `@starci/auth`. Lifted from the Keycloak integration of the first full app and generalised: no product names, every setting a typed option, no environment read.

- Added: `@starci/auth-oidc/server`, the NestJS module `OidcModule.register` / `registerAsync` (and `createOidc` without Nest). `OidcDiscovery` reads the discovery document of the exact issuer and trusts its endpoints only on the issuer's origin over https. `OidcKeys` fetches the JWKS, caches it, refreshes it on an unknown `kid` at most once per cooldown, rejects private and symmetric keys and keeps the cached keys through a provider outage. `OidcTokenVerifier` pins the algorithms before any key is looked up and checks issuer, audience, expiry and not-before. `OidcPrincipalVerifier` implements `PrincipalVerifier`: the principal has the shape of `@starci/auth`'s with the roles the issuer granted, an ID or refresh token presented as a bearer is refused, and a provider outage throws an `unavailable` error instead of refusing. `OidcClient` is the authorization code flow of a registered client: S256 PKCE, state, nonce, one code exchange, ID token verification, RP-initiated logout.
- Added: `@starci/auth-oidc/client`, `createOidcClient`: PKCE redirect, callback, `restore` (a `prompt=none` redirect), one shared refresh with refresh-ahead and backoff, the tokens in memory only, signed out only on a 401, a 403 or a 400 `invalid_grant`, a stable snapshot, an event listener and logout.
- Changed: the client keeps no copy of the session snapshot or of the refresh-race guard: it imports `createSessionStore` and `createSingleFlight` from `@starci/auth/client` and requires `@starci/auth` 0.2.0.
- Added: `@starci/auth-oidc/contracts` and `@starci/auth-oidc/testing` (`FakeOidcIssuer`: discovery, JWKS with rotation, access and ID token minting a spec can bend, the token endpoint with PKCE and rotating refresh tokens, failure injection, an in-memory port and a socket).
