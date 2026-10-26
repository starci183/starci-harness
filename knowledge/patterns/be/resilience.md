---
slots: [be.platform, be.integrations]
---
# Retry through the shared helper

Decides how code retries a transient failure (a flaky dependency, lock contention, a rate limit): through one shared helper or the
queue's declared attempts, never a loop at the call site.

## BE-RESILIENCE-1 A retried operation goes through platform/retry or the queue policy
Code that retries calls `retry(fn, { maxAttempts, baseDelayMs, maxDelayMs, signal })` of `platform/retry` (bounded attempts,
full-jitter exponential backoff capped at `maxDelayMs`, rejects on abort, rethrows the last error), with the bounds as named
constants, or relies on the attempts and backoff of its queue (`queue.policy.ts`, BE-QUEUES-2). A hand-written loop that catches and
waits does not exist, and the timer ownership of `ruleParams.be.infraOwners` keeps the wait unreachable elsewhere. A polling wait with
no `catch` is not a retry. Only an operation safe to run more than once (idempotent, or claimed through the inbox) is retried.

Why: a hand-rolled loop has no visible bound, no jitter (callers retry in lockstep) and no abort; one helper gives every retry the
same shape and the backoff math one place.

Enforced by: R81 BE_HAND_ROLLED_RETRY, R90 BE_INFRA_OWNER.
