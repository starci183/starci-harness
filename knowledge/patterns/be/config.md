---
slots: [be.app, be.app.api, be.app.worker, be.app.cli, be.platform]
---
# Configuration and secrets

Decides who reads the environment, who parses it and how values reach code: one `EnvSource`, a typed reader per app, a parser per
capability, options through injectors, no default for a secret or an address. The app files themselves are BE-ARCHITECTURE-2.
Agents never read, print, generate or rotate a secret value.

## BE-CONFIG-1 One reader of the environment
`platform/config` owns `EnvSource`, the standard reader of `process.env`, with typed readers (`string`, `int`, `bool`, `url`,
`secret`, `enum`, `duration`, `optional(...)`, `anyDeclared(keys)`). `env.secret("<NAME>")` reads the exact contents of the file
`<NAME>_FILE` names first; an empty or unreadable path stops boot with no fallback or trimming, and plain `<NAME>` is read only
when `<NAME>_FILE` is absent. Each app has `<app>.env.ts` (never `env.ts`) exporting an explicit `<App>Env` interface of readonly
parsed members, typed from the capability parsers and structurally compatible with the app's options, and
`read<App>Env(env: EnvSource): <App>Env`. It holds fail-fast parsing only: no localhost or default host fallback, logic, module
composition, business code or feature import. `main.ts` builds `EnvSource` once and calls it. Only `EnvSource`, `main.ts`,
`<app>.env.ts` and the test world read the environment; module factories, compose groups and the options file receive values.
No config service, dotenv, preload file or module-level config read exists, and `platform/config` imports no domain or
integration type.

Why: a single reader makes every dependency on the environment visible and keeps platform independent of domain.

- Shape:
  ```ts
  export interface ApiEnv {
      readonly server: ReturnType<typeof parseServerConfig>
      readonly database: ReturnType<typeof parsePrimaryDatabaseConfig>
  }
  export const readApiEnv = (env: EnvSource): ApiEnv => ({ server: parseServerConfig(env), database: parsePrimaryDatabaseConfig(env) })
  ```

Enforced by: R43 BE_CONFIG_OWNER, R289 BE_APP_ENV_REQUIRED.

## BE-CONFIG-2 Config per capability, options through the injector
Each configured capability or provider has `<c>.config.ts` exporting `parse<C>Config(env: EnvSource): <C>Options` (or
`<C>Options | null` for an optional integration) and `<c>.options.ts` exporting the type; `read<App>Env` calls the parsers once.
The module receives its options through `register()`, and classes read them with `Inject<C>Options()`. No central config file
knowing every provider, no second config path and no schema library: the typed readers are the parser and already name the
missing key. A dynamic option never substitutes for provider identity or lifetime design.

Why: a central config file imports every domain and integration type, causes cycles and grows without an owner; an environment
read inside a factory moves the config boundary out of the app.

- `PurchaseModule.register({ isGlobal: true, ...options.purchase })`, then `@InjectPurchaseOptions() private readonly options: PurchaseOptions`.

Enforced by: R43 BE_CONFIG_OWNER, R85 BE_RAW_INJECT, R45 BE_MODULE_SHAPE.

## BE-CONFIG-3 No default for a secret or an address; an optional integration is all-or-nothing
A secret, credential, token, key, host, URL, remote port, bucket or database name has no default of any kind (no `""`,
`"localhost"` or `?? "http://..."`); secrets are typed `Secret` by `env.secret`. Tunables (timeouts, concurrency, TTLs, page sizes)
may default, inside `<c>.config.ts` only. An optional integration with none of its keys set parses to `null` and the app composes
its disabled variant or nothing; with some set, boot stops naming the missing keys, never the values. Local values live in the
local stack's env files, never in code; no `process.cwd()` is joined with a source or stack path.

Why: a default secret ships to production silently, and a default address points a process at the wrong system.

Enforced by: R44 BE_SECRET_DEFAULT, R248 ENV_REQUIRED_UNSET.

## BE-CONFIG-4 Secrets live only sealed in the stack
Secrets exist only as sealed `.starcistacks/<env>/secrets/<slug>.enc` members. A decrypted value never enters the app tree,
ignored or not; it reaches the process at runtime through `*_FILE` from host-local custody or memory. Key lists name slugs only, and
an identity or provider record points at its slug and holds no value.

Why: one sealed location makes custody auditable and keeps plaintext out of history, caches and agent context.

Enforced by: R06 HFS_PLAINTEXT_SECRET, R277 HFS_SECRET_PLAINTEXT_FILE, R253 HFS_AGE_KEY_CUSTODY.
