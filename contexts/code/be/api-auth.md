---
slots: [be.transport]
---
# API authentication and input bounds

Which operations are open, who verifies the caller, how input and traffic are bounded and what the API edge trusts.
Every operation is denied by default. Signed webhooks are webhooks.md; realtime topics BE-REALTIME-3.

## BE-AUTH-1 Default deny through the global guard chain

The api root binds, as `APP_GUARD` in this order, `RateLimitGuard` and `OriginGuard` (`platform/http-security`), then
`CredentialGuard` and `AuthGuard` (`domain/identity`). `AuthGuard` admits a verified session principal, a handler marked
`@Credential({ kind })` whose credential the `CredentialGuard` authenticated, or a handler marked
`@Public({ reason: PublicReason.X })` from the closed `PublicReason` enum of `domain/identity`. No `@UseGuards`, no guard
injected into another guard; a worker or cli app exposes no route.

Why: with default deny a forgotten decorator fails closed, and every open door carries a reason a reviewer can read.

Enforced by: `default-deny-app-guard`, `public-needs-reason`, `public-reason-closed`, `no-auth-use-guards`,
`no-guard-injects-guard`, `no-untyped-body` (R41, R290).

## BE-AUTH-2 Identity verifies the caller; the domain service authorizes the resource

Token verification belongs to `domain/identity` over the provider integration (in lite, `integrations/passport`,
the glue of the package `@starci/auth`, which verifies the app's own EdDSA access tokens against its own key set, one
signing key and any number of retired keys published as the JWKS, so a key rotates without signing anybody out; in
full, `integrations/keycloak`, the glue of the package `@starci/auth-oidc`): the verifier pins the algorithm, checks issuer and
audience, and builds the principal only after verification. In lite `@starci/auth` alone holds Passport (Google OAuth 2.0 with state and PKCE,
email and password with bcrypt) and `jose`, signs the access tokens, serves their public JWKS, counts only sign-in
failures against the limit and rotates the refresh token, which lives only in an httpOnly, Secure cookie the package sets;
a spent refresh token presented again inside a short grace window is a racing tab and is answered with an access token
and no rotation, an older replay ends the session. The app parses the settings, implements the stores over its own tables
(the session tables are the package's managed migration) and imports the package nowhere but `integrations/passport`. The lite starter renders that glue, so a new app signs in without hand-written auth code: the entities, the three stores, the authenticator over `auth.users` and `auth.identities`, `IdentitySignInService`, `IdentityEmailService` (sign up, confirm the mailbox, resend, forgot and reset: a random single-use token that expires and is stored only as its digest in `identity_email_tokens`, every request counted against the address's `SignInBudget`, the mail sent through `@starci/mail` by `integrations/mail`, its words in `messages/identity-mail.messages.ts`) and the `/auth` doors (login, signup, confirm, resend, forgot, reset, refresh, session, logout, Google start and callback, jwks) are managed files (slots `be.identity.sign-in`, `be.feature.auth`) and an edit is `HFS_MANAGED_FILE_DRIFT`. A tenant header or argument (`@WorkspaceId()`) is a selector, never proof: the domain service
proves membership or ownership before it reads or writes, so jobs and other doors cannot bypass it.

In full the package `@starci/auth-oidc` is the OIDC client of the project's identity provider (Keycloak), behind the same
`PrincipalVerifier` interface as `@starci/auth`, so `AuthGuard`, `@Public` and `@Credential` do not change between editions.
It discovers the exact issuer (the endpoints are trusted only on the issuer's origin over https), fetches the provider's JWKS
(cached, refreshed at most once per cooldown when a token names an unknown `kid`, kept through a provider outage), pins the
algorithms (`RS256`) before any key is looked up, checks issuer, audience, expiry and token type (an ID or refresh token is not a
bearer) and maps the realm and client roles; a provider that cannot be asked is an `unavailable` error, never a refusal, so an
outage signs nobody out. It also runs the authorization code flow (S256 PKCE, state, nonce, one code exchange, ID token
verification, RP-initiated logout) for an app that opens its own opaque session. `jose` is its dependency alone, the app parses the
registration (no default address or credential; the client secret through the config loader's `Secret`) and reaches the provider
through its bounded `platform/http` client passed to the package as the `OidcHttp` port, and the package is imported nowhere but
`integrations/keycloak`.

Why: authentication is a capability with its own state and errors, and authorization kept in the service holds for
every entry point.

```ts
/** Proves membership before reading a single order. */
async find(userId: string, workspaceId: string, orderId: string): Promise<OrderViewLookup> {
    await this.members.require(userId, workspaceId)
    const order = await this.orders.find(workspaceId, orderId)
    return order === null ? null : toOrderView(order)
}
```

Enforced by: `jwt-alg-pinned` (R260), `tier-direction` (R26), `infra-import-owner` (R328, both editions), `own-jwks-only` and the
machine `own-jwks-principal` (R329), `refresh-token-cookie-only` (R330); refresh rotation with reuse detection and
resource authorization in the service are held by specs and review.

## BE-AUTH-3 Constant-time comparison and safe cookies

A secret, signature or token is compared with `timingSafeEqual` on equal-length buffers. A cookie a door writes states
`httpOnly`, `secure` and `sameSite` `lax` or `strict`.

Why: a variable-time comparison leaks the secret, and a loose cookie is readable or replayable cross-site.

Enforced by: `secret-compare-timing-safe` (R41), `response-cookie-attributes` (R141).

## BE-AUTH-4 Every input is validated and bounded; doors are rate-limited

The global validation pipe of `platform/http-security` (`whitelist`, `forbidNonWhitelisted`, `transform`, failures as
its capability error) validates every DTO. Each property carries its class-validator bounds: a string `@MaxLength` (or
a bounded format such as `@IsUUID`), an enum `@IsEnum`/`@IsIn`, an array `@ArrayMaxSize`, a nested object
`@ValidateNested()` with `@Type`, a number `@Min`/`@Max`. Each operation is its own typed field or route: no `unknown`
body, generic `execute` field or `switch (input.operation)`. Auth handshakes and signed webhooks carry
`@RateLimit(RateTier.Strict)`; the rate counter lives in a store every replica shares. A door whose contract answers
only redirects (an OAuth callback) names its error redirect on the same decorator,
`@RateLimit(RateTier.Strict, { redirect: "/sign-in?auth=error" })`: a caller over the limit gets that 303 instead of a
429 body. The redirect is a path on the app's own origin (one leading `/`), refused when the decorator is applied
otherwise; the guard writes it and the errors filter leaves the sent response alone.

Why: unbounded input and unthrottled doors are the cheapest denial-of-service and brute-force paths, and a
redirect-only door answered with a JSON 429 leaves the browser on an API error page its contract never names.

```ts
/** The opaque cursor returned by the preceding page, or null for the first page. */
@Field(() => String, { nullable: true })
@IsOptional()
@IsString()
@MaxLength(2048)
after: string | null = null
```

Enforced by: `input-bounded`, `auth-door-strict-rate-tier`, `no-untyped-body` (R42, R41).

## BE-AUTH-5 A state-changing request proves its origin

`OriginGuard` is the CSRF defence. A `POST`, `PUT`, `PATCH` or `DELETE` is admitted only when its `Origin` header is one
of the exact allowed origins (BE-AUTH-7); when `Origin` is absent, the origin of its `Referer` stands in. A request
naming neither, a `null` or foreign `Origin`, or an unparsable or foreign `Referer` is refused
`HTTP_SECURITY_ORIGIN_REJECTED` (403); a foreign `Origin` is never rescued by an allowed `Referer`. `GET`, `HEAD` and
`OPTIONS` are not judged. A server-to-server door owes no origin because it proves its caller on every request: the
`ServerToServer` marker of `platform/http-security`, which `@Public({ reason: PublicReason.SignedWebhook })` (the
signature is verified first, BE-WEBHOOK-2) and `@Credential({ kind })` (a header credential `CredentialGuard`
authenticates) apply. A door never carries the marker on its own.

Why: a session cookie rides on every request a browser sends, so a request without an origin cannot be told from a
forged one; only a caller that proves itself without the cookie can do without it.

Enforced by: the unit spec of `OriginGuard`; `webhook-scope` and `webhook-verify-first` (R182, R183) keep the
SignedWebhook reason on doors that verify first. A door applying `ServerToServer` directly is held by review (open gap:
no lint refuses it yet).

## BE-AUTH-6 Lists page by opaque cursor

A list takes `PageRequest { first, after }` (`first` bounded by `MAX_PAGE_SIZE` of `platform/pagination`) and answers
`Connection<T> { nodes, pageInfo { endCursor, hasNextPage } }`. The service reads `first + 1` keyset rows ordered by a
total order (`created_at DESC, id DESC`) through `readConnection`, which decodes and refuses a foreign cursor. No `skip`,
`offset` or page number.

Why: offset pages shift under concurrent writes and cost more the deeper they go.

Enforced by: `no-offset-pagination`, `query-needs-limit` (R42, R69).

## BE-AUTH-7 The API edge states what it trusts

`main.ts` sets an exact CORS origin list from typed config, the security headers of `platform/http-security`,
`x-powered-by` off and a fixed proxy hop count; never a wildcard origin or blanket proxy trust.

Why: the app must state which origins and hops it trusts before a request reaches a door.

Enforced by: `cors-allowlist`, `security-headers`, `trust-proxy` (R261).

## BE-AUTH-8 Liveness and readiness are different signals

`GET /health/live` answers while the process serves; `GET /health/ready` probes the required dependencies with a
bounded timeout and answers unavailable when one fails. Both are `@Public({ reason: PublicReason.Health })` and
dispatch a query; the image HEALTHCHECK calls the live route.

Why: a live process may be unable to serve; separate signals let the runtime tell a restart from withholding traffic.

Enforced by: `ready-real`, `health-signals` (R262).
