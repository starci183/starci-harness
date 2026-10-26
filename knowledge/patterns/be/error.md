---
slots: [be.feature.application, be.domain, be.errors]
---
# Error

Decides how a back-end failure or refusal is declared, returned or thrown, and mapped onto HTTP and GraphQL: refusals are
`Outcome` unions, failures one `DomainError` family per capability, undeclared errors masked. Logging a failure is logging.md
(BE-LOGGING-2); display text lookup is messages.md.

## BE-ERROR-1 One base owned by platform, one family per capability
`platform/errors` owns `DomainError`, the closed `ErrorKind` set and its one kind-to-HTTP-status table, the REST `ExceptionFilter`
and the GraphQL `formatError`, and nothing else. Each capability owns `errors/<capability>.error.ts` declaring exactly one code
enum `<Capability>ErrorCode`, one exhaustive table `<CAPABILITY>_ERROR_KINDS: Record<code, ErrorKind>` and one class
`<Capability>Error extends DomainError<<Capability>ErrorCode>`. No per-case error class, no `exceptions/` folder; a
`DomainError` carries no HTTP status.

Why: a class per case is boilerplate without exhaustiveness, and a status guessed from a name is a heuristic; a code enum with a
`Record` table makes the compiler prove every code has a kind, and error policy stays with the capability that decides it.

Enforced by: R38 BE_ERROR_HOME.

## BE-ERROR-2 Codes are capability-prefixed, unique and carry no prose
Code values are `<CAPABILITY>_<WHAT>` in UPPER_SNAKE (members PascalCase), with no `_EXCEPTION` or `_ERROR` suffix, unique across the
repository. The constructor takes `({ code, params?, cause? })`: `params` interpolate the display text and `cause` keeps the raw
caught value; an error never carries prose. A code that crosses a process or storage boundary is stable text, never a class name.

Why: a stable code is what transports map and clients match on; prose in the error puts user copy in the wrong layer.

- `throw new PurchaseError({ code: PurchaseErrorCode.OfferNotFound, params: { offerId } })`

Enforced by: R38 BE_ERROR_HOME.

## BE-ERROR-3 Expected refusals are returned, exceptional failures are thrown
An expected business refusal is returned as `Outcome<V, C> = { kind: "ok"; value: V } | { kind: "refused"; code: C; params? }` of
`platform/primitives`, `C` a subset of the capability's codes. The transport turns it into a throw with
`unwrapOutcome(outcome, <C>Error)`, the only place a refusal becomes an exception. An escaping failure is a `DomainError`. Never
`throw new Error`, the framework HTTP exception family, a throw of a non-`DomainError`, or a domain throwing a platform error
outward.

Why: a union makes the compiler force the caller to handle a refusal; an exception hides it from the type system.

- When the caller cannot recover (a missing aggregate) → throw; when the requirements name the refusal → return it.

Enforced by: R38 BE_ERROR_HOME.

## BE-ERROR-4 Every catch accounts for its error and keeps the cause
Every `catch` does exactly one of: rethrow, call a method of a value typed `Logger`, or return an `Outcome` that carries the cause.
An empty `catch {}` or one that ignores the caught value is forbidden. When a boundary replaces a caught failure, the exact caught
value (non-Error values included) becomes the new error's `cause`; a spec proves it is kept.

Why: a swallowed error turns a real failure into an unexplained state with no trace for the on-call reader.

- `catch (error) { throw new CryptoError({ code: CryptoErrorCode.DecryptionFailed, cause: error }) }`

Enforced by: R40 BE_LOGGER_REQUIRED, R108 BE_ERROR_CAUSE_DROPPED.

## BE-ERROR-5 One REST filter and one GraphQL formatter per app
Each api app registers the `ExceptionFilter` through `APP_FILTER` and passes `formatError` to the GraphQL module, both from
`platform/errors`. The filter maps a `DomainError` kind to its status through the one table and answers the code with the display
text resolved by code (BE-ERROR-6). GraphQL failures use HTTP 200 per GraphQL-over-HTTP and carry `errors[].extensions.{code,kind}`.
Anything that is not a `DomainError` is masked to `INTERNAL` with a generic message, the detail only in the log. Clients match on
`extensions.code`, never the message. A transport test covers both, including an unknown error.

Why: a client never receives an internal message, a SQL error or a stack, and one mapping per protocol means masking cannot differ
per operation.

Enforced by: R39 BE_ERROR_MASKED.

## BE-ERROR-6 Display text of an error comes from the catalog by code
A client never reads `message`. The filter and `formatError` resolve the text from the `errors.<code>` key of the owning
capability's catalog through `MessageCatalog` and the request locale (BE-MESSAGES-2), interpolating `params`.

Why: locale is a fact about the receiver; resolving it once per response translates every error the same way.

Enforced by: R78 BE_USER_COPY_LITERAL.
