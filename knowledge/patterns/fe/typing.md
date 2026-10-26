---
slots: []
---
# Typing

Which type expresses a front-end value. Wire, feature and view contracts are distinct, and wire types are generated.

## FE-TYPING-1 Types for shapes, the canon flags

Props and data shapes are `export type`; hook params may be `interface`. `tsconfig.json` extends the canon
`@starci/tsconfig` Next preset and lowers no flag.

Enforced by: R22 HFS_TS_STRICT.

## FE-TYPING-2 Readonly all the way down

Props fields, nested objects, collections and tuple keys are `readonly` (`ReadonlyArray<T>`, `Readonly<Record<...>>`).

Why: props are inputs; mutating one is a bug the type system can stop.

Enforced by: R110 FE_PROPS_MUTABLE.

## FE-TYPING-3 Literal unions for state

State and mode vocabularies are string-literal unions with an exported inventory; only a truly binary flag is an
`is`/`has` boolean.

Why: a union names every drawn shape; a pair of booleans allows combinations nobody drew.

## FE-TYPING-4 Arrays

`Array<T>` or `ReadonlyArray<T>`, never `T[]`; frozen literals use `as const`.

## FE-TYPING-5 Declare boundaries, infer the rest

Component and hook returns are inferred; a helper returning a primitive and an async utility declare their return;
narrowed literals use `as const`.

## FE-TYPING-6 No casts

No cast of a response, no double cast, no `any`, no non-null assertion; a component that ignores its props declares
no parameter instead of `void props` or `_props`.

Why: a cast asserts what the compiler cannot check, and a generated wire type makes it unnecessary.

Enforced by: R22.

## FE-TYPING-7 No enums in presentation

Feature and view vocabulary is a literal union or a discriminated object; a generated or provider enum stays inside
the transport adapter and is mapped at the owning hook or module.

Why: a wire enum in presentation couples every screen to a back-end rename.

## FE-TYPING-8 Wire, feature and view contracts are distinct

Schema-derived result and variable types and typed documents are generated into `modules/api` (`__generated__/`,
ignored). A feature owns framework-neutral input, result, failure and view models; a mapper translates wire to
feature; presentation consumes feature and view types; the grammar consumes only its own visual contracts.

Why: protocol, feature and presentation evolve at different boundaries.

Enforced by: R52 FE_WIRE_GENERATED.
