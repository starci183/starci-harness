---
slots: [be.app.worker, be.transport.message, be.feature.jobs]
---
# Background work

Which process runs work no request triggers. Jobs are jobs.md and queues.md, schedules BE-QUEUES-3.

## BE-BACKGROUND-1 The owning api app runs its background work; a worker app only scales it apart

An api app composes the queue modules of its jobs (and in full its message transports and reactors) in a compose group
(`compose/jobs.ts`), in the same change that adds them. A separate worker app is opt-in, for a service whose jobs must
scale apart from requests. Recurring work is application-owned (BE-QUEUES-3), never a host crontab.

Why: a processor no process composes never runs, and a schedule the application owns fires once whatever the replica
count.

Enforced by: `background-unowned`, `feature-not-composed` (R46, R31), R250, R268.

## BE-BACKGROUND-2 Every background method has a runner

A processor, step, scheduler tick or sweep, and every method it reaches, is background work whose runner an app
composes. A sweep or reconcile method that no job calls is a finding even when tested; a `retry*` or `replay*` name does
not make a method background.

Why: a unit-tested sweep that nothing schedules gives a false impression of durable recovery.

- When adding a sweep → a database tick or scheduler, a job whose step delegates the sweep, and its queue module in the
  app's jobs group, in one change.

Enforced by: `background-unowned` (R46).
