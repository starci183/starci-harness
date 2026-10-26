---
slots: [be.platform.logging]
---
# Logging

How a back-end event is recorded: one `Logger` port, enum identities declared by their owner, structured fields. What
a `catch` must do is BE-ERROR-4.

## BE-LOGGING-1 `platform/logging` owns the one Logger port

`platform/logging` is required and exports `Logger` (`info(event, fields?)`, `warn(event, fields?)`,
`error(event, cause, fields?)`), `InjectLogger()` and `createJsonLogger(clock)` for bootstrap code outside the
container. The adapter writes one JSON line per event to stdout or stderr, stamped by the `Clock`, with secrets
redacted. No `console.*`, framework `Logger` or second logging library elsewhere; a cli prints its output through the
port's console client.

Why: a back end without a mandatory logger can pass every check and record nothing when it fails, and a second library
is a second format for the collector.

Enforced by: `no-framework-logger` (R40), `infra-import-owner` (R90).

## BE-LOGGING-2 An event is an owner's enum member; fields are ids and codes

Each owner declares `<owner>.log-events.ts` (`export enum OrdersLogEvent { ShipFailed = "orders.ship_failed" }`, each
member documented); the first argument of a log call is such a member, never a sentence. A failure is logged with the
caught value as `cause` and plain fields: `this.logger.error(OrdersLogEvent.ShipFailed, cause, { workspaceId, orderId })`.
No value typed `Secret`, no token, request body or personal identifier is logged. A handler does not log what it
throws: `ICQRSHandler.execute` logs `OperationFailed` once.

Why: a stable identity is searchable and alertable, and a cause keeps the stack.

Enforced by: `no-interpolated-log-message`, `no-error-wording-as-log-identity` (R40), `no-secret-in-log` (R71).

## BE-LOGGING-4 Correlation, when the app declares it

An app that declares the `logging` pattern carries a correlation id from ingress (`traceparent` or a bounded
`x-request-id`) through the outbox row, the queue envelope and the outbound `x-request-id`, held in the one
`AsyncLocalStorage` of `platform/logging` and restored by delivery for the handler's lifetime; business code receives
ids explicitly and never reads ambient state. An app without the pattern (the lite reference) has no correlation id and
logs its own ids (`workspaceId`, `jobId`) as fields.

Why: a process-local scope ends before a committed row is delivered; an explicit envelope keeps the causal identity
across processes.

Enforced by: `infra-import-owner` (R90, `node:async_hooks`), R155 (`logging/correlation-survives-queue` when declared).
