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

- `classifyFailure(cause, DomainError)` of `@starci/nest-kit` names its class, the one rule the job runner, the lite pgmq consumer and
  the full event runner apply: `transient` (a dropped connection, a timeout, a lock conflict), `input` (an error of the app's
  `DomainError` family: the data is wrong), `config` (a domain code naming a configuration or connection) or `code` (any other
  failure); an error that carries `failureClass` names its own. An event consumer's delivery that fails transiently is redelivered;
  any other goes to its dead letter at once under its class, where the operator's requeue resumes it (BE-EVENT-BUS-4, BE-EVENT-BUS-6).
- A `transient` failure with attempts left is retried by the queue with bounded, jittered exponential backoff (`queue.policy.ts`).
- Any other failure, and a transient one on its last attempt, parks the job as `failed_awaiting_fix` under the build that ran it
  (`JobClaims.park`), never as a silent final dead letter, and raises ONE alert through `FlowAlerts` with the job id and the request's
  correlation id. The alert is the owner's work item: the app binds `FlowAlerts` to its owner UI, which lists `JobClaims.awaitingFix()`
  and offers "resume now"; until it does, the alert is a log line.
- A parked job resumes on its own: at boot when the build changed (`ParkedJobResumerService`), on the scheduled sweep (`parked-jobs:sweep`,
  every 15 minutes), and on demand (`ParkedJobResumerService.resume({ jobId })`; from a process with no Redis, `cli queues resume [--job <id>]`
  writes the request on the sweep queue through the outbox, `ParkedJobResumeRequestsService`). It goes back to its queue under `<jobKey>-r<n>` and claims
  its own row again, so its recorded steps (`claims.advance`) and the outputs they stored are kept, and a pivot never repeats: a
  remote effect is claimed in the inbox under its effect key (`JobClaims.effectKey(job, step)`, `<jobId>:<step>`, the same after
  a resume; `inbox.claim(JOB_EFFECT_SOURCE, key, tx)` in the transaction of the effect) and a resumed job finds it claimed, a saga
  transition keeps its version fence.
- A compensation is a step like any other and follows the same rules.
- A step that only informs is a side step (BE-SAGA-5): its failure is recorded and alerted and the run goes on, never parked. A run a customer waits on tells the customer when it parks (BE-SAGA-6) and resumes on a short ladder of its own (BE-SAGA-7).
- The parked row is the durable failure, so the broker's failed copy is a cache: BullMQ's `removeOnFail` keeps it bounded as an object
  literal naming `age` or `count` (`removeOnFail: { age: <seconds> }`, which keeps Redis bounded under `noeviction`) or keeps it
  (`false`); `true` or a bare count deletes a failed job at once and is refused.

No code catches a failure to wait and try again, and no code swallows one: a processor, a consumer and a saga step let it reach the
runner.

Why: a flow that stays failed needs a person to notice and restart it; classifying once, parking with one alert and resuming on the
next build or sweep brings every flow back as soon as its cause is fixed, and the outbox, the inbox and the fence make the rerun safe.

Enforced by: `no-hand-rolled-retry` (R81), R377 `BE_FLOW_FAILURE_SWALLOWED`, `job-fence-required` (R158).
