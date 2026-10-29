---
slots: [be.transport.message, be.feature.reactors, be.events, be.platform.event-bus, be.domain.messages]
---
# Event bus

Decides how a fact travels when another context or a background process must react: a typed event class, published by a domain
service into the transactional outbox, relayed to the broker, consumed by a thin door with retry and dead letter. When an event may
exist at all is BE-DOMAIN-2; the outbox rule is BE-PERSISTENCE-5; dedupe is idempotency.md; contract evolution is
BE-PERSISTENCE-15.

Edition: both; how lite carries the bus is [project/lite.md](../../project/lite.md) "Patterns".

## BE-EVENT-BUS-2 An event is a typed class equal to its vendored contract
Events are classes in `be/src/modules/events/<service>/<event>.event.ts`, one per file named after the event (`order.placed` is
`order-placed.event.ts`), extending the platform `BaseEvent` with literal `static readonly eventName` and `static readonly version`,
a payload typed in the class, `create()` to build it and `parse()` to read a delivered payload back. Each class equals an entry of
`be/contracts/<service>/events.json` at the same name and version, emitted by `starci app emit`, and every entry has its class.

Why: the class is what publisher and consumer compile against and the contract is what another service pins; two sources of truth
drift unless a check holds them equal.

Enforced by: R151 BE_EVENT_CLASS_CONTRACT, R166 HFS_EVENT_CONTRACT.

## BE-EVENT-BUS-3 Publish through the bus, in the domain transaction, to the broker only
`eventBus.publish(event, manager, correlationId)` is called only in `modules/domain`, with the manager of the transaction that makes
the change; it writes an outbox row on that transaction's connection. The relay of `platform/event-bus` hands committed rows to the
broker (topic `events.<service>`, key the aggregate id) and marks them sent; only `platform/event-bus` imports the broker client and
nothing publishes to the broker directly. No in-process transport exists; unit specs use the recording fake of the `EventBus` port.
The correlation id (BE-LOGGING-4) is validated before SQL, stored in the outbox `correlation_id` column and authoritative in the
outbound metadata. A delivery whose metadata is absent may derive its root id from a bounded, safe event id only when the envelope
has the basic shape, and is promoted to explicit metadata before execution, retry or dead letter; present malformed metadata is
rejected. In lite the broker is pgmq in the db service and there is no outbox or relay (ruling `lite-pgmq-bus-bullmq-jobs`):
`publish` sends the envelope to the pgmq topic of the event's name with `event_bus_send` on the transaction's connection, so the
send commits or rolls back with the change. Each consumer group has its own queue (`<service>__<event>__<group>`, at most 47
characters), created and bound to the event's name by a migration and named by a literal `*_TOPIC_QUEUE` constant of
`platform/event-bus`; the application role reaches pgmq only through the security-definer `event_bus_*` functions of that
migration, listed in `ruleParams.be.dbFunctions`. Jobs never ride on pgmq: they are BullMQ (BE-QUEUES-1).

Why: the outbox row (the pgmq message in lite) commits with the change, so a rolled-back change never emits and a committed one
is never lost; the broker gives ordered, replayable, cross-service delivery.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R90 BE_INFRA_OWNER, R258 DB_PGMQ_DECLARED, R334 BE_PERSISTENCE_NO_RAW_SQL.

## BE-EVENT-BUS-4 A consumer is a thin door; delivery is at least once with retry and dead letter
A consumer is `transport/message/<event>.consumer.ts` implementing `EventConsumer<E>` with `readonly event = <Event>Event`;
`handle(delivery)` dispatches one command forwarding `delivery.eventId` and `delivery.correlationId`. The service the command reaches
claims the event first (BE-IDEMPOTENCY-1). A throw schedules a retry with exponential backoff on `events.<service>.retry`; after the
event's attempts the message goes to `events.<service>.dlq`, which an operator reads and requeues through `eventBus.deadLetters(event)`
and `eventBus.requeue(id)` from a cli command; `eventBus.pendingRetries(event)` lets a failure-injection spec wait for a retry. The
retry budget fits the consumer's side effects. In lite a reactor subscribes its consumer to its group's queue through the
`EventConsumerRegistry`, and the read loop of `platform/event-bus`, started at application bootstrap and stopped at shutdown,
reads a bounded batch with a visibility timeout: a handled message is archived, a throw leaves it to reappear when the timeout
lapses, and a message past its attempts or with a malformed envelope goes to the `event_bus_dead_letter` queue, which
`deadLetters(limit)` and `requeue(id)` read and replay. The loop is no tick, so it needs no scheduler (BE-JOBS-6).

Why: delivery repeats and fails; a thin door keeps the decision in the domain and a dead letter keeps a poison message from blocking
the topic.

Enforced by: R153 BE_EVENT_CONSUMER_SHAPE, R80 BE_INBOX_DEDUPE_MISSING.

## BE-EVENT-BUS-5 A declared event bus is proven on the test world
An app declaring `event-bus` has tests titled `event-bus/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios`,
against a real broker (full) or in integration specs on the local stack (lite): the row exists exactly when the change commits,
nothing is relayed for a rollback, a failing consumer is retried then buried, and a redelivery changes nothing twice.

Why: delivery behaviour is invisible to a linter; a real broker run is the only proof.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.
