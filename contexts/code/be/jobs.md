---
slots: [be.feature.jobs, be.feature.jobs.steps, be.feature.jobs.queue, be.platform.jobs, be.domain.messages]
---
# Fenced background jobs

How background work that must survive a worker that stalls, restarts or is replaced is claimed and settled: a job row
whose fencing token every claim bumps, guarded writes that refuse a stale token, and run keys for remote effects.
Starting a job is queues.md; which process runs it background.md. A lite app declares `fenced-job` and Redis.

## BE-JOBS-1 `platform/jobs` alone writes the job row, claiming it atomically

`platform/jobs` owns the job table (a migration of the app; in lite under `db/migrations/`), its `jobs.sql.ts`
and `JobClaims`. `claim` is one atomic upsert keyed by the delivery (the outbox id) that bumps and returns
`fencingToken`; a finished job or a live claim answers `null`. The runner claims each delivery, calls the processor and
settles with a guarded `complete` or `fail`. Nothing else writes the row.

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
