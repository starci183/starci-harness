---
slots: [be.persistence]
---
# Persistence and migrations

Who owns a table, how its schema changes, how the database is reached and how transactions are drawn. Lite runs on
Supabase Postgres (`ruleParams.be.lite.schemaAuthority: supabase`): SQL migrations under `supabase/migrations/`, raw SQL
through TypeORM's `EntityManager`, no entity classes. Full adds TypeORM entities and per-capability migrations
(BE-PERSISTENCE-3) and several bounded contexts (BE-PERSISTENCE-11).

## BE-PERSISTENCE-1 Migrations are the only schema authority

Lite: every schema change is one `supabase/migrations/<stamp>_<name>.sql`, and the generated row types
(`supabase/types/database.types.ts`) come from `npm run db:types`. Full: `persistence/migrations/<epochMs13>-<name>.ts`
of the owning capability, with a `down()` that reverses `up()`. Everywhere `synchronize` is the literal `false`, no
`migrationsRun`, no DDL string outside a migration, no entity or migration glob. Seed data is never a migration.

Why: when an ORM diffs the schema at boot, the live schema is whatever the code implies that day and migrations never
run.

Enforced by: `no-runtime-schema` (R34), `migration-down-reversible` (R74), R213, R257 (lite migration and baseline
shape).

## BE-PERSISTENCE-2 The cli applies migrations; serving apps never do

Migrations run only through `cli migrate run` (in lite it delegates to the managed `db:push` script through the
migration runner of `platform/database`), before api processes start. Api apps never migrate or seed; seeding is a
`cli seed ...` command.

Why: two processes racing to migrate corrupt a schema, and a migration inside a serving module cannot be retried alone.

Enforced by: `no-runtime-schema` (R34), R147.

## BE-PERSISTENCE-3 Full: entities belong to the capability that owns the table

In full, `persistence/entities/<table>.entity.ts` and `persistence/migrations/` sit in the owning capability (domain,
projection, or platform for technical tables); `persistence/connection.ts` exports the `<c>Entities` and
`<c>Migrations` arrays the apps register per connection. An entity is `@Entity("<plural_snake>")`, every `@Column` has
an explicit name and type, timestamps are `timestamptz`, enums `varchar` with a `CHECK`, and there is no eager, lazy or
cascade relation and no GraphQL or validator decorator. No `*.repository.ts`.

Why: one owner per table gives every schema change one reviewer and keeps platform free of domain types.

Enforced by: `schema-owner`, `require-entity-table-name`, `no-eager-relation`, `no-entity-in-contract` (R35, R83, R37).

## BE-PERSISTENCE-4 SQL is a `sql`-tagged constant in the owner's persistence folder

Every statement is an UPPER_SNAKE constant built with the `sql` tag of `platform/database` in
`persistence/<name>.sql.ts`, documented with what it does and its numbered parameters. Values are `$n` parameters with
explicit casts; the only substitution the tag takes is a `SqlIdent` from `ident(name, allowed)`. Row shapes are
readonly snake_case interfaces `<Name>Row` in `persistence/<name>.rows.ts`. No SQL literal elsewhere, no query
builder, no `+` or template building a `.query` string.

Why: SQL in one reviewed file per owner is a data boundary that can be parsed, checked for ownership and never
concatenated.

```ts
/** Cancels a draft order and answers it; no row when it is not a draft ($1 workspace, $2 order). */
export const CANCEL_ORDER = sql`WITH changed AS (
    UPDATE public.orders SET status = 'cancelled'
    WHERE workspace_id = $1::uuid AND id = $2::uuid AND status = 'draft'
    RETURNING id, workspace_id, order_no, status, created_at
)
SELECT id, workspace_id, order_no, status, created_at FROM changed`
```

Enforced by: `sql-text-only`, `no-query-builder`, `no-interpolated-sql` (R36, R68).

## BE-PERSISTENCE-5 Work that must follow a write is written in the same transaction

When a change must lead to a job or an event, the domain service writes the queue outbox (a typed producer,
BE-QUEUES-1) or, in full, the event outbox inside the same transaction, passing that transaction's manager. The
platform relay hands committed rows on; receivers dedupe through the inbox (BE-IDEMPOTENCY-1).

Why: the row commits with the change, so a rollback never starts work and a commit never loses it.

Enforced by: `outbox-write-tx`, `queue-producer-shape` (R152, R154).

## BE-PERSISTENCE-6 No transaction spans an external call

A transaction callback never calls a receiver typed from `integrations/**`, the `HttpClient` or a publisher. Commit
first and call with what the transaction returned, or enqueue the call in the transaction (BE-PERSISTENCE-5). Work
that must see only committed data goes through `AfterCommit.run(manager, task)` of `platform/database`.

Why: a transaction held across a provider call either commits a half or rolls back a success it cannot undo.

Enforced by: `no-external-call-in-transaction` (R82).

## BE-PERSISTENCE-7 The database is reached through the named shared EntityManager

A domain service (or a platform capability owning a `persistence/`) injects
`@InjectPrimaryEntityManager() private readonly entityManager: EntityManager` and calls
`entityManager.query<Array<Row>>(SQL, [params])`. No `getRepository`, `@InjectRepository`, `Repository<T>`, repository
or store class, injected `DataSource` or `QueryRunner` outside `platform/database` and the cli, and no manager in a
door, integration or app.

Why: a repository is bound to one table and cannot carry a transaction into a second; a raw `DataSource` bypasses the
named connection.

Enforced by: `must-inject-entity-manager`, `named-entity-manager-only`, `no-injected-repository`, `no-repository-class`,
`em-injection-slots` (R83, R88).

## BE-PERSISTENCE-8 One database is one connection and one injector

`hfs.json` `sides.be.connections` lists each connection `{ name, envPrefix, owner, isolation, provider }`. Per
connection `platform/database` holds `<conn>.connection.ts` (`<CONN>_CONNECTION`), `<conn>.config.ts`
(`parse<Conn>DatabaseConfig`, reading only `<ENVPREFIX>_*` keys) and `<conn>.decorators.ts`
(`Inject<Conn>EntityManager` over `<CONN>_ENTITY_MANAGER`); `DatabaseModule.register({ isGlobal: true, connections })`
opens them at the app root. No other file declares a connection or calls the framework's injectors.

Why: a second pool onto the same database, or an injector named after a feature, splits transactions and hides which
database a service queries.

Enforced by: `one-connection-per-database`, `connection-map` (R84).

## BE-PERSISTENCE-9 SQL touches only its owner's tables, and every list is bounded

A statement writes only its capability's tables. A multi-row `SELECT` carries `LIMIT` (a literal bound or a clamped
parameter) unless it filters on a unique key or only aggregates; bounds are the `platform/database` constants. A read
never runs once per loop element: read the keys at once (`id = ANY($2::uuid[])`) and look them up.

Why: a statement that writes another owner's table breaks ownership silently, and an unbounded read turns a growing
table into an outage.

Enforced by: `sql-owner`, `query-needs-limit`, `no-query-in-loop` (R86, R69, R77).

## BE-PERSISTENCE-10 The domain service opens the transaction and hands the manager down

The service opens `this.entityManager.transaction(async (manager) => ...)` and uses only `manager` inside. A
collaborating method that must join a caller's transaction takes the manager as its last parameter, defaulting to the
injected one (`manager: EntityManager = this.entityManager`), or takes a required `tx: EntityManager` when it must never
run alone (a queue producer). Row locks are `FOR UPDATE` in a `.sql.ts`. Handlers neither inject a manager nor open a
transaction, and no transaction service or wrapper exists.

Why: one transaction identity per scenario makes atomicity checkable.

```ts
return this.entityManager.transaction(async (manager) => {
    const [row] = await manager.query<Array<InsertedRow>>(INSERT_GENERATION, [workspaceId, kind, input])
    if (row === undefined) throw new GenerationsError({ code: GenerationsErrorCode.NotCreated })
    await this.queue.enqueueGenerate({ generationId: row.id, workspaceId }, manager)
    return { id: row.id, status: "queued" }
})
```

Enforced by: `no-outer-manager-in-transaction`, `em-injection-slots` (R83, R88).

## BE-PERSISTENCE-11 Full: a connection is a bounded context, coupled to others only by events

In full each connection has one owning app and an isolation (`database` or `schema`). No foreign key, relation, SQL
join or import crosses contexts; another context's id is a plain column, its facts arrive as events into a local copy
or a projection, and one transaction touches one context's connection (cross-context work is a saga). Outbox, inbox
and job tables exist on every connection that uses them.

Why: a cross-context relation makes two contexts one database in practice, so neither can migrate or move alone.

Enforced by: `context-owner`, `context-coupling`, `context-transaction`, `context-platform-tables` (R174, R175, R176,
R178).

## BE-PERSISTENCE-16 An UPDATE or DELETE with RETURNING is wrapped in a SELECT

`EntityManager.query` answers a bare `UPDATE ... RETURNING` or `DELETE ... RETURNING` as `[rows, count]`, so such a
statement is `WITH changed AS (UPDATE ... RETURNING ...) SELECT ... FROM changed` (an `INSERT ... RETURNING` answers
rows as written).

Why: a caller reading the tuple as rows silently processes nothing, and a stubbed unit spec cannot see it.

Enforced by: `sql-returning` (R181).

## BE-PERSISTENCE-17 Lite: product data is reached through the back end only

The front end uses Supabase for auth only. On exposed schemas the browser roles hold no table privileges or data
policies; anonymous access is at most `SELECT` under a policy named `*_public_read`, and a deliberate direct-access
table is listed in `hfs.json` `supabase.directAccess`. The back end connects with the least-privilege application role
(`supabase.appRole`: LOGIN, NOINHERIT, NOBYPASSRLS, named grants only), and its tables enable and force RLS unless
`supabase.forceRlsExemptions` names them.

Why: a browser holding the public key and a user token can call the data API even when no code imports it; closed
grants keep the back end the authorization boundary.

Enforced by: R217, R254, R214, R255 (hfs checks over the migrations).

## BE-PERSISTENCE-19 Lite: policies, definers and configuration keep the boundary

A browser-role policy proves a principal predicate (`auth.uid()`), never a constant or `IS NOT NULL`. An exposed view is
`security_invoker`; a `SECURITY DEFINER` function pins `search_path` and revokes EXECUTE from public and the browser
roles. Extensions follow `ruleParams.db.extensions`; migrations write no secret or role password; destructive DDL lives
only in a `*_contract_*` migration after the code stops using the target. An archived migration chain keeps one baseline
and is never edited.

Why: a view, definer or configuration change can expose rows while the base table looks protected.

Enforced by: R214, R215, R256, R216, R259, R213, R257 (hfs checks).
