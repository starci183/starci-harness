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
`publish` sends the envelope once to the pgmq topic of the event's name with `event_bus_send` on the transaction's connection,
so the send commits or rolls back with the change, and pgmq copies it into every consumer queue bound to that name (BE-EVENT-BUS-6).
The application role reaches pgmq only through the security-definer `event_bus_*` functions of the bus migration, listed in
`ruleParams.be.dbFunctions`. Jobs never ride on pgmq: they are BullMQ (BE-QUEUES-1).

Why: the outbox row (the pgmq message in lite) commits with the change, so a rolled-back change never emits and a committed one
is never lost; the broker gives ordered, replayable, cross-service delivery.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R90 BE_INFRA_OWNER, R258 DB_PGMQ_DECLARED, R334 BE_PERSISTENCE_NO_RAW_SQL.

## BE-EVENT-BUS-4 A consumer is a thin door; delivery is at least once with retry and dead letter
A consumer is `transport/message/<event>.consumer.ts` implementing `EventConsumer<E>` with `readonly event = <Event>Event`;
`handle(delivery)` dispatches one command forwarding `delivery.eventId` and `delivery.correlationId`. The service the command reaches
claims the event first (BE-IDEMPOTENCY-1). A throw schedules a retry with exponential backoff on `events.<service>.retry`; after the
event's attempts the message goes to `events.<service>.dlq`, which an operator reads and requeues through `eventBus.deadLetters(event)`
and `eventBus.requeue(id)` from a cli command; `eventBus.pendingRetries(event)` lets a failure-injection spec wait for a retry. The
retry budget fits the consumer's side effects. Lite's consumer loop, dedupe key and dead letter are BE-EVENT-BUS-6.

Why: delivery repeats and fails; a thin door keeps the decision in the domain and a dead letter keeps a poison message from blocking
the topic.

Enforced by: R153 BE_EVENT_CONSUMER_SHAPE, R80 BE_INBOX_DEDUPE_MISSING.

## BE-EVENT-BUS-5 A declared event bus is proven on the test world
An app declaring `event-bus` has tests titled `event-bus/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios`,
against a real broker (full) or in integration specs on the local stack (lite): the row exists exactly when the change commits,
nothing is relayed for a rollback, a failing consumer is retried then buried, and a redelivery changes nothing twice.

Why: delivery behaviour is invisible to a linter; a real broker run is the only proof.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.

## BE-EVENT-BUS-6 Lite fans out on pgmq topics, dedupes on a business key and parks poison per consumer
Lite (ruling `lite-pgmq-bus-bullmq-jobs`):

- Fan-out is pgmq's own topic routing. Each consumer of an event has one queue `<topic>__<consumer>` (the event name with dots
  and dashes as underscores, then the consumer; at most 41 characters so its dead-letter queue fits pgmq's 47), named by a literal
  `<TOPIC>_<CONSUMER>_TOPIC_QUEUE` constant of `platform/event-bus`. The reactor's migration creates the queue and its
  dead-letter queue `<topic>__<consumer>__dead` and binds the queue to the event's name with `pgmq.bind_topic`; publish sends
  once. A reactor subscribes with that constant and literal options (`subscribe(QUEUE, consumer, { maxDeliveries })`), so the
  subscriptions are static data.
- Every event payload carries `dedupeKey`, the business identity of the fact (an order id, a receipt id), stable across
  redelivery and replay. The service the consumer's command reaches claims `(delivery.consumer, delivery.dedupeKey)` in the inbox
  in the transaction of its effect (BE-IDEMPOTENCY-1), so a redelivery changes nothing twice.
- The read loop of `platform/event-bus` (`EventConsumerService`, started at application bootstrap and stopped at shutdown; no
  tick, so no scheduler, BE-JOBS-6) reads a bounded batch of each consumer queue with a visibility timeout. A handled message is
  archived; a throw leaves it to reappear when the timeout lapses; a message read more than the consumer's `maxDeliveries`
  (default 5), or with a malformed envelope or dedupe key, moves to `<queue>__dead` while the original is archived, and the move is
  logged with the event and the consumer. An operator reads and replays it through `eventBus.deadLetters(queue, limit)` and
  `eventBus.requeue(queue, id)`.
- Delivery is unordered: two events of one aggregate may arrive in either order and either may repeat, so a reactor reads the
  current state it acts on instead of trusting the order of events.

Why: pgmq gives each consumer its own cursor and dead letter without a relay; a business key survives the replays a message id does
not; a poison message parked per consumer blocks no other consumer.

Enforced by: R258 DB_PGMQ_DECLARED, R336 BE_EVENT_BUS_LITE_SHAPE, R80 BE_INBOX_DEDUPE_MISSING.
