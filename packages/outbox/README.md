# @starci/outbox

The job outbox of a StarCi back end on Postgres alone: a job is written in the transaction of the change that calls for it, claimed
fairly by any number of workers, run under a fenced lease, retried on a declared ladder and, when a retry cannot help, parked as a dead
letter a person, a new build or the bounded sweep hands back. An app takes this package instead of writing its own outbox, claim,
lease, ladder or timers.

| entry | holds |
|---|---|
| `@starci/outbox` | `Outbox`, `OutboxModule` (`register` / `registerAsync`), `OUTBOX` and `InjectOutbox`, `pgDatabase`, `outboxDdl`, `defer`, `DEFAULT_LADDERS`, the coded `OutboxError` |
| `@starci/outbox/outbox.sql` | the DDL of the three tables under their default names, the file an app copies into its migrations |

## The tables

`outbox_jobs` (one row per job, unique by `once_key`, its `state` `queued`, `running`, `done`, `parked` or `closed`, its `fence` bumped
by every claim), `outbox_slots` (the concurrency slots of each (queue, scope)) and `outbox_timers` (keyed timers). The package reads no
migration of its own: the app copies `migrations/outbox.sql` into its forward-only migrations, or renders its own names:

```sh
node --input-type=module -e "import { outboxDdl } from '@starci/outbox'; process.stdout.write(outboxDdl({ scopeType: 'uuid', grantTo: 'app_be' }))" > db/migrations/<stamp>_outbox.sql
```

`schema`, `jobs`, `slots`, `timers` and `scopeType` (`text` by default, `uuid` for a scope the app references) are the same options the
`Outbox` takes, so the statements and the tables agree. Row level security, a foreign key from `scope` to the app's own table and the
retention of finished rows (`purge(before)`) are the app's, in its own migration and schedule.

## Wiring it in Nest

```ts
// modules/platform/jobs/jobs.module.ts: the one owner of the outbox in the app
OutboxModule.registerAsync({
    isGlobal: true,
    inject: [DataSource, JobsConfig, ParkedAlerts],
    useFactory: (source: DataSource, config: JobsConfig, alerts: ParkedAlerts) => ({
        database: source,            // a TypeORM DataSource as it is; pgDatabase(pool) for node-postgres
        scopeType: "uuid",
        autoStart: true,             // the process that runs jobs; an api that only enqueues leaves it off
        buildId: config.buildId,     // the app's parsed settings; the package reads no environment
        queueConcurrency: { notify: 2 },
        onParked: (job) => alerts.parked(job), // one call per park episode, after commit
    }),
})
```

The app enables Nest's shutdown hooks: on `beforeApplicationShutdown` the loop stops claiming, running jobs get `shutdownGraceMs`, and
what still runs goes back to the queue with its start not spent.

A handler is a provider of its feature that registers itself:

```ts
export class NotifyItemJob implements JobHandler<NotifyPayload>, OnModuleInit {
    readonly name = "item.notify"
    readonly ladder = "waited"
    constructor(@InjectOutbox() private readonly outbox: Outbox, private readonly items: ItemsService) {}

    onModuleInit(): void {
        this.outbox.handle(this)
    }

    accepts(payload: unknown): payload is NotifyPayload {
        return isNotifyPayload(payload)
    }

    async handle(job: ClaimedJob & { payload: NotifyPayload }, context: JobContext): Promise<void> {
        await this.items.notify(job.payload, context.tx, context.effectKey("notify"))
    }
}
```

And a domain service enqueues in its own transaction:

```ts
await this.dataSource.transaction(async (tx) => {
    await tx.insert(ItemEntity, item)
    await this.outbox.enqueue(tx, { scope: item.ownerId, queue: "notify", name: "item.notify", payload: { itemId: item.id }, onceKey: `item.notify:${item.id}` })
})
```

## What it guarantees

- **Atomic enqueue, once.** The row commits or rolls back with the caller's change; a second enqueue under the same once key inserts nothing.
- **Fair claim, no deadlock.** Due rows are ranked per (queue, scope) and capped by that scope's free slots, so one busy scope never fills
  a batch. Rows are locked `skip locked`; then the advisory locks of every (queue, scope) the claim meets are taken in one sorted order
  before any slot is read or written. Two claimers that meet the same scopes in different row orders would otherwise each hold one lock and
  wait on the other's; one global order has no cycle.
- **Fenced lease.** Every claim bumps `fence`; the done mark, a retry, a park and a renewal land only under the fence they were claimed
  with. The handler and the done mark share one transaction, so a worker whose lease expired (and whose job was claimed again) commits
  nothing. The lease is renewed every third of `leaseMs`; a renewal that finds the fence gone aborts `context.signal`.
- **One judge.** The class of a failure comes from the error: an explicit `failureClass` wins (`classifyFailure` of `@starci/nest-kit`;
  pass `classify` to replace it). Never from the words of a code. `transient` retries on the handler's ladder; any other class, a spent
  ladder, a refused payload, a missing handler or a crash loop (a start past the ladder) parks once, with its class, reason and build,
  and `onParked` hears it once per episode.
- **Self-recovery.** `start` with `buildId` hands back everything parked under another build; the sweep hands back transient dead letters
  a bounded number of times; `resume(id)` is a person's (a new episode, a new alert), `close(id, reason)` ends one for good.
- **Time.** `notBefore` delays a job; timers are keyed per scope (a re-arm moves the pending one) and fire once into a job. `clock` and
  `schedule` are seams: `drain()` runs all that is due now, which is what a spec calls.

Known gap: the fair claim ranks every due row on each claim; a backlog of hundreds of thousands of due rows makes each claim scan them,
and an app with such a backlog measures it before relying on the defaults.

## Proof

`npm test` typechecks, lints and runs the specs with coverage. `src/real.spec.ts` runs against a real PostgreSQL: the server
`STARCI_OUTBOX_PG_URL` names, else a container of the pinned `postgres` 17.11 image when Docker answers. It proves the atomic and once-only
enqueue (over node-postgres and TypeORM), the shared transaction of handler and mark, the ladder and its alert episodes, the classes, defer,
the fence against a stale worker, the lease renewal, the crash loop, timers, fairness, 6 looping workers over 12 scopes x 20 jobs with no
deadlock, no double run and no scope over its slots, a claim storm of 8 claimers that deadlocks when the lock order is not sorted, the
graceful stop and the hand-back of a new build.
