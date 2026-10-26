---
slots: [be.feature, be.feature.application, be.app.api]
files:
  - path: src/features/api/<feature>/index.ts
    slot: be.feature
    role: The public surface of the feature; only apps import it.
    rules: [BE_PUBLIC_SURFACE]
    template: api/feature.index.ts.tpl
  - path: src/features/api/<feature>/<feature>.options.ts
    slot: be.feature
    template: api/feature.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/api/<feature>/<feature>.module-definition.ts
    slot: be.feature
    template: api/feature.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/api/<feature>/<feature>.module.ts
    slot: be.feature
    role: Composes the application handlers.
    template: api/feature.module.ts.tpl
  - path: src/features/api/<feature>/application/<action>.command.ts
    slot: be.feature.application
    role: One command (or `.query.ts`) carrying one `params` field.
    template: api/application.command.ts.tpl
  - path: src/features/api/<feature>/application/<action>.handler.ts
    slot: be.feature.application
    role: Overrides `process` and makes one delegating call to the domain service of its context.
    template: api/application.handler.ts.tpl
  - path: src/features/api/<feature>/application/<action>.contracts.ts
    slot: be.feature.application
    role: The plain request and result types of the action.
    template: api/application.contracts.ts.tpl
  - path: src/features/api/<feature>/transport/graphql/<action>.resolver.ts
    slot: be.transport.graphql
    role: The GraphQL door of one operation; dispatches one message.
    rules: [BE_TRANSPORT_SHAPE, BE_DEFAULT_DENY]
    template: api/graphql.resolver.ts.tpl
  - path: src/features/api/<feature>/transport/graphql/dto/<action>.input.ts
    slot: be.transport.graphql
    role: The bounded input of the operation.
    rules: [BE_INPUT_BOUNDED]
    template: api/graphql.input.ts.tpl
  - path: src/features/api/<feature>/transport/graphql/dto/<action>.type.ts
    slot: be.transport.graphql
    role: The typed output of the operation.
    template: api/graphql.type.ts.tpl
  - path: src/features/api/<feature>/transport/graphql/<action>.mapper.ts
    slot: be.transport.graphql
    role: Maps the input to the request and the result to the type.
    template: api/graphql.mapper.ts.tpl
  - path: src/features/api/<feature>/transport/graphql/<feature>-graphql.options.ts
    slot: be.transport.graphql
    template: api/graphql.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/api/<feature>/transport/graphql/<feature>-graphql.module-definition.ts
    slot: be.transport.graphql
    template: api/graphql.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/api/<feature>/transport/graphql/<feature>-graphql.module.ts
    slot: be.transport.graphql
    role: One module for the whole GraphQL transport of the feature.
    template: api/graphql.module.ts.tpl
  - path: src/features/api/<feature>/transport/http/<action>.controller.ts
    slot: be.transport.http
    role: A REST door, only where GraphQL cannot serve (health, byte streams, the operation route).
    optional: true
    rules: [BE_TRANSPORT_SHAPE, BE_DEFAULT_DENY]
  - path: src/features/api/<feature>/transport/http/<feature>-http.module.ts
    slot: be.transport.http
    role: One module for the whole HTTP transport of the feature.
    optional: true
  - path: src/features/api/<feature>/messages/<feature>.messages.ts
    slot: be.feature.messages
    role: The keyed text of the feature in every locale.
    optional: true
  - path: contracts/<app>/schema.graphql
    slot: be.contract.graphql
    role: The emitted GraphQL snapshot of the app; a stale file fails the full check.
    optional: true
  - path: src/tests/e2e/<area>/<action>.e2e-spec.ts
    slot: be.tests.e2e
    role: The operation on the booted app, refusal and unauthenticated call included.
    optional: true
---
# Api features

Decides the api trigger kind: a flat feature of plain CQRS behind thin transports, its e2e proof and the versioned operation
table. Door shapes are transport.md, auth and input bounds api-auth.md, the app files architecture.md (BE-ARCHITECTURE-2), and
the rule that work inside one context is synchronous domain.md (BE-DOMAIN-2).

## BE-API-1 An api feature has one fixed shape and is composed only by apps
`be/src/features/api/<feature>/` holds `index.ts`, its module files, `application/` (with the opt-in `support/` of feature-local
helpers), `transport/<protocol>/` and, when it has copy, `messages/`, and nothing else. A protocol is `transport/graphql` or
`transport/http` (composed by an api app) or `transport/message` (composed by the owning api app or a worker app), each with exactly
one `<feature>-<protocol>.module.ts`, its resolvers, controllers or consumers, their `<action>.mapper.ts` and `dto/` where the
protocol has DTOs. The feature imports only `modules/*` (BE-ARCHITECTURE-6).

Why: several protocols share one operation without importing transport DTOs into the application layer, and an app composes only
the transports it serves.

- When an operation is reachable over HTTP and GraphQL → one command and handler; the controller and the resolver each dispatch
  it.

Enforced by: R29 BE_FEATURE_SHAPE, R28 BE_FEATURE_IMPORTS_FEATURE, R31 BE_FEATURE_NOT_COMPOSED.

## BE-CQRS-1 The application folder holds messages, handlers, contracts and support only
`application/` holds `<action>.command.ts` or `<action>.query.ts`, `<action>.handler.ts`, `<action>.contracts.ts` and the opt-in
`support/`. No `*.use-case.ts`, no forwarder `<op>.service.ts`, no protocol-named folder. A read is a query and a write is a
command; a handler never serves both.

Why: one shape per operation gives one interception point and one message object, so the scenario is never hidden in a wrapper.

Enforced by: R87 BE_CQRS_SHAPE, R29 BE_FEATURE_SHAPE.

## BE-CQRS-2 A message is a typed Command or Query carrying one params field
`export class <Action>Command extends Command<<Action>Result> { constructor(readonly params: ExecuteParams<<Action>Request>) { super() } }`
(`Query<R>` for reads): one `readonly params`, no methods, no defaults. `ExecuteParams<T> = { request: T; principal: Principal }`
for an authenticated operation, `PublicExecuteParams<T> = { request: T }` for a `@Public` one, so the type states whether the door
is public and the principal is never optional. `Principal = { id; roles }` is owned by `platform/cqrs`. These are the only
shared params wrappers: no other all-purpose envelope carrying entities, tokens or context fields. The request is a plain
application type; no entity, transport DTO or raw provider token travels in params.

Why: the bus types `execute` with the message's result, so the compiler proves what the transport gets back, and a principal that
cannot be absent removes a class of authorization bugs; a wide envelope leaks dependencies and authority.

Enforced by: R87 BE_CQRS_SHAPE, R37 BE_ENTITY_IN_CONTRACT.

## BE-CQRS-3 A handler is thin; the domain service owns the scenario
`@CommandHandler(X)` or `@QueryHandler(X)` on a class extending `ICQRSHandler<X, XResult>` that implements
`protected override async process(message)` with a declared return type and never overrides `execute`. `ICQRSHandler.execute` is
load-bearing: it logs `OperationFailed` with the operation name and rethrows, and counts refused outcomes. `process` maps the
message and makes one delegating call to an injected domain service; it injects services only (plus the Logger), never an
EntityManager, and has no unit spec. The service owns the work: it authorizes the resource, opens the one transaction
(BE-PERSISTENCE-10), stamps `clock.now()` once and passes it down, and holds the decisions its `<name>.service.spec.ts` asserts.
`<Action>Result` is a plain projection or an `Outcome<Value, Code>`. One operation has one handler; a scenario reachable over two
protocols is still one handler.

Why: one template gives every operation the same failure log and metric, and a decision kept out of the feature tier is one a
measured spec reaches.

- `protected override async process(command: PlaceOrderCommand): Promise<PlaceOrderResult> { return this.orderService.place(command.params) }`

Enforced by: R87 BE_CQRS_SHAPE, R75 BE_RETURN_TYPE, R203 BE_FEATURE_THIN.

## BE-CQRS-4 The bus is the only way into a handler; nothing forwards
A handler is reached only through `commandBus.execute` or `queryBus.execute` from a transport (BE-TRANSPORT-2); no service sits
between them. No in-process event exists: `EventBus`, `@EventsHandler`, `EventEmitter2`, `@OnEvent` and in-process broker bridges
are not used. A follow-up that crosses a context or runs later is an event published in the domain transaction (BE-DOMAIN-2).

Why: a forwarder is indirection where logic creeps in, and an in-process event does not survive a crash between commit and
delivery.

Enforced by: R87 BE_CQRS_SHAPE, R88 BE_TRANSPORT_SHAPE.

## BE-API-3 Every operation has an e2e flow on the real app
Each resolver method and controller action is driven by an e2e spec (`src/tests/e2e/<area>/*.e2e-spec.ts`) that boots the real
AppModule and calls it as a client does: the happy path, each refusal the command declares (asserting its error code, not only a
status) and the denial of an unauthenticated caller.

Why: a transport is thin and has no logic to unit-test; what breaks is wiring, guards and mapping, which only the booted app
exercises.

Enforced by: R41 BE_DEFAULT_DENY, R48 BE_SPEC_QUALITY.

## BE-OPERATIONS-1 A versioned operation is declared once in the app's typed operation table
A versioned operation `<name>@<version>` served over one operation route is declared once, in the table
`be/apps/<app>/src/operations.ts` exports as `OPERATIONS`. Because a feature cannot import an app, the table is made in a
`<name>-operations.contracts.ts` of the domain capability that owns the operations and re-exported by the app file. It is built
with `defineOperations` of `platform/operations`; each entry is `query({ input, output, refusal? })` or
`mutation({ input, output, refusal? })`, where input and output are named zod exports of bounded `*.schema.ts` files of a module
owner (BE-TYPING-8) and `refusal` is a readonly list of literal codes (omitted when the operation never refuses). Inferred types
stay closed JSON: no `any`, `unknown`, `Record<string, unknown>`, `object`, unbound generic, function or `Date`, also after a
transform; root `undefined`/`void` cannot be a request or reply value.

The one route takes `@Body(new OperationValidationPolicy(OPERATIONS)) request: OperationRequest<Table>` and answers
`Promise<OperationReply<Table>>` of the same table. The wire is `{ operation, requestId, input }` in and
`{ operation, requestId, outcome }` out, `outcome` being the canon Outcome. The platform pipe validates the envelope (its id
bounds are the pipe's), the operation name and the input schema before dispatch and maps a malformed request to
`OPERATIONS_INVALID_REQUEST`, an `invalid` error. A generic annotation or a pipe for another table proves no validation; zod is
never imported in the transport. `starci app emit` derives `be/contracts/<app>/openapi.json` (OpenAPI 3.1, `x-operation`, a
oneOf over the operations) from the schema declarations alone, never by booting the app; it refuses open schemas (use
`z.strictObject`) and bounds that do not survive conversion (`maxLength`, `maxItems`, `maxProperties`), so a custom count
refinement is refused rather than emitted unbounded. Enable `be.contract.openapi` in `sides.be.optionalSlots`; a stale snapshot
fails the full check. Specs validate successful output against the output schema and cover refused input and declared outcomes.
A public REST operation belongs to this non-empty table, and its route decorator carries its own evidence.

Why: the operation set is the contract the front end and other consumers generate a client from; one typed table gives the
generator, the route and the handlers the same types, and runtime parsing carries the real bounds into the emitted contract.

- Shape:
  ```ts
  // modules/domain/order/order-operations.contracts.ts
  export const OPERATIONS = defineOperations({
      "orders.list@1": query({ input: OrdersListInputSchema, output: OrdersListOutputSchema, refusal: [OrderErrorCode.PageSizeInvalid] }),
  })
  // be/apps/<app>/src/operations.ts
  export { OPERATIONS } from "@modules/domain/order"
  ```

Enforced by: R95 BE_OPERATION_CONTRACT, R23 HFS_CONTRACT_SNAPSHOT_DRIFT, R278 BE_REST_DOOR_EVIDENCE, R304 BE_SCHEMA_PLACE, R305
BE_SCHEMA_BOUNDED.
