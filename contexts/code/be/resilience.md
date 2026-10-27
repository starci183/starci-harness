---
slots: [be.platform, be.integrations]
---
# Retry

How code retries a transient failure: through the queue's attempts, or through the shared timer, never a hand-written
catch-and-wait loop.

## BE-RESILIENCE-1 A retry is the job's attempts; a wait goes through the platform timer

Work that may fail transiently runs in a job and is retried by the queue policy of `platform/queue` (BE-QUEUES-2), so
it must be safe to repeat (fenced, claimed through
the inbox, or idempotent at the provider). Code that must wait inside a process schedules through the `Timer` port of
`platform/retry` (`@InjectTimer()`), never `setTimeout` or `node:timers/promises`. A loop that catches and waits does
not exist outside `platform/retry`.

Why: a hand-rolled loop has no visible bound, no jitter and no abort, and holds a request open while it sleeps.

Enforced by: `no-hand-rolled-retry` (R81), `infra-import-owner` (R90).
