---
slots: [be.app, be.app.api, be.app.worker, be.app.cli, be.platform]
---
# Configuration and secrets

Who reads the environment, who parses it and how values reach code: one `EnvSource`, a typed reader per app, a parser
per capability, options through injectors, no default for a secret or an address. Agents never read, print or
generate a secret value.

## BE-CONFIG-1 One reader of the environment, one reader per app

`EnvSource` of `platform/config` is the only reader of `process.env`: `EnvSource.fromProcess()` reads it once, a
declared `<KEY>_FILE` supplies the exact contents of `<KEY>` (an unreadable path stops boot), and typed readers
(`string`, `int`, `bool`, `url`, `enum`, `duration`, `secret`, `optional`, `has`, `anyDeclared`) name the missing or
malformed key in a `ConfigError`. Each app has `<app>.env.ts` exporting the `<App>Options` interface (members typed
`ReturnType<typeof parse<C>Config>`) and `read<App>Env(env: EnvSource): <App>Options`, which only calls parsers; only
`main.ts` calls it. Nothing else reads the environment: no config service, dotenv or module-level read.

Why: one reader makes every dependency on the environment visible and fails boot on the first bad key, by name.

```ts
/** Everything the API needs from its environment, parsed once and handed to `AppModule.register`. */
export interface ApiOptions {
    /** The HTTP listener. */
    readonly server: ReturnType<typeof parseServerConfig>
    /** The least-privilege connection to the primary database. */
    readonly database: ReturnType<typeof parsePrimaryDatabaseConfig>
}

/** Parses every capability's options; a missing key stops boot naming the key. */
export const readApiEnv = (env: EnvSource): ApiOptions => ({
    server: parseServerConfig(env),
    database: parsePrimaryDatabaseConfig(env),
})
```

Enforced by: `no-direct-env-read`, `config-parsed-in-main` (R43), `app-env-required` (R289).

## BE-CONFIG-2 A capability parses its own config; classes read it through the injector

A configured capability or provider has `<c>.config.ts` exporting `parse<C>Config(env: EnvSource): <C>Options` (or
`| null` for an optional integration) and `<c>.options.ts` with the type. The app hands the value to
`X.register({ isGlobal: true, ...options.x })`; the module definition uses the capability's options token as its
`optionsInjectionToken`, and a class reads it with `@Inject<C>Options()`. No central config file knows every provider.

Why: a central config imports every domain and integration type and grows without an owner.

Enforced by: `config-parsed-in-main` (R43), `infra-needs-injector` (R85).

## BE-CONFIG-3 No default for a secret or an address

A secret, token, key, host, URL, bucket or database name has no default of any kind; a secret is typed `Secret`
(`env.secret(KEY)`, masked when serialized, `reveal()` only where a library needs it). A tunable (a timeout, a size, a
public provider origin) may default, inside its `<c>.config.ts` only. An optional integration with none of its keys set
parses to `null` and the app composes nothing for it; with some set, boot stops naming the missing ones.

Why: a default secret ships to production silently, and a default address points a process at the wrong system.

Enforced by: `no-secret-default` (R44), R248.

## BE-CONFIG-4 Secrets live only sealed in the stack

A secret exists only as a sealed `.starcistacks/<env>/secrets/<slug>.enc` member and reaches the process at runtime
through `<KEY>_FILE`; a decrypted value never enters the app tree, ignored or not. Key lists name slugs, never values.

Why: one sealed location makes custody auditable and keeps plaintext out of history and agent context.

Enforced by: R06, R277, R253 (hfs).
