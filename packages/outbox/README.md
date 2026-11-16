# @starci/outbox

The job outbox of a StarCi back end on Postgres alone: a job is written in the transaction of the change that calls for it, claimed
fairly by any number of workers, run under a fenced lease, retried on a declared ladder and, when a retry cannot help, parked as a dead
letter a person, a new build or the bounded sweep hands back. Its state changes, and the app's own events, are written in the same
transactions and served to clients as Server-Sent Events, so a client follows a job's progress instead of polling. An app takes this
package instead of writing its own outbox, claim, lease, ladder, timers or event stream.

| entry | holds |
|---|---|
| `@starci/outbox` | `Outbox`, `OutboxModule` (`register` / `registerAsync`), `OUTBOX` and `InjectOutbox`, `pgDatabase`, `outboxDdl`, `outboxUpgradeDdl`, `defer`, `DEFAULT_LADDERS`, `sseFrame`, the coded `OutboxError` |
| `@starci/outbox/outbox.sql` | the DDL of the four tables under their default names, the file a new app copies into its migrations |
| `@starci/outbox/outbox_contract_0_2_0.sql` | the upgrade of a database on 0.1.0, the file an app on 0.1.0 copies (see "Upgrading from 0.1.0") |

## The tables

`outbox_jobs` (one row per job, unique by `once_key`, its `state` `queued`, `running`, `done`, `parked` or `closed`, its `fence` bumped
by every claim, its notification topic and states), `outbox_slots` (the concurrency slots of each (queue, scope): key `id`, unique by
`(queue, scope, slot)`, its job in `outbox_job_id`), `outbox_timers` (keyed timers) and `outbox_events` (the events clients follow: key
`id`, ordered by `seq`, kept `eventRetentionMs`). Every table has the key `id uuid` and every foreign key is named and indexed by
BE-PERSISTENCE-20, so an app lists none of them in `db.keyExceptions`. The package reads no migration of its own: the app copies
`migrations/outbox.sql` into its forward-only migrations, or renders its own names:

```sh
node --input-type=module -e "import { outboxDdl } from '@starci/outbox'; process.stdout.write(outboxDdl({ scopeType: 'uuid', grantTo: 'app_be' }))" > db/migrations/<stamp>_outbox.sql
```

`schema`, `jobs`, `slots`, `timers`, `events` and `scopeType` (`text` by default, `uuid` for a scope the app references) are the same
options the `Outbox` takes, so the statements and the tables agree. Row level security, a foreign key from `scope` to the app's own table and the
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

## Following a job from the client: events over SSE

A client never polls a job's row. The producer asks for the job's state changes when it enqueues, or publishes its own events in its
transaction; the api serves them as Server-Sent Events; the browser follows them with `@starci/event-stream`.

```ts
// a domain service: the job and its notification commit with the change
await this.dataSource.transaction(async (tx) => {
    await tx.insert(ImportEntity, row)
    await this.outbox.enqueue(tx, {
        scope: row.workspaceId, queue: "imports", name: "import.run", payload: { importId: row.id }, onceKey: `import.run:${row.id}`,
        notify: { topic: "imports" },              // job.claimed, job.done, job.failed, job.parked; or on: ["done", "parked"]
    })
})

// a handler reports progress in its own transaction: the event commits with the work it describes
await this.outbox.publish(context.tx, { scope: job.scope, topic: "imports", type: "import.progress", data: { importId, done: 40, of: 100 } })
```

`publish` and the notifications are written in the caller's transaction under the advisory lock of their scope, held to the commit, so
the events of one scope commit in `seq` order, and the `pg_notify` that wakes the listeners is sent only when the transaction commits (a
rollback leaves nothing). Publish last in a transaction (the lock is held from the write to the commit), and a transaction that publishes
to several scopes publishes them in sorted order.

The api process gives the outbox its one listening connection and serves the stream; the controller is one line:

```ts
// modules/platform/jobs/jobs.module.ts
OutboxModule.registerAsync({
    isGlobal: true,
    inject: [DataSource, DatabaseConfig],
    useFactory: (source: DataSource, db: DatabaseConfig) => ({
        database: source,
        stream: {
            // ONE dedicated connection per process, never a pooled one: it LISTENs for as long as the process runs
            listener: async () => {
                const client = new Client(db.connection)
                await client.connect()
                return client
            },
        },
    }),
})

// a controller of the feature: the scope comes from the caller's principal, never from the request
@Get("imports/events")
@UseGuards(AuthGuard)
events(@Req() req: Request, @Res() res: Response, @Principal() principal: Principal): Promise<void> {
    return this.outbox.sse(req, res, { scope: principal.workspaceId, topics: ["imports"] })
}
```

The stream sends `retry:`, then the events after the client's `Last-Event-ID` (replayed from `outbox_events`), then each event as its
transaction commits, as default frames `id: <seq>` with `data:` the JSON `{ seq, scope, topic, type, data, createdAt }`, and a heartbeat
comment every `stream.heartbeatMs`. One `LISTEN` connection per process fans out to every stream of the process: a notification reads the
scope's new events once for all its subscribers. A client that holds more than `stream.maxBufferedBytes` unsent, or stays full for
`stream.drainTimeoutMs`, is dropped at once without holding the others; it reconnects and resumes. The stream ends on the response's
`close`. `stop()` ends every stream. `subscribe(subscription, { onEvent })` is the same feed without HTTP. With Fastify, pass `req.raw` and
`reply.raw`.

The browser follows it with `@starci/event-stream`, which sends the `Authorization` header, resumes with `Last-Event-ID` and watches the
heartbeat:

```tsx
import useSWRSubscription from "swr/subscription"
import { subscribeEventStream } from "@starci/event-stream/swr"

interface ImportEvent { seq: string; type: string; data: { importId: string; done?: number; of?: number; state?: string } }

const { data: event } = useSWRSubscription(
    ["imports", workspaceId],
    subscribeEventStream(events, "/imports/events", {
        parse: (data) => JSON.parse(data) as ImportEvent,
        onOpen: () => mutate(["imports", workspaceId]), // every (re)open: revalidate the snapshot the stream changes
    }),
)
```

Events live `eventRetentionMs` (a day); the worker deletes older ones every `eventSweepMs`. A client away longer than that resumes from
what is left, which is why `onOpen` revalidates the snapshot.

## Upgrading from 0.1.0

0.2.0 brings the slot table under the key rule: `outbox_slots` takes the key `id uuid` with `(queue, scope, slot)` unique beside it, and
`job_id` becomes `outbox_job_id` with its index. Copy `migrations/outbox_contract_0_2_0.sql` into the app's migrations as
`<stamp>_outbox_contract_0_2_0.sql` (a `*_contract_*` migration: it replaces a key and renames a column), or render it with the app's own
table options: `outboxUpgradeDdl({ scopeType: "uuid", grantTo: "app_be" })`. It also adds the notification columns of `outbox_jobs` and
creates `outbox_events`. Every job, slot and timer is kept. Apply it while no 0.1.0 worker claims (a 0.1.0 worker writes `job_id`): stop
the workers, migrate, start them on 0.2.0. Then drop the `outbox_slots` entry from hfs.json `db.keyExceptions`.

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
- **Events in order, never lost between replay and live.** An event exists exactly when its transaction commits; the events of one scope
  commit in seq order; a subscriber of scope A never receives an event of scope B; a stream resumed after a seq replays exactly the events
  of its scope's topics after it, in order, then live ones, none twice; one slow client is dropped without delaying the others.
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
graceful stop and the hand-back of a new build. For events it proves that a rolled-back publish emits nothing, that a committed one
reaches subscribers through NOTIFY on two connections and from another process, scope isolation, the resume after `Last-Event-ID` (direct
and over HTTP SSE, with headers and heartbeats), the drop of a slow client while the others get every event, retention by `purgeEvents` and
by the worker, the job notifications, and the 0.1.0 to 0.2.0 upgrade of a populated database to the shape of a new install.
