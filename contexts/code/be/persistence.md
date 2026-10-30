---
slots: [be.persistence, be.platform.database.entities]
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
no GraphQL or validator decorator. Columns every table shares are inherited, never repeated: `platform/database/abstract.entity.ts`
holds `AbstractEntity` (`created_at` and `updated_at`, which the database sets, so `insert: false, update: false`) and
`UuidAbstractEntity` (that plus the generated uuid `id`), and an entity whose table has exactly those columns extends one of
them, imported from `@modules/platform/database`; a table without them (an app-set timestamp, a bigint key, no `updated_at`)
declares its own columns and extends nothing. A base maps no table, so it carries no `@Entity`, and the first table that
extends it writes the file and its barrel export (`starci app add table`), never the starter. No `*.repository.ts`. Full keeps `persistence/migrations/` beside them and
`persistence/connection.ts` exports the `<c>Entities` and `<c>Migrations` arrays the apps register per connection. Lite
has no be migration: each capability's `persistence/entities/index.ts` exports its `<c>Entities` array (a sanctioned
re-export), and the entity registry `platform/database/entities.ts` (slot `be.platform.database.entities`, role
`entity-registry`) lists those arrays by name, no glob, as `PRIMARY_ENTITIES` and exports nothing else. The registry is
its own slot, not ordinary platform code: it is the one platform file that imports domain and platform capabilities, and
each of those imports takes only that capability's `<c>Entities` from its `index.ts`. `DatabaseOptions.entities` is
required, and the registry is imported only by the files its slot's `importedBy` names, app composition
(`apps/<app>/src/compose/*.ts`, `app.module.ts`) and the test world (`src/tests/world/**`), from the deep path
`@modules/platform/database/entities`: `DatabaseModule` never imports that file and the `platform/database` barrel never
exports it, because database.module, the entity list and the capability barrels would form a cycle that fails at boot
(`InjectPrimaryEntityManager is not a function`).

Why: one owner per table gives every schema change one reviewer and keeps platform free of domain types; the one
registry that names every list is the only place that knowledge meets.

Enforced by: `schema-owner`, `require-entity-table-name`, `no-eager-relation`, `no-entity-in-contract` (R35, R83, R37);
the registry's imports and importers by `tier-direction` (R26), `owner-export-bypass` and `import-owner-entry` (R30),
which admit exactly the registry's `<c>Entities` imports and its `importedBy` importers; `owner-cycle` (R27)
counts the registry as a unit of its own, so it never closes a cycle among capabilities through `platform/database`.
Inherited columns count as the entity's own: `starci app db drift` reads them from TypeORM's metadata and `sql-owner` (R86)
reads an inherited primary key; extending a base where the table has its columns is held by review.

## BE-PERSISTENCE-4 Lite reads and writes through entities; full SQL is a `sql`-tagged constant

Lite: domain, feature and test code uses the entity API of an EntityManager (`find`, `findOne`, `findBy`, `count`,
`exists`, `insert`, `save`, `update`, `delete`, `upsert`, `increment`) and `createQueryBuilder(Entity, "alias")` with
named parameters for joins, aggregates, `FOR UPDATE` / `SKIP LOCKED` and jsonb or vector operators; it writes no `.query(`
and no `sql` template, and no `<Name>Row` interface: a service maps entities to its contracts. Domain code takes the
injected manager; integration and e2e specs, builders and fixtures seed and assert through the world's
`world.db.<connection>`. Raw SQL has two owners: `platform/database` and the test world `src/tests/world/`, which as the
owner of test infrastructure wraps only what entities cannot express (a trigger, a database function, a row-level-security
probe, a pgmq queue inspection) in a named, typed helper on the world (`world.db.<connection>.raw...`) that specs call.
A database function TypeORM cannot express is called, in domain and test code alike, through the helpers of `platform/database/database.client.ts`
(`callDbFunction(manager, name, args)`, `advisoryXactLock(manager, key)`, `notify(manager, channel, payload)`), which
build the parameterised statement and accept only a function `ruleParams.be.dbFunctions` (the canon's) or hfs.json
`sides.be.dbFunctions` (the app's own, each with its reason) lists. A function of a migration is named schema-qualified
(`public.job_claim`, `be_access.chat_target_member`) in the call and in the list; a pg built-in the canon lists is
named bare and called in `pg_catalog`. `callDbFunction` refuses any other name with `DATABASE_IDENTIFIER_REJECTED`,
double-quotes each checked part and passes the arguments as numbered parameters; that file is the one place a call
statement is composed (R68 names it). TypeORM 0.3 traps the builder hides: a dotted join (`innerJoin("public.x", ...)`)
throws, so join the entity or the unqualified table; `InsertQueryBuilder.returning()` takes the string form and ignores an array; an
`UPDATE ... RETURNING` stays one builder statement, never a write followed by a read, and the `raw` rows a builder's `execute()`
answers are read through `returnedRows(result.raw, rowShape({ column: kind }))` of `platform/database`, which checks each row
against the returned columns and refuses another shape (`DATABASE_RETURNING_ROW_REJECTED`), never cast. A query builder names its entity:
a table-name builder and a Repository are refused. The unit doubles are `mockEntityManager` of `@starci/jest-preset`
(`{ method: [Entity, result] }`) and, for a builder, its `queueQueryBuilders(em, answers)` (`fakeQueryBuilder` per call).

Full: every statement is an UPPER_SNAKE constant built with the `sql` tag of `platform/database` in
`persistence/<name>.sql.ts`, documented with what it does and its numbered parameters. Values are `$n` parameters with
explicit casts; the only substitution the tag takes is a `SqlIdent` from `ident(name, allowed)`. Row shapes are
readonly snake_case interfaces `<Name>Row` in `persistence/<name>.rows.ts`, each beside its guard
(`is<Name>Row: (value: unknown) => value is <Name>Row = rowShape({ ... })`), and a statement's rows are read as
`returnedRows(await manager.query(SQL, [params]), is<Name>Row)`, never typed by a cast or a `query<T>` argument. No SQL
literal elsewhere, no query builder, no `+` or template building a `.query` string.

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

Enforced by: lite `no-raw-sql` (R334) and `no-interpolated-sql` (R68); full `sql-text-only`, `no-query-builder`, `no-interpolated-sql` (R36, R68).

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
BE-PERSISTENCE-4) or `returnedRows(await entityManager.query(SQL, [params]), isRow)` (full). No `getRepository`, `@InjectRepository`, `Repository<T>`, repository
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

## BE-PERSISTENCE-9 A capability touches only its own tables, and every list is bounded

The capability that owns a table (BE-PERSISTENCE-3) is the only one that writes or reads it, by a statement or through its
entity. Another capability reads that data through the owner's read service, a method of the owner's domain service that
takes the caller's manager when the read must share its transaction (BE-PERSISTENCE-10), or through a projection the reader
owns (BE-PROJECTIONS-1); never by a statement, a join or an entity call on the owner's table. A multi-row `SELECT` carries
`LIMIT` (a literal bound or a clamped parameter) unless it filters on a unique key or only aggregates; bounds are the
`platform/database` constants. A read never runs once per loop element: read the keys at once (`id = ANY($2::uuid[])`)
and look them up.

Why: a read of another owner's table couples the reader to a schema it does not review, so the owner can no longer change
it alone; a write breaks ownership silently; an unbounded read turns a growing table into an outage.

Enforced by: `sql-owner` (R86) refuses a statement that writes another capability's table or reads a table of another
context; `query-needs-limit`, `no-query-in-loop` (R69, R77). A same-context read of another capability's table, by a
statement or an entity call, is held by review.

## BE-PERSISTENCE-10 The domain service opens the transaction and hands the manager down

The service opens `this.entityManager.transaction(async (manager) => ...)` and uses only `manager` inside. A
collaborating method that must join a caller's transaction takes the manager as its last parameter, defaulting to the
injected one (`manager: EntityManager = this.entityManager`), or takes a required `tx: EntityManager` when it must never
run alone (a queue producer). Row locks are `FOR UPDATE` in a `.sql.ts`. Handlers neither inject a manager nor open a
transaction, and no transaction service or wrapper exists.

Why: one transaction identity per scenario makes atomicity checkable.

```ts
return this.entityManager.transaction(async (manager) => {
    const [row] = returnedRows(await manager.query(INSERT_GENERATION, [workspaceId, kind, input]), isInsertedRow)
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
