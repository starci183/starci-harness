---
slots: [be.feature.jobs, be.queues, be.platform.queue, be.domain.messages]
---
# Queues and schedules

How work that runs later or on a schedule is started: a typed producer writes the queue outbox in the caller's
transaction, `platform/queue` relays committed rows to BullMQ on Redis, and a job runs them (jobs.md). An app using it
declares `queue` in `sides.be.patterns` and Redis in `sides.be.backing`.

## BE-QUEUES-1 A queue is a typed producer that writes the outbox in the caller's transaction

`modules/queues/<queue>/` holds `<queue>.contracts.ts` (the `<QUEUE>_QUEUE` name, a `<Queue>Job` enum of job names,
one documented `<Job>Payload` interface per job carrying ids only and its `is<Job>Payload` guard), `<queue>.jobs.ts` (the
`defineJob` declaration of each job, whose once key is the dedupe key: BE-JOBS-9), `<queue>.queue.ts`, `<queue>.decorators.ts` (`Inject<Queue>Queue`), module files and `index.ts`. The producer
class has one `enqueue<Job>(payload, tx: EntityManager)` per job, each a single `QueueOutbox.write(tx, queue, payload,
{ job, dedupeKey })`. Only a domain service calls a producer, inside its transaction, with that transaction's manager; a job enqueues its next job
the same way, in the transaction that finishes it (BE-JOBS-9), and no other code writes the outbox.

Why: the job row commits with the change that caused it, and the dedupe key makes the same request one job.

```ts
/** Enqueues the run of a queued generation in the caller's transaction: the job exists exactly when its row does. */
enqueueGenerate(payload: GeneratePayload, tx: EntityManager): Promise<void> {
    return this.outbox.write(tx, GENERATE_JOB.queue, payload, {
        job: GENERATE_JOB.name,
        dedupeKey: GENERATE_JOB.onceKey(payload),
    })
}
```

Enforced by: `queue-producer-shape`, `outbox-write-tx` (R154, R152).

## BE-QUEUES-2 `platform/queue` alone speaks to the broker; the job id is the outbox id

Only `platform/queue` imports BullMQ or Redis for the queue. Its relay reads committed outbox rows and adds each job
with the outbox id as job id, marking the row sent only after Redis confirmed the job durably, so a relay that crashes
in between re-adds harmlessly. The pause between a job's tries is its declared ladder (BE-JOBS-7); `queue.policy.ts` holds the broker's attempt ceiling above every
ladder, retention and per-workspace limits. A job that fails in a way a retry cannot fix, or runs out of its ladder, is a dead
letter, parked as `failed_awaiting_fix` and handed back by a new build, the bounded sweep or a person (BE-JOBS-7), never kept as a
bare broker dead letter. `QueueRedelivery` hands a resumed job back under its new delivery id. Redis runs with append-only persistence on a named
volume.

Why: the relay is at least once; a deterministic job id makes it effectively once.

Enforced by: `infra-import-owner` (R90).

## BE-QUEUES-3 A schedule fires once per deployment

A recurring task is, in lite, a tick of `platform/jobs` (BE-JOBS-6), which enqueues one job through the queue outbox
once per minute for the deployment (the app's scheduler list stays empty); in full, a BullMQ job scheduler the app
passes as `QueueModule.register({ schedulers })`. A schedule owned by a data row, such as one agent's next run, is a
BullMQ job scheduler keyed by that row, in lite as in full, written with the row and removed with it. The job runs
through the same processor as any enqueued job. No cron decorator outside the tick scheduler, no `setInterval` and no
host crontab.

Why: one minute claim in the database or one Redis scheduler fires once for the whole deployment, where cron in a
replicated process fires once per replica. A tick walks every row each minute, and a keyed scheduler wakes only what
is due.

Enforced by: R335, R268, R250 (hfs), `infra-import-owner` (R90).

## BE-QUEUES-4 The queue is proven on real infrastructure

An app declaring `queue` proves `enqueue-atomic-with-transaction`, `relay-job-id-is-outbox-id` and
`scheduler-fires-once` in specs titled `queue/<scenario>: ...`: in lite integration specs on the local db service and
Redis, in full e2e.

Why: atomicity and once-only firing are runtime facts.

Enforced by: R155, R284.
