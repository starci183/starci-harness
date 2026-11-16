# Changelog

## 0.2.0 - 2026-11-16

A client follows a job or the app's own changes through Server-Sent Events served from the outbox, never by polling; the slot table comes
under the key rule (BE-PERSISTENCE-20), so an app lists no `db.keyExceptions` for it.

- Added: `outbox_events` (`id uuid` key, `seq bigint generated always as identity` unique, `scope`, `topic`, `type`, `data jsonb`,
  `created_at`), in `outboxDdl()` and `migrations/outbox.sql`; its name is the `events` table option.
- Added: `publish(tx, { scope, topic, type, data })` writes an event in the caller's transaction under the advisory lock of its scope, held
  to the commit, so the events of one scope commit in seq order and a resume after a seq never skips one; a `pg_notify` names the scope and
  is delivered only when the transaction commits, so a rollback wakes nobody. Publish last in a transaction, and publish several scopes in
  sorted order.
- Added: job notifications. `enqueue(tx, { ..., notify: { topic, on? } })` keeps the topic and the states (`claimed`, `done`, `failed`,
  `parked`; all four by default) on the job (`notify_topic`, `notify_on`), and the runner publishes `job.<state>` to the job's scope: `claimed`
  before the handler runs, `done` in the handler's own transaction (it commits with the handler's work), `failed` (with `failureClass` and
  `retryAt`) with the requeue, `parked` with the park. A notification on a job with no scope is refused `OUTBOX_EVENT_INVALID`.
  `ClaimedJob.notify` carries it.
- Added: `subscribe({ scope, topics, lastEventId? }, { onEvent, onClose? })` and `sse(req, res, { scope, topics, lastEventId? })`. One
  dedicated connection per process (`stream.listener`, a connected pg `Client`) LISTENs; a notification reads the scope's new events once and
  hands them to every subscriber of the scope whose topics take them, so no request polls the database. The scope is required (refused
  `OUTBOX_SUBSCRIPTION_INVALID`). A join reads the scope's head after the LISTEN is up and replays the events after `Last-Event-ID` (the
  header, or `lastEventId`) up to it, so nothing falls between replay and live and nothing is sent twice. The stream sends `retry:`, a
  heartbeat comment every `stream.heartbeatMs` (15 s), each event as a default frame whose `id` is its seq (what `@starci/event-stream`
  resumes); a client holding more than `stream.maxBufferedBytes` (1 MiB) unsent, or full for `stream.drainTimeoutMs` (10 s), is dropped at
  once and resumes on reconnect. The listening connection is opened again after a doubling wait from `stream.reconnectMs` and every followed
  scope is read again. `stop()` ends every stream and closes the listener. `OUTBOX_STREAM_UNCONFIGURED` when no listener is set.
- Added: retention. The worker deletes events older than `eventRetentionMs` (a day) every `eventSweepMs` (10 min); `purgeEvents(before?)`
  runs it by hand.
- Changed (contract): `outbox_slots` has the key `id uuid` with `(queue, scope, slot)` unique beside it, and its foreign key `job_id` is
  `outbox_job_id` (`<jobs singular>_id` for a renamed job table), indexed. `outboxUpgradeDdl()` renders the upgrade with the app's names;
  `migrations/outbox_contract_0_2_0.sql` (exported as `@starci/outbox/outbox_contract_0_2_0.sql`) is the default rendering.

Upgrade from 0.1.0: copy `migrations/outbox_contract_0_2_0.sql` into the app's migrations as `<stamp>_outbox_contract_0_2_0.sql` (or render
`outboxUpgradeDdl(options)` with the app's table options) and apply it while no 0.1.0 worker claims: a 0.1.0 worker writes `job_id`, so stop
the workers, migrate, then start them on 0.2.0 (a job a 0.1.0 worker parked in the gap is handed back by `buildId`). Every job, slot and
timer is kept. Drop the `outbox_slots` entry from hfs.json `db.keyExceptions`. To serve streams, give `stream.listener`; with `scopeType:
"uuid"` the events table's scope is `uuid` too.

## 0.1.0 - 2026-11-16

The Postgres job outbox of a back end in one package, so an app no longer writes its own outbox, claim, lease, ladder and timers.

- Added: `Outbox`, over an `OutboxDatabase` (a TypeORM `DataSource` or `EntityManager` as it is, or `pgDatabase(pool)` for node-postgres) and the three tables of `outboxDdl()` (`outbox_jobs`, `outbox_slots`, `outbox_timers`; schema, names and a `text` or `uuid` scope are options; `migrations/outbox.sql`, exported as `@starci/outbox/outbox.sql`, is the default rendering).
- Added: the write door. `enqueue(tx, { scope, queue, name, payload, onceKey, notBefore? })` runs in the caller's own transaction (any object with `query(sql, params)`: a TypeORM manager, a pg client) and inserts once per once key (`{ id, created }`); `armTimer(tx, { scope, key, dueAt, queue?, name?, payload })` (a pending key is moved), `cancelTimer`, `cancelTimersByPrefix`; a due timer fires once into one job `{ timerId, key, data }`.
- Added: the claim. Due rows (`queued` past `not_before`, or `running` past their lease) are ranked per (queue, scope) and capped by the scope's free slots, so one busy scope cannot fill a batch; the rows are locked `for update skip locked`, then the advisory lock of every (queue, scope) the claim meets is taken in one sorted order before any slot is read or written (two claimers meeting the same scopes in different row orders never deadlock), and each job takes a free slot (`defaultConcurrency` 4, `queueConcurrency` per queue) and turns `running` with a bumped `fence` and a new lease. Unscoped jobs (scope null) take no slot.
- Added: one start. `run(job)` runs the handler and the `done` mark of its job in one transaction, the mark landing only under the claim's fence (`lost` otherwise, the handler's writes rolled back); the lease is renewed every third of `leaseMs` while it runs, and a renewal that finds the fence gone aborts `context.signal`. `context.enqueue` chains a job in the same transaction, `context.effectKey(effect)` is the `<jobId>:<effect>` key of an outside effect, `defer(seconds)` hands the job back later without spending a start. A handler's optional `accepts` guard refuses a payload as class `input`.
- Added: failures. The class comes from the error alone (`classify`, by default `classifyFailure(cause, DomainError)` of `@starci/nest-kit`: an explicit `failureClass` wins); `transient` retries on the handler's ladder (`DEFAULT_LADDERS` `background` 5, 10, 20 s over 4 starts and `waited` 1, 2, 4, 8 min over 5, or the app's own `ladders`), anything else, a spent ladder, a missing handler or a start past the ladder (a crash loop) parks with `failure_class`, `park_reason`, `parked_build` and a scrubbed, bounded reason (`reasonOf`, `redact`). `onParked` is called once per park episode, after commit.
- Added: dead letters. `parked({ scope?, limit? })`, `resume(jobId, "person" | "machine")` (a person opens a new episode, the machine keeps it), `resumeTransient()` (the sweep: transient dead letters parked at least one `resumeSweepMs` ago, at most `autoResumes` times each), `resumeAfterBuild(build)` (run by `start` when `buildId` is set), `close(jobId, reason)`; `purge(before)` and `stats()`.
- Added: the worker. `start()` runs the loop (timers every `timerSweepMs`, the resume sweep, claims up to `maxInFlight` jobs at once, at once again while the batch came back full); `stop(graceMs)` claims no more, waits for running jobs, then hands their rows back with the start not spent and aborts them; `drain()` runs everything due now, for specs and one-shot commands. `clock` and `schedule` are seams.
- Added: `OutboxModule` (`register` / `registerAsync` from `defineCapabilityModule` of `@starci/nest-kit`, `isGlobal`), the `Outbox` under `OUTBOX` (`@InjectOutbox()`), and `OutboxLifecycle`, which starts the loop on `onApplicationBootstrap` when `autoStart` is set and stops it on `beforeApplicationShutdown`.
- Added: the coded `OutboxError` (`OUTBOX_OPTIONS_INVALID`, `OUTBOX_JOB_INVALID`, `OUTBOX_HANDLER_DUPLICATE`, `OUTBOX_HANDLER_MISSING`, `OUTBOX_LADDER_UNKNOWN`, `OUTBOX_PAYLOAD_REFUSED`, `OUTBOX_LEASE_LOST`) with `OUTBOX_ERROR_KINDS`.
