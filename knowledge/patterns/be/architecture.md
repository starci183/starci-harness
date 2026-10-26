---
slots: [be.app, be.app.api, be.app.worker, be.app.cli, be.feature]
---
# Architecture

Decides the tiers, the one dependency direction between them, what an app may hold, the one module shape and how trigger kinds
meet. Folder placement is folder.md; the env reader is config.md; boot proof by test is test.md (BE-TEST-12).

## BE-ARCHITECTURE-1 Dependency direction follows the tier matrix
An app may import features, domain, platform, integrations and packages. A feature imports domain, platform, integrations and
packages, never another feature. A domain capability imports other domain capabilities (acyclic), platform, integrations and
packages. An integration imports platform and packages only. A platform capability imports platform (acyclic) and packages only.
An `import type`, a re-export, a literal dynamic import and a package export count exactly like a value import. Cross-owner
imports go through the owner's public entry (BE-IMPORTS-1).

Why: domain owns invariants, platform is technical runtime, integrations translate providers; an upward edge makes an owner
impossible to test or split, and a type-only edge hides a real cycle.

- When a platform module needs a domain enum or entity list → receive it through `register(options)` composed by the app, or move
  the neutral type down to platform.
- When a domain capability needs a provider → import the integration's public API; the integration owns its contract, errors and
  config and never imports the domain.
- When an alias, relative path or package export does not resolve → it is a configuration failure, never a pass.

Enforced by: R26 BE_TIER_DIRECTION, R27 ARCH_OWNER_CYCLE, R28 BE_FEATURE_IMPORTS_FEATURE, R30 BE_PUBLIC_SURFACE.

## BE-ARCHITECTURE-2 An app owns bootstrap and composition only
`be/apps/<app>/src` holds five roles, each within the line budget of its `be.app.*` slot (`hfs/slots.yaml`):
- `main.ts` builds `EnvSource` once, calls `read<App>Env` from `<app>.env.ts`, builds `AppOptions`, boots
  `AppModule.register(options)` and reports a startup failure with the failing key or module name. The cli app boots through
  `CommandFactory.run` instead (BE-CLI-1).
- `<app>.env.ts` is the typed environment reader (BE-CONFIG-1).
- `<app>.options.ts` holds env-derived values and port bindings (provider maps such as `{ approvalGate: ApprovalGateAdapter }`),
  with no parsing.
- `compose/<area>.ts` exports explicitly typed module, provider, queue or scheduler lists for one area (platform, background, a
  product area), as a function of the options when needed. Its `X.register({ isGlobal: true, ...options.x })` calls count as root
  registrations.
- `app.module.ts` spreads the groups into `imports` (`...platformModules(options)`); its own providers bind only the app-wide
  guards and filter (`APP_GUARD`, `APP_FILTER`).

Neither the env nor the options file holds a module list, a `register`/`forRoot`/`registerQueue` call or a scheduler entry; no
compose group or options file reads the environment; no app file holds a business arrow, branch, handler, service, resolver or
entity. Roles are judged by resolved types, so an aliased import or a registration saved to a constant is still composition.
An app root that outgrows its budget moves an area into a new group, never into the env or options file. An app has no spec of
its own; the e2e world (full) or the wiring check (lite) proves it (BE-TEST-12). A process entrypoint exists only under
`be/apps/*/src`.

Why: a thin root makes startup explicit and keeps behaviour testable below it; one group per area keeps the options pure data and
the root a table of contents.

- When a second process kind is needed → add a `be.app.worker` app (background scaled apart) or a command of the one cli app;
  never grow the api app with either.
- When `api.options.ts` exports `modules: [...]` or `schedulers: [...]` → keep only parsed values and the port map there; the list
  goes into `compose/<area>.ts`.

Enforced by: R32 BE_APP_COMPOSITION_ONLY, R33 BE_ENTRYPOINT_ONLY_IN_APPS, R245 BE_APP_OPTIONS_COMPOSITION, R246
BE_APP_COMPOSITION_BUDGET, R265 BE_COMPOSITION_UNTYPED, R289 BE_APP_ENV_REQUIRED.

## BE-ARCHITECTURE-3 One module shape; one representative module per capability, registered once per app
Every Nest module (capability, sub-module, feature application module, transport module, cli group) has
`<x>.module-definition.ts` (`new ConfigurableModuleBuilder<XOptions>().setClassMethodName("register").build()`), `<x>.options.ts`
and `<x>.module.ts` extending `ConfigurableModuleClass` with only its `@Module` metadata, and is listed only as
`XModule.register({...})` (`{}` without options). A capability module definition adds the `isGlobal` extra:
`.setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))`. `XOptions` is required;
a capability without options declares `export type XOptions = Record<string, never>`. `register` is the only method name; a
module that adds providers overrides `static register(options: typeof OPTIONS_TYPE): DynamicModule`.

Each capability has one representative module, registered exactly once per app at the root as
`X.register({ isGlobal: true, ...options.x })`. It may split into sub-modules (`PetModule.register({})`) that are never global,
never registered by an app and have exactly one importer, their parent. Other owners reach a capability only through its injectors
or public classes and never import its module; the one legal cross-module import is a transport module importing its own
feature's application module. `isGlobal: true` appears only in app roots and `@Global()` nowhere. No `new` of an `@Injectable`,
no module-level `let`, no two modules in one file, no composition helper. Each owner exposes one `index.ts` of named exports
within its slot's `budget.indexExports` (`hfs/slots.yaml`).

Why: a stateful module imported by two consumers is two instances (two pools, two clients); registering the representative once
at the root removes that failure class and makes globality a composition decision.

- When providers differ by connection → one connection per database with its own injector and one
  `DatabaseModule.register({ isGlobal: true, connections })` at the root (BE-PERSISTENCE-8).

Enforced by: R45 BE_MODULE_SHAPE, R295 BE_MODULE_DEFINITION_MISSING, R30 BE_PUBLIC_SURFACE, R25 HFS_UNUSED_EXPORT.

## BE-ARCHITECTURE-4 Application contracts do not depend on transport
Messages, handlers and contracts in `application/` import no transport DTO, request or session context, generated GraphQL type
or protocol decorator (a namespace alias does not hide one), and no ORM entity appears in a contract. Nest injection alone is
allowed there. Transport adapters import application messages and project results.

Why: several protocols reuse one operation only when its contract depends on none of their shapes.

Enforced by: R29 BE_FEATURE_SHAPE, R37 BE_ENTITY_IN_CONTRACT.

## BE-ARCHITECTURE-5 Owners form an acyclic graph and every feature is composed
No cycle exists between owners at any tier, `import type` included. Every feature, transport module and capability module is
composed by at least one app, added in the same change as the feature; code no app composes never runs, so it is a finding even
when its specs pass. Api feature modules are static: `<feature>.module.ts` for the handlers and one `<feature>-<protocol>.module.ts`
per transport folder, never a module per operation. The edition's boot proof (BE-TEST-12) fails when a module or provider is
missing.

Why: a cycle prevents separate testing and splitting, and an uncomposed feature is dead code that still looks finished; import
syntax and unit specs do not establish a working container.

- When two capabilities need each other → extract the shared contract into a third capability or platform.

Enforced by: R27 ARCH_OWNER_CYCLE, R31 BE_FEATURE_NOT_COMPOSED, R272 BE_APP_BOOT_PROOF_MISSING.

## BE-ARCHITECTURE-6 No trigger kind imports another; kinds meet through the event bus
Features are grouped by what starts their work (`api`, `webhooks`, `realtime`, `saga`, `reactors`, `jobs`, `cli`; the `trigger` of
the kind's slot). Business logic stays in `modules/`; a feature is a thin door. A kind imports only `modules/*`, never another
kind (type-only imports count; imports inside one owner are fine), and only `be/apps/*` compose features. Every cross-kind call is
an event: a domain service publishes in its transaction and the other kind consumes it.

Why: a direct import couples two failure domains and runs the callee inside the caller's process and transaction; an event is
durable, retried and observable, so kinds deploy and scale apart.

- When a request must start a background job → the domain service the handler calls enqueues it in its transaction
  (BE-QUEUES-1); the jobs feature never appears in an api import.
- When a saga step needs a job's result → the job's domain service publishes a completion event that a saga consumer takes.
- When an api feature wants rows a cli seed builds → both import the domain capability that owns them.

Enforced by: R156 BE_KIND_ISOLATION, R28 BE_FEATURE_IMPORTS_FEATURE.
