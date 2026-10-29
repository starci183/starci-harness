# Lite: what differs

Only the differences of a lite app from the shared project model ([README.md](README.md)); everything not named here
is the same in both editions, including the code structure, the front-end standard, the queue (BullMQ on Redis, ruling `lite-queue-bullmq`) and
the three realtime doors. How the edition is chosen is PROJECT-1 in [README.md](README.md) (R212 in
[hfs/rules.yaml](../hfs/rules.yaml)). Each line names the owner of the fact; the slot, rule or ruling is the authority, not this page.

## Shape of production

- One stateless, horizontally scaled instance type on its own PostgreSQL (the `db` service of its stack), plus one
  minimal instance of each declared backing service. Owner: ruling `R212/case-10` in [decisions/rulings.yaml](../decisions/rulings.yaml).
- Every replica serves any request; shared state lives in Postgres or the declared Redis. Owner: ruling
  `R212/case-9`, [code/be/realtime.md](../code/be/realtime.md).

## Backing services

- PostgreSQL is self-hosted: the `db` service in Docker in dev and on the Swarm stack in production, migrated by
  `starci app db migrate --url-env <NAME>`. Its image is the managed `db/Dockerfile`: the Docker Official `postgres` image
  pinned by digest plus pgvector from PGDG, so its extensions are pgvector and the image's contrib set (pgcrypto, pg_trgm,
  unaccent, uuid-ossp, btree_gist), with no pg_cron, pg_net or supabase_vault; the local container (`npm run
  db:create`), the drift scratch database and the release image all build that file. An allowed extension is created
  `with schema extensions`, the schema the managed `db/bootstrap.sql` creates with USAGE for its roles, and the app role's
  search_path is `public, extensions`, so a migration may name `extensions.vector` or set its function's search_path to `''`. Identity is the app's own Passport
  integration and storage the S3-compatible MinIO of the host. Owners: slots `app.db*` and `ruleParams.db.extensions` in
  [hfs/slots.yaml](../hfs/slots.yaml); rulings `lite-self-hosted-postgres-passport-minio` and
  `lite-official-postgres-image`; the `postgres` image pin in [stack/pins.yaml](../stack/pins.yaml).
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
- Open: pgmq topics need the pgmq extension, which the db image does not carry (ruling `lite-official-postgres-image`),
  so until the owner rules between a delivery on BullMQ, on the app's own tables or in process only, a lite event bus
  delivers in process.
- A recurring task is a tick of `platform/jobs`, fired by `@nestjs/schedule` in the back end and enqueued once per
  minute for the whole deployment. Owners: R335; [code/be/jobs.md](../code/be/jobs.md) BE-JOBS-6.
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
`sides.<side>.reads`, and list the app's database functions, schema-qualified (`public.job_claim`), in `sides.be.dbFunctions`; run `npx starci app sync --write`
(it renders `db/bootstrap.sql`, the db scripts, codegen and CI, and removes a leftover `supabase/types/`); restore the
data with `starci app db migrate --url-env DATABASE_URL --execute` on an empty database after `pg_restore` of the hosted
dump, which keeps the `supabase_migrations.schema_migrations` history the migrate verb reads. On hfs 4.11 the db service
moves to the official image: `npx starci app sync --write` writes `db/Dockerfile` and the db scripts, the stack's db
component and service take the app's own `db` image (`deploy.images.db: {app: db}`, pushed with the release), and a
migration that needs what the Supabase image carried is rewritten in a new forward migration: a `pg_net` call becomes an
outbound call of the back end through its integration (BE-INFRA-2), a `pgmq` queue becomes a BullMQ queue of
`platform/queue` (an event-bus topic stays open, above), a `pg_cron` job becomes a `platform/jobs` tick (BE-JOBS-6),
and the `supabase_realtime` publication is dropped; the `extensions` schema stays. Owners: R332; rulings
`lite-self-hosted-postgres-passport-minio` and `lite-official-postgres-image`.

An app whose production starts on an EMPTY database (no hosted data to restore) need not rewrite its chain: it squashes it.
Apply the whole active chain to a rehearsal database with `starci app db migrate`, so its history records it, then run
`starci app db baseline --squash --url-env <NAME> --stamp <ts14> --seed-tables <reference tables>` (add `--drop-extension`
for each extension the db image lacks beyond the default `pg_net,pg_cron`, and `--drop-pgmq-queue` for queues whose work
moved to BullMQ), read its report, and repeat with `--apply`. The verb writes the one baseline, the marked role section of
`db/bootstrap.sql` and `db/seed.sql`, archives the chain, and refuses unless the replay on the app's db image equals the
rehearsal minus what it drops; nobody writes a migration after it by hand. Production then takes `starci app db migrate` on
its empty database and the seed. The verb's flags and outputs are the hfs README's `db baseline --squash`.

## Read with

[README.md](README.md), [stacks.md](stacks.md), [full.md](full.md).
