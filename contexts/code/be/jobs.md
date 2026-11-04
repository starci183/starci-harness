---
slots: [be.feature.jobs, be.feature.jobs.steps, be.feature.jobs.queue, be.platform.jobs, be.domain.messages]
---
# Fenced background jobs

How background work that must survive a worker that stalls, restarts or is replaced is claimed and settled: a job row
whose fencing token every claim bumps, guarded writes that refuse a stale token, and run keys for remote effects.
Starting a job is queues.md; which process runs it background.md. A lite app declares `fenced-job` and Redis.

## BE-JOBS-1 `platform/jobs` alone writes the job row, claiming it atomically

`platform/jobs` owns the job table (a migration of the app; in lite under `db/migrations/`), its `jobs.sql.ts`
and `JobClaims`. `claim` is one atomic upsert keyed by the delivery (the outbox id, without the `-r<n>` a resume adds) that bumps and
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

## BE-JOBS-3 A remote effect carries a run key that includes the token

A call on an integration port inside a step passes `claims.runKey(job, step)` (`<jobId>:<step>:<fencingToken>`), the
only constructible `RunKey`, as the provider's idempotency key. When the provider cannot dedupe, constrain overlap and
reconcile before a retry.

Why: fencing the local row does not fence the remote effect; the key ties the effect to one claim.

Enforced by: `job-run-key` (R159).

## BE-JOBS-4 A job is a processor plus steps, both thin

`features/jobs/<job>/` holds `index.ts` (exporting `<Job>QueueModule`), `<job>.module.ts` providing the steps,
`steps/<step>.step.ts` (a class implementing `JobStep`) and `transport/queue/<job>.processor.ts` (a class extending
`FencedProcessor` with `queue` and `job` set from the queue's contracts) plus `<job>-queue.module.ts`, which imports
the job module and registers the processor with `JobProcessorRegistry` on init. The step records itself first
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
`tick:<name>:<minute>`. The job runs through its processor like any enqueued job. No other file imports
`@nestjs/schedule` or `cron`, and no file uses a cron decorator.

Why: cron in a replicated process fires once per replica; the lock serialises the replicas and the forward-only minute
claim lets exactly one of them enqueue, in the transaction that writes the outbox row.

Enforced by: R335, `infra-import-owner` (R90).

## BE-JOBS-7 A job a retry cannot fix is parked, alerted once and resumed

The runner classifies every failure with `classifyFailure(cause, DomainError)` of `@starci/nest-kit` (BE-RESILIENCE-2): a transient one with attempts left is `fail`ed and
rethrown; any other parks the row as `failed_awaiting_fix` with `failure_class`, `parked_build` and `parked_at`, and `park` answers
whether its one alert is due (`alerted_at`). `ParkedJobResumerService` resumes at boot every job parked under another build, the
`parked-jobs:sweep` tick (lite `JOB_TICKS`; in full a scheduler on `PARKED_JOBS_SWEEP_QUEUE`) every parked job, and
`resume({ jobId })` one job for the owner's "resume now" (a sweep delivery carrying `{ jobId }` asks for it: `ParkedJobResumeRequestsService`,
registered alone by `JobsModule.register({ requestsOnly: true, connection })`, writes it through the outbox, and the lite cli's
`cli queues resume [--job <id>]`, rendered once the app has its cli app and its jobs platform, calls it); each resume counts `resume_count` and hands the job back as
`<jobKey>-r<resume_count>`. An app rendered before the park moves onto it with `starci app codemod self-recovery`: against the
template snapshot of that release (`templates/snapshots/<version>` of `@starci/hfs`) it rewrites each untouched platform file to the
current template, adds the new ones and, in lite, the `jobs-failed-awaiting-fix` db migration (full adds `JobsFailedAwaitingFix` as
a file of the tree), and leaves a file the app edited for a person, writing nothing while one is.

Why: the row already holds the fence and the recorded steps, so parking and resuming it keeps every guarantee of BE-JOBS-1 to
BE-JOBS-3 while no failure ends as a dead letter nobody restarts.

Enforced by: R377 `BE_FLOW_FAILURE_SWALLOWED`, `job-write-owner` (R157).

## BE-JOBS-8 The owner's "stopped work" page is the app's, over the resume door the jobs platform gives

A lite app has no owner role of the harness: who may see and resume stopped work is the app's own authorization, and the app draws
the page. The jobs platform gives it the door's two halves and nothing that would sit unused in an app without the page:

- the list is `JobClaims.awaitingFix()`: each `ParkedJob` carries `jobId`, `kind` (its queue), `failureClass`, `reason`,
  `parkedAt`, `parkedBuild` and `resumeCount`, which the page shows as one work item each;
- the action is `ParkedJobResumerService.resume({ jobId })` in the process that holds the queue, answering how many jobs went back (0 for
  an id that is not parked: the page reports it and refreshes); from a process with no Redis it is
  `ParkedJobResumeRequestsService.request(jobId)`, which writes the request through the outbox for the sweep;
- `FlowAlerts` is bound to the app's notification of the same person, so the one alert of a parked job (`ParkedFlowAlert`, action
  `resume`) leads to that page.

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
the item leaves the list once the job is no longer parked.

Why: the owner of a lite app is a person the app names, not a harness role, so a page rendered by the harness would guess who may
resume what; giving the contract and the example keeps every app's page on the same two ports and the same refusal.

Enforced by: held by review; the ports are `job-write-owner` (R157) and R377 `BE_FLOW_FAILURE_SWALLOWED`.
