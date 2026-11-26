---
slots: [be.feature.application, be.domain, be.errors]
---
# Error

How a failure or refusal is declared, thrown or returned, and answered on HTTP and GraphQL. Logging a failure is
logging.md; its display text messages.md.

## BE-ERROR-1 One shared base, one error family per capability

`@starci/common` owns `DomainError<C>` (`code`, `params`, `cause`) and the closed `ErrorKind` set (`invalid`, `unauthenticated`,
`forbidden`, `not-found`, `conflict`, `rate-limited`, `unavailable`, `internal`); `platform/errors` re-exports both (`domain.error.ts`,
`errors.contracts.ts`) and owns the status table, the REST filter and the GraphQL formatter. Each capability (domain, platform or integration) owns `errors/<capability>.error.ts` with exactly one code
enum `<Capability>ErrorCode`, one exhaustive `<CAPABILITY>_ERROR_KINDS: Record<Code, ErrorKind>` and one empty class
`<Capability>Error extends DomainError<<Capability>ErrorCode>`. The index exports the table, which the app composes into
`ErrorsModule.register({ kinds })`. No per-case class, no `exceptions/` folder, no status on an error. A root workspace package
([PROJECT-3](../../project/README.md#project-3-an-apps-shared-code-lives-in-root-workspace-packages)) cannot import `platform/errors`, so it
imports `DomainError` from `@starci/common` and every error it throws derives from it, as does the error of every `@starci` package
(`AuthError`, `MailError`, `TestWorldError`): the lint recognises a coded error by where the class is declared, never by its name. An app rendered
with its own `DomainError` moves onto the package with `starci app codemod common-base`.

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

Enforced by: `error-home`, `error-family-shape`, `error-code-unique`, `throw-domain-error` (R38).

## BE-ERROR-2 A code is stable text; an error carries no prose

Code values are `<CAPABILITY>_<WHAT>` in UPPER_SNAKE (members PascalCase), unique across the repository, never suffixed
`_ERROR`. An error is built from `{ code, params?, cause? }`: `params` fill the display text, `cause` keeps the caught
value; its `message` is the code.

Why: a stable code is what transports map and clients match on; prose in an error is user copy in the wrong layer.

Enforced by: `error-code-unique`, `user-copy-through-catalog`, `no-secret-in-error` (R38, R78, R71).

## BE-ERROR-3 A refusal is the capability error; an `Outcome` only when a caller branches on it

A service refuses by throwing its capability error (`throw new OrdersError({ code: OrdersErrorCode.NotShippable })`).
It returns `Outcome<V, C>` of `platform/primitives` (re-exported from `@starci/common`) instead only when a caller in the modules must decide on the
refusal; the door then throws it with `unwrapOutcome(outcome, <C>Error)`. "Absent" is a `null` result typed by a named
alias (`type OptionalOrder = OrderRow | null`), not an error, when absence is a normal answer. Never `throw new Error`,
a framework HTTP exception, or a platform error thrown out of a domain.

Why: one throw per refusal keeps services short, the filter maps it by kind without logging it (BE-ERROR-4), and a
union is worth its weight only where code reads it.

Enforced by: `throw-domain-error` (R38); the Outcome-versus-throw choice is review only.

## BE-ERROR-4 Business code throws; a failure is logged once, where it is answered

Business code (features, domain, integrations) just throws its capability's `DomainError` subclass with a code: no
`try`/`catch` to log, no log at the call site. The failure travels to the one place that answers it:

- the global handler of `platform/errors` (`ErrorsFilter`, `@Catch()`, with `ErrorsService.describe`, BE-ERROR-5) maps a
  `DomainError` to its code and status and logs nothing, since a declared refusal is an answer, not a failure; anything
  else is an unexpected or system failure, logged once there (`logger.error(ErrorsLogEvent.Unhandled, error)`, stamped with
  the request's correlation id) and answered as a generic 500;
- a CQRS or job handler logs once in its base (`platform/cqrs` `cqrs.handler.ts`, the job processor base of `platform/jobs`)
  and rethrows, logging only what is not a `DomainError`.

A `catch` exists only where the code handles the failure: it rethrows, returns a value that carries the cause, or
handles it and records it through the `Logger`; a replacement error passes the caught value as `cause`. No empty or
ignoring catch. A catch never both logs and throws outside those answering owners, and no `Logger.error` takes a cause
typed as a `DomainError`: either is the same failure logged twice, or a refusal counted as a failure.

Why: a swallowed error turns a real failure into an unexplained state with no trace, and a failure logged at every
layer it crosses, or a refusal logged as an error, buries the one line an alert should fire on.

```ts
.catch((cause: unknown) => {
    throw new TelegramError({ code: TelegramErrorCode.Unavailable, cause })
})
```

Enforced by: `catch-must-account` (its `loggedAndThrown` case refuses log-and-throw outside `platform/errors`,
`platform/logging`, `platform/cqrs` and `platform/jobs`), `replacement-throw-carries-cause`, `no-domain-error-logged`
(R40, R108); the global filter's presence is `error-masked` (R39). Known gap: a catch that only logs a failure it could
have let travel to the filter passes `catch-must-account`, since the lint cannot tell a best-effort side effect that
must not fail its caller (a usage stamp, a notification) from a failure that should have reached the filter; that
choice is held by review.

## BE-ERROR-5 One REST filter and one GraphQL formatter answer every failure

The api root binds `ErrorsFilter` as `APP_FILTER`; GraphQL failures go through the formatter of `platform/graphql`.
Both describe the error through `ErrorsService`: a `DomainError` answers `{ code, kind, message, params }` with the
kind's status (GraphQL: HTTP 200 with `extensions.code` and `kind`); anything else is masked to `ERRORS_INTERNAL` and
recorded with its site, the detail only in the log. The message is resolved from the catalog by code and request
locale (`errors.<CODE>` key, BE-MESSAGES-1). Clients match on the code, never the message.

Why: a client never receives an internal message, SQL error or stack, and one mapping per protocol means masking
cannot differ per operation.

Enforced by: `error-masked` (R39).
