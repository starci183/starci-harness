---
slots: [be.feature.jobs, be.queues, be.platform.queue]
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
  - path: src/modules/platform/queue/index.ts
    slot: be.platform.queue
    role: "Public surface of the capability (ports, config, module, entity arrays)."
    template: queues/platform/queue.index.ts.tpl
  - path: src/modules/platform/queue/queue.module.ts
    slot: be.platform.queue
    role: "Dynamic module registered once per app with the connections that enqueue and the schedulers."
    template: queues/platform/queue.module.ts.tpl
  - path: src/modules/platform/queue/queue.module-definition.ts
    slot: be.platform.queue
    template: queues/platform/queue.module-definition.ts.tpl
  - path: src/modules/platform/queue/queue.options.ts
    slot: be.platform.queue
    template: queues/platform/queue.options.ts.tpl
  - path: src/modules/platform/queue/queue.config.ts
    slot: be.platform.queue
    role: "Typed reader of the Redis and relay settings."
    template: queues/platform/queue.config.ts.tpl
  - path: src/modules/platform/queue/queue.decorators.ts
    slot: be.platform.queue
    role: "InjectQueueOutbox, InjectQueueWorkerRegistry and their tokens."
    template: queues/platform/queue.decorators.ts.tpl
  - path: src/modules/platform/queue/queue.contracts.ts
    slot: be.platform.queue
    role: "QueueSchedulerDefinition, QueueDelivery, QueueHandler."
    template: queues/platform/queue.contracts.ts.tpl
  - path: src/modules/platform/queue/queue.port.ts
    slot: be.platform.queue
    role: "QueueOutbox (write(tx, queue, payload)) and QueueWorkerRegistry ports."
    template: queues/platform/queue.port.ts.tpl
  - path: src/modules/platform/queue/queue-transport.port.ts
    slot: be.platform.queue
    role: "The BullMQ port."
    template: queues/platform/queue-transport.port.ts.tpl
  - path: src/modules/platform/queue/queue.policy.ts
    slot: be.platform.queue
    role: "Attempts, backoff and retention of BullMQ jobs."
    template: queues/platform/queue.policy.ts.tpl
  - path: src/modules/platform/queue/queue.policy.spec.ts
    slot: be.platform.queue
    template: queues/platform/queue.policy.spec.ts.tpl
  - path: src/modules/platform/queue/queue.log-events.ts
    slot: be.platform.queue
    template: queues/platform/queue.log-events.ts.tpl
  - path: src/modules/platform/queue/errors/queue.error.ts
    slot: be.platform.queue
    role: "Malformed stored queue envelope failures."
    template: queues/platform/errors/queue.error.ts.tpl
  - path: src/modules/platform/queue/messages/queue.messages.ts
    slot: be.domain.messages
    template: queues/platform/messages/queue.messages.ts.tpl
  - path: src/modules/platform/queue/bullmq-queue-transport.client.ts
    slot: be.platform.queue
    role: "The one bullmq importer."
    template: queues/platform/bullmq-queue-transport.client.ts.tpl
  - path: src/modules/platform/queue/bullmq-queue-transport.client.spec.ts
    slot: be.platform.queue
    template: queues/platform/bullmq-queue-transport.client.spec.ts.tpl
  - path: src/modules/platform/queue/queue-outbox.service.ts
    slot: be.platform.queue
    role: "Writes a job row through the caller's tx."
    template: queues/platform/queue-outbox.service.ts.tpl
  - path: src/modules/platform/queue/queue-outbox.service.spec.ts
    slot: be.platform.queue
    template: queues/platform/queue-outbox.service.spec.ts.tpl
  - path: src/modules/platform/queue/queue-relay.service.ts
    slot: be.platform.queue
    role: "Relay of committed rows into BullMQ with jobId = the row id, per registered connection."
    template: queues/platform/queue-relay.service.ts.tpl
  - path: src/modules/platform/queue/queue-relay.service.spec.ts
    slot: be.platform.queue
    template: queues/platform/queue-relay.service.spec.ts.tpl
  - path: src/modules/platform/queue/queue-worker.service.ts
    slot: be.platform.queue
    role: "The handler registry, the workers and the scheduler registration."
    template: queues/platform/queue-worker.service.ts.tpl
  - path: src/modules/platform/queue/queue-worker.service.spec.ts
    slot: be.platform.queue
    template: queues/platform/queue-worker.service.spec.ts.tpl
  - path: src/modules/platform/queue/persistence/connection.ts
    slot: be.persistence
    role: "The outbox entity array registered on every connection that enqueues."
    template: queues/platform/persistence.connection.ts.tpl
  - path: src/modules/platform/queue/persistence/entities/queue-outbox.entity.ts
    slot: be.persistence
    template: queues/platform/persistence.queue-outbox.entity.ts.tpl
  - path: src/modules/platform/queue/persistence/queue.sql.ts
    slot: be.persistence
    template: queues/platform/persistence.queue.sql.ts.tpl
  - path: src/modules/platform/queue/persistence/queue.rows.ts
    slot: be.persistence
    template: queues/platform/persistence.queue.rows.ts.tpl
  - path: src/modules/platform/queue/persistence/migrations/<epochMs13>-create-queue-outbox.ts
    slot: be.persistence
    template: queues/platform/persistence.migration.ts.tpl
  - path: src/modules/queues/<queue>/index.ts
    slot: be.queues
    template: queues/queue.index.ts.tpl
  - path: src/modules/queues/<queue>/<queue>.options.ts
    slot: be.queues
    template: queues/queue.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/modules/queues/<queue>/<queue>.module-definition.ts
    slot: be.queues
    template: queues/queue.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/modules/queues/<queue>/<queue>.module.ts
    slot: be.queues
    role: The Nest module that provides the typed producer.
    template: queues/queue.module.ts.tpl
  - path: src/modules/queues/<queue>/<queue>.queue.ts
    slot: be.queues
    template: queues/queue.queue.ts.tpl
    role: The typed producers and the schedulers of one queue.
    rules: [BE_QUEUE_PRODUCER_SHAPE, BE_OUTBOX_WRITE_TX]
  - path: src/modules/queues/<queue>/<queue>.contracts.ts
    slot: be.queues
    role: Payload types and the queue name.
    optional: true
  - path: src/tests/e2e/<area>/<queue>.e2e-spec.ts
    slot: be.tests.e2e
    role: "Titles queue/<scenario>: ... prove the pattern."
    spec: queue/enqueue-atomic-with-transaction, queue/relay-job-id-is-outbox-id, queue/scheduler-fires-once
    rules: [BE_PATTERN_SPEC_MISSING]
---
# Queues and schedulers

Decides how work that runs later, in the background or on a schedule is started: a typed producer writes the outbox in the
caller's transaction (BE-PERSISTENCE-5), `platform/queue` relays committed rows into the queue, and a job processor runs them
(jobs.md). The queue runs on Redis in both editions; a lite app that uses it declares Redis in `sides.be.backing`.

## BE-QUEUES-1 A queue is a typed producer that writes the outbox in the caller's transaction
Each queue is `be/src/modules/queues/<queue>/` with `<queue>.queue.ts` (a class of typed producers
`enqueueX(payload, tx: EntityManager, correlationId: string)`, each calling `QueueOutbox.write(tx, queue, payload, correlationId)`
with `tx` first), optional `<queue>.contracts.ts` (payload types and the queue name, the producer-processor contract) and `index.ts`.
Only a domain service calls a producer, inside its transaction. The payload carries ids, never entities. Work inside one context
that must happen now is a direct call, not a job.

Why: the job row commits with the change that caused it, so a rollback never starts work and a commit never loses it.

Enforced by: R154 BE_QUEUE_PRODUCER_SHAPE, R152 BE_OUTBOX_WRITE_TX.

## BE-QUEUES-2 platform/queue is the only queue owner, and the job id is the outbox id
Only `platform/queue` imports the queue library or constructs a queue, worker or flow producer. Its relay claims committed rows per
registered connection and adds each job with `jobId = <outbox id>`, so a relay that crashes after adding and before marking re-adds
harmlessly. The row's correlation id travels in the job envelope and `QueueDelivery` (BE-LOGGING-4). Envelopes carry the owned
`schema` marker; only that marker family is read as transport data, and an unmarked object is a whole business payload. Attempts,
backoff and retention are `queue.policy.ts`; a job that exhausts its attempts stays in the failed set as the dead letter. In lite the
relay marks a row sent only after the transport confirms Redis persisted the job to its append-only file and still holds it, so a
job lost inside the fsync window is added again; that Redis runs with append-only persistence on a named volume.

Why: the relay is at least once; a deterministic job id turns it into effectively once.

Enforced by: R90 BE_INFRA_OWNER.

## BE-QUEUES-3 A schedule is a job scheduler declared with its queue, or a database tick that writes the outbox
A recurring task is a job scheduler the queue module declares in its `schedulers` list and `platform/queue` registers at boot, or,
on a hosted Postgres, a uniquely named `pg_cron` job of a migration whose command (directly or through one `*_tick` function) only
inserts one row of a queue constant into the queue outbox (`ruleParams.db.queueOutbox`, or the enqueue function an app declares in
`sides.be.queueOutbox`). A job name is scheduled once while active; a migration replacing a tick unschedules the name first. Its job
runs through the same processor as any enqueued job. Framework cron decorators and `setInterval` for work are not used anywhere.
Each schedule matches a jobs declaration of the stack (BE-BACKGROUND-1).

Why: one scheduler in Redis or one job in the database fires once for the whole deployment, where cron in a replicated process fires
once per replica.

Enforced by: R258 DB_PGMQ_DECLARED, R90 BE_INFRA_OWNER, R268 HFS_SCHEDULE_UNDECLARED.

## BE-QUEUES-4 A declared queue is proven on the test world
An app declaring `queue` has tests titled `queue/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios` (atomic
enqueue, job id equal to the outbox id, a scheduler firing once), against a real Redis in full and in lite integration specs, where
the outbox, commit boundary, relay identity and database tick are proved on Postgres.

Why: atomicity and once-only firing are runtime facts.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.
