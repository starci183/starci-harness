---
slots: []
---
# Naming

What a back-end file, class, constant, method and type is called, so the reader and the slot check know where a unit
belongs from its name. Identifier case, named exports and arrow constants are shared:
[SHARED-NAMING-1 … 3](../shared/naming.md). Error codes are BE-ERROR-2.

## BE-NAMING-1 Files are kebab-case with a role suffix from the closed list

A basename is `<kebab-name>.<role>.ts` with a role of `ruleParams.be.suffixes` (`service`, `policy`, `mapper`,
`contracts`, `port`, `client`, `decorators`, `config`, `options`, `module`, `module-definition`, `sql`, `rows`,
`error`, `messages`, `log-events`, `schema`, `command`, `query`, `handler`, `resolver`, `controller`, `input`, `type`,
`request`, `response`, `queue`, `processor`, `step`, `webhook`, `cli`, ...); `ruleParams.be.bannedSuffixes`
(`repository`, `use-case`, `util`, `helper`, `types`, `constants`, `dto`, ...) do not exist. A cli command is `.cli.ts`
because `.command.ts` is the CQRS message; a pure decision is a `.policy.ts`, a pure shape change a `.mapper.ts`.

Why: the slot check derives what a file is from where it sits and what it is called; an unlisted suffix is an
undeclared file.

Enforced by: `source-suffix` (R89), `slot-undeclared` (R01).

## BE-NAMING-2 Classes are the subject plus the role

A class is the PascalCase file subject plus its role: `GetOrderQuery`, `GetOrderHandler`, `GetOrderResolver`,
`OrdersService`, `OrdersReadService`, `OrdersModule` (capability), `OrdersApiModule` (feature application module),
`OrdersGraphqlModule` (transport), `OrdersError`, `TelegramClient`, `SendReceiptProcessor`, `SendReceiptStep`,
`MigrateCli`. No `I` prefix except `ICQRSHandler`.

Why: one role vocabulary keeps search and dependency-injection errors readable.

Enforced by: `source-names` (R89).

## BE-NAMING-5 Tokens, injectors and connection names have one form

An injection token is `export const <THING>: unique symbol = Symbol("<tier>.<owner>.<thing>")`; its injector is
`Inject<Thing>` (BE-INJECTION-2). A log event enum is `<Owner>LogEvent` with values `<owner>.<event>`. A connection name
is `<CONN>_CONNECTION` in `platform/database/<conn>.connection.ts`, equal to a name in `sides.be.connections`; a queue
name is `<QUEUE>_QUEUE` in its `<queue>.contracts.ts`.

Why: one spelling per kind of identity makes every token, event and queue findable by one search.

Enforced by: `injector-shape`, `no-string-token` (R85), `one-connection-per-database` (R84).

## BE-NAMING-6 Methods say what they promise

A handler implements `process`. A service method is a business verb (`require`, `draft`, `confirm`, `ship`,
`listPage`), a door method is named after its operation, a producer `enqueue<Job>`, a read that may miss answers `null`
and says so in its docblock. No version in a name (`placeOrderV2`), no bare verb export (`get`).

Why: the public name tells a caller what the unit promises, and versioned names accumulate forks.

Enforced by: `no-version-in-name`, `no-bare-verb-export` (R89).

## BE-NAMING-7 Type names carry their layer

`<Action>Request` for an application request; `<Name>View` (and a named `<Name>Lookup` or `Optional<Name>` for the
nullable form) for what a service answers; `<Name>Options` for configuration; `<Name>Params` for an object parameter;
`<Name>Row` for a SQL row (snake_case members); `<Name>Input`, `<Name>Type`, `<Name>Args` for GraphQL DTOs and
`<Name>Request`, `<Name>Response` for HTTP DTOs; `<Name>Payload` for a job payload. No contract name ends in `Entity`.

Why: the suffix says which layer owns the type and keeps storage shapes out of contracts.

Enforced by: `no-entity-in-contract` (R37); the suffixes are review only.

## BE-NAMING-8 GraphQL fields are camelCase operation names

A field is named in its decorator and equals the resolver method (`@Query(() => OrderType, { name: "order" })`); each
operation is one field, and the argument holding the input object is `input`.

Why: a typed field per operation lets the contract, the guard and the bounds be checked per operation.

Enforced by: `transport-is-thin`, `input-bounded` (R88, R42); the name equality is review only.
