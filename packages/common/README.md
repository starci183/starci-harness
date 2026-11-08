# @starci/common

The concepts every StarCi app and every `@starci` package share, in one package with no runtime dependency, no framework import and no environment read. A concept lives here only when it is app-agnostic and at least two packages, or every app through the harness templates, would otherwise define it themselves.

| export | holds | why it is here |
|---|---|---|
| `DomainError<C>` | the coded error base: `code`, `params`, `cause` (through the `Error` options), `message` = the code, `name` = the name of the class that is built | one base for the `<Capability>Error` of an app and the error of every package, so the back-end canon recognises a coded error by where it is declared and a package error can be thrown, rejected and mirrored by an app or a test double |
| `DomainErrorInit<C>`, `ErrorParams` | what a `DomainError` is built from, and the text parameters that travel next to the code | the constructor's input |
| `isDomainError` | narrows `unknown` to `DomainError<string>` | a generic class narrows to `DomainError<any>`; the guard gives a string code |
| `ErrorKind` | the closed set a transport maps to a status (`invalid`, `unauthenticated`, `forbidden`, `not-found`, `conflict`, `rate-limited`, `unavailable`, `internal`) | the `*_ERROR_KINDS` table of an app and of every package that declares kinds |

A capability error is an empty subclass:

```ts
export enum OrdersErrorCode {
    NotShippable = "ORDERS_NOT_SHIPPABLE",
}

export class OrdersError extends DomainError<OrdersErrorCode> {}

throw new OrdersError({ code: OrdersErrorCode.NotShippable, params: { id }, cause })
```

An app imports it through `@modules/platform/errors`, which re-exports it; a package imports it from `@starci/common` and keeps its own class name, its codes and its extra fields (`kind`, `context`, `detail`).

Not here: anything that names a framework (the Nest module helpers stay in `@starci/nest-kit`), React (the Grammar and `next-*` packages), a product, or a shape the packages disagree on.
