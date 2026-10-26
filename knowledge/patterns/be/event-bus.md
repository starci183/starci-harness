---
slots: [be.transport.message, be.feature.reactors, be.events, be.platform.event-bus]
files:
  - path: src/modules/platform/outbox/index.ts
    slot: be.platform
    role: "The public surface of the shared outbox relay."
    template: outbox/platform/index.ts.tpl
  - path: src/modules/platform/outbox/outbox.log-events.ts
    slot: be.platform
    role: "The log event of a failed relay pass."
    template: outbox/platform/outbox.log-events.ts.tpl
  - path: src/modules/platform/outbox/outbox-relay.policy.ts
    slot: be.platform
    role: "The one relay loop the event bus and the queues share: read, deliver and mark in one transaction."
    template: outbox/platform/outbox-relay.policy.ts.tpl
  - path: src/modules/platform/outbox/outbox-relay.policy.spec.ts
    slot: be.platform
    template: outbox/platform/outbox-relay.policy.spec.ts.tpl
  - path: src/modules/platform/event-bus/errors/event-bus.error.ts
    slot: be.platform.event-bus
    template: event-bus/platform/errors/event-bus.error.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.config.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.config.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.contracts.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.contracts.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.decorators.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.decorators.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.log-events.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.log-events.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.module-definition.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.module-definition.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.module.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.module.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.options.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.options.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.port.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.port.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.service.spec.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-bus.service.spec.ts.tpl
  - path: src/modules/platform/event-bus/event-bus.service.ts
    slot: be.platform.event-bus
    role: "publish (outbox write through tx), dead letters, requeue, pending retries."
    template: event-bus/platform/event-bus.service.ts.tpl
  - path: src/modules/platform/event-bus/event-envelope.policy.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-envelope.policy.ts.tpl
  - path: src/modules/platform/event-bus/event-envelope.policy.spec.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-envelope.policy.spec.ts.tpl
  - path: src/modules/platform/event-bus/event-relay.service.spec.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-relay.service.spec.ts.tpl
  - path: src/modules/platform/event-bus/event-relay.service.ts
    slot: be.platform.event-bus
    role: "Relay of committed outbox rows to Kafka, per registered connection."
    template: event-bus/platform/event-relay.service.ts.tpl
  - path: src/modules/platform/event-bus/event-runner.service.spec.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-runner.service.spec.ts.tpl
  - path: src/modules/platform/event-bus/event-runner.service.ts
    slot: be.platform.event-bus
    role: "Consumer registry and Kafka read loop with retry and dead letter."
    template: event-bus/platform/event-runner.service.ts.tpl
  - path: src/modules/platform/event-bus/event-transport.port.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event-transport.port.ts.tpl
  - path: src/modules/platform/event-bus/event.policy.ts
    slot: be.platform.event-bus
    role: "Topics, attempts and backoff."
    template: event-bus/platform/event.policy.ts.tpl
  - path: src/modules/platform/event-bus/event.policy.spec.ts
    slot: be.platform.event-bus
    template: event-bus/platform/event.policy.spec.ts.tpl
  - path: src/modules/platform/event-bus/index.ts
    slot: be.platform.event-bus
    template: event-bus/platform/index.ts.tpl
  - path: src/modules/platform/event-bus/kafka-event-transport.client.ts
    slot: be.platform.event-bus
    role: "The one kafkajs importer."
    template: event-bus/platform/kafka-event-transport.client.ts.tpl
  - path: src/modules/platform/event-bus/kafka-event-transport.client.spec.ts
    slot: be.platform.event-bus
    template: event-bus/platform/kafka-event-transport.client.spec.ts.tpl
  - path: src/modules/platform/event-bus/messages/event-bus.messages.ts
    slot: be.domain.messages
    template: event-bus/platform/messages/event-bus.messages.ts.tpl
  - path: src/modules/platform/event-bus/persistence/connection.ts
    slot: be.persistence
    template: event-bus/platform/persistence/connection.ts.tpl
  - path: src/modules/platform/event-bus/persistence/entities/event-outbox.entity.ts
    slot: be.persistence
    template: event-bus/platform/persistence/entities/event-outbox.entity.ts.tpl
  - path: src/modules/platform/event-bus/persistence/event-bus.rows.ts
    slot: be.persistence
    template: event-bus/platform/persistence/event-bus.rows.ts.tpl
  - path: src/modules/platform/event-bus/persistence/event-bus.sql.ts
    slot: be.persistence
    template: event-bus/platform/persistence/event-bus.sql.ts.tpl
  - path: src/modules/platform/event-bus/persistence/migrations/<epochMs13>-create-event-outbox.ts
    slot: be.persistence
    template: event-bus/platform/persistence/migrations/1789800009000-create-event-outbox.ts.tpl
  - path: src/modules/events/<service>/index.ts
    slot: be.events
  - path: src/modules/events/<service>/<event>.event.ts
    slot: be.events
    role: One typed event class.
    rules: [BE_EVENT_CLASS_CONTRACT]
  - path: contracts/<service>/events.json
    slot: be.contract.events
    role: The emitted catalog of the service events (name, version, payload shape); the event classes equal it, so a consumer in another service reads one contract.
    rules: [BE_EVENT_CLASS_CONTRACT]
  - path: src/features/<kind>/<feature>/transport/message/<event>.consumer.ts
    slot: be.transport.message
    role: The consumer door of one event.
    rules: [BE_EVENT_CONSUMER_SHAPE]
  - path: src/features/<kind>/<feature>/transport/message/<feature>-message.module.ts
    slot: be.transport.message
    role: Registers the consumers with the registry.
  - path: src/tests/e2e/<area>/<event>.e2e-spec.ts
    slot: be.tests.e2e
    role: "The consumed event's e2e flow; titles event-bus/<scenario>: ... prove the pattern."
    spec: event-bus/atomic-with-transaction, event-bus/relay-only-after-commit, event-bus/redelivery-then-dead-letter, event-bus/duplicate-delivery-is-a-noop
    rules: [BE_PATTERN_SPEC_MISSING]
---
# Event bus

Decides how a fact travels when another context or a background process must react: a typed event class, published by a domain
service into the transactional outbox, relayed to the broker, consumed by a thin door with retry and dead letter. When an event may
exist at all is BE-DOMAIN-2; the outbox rule is BE-PERSISTENCE-5; dedupe is idempotency.md; contract evolution is
BE-PERSISTENCE-15.

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
rejected. In lite the broker is one queue per consumer group of a topic (`<service>__<event>__<group>`, created by a
migration, named by a literal constant of `platform/event-bus`, granted only to the application role), or by in-process delivery
after commit for a back end with a single api app; publish, outbox, inbox and consumers are unchanged.

Why: the outbox row commits with the change, so a rolled-back change never emits and a committed one is never lost; the broker
gives ordered, replayable, cross-service delivery.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R90 BE_INFRA_OWNER, R258 DB_PGMQ_DECLARED.

## BE-EVENT-BUS-4 A consumer is a thin door; delivery is at least once with retry and dead letter
A consumer is `transport/message/<event>.consumer.ts` implementing `EventConsumer<E>` with `readonly event = <Event>Event`;
`handle(delivery)` dispatches one command forwarding `delivery.eventId` and `delivery.correlationId`. The service the command reaches
claims the event first (BE-IDEMPOTENCY-1). A throw schedules a retry with exponential backoff on `events.<service>.retry`; after the
event's attempts the message goes to `events.<service>.dlq`, which an operator reads and requeues through `eventBus.deadLetters(event)`
and `eventBus.requeue(id)` from a cli command; `eventBus.pendingRetries(event)` lets a failure-injection spec wait for a retry. The
retry budget fits the consumer's side effects.

Why: delivery repeats and fails; a thin door keeps the decision in the domain and a dead letter keeps a poison message from blocking
the topic.

Enforced by: R153 BE_EVENT_CONSUMER_SHAPE, R80 BE_INBOX_DEDUPE_MISSING.

## BE-EVENT-BUS-5 A declared event bus is proven on the test world
An app declaring `event-bus` has tests titled `event-bus/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios`,
against a real broker (full) or in integration specs on the local stack (lite): the row exists exactly when the change commits,
nothing is relayed for a rollback, a failing consumer is retried then buried, and a redelivery changes nothing twice.

Why: delivery behaviour is invisible to a linter; a real broker run is the only proof.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.
