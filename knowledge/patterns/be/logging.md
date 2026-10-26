---
slots: [be.platform.logging]
---
# Logging

Decides how a back-end event is recorded: one mandatory `Logger` port, enum identities declared by their owner, structured
fields, and a correlation id that survives asynchronous delivery. What a `catch` must do is BE-ERROR-4.

## BE-LOGGING-1 platform/logging exists and exposes one port
`platform/logging` is required. It exports the `Logger` port (`info`, `warn`, `error(event, fields)`, `error(event, cause, fields)`)
and `InjectLogger()`. The default adapter writes one JSON line per event to stdout or stderr, stamped by the `Clock`; shipping
lines to a collector is not the application's job. Bootstrap builds `createJsonLogger(clock, ids)` and hands
`createNestLogger(logger)` to the framework so its lifecycle messages use the same adapter. No `console.*`, framework `Logger` or
second logging library exists outside it.

Why: without a mandatory logging capability a back end can pass every check and record nothing when it fails, and a second
library is a second format for the collector.

Enforced by: R40 BE_LOGGER_REQUIRED, R90 BE_INFRA_OWNER.

## BE-LOGGING-2 Identity is an owner's enum member; fields are structured
Each owner declares `<owner>.log-events.ts` (`export enum PurchaseLogEvent { CheckoutFailed = "purchase.checkout.failed" }`); the
first argument of a log call is such a member, never an interpolated message, and platform declares no central enum of domain
names. A failure is logged with the error as the cause: `this.logger.error(PurchaseLogEvent.CheckoutFailed, error, { offerId })`.
Fields are ids and codes; a value typed `Secret` or `Pii`, or a field named after a credential or personal identifier, is never
logged (log an id or a masked form). A handler does not log a failure it throws: `ICQRSHandler.execute` already logs
`OperationFailed`.

Why: a stable identity is searchable and alertable, a cause keeps the stack, and typed brands catch a secret a name list would
miss.

Enforced by: R40 BE_LOGGER_REQUIRED, R71 BE_LOG_SECRET.

## BE-LOGGING-4 Correlation survives requests and asynchronous delivery
`platform/logging` reads a valid `traceparent` trace id or a bounded `x-request-id` on ingress, or mints an id through the `Ids`
port. It owns the one `AsyncLocalStorage` and stamps every line with `correlationId`, which caller fields cannot replace (a business
key goes under its own field, such as `sagaCorrelationId`). `node:async_hooks` belongs only to it, and context-storage libraries are
owned by nobody. Business code receives ids explicitly and never reads ambient state. The id travels in the explicit request data,
the outbox row column, event metadata, queue job data and the outbound `x-request-id`; delivery restores the logger scope from that
envelope for the handler's lifetime, and retries keep the same id. The scope is an execution boundary, never an ambient getter.
API bootstrap calls `applyCorrelation(app)` before serving.

Why: a process-local request scope ends before a committed outbox row is delivered; explicit envelopes keep the causal identity
across processes without making decisions depend on ambient state.

- When a request queues work that later calls a provider → pass `request.correlationId` into the command, persist it with the
  outbox row, restore the scope from `delivery.correlationId`, and pass it explicitly to `HttpClient`.

Enforced by: R40 BE_LOGGER_REQUIRED, R90 BE_INFRA_OWNER, R142 BE_AMBIENT_ID, R155 BE_PATTERN_SPEC_MISSING.
