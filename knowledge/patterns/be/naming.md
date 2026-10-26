---
slots: []
---
# Naming

Decides what a back-end file, class, enum, constant, method, type and GraphQL field is called, so a reader and the slot check can
tell where a unit belongs from its name. Error identity is error.md (BE-ERROR-2).

## BE-NAMING-1 Files are kebab-case with a role suffix from the closed list
A file basename is kebab-case with a role suffix from `ruleParams.be.suffixes`; an unlisted suffix or a segment of
`ruleParams.be.bannedSuffixes` is a finding. The manifest also owns the names outside the role vocabulary (owner `index.ts`, the
`be.app.*` root files, migrations).

Why: the slot check derives what a file is from where it sits and what it is called; an unlisted suffix is an undeclared file.

- When it is a cli command → `.cli.ts`, because `.command.ts` is the CQRS message.
- When it is a typed realtime topic builder → `<name>.policy.ts` of the domain (BE-REALTIME-3).

Enforced by: R89 BE_SOURCE_FORM, R01 HFS_SLOT_UNDECLARED.

## BE-NAMING-2 Classes are PascalCase subject plus role
A class name is the PascalCase file name plus its role: `StartCheckoutCommand`, `StartCheckoutHandler`, `StartCheckoutResolver`,
`PaymentCapturedConsumer`, `SendReceiptProcessor`, `PurchaseModule` (capability), `CheckoutModule` (feature application module),
`CheckoutGraphqlModule` (per transport), `PurchaseService`, `PurchaseEntity`, `PurchaseError`. No `I` prefix except `ICQRSHandler`.
Arrays are `Array<T>`; `interface` is for shapes and `type` for unions.

Why: one role vocabulary keeps search and DI error messages readable.

Enforced by: R89 BE_SOURCE_FORM.

## BE-NAMING-4 Enums
Enums are PascalCase with PascalCase members and string values. Log identities are members of `<Owner>LogEvent` in
`<owner>.log-events.ts` (BE-LOGGING-2). Storage and GraphQL exposure of an enum are BE-TYPING-4; member docs BE-COMMENT-4.

Why: string values are stable on the wire, and an enum member is a searchable identity.

Enforced by: R89 BE_SOURCE_FORM, R40 BE_LOGGER_REQUIRED.

## BE-NAMING-5 Constants and connection names
Module-level constants are UPPER_SNAKE, SQL constants included; exported function values are camelCase arrows; decorator
factories are PascalCase; an injector is `Inject<Thing>` over a `unique symbol` (BE-INJECTION-2). A connection name is
`export const <CONN>_CONNECTION = "<conn>"` in `platform/database/<conn>.connection.ts`, equal to a name in
`sides.be.connections`; a capability's `persistence/connection.ts` declares no connection constant.

Why: constants are visible at a glance, and a connection name has exactly one definition.

Enforced by: R84 BE_CONNECTION_DUPLICATE, R85 BE_RAW_INJECT.

## BE-NAMING-6 Methods
A handler implements `process`. A service uses meaningful verbs (`open`, `assertWithinCreditLimit`, `reserveStock`). A resolver or
controller method is named after the operation. A name never carries a version to hide an incompatible change (`placeOrderV2`,
`run2`) and is never a bare verb export (`get`).

Why: the public name tells a caller what the unit promises, and versioned names accumulate incompatible forks.

Enforced by: R89 BE_SOURCE_FORM.

## BE-NAMING-7 Type names carry their layer
`<Action>Request` and `<Action>Result` for application contracts (only a handler's result is `<Action>Result`), `<Name>Options` for
configuration, `<Name>Params` for object parameters, `<Name>Row` for SQL rows (snake_case keys, mapped by `to<Name>(row)` in
`<name>.rows.ts`), `<Action>Input`, `<Action>Type`, `<Action>Args` for GraphQL DTOs and `<Action>Request`, `<Action>Response`
for HTTP DTOs. No contract name ends in `Entity`.

Why: the suffix says which layer owns the type and keeps ORM entities out of contracts.

Enforced by: R37 BE_ENTITY_IN_CONTRACT, R89 BE_SOURCE_FORM.

## BE-NAMING-8 GraphQL surface
Field names are camelCase and equal the resolver method name (`@Mutation(() => StartCheckoutType, { name: "startCheckout" })`).
Each operation is one typed field (BE-AUTH-4). The argument holding the input object is named `input`.

Why: a typed field per operation lets the contract, the guard and the input bounds be checked per operation.

Enforced by: R88 BE_TRANSPORT_SHAPE, R42 BE_INPUT_BOUNDED.
