---
slots: [be.feature.jobs, be.feature.jobs.steps, be.feature.jobs.queue, be.platform.jobs, be.domain.messages]
---
# Fenced background jobs

How every long flow runs: a chain of jobs, each started by a queue outbox row, claimed under a fencing token that every claim
bumps, judged by one runner and one retry ladder per class of flow, ended by a dead letter a person resumes, with every
outside effect made through one effects piece. Starting a job is queues.md; which process runs it background.md; what a flow
that must be undone declares saga.md. A lite app declares `fenced-job` and Redis.

A back end whose jobs run on Postgres alone, with no queue broker, takes the outbox, the claim, the fence, the ladders, the dead
letters and the timers from `@starci/outbox` and writes none of them: its `platform/jobs` is the one importer, registers
`OutboxModule` over the app's connection, copies the package's `migrations/outbox.sql` into its migrations and re-exports the `Outbox` to
the producers and handlers; the rules below hold through the package's API (`enqueue(tx, ...)` for BE-QUEUES-1, the fence of
`ClaimedJob` for BE-JOBS-2, `effectKey` for BE-JOBS-3, its `ladders` for BE-JOBS-7). A defect or a missing rule of it is fixed in the
package ([authority/packages.md](../../authority/packages.md)), never shimmed in the app.

## BE-JOBS-1 `platform/jobs` alone writes the job row, claiming it atomically

`platform/jobs` owns the job table (a migration of the app; in lite under `db/migrations/`), its `jobs.sql.ts`
and `JobClaims`. `claim` is one atomic upsert keyed by the delivery (the outbox id, without the `:r<n>` a resume adds) that bumps and
returns `fencingToken`; a finished job or a live claim answers `null`. The runner claims each delivery, calls the processor and
settles with a guarded `complete`, a `fail` the queue retries, or a `park` (BE-RESILIENCE-2). Nothing else writes the row.

Why: a read-modify-write claim races, and a second writer defeats the fence.

Enforced by: `job-write-owner` (R157), `sql-owner` (R86).

## BE-JOBS-2 Every write to a claimed job carries the token it was claimed with

`advance`, `complete` and `fail` take a `GuardedWrite` (`{ jobId, expectedFencingToken }`, both required); the
statement matches `fencing_token = $2`, and zero rows throws the fenced-out error so the worker stops before any further
effect. Domain writes that must not be overtaken run inside `withFence(job, work)`. Nothing catches around a guarded
write; the `FencedProcessor` base owns the failure path.

Why: an optional guard is one some caller forgets, and only the store that accepts the write can refuse a stale worker
atomically.

Enforced by: `job-fence-required` (R158).

## BE-JOBS-3 An outside write goes through the effects piece; an outside read needs no intent

An act outside the app's database (a provider call, a mail, a paid model call, a write to an index) is made by
`Effects.once(key, effect, call)` of `platform/effects`, never by a bare call on an integration port. The piece commits an intent
row before the act and settles it with the result after, under the key `<jobId>:<effect>[:<part>]`, which is the same on every
retry and resume and never carries the fencing token. A key already settled with a kept result answers without acting. An intent
with no result is an unknown outcome, and the effect declares how it is settled: `repeatable` (act again under the same key),
`confirm` (a declared read tells whether the act happened) or `person` (a dead letter: only a person decides to act again); an act
that throws releases its intent unless the failure says its outcome is unknown. A large answer is not kept on the row: the domain
write that stores it settles the key in its own transaction (`settleIn(tx)`). A result that is a secret is sealed by the piece,
never kept as plain text. A job declares its effects in its `defineJob` (BE-JOBS-9); the step and the domain method make no other
outside WRITE.

An outside READ (a page of an index, the rows a source holds, whether a client is configured) needs no intent: repeating it harms
nothing, so there is nothing to protect. The port DECLARES its reads, never the caller and never a method's name: its contract
extends `OutsideReads<"member" | ...>` of `platform/effects`; a client class with no contract merges an interface of its own name
that extends it (TypeScript refuses a class that only implements the phantom member), and a class that implements a port contract
holds the contract's declaration. A member the port does not
declare is an act, so a forgotten declaration only makes the check stricter. A member that creates or changes anything outside, even
when it is safe to repeat (preparing a collection), is an act and goes through the piece as `repeatable`. A read that decides an act
does not excuse the act: the act still goes through the piece.

Why: fencing the local row does not fence the remote act. A row written before the act turns "did it happen?" after a crash
into a declared answer, and one piece keeps that answer out of every feature. A read changes nothing, so an intent row before it
would be ceremony; declaring reads on the port keeps that judgement in one place, beside the members it judges.

Enforced by: `job-effect-piece` (R159): it reads the `OutsideReads` a port extends or implements, judged by its origin in
`platform/effects`. Known gap: whether a declared read really changes nothing outside is held by review. Known gap: the rule reads job steps and the functions that take a `ClaimedJob`, so an
outside call made by a domain method that no `ClaimedJob` reaches is judged by review.

## BE-JOBS-4 A job is a processor plus steps, both thin

`features/jobs/<job>/` holds `index.ts` (exporting `<Job>QueueModule`), `<job>.module.ts` providing the steps,
`steps/<step>.step.ts` (a class implementing `JobStep`) and `transport/queue/<job>.processor.ts` (a class extending
`FencedProcessor` with `queue` and `job` set from the queue's contracts) plus `<job>-queue.module.ts`, which imports
the job module and registers the processor with `JobProcessorRegistry` on init; the processor sets `definition` to the job's declaration
(BE-JOBS-9). The step records itself first
(`claims.advance`), then makes one delegating call into a domain service, which validates the payload and does the
work; the processor's `process` calls its step.

Why: one base class means no job can skip the claim and fence, and thin doors keep the decisions in measured services.

```ts
@Injectable()
/** Runs the queued generation once and writes its answer, or its failure, on the row. */
export class GenerateStep implements JobStep {
    constructor(private readonly runner: GenerationRunnerService, @InjectJobClaims() private readonly claims: JobClaims) {}

    /** Records the step with the held token first, so a stale worker stops before any effect. */
    async run(job: ClaimedJob): Promise<void> {
        await this.claims.advance({ jobId: job.jobId, expectedFencingToken: job.fencingToken, step: "generate" })
        await this.runner.runJob(job)
    }
}
```

Enforced by: `job-shape` (R160), `feature-thin` (R203), `kind-isolation` (R156).

## BE-JOBS-5 The fence is proven on real Postgres

An app declaring `fenced-job` proves each scenario of `ruleParams.be.patternScenarios` (`claim-bumps-token`,
`zombie-fenced-out`, `redispatch-isolated`) in specs titled `fenced-job/<scenario>: ...`: in lite integration specs
driving the real runner through `useTestWorld`, in full e2e.

Why: the fence is a runtime property; only a stale worker resuming after reassignment shows it holds.

Enforced by: R155, R284.

## BE-JOBS-6 A recurring task is a tick of `platform/jobs`, fired once per minute for the deployment

`platform/jobs` alone owns the schedule: `job-ticks.contracts.ts` lists the ticks as data (`JOB_TICKS`, each
`{ name, cron, timeZone: "UTC", queue, payload }`) and `job-tick.service.ts` (`JobTickService`, composed by the jobs
module with `ScheduleModule.forRoot()`) registers one `CronJob` per tick in `SchedulerRegistry`. Every replica fires a
tick; each firing runs one transaction on the jobs connection that takes `advisoryXactLock(tx, "tick:<name>")`, claims
the tick's UTC minute through `job_tick_claim` (the `job_ticks` row of the jobs migration, moved forward only) and, only
when it moved the row, writes one job of the tick's queue into the queue outbox with correlation id
`tick:<name>:<minute>`. The job runs through its processor like any enqueued job: the runner judges a scheduled delivery with the same
classifier and ladders as any other (BE-JOBS-7), so a tick that fails for good is a dead letter too. No other file imports
`@nestjs/schedule` or `cron`, and no file uses a cron decorator.

Why: cron in a replicated process fires once per replica; the lock serialises the replicas and the forward-only minute
claim lets exactly one of them enqueue, in the transaction that writes the outbox row.

Enforced by: R335, `infra-import-owner` (R90).

## BE-JOBS-7 One judge, one ladder per class of flow, then a dead letter a person resumes

`JobRunnerService` of `platform/jobs` is the only place a job failure is judged: `classifyFailure(cause, DomainError)` of
`@starci/nest-kit` (BE-RESILIENCE-2) names the class (`transient`, `input`, `config`, `code`; a retry hint counts as transient). A
domain method that ends early for a typed business reason returns; anything else throws. No feature or domain code catches to wait,
loop, retry, count tries or swallow.

A retry ladder is DECLARED per class of flow, never written in a job or a flow: `platform/jobs` declares each ladder once, its
number of tries and the pause before each, in `job-ladders.policy.ts`, and a job names the ladder of its class once, in its
declaration (BE-JOBS-9). The classes are `background` (nobody waits: a few short tries, such as 5, 10 and 20 seconds) and `waited`
(a person waits on the result: minutes, such as 1, 2, 4 and 8); the numbers are the app's declaration, and a change of them is one
edit of that policy. A transient failure with starts left is `fail`ed and handed back to the queue with the ladder's pause; the
broker's own attempt count is a ceiling above every ladder. A job's start is counted before its work runs, so a crash is a counted
start.

The end of the ladder is a DEAD LETTER: anything but a transient failure at once, a transient failure on its last start, a payload
its guard refuses, and a delivery whose counted start is past its ladder (it killed its worker every time; it is not run again).
The runner parks the row as `failed_awaiting_fix` with `failure_class`, `parked_build`, `parked_at` and the park episode, the
domain row shows the state the job's failure hook wrote (resumable), and `park` answers whether the ONE item for a person of the
episode is due (`alerted_at`; BE-JOBS-8). Scheduled jobs (BE-JOBS-6) and an event consumer's buried event (BE-EVENT-BUS-4) are
judged by the same classifier and raise the same item; a buried event has a person's requeue door.

A dead letter is handed back, each time as `<jobKey>:r<resume_count>` (the `:` is the outbox's, whose check
`job_outbox_dedupe_key_check` refuses a dedupe key with none; `jobKeyOf` strips the one last `:r<digits>`):

- a new build hands back every dead letter of every class, at boot (`ParkedJobResumerService`), without a new item;
- the periodic sweep (`parked-jobs:sweep`, lite `JOB_TICKS`; in full a scheduler on `PARKED_JOBS_SWEEP_QUEUE`) hands back only
  transient dead letters, a bounded number of times each, without a new item;
- a person's resume (`resume({ jobId })`, or `cli queues resume [--job <id>]`, which writes the request through the outbox with
  `ParkedJobResumeRequestsService`, registered alone by `JobsModule.register({ requestsOnly: true, connection })`) hands back one job
  and opens a new episode with its own item.

A resumed job claims its own row again, so its recorded steps and its settled effects are kept and nothing repeats. An app rendered
before this model moves onto it with `starci app codemod self-recovery`: against the template snapshot of that release
(`templates/snapshots/<version>` of `@starci/hfs`) it rewrites each untouched platform file to the current template, adds the new
ones and, in lite, the `jobs-failed-awaiting-fix` db migration (full adds `JobsFailedAwaitingFix` as a file of the tree), and leaves
a file the app edited for a person, writing nothing while one is.

Why: classifying in one place and bounding every wait by a declared ladder means no flow retries forever and none stops silently:
each ends as a dead letter with one item, and a new build, a bounded sweep or a person brings it back as soon as its cause is
fixed, with the row, the fence and the effect ledger making the rerun safe.

Enforced by: R377 `BE_FLOW_FAILURE_SWALLOWED`, `no-hand-rolled-retry` (R81), `job-write-owner` (R157). Known gap: no gate reads the
ladder numbers, the one item per park episode, the bound of the sweep's hand-backs or that a delivery past its ladder is not run; the
platform's own specs and the chain's two specs (a job killed between steps, a job that fails for good and is resumed) prove them, and
a count of tries kept on a domain row is judged by review. The `platform/jobs` templates render the claim, the fence, the sweep and
the resumer; `defineJob`, the ladders, `platform/effects`, the episodes and the progress view are an app's own
platform code until a template carries them, and the rules that read those types judge only where the types exist.

## BE-JOBS-8 The person's "stopped work" page is the app's, over the resume door the jobs platform gives

A lite app has no owner role of the harness: who may see and resume stopped work is the app's own authorization, and the app draws
the page. The jobs platform gives it the door's two halves and nothing that would sit unused in an app without the page:

- the list is `JobClaims.awaitingFix()`: each `ParkedJob` carries `jobId`, `kind` (its queue), `failureClass`, `reason`,
  `parkedAt`, `parkedBuild` and `resumeCount`, which the page shows as one work item each;
- the action is `ParkedJobResumerService.resume({ jobId })` in the process that holds the queue, answering how many jobs went back (0 for
  an id that is not parked: the page reports it and refreshes); from a process with no Redis it is
  `ParkedJobResumeRequestsService.request(jobId)`, which writes the request through the outbox for the sweep;
- `FlowAlerts` is bound to the app's notification of the same person, so the one item of a park episode (`ParkedFlowAlert`, action
  `resume`, keyed by the job and the episode) leads to that page.

The door is an ordinary feature of the app, its query and mutation thin doors, its service the only caller of the two ports:

```ts
// features/api/stopped-work/application/stopped-work.service.ts (the app's own feature; its door is guarded by the app's owner check)
@Injectable()
export class StoppedWorkService {
    constructor(
        @InjectJobClaims() private readonly claims: JobClaims,
        private readonly resumer: ParkedJobResumerService,
    ) {}

    /** The stopped work the owner sees, one item per parked job. */
    list(): Promise<ReadonlyArray<ParkedJob>> {
        return this.claims.awaitingFix()
    }

    /** Resumes one parked job; false when it was no longer parked. */
    async resume(jobId: string): Promise<boolean> {
        return (await this.resumer.resume({ jobId })) === 1
    }
}
```

The front end's page lists the items with their reason and class and offers "resume now" on each; it never retries on its own, and
the item leaves the list once the job is no longer parked; a resume of it opens a new episode and so a new item.

Why: the owner of a lite app is a person the app names, not a harness role, so a page rendered by the harness would guess who may
resume what; giving the contract and the example keeps every app's page on the same two ports and the same refusal.

Enforced by: held by review; the ports are `job-write-owner` (R157) and R377 `BE_FLOW_FAILURE_SWALLOWED`.

## BE-JOBS-9 A job declares itself, starts from an outbox row and enqueues its next in the transaction that finishes it

A job is declared once with `defineJob` of `platform/jobs`, in `modules/queues/<queue>/<queue>.jobs.ts` beside its payload guard: its
`name`, its `queue`, its `ladder` (BE-JOBS-7), the guard of its payload (a payload it refuses is a dead letter at once, class
`input`), its once key (the outbox dedupe key, ids only, so the same request is one job), its `next` (the names of the jobs it may
enqueue; empty at the end of a chain), its outside `effects` with their settle (BE-JOBS-3) and optionally its `progress`
(BE-JOBS-10). The producer and the processor both read the declaration, so the name, the key and the queue are written once.

A job starts only from a queue outbox row written in the transaction of the change that calls for it (BE-QUEUES-1), and it
enqueues the next job of its chain, only a job its `next` lists, in the transaction that finishes it. Every long flow is such a
chain of jobs; a flow whose steps wait on a person or a timer wakes by an outbox row too.

Why: one declaration is the single place a reader and a checker find what a job is, which jobs follow it and what it does outside;
an outbox row written with the change means a job exists exactly when the change committed, and one written with the finish means
a chain never loses its next step.

Enforced by: `job-next-declared` (R403), `outbox-write-tx` (R152), `queue-producer-shape` (R154). Known gap: a job that enqueues a
job its `next` does not list is refused by the queue platform at run time; the rule reads the declarations, so a call site is
judged by review and the chain's specs.

## BE-JOBS-10 Progress is an optional view of the job rows

A job that declares `progress` (a `topic(payload)` returning the platform's `JobProgressTopic`: the principal first, then the chain
root, the same root for every job of a chain) gets a view of its rows: every committed state change of the job row (running, retry
at a time, done, dead letter with its class) is published after commit, and a domain method reports the step progress of its work
through the `JobProgress` port of the frame (`report(job, done, total, labelKey)`), which stores it on the row first and then
publishes it. Nobody listening changes nothing, and a publish failure never fails the job. The frames carry keys only, no text a
person reads. One generic door serves the stream (BE-REALTIME-8): for one chain root, or a bounded set of roots, or the whole
workspace, on one connection, principal-first and membership-checked; a late or reconnecting subscriber first gets the current state
read from the rows, including the next retry time, then the live frames (`Last-Event-ID` resumes).

Why: progress is a view of state the rows already hold, so it is correct after a crash and costs nothing when unwatched; one door
keeps isolation and replay in one place instead of one per job.

Enforced by: `job-progress-shape` (R404), `realtime-topic-scope` (R186). Known gap: no gate reads that a late subscriber gets the
current state before the live frames, that a publish failure never fails the job or that frames carry keys only; the platform's
specs and a real stream client spec prove them.

