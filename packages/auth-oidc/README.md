# @starci/auth-oidc

The sign-in of a full StarCi app: the OIDC client of its identity provider (Keycloak), behind the same `PrincipalVerifier` interface as `@starci/auth` (the lite edition), so the guards, `@Public` and `@Credential` of an app do not change between editions. One package, four entries.

| entry | holds |
|---|---|
| `@starci/auth-oidc/server` | `OidcModule.register` / `registerAsync` (also `createOidc` without Nest): issuer discovery, the provider's JWKS with caching and rotation, the token verifier (algorithm pinned, issuer, audience, expiry, `typ`), `OidcPrincipalVerifier`, role mapping, and `OidcClient`, the authorization code flow (PKCE S256, state, nonce, code exchange, ID token verification, RP-initiated logout), `OidcTokenClient` (the password, refresh and revoke grants), `OidcAdminClient` (the admin API as the service account of the client) and `OidcBroker` (one facade over them for an app that keeps Keycloak behind its back end) |
| `@starci/auth-oidc/client` | `createOidcClient`: the browser half of a public client: PKCE redirect, callback, one shared refresh, the access token in memory, sign-out only when the provider ends the session |
| `@starci/auth-oidc/contracts` | algorithms, wire codes, claim names, the principal and the outcome shapes both sides read |
| `@starci/auth-oidc/testing` | `FakeOidcIssuer`: discovery, JWKS, token minting, the token endpoint (code, refresh, password and client credentials grants), revocation, the admin users endpoints, `kc_idp_hint` and failure injection, in memory or on a socket, so an app tests without Keycloak |

An app reaches the package only through `integrations/keycloak` (back end) and `modules/auth/client.ts` (front end); the lint refuses `jose` and every other JWT library in an app.

## Back end

```ts
OidcModule.registerAsync({
    isGlobal: true,
    inject: [HTTP_CLIENT, CLOCK],
    useFactory: (http: HttpClient, clock: Clock) => ({
        ...parsedOptions, // issuer, audience, client registration, role mapping, from the app's config loader
        http: { request: (request) => http.request({ correlationId: "identity-keycloak", ...request }) },
        clock,
    }),
})
```

The package reads no environment. The app parses its settings (BE-CONFIG-2) and passes typed options; the client secret is passed as a `{ reveal(): string }` holder or text and revealed only for the token request. Every provider request goes through the `OidcHttp` port, so the app's bounded HTTP client (`platform/http`) is the one door; without the port the platform `fetch` is used with the request's deadline.

| a bearer token | is checked by |
|---|---|
| the algorithm | pinned to `algorithms` (`RS256`) before any key is looked up; `none`, HMAC and unlisted algorithms are refused |
| the key | the JWKS of the discovered `jwks_uri`, selected by `kid`; cached 10 minutes; an unknown `kid` refreshes it at most once per 30 seconds (rotation); an unreachable provider keeps the cached keys for 24 hours |
| issuer, audience, expiry, not-before | the registration and the clock, with a clock skew of 5 seconds |
| the token type | an ID token or a refresh token presented as a bearer is refused (`typ` must be `Bearer`) |
| the roles | `realm_access.roles`, `resource_access.<client>.roles` of the mapped clients and the mapped flat claims; a claim of the wrong shape or past 128 roles refuses the token |

`verify` answers `{ kind: "ok", value: OidcPrincipal }` or `{ kind: "refused", code: "PASSPORT_ACCESS_TOKEN_INVALID", detail: { reason } }` (the code `@starci/auth` refuses with; the reason is for the log). A provider that cannot be asked and has nothing cached throws an `OidcError` of kind `unavailable`, which the app maps to a 503, never a 401: an identity-provider outage does not sign anyone out.

Endpoints a discovery document advertises are trusted only on the issuer's origin, over https, without credentials; `http:` is admitted only with `allowInsecureHttp` (a developer machine or a test double).

### Keycloak behind the back end

An app that signs people in through its own pages keeps the tokens on the server: the browser holds the app's session, never a provider token. `OidcBroker` (token `OIDC_BROKER`, also `createOidc(...).broker`) is the one facade the app's identity port binds to; every call goes through the `OidcHttp` port with the registration's deadline, and nothing logs a password or a token. The port may now be asked for `PUT`, a JSON `body` and `headers` (the admin API); an app's adapter passes them on as they are.

| method | does |
|---|---|
| `passwordGrant(identifier, password)` | the password grant (a username or the email the realm accepts) |
| `refresh(refreshToken)` | the refresh grant; the provider rotates the refresh token |
| `revoke(refreshToken)` | the discovered `revocation_endpoint` (RFC 7009), else the end-session endpoint with the refresh token; a token the provider no longer knows is already ended |
| `socialAuthorizationUrl({ provider, state, nonce, codeChallenge })` | the authorization address with `kc_idp_hint=<provider>` (the idp alias of the realm) |
| `exchangeSocialCode({ code, codeVerifier, nonce })` | the code exchange, ID token verified |
| `createUser({ email, username, password })`, `findUserByEmail(email)`, `resetPassword(subject, password)`, `logoutAll(subject)` | the realm admin API as the service account of the client (`client_credentials`, cached until it expires; it needs the realm-management roles for users and a client secret) |

The token-returning methods resolve to `{ subject, roles, email: string | null, refreshToken, refreshExpiresAt: Date }` (the access token is verified against the registration and dropped). A failure is an `OidcError`: `kind` `unavailable` (an outage, a 5xx, a 429), `credentials-rejected` (`invalid_grant` on the password or refresh grant), `email-registered` (409 on `createUser`), `password-invalid` (the realm's policy refuses the password), `social-rejected` (a bad code, nonce or answer of the federated sign-in); the existing `unauthenticated` (a response that cannot be trusted, a request the service account may not make) and `invalid` (configuration) stay. The admin base `<origin>/admin/realms/<realm>` is derived from the issuer (`<origin>[/<prefix>]/realms/<realm>`). The pieces are provided too: `OIDC_TOKEN_CLIENT` (`OidcTokenClient`) and `OIDC_ADMIN_CLIENT` (`OidcAdminClient`). A registration without a `client` throws a `ConfigurationInvalid` error when one of them is called.

### The glue in an app

`integrations/keycloak` (slot `be.integrations.keycloak`) is declaration only, five files; no unit spec sits beside them (the proof is the integration spec of `src/tests/integration/keycloak/`, which drives an outage with `FakeOidcIssuer`, and the guard's own spec):

| file | holds |
|---|---|
| `keycloak.options.ts` | the typed registered client (`issuer`, `audience`, `clientId`, `clientSecret: Secret`, `callbackUri`, `postLogoutUri`, `timeoutMs`) |
| `keycloak.config.ts` | `parseKeycloakConfig(env: EnvSource)`: `env.url`, `env.string`, `env.secret`, `env.int`; no default address or credential |
| `keycloak.decorators.ts` | the tokens of the package's verifier (`OIDC_PRINCIPAL_VERIFIER`), which `domain/identity` provides under its own `ACCESS_TOKEN_VERIFIER`, and of the broker (`OIDC_BROKER`), which the identity port binds to directly (`{ provide: <port token>, useExisting: OIDC_BROKER }`) |
| `keycloak.registration.ts` | `keycloakModule(options, { isGlobal })` = `OidcModule.registerAsync` over `HTTP_CLIENT` and `CLOCK`, the `http` option adapting `HttpClient.request` with its correlation id |
| `index.ts` | what the rest of the app reads: the config parser, the module function, the tokens and the package's `PrincipalVerifier`, `OidcPrincipal` and `OidcBroker` types |

`AuthGuard` of `domain/identity` reads the bearer token and asks the injected `PrincipalVerifier`, exactly as the lite guard asks `@starci/auth`'s: a verified principal is left on the request, a refusal is `IDENTITY_UNAUTHENTICATED`, and an `unavailable` error is not caught (the errors filter maps its kind to a 503).

## Front end

```ts
// modules/auth/client.ts: the one instance
export const auth = createOidcClient({ issuer: () => issuer(), clientId: "web", redirectUri: () => `${origin()}/auth/callback`, postLogoutRedirectUri: () => origin() })
```

`signIn()` redirects to the provider; the callback page calls `completeSignIn(window.location.href)`; `restore()` signs in again without a page after a reload (a `prompt=none` redirect, tried once); `accessToken()`, `renew()`, `headers()`, `subscribe`, `getSnapshot`, `watch` and `signOut()` have the shape of the `@starci/auth/client` session surface. The refresh token lives in memory with the access token and never in storage; a refresh ends the session only on a 401, a 403 or a 400 `invalid_grant`, and a 429, a 5xx or a lost connection is retried with backoff.

## Tests

`npm test` typechecks (including the assignability of the verifier and the client to the `@starci/auth` interfaces), lints, and runs the `node:test` specs under 90% line coverage. The suite needs `@starci/auth` built next to it (`file:../auth`).

```ts
const issuer = await FakeOidcIssuer.create({ audience: "api" })
const moduleRef = await Test.createTestingModule({ imports: [OidcModule.register(issuer.options({ callbackUri }))] }).compile()
const token = await issuer.mintAccessToken({ sub: "user-1", roles: ["member"] })
issuer.setDown(true) // the provider is unreachable: verification throws an unavailable error
```
