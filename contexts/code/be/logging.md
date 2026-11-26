---
slots: [be.platform.logging]
---
# Logging

How a back-end event is recorded: one `Logger` port, enum identities declared by their owner, structured fields. What
a `catch` must do is BE-ERROR-4.

## BE-LOGGING-1 `platform/logging` owns the one Logger port

`platform/logging` is required and exports `Logger` (`info(event, fields?)`, `warn(event, fields?)`,
`error(event, cause, fields?)`), `InjectLogger()`, `parseLoggingConfig(env, service)` and `createJsonLogger(clock, ids, options?)`
for bootstrap code outside the container. The adapter is Winston (`winston` and `winston-loki`, imported in `platform/logging`
only): one JSON line per event, stamped by the `Clock` and the correlation id, credential-named fields masked
(`log-redaction.policy.ts`), the cause's name, message, code and stack kept. Its transports:

- **Console, always on**: info to stdout, warn and error to stderr, so `docker logs` and the collector read every line.
- **Loki, when `LOKI_URL` is declared** (`loki-transport.adapter.ts`): the same line, pushed in batches every 5 s, each
  push abandoned after 5 s, a failed batch dropped rather than re-queued, at most 10 000 lines held (newer lines past that
  are dropped and counted), the process exit never hooked (the module flushes on shutdown). A failed push never reaches the
  caller: it is reported on stderr as `platform.logging.loki.unreachable` at most once a minute while the console lines go on.
  Its stream labels are `stack` and `app` (`LOKI_APP`), `env` (`LOKI_ENV`), `service` (`LOKI_SERVICE`, on a server the swarm
  service name the collector uses), `level` and `event`, a member of an owner's enum and so bounded; ids stay in the line.
  `LOKI_BASIC_AUTH` (`user:password`, sealed, or `LOKI_BASIC_AUTH_FILE`) and `LOKI_TENANT` serve a Loki behind a door.

On a server the stack render sets the `LOKI_*` keys of each `monitoring.logPush` service and stops collecting its stdout
([project/monitoring.md](../../project/monitoring.md) PROJECT-MONITORING-2), so each line reaches Loki once; a local or docker-compose run leaves `LOKI_URL`
unset and logs to the console only (the local monitor publishes no Loki port). The adapter logs one cause object once per process: the first owner
that logs a failure (a handler base) writes it and a later `error` with the same cause writes nothing (BE-ERROR-4).

No `console.*`, framework `Logger` or second logging library elsewhere; a cli prints its output through the port's console
client. An app takes the adapter with `starci app codemod logging-winston-loki`.

Why: a back end without a mandatory logger can pass every check and record nothing when it fails, and a second library
is a second format for the collector; a push that could block or crash the service would make logging the outage.

Enforced by: `no-framework-logger`, `no-console`, and the R40 tree check `log-push` (an environment that declares
`monitoring.logPush` with no `winston-loki` import in `platform/logging`) (R40); `infra-import-owner` (R90).

## BE-LOGGING-2 An event is an owner's enum member; fields are ids and codes

Each owner declares `<owner>.log-events.ts` (`export enum OrdersLogEvent { ShipFailed = "orders.ship_failed" }`, each
member documented); the first argument of a log call is such a member, never a sentence. A failure is logged with the
caught value as `cause` and plain fields: `this.logger.error(OrdersLogEvent.ShipFailed, cause, { workspaceId, orderId })`.
No value typed `Secret`, no token, request body or personal identifier is logged. A handler does not log what it
throws; its base logs it once (BE-CQRS-3).

Why: a stable identity is searchable and alertable, and a cause keeps the stack.

Enforced by: `no-interpolated-log-message`, `no-error-wording-as-log-identity`, `no-domain-error-logged`, the
`loggedAndThrown` case of `catch-must-account` (R40, BE-ERROR-4), `no-secret-in-log` (R71).

## BE-LOGGING-4 Correlation, when the app declares it

An app that declares the `logging` pattern carries a correlation id from ingress (`traceparent` or a bounded
`x-request-id`) through the outbox row, the queue envelope and the outbound `x-request-id`, held in the one
`AsyncLocalStorage` of `platform/logging` and restored by delivery for the handler's lifetime; business code receives
ids explicitly and never reads ambient state. An app without the pattern has no correlation id and
logs its own ids (`workspaceId`, `jobId`) as fields.

Why: a process-local scope ends before a committed row is delivered; an explicit envelope keeps the causal identity
across processes.

Enforced by: `infra-import-owner` (R90, `node:async_hooks`), R155 (`logging/correlation-survives-queue` when declared).
