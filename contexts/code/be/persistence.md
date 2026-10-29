---
slots: [be.persistence]
---
# Persistence and migrations

Who owns a table, how its schema changes, how the database is reached and how transactions are drawn. Lite runs its own
PostgreSQL (the `db` service of its stack, `ruleParams.be.lite.schemaAuthority: sql`): SQL migrations under
`db/migrations/`, TypeORM entities that map those tables (BE-PERSISTENCE-3) read and written through the
`EntityManager`. Full adds per-capability TypeORM migrations, its `sql`-tagged statements (BE-PERSISTENCE-4) and several
bounded contexts (BE-PERSISTENCE-11).

## BE-PERSISTENCE-1 Migrations are the only schema authority

Lite: every schema change is one `db/migrations/<stamp>_<name>.sql` (`npm run db:new -- <kebab-name>`), applied after the
managed `db/bootstrap.sql` by `starci app db migrate --url-env <NAME>`; entities only map tables a migration created. Full: `persistence/migrations/<epochMs13>-<name>.ts`
of the owning capability, with a `down()` that reverses `up()`. Everywhere `synchronize` is the literal `false`, no
`migrationsRun`, no DDL string outside a migration, no entity or migration glob. Seed data is never a migration.

Why: when an ORM diffs the schema at boot, the live schema is whatever the code implies that day and migrations never
run.

Enforced by: `no-runtime-schema` (R34), `migration-down-reversible` (R74), R213, R257, R332 (lite migration path,
shape and baseline); lite entities are checked against the migrated schema by `starci app db drift` (BE_ENTITY_SCHEMA_DRIFT, R333).

## BE-PERSISTENCE-2 The cli applies migrations; serving apps never do

Migrations run only through `cli migrate run` (in lite it delegates to the managed `db:push` script, `starci app db migrate`, through the
migration runner of `platform/database`), before api processes start. Api apps never migrate or seed; seeding is a
`cli seed ...` command.

Why: two processes racing to migrate corrupt a schema, and a migration inside a serving module cannot be retried alone.

Enforced by: `no-runtime-schema` (R34), R147.

## BE-PERSISTENCE-3 Entities belong to the capability that owns the table

In both editions `persistence/entities/<table>.entity.ts` sits in the owning capability (domain, projection, or platform for
technical tables). An entity is `@Entity({ schema, name: "<plural_snake>" })`, every `@Column` has an explicit `name` and
`type`, timestamps are `timestamptz`, enums `varchar` with a `CHECK`, and there is no eager, lazy or cascade relation and
no GraphQL or validator decorator. No `*.repository.ts`. Full keeps `persistence/migrations/` beside them and
`persistence/connection.ts` exports the `<c>Entities` and `<c>Migrations` arrays the apps register per connection. Lite
has no be migration: each capability's `persistence/entities/index.ts` exports its `<c>Entities` array (a sanctioned
re-export), and `platform/database/entities.ts` lists those arrays by name, no glob, as `PRIMARY_ENTITIES`.
`DatabaseOptions.entities` is required, and only the composition root of an app passes `PRIMARY_ENTITIES`, imported
from the deep path `@modules/platform/database/entities`: `DatabaseModule` never imports that file and the
`platform/database` barrel never exports it, because database.module, the entity list and the capability barrels would
form a cycle that fails at boot (`InjectPrimaryEntityManager is not a function`).

Why: one owner per table gives every schema change one reviewer and keeps platform free of domain types.

Enforced by: `schema-owner`, `require-entity-table-name`, `no-eager-relation`, `no-entity-in-contract` (R35, R83, R37);
the deep `PRIMARY_ENTITIES` import from app composition only is held by review (open gap: the import-boundary rule does not
name that path yet).

## BE-PERSISTENCE-4 Lite reads and writes through entities; full SQL is a `sql`-tagged constant

Lite: domain and feature code uses the entity API of the injected manager (`find`, `findOne`, `findBy`, `count`,
`exists`, `insert`, `save`, `update`, `delete`, `upsert`, `increment`) and `createQueryBuilder(Entity, "alias")` with
named parameters for joins, aggregates, `FOR UPDATE` / `SKIP LOCKED` and jsonb or vector operators; it writes no `.query(`
and no `sql` template, and no `<Name>Row` interface: a service maps entities to its contracts. A database function
TypeORM cannot express is called through the helpers of `platform/database` (`callDbFunction(manager, name, args)`,
`advisoryXactLock(manager, key)`, `notify(manager, channel, payload)`), which build the parameterised statement and accept
only a function `ruleParams.be.dbFunctions` (the canon's pg built-ins) or hfs.json `sides.be.dbFunctions` (the app's own,
each with its reason) lists. TypeORM 0.3 traps the builder hides: a dotted join (`innerJoin("public.x", ...)`) throws, so
join the entity or the unqualified table; `InsertQueryBuilder.returning()` takes the string form and ignores an array; an
`UPDATE ... RETURNING` stays one builder statement, never a write followed by a read. A query builder names its entity:
a table-name builder and a Repository are refused. The unit doubles are `mockEntityManager` of `@starci/jest-preset`
(`{ method: [Entity, result] }`) and, for a builder, its `queueQueryBuilders(em, answers)` (`fakeQueryBuilder` per call).

Full: every statement is an UPPER_SNAKE constant built with the `sql` tag of `platform/database` in
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

Enforced by: lite `no-raw-sql` (R334); full `sql-text-only`, `no-query-builder`, `no-interpolated-sql` (R36, R68).

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
`@InjectPrimaryEntityManager() private readonly entityManager: EntityManager` and calls its entity API (lite,
BE-PERSISTENCE-4) or `entityManager.query<Array<Row>>(SQL, [params])` (full). No `getRepository`, `@InjectRepository`, `Repository<T>`, repository
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

The browser never reaches the database: there is no data API and the front end holds no database credential. The back end
connects with the least-privilege application role (`db.appRole` of hfs.json, `app_be` by default: LOGIN, NOINHERIT,
NOBYPASSRLS, named grants only), and its tables enable and force RLS unless `db.forceRlsExemptions` names them. The
`anon`, `authenticated` and `service_role` roles of `db/bootstrap.sql` exist NOLOGIN only so migrations written for a
hosted provider apply; no door logs in as them.

Why: the back end stays the one authorization boundary, and forced RLS keeps a missed `WHERE` from reading another owner's
rows.

Enforced by: R214, R255 (hfs checks over the migrations).

## BE-PERSISTENCE-19 Lite: policies, definers and configuration keep the boundary

A browser-role policy proves a principal predicate (`auth.uid()`), never a constant or `IS NOT NULL`. An exposed view is
`security_invoker`; a `SECURITY DEFINER` function pins `search_path` and revokes EXECUTE from public and the browser
roles. Extensions follow `ruleParams.db.extensions`; migrations write no secret or role password; destructive DDL lives
only in a `*_contract_*` migration after the code stops using the target. An archived migration chain keeps one baseline
and is never edited.

Why: a view, definer or configuration change can expose rows while the base table looks protected.

Enforced by: R214, R215, R256, R259, R213, R257 (hfs checks).
