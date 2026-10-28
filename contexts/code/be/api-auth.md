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

Token verification belongs to `domain/identity` over the provider integration (in lite, Supabase Auth through its
JWKS): the verifier pins a literal asymmetric algorithm list, checks issuer and audience, and builds the principal
only after verification. A tenant header or argument (`@WorkspaceId()`) is a selector, never proof: the domain service
proves membership or ownership before it reads or writes, so jobs and other doors cannot bypass it.

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

Enforced by: `jwt-alg-pinned` (R260), `tier-direction` (R26); resource authorization in the service is review only.

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
