# Changelog

## 0.5.0 - 2026-11-08

- Changed: `AuthError` extends `DomainError<AuthErrorCode>` of `@starci/common` (new dependency); its name, codes, constructor, `kind`, `context` and `cause` are unchanged, and it gains `params` (always empty).

## 0.4.0 - 2026-11-04

- Added: `RefreshCookieOptions.domains`: the refresh cookie's `Domain` follows the request host (its `Host` header without the port). A host equal to a listed domain, or ending in `.` and one, takes the longest that fits; any other host takes `domain`, else stays host-only, so one api signs in on localhost (host-only) and on a tunnel origin (its parent domain).
- Changed: `RefreshCookie.issue(response, tokens, request)` and `clear(response, request)` take the request; `AuthDoors` passes it at every write and clear. Specs: `src/server/cookie.spec.ts` (localhost host-only, a tunnel host under a listed domain, the longest fit, an unlisted host and no host fall back).

## 0.3.0 - 2026-11-03

- Added: a session carries the person's full name when the account directory knows it: `AccountStanding.name` and `AuthSubject.name` in; `SessionUser.name`, the `name` access-token claim (`AUTH_CLAIMS.name`), `AccessClaims.name` and `AuthPrincipal.name` out. The client keeps it (from the grant, or from the token when the grant carries no user) and announces a change of it. An account without a name answers as before.

## 0.2.1 - 2026-11-03

- Fixed: a refresh replayed inside the grace window no longer signs the person out 30 seconds later. When a rotation's response never reached the browser (a navigation or an abort cut it), the next load presented the spent token, was answered an access token with no cookie (`cookieKept`) and the first load after the grace was reuse. Now `AuthSessions.refresh` gives such a replay a successor of its own in the same session and `AuthDoors.refresh` sets it as the cookie, at most `RACED_SUCCESSORS_MAX` (3) times per rotated token (`raced_count`); one more replay is reuse and ends the session, which revokes every token of it, as sign-out does. `SessionTokens.cookieKept` is removed; the session door never touched the cookie.
- Changed: `RefreshTokenRecord` carries `racedCount`, `SessionTransaction` gains `markTokenRaced(tokenId, racedCount)`, and `insertToken` takes neither `usedAt` nor `racedCount`; `MemorySessionStore` implements them. `migrations/identity-sessions.sql` holds `raced_count integer not null default 0`, and `migrations/identity-refresh-raced-successors.sql` adds it to a baseline rendered from 0.2.0. Specs: the raced successor refreshes once, the sibling works, a replay after the grace ends the session, the cap, reuse revokes every sibling, and two parallel 401s renew with one refresh.

## 0.2.0 - 2026-11-03

- Added: `createSessionStore` and `createSingleFlight` in `@starci/auth/client`, the provider-agnostic session snapshot (snapshot, listeners, watchers, the first answer of a subscription) and the refresh-race guard (many requests answered 401 together refresh once, the others await it), each explicitly typed; `createAuthClient` is built on them and behaves as before. `@starci/auth-oidc/client` imports them instead of keeping a copy. Specs: `src/client/session.spec.ts` (one test per race case).

## 0.1.0 - 2026-11-03

The sign-in of a lite StarCi app in one package, lifted from the product that ran it in production and generalised: no product names, every setting a typed option, no environment read.

- Added: `@starci/auth/server`, the NestJS module `AuthModule.register` / `registerAsync`. `AuthTokens` signs and verifies EdDSA access tokens (the algorithm pinned, issuer, audience, `role` and `session_id` claims, a `kid` from the key or its RFC 7638 thumbprint) over a key set: one signing key and any number of retired keys, all verified and all published by `jwks()`, so a key rotates without signing anybody out. `AuthSessions` opens device sessions and rotates the refresh token on every refresh with reuse detection: a spent token replayed inside the grace window (30 seconds) is a racing tab and is answered with an access token and no rotation (`cookieKept`), an older replay ends the session. `SignInBudget` counts sign-in failures only (a right password clears its address). `RefreshCookie` writes the httpOnly, Secure, SameSite cookie with a configurable name, domain, path and legacy paths. `AuthFlows` runs the passport local and Google strategies (state and PKCE in a signed cookie, a same-site landing path only). `AuthDoors` is what a controller calls. `AuthPasswords` is the one owner of bcrypt. `AuthPrincipalVerifier` implements `PrincipalVerifier`, the interface the identity domain injects.
- Added: ports the app implements over its own tables: `SessionStore`, `AccountDirectory`, `RateCounter`, `AuthAuthenticator`.
- Added: `migrations/identity-sessions.sql`, the session tables (`identity_sessions`, `identity_refresh_tokens`) and the sign-in attempt counter (`identity_attempts`) the starter renders.
- Added: `@starci/auth/contracts`, the door paths, wire codes, claim names and answer shapes both sides read.
- Added: `@starci/auth/client`, `createAuthClient`: the access token in memory only, one shared refresh for overlapping callers with refresh-ahead, retries of 429, 5xx and a lost connection with backoff, signed out only on 401 or 403, an event listener and a stable snapshot, the server-side `checkSession`. `@starci/auth/client/react` holds `AuthProvider` (a context that draws nothing), `useAuthSession`, `useAuthClient`, `useWhenSignedIn` and `useCooldown`.
- Added: `@starci/auth/testing`, test keys, a fake clock, in-memory stores and `testAuthOptions`.
