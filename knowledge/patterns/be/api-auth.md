---
slots: [be.transport]
---
# API authentication and input bounds

Decides which operations are open, who verifies the caller, how state-changing traffic and input are bounded, and what the API edge
trusts. Every operation is denied by default; opening one is a written reason from a closed vocabulary. Signed webhook doors are
webhooks.md; realtime doors are BE-REALTIME-3.

## BE-AUTH-1 Default deny with APP_GUARD, @Public and @Credential
`domain/identity` exports `AuthGuard`, `CredentialGuard`, `@Public({ reason })`, `@Credential({ kind })`, the
`CREDENTIAL_AUTHENTICATOR` port, `@Roles(...)` and `@CurrentPrincipal()`. Guards are only global `APP_GUARD` bindings of the api
root, each registered once in this order: `RateLimitGuard`, `OriginGuard`, `CredentialGuard`, `AuthGuard`. `CredentialGuard` acts
only on a handler marked `@Credential({ kind })` (the closed kind set of `domain/identity`), authenticates through the port the app
binds and sets the credential principal; elsewhere it passes through. `AuthGuard` passes a credential-marked handler only when that
principal is set, passes `@Public({ reason })`, and otherwise requires a session principal; its constructor takes the reflector and
the token verifier only. No guard injects another guard and no guard-dispatch layer exists. `PublicReason` is the closed set of
R290; api-key and token routes use `@Credential`, never a public reason. `@UseGuards` is not used for authentication or
authorization. A worker or cli app exposes no route.

Why: with allow-by-default a forgotten decorator publishes an operation unnoticed; with default deny it fails closed, and every
exception carries a reason a reviewer can read.

Enforced by: R41 BE_DEFAULT_DENY, R290 BE_PUBLIC_REASON_CLOSED.

## BE-AUTH-2 Identity owns verification
Verifying a token or session belongs to `domain/identity`, using `integrations/<idp>` for the identity provider; platform never
verifies a caller and a GraphQL context factory never authenticates. A JWT verifier pins a literal subset of asymmetric algorithms,
reads the issuer from configuration and checks the intended audience; decoding is not verification. A principal from a hosted
auth provider is built only after verification and refusal of every role but the authenticated one. A workspace or tenant header
is a selector, never proof of access; resource authorization stays in the domain service so jobs and other entry points cannot
bypass a guard.

Why: authentication is a business capability with its own state and errors; placing it in platform reverses the tier direction.

Enforced by: R260 BE_JWT_ALG_PINNED, R219 BE_SUPABASE_JWT_VERIFIED, R26 BE_TIER_DIRECTION.

## BE-AUTH-3 Origin guard and constant-time comparison
`platform/http-security` owns the origin and referer allowlist guard every state-changing request passes; only signed webhooks are
exempt, and they prove origin by signature (BE-WEBHOOK-2). Every comparison of a secret, signature or token uses
`timingSafeEqual` on equal-length buffers, never `===`.

Why: a public door is safe only when the request proves its origin, and a variable-time comparison leaks the secret.

Enforced by: R41 BE_DEFAULT_DENY.

## BE-AUTH-4 Typed operations, no generic tunnels
Each operation is its own typed field or route. No `@Body() x: unknown`, `Record<string, unknown>` body, `GraphQLJSON` parameter,
generic `execute` field or `switch (input.operation)` in transport: a name that fans out to many behaviours becomes one operation
per behaviour. The versioned operation table (BE-OPERATIONS-1) is typed per entry and is not a tunnel.

Why: a tunnel defeats the contract, the guard and the input bounds, because the checker sees one operation where there are many.

Enforced by: R41 BE_DEFAULT_DENY, R88 BE_TRANSPORT_SHAPE.

## BE-AUTH-5 Validated, bounded input and rate-limited doors
The global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` is registered. Every input property
carries class-validator decorators: each string `@MaxLength` (or a bounded format), each enum `@IsEnum`, each array `@IsArray()`
with `@ArrayMaxSize`, each nested object `@ValidateNested()` with `@Type(...)`. GraphQL depth and complexity limits are set in
`platform/graphql`. A default rate tier applies everywhere and the strict tier is on every auth-handshake and signed-webhook door.
The throttler counts in the store its `ThrottlerStorage` port is bound to: the in-process default only while the app runs one
replica, a store every replica shares (the declared Redis, else a Postgres table) before a second replica starts.

Why: unbounded input and unthrottled doors are the cheapest denial-of-service and brute-force paths, and a per-process counter
multiplies each limit by the replica count.

Enforced by: R42 BE_INPUT_BOUNDED.

## BE-AUTH-6 Pagination is by cursor
A list operation takes `PageArgs { first, after? }` (`first` bounded by the platform page-size constant) and returns
`<X>Connection { items, pageInfo { endCursor, hasNextPage } }`, GraphQL DTOs of the feature's `transport/graphql/dto/`. Cursors are
opaque and HMAC-signed by `platform/primitives` (`pageOf`, `decodeCursor`) with a key every replica shares. The domain service reads
`first + 1` keyset rows ordered by a total sort (a sort value and the id), refuses an out-of-range size and a cursor it did not
sign, and answers a `Page`. No `skip`, `offset` or page number.

Why: offset pages are unstable under concurrent writes and their cost grows with the offset.

Enforced by: R42 BE_INPUT_BOUNDED, R69 BE_QUERY_UNBOUNDED.

## BE-AUTH-7 The API edge states its trust boundaries
Every API, in both editions, declares an exact browser-origin CORS allowlist, applies the response middleware of
`platform/http-security`, disables `x-powered-by` and declares a non-negative integer proxy-hop count, all from typed app
configuration rather than inferred from the request. A missing or wildcard CORS policy and blanket proxy trust are refused.

Why: the app must state which origins and proxy hops it trusts before a request reaches an authenticated door.

Enforced by: R261 BE_CORS_ALLOWLIST.

## BE-AUTH-8 Liveness and readiness are different signals
Every API exposes distinct live and ready signals. Readiness probes a required dependency with a bounded timeout and answers
unavailable when it fails; it never aliases the live response. The Docker HEALTHCHECK calls the live route, never an
always-successful command.

Why: a live process may be unable to serve; separate signals let the runtime tell restarting a process from withholding traffic
while a dependency recovers.

Enforced by: R262 BE_READY_REAL.
