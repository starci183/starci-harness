---
slots: [be.app, be.app.api, be.feature, be.feature.application]
---
# Dependency injection

How a dependency reaches a class: infrastructure through a zero-argument `Inject<Thing>()` injector over a
`unique symbol` token, a domain service by its class. Module registration is BE-ARCHITECTURE-3.

## BE-INJECTION-1 Infrastructure arrives through an injector; a domain service by class

A constructor parameter whose type is declared under `platform/**`, `integrations/**`, `queues/**` or a package (the
manager, a bus, the clock, the logger, a client, a port, an options type) carries its `Inject<Thing>()` decorator. Only
a domain service (or a class of the same owner) is injected undecorated by its class. Parameters are
`private readonly`; one whose type is in `ruleParams.be.paramNames` takes that name (`clock`, `logger`, `commandBus`,
`queryBus`, `entityManager`, `options`).

Why: a raw token at each call site lets a mismatched type compile, and class injection of a platform class couples
every consumer to one implementation.

```ts
constructor(
    @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
    @InjectClock() private readonly clock: Clock,
    @InjectAgentsQueue() private readonly queue: AgentsQueue,
    private readonly members: WorkspaceMembersService,
) {}
```

Enforced by: `infra-needs-injector`, `provider-param-token`, `injected-param-name`, `injector-type-match` (R85).

## BE-INJECTION-2 An injector is one shape in its owner's decorators file

`<owner>.decorators.ts` at the owner root is the only file that calls `Inject(` or any third-party `Inject*`. It
exports the token and a zero-argument injector built with `injector<T>(token)` of `platform/composition`, typed
`(): TypedParameterDecorator<T>`, whose docblock names the parameter type. A keyed variant is its own injector. The
module binds the token (`{ provide: TOKEN, useClass: X }` or `useExisting`); an options token is the
`optionsInjectionToken` of the module definition.

Why: one declaration ties the token to its type and makes "who uses this port" a search for one name.

```ts
/** Token of the Telegram client. */
export const TELEGRAM: unique symbol = Symbol("integrations.telegram")

/** Injects the Telegram client. Parameter type: TelegramClient. */
export const InjectTelegram = (): TypedParameterDecorator<TelegramClient> => injector<TelegramClient>(TELEGRAM)
```

Enforced by: `injector-only`, `injector-shape`, `injection-token-exported`, `no-string-token` (R85).

## BE-INJECTION-3 A port has one injector name per capability

When the capability exists its injector is `Inject<Conn>EntityManager`, `InjectAfterCommit` (platform/database),
`InjectClock`, `InjectIds`, `InjectLogger`, `InjectHttpClient`, `InjectQueueOutbox`, `InjectJobClaims`,
`InjectJobProcessorRegistry`, `InjectInbox`, `InjectRealtimeHub`, `InjectMessageCatalog`, `InjectRequestLocale`,
`InjectCommandBus`, `InjectQueryBus` (their platform owners), `Inject<Queue>Queue` per queue, `Inject<Cap>Options` per
configured capability and `Inject<Provider>` per integration client.

Why: fixed names let a reader find the port of any dependency without opening the module.

Enforced by: `injector-shape` (R85); the names are review only.

## BE-INJECTION-4 No locator, forward reference or property injection

No `ModuleRef` in product code, no `forwardRef` (a cycle is a finding, not a trick), no `@Inject()` on a field.

Why: a locator or a forward reference hides the dependency graph the lint checks.

Enforced by: `no-module-ref`, `no-forward-ref` (R85).
