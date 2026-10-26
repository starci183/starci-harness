---
slots: [be.app, be.app.api, be.feature, be.feature.application]
---
# Dependency injection

Decides how a dependency arrives in a class: infrastructure through a zero-argument `Inject<Thing>()` injector over a
`unique symbol` token, a domain service by class. Module registration is architecture.md (BE-ARCHITECTURE-3); the transaction a
manager joins is persistence.md (BE-PERSISTENCE-10).

## BE-INJECTION-1 Infrastructure arrives through an injector
A constructor parameter whose declared type is infrastructure (declared under `platform/**`, `integrations/**` or a package:
EntityManager, buses, cache, clock, logger, SDK clients, module options) carries its `Inject<Thing>()` decorator. Undecorated class
injection is allowed only for a domain service. Parameters are `private readonly` and named as `ruleParams.be.paramNames` gives
(`<conn>EntityManager` when a class injects two connections). The check reads the parameter's type and where it is declared,
never the variable name.

Why: a raw token at each call site lets `@Inject(CLOCK) x: Cache` compile, and class injection of a platform class couples every
consumer to its implementation.

Enforced by: R85 BE_RAW_INJECT.

## BE-INJECTION-2 An injector is one shape in one file
An injector is exported from `<owner>.decorators.ts` at the owner root, the only file kind that may call `Inject(`,
`InjectEntityManager(`, `InjectDataSource(`, `InjectQueue(` or any third-party `Inject*`. It is `Inject<Thing>` in PascalCase,
takes no argument (a keyed variant is its own injector, never `InjectS3(key)`), is typed `(): TypedParameterDecorator<T>`, is built
with `injector<T>(token)` of `platform/composition` and its JSDoc names `T`. The token is
`export const THING: unique symbol = Symbol("<owner>.<thing>")` in the same file; `provide:` is a class or such a symbol, never a
string. Every token is exported so a spec can provide it (BE-TEST-3).

Why: one declaration ties the token to its type, keeps token choice out of call sites and makes "who uses the cache" a search for
one function name.

Enforced by: R85 BE_RAW_INJECT.

## BE-INJECTION-3 The injector catalog has fixed names
When the capability exists its injector has this name: `Inject<Conn>EntityManager` and `InjectAdvisoryLock` (platform/database),
`InjectClock`, `InjectLogger`, `InjectHttpClient`, `InjectEventBus`, `InjectEventConsumerRegistry`, `InjectQueueOutbox`,
`InjectInbox`, `InjectMessageCatalog`, `InjectRequestLocale`, `InjectCommandBus`, `InjectQueryBus` (their platform owners),
`InjectCache` (integrations/cache), `Inject<Cap>Options` for each configured capability and `Inject<Provider>` for each
integration SDK client.

Why: fixed names let a reader find the port of any dependency without opening the module, and let e2e override exactly the
integration tokens.

Enforced by: R85 BE_RAW_INJECT, R84 BE_CONNECTION_DUPLICATE.

## BE-INJECTION-4 No service locator, forward reference or property injection
`ModuleRef` is not used in product code, `forwardRef` is not used (a cycle is an R27 finding, not a DI trick), and `@Inject()` is
never written on a field. Receivers are identified by type, so a renamed variable or a lookalike injector outside its home is
judged the same.

Why: a locator or a forward reference hides the dependency graph the machine checks, and property injection escapes the
constructor rules.

Enforced by: R85 BE_RAW_INJECT, R45 BE_MODULE_SHAPE.
