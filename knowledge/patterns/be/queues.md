---
slots: [be.feature.jobs, be.queues, be.platform.queue, be.domain.messages]
---
# Queues and schedules

How work that runs later or on a schedule is started: a typed producer writes the queue outbox in the caller's
transaction, `platform/queue` relays committed rows to BullMQ on Redis, and a job runs them (jobs.md). An app using it
declares `queue` in `sides.be.patterns` and Redis in `sides.be.backing`.

## BE-QUEUES-1 A queue is a typed producer that writes the outbox in the caller's transaction

`modules/queues/<queue>/` holds `<queue>.contracts.ts` (the `<QUEUE>_QUEUE` name, a `<Queue>Job` enum of job names,
one documented `<Job>Payload` interface per job carrying ids only, its `is<Job>Payload` guard and the dedupe key
function), `<queue>.queue.ts`, `<queue>.decorators.ts` (`Inject<Queue>Queue`), module files and `index.ts`. The producer
class has one `enqueue<Job>(payload, tx: EntityManager)` per job, each a single `QueueOutbox.write(tx, queue, payload,
{ job, dedupeKey })`. Only a domain service calls a producer, inside its transaction, with that transaction's manager.

Why: the job row commits with the change that caused it, and the dedupe key makes the same request one job.

```ts
/** Enqueues the run of a queued generation in the caller's transaction: the job exists exactly when its row does. */
enqueueGenerate(payload: GeneratePayload, tx: EntityManager): Promise<void> {
    return this.outbox.write(tx, AGENTS_QUEUE, payload, {
        job: AgentsJob.Generate,
        dedupeKey: agentsDedupeKey(AgentsJob.Generate, payload.generationId),
    })
}
```

Enforced by: `queue-producer-shape`, `outbox-write-tx` (R154, R152).

## BE-QUEUES-2 `platform/queue` alone speaks to the broker; the job id is the outbox id

Only `platform/queue` imports BullMQ or Redis for the queue. Its relay reads committed outbox rows and adds each job
with the outbox id as job id, marking the row sent only after Redis confirmed the job durably, so a relay that crashes
in between re-adds harmlessly. Attempts, backoff, retention and per-workspace limits are `queue.policy.ts`; a job out
of attempts stays failed as the dead letter. Redis runs with append-only persistence on a named volume.

Why: the relay is at least once; a deterministic job id makes it effectively once.

Enforced by: `infra-import-owner` (R90).

## BE-QUEUES-3 A schedule fires once per deployment

A recurring task is, on Supabase, a uniquely named `pg_cron` job in a migration whose command only inserts one row
into the queue outbox through the enqueue function `hfs.json` `sides.be.queueOutbox` declares (the app's scheduler list
stays empty); otherwise a BullMQ job scheduler the app passes as `QueueModule.register({ schedulers })`. The job runs
through the same processor as any enqueued job. No cron decorator, `setInterval` or host crontab.

Why: one database job or one Redis scheduler fires once for the whole deployment, where cron in a replicated process
fires once per replica.

Enforced by: R258, R268, R250 (hfs), `infra-import-owner` (R90).

## BE-QUEUES-4 The queue is proven on real infrastructure

An app declaring `queue` proves `enqueue-atomic-with-transaction`, `relay-job-id-is-outbox-id` and
`scheduler-fires-once` in specs titled `queue/<scenario>: ...`: in lite integration specs on the local Supabase and
Redis, in full e2e.

Why: atomicity and once-only firing are runtime facts.

Enforced by: R155, R284.
