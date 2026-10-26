---
slots: []
---
# Typing

Which type expresses a front-end value. The strict tsconfig, the ban on type escapes, `Array<T>` and the type-aware
lint are [shared typing](../shared/typing.md) SHARED-TYPING-1..4.

## FE-TYPING-1 Props are readonly all the way down, and unused props are not declared

Every field of a component's props type is `readonly`, nested objects and collections included (`ReadonlyArray<T>`,
`Readonly<Record<K, V>>`); an object contract is an `interface`, a union or alias a `type`; a component that ignores
its input declares no parameter instead of `_props` or `void props`.

Why: props are inputs, so mutating one is a bug the compiler can stop, and an unread parameter is an API that lies.

Enforced by: R110 (`props-fields-readonly`), R235 (`no-unused-prop-types`); `interface` versus `type` is review only.

## FE-TYPING-2 State and modes are literal unions, never enums

A shape, mode or tone vocabulary of a feature or view is a string-literal union (with an exported inventory when the
owner draws each member), and only a truly binary flag is an `is`/`has` boolean; a generated or provider enum stays
inside `modules/api` or its module and is mapped where it enters a hook.

Why: a union names every drawn shape and survives a back-end rename at one mapper; a pair of booleans allows
combinations nobody drew.

Enforced by: review only.

## FE-TYPING-3 Wire, feature and view types are distinct

Operation types come from the generated `__generated__/graphql` (`XQuery`, `XMutation`, `WireInput<XMutationVariables["input"]>`);
a hook maps them to the feature's own types (named in its `<domain>.shared.ts` or `modules/types`), and presentation
consumes only feature and view types.

Why: protocol, feature and presentation change at different boundaries; a wire type in a component couples every screen
to the schema.

Enforced by: R52 (`no-hand-typed-wire`; hfs `wire-generated`); presentation importing a wire type is R285/R50 where it
imports `modules/api`, otherwise review only.
