---
slots: [be.app.worker, be.transport.message, be.feature.jobs]
---
# Background work

Decides which process runs work no request triggers: every consumer, processor, schedule and sweep has a runner composed by an app.
Events travel per event-bus.md, jobs per queues.md and jobs.md, schedules per BE-QUEUES-3.

## BE-BACKGROUND-1 The owning api app runs it; a worker app only scales it apart
An app of kind `api` or `worker` composes the message transports, reactor modules and job queue modules of its own service, in its
`compose/background.ts` group; a separate worker app is opt-in for a service that must scale its consumers apart. Each is composed
by at least one app in the same change it is added, and an e2e run boots that app's real AppModule and drives the event or job
through it. Recurring work is application-owned (a queue job scheduler, a migration-owned database tick or a declared replicated job
running a cli command, BE-QUEUES-3), declared with its overlap policy in the application stacks, never a host crontab.

Why: a consumer or job no process composes never runs; a schedule owned by the application fires once per deployment whatever the
replica count.

Enforced by: R46 BE_BACKGROUND_UNOWNED, R31 BE_FEATURE_NOT_COMPOSED, R250 HFS_HOST_CRON, R268 HFS_SCHEDULE_UNDECLARED.

## BE-BACKGROUND-2 Every background task has a runner
A job processor, scheduler, saga or event consumer, and every method it calls directly or transitively, is background work, and its
runner is composed by an api or worker app. Resolvers and controllers are never background; a `retry*` or `replay*` name alone does
not make a method background. A background method with no runner is a finding even when tested.

Why: a built and unit-tested sweep or reconcile that nothing schedules gives a false impression of durable recovery.

- When adding a sweep → add a scheduler to the queue and a processor that delegates the sweep, and compose the processor in the
  owning app in the same change.

Enforced by: R46 BE_BACKGROUND_UNOWNED.
