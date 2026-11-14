---
slots: [be.platform, be.integrations]
---
# Retry and self-recovery

How a flow outlives a failure of any kind: one judge classifies it, a transient one is tried again on the flow's declared ladder or
through the shared timer, never a hand-written catch-and-wait loop, and the end of the ladder is a dead letter with one item for a
person, resumable.

## BE-RESILIENCE-1 A retry is the job's attempts; a wait goes through the platform timer

Work that may fail transiently runs in a job and is retried on the job's declared ladder (BE-JOBS-7), so
it must be safe to repeat (fenced, settled through the effects piece, or idempotent at the provider). Code that must wait inside a process schedules through the `Timer` port of
`platform/retry` (`@InjectTimer()`), never `setTimeout` or `node:timers/promises`. A loop that catches and waits does
not exist outside `platform/retry`.

Why: a hand-rolled loop has no visible bound, no jitter and no abort, and holds a request open while it sleeps.

Enforced by: `no-hand-rolled-retry` (R81), `infra-import-owner` (R90).

## BE-RESILIENCE-2 Every job and saga flow runs itself again after a failure of any kind

Every side effect and every async step goes through the transactional outbox, written in the transaction of the state change
(BE-PERSISTENCE-5, BE-QUEUES-1), and is consumed idempotently through the inbox (BE-IDEMPOTENCY-1); an inbound delivery is stored raw
first, and processing it is an idempotent replay of the stored row. A long flow is a chain of jobs (BE-JOBS-9). `platform/jobs`
decides what a failure means, in one place:

- `classifyFailure(cause, DomainError)` of `@starci/nest-kit` names its class, the one rule the job runner, the lite pgmq consumer and
  the full event runner apply: `transient` (a dropped connection, a timeout, a lock conflict), `input` (an error of the app's
  `DomainError` family: the data is wrong), `config` (a domain code naming a configuration or connection) or `code` (any other
  failure); an error that carries `failureClass` names its own. An event consumer's delivery that fails transiently is redelivered;
  any other goes to its dead letter at once under its class, where a person's requeue resumes it (BE-EVENT-BUS-4, BE-EVENT-BUS-6).
- A `transient` failure with starts left is tried again on the job's ladder, declared once per class of flow: `background` (nobody
  waits) or `waited` (a person waits: 1, 2, 4 and 8 minutes), with the pause the ladder names (BE-JOBS-7). A delivery started past
  its ladder is a dead letter without running.
- Any other failure, and a transient one on its last start, is a dead letter: the job is parked as `failed_awaiting_fix` under the
  build that ran it (`JobClaims.park`), never as a silent final one, and ONE item for a person is raised per park episode through
  `FlowAlerts`, with the job id and the request's correlation id. The app binds `FlowAlerts` to its person's UI, which lists
  `JobClaims.awaitingFix()` and offers "resume now"; until it does, the item is a log line.
- A dead letter is handed back by a new build (every class), by the periodic sweep (only transient dead letters, a bounded number of
  times, without a new item) and by a person's resume, which opens a new episode (BE-JOBS-7). It goes back to its queue under
  `<jobKey>:r<n>` and claims its own row again, so its recorded steps (`claims.advance`) and the outputs they stored are kept, and a
  pivot never repeats: an outside effect is settled in the effect ledger under its key (BE-JOBS-3) and a resumed job finds it
  settled; a saga transition keeps its version fence.
- A flow moves forward only: no step undoes another by machine. A failure leaves a typed failed or stopped row a person sees. A flow
  that declares an undo (BE-SAGA-1) runs it as an ordinary forward step when a person presses it.
- A step that only informs is a side step (BE-SAGA-5): its failure is recorded and raised and the run goes on, never parked. A run a
  customer waits on tells the customer when it parks (BE-SAGA-6) and is on the `waited` ladder (BE-SAGA-7).
- The parked row is the durable failure, so the broker's failed copy is a cache: BullMQ's `removeOnFail` keeps it bounded as an object
  literal naming `age` or `count` (`removeOnFail: { age: <seconds> }`, which keeps Redis bounded under `noeviction`) or keeps it
  (`false`); `true` or a bare count deletes a failed job at once and is refused.

No code catches a failure to wait and try again, and no code swallows one: a processor, a consumer, a saga step and the domain method
a job calls let it reach the runner.

Why: a flow that stays failed needs a person to notice and restart it; classifying once, bounding every wait by a declared ladder,
parking with one item and handing back on the next build, a bounded sweep or a person's resume brings every flow back as soon as its
cause is fixed, and the outbox, the inbox, the fence and the effect ledger make the rerun safe.

Enforced by: `no-hand-rolled-retry` (R81), R377 `BE_FLOW_FAILURE_SWALLOWED`, `job-fence-required` (R158), `job-effect-piece` (R159).
Known gap: R377 reads the catch blocks of the flow files (processors, steps, saga steps and compensations, consumers) and of the
domain files that name a `ClaimedJob`; a domain method a job reaches without taking one, and a try counter or a wait written with a
timer outside a loop, are judged by review.
