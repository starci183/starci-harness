---
slots: [be.feature, be.feature.application, be.app.api]
---
# Api features

The api trigger kind: a flat feature of plain CQRS behind thin transports. Door shapes are transport.md, who may call
api-auth.md, the app files BE-ARCHITECTURE-2.

## BE-API-1 An api feature has one fixed shape

`be/src/features/api/<feature>/` holds `index.ts` (exporting only its transport modules), `<feature>.module.ts` with its
definition and options (the handlers), `application/` and `transport/graphql/` or `transport/http/`, each with its
`<feature>-<protocol>.module.ts`, doors, `<action>.mapper.ts` and `dto/`. A feature imports only `modules/*`.

Why: several protocols share one operation without the application importing a transport, and an app composes only
the transports it serves.

- When one operation is reachable over GraphQL and HTTP → one message and handler; each door dispatches it.

Enforced by: `feature-layout`, `feature-imports-feature`, `feature-not-composed` (R29, R28, R31).

## BE-CQRS-1 `application/` holds messages, handlers and contracts only

Per operation: `<action>.command.ts` (a write) or `<action>.query.ts` (a read), `<action>.handler.ts` and
`<action>.contracts.ts` (the plain `<Action>Request` interface). No `*.use-case.ts`, no forwarding service, no
protocol folder; one operation has one handler.

Why: one shape per operation gives one interception point, so the scenario never hides in a wrapper.

Enforced by: `no-use-case`, `feature-layout` (R87, R29).

## BE-CQRS-2 A message is a typed Command or Query carrying one `params`

A message extends `Command<R>` or `Query<R>` of `@nestjs/cqrs` and holds only `readonly params: ExecuteParams<Request>`
(authenticated: `{ request, principal }`) or `PublicExecuteParams<Request>` (`{ request }`) of `platform/cqrs`. `R` is
a domain view or contract type, never a row, entity or DTO.

Why: the bus types `execute` by the message's result, and a principal that cannot be absent removes a class of
authorization bugs.

```ts
/** Asks for one order of a workspace the caller belongs to. */
export class GetOrderQuery extends Query<OrderViewLookup> {
    constructor(readonly params: ExecuteParams<GetOrderRequest>) {
        super()
    }
}
```

Enforced by: `message-carries-params-only`, `message-typed-result`, `execute-params-shape`, `readonly-boundary`,
`no-entity-in-contract` (R87, R37).

## BE-CQRS-3 A handler is one delegating call; the domain service owns the scenario

A handler is `@QueryHandler(X)` or `@CommandHandler(X)` on a class extending `ICQRSHandler<X, R>` of `platform/cqrs`,
injecting the Logger (for the base) and domain services only. `process` returns one call of one service with the
mapped params: no branch, loop, manager or second call. `execute` stays the base's (it logs `OperationFailed` and
rethrows). The service proves membership or ownership, opens the transaction, stamps the clock and decides.

Why: one template gives every operation the same failure log, and a decision kept out of the feature tier is one a
measured service spec reaches.

```ts
@QueryHandler(GetOrderQuery)
/** Proves membership before reading the selected order. */
export class GetOrderHandler extends ICQRSHandler<GetOrderQuery, OrderViewLookup> {
    constructor(@InjectLogger() logger: Logger, private readonly orders: OrdersReadService) {
        super(logger)
    }

    protected override process(query: GetOrderQuery): Promise<OrderViewLookup> {
        return this.orders.find(query.params.principal.id, query.params.request.workspaceId, query.params.request.id)
    }
}
```

Enforced by: `handler-overrides-process`, `handler-is-thin`, `explicit-handler-return-type`, `feature-thin` (R87, R75,
R203).

## BE-CQRS-4 The bus is the only way into a handler; nothing is in-process events

A handler is reached only through `CommandBus.execute` or `QueryBus.execute` from a door. No `EventBus`,
`@EventsHandler`, `EventEmitter`, RxJS `Subject` used as a bus, or class storing callbacks others register. A follow-up
that runs later is a job enqueued in the domain transaction (BE-QUEUES-1).

Why: a forwarder is indirection where logic creeps in, and an in-process event does not survive a crash after commit.

Enforced by: `no-event-bus`, `transport-is-thin` (R87, R88).

## BE-API-3 An operation is proved by its service spec and the edition's boot proof

Every refusal and branch an operation can take is asserted in the domain service spec (BE-TEST-5). In full each
resolver and controller also has an e2e flow on the booted app (happy path, each declared refusal by code, the
unauthenticated call); lite has no e2e world, so its composition is proved by the wiring check (BE-TEST-12).

Why: a door is thin and has no logic to unit-test; what breaks is the decision (service spec) and the wiring (boot
proof).

Enforced by: review only for the e2e coverage per operation; R272 for the boot proof.

## BE-OPERATIONS-1 A versioned public operation table, when an app serves one

An app that serves versioned operations on one route declares them once with `defineOperations` of
`platform/operations` (`query`/`mutation` entries of bounded `*.schema.ts` input and output and literal refusal codes),
validates the request with `OperationValidationPolicy` of the same table and answers `OperationReply<Table>`;
`starci app emit` derives the OpenAPI snapshot from it. Without such a route the app declares no table.

Why: one typed table gives the generator, the route and the handlers the same types.

Enforced by: `operation-contract-decidable`, `operation-table-schemas`, `operation-route-driven-by-table` (R95), R23.
