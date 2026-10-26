---
slots: [be.feature.application, be.domain, be.errors]
---
# Error

How a failure or refusal is declared, thrown or returned, and answered on HTTP and GraphQL. Logging a failure is
logging.md; its display text messages.md.

## BE-ERROR-1 One base in platform, one error family per capability

`platform/errors` owns `DomainError<C>`, the closed `ErrorKind` set (`invalid`, `unauthenticated`, `forbidden`,
`not-found`, `conflict`, `rate-limited`, `unavailable`, `internal`), its status table, the REST filter and the GraphQL
formatter. Each capability (domain, platform or integration) owns `errors/<capability>.error.ts` with exactly one code
enum `<Capability>ErrorCode`, one exhaustive `<CAPABILITY>_ERROR_KINDS: Record<Code, ErrorKind>` and one empty class
`<Capability>Error extends DomainError<<Capability>ErrorCode>`. The index exports the table, which the app composes into
`ErrorsModule.register({ kinds })`. No per-case class, no `exceptions/` folder, no status on an error.

Why: a code enum with a `Record` table makes the compiler prove every code has a kind, and the policy stays with the
capability that decides it.

```ts
/** Codes of the orders capability. */
export enum OrdersErrorCode {
    /** The order cannot be shipped, or somebody shipped it already. */
    NotShippable = "ORDERS_NOT_SHIPPABLE",
}

/** How each orders code travels. */
export const ORDERS_ERROR_KINDS: Record<OrdersErrorCode, ErrorKind> = {
    [OrdersErrorCode.NotShippable]: "conflict",
}

/** The one error class of the orders capability. */
export class OrdersError extends DomainError<OrdersErrorCode> {}
```

Enforced by: `error-home`, `error-family-shape`, `error-code-unique` (R38).

## BE-ERROR-2 A code is stable text; an error carries no prose

Code values are `<CAPABILITY>_<WHAT>` in UPPER_SNAKE (members PascalCase), unique across the repository, never suffixed
`_ERROR`. An error is built from `{ code, params?, cause? }`: `params` fill the display text, `cause` keeps the caught
value; its `message` is the code.

Why: a stable code is what transports map and clients match on; prose in an error is user copy in the wrong layer.

Enforced by: `error-code-unique`, `user-copy-through-catalog`, `no-secret-in-error` (R38, R78, R71).

## BE-ERROR-3 A refusal is the capability error; an `Outcome` only when a caller branches on it

A service refuses by throwing its capability error (`throw new OrdersError({ code: OrdersErrorCode.NotShippable })`).
It returns `Outcome<V, C>` of `platform/primitives` instead only when a caller in the modules must decide on the
refusal; the door then throws it with `unwrapOutcome(outcome, <C>Error)`. "Absent" is a `null` result typed by a named
alias (`type OptionalOrder = OrderRow | null`), not an error, when absence is a normal answer. Never `throw new Error`,
a framework HTTP exception, or a platform error thrown out of a domain.

Why: one throw per refusal keeps services short, the handler's base logs it once, and the filter maps it by kind; a
union is worth its weight only where code reads it.

Enforced by: `throw-domain-error` (R38); the Outcome-versus-throw choice is review only.

## BE-ERROR-4 Every catch accounts for the error and keeps the cause

A `catch` rethrows, calls the `Logger`, or returns a value that carries the cause; a replacement error passes the
caught value as `cause`. No empty or ignoring catch.

Why: a swallowed error turns a real failure into an unexplained state with no trace.

```ts
.catch((cause: unknown) => {
    throw new TelegramError({ code: TelegramErrorCode.Unavailable, cause })
})
```

Enforced by: `catch-must-account`, `replacement-throw-carries-cause` (R40, R108).

## BE-ERROR-5 One REST filter and one GraphQL formatter answer every failure

The api root binds `ErrorsFilter` as `APP_FILTER`; GraphQL failures go through the formatter of `platform/graphql`.
Both describe the error through `ErrorsService`: a `DomainError` answers `{ code, kind, message, params }` with the
kind's status (GraphQL: HTTP 200 with `extensions.code` and `kind`); anything else is masked to `ERRORS_INTERNAL` and
recorded with its site, the detail only in the log. The message is resolved from the catalog by code and request
locale (`errors.<CODE>` key, BE-MESSAGES-1). Clients match on the code, never the message.

Why: a client never receives an internal message, SQL error or stack, and one mapping per protocol means masking
cannot differ per operation.

Enforced by: `error-masked` (R39).
