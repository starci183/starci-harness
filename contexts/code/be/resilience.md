---
slots: [be.platform, be.integrations]
---
# Retry and self-recovery

How a flow outlives a failure of any kind: a transient one is retried through the queue's attempts or the shared timer, never a
hand-written catch-and-wait loop; any other one parks the flow until a fix, raises one alert and resumes it on its own.

## BE-RESILIENCE-1 A retry is the job's attempts; a wait goes through the platform timer

Work that may fail transiently runs in a job and is retried by the queue policy of `platform/queue` (BE-QUEUES-2), so
it must be safe to repeat (fenced, claimed through
the inbox, or idempotent at the provider). Code that must wait inside a process schedules through the `Timer` port of
`platform/retry` (`@InjectTimer()`), never `setTimeout` or `node:timers/promises`. A loop that catches and waits does
not exist outside `platform/retry`.

Why: a hand-rolled loop has no visible bound, no jitter and no abort, and holds a request open while it sleeps.

Enforced by: `no-hand-rolled-retry` (R81), `infra-import-owner` (R90).

## BE-RESILIENCE-2 Every job and saga flow runs itself again after a failure of any kind

Every side effect and every async step goes through the transactional outbox, written in the transaction of the state change
(BE-PERSISTENCE-5, BE-QUEUES-1), and is consumed idempotently through the inbox (BE-IDEMPOTENCY-1); an inbound delivery is stored raw
first, and processing it is an idempotent replay of the stored row. `platform/jobs` decides what a failure means, in one place:

- `classifyFailure` of `platform/queue` names its class: `transient` (a dropped connection, a timeout, a lock conflict), `input`
  (a domain error: the data is wrong), `config` (a domain code naming a configuration or connection) or `code` (any other failure); an
  error that carries `failureClass` names its own.
- A `transient` failure with attempts left is retried by the queue with bounded, jittered exponential backoff (`queue.policy.ts`).
- Any other failure, and a transient one on its last attempt, parks the job as `failed_awaiting_fix` under the build that ran it
  (`JobClaims.park`), never as a silent final dead letter, and raises ONE alert through `FlowAlerts` with the job id and the request's
  correlation id. The alert is the owner's work item: the app binds `FlowAlerts` to its owner UI, which lists `JobClaims.awaitingFix()`
  and offers "resume now"; until it does, the alert is a log line.
- A parked job resumes on its own: at boot when the build changed (`ParkedJobResumer`), on the scheduled sweep (`parked-jobs:sweep`,
  every 15 minutes), and on demand (`ParkedJobResumer.resume({ jobId })`). It goes back to its queue under `<jobKey>-r<n>` and claims
  its own row again, so its recorded steps (`claims.advance`) and the outputs they stored are kept, and a pivot never repeats: a
  remote effect carries a key the resume keeps (the inbox claim, the provider's idempotency key), a saga transition its version fence.
- A compensation is a step like any other and follows the same rules.

No code catches a failure to wait and try again, and no code swallows one: a processor, a consumer and a saga step let it reach the
runner.

Why: a flow that stays failed needs a person to notice and restart it; classifying once, parking with one alert and resuming on the
next build or sweep brings every flow back as soon as its cause is fixed, and the outbox, the inbox and the fence make the rerun safe.

Enforced by: `no-hand-rolled-retry` (R81), R377 `BE_FLOW_FAILURE_SWALLOWED`, `job-fence-required` (R158).
