---
slots: [be.feature.jobs, be.feature.jobs.steps, be.platform.jobs]
files:
  - path: src/modules/platform/jobs/index.ts
    slot: be.platform.jobs
    role: "Public surface of the capability."
    template: jobs/platform/jobs.index.ts.tpl
  - path: src/modules/platform/jobs/jobs.module.ts
    slot: be.platform.jobs
    role: "Dynamic module registered once per app that runs jobs, over the connection that holds the job table."
    template: jobs/platform/jobs.module.ts.tpl
  - path: src/modules/platform/jobs/jobs.module-definition.ts
    slot: be.platform.jobs
    template: jobs/platform/jobs.module-definition.ts.tpl
  - path: src/modules/platform/jobs/jobs.options.ts
    slot: be.platform.jobs
    template: jobs/platform/jobs.options.ts.tpl
  - path: src/modules/platform/jobs/jobs.config.ts
    slot: be.platform.jobs
    template: jobs/platform/jobs.config.ts.tpl
  - path: src/modules/platform/jobs/jobs.decorators.ts
    slot: be.platform.jobs
    role: "InjectJobClaims, InjectJobProcessorRegistry and their tokens."
    template: jobs/platform/jobs.decorators.ts.tpl
  - path: src/modules/platform/jobs/jobs.contracts.ts
    slot: be.platform.jobs
    role: "ClaimedJob with the delivery correlationId, GuardedWrite (the token is required), RunKey."
    template: jobs/platform/jobs.contracts.ts.tpl
  - path: src/modules/platform/jobs/jobs.port.ts
    slot: be.platform.jobs
    role: "JobClaims, JobStep and JobProcessorRegistry ports."
    rules: [BE_JOB_FENCE_REQUIRED]
    template: jobs/platform/jobs.port.ts.tpl
  - path: src/modules/platform/jobs/job-claim.service.ts
    slot: be.platform.jobs
    role: "The claim and the guarded writes; the only writer of the job row."
    rules: [BE_JOB_WRITE_OUTSIDE_OWNER]
    template: jobs/platform/job-claim.service.ts.tpl
  - path: src/modules/platform/jobs/job-claim.service.spec.ts
    slot: be.platform.jobs
    template: jobs/platform/job-claim.service.spec.ts.tpl
  - path: src/modules/platform/jobs/job-runner.service.ts
    slot: be.platform.jobs
    role: "Subscribes processors to their queues; claim, process, complete or fail, fenced out means stop."
    template: jobs/platform/job-runner.service.ts.tpl
  - path: src/modules/platform/jobs/job-runner.service.spec.ts
    slot: be.platform.jobs
    template: jobs/platform/job-runner.service.spec.ts.tpl
  - path: src/modules/platform/jobs/fenced.processor.ts
    slot: be.platform.jobs
    role: "The base class every processor extends."
    template: jobs/platform/fenced.processor.ts.tpl
  - path: src/modules/platform/jobs/fenced.processor.spec.ts
    slot: be.platform.jobs
    template: jobs/platform/fenced.processor.spec.ts.tpl
  - path: src/modules/platform/jobs/jobs.log-events.ts
    slot: be.platform.jobs
    template: jobs/platform/jobs.log-events.ts.tpl
  - path: src/modules/platform/jobs/errors/jobs.error.ts
    slot: be.platform.jobs
    role: "JobFencedOut."
    template: jobs/platform/jobs.error.ts.tpl
  - path: src/modules/platform/jobs/messages/jobs.messages.ts
    slot: be.domain.messages
    template: jobs/platform/jobs.messages.ts.tpl
  - path: src/modules/platform/jobs/persistence/connection.ts
    slot: be.persistence
    role: "The job entity array registered on every connection that runs jobs."
    template: jobs/platform/persistence.connection.ts.tpl
  - path: src/modules/platform/jobs/persistence/entities/job.entity.ts
    slot: be.persistence
    template: jobs/platform/persistence.job.entity.ts.tpl
  - path: src/modules/platform/jobs/persistence/jobs.sql.ts
    slot: be.persistence
    role: "The claim and guarded-write statements as SqlText constants."
    template: jobs/platform/persistence.jobs.sql.ts.tpl
  - path: src/modules/platform/jobs/persistence/jobs.rows.ts
    slot: be.persistence
    template: jobs/platform/persistence.jobs.rows.ts.tpl
  - path: src/modules/platform/jobs/persistence/migrations/<epochMs13>-create-jobs.ts
    slot: be.persistence
    template: jobs/platform/persistence.migration.ts.tpl
  - path: src/features/jobs/<job>/index.ts
    slot: be.feature.jobs
    template: jobs/job.index.ts.tpl
  - path: src/features/jobs/<job>/<job>.options.ts
    slot: be.feature.jobs
    template: jobs/job.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/jobs/<job>/<job>.module-definition.ts
    slot: be.feature.jobs
    template: jobs/job.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/jobs/<job>/<job>.module.ts
    slot: be.feature.jobs
    template: jobs/job.module.ts.tpl
  - path: src/features/jobs/<job>/transport/queue/<job>-queue.options.ts
    slot: be.feature.jobs.queue
    template: jobs/job.queue.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/jobs/<job>/transport/queue/<job>-queue.module-definition.ts
    slot: be.feature.jobs.queue
    template: jobs/job.queue.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/jobs/<job>/transport/queue/<job>-queue.module.ts
    slot: be.feature.jobs.queue
    template: jobs/job.queue.module.ts.tpl
    role: The queue transport module of the job; composed by an api or worker app, registers the processor.
  - path: src/features/jobs/<job>/transport/queue/<job>.processor.ts
    slot: be.feature.jobs.queue
    template: jobs/job.processor.ts.tpl
    role: 'The processor of one job; extends FencedProcessor — thin (R203 `BE_FEATURE_THIN`): `process` maps the claimed job and delegates into modules/.'
    rules: [BE_JOB_SHAPE]
  - path: src/features/jobs/<job>/steps/<step>.step.ts
    slot: be.feature.jobs.steps
    template: jobs/job.step.ts.tpl
    role: 'One external effect; implements JobStep — thin (R203 `BE_FEATURE_THIN`): the fence call first, then one delegating call that hands the payload, the run key and correlationId to a service of the modules; the payload guards live there.'
    rules: [BE_JOB_SHAPE, BE_JOB_RUN_KEY]
  - path: src/features/jobs/<job>/application/<action>.command.ts
    slot: be.feature.application
    optional: true
  - path: src/features/jobs/<job>/application/<action>.handler.ts
    slot: be.feature.application
    optional: true
  - path: src/features/jobs/<job>/application/<action>.contracts.ts
    slot: be.feature.application
    optional: true
  - path: src/tests/e2e/<area>/<job>.e2e-spec.ts
    slot: be.tests.e2e
    role: "Titles fenced-job/<scenario>: ... prove the pattern."
    spec: fenced-job/claim-bumps-token, fenced-job/zombie-fenced-out, fenced-job/redispatch-isolated
    rules: [BE_PATTERN_SPEC_MISSING]
---
# Fenced background jobs

Decides how background work that must survive a worker that stalls, restarts or is replaced is claimed and settled: a job row whose
fencing token every claim bumps, guarded writes that refuse a stale token, and run keys that let the provider drop a repeated
effect. Starting a job is queues.md; the runner's composition is background.md. In lite a fenced job needs a declared Redis; without
it a long task is a declared replicated job running a cli command.

## BE-JOBS-1 The job row has one owner and one atomic claim
`platform/jobs` owns the job entity (`id`, `kind`, `status`, `currentStep`, `fencingToken`, `claimedBy`, `leaseExpiresAt`,
`payload`, unique `jobKey`), its persistence and `job-claim.service.ts`. `claim()` is one atomic `SqlText` upsert keyed by the
delivery (`INSERT ... ON CONFLICT (job_key) DO UPDATE SET fencing_token = jobs.fencing_token + 1 ... WHERE status = 'failed' OR the
lease expired ... RETURNING`): the first claim creates the row, the store bumps and returns the token, and a done job or a live claim
matches nothing. The runner claims for every queue delivery (the job key is the queue job id), then calls `process`, then the guarded
`complete`. Nothing else writes the row. The claim carries the delivery's correlation id into `ClaimedJob.correlationId`, independent
of the token and run key. The lease outlasts the longest step.

Why: a read-modify-write claim races and a second writer defeats the fence; one owner and one statement keep the token monotonic.

Enforced by: R157 BE_JOB_WRITE_OUTSIDE_OWNER, R86 BE_SQL_TABLE_OWNER.

## BE-JOBS-2 Every write to a claimed job carries expectedFencingToken, required in the type
`JobClaims.advance`, `complete` and `fail` take `GuardedWrite & {...}` with `GuardedWrite = { jobId: string; expectedFencingToken:
number }`, never optional or nullable, never passed through a cast. Each write is `UPDATE ... WHERE id = $1 AND fencing_token = $2`;
zero rows throws `JobFencedOut` and the worker stops with no further effect. No step or processor catches around a guarded write;
the `FencedProcessor` base owns the failure path.

Why: an optional guard is one some caller forgets, and only the store that accepts the write can refuse a stale worker atomically.

Enforced by: R158 BE_JOB_FENCE_REQUIRED.

## BE-JOBS-3 An external effect carries a run key that includes the token
`JobClaims.runKey(job, step)` returns the only constructible `RunKey` (`<jobId>:<step>:<fencingToken>`). A step's one delegating call
hands the payload as delivered, the run key and `job.correlationId` to the module service that owns the effect, which passes the key
as the provider's idempotency key. A step performs no read. When the provider cannot enforce idempotency, constrain overlap and
reconcile before a retry.

Why: fencing the local row does not fence the remote effect; the key ties the effect to one claim.

Enforced by: R159 BE_JOB_RUN_KEY.

## BE-JOBS-4 A job is a processor plus steps, started by a producer
`features/jobs/<job>/transport/queue/<job>.processor.ts` extends `FencedProcessor` (claim, `process(job)`, settle through guarded
writes); `steps/<step>.step.ts` implements `JobStep`, one external effect safe to repeat under the same run key; `application/` holds
plain CQRS. Processor and steps are thin: they map the claimed job and delegate into `modules/`. A domain service starts the job
with a typed producer in its transaction (BE-QUEUES-1). The jobs kind meets other kinds only through events (BE-ARCHITECTURE-6), and
an api or worker app composes the job queue module.

Why: one place and one base class mean a job cannot skip the fence, and the kind boundary keeps a long job out of a request.

Enforced by: R160 BE_JOB_SHAPE, R156 BE_KIND_ISOLATION, R203 BE_FEATURE_THIN.

## BE-JOBS-5 A declared fenced job is proven on the test world
An app declaring `fenced-job` has tests titled `fenced-job/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios`
on real Postgres: a claim bumps the token, a stale worker is fenced out and the provider double sees zero calls, and a re-dispatch
claims a higher token while the old worker's write is refused and the new run carries its own run key. Lite proves them in
integration specs driving the real runner.

Why: the fence is a runtime property; only a paused old worker resuming after reassignment shows it holds.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.
