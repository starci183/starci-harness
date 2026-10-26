---
slots: []
---
# Typing

Decides which type expresses a back-end contract, value or boundary, and which validator reads untrusted data. Types never stand
in for runtime validation. Message params are BE-CQRS-2; input bounds of transport DTOs are BE-AUTH-5.

## BE-TYPING-1 One strict flag set
`be/tsconfig.json` is the render of `starci app sync`: it extends `@starci/tsconfig/be.json` (which owns the strict flags) and adds
only the three path aliases and the template excludes; an app lowers no flag. `interface` is for object shapes, `type` for unions,
intersections and aliases, and arrays are `Array<T>` or `ReadonlyArray<T>`.

Why: one flag set makes every app read the same, and compile-time shape is not runtime validation.

Enforced by: R22 HFS_TS_STRICT.

## BE-TYPING-2 Public params and results are named projections
Public handler, service and capability APIs have explicit params and result types; object parameters use a named `<Name>Params`.
No ORM entity, `*Entity` type or SDK response is a public contract, DTO or resolver/controller return type: return a projection.
Inferred locals need no ceremonial interface.

Why: a stable public API makes boundary changes visible and keeps persistence shape from leaking.

- `type StartCheckoutResult = Outcome<{ purchaseId: string }, PurchaseErrorCode.OfferNotFound | PurchaseErrorCode.AlreadyOwned>`

Enforced by: R37 BE_ENTITY_IN_CONTRACT.

## BE-TYPING-3 Mutability follows lifecycle
Injected dependencies and message params are `readonly`. DTO classes may be mutable where validation or transform tooling needs
it. A received message is never mutated to store progress, and no module-level `let` holds shared state.

Why: execution state and request data have different owners, and module state breaks across instances.

Enforced by: R87 BE_CQRS_SHAPE (readonly boundary), R45 BE_MODULE_SHAPE.

## BE-TYPING-4 Stable values are enumerated deliberately
Public enums and discriminated unions have explicit serialized values; no `const enum` across a package or runtime boundary. A
domain value stays with its domain owner; a stored enum is `varchar` with a `CHECK`, never a native database enum. GraphQL
registration (`registerEnumType`) happens in the transport that exposes it.

Why: serialization stability and ownership outlast naming, and a native enum change can crash a migration.

Enforced by: R89 BE_SOURCE_FORM, R264 HFS_FEATURE_LOGIC_ROLE.

## BE-TYPING-5 Unknown input is narrowed; no type escape anywhere
`unknown` is the type of untrusted payloads and caught errors, then narrowed. Nowhere, specs included: `as X` (only `as const`),
`<X>y`, `x!`, `any`, `Function`, `eval`, `as never`, `as unknown as`. A request body is a typed DTO, never `unknown`. Test doubles
use `mock<T>()` and typed fixtures, not casts.

Why: a cast cannot establish trust in external data, and a cast in a spec keeps a stale spec green.

Enforced by: R72 BE_TYPE_ESCAPE, R22 HFS_TS_STRICT, R41 BE_DEFAULT_DENY.

## BE-TYPING-7 DTOs are owned protocol representations
GraphQL and HTTP DTO classes live under the owning feature's `transport/<protocol>/dto/` and carry semantic validation and bounds
(BE-AUTH-5); a GraphQL `ID` or string shape alone is not validation. Plain application contracts stay under `application/`.
Output is mapped deliberately, with nullability and errors as the API contract states.

Why: protocol, application and persistence contracts evolve at different boundaries.

Enforced by: R37 BE_ENTITY_IN_CONTRACT, R42 BE_INPUT_BOUNDED.

## BE-TYPING-8 Data that never reaches a DTO is parsed by a bounded zod schema in its owner
Validation is zoned. A transport DTO is validated by `class-validator`, never zod. Untrusted data that does not arrive through a DTO
(a provider response, a model's structured output, a queue or outbox payload read back, a tool argument, the operation-table
request) is read through a zod schema in a `<name>.schema.ts` of the domain, platform or integrations owner that reads it; zod is
imported nowhere else, and a schema file imports no class-validator, class-transformer or GraphQL decorator. The reader calls
`safeParse`, returns the inferred type and maps a failure to its owner's error (`<Owner>ErrorCode.MalformedResponse`), never
returning partly trusted data. Every string, array, set, record and map is bounded, and `z.any()`, `z.unknown()` and `z.json()`
do not exist. A schema is covered through its reader's spec, reject branch included (or parsed directly, BE-TEST-2). No schema is
shared with the front end; the shared contract is the emitted snapshot.

Why: a hand-written `typeof` ladder narrows what its author remembered and drifts from the provider, while one schema is both
reader and type; one validator per door keeps the zones disjoint, and an unbounded collection whose elements all fail validation
allocates an issue each.

- When a payload is read back from the inbox or a queue → the service parses it through its owner's schema before any effect and
  fails the job with the owner's `MalformedPayload` code.

Enforced by: R304 BE_SCHEMA_PLACE, R305 BE_SCHEMA_BOUNDED.
