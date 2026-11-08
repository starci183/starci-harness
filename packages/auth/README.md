# @starci/auth

The sign-in of a StarCi app, for both editions: one package, eight entries. Lite apps issue their own identity (`./server`); full apps
verify their identity provider's tokens (`./oidc`). Every provider and issuer lives here, so a new one is one file.

| entry | edition | holds |
|---|---|---|
| `@starci/auth/server` | lite | the NestJS module (`AuthModule.register` / `registerAsync`), the token signer and verifier (EdDSA, multi-key JWKS), rotating sessions, the sign-in budget, the refresh cookie, the passport flows, the sign-in providers (`google`, `github`, `defineProvider`) and the doors that run them |
| `@starci/auth/oidc` | full | `OidcModule.register` / `registerAsync` (also `createOidc` without Nest): issuer discovery, the provider's JWKS with caching and rotation, the token verifier, `OidcPrincipalVerifier`, role mapping, `OidcClient` (authorization code flow with PKCE, state and nonce), `OidcTokenClient`, `OidcAdminClient`, `OidcBroker`, and the issuer presets (`keycloakIssuer`, `googleIssuer`, `githubActionsIssuer`, `createIssuerVerifier`) |
| `@starci/auth/client` | lite | `createAuthClient`: access token in memory, one shared refresh, signed out only on 401 or 403 |
| `@starci/auth/client/oidc` | full | `createOidcClient`: the browser half of a public OIDC client (PKCE redirect, callback, one shared refresh, the token in memory) |
| `@starci/auth/client/react` | lite | `AuthProvider`, `useAuthSession`, `useAuthClient`, `useWhenSignedIn`, `useCooldown` (context and hooks over the client; no visual) |
| `@starci/auth/contracts` | both | door paths, wire codes, claim names and answer shapes both sides read, and the OIDC contract (algorithms, codes, claims, principal) |
| `@starci/auth/testing` | both | test keys, a fake clock, in-memory stores, `testAuthOptions`, and `FakeOidcIssuer` (discovery, JWKS, token, revocation and admin endpoints, in memory or on a socket) |
| `@starci/auth/migrations/*` | lite | the session tables (`identity-sessions.sql`, `identity-refresh-raced-successors.sql`) |

An app reaches the package only through its glue: `integrations/passport` (lite) and `integrations/keycloak` (full) in the back end,
`modules/auth/client.ts` in the front end (R328, `BE_AUTH_PASSPORT_OWNER`). The lint refuses `passport*`, `jose`, `bcryptjs`, `@nestjs/jwt`
and every other JWT library in an app, and the retired `@starci/auth-oidc` everywhere.

The lite server throws one error class, `AuthError`; the OIDC side throws `OidcError`. Both are `DomainError`s of `@starci/common` whose
`code` is a wire code, with the `kind` they travel as.

## Lite: the back end

```ts
AuthModule.registerAsync({
    isGlobal: true,
    authenticator: IDENTITY_AUTHENTICATOR, // the token of the app's AuthAuthenticator, resolved from a global module
    inject: [SESSION_STORE, ACCOUNT_DIRECTORY, RATE_LIMIT_STORE],
    useFactory: (sessions, accounts, rate) => ({ ...parsedOptions, sessions, accounts, rate }),
})
```

The package reads no environment. The app parses its settings (BE-CONFIG-2) and passes typed options; secrets are passed as `{ reveal(): string }` holders or text. The app implements `SessionStore` over the tables of `migrations/identity-sessions.sql` (an app whose baseline holds the 0.2.0 tables adds `migrations/identity-refresh-raced-successors.sql`), `AccountDirectory` over its account doors (in a StarCi lite app, the managed `persistence/account-doors.port.ts` over the SECURITY DEFINER `be_auth_*` functions of the baseline), `RateCounter` over its shared counter, and `AuthAuthenticator` (the password and provider decisions) using `AuthPasswords` and `SignInBudget.counted` from the module.

Key rotation: list the new key first with its private key, keep the old key with its public key only, deploy, and drop the old key once its access tokens have expired. Every listed key verifies and is published by `AuthSessions.jwks()`.

### Sign-in providers

```ts
import { github, google } from "@starci/auth/server"

AuthModule.register({ ...options, google: null, providers: [google({ clientId, clientSecret, callbackUrl }), github({ clientId, clientSecret, callbackUrl })] })
```

Each provider is served at `/auth/<id>` (`AuthDoors.beginProvider(id, exchange)`) and `/auth/<id>/callback` (`completeProvider`), with
`state` and PKCE (S256) kept in a signed, httpOnly cookie `auth_<id>_state` sent only to `/auth/<id>`, and a same-site landing path. The
`google` option of 0.5.0 still works and means `providers: [google(options.google)]`; naming Google both ways is `PASSPORT_PROVIDERS_INVALID`.
Google keeps its doors (`beginGoogle`, `completeGoogle`), its cookie (`auth_google_state`, the same signed `{ w, u, r, e, p: "google" }`
value) and its codes (`PASSPORT_GOOGLE_*`). Google calls `AuthAuthenticator.signInWithGoogle(profile)`; every other provider calls
`signInWithProvider(profile)` with a `ProviderProfile` (`provider`, `subject`, `email`, `emailVerified`, `name`, `picture`).

GitHub (`github(...)`, an OAuth app) asks for `read:user user:email`, takes the numeric account id as the subject (never the login) and the
primary verified address from `/user/emails`; a public address only is passed as unverified.

A next provider is one file that calls `defineProvider({ id, options, profileOf, strategy })`: `strategy(context)` builds a passport
strategy that keeps its round trip in `context.state` (an `OAuthStateClient`) and signs in through `signInWithProvider(context.authenticator, profile)`;
the module registers it under `id` and the doors serve it.

## Full: the back end

```ts
OidcModule.registerAsync({
    isGlobal: true,
    inject: [HTTP_CLIENT, CLOCK],
    useFactory: (http: HttpClient, clock: Clock) => ({
        ...keycloakOptions({ origin, realm, audience }), // or the parsed issuer, audience and role mapping
        client: parsedClient,
        http: { request: (request) => http.request({ correlationId: "identity-keycloak", ...request }) },
        clock,
    }),
})
```

Every provider request goes through the `OidcHttp` port, so the app's bounded HTTP client (`platform/http`) is the one door; without the port the platform `fetch` is used with the request's deadline.

| a bearer token | is checked by |
|---|---|
| the algorithm | pinned to `algorithms` (`RS256`) before any key is looked up; `none`, HMAC and unlisted algorithms are refused |
| the key | the JWKS of the discovered `jwks_uri`, selected by `kid`; cached 10 minutes; an unknown `kid` refreshes it at most once per 30 seconds (rotation); an unreachable provider keeps the cached keys for 24 hours |
| issuer, audience, expiry, not-before | the registration and the clock, with a clock skew of 5 seconds |
| the token type | an ID token or a refresh token presented as a bearer is refused (`typ` must be `Bearer`) |
| the roles | `realm_access.roles`, `resource_access.<client>.roles` of the mapped clients and the mapped flat claims; a claim of the wrong shape or past 128 roles refuses the token |

`verify` answers `{ kind: "ok", value: OidcPrincipal }` or `{ kind: "refused", code: "PASSPORT_ACCESS_TOKEN_INVALID", detail: { reason } }` (the code the lite verifier refuses with; the reason is for the log). A provider that cannot be asked and has nothing cached throws an `OidcError` of kind `unavailable`, which the app maps to a 503, never a 401. Endpoints a discovery document advertises are trusted only on the issuer's origin, over https, without credentials; `http:` is admitted only with `allowInsecureHttp` (a developer machine or a test double).

`OidcBroker` (token `OIDC_BROKER`) is the one facade an app that keeps Keycloak behind its back end binds its identity port to: `passwordGrant`, `refresh`, `revoke`, `socialAuthorizationUrl` (`kc_idp_hint`), `exchangeSocialCode`, `createUser`, `findUserByEmail`, `resetPassword`, `logoutAll` (the realm admin API as the client's service account). The injection tokens keep their 0.2.0 names (`Symbol.for("@starci/auth-oidc/...")`), so an app's providers resolve them unchanged.

### Issuer presets

A preset is the trust of one issuer as data plus one claim mapping (`IssuerPreset`: issuer and its aliases, pinned algorithms, required
audience, where the keys are, required claims, `identityOf`); `createIssuerVerifier(preset, { http, clock })` verifies a token against it.
A refusal names its `reason` (`audience`, `expired`, `signature`, `claims`, `policy` with the `claim` the policy refused, ...).

| preset | verifies | yields |
|---|---|---|
| `keycloakIssuer({ origin, realm, audience, roles? })` | realm access tokens, keys from the realm's discovery document | the `OidcPrincipal` of the module's verifier |
| `googleIssuer({ clientId, hostedDomain?, requireVerifiedEmail? })` | Google ID tokens (`https://accounts.google.com` or `accounts.google.com`, RS256, Google's pinned key set), a verified address unless told otherwise | `GoogleIdentity`: the lite `GoogleProfile` with `hostedDomain` |
| `githubActionsIssuer({ audience, repository, repositoryId?, workflows?, refs? })` | GitHub Actions OIDC tokens (`https://token.actions.githubusercontent.com`, RS256, GitHub's pinned key set); the audience is required, the repository must match (and `sub` must name it), optionally the repository id, the workflow files of `workflow_ref` and the refs | `GitHubActionsRun`: repository, workflow, workflow path, ref, sha, run id, attempt, actor, event, environment |

The CI attestation of a full app (a workflow run proving which repository, workflow, ref and commit it is) composes `githubActionsIssuer`
inside `integrations/keycloak`; there is no separate integration for it.

## Front end

```ts
// modules/auth/client.ts: the one instance
export const auth = createAuthClient({ apiOrigin: () => apiOrigin() }) // lite
export const auth = createOidcClient({ issuer: () => issuer(), clientId: "web", redirectUri: () => `${origin()}/auth/callback`, postLogoutRedirectUri: () => origin() }) // full
```

The OIDC client's `signIn()` redirects to the provider; the callback page calls `completeSignIn(window.location.href)`; `restore()` signs in again without a page after a reload; `accessToken()`, `renew()`, `headers()`, `subscribe`, `getSnapshot`, `watch` and `signOut()` have the shape of the lite session surface.

## Migrating from `@starci/auth-oidc`

`@starci/auth-oidc` 0.3.0 is a deprecated re-export of this package. `starci app codemod auth-merge` (a dry run; `--execute` writes) rewrites
`@starci/auth-oidc` and `@starci/auth-oidc/server` to `@starci/auth/oidc`, `/client` to `@starci/auth/client/oidc`, `/contracts` to
`@starci/auth/oidc`, `/testing` to `@starci/auth/testing`, and the dependency in every package.json to `@starci/auth`.

## Tests

`npm test` typechecks (the OIDC tree also under `--isolatedDeclarations`, `tsconfig.isolated.json`), lints and runs the `node:test` specs
under 90% line coverage, including the assignability of the OIDC verifier and client to the lite interfaces (`src/oidc/compat.spec.ts`).

```ts
const issuer = await FakeOidcIssuer.create({ audience: "api" })
const token = await issuer.mintAccessToken({ sub: "user-1", roles: ["member"] })
const ci = createIssuerVerifier(githubActionsIssuer({ audience: "api", repository: "o/r", endpoints: issuer.endpoints() }), { http: issuer.http })
```
