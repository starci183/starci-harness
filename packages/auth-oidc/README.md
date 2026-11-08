# @starci/auth-oidc (deprecated)

Retired: the OIDC sign-in of a full StarCi app now lives in [`@starci/auth`](../auth/README.md), beside the lite sign-in, so every provider
and issuer is in one package. This final version, 0.3.0, only re-exports it so a full app keeps building; it gains no feature and the
canon lint refuses its imports (R328, `BE_AUTH_PASSPORT_OWNER`).

| entry of 0.2.0 | now |
|---|---|
| `@starci/auth-oidc/server` | `@starci/auth/oidc` |
| `@starci/auth-oidc/client` | `@starci/auth/client/oidc` |
| `@starci/auth-oidc/contracts` | `@starci/auth/oidc` (also `@starci/auth/contracts`) |
| `@starci/auth-oidc/testing` | `@starci/auth/testing` |

Migrate with `starci app codemod auth-merge` (a dry run that lists every rewrite) and `starci app codemod auth-merge --execute`, which
rewrites the imports and replaces the `@starci/auth-oidc` requirement of every package.json with `@starci/auth`; then `npm install`.

## Tests

`npm test` typechecks, lints and runs `src/reexport.spec.ts`: every runtime name of each 0.2.0 entry is still exported and is the value
`@starci/auth` exports. The suite needs `@starci/auth` built next to it (`file:../auth`).
