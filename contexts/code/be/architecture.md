---
slots: [be.app, be.app.api, be.app.worker, be.app.cli, be.feature]
---
# Architecture

The tiers and the one direction between them, what an app holds, the one module shape and how trigger kinds meet.
Placement is folder.md, the env reader config.md, the boot proof test.md (BE-TEST-12).

## BE-ARCHITECTURE-1 Dependencies follow the tier matrix

An app imports features and modules; a feature imports modules, never another feature; a domain capability imports
domain (acyclic), platform and integrations; an integration imports platform only; platform imports platform only.
`import type`, re-exports and dynamic imports count like value imports.

Why: domain owns invariants, platform is technical runtime and integrations translate providers; an upward edge makes
an owner impossible to test or split.

- When platform needs a domain value → the app passes it through `register(options)` (as the error-kind and message
  bundles are), never an import.
- When a domain capability needs a provider → it imports the integration's public entry; the integration never imports
  the domain.

Enforced by: `tier-direction`, `package-imports-app`, `owner-cycle`, `feature-imports-feature` (R26, R27, R28).

## BE-ARCHITECTURE-2 An app owns bootstrap and composition only

`be/apps/<app>/src` holds `main.ts`, `<app>.env.ts`, `<app>.options.ts`, `compose/<area>.ts` and `app.module.ts`, each
within its slot budget, counted in lines excluding imports. `main.ts` builds `EnvSource` once, calls `read<App>Env`, boots `AppModule.register(options)`,
applies the edge settings and logs a startup failure with the failing key. `<app>.env.ts` declares the `<App>Options`
interface of parsed members and `read<App>Env` (BE-CONFIG-1). `<app>.options.ts` holds port maps (`{ notifier:
NotifierService }`) and re-exports the options type, with no parsing. A `compose/<area>.ts` returns a typed
`Array<DynamicModule>` for one area; `app.module.ts` spreads the groups and provides only `APP_FILTER` and the
`APP_GUARD` chain.

Why: a thin root makes startup explicit and keeps behaviour testable below it; one group per area keeps options pure
data and the root a table of contents.

```ts
static register(options: ApiOptions): DynamicModule {
    return {
        module: AppModule,
        imports: [...platformModules(options), ...salesModules(), ...jobModules()],
        providers: [
            { provide: APP_FILTER, useClass: ErrorsFilter },
            { provide: APP_GUARD, useClass: RateLimitGuard },
            { provide: APP_GUARD, useClass: OriginGuard },
            { provide: APP_GUARD, useClass: CredentialGuard },
            { provide: APP_GUARD, useClass: AuthGuard },
        ],
    }
}
```

Enforced by: `app-composition-only`, `entrypoint-only-in-apps`, `app-options-composition-free`, `app-file-budget`,
`app-composition-typed`, `app-env-required`, `app-module-list-inline` (R32, R33, R245, R246, R265, R289).

## BE-ARCHITECTURE-3 One module shape; a capability is registered once, at the app root

Every Nest module has `<x>.module-definition.ts` (`new ConfigurableModuleBuilder<XOptions>()...build()`),
`<x>.options.ts` (`Record<string, never>` until it takes options) and `<x>.module.ts` extending
`ConfigurableModuleClass`, and is listed only as `X.register({...})`. A capability's definition adds the `isGlobal`
extra and its module overrides `static register` to add providers and exports; the app root registers it once as
`X.register({ isGlobal: true, ...options.x })`. A feature or transport module carries only `@Module` metadata, and the
one legal cross-module import is a transport module importing its own feature's application module. No `@Global()`,
no `new` of a provider, no module-level `let`, one module per file.

Why: a stateful module imported by two consumers is two instances (two pools, two clients); registering it once at the
root makes globality a composition decision.

```ts
export const { ConfigurableModuleClass, OPTIONS_TYPE } = new ConfigurableModuleBuilder<OrdersOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

@Module({})
/** The orders of a workspace: the only writer of the orders table. */
export class OrdersModule extends ConfigurableModuleClass {
    /** Registers the capability once in the app root. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return { ...base, providers: [...(base.providers ?? []), OrdersService], exports: [OrdersService] }
    }
}
```

Enforced by: `module-definition-required`, `capability-module-shape`, `typed-module-definition`,
`static-module-register`, `no-global-decorator`, `is-global-only-in-app`, `no-cross-owner-module-import`,
`register-once`, `module-per-transport`, `module-registration`, `no-new-injectable`, `no-module-let`,
`one-module-per-file` (R45, R295).

## BE-ARCHITECTURE-4 Application contracts know no transport

`application/` imports no transport DTO, GraphQL type, request object or protocol decorator, and no persistence row or
entity travels in a message. Transports import application messages, never the reverse.

Why: several protocols reuse one operation only when its contract depends on none of their shapes.

Enforced by: `application-never-imports-transport`, `feature-layout`, `no-entity-in-contract` (R29, R37).

## BE-ARCHITECTURE-5 Every feature is composed; owners form no cycle

Every feature, transport and capability module is composed by an app in the same change that adds it, and no cycle
exists between owners. Api features are static: one `<feature>.module.ts` for the handlers and one
`<feature>-<protocol>.module.ts` per transport folder.

Why: code no app composes never runs even when its specs pass, and a cycle prevents splitting and separate testing.

Enforced by: `feature-not-composed`, `owner-cycle` (R31, R27); the boot proof of BE-TEST-12 (R272).

## BE-ARCHITECTURE-6 Trigger kinds never import each other

Features are grouped by what starts them (`api`, `webhooks`, `realtime`, `jobs`, `cli`; `reactors` and `saga` in full).
A kind imports only `modules/*`; work that crosses kinds goes through durable state: a domain service enqueues a job
in its transaction (BE-QUEUES-1) or publishes to the realtime hub (BE-REALTIME-2); in full an event (event-bus.md).

Why: a direct import runs the callee inside the caller's process and transaction; a durable hand-over is retried and
observable, and kinds scale apart.

- When a request must start background work → the domain service the handler calls enqueues the job; the jobs feature
  never appears in an api import.

Enforced by: `kind-isolation` (R156), `feature-imports-feature` (R28).
