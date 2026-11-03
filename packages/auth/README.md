# @starci/auth

The sign-in of a lite StarCi app: one package, four entries.

| entry | holds |
|---|---|
| `@starci/auth/server` | the NestJS module (`AuthModule.register` / `registerAsync`), the token signer and verifier (EdDSA, multi-key JWKS), rotating sessions, the sign-in budget, the refresh cookie, the passport flows and the doors that run them |
| `@starci/auth/client` | `createAuthClient`: access token in memory, one shared refresh, signed out only on 401 or 403 |
| `@starci/auth/client/react` | `AuthProvider`, `useAuthSession`, `useAuthClient`, `useWhenSignedIn`, `useCooldown` (context and hooks over the client; no visual) |
| `@starci/auth/contracts` | door paths, wire codes, claim names and answer shapes both sides read |
| `@starci/auth/testing` | test keys, a fake clock, in-memory stores, `testAuthOptions` |

An app reaches the package only through `integrations/passport` (back end) and `modules/auth/client.ts` (front end); the lint refuses `passport*`, `jose`, `bcryptjs` and `@nestjs/jwt` in an app.

## Back end

```ts
AuthModule.registerAsync({
    isGlobal: true,
    authenticator: IDENTITY_AUTHENTICATOR, // the token of the app's AuthAuthenticator, resolved from a global module
    inject: [SESSION_STORE, ACCOUNT_DIRECTORY, RATE_LIMIT_STORE],
    useFactory: (sessions, accounts, rate) => ({ ...parsedOptions, sessions, accounts, rate }),
})
```

The package reads no environment. The app parses its settings (BE-CONFIG-2) and passes typed options; secrets are passed as `{ reveal(): string }` holders or text. The app implements `SessionStore` over the tables of `migrations/identity-sessions.sql` (an app whose baseline holds the 0.2.0 tables adds `migrations/identity-refresh-raced-successors.sql`), `AccountDirectory` over its account doors (in a StarCi lite app, the managed `persistence/account-doors.port.ts` over the SECURITY DEFINER `be_auth_*` functions of the baseline), `RateCounter` over its shared counter, and `AuthAuthenticator` (the password and Google decisions) using `AuthPasswords` and `SignInBudget.counted` from the module.

Key rotation: list the new key first with its private key, keep the old key with its public key only, deploy, and drop the old key once its access tokens have expired. Every listed key verifies and is published by `AuthSessions.jwks()`.

## Front end

```ts
// modules/auth/client.ts: the one instance
export const auth = createAuthClient({ apiOrigin: () => apiOrigin() })
```

## Tests

`npm test` typechecks, lints and runs the `node:test` specs under 90% line coverage.
