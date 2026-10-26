---
slots: []
---
# Typing

Which type expresses a back-end contract, value or boundary, and which validator reads untrusted data. The strict
flags, `Array<T>`, no type escape and the type-aware rules are shared: [SHARED-TYPING-1 … 4](../shared/typing.md).

## BE-TYPING-1 Interfaces for shapes, types for unions and aliases

An object shape is an `interface` with `readonly` documented members; a union, intersection or alias is a `type`. A
named alias carries a meaning a bare union would hide (`type OrderViewLookup = OrderView | null`). An inline object type
in a signature takes a name.

Why: a named type is greppable and documented once; an inline shape is copied and drifts.

Enforced by: `no-inline-object-type`, `no-inline-param-type`, `public-contract-form` (R89).

## BE-TYPING-2 Each layer has its own contract

A door speaks DTO classes (`transport/<protocol>/dto/`, BE-AUTH-4), the application `<Action>Request` interfaces, a
service its `<capability>.contracts.ts` types and views, persistence `<Name>Row` interfaces. A row never crosses a door:
a mapper turns it into a view (`toOrderView(row)`). No entity, row or SDK response is a message result, DTO or
resolver return type.

Why: protocol, application and storage evolve at different boundaries; a leaked row turns a column rename into an API
change.

Enforced by: `no-entity-in-contract` (R37); rows at doors are review only.

## BE-TYPING-3 Mutability follows lifecycle

Injected dependencies and message params are `readonly`, contract and row members `readonly`, arrays in contracts
`ReadonlyArray<T>`. A DTO class may be mutable where class-validator needs it. No module-level `let`.

Why: request data and execution state have different owners, and module state breaks across replicas.

Enforced by: `readonly-boundary`, `no-module-let` (R87, R45).

## BE-TYPING-4 Stable values are string enums or literal unions

A public enum has explicit string values and documented members; no `const enum`. A stored enum is `text` or
`varchar` with a `CHECK`, never a native database enum. GraphQL registers an enum in the transport that exposes it.

Why: serialized values must stay stable, and a native enum change can break a migration.

Enforced by: `no-const-enum`, `require-enum-member-jsdoc` (R89).

## BE-TYPING-5 A DTO is validated; an unknown payload is narrowed by its owner

A request body or argument is a DTO class, never `unknown` or a record (BE-AUTH-4). Data that never reaches a DTO (a
provider answer, a queue payload read back, model output, `JSON.parse` of outside text) is `unknown` until the owner
narrows it (SHARED-TYPING-2): a type guard `is<Name>(value): value is <Name>` in the owner's contracts, or a bounded zod
schema (BE-TYPING-8). Specs build doubles with `mock<T>()` and builders, never casts.

Why: a type cannot establish trust in external data, and a cast in a spec keeps a stale spec green.

Enforced by: `no-untyped-body` (R41), `json-parse-needs-guard` (R76), `no-return-only-generic` (R48).

## BE-TYPING-8 A zod schema lives in its owner's `*.schema.ts` and is bounded

Zod is imported only by a `<name>.schema.ts` of a domain, platform or integration owner, never by a feature, door or
`dto/`, and the file holds only zod values and their inferred types. Every string, array, record and map is bounded;
`z.any()`, `z.unknown()` and `z.json()` do not exist. The reader calls `safeParse` and maps a failure to its owner's
error. Use a schema when the shape is deep (model output, tool arguments, wire envelopes); a flat payload may use a
type guard.

Why: one schema is reader and type at once, and an unbounded collection is a denial-of-service lever.

Enforced by: `schema-place`, `schema-file-values-only`, `schema-bounded` (R304, R305).
