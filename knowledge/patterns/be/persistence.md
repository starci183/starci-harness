---
slots: [be.persistence]
---
# Persistence and migrations

Decides who owns a table, how its schema changes and which process applies the change, how the database is reached and how
transactions, the outbox and bounded contexts are drawn, plus the hosted-Postgres access boundary. A connection is a bounded
context: one owning service, tables read and written only by that context, data exchanged with other contexts only through events.
Event contracts between services are services.md (BE-PERSISTENCE-15).

## BE-PERSISTENCE-1 Migrations are the only schema authority
`synchronize` is the literal `false` everywhere, e2e included, and is never read from the environment. No runtime DDL: no
`synchronize()`, no `migrationsRun`, no `CREATE`/`ALTER`/`DROP TABLE` string outside `persistence/migrations/**`, and no glob that
discovers entities or migrations. The test world runs the real migrations over the cli's connection list, which is the evidence
they are right.

Why: when an ORM diffs the schema at boot, the live schema is whatever the entity graph implies that day, migrations never run, and
an enum change can crash a boot.

Enforced by: R34 BE_SCHEMA_AUTHORITY.

## BE-PERSISTENCE-2 The cli migrate command is the only migration runner
Migrations run only through `cli migrate run`, once per connection, before any api or worker process starts (a deploy runs the cli
image as an init job to completion), and through the test world over the same connection list (`cli.options.ts`). The cli app
composes every declared connection with its entities and migrations and builds each `DataSource` from the same `<conn>.config.ts`
the owning app uses. Api and worker apps never migrate or seed. Seed data never sits in a migration; it is a sub-command of the
`seed` group.

Why: two processes racing to migrate corrupt a schema, a migration inside a module cannot be scheduled or retried on its own, and
one list shared with the test world makes the tested schema the deployed one.

Enforced by: R34 BE_SCHEMA_AUTHORITY, R147 BE_CLI_REQUIRED, R174 BE_CONTEXT_OWNER.

## BE-PERSISTENCE-3 Entities and migrations belong to the capability that owns the table
Entities and migrations sit in `persistence/{entities,migrations}/` of the owning capability (`domain/<c>/`, `projections/<name>/`,
or `platform/<c>/` for technical tables such as outbox, inbox and jobs), within the slot's closed `allows`; no `persistence/index.ts`,
no `*.repository.ts`. `persistence/connection.ts` declares the `<c>Entities` and `<c>Migrations` arrays, the only two names the
owner's `index.ts` re-exports, and the apps concatenate them per connection into `DatabaseModule.register`. A capability registers on
exactly one declared connection (only `perConnection` platform capabilities register on several, BE-PERSISTENCE-14), and every
`Inject<Conn>EntityManager` inside it names that connection. An entity is `@Entity("<plural_snake>")`; every `@Column` has an
explicit `name` and `type`, timestamps are `timestamptz`, enums are `varchar` with a `CHECK`, and there is no `eager`, `lazy` or
`cascade`; an entity imports no GraphQL or validation decorator. A migration is `<epochMs13>-<kebab-name>.ts`, class
`<PascalName><epochMs13>` with `name` equal to the class name, hand-written SQL through `queryRunner.query`, a `down()` that reverses
`up()`, no seed data and no unit spec.

Why: schema ownership by capability keeps platform independent of domain types and gives every table one reviewer; the ORM reads
the 13-digit suffix from the class name.

Enforced by: R35 BE_SCHEMA_OWNER, R37 BE_ENTITY_IN_CONTRACT, R74 BE_MIGRATION_REVERSIBLE, R83 BE_UNNAMED_DATA_ACCESS.

## BE-PERSISTENCE-4 Raw SQL is a SqlText constant in the owner's persistence folder
SQL text is a constant (or a function returning one) built with the `sql` tag of `platform/database` in
`persistence/<name>.sql.ts`; the tag returns the branded `SqlText`. `.query()` takes a `SqlText` and a parameter array; values are
numbered parameters, and a dynamic identifier is a `SqlIdent` from `ident(name, allowed)`, the only substitution the tag accepts.
Row shapes are `interface <Name>Row` with `to<Name>(row)` mappers in `<name>.rows.ts`. No SQL literal elsewhere, no QueryBuilder,
no DDL outside migrations.

Why: SQL scattered through services cannot be reviewed as a data boundary; a constant with numbered parameters can be parsed,
reviewed and never concatenated.

Enforced by: R36 BE_SQL_OUTSIDE_PERSISTENCE, R68 BE_SQL_INTERPOLATED.

## BE-PERSISTENCE-5 Durable effects go through the outbox, written by a domain service in its transaction
When a database change must lead to a message, event or job, the domain service writes the outbox inside the same transaction,
passing that transaction's manager: `eventBus.publish(event, tx, correlationId)` (BE-EVENT-BUS-3) or a queue producer's
`enqueueX(payload, tx, correlationId)` (BE-QUEUES-1). Only a domain service writes the outbox. The relay of the owning platform
capability hands committed rows on with bounded backoff and an effect identity; consumers dedupe through the inbox
(BE-IDEMPOTENCY-1). A publish acknowledgement and a consumed business result are different facts; an outbox alone is not
exactly-once processing. Outbox tables live in the platform capability that owns them.

Why: the row commits with the change, so a rolled-back change never emits and a committed one is never lost; publishing straight
to a broker in a request proves no durable delivery.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R154 BE_QUEUE_PRODUCER_SHAPE, R46 BE_BACKGROUND_UNOWNED.

## BE-PERSISTENCE-6 No transaction spans an external call
A transaction callback never calls an HTTP client, an integration client, a message publisher or any receiver typed from
`integrations/**` or `HttpClient`; receivers are judged by declared type. The transaction commits first and the call follows with
the values it returned, or, when the effect must happen exactly once with the write, an outbox row is written inside it
(BE-PERSISTENCE-5).

Why: a transaction held open across an external call either fails after a partial commit or rolls back a success with no way
back; committing first or writing an outbox row makes the change durable whatever the outside world does.

Enforced by: R82 BE_TRANSACTION_EXTERNAL_CALL.

## BE-PERSISTENCE-7 The database is reached through the named shared EntityManager
Data access is `this.entityManager.<op>(Entity, ...)` on the injected shared manager, or `manager.<op>` inside a transaction
callback, with the entity passed by class. Not used: `getRepository`, `@InjectRepository`, `Repository<T>`, `forFeature`, custom
repository or store classes and ports, `createQueryBuilder`, `ModuleRef.get`, an injected `DataSource` or `QueryRunner` outside
`platform/database` and the cli. A manager is injected only in domain services and in platform or projection capabilities that own
a `persistence/`; never in transport, integrations or apps.

Why: a repository handle is bound to one entity and cannot carry a transaction into a second table, and a DataSource used for
queries bypasses the named connection.

Enforced by: R83 BE_UNNAMED_DATA_ACCESS, R85 BE_RAW_INJECT.

## BE-PERSISTENCE-8 One physical database is one connection and one injector
`sides.be.connections` lists every bounded context as `{ name, envPrefix, owner, isolation }`: the name is the logical database
(never the engine), `owner` the one app that composes it, `isolation` `database` or `schema` (its own `<PREFIX>_SCHEMA`; moving
from schema to database is an env change only, and every cross-context rule holds in both). Per connection exactly three files
exist in `platform/database`: `<conn>.connection.ts`, `<conn>.config.ts` (reading only `<ENVPREFIX>_*` keys) and
`<conn>.decorators.ts` (`Inject<Conn>EntityManager` over `getEntityManagerToken(<CONN>_CONNECTION)`). No other file declares a
connection, opens a data source or calls the framework's entity-manager injectors, except the cli. No capability-specific
injector, no second connection name onto an existing database, and two connections never resolve to the same database unless both
are schema contexts with different schemas.

Why: a second pool onto the same database, or an injector named after a feature, splits transactions and hides which database a
service really queries.

Enforced by: R84 BE_CONNECTION_DUPLICATE, R83 BE_UNNAMED_DATA_ACCESS.

## BE-PERSISTENCE-9 SQL touches only its own context's tables, and every multi-row read is bounded
A `SqlText` writes only its own capability's tables and reads only its own context's tables (its capability's or those of a
same-context capability its owner may import); a cross-context JOIN or subquery is refused, checked by parsing the SQL. Every
multi-row read is bounded: `find`, `findBy` and `findAndCount` carry `take`; a `SELECT` carries `LIMIT` unless it filters on a
primary or unique key, has no `FROM`, or projects only ungrouped aggregates. Bounds are the `platform/database` constants (client
page, list and batch sizes). A read never runs once per loop element: keys are read once (`WHERE id = ANY($1)`) and looked up per
element. Receivers are identified by type.

Why: a statement that writes another owner's table breaks ownership silently, and an unbounded read turns a growing table into an
outage.

- When a list needs a name owned by another context → read the projection or a local copy filled by that context's events; never
  JOIN its table.

Enforced by: R86 BE_SQL_TABLE_OWNER, R69 BE_QUERY_UNBOUNDED, R77 BE_QUERY_IN_LOOP.

## BE-PERSISTENCE-10 The domain service opens the transaction and hands the manager down
The domain service opens `this.entityManager.transaction(async (manager) => { ... })`, with an explicit isolation level only when it
is not READ COMMITTED, and uses only `manager` inside (a write through the injected outer manager commits outside the
transaction). The handler neither injects a manager nor opens a transaction (BE-CQRS-3); no transaction service or wrapper exists.
A collaborating method that writes in the same context takes `manager: EntityManager` as a required field of its params; a read uses
the injected manager unless handed one. Row locks are `lock: { mode: "pessimistic_write" }` or `FOR UPDATE` in a `.sql.ts`;
cross-replica mutual exclusion is `InjectAdvisoryLock()`; `createQueryRunner` appears only in `platform/database`. One connection is
never substituted for another.

Why: one transaction identity per use makes atomicity checkable.

- `async open(params: { manager: EntityManager; buyerId: string; offerId: string; at: Date }): Promise<Outcome<Purchase, PurchaseErrorCode>>`

Enforced by: R83 BE_UNNAMED_DATA_ACCESS, R82 BE_TRANSACTION_EXTERNAL_CALL, R87 BE_CQRS_SHAPE.

## BE-PERSISTENCE-11 A connection is a bounded context with one owning app
Every connection has an `owner` (an api or worker app) and an `isolation`. An app registers only the connections it owns and imports
no domain or projection capability of a context it does not own; a monolith's one app owns every context, and the cli app composes
every connection so `cli migrate` reaches each. Several contexts may share one Postgres server, each still a separate database or
schema.

Why: a context two services write is one shared schema with two owners; one owner keeps tables, migrations and events under one
reviewer and lets the context move to its own database by changing only the env.

Enforced by: R174 BE_CONTEXT_OWNER, R84 BE_CONNECTION_DUPLICATE.

## BE-PERSISTENCE-12 Contexts are coupled only by events
No relation, foreign key, SQL or import crosses a context: no entity relation to another context's entity, no `REFERENCES` to its
table, no import of its entities, services or SQL by a domain, projection or reactor file. The other context's id is a plain
column. Its facts arrive as events: a reactor keeps a local copy in the receiving context, or a projection keeps a read model on
the receiving context's connection, and joins happen on those local tables.

Why: a relation, foreign key or join makes two contexts one database in practice, so neither can migrate, scale or move alone;
copies and projections are fed by contract events and eventually consistent by design.

Enforced by: R175 BE_CONTEXT_COUPLING, R86 BE_SQL_TABLE_OWNER.

## BE-PERSISTENCE-13 One transaction touches one context's connection
Inside a transaction on connection C no manager of another connection is used and no capability of another context is called. Work
across contexts is a saga (saga.md): one transaction per context, each writing its outbox row with its change, linked by events with
a compensation per step.

Why: a transaction cannot span two databases, and a cross-context transaction on one server silently becomes impossible the day a
context moves.

Enforced by: R176 BE_CONTEXT_TRANSACTION.

## BE-PERSISTENCE-14 Per-connection platform tables and projection placement
Projections keep their tables on their owning context's connection. The outbox and inbox tables exist on every connection that
publishes or consumes and the job table on every connection that runs jobs: those platform capabilities are the manifest's
`perConnection` list and register their entities and migrations on every connection whose manager they are given. No other
capability registers on more than one connection. The relay polls every connection that registers the outbox.

Why: the outbox row is written in the same transaction as the change, so it must live in that change's database; a connection
without the table fails at the first publish.

Enforced by: R178 BE_CONTEXT_PLATFORM_TABLES, R35 BE_SCHEMA_OWNER.

## BE-PERSISTENCE-16 UPDATE or DELETE with RETURNING is wrapped in a SELECT
The shared manager's `query` returns a bare `UPDATE ... RETURNING` or `DELETE ... RETURNING` as `[rows, affectedCount]`, not rows
(an `INSERT ... RETURNING` returns rows). Such a statement is written as `WITH changed AS (UPDATE ... RETURNING ...) SELECT ... FROM
changed`, and an e2e or integration spec runs it on the real database.

Why: a unit spec that stubs the result cannot see the shape; a caller reading the tuple as rows silently processes nothing.

Enforced by: R181 BE_SQL_RETURNING_SHAPE.

## BE-PERSISTENCE-17 Hosted-Postgres product data is reached through the back end
Where the app uses a hosted Postgres with a browser data API, the front end uses it for auth only and reaches product data through
the back end. On exposed schemas the authenticated browser role gets no table or sequence privileges and no data policies;
anonymous access is at most SELECT on a table with a policy named `*_public_read`. A deliberate direct-access table is listed in
`hfs.json` `supabase.directAccess`, and only such a table may join the realtime publication. Default privileges never reopen
browser access. The back end reads and writes through the shared EntityManager with its application role, never a data client.

Why: a browser can call the data API with its public key and user token even when application code never imports it; closed grants
keep the back-end authorization boundary.

Enforced by: R217 FE_SUPABASE_CLIENT_OWNER, R254 DB_BE_ONLY_ACCESS.

## BE-PERSISTENCE-18 The application database role has explicit privileges and forced RLS
The back-end connection uses the role `hfs.json` `supabase.appRole` declares: LOGIN, NOINHERIT, NOBYPASSRLS and no administrative
attribute, granted only the named operations and objects it needs, never ALL. Tables it owns enable and force row level security;
an exemption from forcing names the table and a reason in `supabase.forceRlsExemptions` and keeps the ordinary RLS obligation. Its
password is provisioned through sealed custody, never migration SQL.

Why: a privileged connection or an owner's RLS bypass makes declared policies ineffective.

Enforced by: R214 DB_RLS_REQUIRED, R255 DB_APP_ROLE.

## BE-PERSISTENCE-19 Policies, views, definers and storage keep the principal boundary
A browser-role policy proves a principal predicate (`auth.uid()`, JWT claims or a helper reading them); constants, `IS NOT NULL` and
self-equality prove nothing. An exposed view uses `security_invoker = true` or has access revoked from the browser roles; an exposed
materialized view is revoked. Disabling RLS or moving a table into an exposed schema keeps the RLS obligation. A `SECURITY DEFINER`
declaration, `ALTER FUNCTION` included, pins `search_path` and safe SQL, and exposed functions end with EXECUTE revoked from public
and the browser roles. A storage policy constrains the first path segment to the principal unless it selects a bucket ending
`_public`.

Why: a view, definer, schema move or broad storage policy can expose rows while the base table looks protected.

- When a direct-access table has a user policy → `owner_id = auth.uid()`, never `owner_id IS NOT NULL`.

Enforced by: R214 DB_RLS_REQUIRED, R215 DB_DEFINER_SAFE, R256 DB_POLICY_TAUTOLOGY.

## BE-PERSISTENCE-20 A migration archive is immutable history with one explicit baseline
An archived migration chain has exactly one active baseline whose header names the last archived stamp; the baseline has a later
valid stamp or an explicit restamp. Archived migrations never change; an active migration moves into the archive byte for byte only
in the diff that adds its replacement baseline, and nothing new is added to the archive directly. The `starci app db` baseline,
restamp and plan verbs are read-only unless `--apply` is explicit, and an owner applies a reviewed plan. Two active migrations
sharing a stamp are separated with `restamp`, which repairs the migration history only when the moved file is the one that ran and
refuses when the history cannot be read.

Why: an archive without a replacement baseline lets a fresh database and the deployed ledger describe different schemas.

Enforced by: R213 DB_MIGRATION_SHAPE, R257 DB_BASELINE_SHAPE.

## BE-PERSISTENCE-21 Hosted-Postgres configuration keeps data and secrets bounded
Extensions follow `ruleParams.db.extensions`; API schemas come from `ruleParams.db.apiSchemas`, never queue schemas; in lite the data
API is off or exposes no schema without an explicit `*_public_read` policy. Migration SQL never writes vault secrets or role
passwords. Seed paths resolve to tracked SQL files with synthetic identities only. Anonymous sign-ins stay off unless declared, edge
runtime is off, enabled storage declares an upload limit, the database major version equals its pin, and config credentials are
environment references. Destructive DDL lives only in `*_contract_*` migrations, after code stops referencing the target.

Why: configuration can reopen the data API or add execution and secret stores outside the declared application; a separate
contract migration makes schema removal reviewable.

- When a column becomes obsolete → deploy code that stops using it first, then drop it in a later contract migration.

Enforced by: R216 DB_CONFIG_POLICY, R259 DB_EXTENSION_ALLOWED.
