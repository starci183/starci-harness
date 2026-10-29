# Lite: what differs

Only the differences of a lite app from the shared project model ([README.md](README.md)); everything not named here
is the same in both editions, including the code structure, the front-end standard, the queue (BullMQ on Redis) and
the three realtime doors. How the edition is chosen is PROJECT-1 in [README.md](README.md) (R212 in
[hfs/rules.yaml](../hfs/rules.yaml)). Each line names the owner of the fact; the slot, rule or ruling is the authority, not this page.

## Shape of production

- One stateless, horizontally scaled instance type on its own PostgreSQL (the `db` service of its stack), plus one
  minimal instance of each declared backing service. Owner: ruling `R212/case-10` in [decisions/rulings.yaml](../decisions/rulings.yaml).
- Every replica serves any request; shared state lives in Postgres or the declared Redis. Owner: ruling
  `R212/case-9`, [code/be/realtime.md](../code/be/realtime.md).

## Backing services

- PostgreSQL is self-hosted: the `db` service (image supabase/postgres, for pg_cron, pg_net, pgmq, vector, unaccent and
  pgcrypto) in Docker in dev and on the Swarm stack in production, migrated by `starci app db migrate --url-env <NAME>`.
  Identity is the app's own Passport integration and storage the S3-compatible MinIO of the host. Owners: slots
  `app.db*`, `be.integrations.passport`, `be.integrations.object-storage` in [hfs/slots.yaml](../hfs/slots.yaml); ruling
  `lite-self-hosted-postgres-passport-minio`; the `supabase/postgres` image pin in [stack/pins.yaml](../stack/pins.yaml).
- Redis is the only declarable backing service (`sides.be.backing`), run durably; vectors use pgvector in the db service,
  so no Qdrant. Owners: `ruleParams.be.backing` in [hfs/slots.yaml](../hfs/slots.yaml); ruling `lite-vector-is-pgvector`;
  R276.
- No database but the db service, no broker or vector store, and no Kafka or Qdrant client. Owners: R276;
  `ruleParams.be.lite.infraOwners` in [hfs/slots.yaml](../hfs/slots.yaml).
- A sidecar keeps its own storage on a declared volume. Owner: R276.

## Patterns

- Schema authority is `db/migrations`; TypeORM entities only map those tables and domain code writes no raw SQL.
  Owners: `ruleParams.be.lite.schemaAuthority` and slot `be.persistence`; R213 to R215, R255 to R259, R332, R334;
  ruling `lite-persistence-typeorm-entities`; [code/be/persistence.md](../code/be/persistence.md).
- Identity is the app's own: Google OAuth and email and password through Passport, its own access tokens verified
  against its own JWKS, a rotating httpOnly refresh cookie, and a front end that holds no credential. Owners: R328 to
  R330; [code/be/api-auth.md](../code/be/api-auth.md); [code/fe/transport.md](../code/fe/transport.md) FE-AUTH.
- The event bus is the outbox on pgmq topics or in-process delivery, not Kafka. Owners: slot `be.platform.event-bus`;
  [code/be/event-bus.md](../code/be/event-bus.md) BE-EVENT-BUS-3.
- Jobs and projections keep their tables in db migrations. Owners: slots `be.platform.jobs`, `be.projections`.
- Reactor, saga and projection: open. The pattern topics ([saga.md](../code/be/saga.md),
  [projections.md](../code/be/projections.md), [event-bus.md](../code/be/event-bus.md)) describe each one
  running in lite, while [README.md](../../README.md) (verb groups; `starci explain` lists what is built) gives `app add reactor|saga|projection` to full
  apps only. The owner's ruling decides which holds.

## Infrastructure the project runs

- `.starcistacks/` admits only the Swarm infra tree for an environment, no compose, k8s or terraform tree. Owner: the
  `lite` block of slot `app.starcistacks`; R10, R276. The local dependencies are the db container (`npm run db:create`,
  `db:start`, `db:stop`) and the declared Redis.
- The lite verbs are `app db new|plan|migrate|dump|post-cutover`, `stack deploy|verify|rollback`, `docker build|up|down`.
  Owner: [README.md](../../README.md) (verb groups; `starci explain` lists what is built).

## Deploy targets

- The back end deploys to the Swarm stack; the database deploys through its own workflow. Owners: slots
  `app.ci-stack-deploy`, `app.ci-db`, `app.ci-images`.
- A front end may be hosted without its own image; back-end images stay required. Owner: slot `repo.app-image`.

## What CI runs

- No e2e world, no browser journeys and no e2e workflow. Owners: slots `app.ci-e2e`, `app.browser`,
  `app.browser-config`, `be.tests.e2e` (all forbidden under lite); ruling `lite-contract-specs`.
- Boot is proved by compiling the real AppModule graph with doubles, and each async pattern by its lite proof lane.
  Owners: R272, R284; [code/be/test.md](../code/be/test.md) BE-TEST-12.
- Integration specs run against the local db service without containers or toxiproxy; contract specs are
  optional. Owners: slots `be.tests.integration`, `be.tests.contract`.
- CI lints the db migrations; no database type is generated. Owner: slot `app.ci`.
- Open: the `app` profile's CI tier in [policy/quality.yaml](../../policy/quality.yaml) lists `e2e` for every app,
  which a lite app cannot have.

## Work and custody

- `.starciwork/` admits only `.gitignore`, an optional `workspace.yaml` and brand records. Owner: ruling
  `R212/case-4`; slot `app.starciwork`.
- No secret material outside the sealed members. Owner: R220; custody itself is [stacks.md](stacks.md).

## Moving an app off Supabase

An app scaffolded on the earlier lite edition moves in one commit on hfs 4.10: `git mv supabase/migrations db/migrations`
(an `_archive/` folder becomes `db/migrations/archive/`), `git mv supabase/seed.sql db/seed.sql`, then delete
`supabase/config.toml`, `supabase/types/` and the rest of `supabase/`; in hfs.json replace the `supabase` block with an
optional `db` block (`forceRls`, `appRole`), set every connection's `provider` to `postgres`, drop `supabase/types/` from
`sides.<side>.reads`, and list the app's database functions in `sides.be.dbFunctions`; run `npx starci app sync --write`
(it renders `db/bootstrap.sql`, the db scripts, codegen and CI, and removes a leftover `supabase/types/`); restore the
data with `starci app db migrate --url-env DATABASE_URL --execute` on an empty database after `pg_restore` of the hosted
dump, which keeps the `supabase_migrations.schema_migrations` history the migrate verb reads. Owners: R332; ruling
`lite-self-hosted-postgres-passport-minio`.

## Read with

[README.md](README.md), [stacks.md](stacks.md), [full.md](full.md).
