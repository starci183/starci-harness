# Lite: what differs

Only the differences of a lite app from the shared project model ([README.md](README.md)); everything not named here
is the same in both editions, including the code structure, the front-end standard, the queue (BullMQ on Redis) and
the three realtime doors. How the edition is chosen is PROJECT-1 in [README.md](README.md) (R212 in
[hfs/rules.yaml](../hfs/rules.yaml)). Each line names the owner of the fact; the slot or rule is the authority, not this page.

## Shape of production

- One stateless, horizontally scaled instance type on its own PostgreSQL (the `db` service of its stack), plus one
  minimal instance of each declared backing service. Owner: R212 in [hfs/rules.yaml](../hfs/rules.yaml).
- Every replica serves any request; shared state lives in Postgres or the declared Redis. Owners: R212,
  [code/be/realtime.md](../code/be/realtime.md).

## Backing services

- PostgreSQL is self-hosted: the `db` service in Docker in dev and on the Swarm stack in production, migrated by
  `starci app db migrate --db-url-env <NAME>`. Its image is the managed `.starcistacks/images/db/Dockerfile`: the Docker Official `postgres` image
  pinned by digest plus pgvector from PGDG and pgmq from its pinned release (verified by sha256), so its extensions are
  pgvector, pgmq and the image's contrib set (pgcrypto, pg_trgm, unaccent, uuid-ossp, btree_gist), with no pg_cron, pg_net
  or supabase_vault; the dev container (`starci app stack up --env dev`), the drift scratch database and the release image all build
  that file. An allowed extension is created `with schema extensions`, the schema the managed `db/bootstrap.sql` creates
  with USAGE for its roles, and the app role's search_path is `public, extensions`, so a migration may name
  `extensions.vector` or set its function's search_path to `''`; pgmq is the one exception, since its control file fixes
  its own schema `pgmq` (`create extension pgmq`, never `with schema extensions`). Identity is the app's own, the package `@starci/auth` composed in the Passport
  integration, and storage an S3-compatible store, in development the dev stack's own `storage` service (the StarCi MinIO), reached through the
  package `@starci/object-storage` composed in the object-storage integration, whose bucket the api's readiness creates when it is missing.
  Owners: slots `app.db*` and `ruleParams.db.extensions` in [hfs/slots.yaml](../hfs/slots.yaml); the `postgres` and `minio` image pins in
  [stack/pins.yaml](../stack/pins.yaml); the dev services and their ports in [stacks.md](stacks.md) PROJECT-STACKS-10.
- Redis is the only declarable backing service (`sides.be.backing`), run durably; vectors use pgvector in the db service,
  so no Qdrant. Owners: `ruleParams.be.backing` in [hfs/slots.yaml](../hfs/slots.yaml);
  R276.
- No database but the db service, no broker or vector store, and no Kafka or Qdrant client. Owners: R276;
  `ruleParams.be.lite.infraOwners` in [hfs/slots.yaml](../hfs/slots.yaml).
- A sidecar keeps its own storage on a declared volume. Owner: R276.

## Patterns

- Schema authority is `db/migrations`; TypeORM entities map those tables and lite TypeScript holds no SQL text outside the test
  world: entities, or a listed function through `callDbFunction`; the world keeps raw SQL for probes only.
  Owners: `ruleParams.be.lite.schemaAuthority` and slot `be.persistence`; R213 to R215, R255 to R259, R332, R334;
  [code/be/persistence.md](../code/be/persistence.md).
- Identity is the app's own, shipped as the package `@starci/auth` (its `./server` entry): Google OAuth (and any further sign-in provider
  the module lists, GitHub among them) and email and password through Passport, its
  own EdDSA access tokens verified against its own JWKS, a rotating httpOnly refresh cookie, and a front end that holds no
  credential. Owners: the package `packages/auth`, slots `be.integrations.passport`, `be.identity.sign-in`, `be.feature.auth` and `fe.modules.auth.client`. Owners: R328 to
  R330; [code/be/api-auth.md](../code/be/api-auth.md); [code/fe/transport.md](../code/fe/transport.md) FE-AUTH.
- The event bus is pgmq, not Kafka: a publish sends the event to its pgmq topic in the publisher's transaction, and each
  consumer group reads its own queue with a visibility timeout; jobs stay on BullMQ. Owners:
  slot `be.platform.event-bus`; R258; [code/be/event-bus.md](../code/be/event-bus.md)
  BE-EVENT-BUS-3, -4.
- A recurring task is a tick of `platform/jobs`, fired by `@nestjs/schedule` in the back end and enqueued once per
  minute for the whole deployment. Owners: R335; [code/be/jobs.md](../code/be/jobs.md) BE-JOBS-6.
- Jobs and projections keep their tables in db migrations. Owners: slots `be.platform.jobs`, `be.projections`.
- A reactor is the same as in full: `features/reactors/<reactor>/transport/message/<event>.consumer.ts`, its message module
  and an `application/` of plain CQRS, the consumer dispatching one command and the reactor's own domain service doing the
  work; only the transport is the pgmq bus. Owners: R153;
  [code/be/reactors.md](../code/be/reactors.md) BE-REACTORS-1. `app add reactor` still carries only the full adapter's
  templates, so a lite reactor is written by hand on that shape until a lite template ships.
- Saga and projection: open ([harness/questions.md](../harness/questions.md) 12). The pattern topics
  ([saga.md](../code/be/saga.md), [projections.md](../code/be/projections.md)) describe each one running in lite, while
  [README.md](../../README.md) (verb groups; `starci explain` lists what is built) gives `app add saga|projection` to full
  apps only.

## Infrastructure the project runs

- `.starcistacks/` admits the Swarm infra tree for the production environment and the compose infra tree for the dev environment, no k8s or
  terraform tree. Owner: the `lite` block of slot `app.starcistacks`; R10, R276, R372. The dev environment is `docker-compose` with a `local`
  block, brought up by `starci app stack up --env dev --execute` (PROJECT-STACKS-6): the db container, the declared Redis and the other declared
  dependencies run from its compose file, the api and web natively. The `db:create`, `db:start` and `db:stop` scripts are not the way to start it.
- The lite verbs are `app db new|plan|migrate|dump|post-cutover`, `app secret init --env dev`, `stack prepare|doctor|up|status|logs|down|verify` for dev, `stack deploy|verify|rollback` for production, `docker build|up|down`.
  Owner: [README.md](../../README.md) (verb groups; `starci explain` lists what is built).

## Deploy targets

- The back end deploys to the Swarm stack; the database deploys through its own workflow. Owners: slots
  `app.ci-stack-deploy`, `app.ci-db`, `app.ci-images`.
- A front end may be hosted without its own image; back-end images stay required. Owner: slot `repo.app-image`.

## What CI runs

- No e2e world, no browser journeys and no e2e workflow. Owners: slots `app.ci-e2e`, `app.browser`,
  `app.browser-config`, `be.tests.e2e` (all forbidden under lite).
- Boot is proved by compiling the real AppModule graph with doubles, once a scan of the same graph found no provider ring,
  and each async pattern by its lite proof lane. Owners: R272, R401, R284; [code/be/test.md](../code/be/test.md) BE-TEST-12,
  [code/be/injection.md](../code/be/injection.md) BE-INJECTION-5.
- Integration specs run against the local db service without containers or toxiproxy; contract specs are
  optional. Owners: slots `be.tests.integration`, `be.tests.contract`.
- CI lints the db migrations; no database type is generated. Owner: slot `app.ci`.
- Open: the `app` profile's CI tier in [policy/quality.yaml](../../policy/quality.yaml) lists `e2e` for every app,
  which a lite app cannot have.

## Work and custody

- `.starciwork/` admits only `.gitignore`, an optional `workspace.yaml`, brand records and the product's concepts
  ([work.md](work.md) PROJECT-WORK-7). Owners: R212; slot `app.starciwork`.
- No secret material outside the sealed members. Owner: R220; custody itself is [stacks.md](stacks.md).

## Moving an app off Supabase

An app scaffolded on the earlier lite edition moves in one commit on hfs 4.10: `git mv supabase/migrations db/migrations`
(an `_archive/` folder becomes `db/migrations/archive/`), `git mv supabase/seed.sql db/seed.sql` and then `starci app codemod seeds-layout --execute` (PROJECT-STACKS-12 of [stacks.md](stacks.md)), then delete
`supabase/config.toml`, `supabase/types/` and the rest of `supabase/`; in hfs.json replace the `supabase` block with an
optional `db` block (`forceRls`, `appRole`), set every connection's `provider` to `postgres`, drop `supabase/types/` from
`sides.<side>.reads`, and list the app's database functions, schema-qualified (`public.job_claim`), in `sides.be.dbFunctions`; run `npx --no-install starci app sync --execute`
(it renders `db/bootstrap.sql`, the db scripts, codegen and CI, and removes a leftover `supabase/types/`); restore the
data with `starci app db migrate --db-url-env DATABASE_URL --execute` on an empty database after `pg_restore` of the hosted
dump, which keeps the `supabase_migrations.schema_migrations` history the migrate verb reads. On hfs 4.11 the db service
moves to the official image: `npx --no-install starci app sync --execute` writes `.starcistacks/images/db/Dockerfile` (it removes a `db/Dockerfile` an earlier sync wrote) and the db scripts, the stack's db
component and service take the app's own `db` image (`deploy.images.db: {app: db}`, pushed with the release), and a
migration that needs what the Supabase image carried is rewritten in a new forward migration: a `pg_net` call becomes an
outbound call of the back end through its integration (BE-INFRA-2), a `pgmq` queue becomes a BullMQ queue of
`platform/queue` (an event-bus topic stays on pgmq, above), a `pg_cron` job becomes a `platform/jobs` tick (BE-JOBS-6),
and the `supabase_realtime` publication is dropped; the `extensions` schema stays. Owner: R332.

An app whose production starts on an EMPTY database (no hosted data to restore) need not rewrite its chain: it squashes it.
Apply the whole active chain to a rehearsal database with `starci app db migrate`, so its history records it, then run
`starci app db baseline --squash --db-url-env <NAME> --stamp <ts14> --seed-tables <reference tables>` (add `--drop-extension`
for each extension the db image lacks beyond the default `pg_net,pg_cron`, and `--drop-pgmq-queue` for queues whose work
moved to BullMQ), read its report, and repeat with `--execute`. The verb writes the one baseline, the marked role section of
`db/bootstrap.sql` and the shared seed entry `reference` (`.starcistacks/seeds/sql/reference.sql`), archives the chain, and refuses unless the replay on the app's db image equals the
rehearsal minus what it drops; nobody writes a migration after it by hand. Production then takes `starci app db migrate` on
its empty database and the seed. The verb's flags and outputs are the hfs README's `db baseline --squash`.

## Resetting the chain to one baseline

An app whose environments hold no data worth keeping replaces its whole migration chain, archive included, by one
baseline (BE-PERSISTENCE-19 of [code/be/persistence.md](../code/be/persistence.md)). The owner confirms first that no
environment holds data to keep; then, in one branch:

1. **Declare it.** hfs.json `db.baselineReset: { baseline, ruling, date, reason }`: the baseline's path
   (`db/migrations/<ts14>_<name>.sql`), the id the app records the reset under, the day and why. The baseline file's
   header carries `-- starci:baseline-reset <ruling>`, and exactly one file carries it.
2. **Build the baseline by concatenating the active chain in stamp order**, each file's text whole and unchanged, then
   delete the older files and the archive. Never build it from a schema dump: a dump keeps tables and loses what the
   chain did besides, such as queues, scheduled jobs, grants, row-level-security policies and reference rows.
3. **Prove it on two scratch databases**: the old chain applied to one, the baseline to the other, both after
   `db/bootstrap.sql`, then compared object by object: tables and columns, partitions, indexes, constraints, functions,
   triggers, grants, row-level-security policies, queues, scheduled jobs and the reference rows. Any difference is a
   defect of the baseline, fixed in the baseline. The comparison is the app's own script: no harness verb runs it.
4. **Run the gates**: `starci app db drift`, the entity list against the new chain, then `starci app check --gate db`.
5. **A drop whose readers still exist is not in the baseline.** A destructive migration whose target code still reads
   stays outside `db/migrations`, as a pending file the app keeps and names in its concepts, and enters the chain with a
   stamp after the baseline once the last reader is gone (a `*_contract_*` migration, BE-PERSISTENCE-19).
6. **Every migration written after the cut is stamped after the baseline**, a branch cut before the reset included: it
   is restamped (`starci app db restamp`) when it rebases onto the baseline.
7. **Empty the databases that ran the old chain** before the next deploy: a database whose recorded history the new
   chain does not explain is refused (`STACK_DEPLOY_DB_FOREIGN_CHAIN`, [cicd.md](cicd.md)), and an empty one takes the
   first start.

Why: a chain that only ever ran on throwaway data costs every later replay and review its whole length, and one
baseline that equals it is cheaper only when the equality is proved rather than assumed. R213 and R257 accept the
removal of the older chain while the declared baseline is not yet on the base branch
(`packages/hfs/runtime/scripts/hfs/rules/database-reset.mts`); steps 2, 3 and 5 are held by review.

Known gap: `starci app db baseline --squash` does not serve this reset: it refuses a chain whose sources are untracked
or differ from the committed history, and it archives the old chain where the reset deletes it, so the baseline is
built by hand as step 2 says. Known gap: no slot names the pending file of step 5 and no check reads it. Known gap:
there is no verb that resets a local stack: the data volumes of a dev stack that ran the old chain are removed by hand
before `starci app stack up` builds it again.

## Read with

[README.md](README.md), [stacks.md](stacks.md), [full.md](full.md).
