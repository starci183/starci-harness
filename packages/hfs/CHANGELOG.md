# Changelog

## 4.11.7 - 2026-10-29

- Fixed: `starci app db baseline --squash` reaches a loopback source (`127.0.0.1`, `localhost`, `[::1]`, as the app's own dev database on `127.0.0.1:54322`) on a Linux Docker engine. The scratch container reached it only as `host.docker.internal`, which a Linux engine maps to its bridge gateway, where a port published on 127.0.0.1 refuses the connection; Docker Desktop alone forwarded it. `sourceTarget` (`runtime/scripts/hfs/db-squash.mjs`) now keeps the first route psql connects on: the scratch container through `host.docker.internal`, else a one-shot container of the same image on the host's network; when neither connects the verb refuses with each route's psql failure. Every client tool runs where its target's route says (`exec`, `targetRunner`).
- Changed: a failed history read of the squash source names the psql failure (password and URL withheld) instead of "database command failed; inspect psql privately".
- Changed: `starci app db plan` refuses a dynamic migration block naming every `EXECUTE` of every active migration as `<file>:<line>` under "dynamic migration blocks cannot prove database inventory", instead of the bare heading at the first one (`repositoryState`, `runtime/scripts/hfs/db-plan-verb.mjs`; the line is the DO body's opening quote plus the statement's body line).
- Changed: `starci app db baseline` passes the plan's refusal through (`cleanPlan`, `db-baseline-verb.mjs`) after "baseline requires a clean database plan with every migration already applied; the plan refused: ", and on drift names each inventory that differs with its missing, unexpected and changed counts, instead of the bare heading with the plan's output discarded.
- Spec: `src/hfs-db-squash.spec.mjs`: its source, published on 127.0.0.1 only, is the loopback route CI's Linux engine proves; a source no route reaches is refused. `src/hfs-database-baseline.spec.mjs`: two EXECUTEs in one block after a multi-byte comment and one in a second migration are named by file and line, with no database query; baseline's pass-through of a plan refusal and of a drift.

## 4.11.6 - 2026-10-29

- Added: the skeleton's `platform/http` takes `HttpOptions.trustedCa`, the PEM of one more certificate authority the outbound client trusts beside Node's bundled roots (never instead of them; verification stays on). `FetchHttpClient` builds one undici `Agent({ connect: { ca: [...rootCertificates, trustedCa] } })` for it and hands it to the global `fetch` as `dispatcher` on every request, closing it at module destroy; without the option it builds no pool and every request is sent exactly as before. `HTTP_OPTIONS` and `InjectHttpOptions` carry the options (`http.decorators.ts`), `parseHttpConfig` (`http.config.ts`) reads them from the optional `HTTP_TRUSTED_CA` (or `HTTP_TRUSTED_CA_FILE`), and the full skeleton's api app reads `http: parseHttpConfig(env)` into its options and registers `HttpModule.register({ isGlobal: true, ...options.http })`, so a test world passes its per-run fake CA (`w.fake.<name>.ca`) as `HTTP_TRUSTED_CA` in the environment it builds the app's options from.
- Added: `undici` 6.29.0 joins the starter dependencies of both editions (its one owner is `platform/http`, R90). Specs: `src/platform-http-trusted-ca.spec.mjs` (the skeleton client against a real HTTPS server signed by a per-run CA from test-world's `issueFakeTls`: refused without `trustedCa`, answered with it, refused under an unrelated CA, and the CA joins the bundled roots), and the skeleton's `fetch-http-client.client.spec.ts` (no dispatcher by default; one shared pool with the CA, closed at destroy).
- Changed: the bundled canon pins name hfs 4.11.6, @starci/test-world 1.3.1, eslint-canon-be 3.8.5, eslint-canon-fe 9.5.7 and the Grammar family 0.15.18, and pin `undici` 6.29.0 (owner `platform/http`).

## 4.11.5 - 2026-10-29

- Changed: `starci app secret set <env> <member> <KEY> [KEY ...]` seals every named key in one sops write, so no member is left half filled. On a terminal it prompts `<KEY>: ` for each key with masked input (`runtime/scripts/hfs/secret-prompt.mjs` `promptHidden`: one `*` per character, a paste in one chunk, backspace, Enter; Ctrl+C or end of input cancels with nothing written; an empty value is refused) instead of refusing "set reads a value from redirected stdin"; redirected stdin gives one key its whole text (a multi-line value kept) or several one `KEY=value` line each, every key once and no other; `--generate <bytes>` makes one value per key. `secretMain` is async and takes `prompt` and `hostIdentity` ports, which `main` passes through.
- Changed: the age identity is found by itself (`localAgeIdentity`, `secret-init.mjs`): SOPS_AGE_KEY or SOPS_AGE_KEY_FILE of the environment, else of the app's `.claude/secret.env`, else of its main checkout's when the app is a git worktree (`mainCheckout`, `secret-files.mjs`), else the `hostIdentity` the harness CLI passes (its secret.env's SOPS_AGE_KEY), else the sops `keys.txt`. `defaultSops` takes that port and exposes `identity` and `requireIdentity`; a `set` that adds to an existing member, and any decrypt, with no identity is refused before a value is asked for, naming the recipient, every place looked and the one-line fix. A decrypt whose identity is not the member's recipient is refused naming where the identity came from and the recipient, instead of `SOPS selected identity [recipient-mismatch]`. Re-sealing a member whose every key the set replaces decrypts nothing (`secret-store.mjs`). The success line of a set that creates a member names its recipient and where this machine holds the identity, or the fix.
- Added (ruling app-secrets-one-standard): a member is one provider's `.starcistacks/<env>/secrets/<provider>.enc.yaml`, sops YAML whose values come back byte for byte (decrypted to JSON, `secret-sops.mjs`); a legacy dotenv `.enc` is read, and added to in its own format, until `migrate` moves it. Every reader of the secrets folder resolves members through `runtime/scripts/lib/sealed-member.mjs` (`memberFile`, `isSealedName`; a member sealed in both forms is refused), and the gates accept `.enc.yaml` where they accepted `.enc` (stacks shape, custody-only, lite secrets, env parity, R06, hygiene, the push scan, the stacks gate's `where`, deploy and script scans); the `.starcistacks` gate's custody check admits `<env>/secrets/<member>.enc.yaml` while runtime custody keeps `<name>.<fmt>.enc`.
- Added: `set --from-file KEY=path` reads a key byte for byte (a PEM, a trailing newline); a member is sealed to its environment's rule of the app's `.sops.yaml`, and sealing runs with no identity selected, so a rule may name several recipients. `recipients <env> [--add|--remove <age1...|owner>]` prints or rewrites one rule per environment before the app-wide one (`environmentRecipients`), `owner` being the found identity's recipient; `init` takes that identity (the harness secret.env's included) as the app's recipient instead of generating one. The app-wide rule matches `.enc.yaml`, and an earlier `.enc`-only rule still matches a `.enc.yaml` member.
- Added: `audit [<env>]` names LEGACY_MEMBER, MIXED_PROVIDERS (by the first word of the keys), RECIPIENT_DRIFT, UNDECLARED_KEY, MISSING and UNTRACKED, exit 1 while any stands; `migrate <env> <member> [--to <provider>] [--execute]` and `split <env> <member> [--execute]` move members, dry runs naming keys only, decrypting in memory and never writing plaintext (`secret-standard.mjs`). `set` declares each key of a compose environment in its stack `secrets:` (`name`, `member`, `key`, `where`, comments kept, the edit proved by a re-parse); a swarm environment's keys are named to wire by hand. The application-stacks schema admits `member` and `key` on a secret entry, and the stacks gate checks the member holds the key.
- Changed: the managed `.gitignore` block re-includes `.starcistacks/**/secrets/*.enc.yaml` beside the legacy `*.enc`.
- Spec: `src/hfs-secret-standard.spec.mjs`.
- Changed: the bundled canon pins name hfs 4.11.5, eslint-canon-be 3.8.4, eslint-canon-fe 9.5.6 and the Grammar family 0.15.17.
- Spec: `src/hfs-secret-set.spec.mjs` (fake values only; a child process with a forced-TTY stdin drives the real prompt).

## 4.11.4 - 2026-10-29

- Changed: the bundled canon pins name @starci/test-world 1.3.0 (HTTPS fakes over the run's ephemeral fake CA), hfs 4.11.4, eslint-canon-be 3.8.3, eslint-canon-fe 9.5.5 and the Grammar family 0.15.16. No rule changed.

## 4.11.3 - 2026-10-29

Breaking for lite apps (rulings lite-pgmq-bus-bullmq-jobs and lite-db-image-in-stacks): `npx starci app sync --write` moves the db image and removes `db/Dockerfile`; an app whose hfs.json declares `sides.be.queueOutbox` drops it, and a pg_cron job left in an active migration is rewritten as a `platform/jobs` tick.

- Changed: the managed db image installs pgmq, the lite event bus: `ADD --checksum=sha256:67221f28…27f7` of the pgmq 1.13.1 release source (sync `PGMQ`), whose control and SQL files are copied into the image (pgmq is SQL objects only; it installs into its own schema `pgmq`). Proved by building the image and running create, send_topic, read, archive, bury and requeue as the app role.
- Changed: the db image's Dockerfile is `.starcistacks/images/db/Dockerfile` (slot `app.db.image`, `db/image.mjs` `DB_DOCKERFILE` and `DB_IMAGE_CONTEXT`), built with that folder as its context by `stack build`, the managed `images.yml` and `stack-deploy.yml`, `npm run db:image`, `app db drift` (`DB_DRIFT_NO_IMAGE` names the new path) and `app db baseline --squash`; `app sync` reports a leftover `db/Dockerfile` as retired (`--check`) and removes it (`--write`). The lite .gitignore block re-includes the file, and the stacks gates treat `.starcistacks/images/` as no environment and no custody.
- Changed: the lite event-bus templates (templates/be/inbox/platform/event-bus, contexts/code/be/event-bus.md BE-EVENT-BUS-6) publish once with `public.event_bus_send` (`pgmq.send_topic` of the typed envelope to the event name) in the publisher's transaction, with no outbox table or relay, and pgmq routes it to every consumer queue `<topic>__<consumer>` bound to the name. `event-consumer.service.ts` is the `EventConsumerRegistry` (`subscribe(QUEUE, consumer, { maxDeliveries })`) and the read loop of each consumer queue (started at application bootstrap, stopped at shutdown, no scheduler): `public.event_bus_read` with a visibility timeout, `public.event_bus_archive` on success, a failure left to reappear, `public.event_bus_bury` into `<queue>__dead` (original archived, logged with event and consumer) past `maxDeliveries` (default 5) or when malformed. `BaseEvent.payload` is an `EventPayload` carrying `dedupeKey`, and each delivery hands the consumer `consumer` and `dedupeKey` for its inbox claim; `EventBus` gains `deadLetters(queue, limit)` and `requeue(queue, id)`. The receipt event and its contract carry `dedupeKey` (the receipt id). The inbox migration creates the extension and the security-definer bus functions (the app role holds no pgmq grant); the `event_bus` table and `event_bus_write` are retired. Proved on the built image: a rolled-back send leaves nothing, a committed send reaches two bound consumers once each, bury, dead-letter read and requeue.
- Changed: R258 `DB_PGMQ_DECLARED` (`rules/database-queues.mjs`) stays the event-bus law, requires each topic queue's `<queue>__dead` queue (which it owns), and also refuses a `pgmq.bind_topic` that is not literal, not in an active migration, or binds a queue no earlier `pgmq.create` declared; `DB_CRON_OWNED`, the queue-outbox enqueue check, `rules/database-queue-outbox.mjs` and the scheduler inventory of `rules/database-queue-sources.mjs` are retired (pg_cron stays refused by R259). `databaseQueueDeclarations` still lists the pg_cron jobs an archived chain schedules for `db baseline`.
- Changed: the bundled slot manifest 3.13.0 admits `pgmq` in `ruleParams.db.extensions` (the lite event bus, ruling lite-pgmq-bus-bullmq-jobs), retires `ruleParams.db.queueOutbox` and `sides.be.queueOutbox` with the pg_cron half of R258, lists `public.event_bus_send`, `public.event_bus_read`, `public.event_bus_archive`, `public.event_bus_bury`, `public.event_bus_dead_letters` and `public.event_bus_requeue` in place of `public.event_bus_write` in `ruleParams.be.dbFunctions`, and moves slot `app.db.image` to `.starcistacks/images/db/Dockerfile` (ruling lite-db-image-in-stacks, admitted by the lite `app.starcistacks` allows); the bundled rule catalog keeps R258 `DB_PGMQ_DECLARED` as the event-bus law, retires `DB_CRON_OWNED` and adds R336 `BE_EVENT_BUS_LITE_SHAPE`; the bundled canon pins name hfs 4.11.3, eslint-canon-be 3.8.2, eslint-canon-fe 9.5.4 and the Grammar family 0.15.15.

## 4.11.2 - 2026-10-29

- Changed: the lite skeleton's database helpers live in `platform/database/database.client.ts` (a `client`, a logic role of the closed suffix list, so the file is measured and its colocated `database.client.spec.ts` is a legal unit spec), replacing `database.functions.ts`, whose suffix is not on the list. `callDbFunction` takes `schema.name` or a bare pg built-in of the canon's list (called in pg_catalog), refuses anything else with `DatabaseError` `DATABASE_IDENTIFIER_REJECTED` before building SQL, double-quotes each checked part and builds the parameter list from the argument count; it is no longer `async` (R73). The call statement parses for R268's recurring-work scan, so it raises no `HFS_SCHEDULE_UNDECLARED`.
- Changed: the lite jobs (`job_tick_claim` of R335 among them), queue, inbox and event-bus templates call their database functions schema-qualified (`public.job_claim`, `public.queue_write`, ...), and their specs expect the quoted statement. Spec: `src/db-functions-call.spec.mjs`.
- Changed: the bundled slot manifest 3.12.0 lists the canon's database functions of R334 schema-qualified (`public.job_claim`, `public.job_tick_claim`) beside the pg built-ins it names bare (`gen_random_uuid` joins them), and its shape (`rule-params-shape.mjs`, `declaration-shape.mjs`) with the manifest check of `slots.mjs` refuses in hfs.json `sides.be.dbFunctions` a `pg_catalog` name and any bare name that is not a built-in the canon lists; the manifest bump is minor although that refusal is stricter, since R334 is new on manifest major 3 and its one app (nivo-lite) lists only names it admits (its one bare name, `gen_random_uuid`, is now a canon built-in); the bundled rule catalog's R334 and R68 laws name `platform/database/database.client.ts` as the one composer of the call statement; the bundled canon pins name hfs 4.11.2, eslint-canon-be 3.8.1, eslint-canon-fe 9.5.3 and the Grammar family 0.15.14.

## 4.11.1 - 2026-10-29

- Added: `starci app db baseline --squash --url-env <NAME>` (`runtime/scripts/hfs/db-squash.mjs`) retires the whole active chain into one baseline read from a database whose history records exactly that chain, for a cutover whose production starts on an empty database; the source is only read. It keeps the app's schemas with their privileges (`pg_dump --schema-only --no-owner`, no `-x`) and object references and function bodies byte-identical, and leaves out, listing each, the extensions of `--drop-extension` (default `pg_net,pg_cron`; pgmq stays as the lite event bus), the pgmq queues of `--drop-pgmq-queue` (names or `*` patterns, no match drops nothing), every function or view reaching a dropped extension's schema, an empty publication (`supabase_realtime`), event triggers on platform functions, platform schemas, roles and the grants naming them, and grants to the migrating role that owns every replayed object; a kept object naming a left-out one is refused with both names. `--apply` writes the baseline (kept pgmq queues and grants outside the app schemas in its tail), a marked section of `db/bootstrap.sql` (app roles with their attributes and no password, memberships, allowed role settings such as `search_path`, grants on bootstrap schemas, database-wide default privileges), `db/seed.sql` from `--seed-tables` (`on conflict do nothing`, foreign-key order, sequences set) and archives the chain. Each run first replays bootstrap, baseline and seed (twice) on a scratch container of the app's db image (`db/Dockerfile`, or `--image`) and refuses unless the replay's projection equals the source's; every PostgreSQL client runs in that container. Spec: `src/hfs-db-squash.spec.mjs`.
- Changed: `db/bootstrap.sql` creates the `extensions` schema again, with USAGE for its roles: allowed extensions are created `with schema extensions` and the app role's search_path is `public, extensions`, so migrations that name `extensions.vector`, `extensions.unaccent` or `extensions.gen_random_bytes`, or pin a function's search_path to `''`, apply unchanged (removing the schema in 4.11.0 broke them). `starci app sync` judges the file except the one section the squash writes (sync mode `section`; the markers live in `rules/database-constants.mjs` with `BOOTSTRAP_FILE`, which `db/migrate.mjs` and `db/drift.mjs` re-export).
- Added: R213 (`DB_MIGRATION_SHAPE`) refuses transaction control in a migration, named by file:line (`rules/database-transaction.mjs`): a top-level BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE or PREPARE TRANSACTION, or a COMMIT or ROLLBACK inside a DO block, since `db migrate` and the squash replay apply each file in one transaction with its history row; function and procedure bodies are not judged. Spec: `src/db-migration-transaction.spec.mjs`.
- Changed: the bundled canon pins name hfs 4.11.1.

## 4.11.0 - 2026-10-29

Breaking for lite apps (rulings lite-official-postgres-image and lite-queue-bullmq; the move is contexts/project/lite.md "Moving an app off Supabase").

- Changed: the lite db service runs the Docker Official `postgres` image. `starci app sync --write` writes the managed `db/Dockerfile` (slot `app.db.image`, templates/app/db-image): `FROM postgres:17.11@sha256:31ba9c94…b08f` (sync `DB_BASE_IMAGE`) plus `postgresql-17-pgvector=0.8.7-1.pgdg13+1` from PGDG (`PGVECTOR_PACKAGE`), nothing else. The managed db scripts gain `db:image` (`docker build --tag <project>-db:local db`) and `db:create` builds it first; the lite skeleton's stack runs `{{project}}/db` for its db component and service, deploys it as `deploy.images.db: {app: db}` (`starci app stack build` and the managed `images.yml` and `stack-deploy.yml` build `db/Dockerfile` for it, `db/image.mjs`); `starci app db drift` builds `db/Dockerfile` for its scratch database (`DB_DRIFT_NO_IMAGE` without one) instead of reading `components.db.image`. `DB_IMAGE` (supabase/postgres) is removed.
- Changed: `db/bootstrap.sql` keeps the NOLOGIN browser roles and the auth and storage stubs and no longer creates the `extensions` schema or the `supabase_realtime` publication; it applies green, twice, on the official image.
- Changed: R276 refuses every PostgreSQL or Mongo image in a lite stack (`isLiteDatabaseImage` is removed): the db component runs the app's own db image; `DB_EXTENSION_ALLOWED` (R259) defaults to pgcrypto, pg_trgm, vector, uuid-ossp, unaccent and btree_gist.
- Added: the lite tick scheduler (R335, BE-JOBS-6). `starci app add job` in lite writes `platform/jobs/job-ticks.contracts.ts` (`JOB_TICKS`, empty), `job-tick.service.ts` (`JobTickService`: one `CronJob` per tick in `SchedulerRegistry`; each firing takes `advisoryXactLock(tx, "tick:<name>")`, claims the tick's UTC minute through `job_tick_claim` and only then writes the queue outbox) and its spec, a lite `jobs.module.ts` composing `ScheduleModule.forRoot()`, the `job_ticks` table and `job_tick_claim` function in the jobs migration, and pins `@nestjs/schedule` and `cron` in the app's package.json; `JobsLogEvent.TickFailed`; `job_tick_claim` joins the canon `ruleParams.be.dbFunctions`. The bundled lite pattern knowledge (queues, jobs, idempotency, realtime) names the tick instead of pg_cron, and the failure-code catalog carries `BE_JOBS_SCHEDULER_OWNER`.
- Changed: the bundled slot manifest 3.11.0 adds the managed lite slot `app.db.image` (`db/Dockerfile`), narrows `ruleParams.db.extensions` to what the official postgres image plus pgvector carries (pgcrypto, pg_trgm, vector, uuid-ossp, unaccent, btree_gist; no pgmq, pg_cron, pg_net or supabase_vault) and gives `@nestjs/schedule` and `cron` one owner, `platform/jobs`, in `infraOwners`; the bundled rule catalog adds R335 `BE_JOBS_SCHEDULER_OWNER` and its R250 and R276 laws name the platform/jobs tick and the db image; the bundled canon pins name hfs 4.11.0, eslint-canon-be 3.8.0, eslint-canon-fe 9.5.2 and the Grammar family 0.15.13 and pin `@nestjs/schedule` 6.1.3 (CommonJS on the Nest 11 line) and `cron` 4.4.0.
- Fixed: `starci app db baseline` judges the archive (`db/migrations/archive/`) as frozen history (R257): an archived file needs only its leading 14-digit stamp and an underscore, so a retired chain's snake_case names, impossible times (`20261014300000`) and shared stamps no longer refuse the cutover. The active chain keeps R213 in full (`<ts14>_<kebab>.sql` with a valid UTC stamp); R213 and R332 set no upper bound, so an active stamp after now is no breach. A file both active and archived is refused by name. The new version sorts after every archived and active file, and the baseline header names the last valid stamp, the boundary R257 judges.
- Fixed: a refusal over the migration chain lists every offender as `<file>: <reason> (<rule>)`, all at once: a misnamed or invalid-time active file (`db baseline`, `db restamp`, `db plan`), and for `db baseline` the `--stamp` boundary file, the committed-history findings (R257), the queue and cron findings (R258) and each active migration a schema-only dump cannot rebuild. Spec: `src/hfs-database-baseline.spec.mjs`.


## 4.10.1 - 2026-10-29

- Changed: the bundled slot manifest 3.10.0 adds the lite slot `be.platform.database.entities`, the entity registry (slot fields `role: entity-registry` and `importedBy`, validated by the manifest shape); the bundled architecture machine reads it (`architecture/entity-registry.mjs`): `tier-direction` (R26 `BE_TIER_DIRECTION`) admits the registry's import of a domain or platform capability's `index.ts` that binds only that capability's `<c>Entities`, and `owner-export-bypass` (R30 `ARCH_OWNER_EXPORT_BYPASS`) admits a direct import of the registry from the files `importedBy` names (`apps/*/src/compose/*.ts`, `apps/*/src/app.module.ts`, `src/tests/world/**`); every other import of either shape stays refused, and full has no registry; the bundled canon pins name hfs 4.10.1, eslint-canon-be 3.7.1, eslint-canon-fe 9.5.1 and the Grammar family 0.15.12; the lite skeleton's `platform/database/entities.ts` names its importers (app composition and the test world).
- Changed: the bundled architecture machine: the owner-cycle check (R27 `ARCH_OWNER_CYCLE`) counts the entity registry as a unit of its own, not part of `platform/database`, so naming every `<c>Entities` closes no cycle among capabilities while any other platform/database file importing a domain still does; the bundled rule catalog's R26 and R30 laws name the entity registry.

## 4.10.0 - 2026-10-29

Breaking for lite apps (ruling lite-self-hosted-postgres-passport-minio; the migration note is contexts/project/lite.md "Moving an app off Supabase").

- Changed: the lite edition leaves Supabase. `starci app db` runs against a self-hosted PostgreSQL named by `--url-env <NAME>` (default `DATABASE_URL`) through psql and pg_dump (`db/postgres.mjs`): `migrate` applies each `db/migrations/<ts14>_<kebab>.sql` with its history row in one transaction (the `supabase_migrations.schema_migrations` layout, so a restored history carries over), runs `db/bootstrap.sql` first on an empty database and needs no `STARCI_DB_ARMED` on the loopback; `dump` writes roles, schema and data with pg_dumpall and pg_dump; `plan`, `baseline`, `restamp` and `post-cutover` query and repair the history through psql. New `db new <kebab-name>`. Removed: `db reset`, `--linked`, `--local`, `--target-binding` of the db verbs, the bundled Supabase CLI wrappers and the generated database types (`emit/db-types.mjs`, `app check --db-types`, `add --no-types`).
- Changed: the lite templates. Managed: the db package scripts (`db:create|start|stop|reset` of the pinned `supabase/postgres` image, `db:new`, `db:push`, `db:plan`, `db:dump`), `scripts/codegen.mjs` (GraphQL only), `ci.yml` (no database-types job), `db-deploy.yml` (`starci app db migrate --url-env DATABASE_URL`), `.gitignore`, `.prettierignore` and `db/bootstrap.sql`; `starci app sync --write` deletes a leftover `supabase/types/` of a lite app. Scaffolded: `db/` instead of `supabase/`, a `db` service in both Swarm stacks with its volume, backup and sealed password, `backing.db`, the passport (Google OAuth with state and PKCE, email and password with bcryptjs, own ES256 tokens and JWKS, the refresh cookie) and storage (S3 client, presigned PUT and GET) integrations, the identity guard on the own-token verifier, `platform/database` entities option, `PRIMARY_ENTITIES` and the `callDbFunction`, `advisoryXactLock` and `notify` helpers, and the front end's `modules/auth` over the app's own auth doors (`auth-door.ts`, `token-store.ts`).
- Changed: the checks. `LITE_DB_MIGRATION` (R332) refuses a `supabase/` tree or SQL outside `db/`; the database rules read `db/migrations` and hfs.json `db` (`forceRls`, `forceRlsExemptions`, `appRole`, `urlEnv`, `image`) and drop the config.toml, browser-access and realtime-publication checks; R276 admits the lite `db` component of image `supabase/postgres`; `backing` entries are `{provider: postgres, component}`; the architecture machine's identity check (`identity.mjs`) holds R329 and R260; SQL table ownership reads the tables the migrations create; hfs.json `sides.be.dbFunctions` joins `ruleParams.be.dbFunctions`.
- Changed: `starci app add table` in lite writes a TypeORM entity (`persistence/entities/<table>.entity.ts`, `@Entity({ schema: "public", name })`) and the capability's `persistence/entities/index.ts` (`<c>Entities`), exports it from the capability entry and names it in `PRIMARY_ENTITIES` of `platform/database/entities.ts`; the service reads through `requireOwnedEntity` of `platform/database` (the entity's query builder, named parameters) and inserts with `save`. No `<name>.rows.ts` or `<name>.sql.ts` is written (ruling lite-persistence-typeorm-entities). The machine `schema-owner` (R35) checks that lite shape: the entity list in `persistence/entities/index.ts` and its name in `PRIMARY_ENTITIES`.
- Changed: the lite queue, jobs and webhook generators write no SQL text outside platform/database (R334): their statements are functions of the generated db migrations (job_claim, job_advance, job_complete, job_fail, queue_write, queue_waiting, queue_mark_sent, inbox_claim_event, inbox_claim_client, inbox_save_client_outcome, inbox_sweep_clients, event_bus_write) called through `callDbFunction`, listed with their reasons in the canon `ruleParams.be.dbFunctions`; no `persistence/*.sql.ts` or `*.rows.ts` is written, and the webhook receipt insert is `webhookReceiptInsert(table)` of `platform/database`. The storage integration is `be.integrations.object-storage` (`src/modules/integrations/object-storage/`, `parseObjectStorageConfig`, `ObjectStorageOptions`, options member `objectStorage`). `db/entity-list.mjs` reads the lite entity list at `be/src/modules/platform/database/entities.ts`, where the skeleton keeps it.
- Changed: the bundled lite pattern knowledge (event-bus, idempotency, jobs, projections, queues, reactors, realtime, saga, webhooks) names db migrations and the local db service instead of Supabase; the command policy points `supabase` at `starci app db` and the db scripts.
- Changed: the bundled slot manifest 3.9.0 replaces the lite `app.supabase*` slots with `app.db` (`db/migrations`, `db/migrations/archive`, `db/seed.sql`, the managed `db/bootstrap.sql`), `be.integrations.supabase` with `be.integrations.passport` and `be.integrations.object-storage`, removes `fe.route.callback`, sets lite `schemaAuthority: sql`, gives lite TypeORM entities in `be.persistence`, adds `ruleParams.be.dbFunctions`, and moves the S3 SDKs to `integrations/object-storage` and the identity libraries to `integrations/passport` in `infraOwners` (`@supabase/*`, `minio` and `bcrypt` nowhere); the bundled rule catalog retires R216, R217, R219, R254 and R287 and adds R328-R334; the bundled canon pins name hfs 4.10.0, eslint-canon-be 3.7.0, eslint-canon-fe 9.5.0 and the Grammar family 0.15.11, pin `@nestjs/passport` 11.0.5 (CommonJS on the Nest 11 line), `passport` 0.7.0, `passport-google-oauth20` 2.0.0, `passport-local` 1.0.0, `bcryptjs` 3.0.3 and their types (tokens are signed and verified with `jose`; `@nestjs/jwt` stays allowed in `integrations/passport` but unpinned), and drop `@supabase/ssr`, `@supabase/supabase-js` and the `supabase` CLI.


## 4.9.11 - 2026-10-29

- Added: `starci app db drift [--url-env <NAME>] [--json]` (`db/drift.mjs`, owner ruling 2026-10-29: lite tables are mapped by TypeORM entities while `db/migrations/*.sql` stays the only DDL and `synchronize` is false). It builds TypeORM's metadata from `be/src/platform/database/entities.ts` with the app's own typescript, typeorm and pg (a `DataSource` that never connects), applies `db/bootstrap.sql` and every active migration to a scratch container of the app's `components.db` image (or the empty database `--url-env` names), and reports every missing table or column, type mismatch and nullability mismatch as `BE_ENTITY_SCHEMA_DRIFT` (R333 in the bundled rule catalog, with its failure-code entry). No Docker, no app packages or an unreadable target is no verdict (`DB_DRIFT_NEEDS_DATABASE`, exit 2), never a green; a migration that does not apply to an empty database is `DB_DRIFT_MIGRATION_FAILED`. An app with an entity list gets a `db-drift` row in its release gate (default or declared gates) and `npx starci app db drift` after `npm run db:lint` in its managed CI's build job. Specs: `src/db-drift.spec.mjs` (real TypeORM metadata over a fixture app, stubbed schema) and `src/db-drift-docker.spec.mjs` (a real postgres:17-alpine scratch database where Docker runs, else the no-verdict answer); typeorm 0.3.31 and pg 8.23.1 are dev dependencies for them.

- Changed: the bundled slot manifest gives the model libraries their owners in `ruleParams.be.infraOwners` (`@starci/ai-router` to `integrations/ai-gateway`, `@langchain/*` to `integrations/ai`; `openai`, `langchain`, `@langchain/langgraph`, `@langchain/community` and the provider SDKs nowhere) and lists R326 and R327 on `be.integrations`; the bundled rule catalog carries R326 `BE_AI_KEY_CUSTODY` and R327 `BE_AI_GATEWAY_CLIENT`; the bundled canon pins name hfs 4.9.11, eslint-canon-be 3.6.8, eslint-canon-fe 9.4.9, the Grammar family 0.15.10 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), and pin `@langchain/core` 1.3.1 and `@langchain/openai` 1.8.0.
- Added: the urgent release (owner ruling 2026-10-29, "deploy gấp không cần ci cd gì hết"). `starci app release push --urgent --reason "<text>" [--execute]` runs only the fast local checks among the release gates (`app-check`, `typecheck`, `lint`, `test`; the managed `npm run lint` narrowed to `starci app lint --changed` over the source files changed since the previous release tag), reusing a green row the gate already recorded for HEAD (same command, unchanged log; every gate row now lands in `<git common dir>/starci-release/<head12>/rows.json`), then tags HEAD (annotated), pushes the default branch and the tag in one atomic push through the hook (dry run first, no candidate CI) and writes `<head>.urgent.json` naming the role, the reason, each check with its verdict and the commit (`release/urgent.mjs`, `release/records.mjs`). A missing reason is `RELEASE_URGENT_REASON_MISSING`, a red check `RELEASE_URGENT_CHECK_RED` (nothing tagged or pushed).
- Added: `starci app release gate --backfill <tag> [--execute]` runs the full gate on the urgent release's own commit (checked out at HEAD; `RELEASE_BACKFILL_TAG_UNKNOWN`, `RELEASE_BACKFILL_NOT_ON_TAG`, `RELEASE_BACKFILL_NOT_URGENT` otherwise). Green writes its L4 record (`promotedFrom` the urgent record) and marks the urgent record promoted, with no new tag and no push; red records the verdict on the urgent record and files one fix ticket through the CLI's ticket queue (`RELEASE_BACKFILL_RED`), changing nothing on the remote or on prod.
- Added: the safety floor of `starci app stack deploy --urgent [--db-url-env <NAME>] [--backup-out <dir>]` (`stack/urgent-floor.mjs`), every failed step a refusal with its own code: the pushed urgent record of `--source-sha` (`STACK_URGENT_NO_RECORD`, `STACK_URGENT_NOT_PUSHED`), a declared database (`STACK_URGENT_NO_DATABASE`), the full public verify (`STACK_URGENT_SKIP_PUBLIC`), a fresh full database backup encrypted to the app's recipients (`STACK_URGENT_BACKUP_FAILED`) whose receipt matches the archive (`STACK_URGENT_BACKUP_UNVERIFIED`) and which a test decrypt with `SOPS_AGE_KEY_FILE` opens with every part (`STACK_URGENT_DECRYPT_UNAVAILABLE`, `STACK_URGENT_DECRYPT_FAILED`), an accepted previous release to roll back to (`STACK_URGENT_NO_ROLLBACK_TARGET`), `db migrate` previewed then executed (`STACK_URGENT_MIGRATE_PREVIEW_RED`, `STACK_URGENT_MIGRATE_FAILED`), then the release with its readiness verify and automatic rollback (`STACK_URGENT_RED_ROLLED_BACK`, `STACK_URGENT_ROLLBACK_FAILED`, `STACK_URGENT_DEPLOY_NOT_STARTED`). A refused floor exits 2 after printing the steps that led to it. `db dump` and `db migrate` export `dumpDatabase` and `migrateDatabase` for it.
- Added: slot manifest 3.8.0 adds the optional `fe.dev-server-generated` slot (`apps/*/AGENTS.md`, which `next dev` rewrites) and the slot field `rewrittenBy`; the release gate's clean-tree check (`dirtyPaths`, now over `--untracked-files=all`) passes over an untracked file such a slot owns, and over nothing else.
- Changed: the ESLint child of `starci app lint` and `starci app check` runs with `--max-old-space-size` from `STARCI_ESLINT_HEAP_MB`, which the CLI sets from the eslint memory of ops/liveness.yaml (8192); unset, it keeps node's default.
- Changed: the lite boot proof's worker has its own budget from its spawn (`STARCI_BOOT_PROOF_TIMEOUT_MS`, which the CLI sets from `heavy.bootProofTimeoutSeconds`), is retried once when it runs out, and a second timeout is `BOOT_PROOF_TIMEOUT` (R272, a warning: no verdict on a loaded host), never `BE_APP_BOOT_PROOF_MISSING`.
- Changed: the managed `stack-deploy.yml` passes the workflow token (`GH_TOKEN`, `actions: read`) to the deploy step, which reads the CI verdict of the tag's commit a production deploy waits for.

## 4.9.10 - 2026-10-29

- Fixed: the back-end skeleton's `OriginGuard` (`platform/http-security`, BE-AUTH-5) refuses a state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) that names no usable origin, with `HTTP_SECURITY_ORIGIN_REJECTED` (403). It admitted a request with neither `Origin` nor `Referer`, which a session-cookie mutation must never be. `Referer` stands in only when `Origin` is absent, so a foreign or `null` `Origin` is never rescued by an allowed `Referer`; safe methods are not judged.
- Added: the `ServerToServer` marker of `platform/http-security` exempts a door that proves its caller itself from the origin check. `@Public({ reason: PublicReason.SignedWebhook })` (signature verified first, BE-WEBHOOK-2) and `@Credential({ kind })` (a header credential `CredentialGuard` authenticates) apply it, in full and lite, so the generated webhook doors keep answering providers that send no `Origin`. Both decorators, and `@RateLimit`, are typed with the new `DoorDecorator` of `platform/composition`.
- Added: `@RateLimit(tier, { redirect })` (BE-AUTH-4): a redirect-only door (an OAuth callback answering `303 /sign-in?auth=error`) names its error redirect, and a caller over the limit gets that 303 from `RateLimitGuard` instead of a 429 body. The redirect must be a same-site path (one leading `/`), refused with `HTTP_SECURITY_REQUEST_INVALID` when the decorator is applied. `ErrorsFilter` leaves a response a guard already sent as it is.
- Changed: the unit specs of `OriginGuard`, `RateLimitGuard` and `ErrorsFilter` cover the new paths at 100 per file; the bundled canon pins name hfs 4.9.10, eslint-canon-be 3.6.7, eslint-canon-fe 9.4.8, eslint-grammar-core 0.15.9 and eslint-grammar-offset-pop 0.15.9.

## 4.9.9 - 2026-10-29

- Fixed: the back-end skeleton's `RateLimitGuard` counts in a store every replica shares (BE-AUTH-4), not a process-local map. Each hit is one upsert of the caller's window (tier and address) in the primary database, answering its hits; a hit that opens a fresh window prunes up to 100 ended windows (`FOR UPDATE SKIP LOCKED`). `platform/http-security` owns the table `http_security_rate_windows`: in full through its `persistence/` entity and migration (`httpSecurityEntities`, `httpSecurityMigrations`, registered on the primary connection by the api and cli apps), in lite in the Supabase baseline with forced RLS and `app_be` policies. The lite starter now ships `platform/database/database.sql.ts` (with `DATABASE_IDENTIFIER_REJECTED`) and exports `sql`, `InjectPrimaryEntityManager` and `PRIMARY_ENTITY_MANAGER`, which the guard and its spec consume; a lite starter leaves out a platform capability's TypeORM schema files. Needs `@starci/eslint-canon-be` 3.6.5, which admits `http-security` as a persistence capability.
- Unchanged on purpose: `platform/http` and `platform/http-security` still export only what the skeleton consumes (R25 HFS_UNUSED_EXPORT); code that first consumes `InjectHttpClient` or `RateLimit`/`RateTier` adds the export line to the owner entry in the same change, as the webhook generators already do.
- Changed: the bundled canon pins name hfs 4.9.9 and eslint-canon-be 3.6.5.
- Changed: the bundled canon pins name the Grammar family 0.15.7 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.6.
- Changed: the bundled canon pins name the Grammar family 0.15.8 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), eslint-canon-fe 9.4.7 and eslint-canon-be 3.6.6.

## 4.9.8 - 2026-10-28

- Added: `starci app add page <route> --tabs a,b` puts the page tabs in the `Page` header as link tabs (Grammar 0.15.6): the first tab is the route itself, every other one its sub-route `<route>/<tab>`; the server owner resolves the labels (`<page>.tabs.label` and `<page>.tabs.items.<tab>` in every catalog) and passes no state or handler, and the stories carry the tabs. Fewer than two or repeated tab ids are refused (`HFS_ADD_TABS_INVALID`).
- Changed: `starci app add overlay --form` keeps the decision group in the shell's footer: the way out first, then `<Button type="submit" form="<id>">` naming the body's `Form id` (Grammar 0.15.6 `Button form`), instead of buttons inside the form; the shell no longer passes `closeLabel`, since the footer offers the way out.
- Fixed: the skeleton's `AppHomePage` (full and lite) and the landing app's `LandingPage` draw one Grammar `Page` with the title (and the landing's lede as `description`) in its header, instead of a bare `Heading` and blocks, which R325 (`@starci/eslint-grammar-core` 0.15.6) now refuses.
- Changed: the bundled canon pins name the Grammar family 0.15.6 and hfs 4.9.8.

## 4.9.7 - 2026-10-28

- Added: `starci app add block|composite|branch|leaf|page|overlay|layout` writes every front-end unit already in the canon's shape, from `templates/fe/units` (`scaffold/add-fe-unit.mjs`, `add-fe-page.mjs`, `add-fe-overlay.mjs`, `add-fe-layout.mjs`), with its copy in every catalog; nothing that exists is overwritten.
  - `block <name> [--shapes a,b,c] [--read <read>]`: the connected half folds one `useQuery<Read>Swr` read through `slotOfSwr`/`mapSlot` and takes its shape from the read's `status` (the placeholder's while it loads); the pure half draws through `SlotView`, and with shapes declares `X_SHAPES`, `XShape = (typeof X_SHAPES)[number]` and the exhaustive switch (FE-FUNCTION-7); `stories/blocks/<Name>.stories.tsx` has one story per shape and the loading twin paired by `parameters.dna`. The first block writes the app's one copy of the status owners (`DataSlot`, `SlotLabels`, `slotOfSwr`, `mapSlot`, `loadingSlot`, `useSlotLabels`, `SlotView`) and the shared `status` namespace.
  - `composite`, `branch`, `leaf`: one file of Grammar parts on resolved fields; in a front end of two or more apps with the shared ui package they, and `SlotView`, go to that package and its barrel (R91), `DataSlot` and `SlotLabels` declared beside `SlotView` and re-exported by `modules/types`.
  - `page <route> [--blocks a,b]`: the route's `page`, `loading` and `error` files, the server page owner drawing one Grammar `Page` (R325) with the trail and heading in its header and the blocks (or its empty sentence) in its body, its loading view (the same page with `isSkeleton`, STATE-8), its error page (the page with one negative Alert) and the stories pairing the page with its loading view.
  - `overlay <name> --kind modal|drawer [--form]`: a `Dialog` or trailing `Drawer` owner whose connected half owns its open state; way out first and commit last, in the footer or, with `--form`, as the last row of a Form over a one-column `FormGrid`; stories closed and open.
  - `layout <segment> [--blocks a,b]`: the segment's layout file and its owner composing `PrimaryRailLayout`, the page in its primary region and the blocks in its rail.
  - Spec: `src/fe-unit-shape-slot.spec.mjs` adds every kind to a scaffolded full app and lints it with the starci-fe canon and the core Grammar's rules, and type-checks them under the next preset.
- Changed: `starci app add` prints its `registered patterns` line only for a noun that registers something in hfs.json.
- Changed: the bundled canon pins name hfs 4.9.7.

## 4.9.6 - 2026-10-28

- Changed: the bundled canon pins name hfs 4.9.6, the Grammar family 0.15.5 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.5.
- Changed: the app pre-push hook runs `node node_modules/starci-harness/dist/main.js deps check` after the bundled push gate (under `set -e`), so a push whose committed @starci pins npm cannot install, or whose local package copies run ahead of npm, is refused; RT_HOOK_SHAPE (R225) requires the call. Spec: `src/pre-push-hook.spec.mjs`.

## 4.9.5 - 2026-10-28

- Added: the bundled rule catalog carries R324 (`FE_PAGE_TABS_OUTSIDE_HEADER`, `page-tabs-in-header`) and R325 (`FE_ROUTE_PAGE_OUTSIDE_PAGE`, `route-page-is-one-page`), both enforced by `@starci/eslint-grammar-core`, and their failure-code guidance.
- Changed: the bundled canon pins follow release G (Grammar family 0.15.4, hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4, ai-router 0.3.0); the mermaid pin names Grammar's MermaidDiagram as its owner.

## 4.9.4 - 2026-10-28

- Added: the bundled rule catalog carries R323 (`FE_PAGE_HEADER_HAND_ROLLED`, enforced by `@starci/eslint-grammar-core` `no-hand-rolled-page-header`) and its failure-code guidance.
- Changed: the bundled canon pins follow release F (Grammar family 0.15.3, hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3, ai-router 0.3.0).

## 4.9.3 - 2026-10-28

- Changed: the bundled canon pins no longer pin the command line. An app's `starci-harness` is judged and scaffolded at the version of the CLI that runs this package: `main(argv, { harness: { version } })` takes it, and `runtime/scripts/hfs/canon-pins.mjs` (`canonPins`, the one reader of `knowledge/hfs/canon-pins.yaml`) adds the `starci-harness` row from it for HFS_CANON_PIN_DRIFT, HFS_CI_MISSING_CANON and the scaffold's root devDependencies. The CLI depends on this package exactly, so a bundled pin of the CLI tied every CLI release to a new hfs and back. Run without a CLI, nothing judges the app's `starci-harness` and `scaffoldApp` refuses HFS_SCAFFOLD_PIN_MISSING before `git init`. Spec: `src/canon-pins.spec.mjs` (also: every `source:` pin at its folder's version, the five runtime copies byte-identical, `contexts/stack/pins.yaml` in step).
- Changed: the bundled canon pins follow release E (Grammar family 0.15.2, hfs 4.9.3, canon-fe 9.4.2, canon-be 3.6.2, ai-router 0.3.0).

## 4.9.2 - 2026-10-28

- Fixed: `repositoryName` (runtime/scripts/hfs/repo-identity.mjs) names a repository by its origin remote, whatever folder holds the clone; the main checkout's folder names it only without an origin. HFS_README_TITLE_INVALID and the stack project name no longer change with the clone folder. Spec: `src/repo-identity.spec.mjs`.
- Fixed: the rendered `sonar-project.properties` carries `sonar.cpd.exclusions` inside the generated `starci:sonar-scope` block, after `sonar.coverage.exclusions`, and its entries are the `cpd-exclusions` allowances of the bundled design truths (`SONAR_CPD_EXCLUSIONS` reads them; no second list), so `starci check loosening` accepts the rendered line as the block `starci app sonar` derives instead of flagging a ruled exclusion as hand-written. An app moves the line with `starci app sync --write`.
- Fixed: the fe skeleton passes canon-fe 9.4.1: `SignInForm` takes `{ props: { ..., pending, errorMessage }, on }` (no retired `state`, no `failure` status prop), and the opt-in auth callback's `GET` and `exchangeAuthCode` are arrow consts. Spec: `src/scaffold-template-canon-fe.spec.mjs` scaffolds each edition and lints every fe source with the starci-fe rules.
- Changed: the bundled canon pins follow release D (Grammar family 0.15.1, hfs 4.9.2, canon-fe 9.4.1, canon-be 3.6.1, starci-harness 1.1.0-alpha.2), so an app installs the released versions without pin drift.

## 4.9.1 - 2026-10-28

- Changed: the bundled canon pins follow release C (Grammar family 0.15.0, hfs 4.9.1, canon-fe 9.4.0, canon-be 3.6.0, jest-preset 2.4.1, stylelint-canon 2.2.1, tsconfig 2.1.0, prettier-config 1.1.0, and `@starci/ai-router` 0.2.1 pinned), so an app installs the released versions without pin drift.

## 4.9.0 - 2026-10-28

- Removed: 121 bundled runtime scripts that only served the legacy runtime and that no `starci app` verb, package entry or catalogued rule enforcer reaches: `scripts/agent/`, `scripts/reconciler/`, the legacy hook guards of `scripts/guards/` (command, seat, rights, install and launch verdicts), the op gate of `scripts/gates/` (`gate.mjs`, canon pins and digest, type impact), the drawing pipeline of `scripts/work/` other than the DNA judge (`draw-dna*`, `grammar-proposal`, `asset-slot`), the ledger of `engine/db/`, the machine helpers, and the `scripts/api` and `scripts/lib` helpers only they imported; with them the specs that exercised only that code. The `release-push-gate` and `hook-io` cases of `hook-input.spec.mjs` stay.
- Changed: `starci app` is carried by the harness CLI `starci-harness`, which runs this package in-process; `@starci/cli` is retired. A new app's root devDependencies name `starci-harness` instead of `@starci/cli`, its GraphQL codegen loads the input-bounds plugin from `starci-harness/input-bounds`, the runtime resolves an app's `starci` bin and its @starci/hfs from its installed `starci-harness` (`package-at.mjs`), and HFS_CI_MISSING_CANON accepts `npx starci-harness[@<version>] app lint`, the version being the `starci-harness` pin; the bundled canon pins replace the retired `@starci/cli` with `starci-harness` 1.1.0-alpha.1 (`source: cli/package.json`), the one command line a product installs for `starci app`, and follow the harness packages (Grammar family 0.14.0, hfs 4.9.0, canon-fe 9.3.0, canon-be 3.5.0).
- Changed: the rendered `sonar-project.properties` takes the jest preset's test patterns as tests: `sonar.tests` names every source folder and `sonar.test.inclusions` those patterns, which `sonar.exclusions` moves out of the sources (Sonar refuses a file indexed as both), beside the build and dependency folders; `supabase/types/**` is no longer excluded, so a lite app's generated row types are analysed. `sonar.coverage.exclusions` sits between the `starci:sonar-scope` markers `starci app sonar --write` writes, so sync and the harness's Sonar scope check agree on one file.

## 4.8.0 - 2026-10-27

- Removed: the Heritage family from the bundled Grammar catalog.
- Changed: the bundled canon pins name each @starci package by its folder in starci-harness (`source: packages/<name>/package.json`) at the versions there; `@starci/cli` is a registry-only pin.
- Removed: the specs that exercised the legacy runtime's own scripts (css-rules, grammar-knowledge, grammar-union-census, grammar-vendor-repaints, ui-proof-*); that code is not part of this package.
- Changed: the package lives in github.com/starci183/starci-harness under `packages/` and publishes from there; its bundled `runtime/` is committed source, edited in place (no generator, no `prepack`/`pretest` hook).
- Changed: owner ruling: the Grammar catalog has exactly two families, `core` and `offset-pop`. `grammarLintFor`,
  `grammarFamilyFor`, `grammarContractFor`, `resolveGrammarFamily` and the code-pattern family binding
  (`familyCanons.core`) answer by those ids; `starci app` scaffolds `sides.fe.grammar: core`; the core lint package is
  `@starci/eslint-grammar-core` with `coreGrammarConfig`, and the knowledge folder is `knowledge/grammars/core`.
- Removed: `starci` and `starci-core` are not family ids and have no alias; a selection naming them is refused.

## 4.7.47 - 2026-10-27

- Fixed: the rendered stack escapes every literal dollar once more, so a secret-reading command or healthcheck survives the second interpolation of docker stack deploy.

## 4.7.46 - 2026-10-26

- Changed: owner ruling push-main-after-scoped-check reaches product apps: the generated pre-push hook passes a fast-forward main push when the hooks pass and the secret scan is clean, a v* tag must be annotated, and app CI runs on pushes to main.
- Changed: candidate-ci keeps only catalogued failure codes.

## 4.7.45 - 2026-10-26

- Changed: the alpha.31.1 round folded into alpha.31; the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 4.7.44 - 2026-10-26
- Changed: the bundled canon pins follow the lint family bumps (canon-be 3.4.51, canon-fe 9.1.6, Grammar 0.12.10) and the bundled runtime copy carries the wave version. No rule changes.

## 4.7.43 - 2026-10-26
- Fixed: the ESLint launch of `starci app lint` is chunked by command-line size and a spawn error is reported as an eslint error.
- Changed: R280 (unused symbols) reads one assignment-target index per run instead of scanning the tree per class member.
- Changed: the bundled canon pins follow the lint family bumps (canon-be 3.4.50, canon-fe 9.1.5, Grammar 0.12.9).

## 4.7.42 - 2026-10-26
- Fixed: `HFS_BYPASS_MARKER` reads a skip/only index only (`describe["skip"]`), not a marker word inside an array literal.
- Fixed: the BE SQL owner analysis bounds a FROM-less and an aggregate-only SELECT as one row.
- Changed: the bundled canon pins follow the lint family bumps (canon-be 3.4.49, canon-fe 9.1.4, Grammar 0.12.8).

## 4.7.41 - 2026-10-26
- Changed: the bundled canon pins follow the lint family bumps (canon-be 3.4.48, canon-fe 9.1.3, Grammar 0.12.7). No behavior change.

## 4.7.40 - 2026-10-26
- Fixed: the next release is derived within the candidate's own tag family, so legacy tags of other families no longer outrank the runtime line (`release cut` and the release-definition guard).

## 4.7.39 - 2026-10-26
- Added: R258 follows the active cron schedule and accepts a declared outbox (`sides.be.queueOutbox`), and the optional slot `app.scripts.integration` carries integration scripts.
- Fixed: the lite scaffold templates, barrels and dev README follow the lite scaffold end-to-end fixes.

## 4.7.38 - 2026-10-26
- Changed: the bundled canon pins select @starci/stylelint-canon 2.0.13, @starci/eslint-canon-be 3.4.46, @starci/eslint-canon-fe 9.1.1, the Grammar lint families 0.12.5 and @starci/grammar 0.12.5.
- Fixed: the full and lite scaffold templates, skeletons and specs follow the scaffold end-to-end and repaint fixes made after 4.7.37.

## 4.7.37 - 2026-10-26
- Fixed: the scaffold SiteShell declares viewport=flow so Grammar lint reads it as site chrome, the hygiene sync follows the scaffold end-to-end fixes, and the scaffold json-logger spec expects the logger field order.

## 4.7.36 - 2026-10-26
- Changed: the bundled canon pins select @starci/eslint-canon-be 3.4.45, @starci/eslint-canon-fe 9.1.0, the Grammar lint families 0.12.4 and @starci/grammar 0.12.4.
- Added: the five R319 button-intent finding codes are catalogued and proven, and the `app codemod button-intent` migration is bundled.
- Changed: the Grammar vendor-parity proof is strict. It reads the DNA vendor, parity and arrangement declarations, judges undeclared wraps and stale overrides, and exports repaint findings with `starci work export-repaints`; `wrappers.yaml` carries the owner-ruled overrides and one pin.
- Changed: releases follow the alpha.N.M counter (owner ruling `release-waves`): the next tag is derived from the highest released one.

## 4.7.35 - 2026-10-26
- Changed: the bundled canon pins select @starci/stylelint-canon 2.0.12, @starci/eslint-canon-be 3.4.44, @starci/eslint-canon-fe 9.0.0, the Grammar lint families 0.12.3 and @starci/grammar 0.12.3.
- Added: `app lint` composes the selected Grammar family lint with the universal front-end canon and refuses canon-fe 9 without it; the Grammar vendor-parity proof reads the generated HeroUI reference; the UI proof checks component ownership and surface layers.
- Fixed: managed stack renders match and leave unpinned the compose `version` the scaffold declares; the history-hook spec judges the stdin handshake, not a fixed kill; the restamp inventory is active-only and clearer.
- Changed: the runtime centralizes its parsing and gate summaries.

## 4.7.34 - 2026-10-26
- Added: `starci app codemod button-intent` previews legacy Grammar button migrations, applies safe edits with `--write`, and reports ambiguous consequences, competing commits and repeated item commits in JSON or Markdown.
- Fixed: `starci app db restamp` considers only active migrations when validating names and choosing unoccupied versions. Legacy archive names no longer block preview or apply, and archived files stay untouched.
- Changed: the loosening check reads the tree as it stands and never its history. The bundled `scripts/lib/loosening-state.mjs` (with `js-lex.mjs` and `loosening-config.mjs`) replaces the diff detector; `HFS_BYPASS_MARKER` (R303) reads it: a suppression word opens a comment, a test marker stands in code, a swallowed failure stands in a shell line or in the string a script hands a shell, a package.json is judged by its scripts, and the same words quoted as data are no bypass. It also refuses a coverage target or threshold below the canon, a relaxing switch, a disabled ESLint rule, a tsconfig strictness option turned off and an exception file that `knowledge/hfs/design-truths.yaml` does not list. `--passWithNoTests`, `--coverageThreshold`, `--no-error-on-unmatched-pattern` and a `--max-warnings` budget are bypasses in a script, a hook or a workflow.
- Added: `starci app emit` carries class-validator `MaxLength`, `ArrayMaxSize`, `Min` and `Max` of GraphQL input types and REST operation DTOs into the contract (a GraphQL `@inputBounds` directive and an OpenAPI constraint), and the `@starci/hfs/form-bounds` codegen plugin turns them into typed `INPUT_BOUNDS` and `inputBoundsIssues` for the form canon. The app codegen template refuses legacy or unsupported bounds metadata.
- Changed: the operation emit refuses a non-strict `z.object` (open on the wire), publishes the real maximum length of fixed-format strings (`z.uuid()`, `z.ipv4()` and kin) and keeps `readOnly` out of request schemas.
- Changed: operation tables declare runtime input/output schemas from owner-local `*.schema.ts` exports. `starci app emit` derives OpenAPI 3.1 with the app's `z.toJSONSchema`, preserving bounds and defaults, refusing open or unrepresentable wire values, and evaluating only schema modules. Package specs cover conversion, isolated worker execution and rejection paths.

## 4.7.33 - 2026-10-25
- Changed: the bundled canon pins select @starci/stylelint-canon 2.0.11, @starci/cli 1.7.33 and the canons 3.4.41 and 8.4.40.

## 4.7.32 - 2026-10-25
- Changed: the bundled canon pins select @starci/grammar 0.11.0, @starci/cli 1.7.32 and the canons 3.4.40 and 8.4.39.

## 4.7.31 - 2026-10-24
- Fixed: `HFS_UNUSED_FILE` treats an api app `operations.ts` as a root (the contract emit reads it by path) and the emitted `openapi.json` is a declared JSON format.
- Fixed: the doc check `HFS_DOC_ENV_UNKNOWN` (R270) no longer reads a documented error code as an environment key: codes the app declares in `errors/`, `*.error.ts` and `*.messages.ts` (`errors.<CODE>` keys) and names in a sentence about error codes pass, while an undeclared environment key still fails.
- Added: the SSE door templates of the realtime pattern (`channel.sse` module, options and definition); lite may serve SSE beside its socket.io gateway (amended R212).
- Changed: a new app's starter dependencies (full and lite) carry `zod` at its canon pin, which is `side: both` (the boundary-schema pattern, R304 and R305).

## 4.7.30 - 2026-10-24
- Changed: a new app root overrides multer to its canon pin 2.5.0: @nestjs/platform-express depends on exactly multer 2.4.0, which carries GHSA-q7qp-rjg7-q26m (high); the bundled canon pins add `multer` and select @starci/cli 1.7.30, @starci/eslint-canon-be 3.4.38 and @starci/eslint-canon-fe 8.4.37.

## 4.7.29 - 2026-10-24
- Added: a new full app ships its test world (`scaffold/test-world.mjs`, `templates/be/test-world/`): the `@starci/test-world` declaration under `be/src/tests/world/`, an integration spec of readiness over the real database and one e2e spec per api app, so the integration, e2e and contract rows of the release gate run real specs.
- Added: `starci app upgrade [--plan]` on a full app without `be/src/tests/world/global-setup.ts` adds that world and the test devDependencies it lacks at canon pins, never overwriting a file (`HFS_UPGRADE_FILE_CONFLICT`); proven by `src/main.spec.mjs`.
- Changed: the bundled canon pins select zod 4.6.7 (GHSA-mrhx-c7xc-m3w5 is fixed in 4.6.6), @starci/cli 1.7.29, @starci/eslint-canon-be 3.4.37 and @starci/eslint-canon-fe 8.4.36.

## 4.7.28 - 2026-10-23
- Added: `scripts/lib/sonar-new-code.mjs` joins the bundled runtime copy (the New Code definition `starci sonar project ensure` sets), proven by `src/sonar-new-code.spec.mjs`.
- Fixed: the bundled gate-loosening detector no longer reads a quoted operand of a printed message as a ban-list row, nor the upkeep of an exception list the check stops reading as enforcement lost (`src/bypass-detector.spec.mjs`).
- Added: `scripts/lib/provision-control-failure.mjs` joins the bundled runtime copy, proven by `src/provision-control-failure.spec.mjs`.
- Changed: the bundled canon pins select @starci/cli 1.7.28, @starci/eslint-canon-be 3.4.36 and @starci/eslint-canon-fe 8.4.35.
- Changed: no check keeps a list of exceptions. The JSON a tool requires is declared once by format (`scripts/lib/json-formats.mjs`, bundled), the failure-code scanner no longer counts a literal the code only reads (`scripts/lib/failure-code-reads.mjs`, bundled), and a rule is proven by a package spec unless every enforcer it has runs only inside the runtime (`RUNTIME_ONLY_ENFORCERS`); the catalog keys `specNa`, `exampleNa` and the unreachable witness are gone.
- Added: the specs of the deleted runtime tests that prove bundled checkers, restored as package specs (`src/*.spec.mjs`, helpers in `src/helpers`, fixtures in `src/fixtures`), and fresh specs for R296-R301, the tree codes of R01/R03, R112 and R216.
- Changed: `scripts/gates/sonar-gate.mjs` and `scripts/gates/starcistacks.mjs` joined the bundled runtime copy, and a few exports the specs read are exported again.
- Changed: a red candidate CI never passes: `packages/hfs/release/candidate-ci.mjs` has no ci-override record any more (owner ruling 2026-10-22, a loosening is always red).
- Added: R303 `HFS_BYPASS_MARKER` in `starci app check` and the bypass guard of `starci app hygiene` (staged files read from the index): an inline disable of any tool, a type-check escape, a Sonar or coverage ignore, a skipped or focused test and a failure swallowed in a hook or workflow are refused in a product repository, the front end included.
- Changed: the managed `.husky/pre-commit` runs `starci app sync --check` and ends the hook when any step fails; the stylelint step can no longer be skipped by a failing run.

## 4.7.27 - 2026-10-23
- Fixed: the bundled `scripts/lib/managed-json.mjs` passes each slot path to `braceVariants` through an arrow, so `flatMap` never hands it an index (Sonar S7727).
- Changed: the bundled canon pins select @starci/cli 1.7.27, @starci/eslint-canon-be 3.4.34 and @starci/eslint-canon-fe 8.4.33.

## 4.7.26 - 2026-10-23
- Changed: the bundled canon pins select @starci/cli 1.7.26, @starci/eslint-canon-be 3.4.33 and @starci/eslint-canon-fe 8.4.32.

## 4.7.25 - 2026-10-23
- Fixed: with fe packages, the managed `lint` and `lint:fix` scripts build them first (`turbo run build --filter=./fe/packages/*`, turbo.json already declares lint dependsOn ^build): the typed front-end canon of @starci/eslint-canon-fe 8.4.30 read a fresh full scaffold's i18n package as unresolved types (`no-unsafe-*`), so `starci app lint` was red on a new app.
- Fixed: the skeleton specs cover the express-adapter guard of the edge security and the GraphQL error mapper without locations or path, so a fresh scaffold's unit run holds per-file 100; the skeleton templates and the Supabase auth partial are prettier-formatted (`HFS_FORMAT` was red on a fresh lite scaffold).
- Changed: the bundled canon pins select @starci/cli 1.7.25, @starci/eslint-canon-be 3.4.32 and @starci/eslint-canon-fe 8.4.31.

## 4.7.24 - 2026-10-23
- Fixed: `starci app release push` counts no skipped conclusion as passing (owner ruling 2026-10-22: a skip is a loosening): a green candidate run with a skipped job is red, and the failing-jobs report lists skipped jobs and steps. The candidate grace is 45 minutes and the bounded wait 150 minutes from the push; a queued run is listed, so GitHub's queue never counts against the grace. Specs: `src/candidate-ci.spec.mjs`.
- Fixed: the local release gate always runs `db-stop` once `db-start` ran (`teardownOf`): a red database row no longer leaves the lite app's local Supabase running. Specs: `src/no-loosening-ci.spec.mjs`.
- Changed: the bundled canon pins select @starci/cli 1.7.24, @starci/eslint-canon-be 3.4.31, @starci/eslint-canon-fe 8.4.30, @starci/jest-preset 2.3.5, @starci/prettier-config 1.0.4, @starci/test-world 1.2.3 and @starci/tsconfig 2.0.7.
- Changed: the skeletons, the GraphQL client templates and the lite auth partial compile under `exactOptionalPropertyTypes` (`@starci/tsconfig` 2.0.7): an option that may be absent is spread in only when present (credential guard, outcome mapper, GraphQL error mapper, the fetch and Apollo link options, the TypeORM schema), the Apollo client options and link parameters declare `signal` as `AbortSignal | undefined`, and `ApolloOutcome.data` is `TData | null | undefined`. Fixed: the lite `supabase-client.ts.tpl` partial calls `authOf()`, the function the skeleton defines, instead of the removed `supabase()`.
- Changed: the bundled R280 detector (`HFS_UNUSED_SYMBOL`) resolves more catalog keys so a product needs fewer `i18n-dynamic-keys.yaml` entries: the type checker reads the standard library (a key typed as a union of literals is read through `filter`/`map` callbacks), a `??` or `||` default holds both operands, a nullish branch of a property owner is skipped, and a table of constants is read through the `readonly` fields of the interface or alias that types it. Spec: `src/unused-symbol-flow.spec.mjs`.
- Changed: the bundled `knowledge/sonar-gate.yaml` holds every issue severity on changed lines and a change of any size to duplication (`ignoreBelowChangedLines: 0`).

## 4.7.23 - 2026-10-22
- Changed: the rendered `sonar-project.properties` leaves the message catalogs (`**/messages/*.messages.ts`, `**/messages/*.json`) out of Sonar's copy-paste detection (`sonar.cpd.exclusions`, owner ruling 2026-10-22). A catalog repeats its keys once per language, which CPD read as duplicated code (35% new duplicated lines on NIVO v0.3.1 once prettier formatted the catalogs); they stay sources, so lint, analysis and every other rule still hold them. Spec: `src/sonar-cpd-messages.spec.mjs`.

## 4.7.22 - 2026-10-22
- Fixed: the bundled runtime carries `modules/schemas/provision-operation.schema.yaml`; 4.7.21 left it out, so `starci app check` and `starci app lint` failed with ENOENT in every app whose stack declaration has an `operations` block. The composition reads both schemas through `new URL(..., import.meta.url)`, the form the runtime copy follows. Spec: `src/provision-operation-schema-bundle.spec.mjs`.

## 4.7.21 - 2026-10-22
- Changed: the bundled `scripts/lib/gate-loosening.mjs` has no approval route (owner ruling loosening-always-red, 2026-10-22): `approved` and `approvalIdOf` are gone, `looseningStep` is the land gate's always-red step whose only way out is restoring the gate, and the pure released-state judgement `loosensReleased` moved here from the runtime's check library. Spec: `src/gate-loosening.spec.mjs`.
- Added: the bundled runtime copy of `scripts/lib/gate-loosening.mjs`, which judges whether one change loosens a gate. It is rename-aware: an allowlist or rule entry that only moves with a git rename of the paths it names (the removed line, with every renamed prefix rewritten, equals an added line) is no loosening, while an entry that also widens, or one added beside the move, still is. Spec: `src/gate-loosening.spec.mjs`.
- Added: the opt-in managed slot `app.browser-config` (slot manifest 3.5.0): an app that declares `browser: true` gets `browser/tsconfig.json`, rendered by `starci app sync` from `templates/app/browser-config` (extending `@starci/tsconfig/e2e.json`), the program that type-checks the browser config and journeys Playwright only transpiles. Sync renders an opt-in managed slot only for an app that enables it. The bundled `scripts/lib/managed-json.mjs` names a slot-declared template and an app's byte-equal render of it as managed canon, not authored JSON. Specs: `src/browser-config.spec.mjs`, `src/managed-json.spec.mjs`.
- Added: the bundled runtime copy of `scripts/lib/uat-run-folder.mjs`, the pure half of `starci uat record`: a UAT run folder holds exactly manifest.yaml, result.md, screens/*.png and videos/*.webm (each of its type by its bytes), an example's fixture store receives each verified blob once, and the work/evidence@1 document cites every file by sha256 with an outcome that is pass only when the walk exited 0 and its manifest says pass. Spec: `src/uat-run-folder.spec.mjs`.
- Fixed: the release gate's Sonar read retries a network error or HTTP 5xx up to 5 times with backoff inside its 600 s wait; a 4xx and every gate status keep their verdict. Spec: `src/sonar-quality-gate.spec.mjs`.
- Fixed: `starci app db dump` archives its parts with tar run inside the scratch directory and relative names only (no `-C`, no absolute path): GNU tar, first on PATH under Git Bash on Windows, read the absolute drive-letter archive path as a remote host and every backup failed with `DB_BACKUP_TOOL_FAILED`. Spec: `src/db-dump-archive.spec.mjs`.
- Fixed: the bundled stacks gate validates a declaration's `operations` block with the composed provision-operation schema instead of crashing on its cross-file `$ref`; the bundled schema lets a SonarCloud admin credential name a runtime secret.env variable (`hostConnection: sonar-runtime-secret-env`).

## 4.7.20 - 2026-10-22
- Changed: the bundled failure-code catalog carries the Sonar quality-gate ensure results (`sonar-gate-*`); canon pins follow the matching package cohort.

## 4.7.19 - 2026-10-21
- Changed: supersedes 4.7.18 (app lint broken: the canons' Sonar way block carries its own ignores, which `starci app lint` refused as an unsupported source scope, so it exited 2 without running ESLint and reported 0 findings); 4.7.18 is not used.
- Fixed: `starci app lint` reads the canons' flat config as flat config defines it: global ignores prune the source walk and a block's own ignores narrow only that block, so the Sonar way block no longer makes the source scope unavailable (exit 2 without ESLint); a file is a source when some block's files match it and that block's ignores do not.
- Fixed: the full scaffold's ui package pins react-dom at the react version beside react.
- Fixed: the scaffolded `migrate-connections.client.spec.ts` mocks an applied migration with only its `name` (the `AppliedMigration` port), so the full scaffold typechecks again.
- Added: `release.requireCi` (default false, owner ruling release-require-ci-per-project): `starci app release push` waits for the candidate CI only for an app that sets it true; with false it needs the annotated tag and the green L4 record, runs the dry run and pushes atomically, and the L4 record and the output state that CI was not required; canon pins follow the matching package cohort.

## 4.7.18 - 2026-10-21
- Changed: supersedes 4.7.17, published from a lane whose history the owner refused (an unapproved allowlist entry) and therefore a superseded orphan that is not used; this version carries the same work plus the standalone scaffold fix.
- Fixed: the managed CI's coverage job runs `starci app coverage verify <lcov>`, the coverage judgement alone over the merged report, instead of `npm run codegen && starci app check --coverage-from` (the whole app check the fast and lint jobs already ran); its default timeout is 15 minutes (`knowledge/hfs/ci-standard.yaml`). NIVO v0.3.0's coverage job took 18m43s of 20 and the tag run was cancelled.
- Fixed: the sonar row of `starci app release gate --sonar` no longer passes on the scanner's exit code alone: it reads `.scannerwork/report-task.txt`, polls `api/ce/task` until the analysis ends and reads `api/qualitygates/project_status` with the same token; ERROR is red as `RELEASE_SONAR_GATE_FAILED` naming each failed condition, a 600-second wait is `RELEASE_SONAR_GATE_TIMEOUT` and an unreadable answer `RELEASE_SONAR_GATE_UNREADABLE`; canon pins follow the matching package cohort.

- Fixed: `npx @starci/cli app scaffold` works from the published packages alone: the Sonar exclusions come from the jest preset copy @starci/hfs ships (`runtime/packages/jest-preset/sonar-exclusions.cjs`, `bundledPresets`), not from a @starci/jest-preset installed beside the CLI (it was `HFS_SYNC_PRESET_MISSING`); `starci app upgrade` reads the same copy instead of a hand-kept list.
- Fixed: a new scaffold path is git-initialised with an unborn main before any file is written (`HFS_SCAFFOLD_GIT_INIT_FAILED` when git cannot), as the verb promised, so `starci npm ci` can install the hooks; an existing empty unborn main repository is still accepted.

- Fixed: `BE_UNIT_SPEC_NOT_STAGED` exempts a measured file with nothing to execute (constants and types only), which has nothing a spec could call and whose spec the spec rules refuse; every measured file with a function, method, constructor or accessor still needs its spec staged beside it. It refused the scaffold's own first commit on the constant-only `http-status.policy.ts`; the scaffold now also ships `migrate-connections.client.spec.ts`.

## 4.7.16 - 2026-10-21
- Fixed: `DB_MIGRATION_DESTRUCTIVE` counts a be/src source as a reference of a dropped or altered column only when the source names the column's table too, so a same-named column of another table (`public.brain_lessons.origin` beside a drop of `transactions.origin`) no longer blocks a contract migration; table and other object drops keep the leaf match; canon pins follow the matching package cohort.

## 4.7.15 - 2026-10-21
- Added: slot `be.contract.mcp-tools` (opt-in, slot manifest 3.4.0) for the committed MCP tool catalog `be/contracts/<app>/<contract>.tools.json`, and R302 `HFS_MCP_TOOLS_SNAPSHOT`: the catalog names a declared be app, its contract is `<server>@<major>` equal to the file name and the server name, and every tool has a unique name, a description and an object `inputSchema`; canon pins follow the matching package cohort.

## 4.7.14 - 2026-10-20
- Added: `starci app hygiene` (the managed pre-commit hook) refuses a back-end logic file the index adds without its `<name>.<role>.spec.ts` beside it, naming the file (`BE_UNIT_SPEC_NOT_STAGED`, R47); the measured roles and roots come from the coverage scope.
- Added: `starci app check` reports `HFS_HOOKS_NOT_INSTALLED` (R13, error) when a set `core.hooksPath` names a hooks folder that is missing or holds no husky dispatcher in the checkout, with the install remedy.
- Fixed: R165 `HFS_SERVICE_STACK_DECLARATION` accepts, for an api or worker app, a `role: service` component named after it or mapped to it by `environments.<env>.deploy.images.<component>.app` in any environment, so a deployed service named after its stack (`shop-api: {app: api}`) needs no rename onto a shared network alias.
- Changed: the scaffold's next step names `starci npm ci`, which installs the lockfile and then the app's git hooks; canon pins follow the matching package cohort.

## 4.7.13 - 2026-10-20
- Fixed: the lite CI template sets NODE_OPTIONS on the database migration check step; ci-standard heap.steps lists `npm run db:lint`.
- Fixed: bundled runtime source clears the SonarCloud code smells of alpha.23 (regex complexity, concise classes, string prefix and suffix checks, block braces, optional chaining, export-from, default parameters, synchronous awaits, dead stores) without behavior change; canon pins follow the matching package cohort.
- Fixed: `starci app release gate --sonar` produces `reports/lint.sonar.json` before the scanner (per-side `starci app lint --sonar` runs merged like the managed CI), so the scanner no longer fails on the missing external issues report; a failing lint fails the sonar row.

## 4.7.12 - 2026-10-19
- Fixed: bundled source analysis uses explicit nullable contracts, unary callback arguments and grouped regular-expression alternatives while preserving refusal paths; canon pins follow the matching package cohort.

## 4.7.11 - 2026-10-19
- Changed: app release and Sonar adapters use native target binding, with local database migration and Docker transport preserving the declared stack target.

## 4.7.10 - 2026-10-19
- Changed: bundled canon pins follow the regenerated Stylelint vocabulary and the matching lint canon cohort; HFS command behavior is unchanged.

## 4.7.9 - 2026-10-19
- Changed: the lite scaffold README explicitly starts the Docker engine before the Supabase CLI-managed local stack and keeps application startup in its declared development profile.

## 4.7.8 - 2026-10-19
- Fixed: catalog usage follows ordered object and JSX spreads, readonly class translator fields and their declared forwarding methods while unknown or overwritten producers remain barriers.
- Fixed: strict-null narrowing retains initializer provenance only for an unmodified const reference; destructuring writes and ancestor replacements invalidate the proof across the containing evaluation frame.
- Fixed: finite template catalog keys resolve from bounded tuple and callback values, with unknown spans and excessive products rejected; a proven catalog leaf consumes only its same-bundle locale siblings.

## 4.7.7 - 2026-10-19
- Changed: bundled canon pins follow the front-end canon's module classification correction in 8.4.13; HFS command behavior is unchanged.

## 4.7.5 - 2026-10-18
- Fixed: Codecov ignores the same slot-derived coverage complement as Sonar, including imported config, module and persistence files in shard reports. Project, patch and component targets remain at 100% on every measured logic file.

## 4.7.4 - 2026-10-18
- Fixed: the managed Sonar configuration uses `sonar.javascript.node.maxspace`, the analyzer's supported Node heap property, with the existing 6144 MiB CI Node budget. This leaves memory for Java and the OS on an 8 GB runner; `sonar.nodejs.maxspace` did not apply the configured limit.

## 4.7.3 - 2026-10-18
- Fixed: the managed CI typecheck step declares the CI standard's raised Node heap, preventing the NIVO release candidate's typecheck from exhausting Node's default heap; the CI standard checks typecheck steps too.
- Fixed: the fresh coverage job runs codegen before the whole-app coverage proof, preparing ignored GraphQL wire types before the app check or its isolated example copy starts; a failed generator stops the proof.

## 4.7.2 - 2026-10-18
- Fixed: `app coverage merge` merges the shard istanbul maps through the installed @starci/jest-preset/merge (4.7.1 merged lcov text and reported phantom gaps on real data); the managed unit step sets STARCI_COVERAGE_SHARD and uploads coverage-final.json; `app lint` accepts a canon inside the app's linked node_modules.

## 4.7.1 - 2026-10-18
- Fixed: the package files list carries coverage/ (4.7.0 shipped `app coverage merge` without coverage/cli.mjs); the lint upload condition of the managed CI names the per-side report with format() instead of a nested ${{ }} that actionlint reads as always true.

## 4.7.0 - 2026-10-18
- Added: `app release push --execute` pushes the release sha to `release/candidate-<version>` and moves the branch and the tag only when its ci.yml run is green (RELEASE_CANDIDATE_CI_RED / _TIMEOUT, RELEASE_CI_UNKNOWN; the owner's sha-bound override record is the emergency path); the managed ci.yml and pre-push hook carry the candidate ref; R301 CI_STANDARD in the app check.
- Added: the managed CI shards the unit run (`ci.jobs.test.shards`, default 6), lints each side in its own job and merges coverage in a coverage job (`starci app coverage merge`); `ci.jobs.<job>.timeoutMinutes`; jest/build caches keyed by the lockfile and saved always; `starci app ci local` runs the rendered jobs locally in parallel.
- Fixed: a scaffolded app root overrides `@graphql-tools/utils` to the canon pin 12.1.0, closing GHSA-7mx3-vvmw-hjmv (npm audit high) under @nestjs/graphql 13.x.
- Changed: `app release gate` no longer reads the default-branch CI (release/ci-red.mjs removed); the app trigger check allows the candidate branches.

## 4.6.0 - 2026-10-18
- Added: `services.codecov|sonar.badgeToken` README badge tokens and `ci.github.visibility` with a private-repository notice (sync, ci verify); `ci.vars` `ownerValue: true` (var sync skips, var set reads stdin, verify checks the name).
- Fixed: the app release gate counts tag-push CI runs reachable from origin/main, main or HEAD; the secret scans exempt only declared badge tokens.
- Fixed: empty placeholder lines vanish so every managed file is prettier-stable; CI coverage proof heap, per-side Sonar lint reports merged for the import, per-fe-app build env; `app lint --side` combines with `--sonar`.

## 4.5.1 - 2026-10-18
- Fixed: managed CI base refs, public build values, caching and timeouts; optional quality service handling, README formatting and Supabase migration-history parsing.

## 4.5.0 - 2026-10-17
- Added: consumer-class CI declarations, `app ci` custody verbs and R296-R298; manifest-driven quality files and split cached CI with immutable action pins.
- Added: release audit/local Sonar and main-CI protection; encrypted outside-repository DB dump and armed linked reset with backup/auth/storage validation.
- Fixed: DB types refuse stale migration history.

## 4.4.1 - 2026-10-17
- Changed: the bundled runtime copies follow the runtime of 1.0.0-alpha.19 (owner ruling no-runtime-specs, 2026-10-17): the failure codes, the slot manifest (`exampleNa`) and the rule catalog (`specNa`, `exampleNa`) carry the removal of the runtime's own specs; package behavior is unchanged. The managed codecov.yml, the CI coverage upload and the hfs sync render stay (Codecov is kept for apps and examples); internal exports that only the deleted runtime specs read are no longer exported.

## 4.4.0 - 2026-10-15
- Fixed: a swarm service on a shared external edge network no longer keeps the implicit short service name as an alias (`docker stack deploy` adds `api` for nivo_api on every network, so another tenant resolving `http://api` reached the wrong stack). `starci app stack deploy` and rollback reconcile the edge attachment to exactly the declared aliases right after `docker stack deploy` (`STACK_DEPLOY_EDGE_ALIAS` when they still differ), `stack verify` refuses an undeclared alias on an edge-attached service, and the deploy preflight and `stack doctor` extend `STACK_DEPLOY_ALIAS_SHARED` to a short name that another container or service of the edge network already resolves (`STACK_DEPLOY_EDGE_UNREADABLE` when the network cannot be inspected).
- Added: R295 `BE_MODULE_DEFINITION_MISSING`: every Nest module has a module definition (owner ruling 2026-10-15 `owner:module-definition-everywhere`). The slot manifest allows `<x>.module-definition.ts` and `<x>.options.ts` beside every feature, transport, cli group, queue, reactor and job module; the generators of `starci app add` and `starci app new` write the three files and register the module as `X.register({})`.
- Changed: `module-per-transport` accepts a module-definition beside the application module, the transport module of its folder and a cli group, and refuses one anywhere else.

## 4.3.0 - 2026-10-14
- Added: the app file role `<app>.env.ts` (`apps/<app>/src/`, every `be.app.*` slot, budget 150): a typed `<App>Env` interface and fail-fast `read<App>Env` reader (secrets `_FILE` first), imported by `main.ts` so the entry stays within its 80 lines. Only `main.ts` and the app's own env file read the environment; the env file lists no module and imports no feature. The api, lite api and cli scaffolds write it.
- Added: `starci app secret` custody verbs `init`, `set <env> <slug> <KEY>` (stdin or `--generate <bytes>`), `get <env> <slug> [KEY] --to-file [--reveal]`, `materialize <env>` and `list <env>` over sops dotenv files under `.starcistacks/<env>/secrets/`; the age identity lives outside the repository, materialized values go under the local StarCi secrets directory for `*_FILE` reading, and no value reaches stdout unless `--reveal`. The scaffolded `.sops.yaml` carries the `init` instruction and the be config template reads `<NAME>_FILE` before `<NAME>`. An untracked root `secrets.env` of a lite app is an `HFS_PLAINTEXT_SECRET` warning.
- Added: lite delivery slots `app.deploy` (`deploy/`), `app.ci-deploy`, `app.ci-authorize-deploy-key` and `app.scripts.delivery`; R06 scans all of them.
- Added: fe tier edge `feature -> feature` narrowed by `mayImportKinds` (pages compose overlays and blocks) and render props in the pure half (`render*` callbacks in `props` of a non-block component); `FE_CONNECTED_BLOCK_RENDER_PAIR` reads the exact sibling `XBase` twin.
- Changed: a lite app's `.starciwork/` holds only `.gitignore`, `workspace.yaml` and `brand/**` and is optional (index.yaml, shell, features, resources, UAT and br are forbidden); the work readers (validate, kernel, uat, example refs) skip the removed workspace, index, shell and feature records under lite, and the lite scaffold and example no longer write them.
- Changed: a pure re-export `index.ts` gets the 400-line `barrel` budget (hooks slots); an `fe.modules` instance with no `.ts`/`.tsx` file needs no `index.ts` (`HFS_REQUIRED_FILE_MISSING`, `HFS_SLOT_REQUIRED_MISSING`).
- Changed: `BE_BACKGROUND_UNOWNED` decides by context (job processor, scheduler, saga, event handler and what they call), never by a `retry*`/`replay*` method name; resolvers and controllers are never background.
- Changed: `HFS_DUPLICATE_CODE` drops canon scaffold shapes; `HFS_UNUSED_EXPORT` counts staged test consumers; `FE_I18N_KEYS` reads in-segment template keys (`t(`stage_${x}`)`) as globs.
- Changed: the scaffolded pre-commit hook passes staged files to eslint and prettier in chunks of 50 (Windows command-line limit); `DB_MIGRATION_SHAPE` orders a new migration against HEAD's active migrations, not the clock or the base branch.


- Added: HFS manifest 3.1.0 (rule catalog 3.1.0, owner ruling 2026-10-14, R245 and R246): every `be.app.*` slot allows the composition groups `compose/<area>.ts` and budgets its composition files (`app.module.ts` 250, `<app>.options.ts` 200, `compose/<area>.ts` 120, `main.ts` 80); `<app>.options.ts` holds env-derived options and port bindings only (`BE_APP_OPTIONS_COMPOSITION`, `BE_APP_COMPOSITION_BUDGET`).
- Changed: `starci app scaffold` writes `apps/<api app>/src/compose/platform.ts` (the platform capabilities as one group, `platformModules(options)`) in both editions, and the scaffolded `app.module.ts` spreads it before the domain modules and the guards.
- Changed: `add table` lists the table's error kinds where the app keeps its error kinds array: the root `app.module.ts`, or else the `compose/` group that holds it.
- Changed: the architecture machine reads an app's root and its `compose/` groups as one composition (register-once, module-per-transport, the connection and context maps).

## 4.2.17 - 2026-10-14

- Fixed: the webhook door spec template signs with a per-run key (`randomBytes`) instead of a literal, so a scaffolded spec holds no plaintext secret-shaped value the release secret scan could flag.

## 4.2.16 - 2026-10-14

- Fixed: the `add api`, `add table` and `add webhook` templates render code the published canons (eslint-canon-be 3.2.17, eslint-canon-fe 8.2.16) accept, as examples/lite-app shows. The GraphQL error formatter spec builds its malformed-operation error from a code (`GRAPHQL_VALIDATION_FAILED`), not prose (`user-copy-through-catalog`); `platform/graphql`'s context factory types its parameter with the named `GraphqlContext` (`no-inline-param-type`); both webhook door spec templates register `HttpSecurityModule` with the module's own default and override `WebhookSignatureService` with the real verifier over a fake clock instead of a global `ClockModule` (`is-global-only-in-app`).
- Fixed: two tables no longer render duplicate code (`HFS_DUPLICATE_CODE`). The table service template answers `Pick<Row, "id">` through a named result type, throws its not-found error from one module-level factory handed to `requireOwnedRow` (whose factory now receives the id) and maps the insert's rows with a module-level `createdRow`.
- Fixed: `add table --fe` renders no dead or aliased operation types (`HFS_UNUSED_EXPORT`, `HFS_ALIAS_REEXPORT`): the operation files type their request with the generated variables, the types files export only the answer, which the SWR hooks name. `useQuery<X>Swr` answers the operation's GraphQLResponse as its data (as the ecommerce example does) and `useMutateCreate<X>Swr` primes that query with the response.

## 4.2.15 - 2026-10-13

- Changed: the heroicons family is the one application icon set (owner ruling 2026-10-13): the scaffold installs `@heroicons/react` 2.2.0 and `@starci/heroicons` 0.3.3 (fe-stack `icons`, tier core) in every product fe app in place of `@phosphor-icons/react`, and the `modules/toast` skeleton draws its status indicators with `@heroicons/react/24/outline` (CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, InformationCircleIcon). Carry the canon pins of eslint-canon-be 3.2.17, eslint-canon-fe 8.2.16 and CLI 1.2.15.

## 4.2.14 - 2026-10-13

- Breaking: HFS manifest 3.0.0 (schema `starci/hfs-slots@3`, rule catalog `starci/hfs-rules@3` 3.0.0). Removing the front-end database slots and the Supabase realtime feature slot and narrowing `fe.route` change answers for existing apps, so the manifest takes a major: every app pins `"hfs": 3` (scaffold writes it), and an app still pinned to 2 is refused with `HFS_MANIFEST_MAJOR_MISMATCH`.
- Changed: HFS manifest 3.0.0 re-rules the lite edition (owner ruling 2026-10-12, R212): lite is the full architecture deployed without self-hosted infrastructure. Lite regains the worker app, queue, event bus, saga, reactors, fenced jobs, projections, realtime and event contracts through their Supabase adapters, and full's unit world; only the e2e and contract layers, the browser journey, UAT records, the socket and graphql-ws doors and the self-hosted stack stay forbidden. The lite-only `be.feature.realtime.supabase` door is added and `repo.tests-forbidden` is removed.
- Changed: lite sync, scaffold and `add` render full's unit run (test scripts, jest config, the tests tsconfig, coverage and the CI unit step with the Codecov upload) and the lite unit specs; the lite identity module owns its access-token verifier token.
- Changed: carry the canon pins for Grammar 0.9.14, the BE/FE lint canons 3.2.15/8.2.15, jest-preset 2.2.7 and CLI 1.2.14.
- Changed: one front-end skeleton for lite and full (owner ruling 2026-10-13, knowledge/hfs/fe-stack.yaml). Every product Next app (full `app`, lite `web`; not the marketing `landing`) is scaffolded with the shared app core `templates/fe/skeleton/apps/__app__`: `modules/api/graphql` (the GraphQLResponse union), `modules/toast`, `modules/auth` (one `AuthClient` interface: a full IdP stub, the lite overlay a browser Supabase Auth client with client-side PKCE), `redux/` (store, typed hooks, ReduxProvider, the session slice), `components/providers` (one AppProviders owner composing the theme, redux, SWR config, app effects and the HeroUI toast region), `components/blocks` (SignInForm, SignOutButton, drawn by the home page), `hooks/auth` (session, sign-in, sign-out with its toast), `hooks/swr` (SwrSideEffects) and `hooks/effects` (the session kept in redux by the auth change subscription, no load in an effect). A fresh scaffold is lint-clean in both editions: it holds no code nothing calls, so the Apollo clients and their links arrive with the first GraphQL operation. The lite web app loses `modules/db`, its Server Actions, the `auth/callback` route and the session-refreshing proxy; health/live is its one route handler, and Supabase's redirect URL is the site root.
- Changed: the scaffold installs every `tier: core` package of fe-stack.yaml at its canon pin in both editions, read from the catalog (product app workspaces take the runtime packages, the app root the codegen, lint and compiler tools), and both editions add the back end's GraphQL stack (@nestjs/graphql, @nestjs/apollo, @apollo/server, graphql).
- Added: `npm run codegen:graphql`, and `scripts/codegen.mjs` in both editions generates each product app's `modules/api/graphql/__generated__` from `be/contracts/<app>/schema.graphql` with the GraphQL codegen client preset; both editions now run `codegen` before dev, build, typecheck and lint.
- Changed: the GraphQL door is the same in both editions. The shared be skeleton's `requestOf` reads a resolver's request through the GraphQL context and the errors filter hands GraphQL failures to the formatter; the GraphQL server capability (`modules/platform/graphql`: Apollo driver, error formatter, depth limit, localize plugin over `x-locale`) is written by the first GraphQL feature. Lite `add api` now writes full's GraphQL transport (principal-aware command and handler) and wires it with the server into the api app; the lite HTTP-door templates are removed.
- Changed: `add table --fe` emits the table's api feature over GraphQL (get and create, with the app_be insert policy and grant) and per product app the query/mutation operation files and the useQuery*Swr / useMutate*Swr hooks with their barrels, never Server Actions or Supabase readers; the first operation of an app also writes its GraphQL transport (`templates/fe/transport/graphql/clients`: the auth and no-auth Apollo clients with the retry, error, timeout, UNAUTHENTICATED refresh, locale, access-token and http links) and the `graphqlUrl` reader of its modules/config, as platform/graphql is written by the first GraphQL feature on the back end. `add app` is no longer refused in lite and renders partials and the shared core in both editions.
- Fixed: `starci app scaffold --edition lite` loads the installed jest preset's Sonar exclusions like full, so a fresh lite app's sonar-project.properties is the render its own `starci app lint` expects.
- Fixed: the full api `graphql.module.ts.tpl` imported a `<Feature>Module` the feature module never exported; it imports `<Feature>ApiModule`.

## 4.2.13 - 2026-10-12

- Added: HFS manifest 2.2.0 owns app compiler declarations under the declaration-only types/ambient slot, without a runtime entry; runtime source files remain refused there.
- Fixed: the derived Grammar contract selects all three required peers, react, @heroui/react and @xyflow/react. Full and lite FE scaffolds and the shared UI workspace declare @xyflow/react at the canonical 12.11.6 pin.
- Fixed: full and lite Next app scaffolds and the four Next app examples declare CSS imports through global declarations in their ambient owner, while missing non-CSS side-effect imports remain errors under TypeScript 6.
- Changed: carry the merged runtime mirror and canon pins for Grammar 0.9.13 and Stylelint canon 2.0.9, retaining the no-frontend-tests policy.

## 4.2.12 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.12 (the secondary tab track keeps its padding).

## 4.2.11 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.11 (secondary Tabs are HeroUI's own pill tabs).

## 4.2.10 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.10 (the grammar ships without spec suites).

## 4.2.9 - 2026-10-12

- Changed: refresh the bundled canon pins for CLI 1.2.9 and the BE/FE lint canons 3.2.10/8.2.10 after correcting the CLI runtime install pin; app command implementations are unchanged.

## 4.2.8 - 2026-10-12

- Changed: refresh the bundled runtime and canon pins for grammar 0.9.9, the BE/FE lint canons 3.2.9/8.2.9, stylelint-canon 2.0.8 and CLI 1.2.8; app command implementations are unchanged.

## 4.2.7 - 2026-10-12

- Changed: refresh the bundled canon pins for grammar 0.9.8; behaviour is unchanged.

## 4.2.6 - 2026-10-12

- Changed: refresh the bundled canon pins for grammar 0.9.7 and heroicons 0.3.3; behaviour is unchanged.

## 4.2.5 - 2026-10-11

- Changed: refresh the bundled canon pins for CLI 1.2.5 and HFS 4.2.5; command and lint behavior is unchanged.

## 4.2.4 - 2026-10-11

- Changed: refresh the bundled canon pins for stylelint-canon 2.0.7 and cli 1.2.4; behaviour is unchanged.

## 4.2.3 - 2026-10-11

- Changed: refresh the bundled canon pins for @starci/grammar 0.9.3 and the canon packages; behaviour is unchanged.

## 4.2.2 - 2026-10-11

- Changed: refresh the bundled canon pins for the alpha.9.1 CLI and lint packages.

## 4.2.1 - 2026-10-10

- Fixed: queue templates preserve the declared Redis database for both Queue and Worker connections, with a nonzero-database adapter regression.

## 4.2.0 - 2026-10-09

- Changed: the lint runner (`lint/run.mjs`) and the bundled runtime copies follow the runtime of 1.0.0-alpha.9. Version 4.1.0 on the registry carries the copies of an earlier runtime.

## 4.1.0 - 2026-10-08

- Breaking (runtime alpha.4 CLI unification): remove the `hfs` bin and expose `main(argv, io)` for the sole `starci app ...` grammar; the app flags `--repo` and `--root` are replaced by the global `--cwd` flag.
- Changed (contract change `coverage-modules-logic`): the coverage scope is derived once from the slot manifest (`coverage: required|none` on every tracked be slot, `ruleParams.be.logicRoles`; `scripts/hfs/coverage-scope.mjs`). `hfs sync` renders it into `be/jest.config.js` (`starciJestConfig({ coverage })`), `sonar.coverage.exclusions` and `codecov.yml` (the measured roots, plus one Codecov component per service app and one `platform`, each at 100); `coverageScope`, `coverageExclusions` and `HFS_SYNC_COVERAGE_SCOPE` are gone. New R204 `HFS_COVERAGE_SCOPE_DRIFT`: a hand edit of any of the three coverage statements is drift. `hfs scaffold app` renders with the source it just wrote.
- Added (contract change `lite-edition`): the lite edition. `hfs.json` `edition: lite` (and an optional `supabase` block); `hfs scaffold app <name> --edition lite` writes the lite shape and generates `supabase/types/database.types.ts` by starting the app's own local Supabase stack (`HFS_SCAFFOLD_TYPES_FAILED` removes the app when it cannot); `hfs upgrade --edition full [--plan]` (additions only, new `upgrade/**` in the package files) and `hfs check --edition full`; `hfs add table <name> [--fe] [--no-types]`, `hfs add app <name>` and the lite bootstrap of `hfs add cli`; `add` and `new` refuse the nouns lite lacks (`<verb> <noun>: full edition only`); `hfs emit-contracts` also writes the Supabase types; `hfs check` runs the database rules (R213 to R216) and the lite rules (R212, R217 to R220) with the bundled runtime. New dependencies `libpg-query` and `smol-toml`.
- Added: lite-edition `hfs sync` renders its managed scripts, hooks, CI/database workflows, image matrix and Sonar configuration from edition-aware slot templates, without Jest, tests, Codecov or coverage conditions; full renders remain byte-identical.
- Added (contract change `patterns-hfs-add`): `hfs add <job|reactor|queue|projection> <name>` generates exactly one kind's file tree from the `files:` tree of its pattern topic (knowledge/patterns/be/<topic>.yaml, carried by the bundled runtime) with the one template body of each entry (templates/be/patterns), adds the platform capabilities the kind needs when they are missing, and registers the patterns and the trigger kind in hfs.json (`sides.be.patterns`, `sides.be.kinds`). `hfs.json` gains `sides.be.kinds`, required for every trigger kind in use (rules BE_KIND_DECLARATION, BE_KIND_EMPTY).
- New (microservice policy, R163 to R167): `hfs check` judges a product with more than one service: `HFS_SERVICE_PLACEMENT`, `HFS_IMAGE_UNPINNED`, `HFS_SERVICE_STACK_DECLARATION`, `HFS_EVENT_CONTRACT` and `BE_ASYNC_SPEC_MISSING`; `hfs emit-contracts` writes `be/contracts/<service>/events.json` from the literal `EVENTS` table of `apps/<service>/src/events.ts`. New slot `be.contract.events`.
- Changed: `hfs scaffold app` writes the final front end: two Next apps, `fe/apps/landing` and `fe/apps/app`, over the shared workspace packages `fe/packages/<name>-ui` (`@<name>/ui`: the brand shell, the locale shell and the boundary notices both apps mount) and `fe/packages/<name>-i18n` (`@<name>/i18n`: the next-intl stack written once, `createAppI18n` plus the `./proxy` and `./routing` subpaths; R59). hfs.json declares `fe.package.ui` and `fe.package.i18n`; each workspace's package.json declares exactly what its source imports; the request config still reads the locale through `next/root-params` (FE-I18N-1), now in the package. Template path variables: an fe `apps/<name>/` folder is the skeleton of that app alone (`__app__` is gone from the fe side), `__project__` is the project name.
- New: `hfs secret list|show|set|gen` (alpha.5 item 6.4), the canon command over the sealed secrets of `.starcistacks/<env>/secrets/<slug>.enc`, on the runtime's sops api (a new `seal` call: the value travels on stdin, never on an argument list). Replaces the plain `sops` commands of runbooks and KEYS.md files.
- Changed: HFS_REQUIRED_FILE_MISSING now also carries what BE_REQUIRED_MODULE_MISSING reported, and BE_TEST_TOPOLOGY what HFS_TEST_KIND_RETIRED reported (one code per obligation); the bundled architecture machine follows `APP_GUARD` and `APP_FILTER` providers built by a helper outside the app root file.
- Changed: the managed fe scripts (`dev:fe`, `start:<app>`, `build:fe`) run `next` from the app directory (`cd fe/apps/<app> && next ...`) so next-intl finds its request config; the fe skeleton reads the request locale through `next/root-params` (`experimental.rootParams`), pins the workspace root three levels above the app and uses the `.*[.].*` proxy matcher; the bundled runtime carries the `&&`/`||`-aware FE_SWR_KEY_IDENTITY check.
## Unreleased (a18 R281)

- Fixed: the bundled architecture machine (`function-spec-providers.mjs`, `unit-spec-providers.mjs`) takes the callable subset of a function-only subject's exports (constants, enums, re-exports and overload signatures are ignored) and lets the spec of a value-object class (undecorated, no constructor injection token) construct it with `new`.
- Security (canon pins, npm audit of 2026-10-16): `next` 16.1.6 to 16.4.2 (critical, with the `postcss` and `sharp` highs it brings), `axios` 1.15.2 to 1.20.0 and `@nestjs/platform-express` 11.2.5 to 11.2.7 (with `multer`) in `knowledge/hfs/canon-pins.yaml`; the example apps (`ecommerce-app`, `lite-app`, `shape-slot`) and `packages/test-world` carry the new pins and lockfiles.
- Known advisory, accepted (owner ruling `graphql-13-advisory-accepted-until-a19`, 2026-10-16): `@nestjs/graphql` and `@nestjs/apollo` stay on 13.4.5. `npm audit --omit=dev --audit-level=high` still reports their highs (and `@graphql-tools/utils` through them); the fix is 14.0.3, a semver major, deferred to alpha.19.

## Unreleased (C0 batch)

- Fixed (contract change `sonar-coverage-exclusions`): SonarQube has no `sonar.coverage.inclusions` property, so Sonar ignored it and counted every executable be/ file at 0% (overall coverage 65.8% and 45.2% on the examples, although every service was at 100). The managed `sonar-project.properties` now renders `sonar.coverage.exclusions` as the complement of the services. `coverageExclusions(presets, manifest)` in `sync/index.mjs` derives it from the preset's `COVERAGE_SOURCES` and the slot manifest, and lists:
  - every be role of the R89 suffix vocabulary other than `service`;
  - the be file names a slot declares outside it (`main.ts`, `index.ts`, `connection.ts`, the migrations, the test world's files);
  - `fe/**`.

  A coverage source whose complement Sonar's globs cannot write is refused (`HFS_SYNC_COVERAGE_SCOPE`). `sonar.coverage.inclusions` is deleted.
- Fixed: the fe skeleton's `[locale]/error.tsx` exports `ErrorBoundary` (Sonar S2137: `Error` shadowed the global).

## 4.0.7 - 2026-10-01

- Changed: the runtime layer check (scripts/api/<system>, a pure scripts/lib) in its bundled runtime.

## 4.0.6 - 2026-10-01

- Changed: R112 integration specs, the runtime api layer, the examples-root CI scope and the new pins.

## 4.0.5 - 2026-10-01

- Changed: workflow worktree runtime copies, the services coverage scope for Sonar and codecov.yml, sonar-gate, canon-pins.

## Unreleased (alpha.4, bumped in C0's batch)

- Changed (contract change `sonar-services-coverage`): Sonar and Codecov judge the services' coverage. The managed `sonar-project.properties` adds `sonar.javascript.lcov.reportPaths=be/coverage/lcov.info` and `sonar.coverage.inclusions=be/src/**/*.service.ts`; a new managed `codecov.yml` (slot `app.quality-config`, now `{sonar-project.properties,codecov.yml}`) holds the same paths at 100 on the project and the patch and ignores `fe/**`; the managed CI workflow uploads the be lcov with `codecov/codecov-action@v5` and the `CODECOV_TOKEN` secret after the unit run. Both files are rendered from one scope, `coverageScope(presets)`: the installed jest preset's `COVERAGE_SOURCES` on the be side (`loadPresets` now returns `coverageSources`). An app re-renders with `hfs sync --write`.
- Changed: the bundled runtime copies of `knowledge/sonar-gate.yaml` (coverage 100 overall and on new code, per file; every hotspot reviewed), `knowledge/hfs/slots.yaml` (the quality-config slot) and `modules/kernel/failure-codes.yaml` (the R11 law and HFS_SONAR_CONFIG text).

## 4.0.4 - 2026-10-01

- Changed: the bundled runtime copy of knowledge/hfs/canon-pins.yaml pins @starci/test-world 1.0.3. No rule or command changed.

## 4.0.3 - 2026-10-01

- Changed: the bundled canon-pins copy pins @starci/stylelint-canon 2.0.2, @starci/eslint-canon-be 3.0.3 and @starci/eslint-canon-fe 8.0.3, so `hfs scaffold app` writes those pins.
- Added: `npm test` (bin/hfs.test.mjs, not published): the CLI loads with no installed dependency, the clean-install proof of the package (scripts/checks/package-clean-test.mjs).

## 4.0.2 - 2026-10-01

- Changed (owner correction): `.starcistacks/` and `.sops.yaml` live at the app root, beside `be/`, `fe/` and `.starciwork`. The slots `be.starcistacks` and `be.sops` are replaced by `app.starcistacks` and `app.sops` (profile app, required); `repo.side-root-forbidden` now lists `.starcistacks/` and `.sops.yaml`, so a side holding either is `HFS_FORBIDDEN_PRESENT`, and the architecture machine reports a `.starcistacks` in either side as `HFS_STACKS_IN_SIDE` (it replaces `HFS_STACKS_IN_FE`). R10 `HFS_STACKS_SHAPE` judges the app root's tree.
- Changed: the managed `.gitignore` block carries the `.starcistacks` custody rules of `modules/schemas/stacks-layout.yaml` (`custody.gitignoreRules`, in order), rooted at the app root; an app keeps no hand-written custody block.
- Changed: `hfs scaffold app` writes `.starcistacks/application-stacks.yaml` and `.sops.yaml` at the app root (they were under `be/`); `hfs work-hygiene` guards the app root's `.starcistacks/`; the Sonar key and gate are read from `.starcistacks/application-stacks.yaml` at the app root.
- Changed: R47 `test-world-files` and R84 `connection-map` read the stack of the app root from the side they judge.

## 4.0.1 - 2026-10-01

- Fixed: `hfs scaffold app` no longer writes a hand-made lockfile. The 4.0.0 stub held only the root entry, so `npm ci` in a new app failed with EUSAGE ("package.json and package-lock.json are not in sync"). Once the files are written, the scaffold runs `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` in the new app root (registry or npm cache; no node_modules, no scripts), so the lockfile resolves every dependency of the root and its workspaces and `npm ci` accepts it. If npm cannot resolve it, the scaffold exits 2 with `HFS_SCAFFOLD_LOCK_FAILED`, names the step and removes the app it began: no stub lock and no app without a lock is left. There is no switch to skip the step.
- Fixed (false positive): R14 `HFS_DEP_VERSION_SKEW` does not report a bundled copy in the lockfile (`inBundle`, a package's bundleDependencies, e.g. the tslib inside `@tailwindcss/oxide-wasm32-wasi`): it ships inside its parent's tarball and nothing in the app can move it. A fresh scaffold's real lock has one.

## 4.0.0 - 2026-10-01

- Added: the scaffolded root `package.json` (and its lockfile root entry) pins `@starci/test-world` from `knowledge/hfs/canon-pins.yaml` (1.0.0), the package whose `starci-test-stack` bin the managed `test:stack` script runs.
- Changed: R47 `test-world-files` reads `test-world.config.ts` in the shape `@starci/test-world` defines and in its one named form `export const { useTestWorld, useSandbox } = defineTestWorld({ ... })` (the form R89 allows): `stack` names the environment, a stack service is faked only by its own `stacks` entry `{ fakedBy, reason }`, and a `fakes` entry of the declaration that fakes a stack service is refused like a `fakes/<provider>/` folder. A config with no readable named declaration (a default export included) is refused. The top-level `fakedBy` and the `stacks` list of environment names are no longer read.
- New (lane SHAPE): `HFS_PEER_INTEGRATION_MISSING` (R111). The app root package.json that depends on every package of a pair of `knowledge/hfs/peer-integrations.yaml` (at the named major) declares the pair's peer in its dependencies; the first pair is `@nestjs/apollo` on `@nestjs/platform-express` 11, which requires `@as-integrations/express5`.
- Changed (lane SHAPE): `HFS_PROOF_COMMAND_FILE_MISSING` (R105) judges the records naming a side (`repository: be` or `fe`) from the app root, where their proof commands run; a record naming another repository is still not judged.
- Changed (lane SHAPE): the managed `typecheck` script of an app with fe packages runs `npm run build --workspaces --if-present` before it type-checks the fe apps, which import the packages from `dist/`.
- Changed (lane SHAPE): `hfs scaffold app` writes `.starciwork/workspace.yaml` with the repositories `[{role: be, name: be}, {role: fe, name: fe}]`, the form of the examples.
- Fixed (lane SHAPE): slot be.tests.world allows `fakes/<provider>/server.ts`, so `BE_SOURCE_FORM` reads the fake server of a provider as its role instead of refusing the path `test-world-files` accepts.
- Breaking: the app monorepo standard. A product is ONE app repository `<app>/`: the root holds the one `package.json` (every dependency of both sides and every script; npm workspaces only for `fe/packages/*`), the one lockfile and `node_modules`, `hfs.json` of kind `app`, README, CI, `.husky`, `scripts/` and `.starciwork`; `be/` and `fe/` hold what the old back-end and front-end repository roots held except `package.json` and the lockfile. `hfs.json` is `{ "hfs": 2, "kind": "app", "project", "sides": { "be": { "apps", "optionalSlots", "connections" }, "fe": { "apps", "optionalSlots", "reads": ["be/contracts/"] } } }` (manifest major 2). The standalone `be` and `fe` repository kinds (`profile`, `stacks`) are deleted, with no alias.
- Breaking: `hfs init` is deleted; `hfs scaffold app <name> [--into <dir>]` writes the root, the `be/` and `fe/` skeletons and the app hfs.json, and refuses an existing directory. The fresh app lints clean (0 findings): the be skeleton is default-deny (throttler, CSRF origin guard, AuthGuard of `domain/identity`), carries the required platform capabilities (config, logging, errors, primitives, clock, i18n, cqrs, http-security) and the health feature; the fe skeleton mounts one pages feature per route slot, drawn with `@starci/grammar`.
- Breaking: `hfs lint`, `hfs check` and `hfs sync` run at the app root. The lint runs ESLint once per side (be/ with the BE canon, fe/ with the FE canon, each from its side folder with its one-line config), stylelint over fe/, the root checks once and the side checks and the architecture machine per side ("side view": each side judged with its folder as the root), and writes one `starci/lint@1` report and one Sonar import with app-relative paths. `--changed` keeps working with app-relative files. `hfs sync` renders the root files (package.json scripts `dev:be`, `dev:fe`, `build:be`, `build:fe`, `start:<app>`, `migrate`, `lint`, `test*`, `codegen`, `contract:emit`, `typecheck`, the hooks, CI, Sonar, prettier, the .gitignore block) and each side's managed files.
- Breaking: the front end reads `be/contracts/` in place for its codegen (`sides.fe.reads`); the front-end contract copy and its `HFS_CONTRACT_SNAPSHOT_DRIFT` hash comparison are gone.
- Changed: one version per dependency in the one package.json: a conflict between the sides takes its canon pin, otherwise the higher version, pinned in `knowledge/hfs/canon-pins.yaml` with a why (`graphql` 16.14.2).
- Changed: a side finding names every path from the app root, in its message as in its path (`fe/apps/web/...`, `be/src/...`), in `hfs check` and in the ESLint and stylelint findings of `hfs lint`.
- Fixed: the architecture machine gives each file to the deepest tsconfig project that holds it, so a route file importing its feature through the app alias `@/` mounts its owner (`FE_ROUTE_FILES_THIN` reported "0 feature owners"); the skeleton route slots import through the alias. A route file binding a declaration to a Next.js segment export (`generateMetadata`, ...) is not `HFS_ALIAS_REEXPORT`.

## 3.0.0 - 2026-10-01

- Breaking: one entry, `hfs lint`. It runs the repository's eslint, the `hfs check` repository pass and, for a front end, stylelint, and writes one `starci/lint@1` report; `--sonar <file>` writes the single Sonar import (engines starci-hfs, eslint and stylelint in one document); `--changed <files...> --format json` is the land-gate shape. `hfs report`, `hfs check --sonar` and the managed scripts `lint:check`, `lint:report`, `hfs:check` and `hfs:report` are deleted; the managed `lint` script is `hfs lint`, and CI, hooks and the Sonar template read `reports/lint.sonar.json`.
- Changed: 48 TS-attached architecture checks are served to eslint through one cached project graph (the `project-graph` law of both canons); `hfs check` keeps only findings with no TS file to sit on. The machine `size-growth` is gone (eslint `file-size-growth` holds the law).
- Fixed: workspace package imports resolve to their source (package `exports`/`types` mapped from dist to src through the package tsconfig), so `hfs check` needs no build and consumed exports are not reported unused; `ARCH_OWNER_EXPORT_BYPASS` accepts every entry the package's `exports` maps.

- Changed: Back-end apps have no composition spec. App slots admit only their production composition files, and R102 rejects a spec under `apps/<app>/src`. The e2e world proves that each app boots.

## 2.0.2 - 2026-10-01

- Fixed: `hfs` printed nothing and checked nothing when started through a node_modules junction or symlink (every lane worktree, some npx shims): the entry-point test compared `argv[1]` with the resolved module path. It now compares real paths (`isMain` of `scripts/checks/common.mjs`, shared by the bin and the architecture entry). Spec: `tests/hfs-cli-worktree.spec.mjs` runs `hfs check` inside a `git worktree add` checkout with a junctioned node_modules and requires a report or a loud refusal.

## 2.0.1 - 2026-10-01

- Fixed: `hfs sync` validates the whole hfs.json declaration against the manifest before rendering (a pre-2.0 `connections` list of names is refused), so a pin bump can never leave eslint unable to start.
- Changed: the back-end managed scripts carry `test:stack` (`starci-test-stack`); repo-specific devDependencies stay the repository's (sync owns only the `scripts` block and the canon pins).

## 2.0.0 - 2026-09-30

- Added (lane PORT): the repository scripts of the product repos are gone, so their laws live here. `repo.scripts` owns `scripts/{.gitkeep,*.mjs,*.cjs,*.ps1,*.sh}` (operational scripts, or an empty folder with `.gitkeep`, which `hfs sync --init` writes from `templates/{be,fe}/skeleton/scripts/.gitkeep`). New checks: `BE_SPEC_PLACEMENT` (R102, a spec outside the four test layers, `scripts/` and `tools/` included), `HFS_REPO_LOCAL_CHECK` (R103, a `check-*` file, `eslint-local-rules*`, a local plugin, a script that runs one), `HFS_LINT_SUPPRESSION_FILE` (R104, an eslint suppressions file, script or flag), `HFS_PROOF_COMMAND_FILE_MISSING` (R105, a `.starciwork` proof command that runs a file the repository does not hold; only records of this repository are judged) and, in the architecture machine, `FE_I18N_KEYS` (R106, a key the source reads that a locale lacks, a catalog key nothing reads). `HFS_DEP_VERSION_SKEW` (R14) also refuses a dependency declared at another version than the root `overrides` pin.
- Changed (lane PORT): `hfs work-hygiene` is the secrets guard of the commit for both profiles: every staged file, read from the index, is judged by the one secret judgement of `hfs check` (`secretFileFindings`: a secret by being, an `.enc` that is no sops envelope, a line that matches a secret pattern); the front-end pre-commit hook runs it too, and it runs first in both hooks. There is no override (the old `ALLOW_SECRET_SCAN`, the plaintext twin re-encryption and the `.enc` twin sync are gone).

- Changed: the back-end skeleton (`hfs sync --init`) follows the unit standard. It writes no spec but `*.service.spec.ts` (the specs of the controller, config, errors, logging and composition are gone), the health door is thin (`LiveController` dispatches one `CheckLivenessQuery` on the injected query bus, `CheckLivenessHandler.process` is one `return this.liveness.check()`, the liveness logic lives in `domain/liveness/liveness.service.ts` with its spec at 100 percent), and the platform gains `clock` (the one reader of the ambient time), `composition` (`injector`), `cqrs` (`ICQRSHandler`, the bus decorators) and `logging` decorators and log events; role-suffixed file names (`env-source.config.ts`, `domain.error.ts`, `logging.log-events.ts`, `json-logger.service.ts`). A repository lists `@nestjs/cqrs` in its dependencies and `tslib` in its devDependencies; `@nestjs/terminus` is no longer needed by the skeleton.
- Added: `hfs new service <dir> <name> [--inject ...]` and `hfs new spec <file>.service.ts` (`scaffold/service.mjs`): a back-end `*.service.ts` is created together with its `<name>.service.spec.ts` skeleton, built with `Test.createTestingModule({ providers }).compile()` and `moduleRef.get(Service)`. The constructor is read with the repository's TypeScript compiler API; each `@Inject*()` token and each class-typed parameter becomes one provider, its double chosen from `ruleParams.be.specDoubles` of the slot manifest (the table of the lint law `spec-infra-double-from-kit`), and every public method gets one placeholder `it`. The target must be owned by a slot; nothing is ever overwritten.
- Changed: Sonar no longer depends on coverage (unit test standard rule 6). The managed `sonar-project.properties` drops `sonar.coverage.exclusions` and `sonar.javascript.lcov.reportPaths`, `knowledge/sonar-gate.yaml` has no coverage condition (the gate keeps duplication, blocker and critical issues, hotspots, and zero open imported issues), and the managed CI workflows drop the Codecov upload and its `id-token: write` permission. `codecov.yml` is no longer a managed file (slot `repo.quality-config` is `sonar-project.properties` only) and `sync` no longer asks the installed preset for `sonarCoverageExclusions`. The managed back-end `test` script is `jest --selectProjects unit --coverage` (fails below the per-file 100 threshold), and a new `test:affected` (`jest --selectProjects unit --passWithNoTests`, no coverage) is what the pre-commit and pre-push hooks run over related or changed specs, because a per-file threshold judged on a partial run would fail every service the run did not touch; the front-end `test:ci` runs `vitest run` without coverage.
- Changed: a front end has no tests by standard (owner 2026-09-30). `hfs sync` no longer renders anything for a front-end test: no `vitest.config.ts`, `tsconfig.e2e.json`, `.github/workflows/e2e.yml` or `codecov.yml`; the front-end `package.json` scripts have no `test`, `test:ci`, `test:affected`, `typecheck:e2e` or `test:e2e`; the husky hooks and `ci.yml` run no test step and no codecov upload; `sonar-project.properties` carries no `sonar.tests`, `sonar.test.inclusions`, coverage exclusions or lcov path; the root `tsconfig.json` excludes only `node_modules`; `hfs sync --init` writes no spec and no vitest config; `loadPresets` needs no preset for a front end (`@starci/vitest-preset` and `@starci/playwright-preset` are deleted). Slots: `fe.e2e`, `fe.e2e-support` and the FE test roles are deleted, `fe.tool-config-repo` is `turbo.json` only, `codecov.yml` is a back-end slot (`be.codecov`). Added: `FE_NO_TESTS` (R97), the one front-end enforcer: any spec, e2e file, test directory, test-tool file, test script or test dependency is a finding, with no exception; R66 `FE_E2E_SHAPE` and R67 `FE_SPEC_QUALITY` are retired (rule ids increase and a retired id is never reused).

- Changed: R47 `test-world-files` (`BE_TEST_TOPOLOGY`) judges the world against the repository's own stack: `fakes/<provider>/` may not fake a service `.starcistacks/<env>` declares (name, image repository or a well-known alias: postgres, redis, keycloak, a mail host, ...). One exception: a stateless GPU or external-model service that `src/tests/world/test-world.config.ts` (the test-world library's declaration; its `stacks` name the environments) declares in `fakedBy` with a non-empty `reason`; a stateful kind or a service with a persistent volume is never accepted, and a `fakedBy` entry naming a missing stack service or fake folder is refused. The stack reader is `scripts/lib/stack-services.mjs`.

- Added: `hfs emit-contracts [--repo <dir>]` and the managed script `contract:emit`: writes `contracts/<app>/schema.graphql` of every api app that serves GraphQL as `printSchema(lexicographicSortSchema(schema))`. What an app serves is read from its source: the module graph is walked from `AppModule` of `apps/<app>/src/app.module.ts` through every import (imports of imports, `register`/`forRoot`/`forRootAsync` dynamic modules, `forwardRef`, spreads, both branches of a conditional), the `GraphQLModule` `include` list is honored, and an app whose graph holds no GraphQL server is skipped; only the resolver classes of the served modules are loaded, compiled the way `tsc` compiles them (decorator metadata comes from the type checker), and Nest's `GraphQLSchemaFactory` builds the schema, so it needs no environment, database or network and never boots the app. A dependency of a resolver that cannot load where the emit runs is stood in for and listed; a graph or option the reader cannot decide is an error naming the file. TypeScript, Nest and graphql are the repository's own. The rendered `.prettierignore` skips `contracts/`.
- Added: `hfs emit-contracts` also writes `contracts/<app>/openapi.json` (OpenAPI 3.1) for an api app whose `apps/<app>/src/operations.ts` exports the typed operation table `OPERATIONS` (canon BE-OPERATIONS-1): one `POST /operations` route whose body and answer are a oneOf over the operations, each with `x-operation: "<name>@<version>"`, the input, the output and the Outcome (`ok` value or declared refusal code); the schemas are read from the TypeScript checker, sorted, deterministic, and `any`/`unknown`/`Record<string, unknown>`/unbound generics/`string` refusal codes are errors naming the operation. The full `hfs check` compares it with the committed file (R23), and an operation table without a committed `openapi.json` is a finding.
- Changed: `hfs emit-contracts` folds only what literals decide: `if`/ternary/`&&`/`||`/`??` over the literal options an app passes (`register({ features })`, const-bound literals, spreads of consts, `list.push(...)`, early `return`) are followed to the branch they select; a condition it cannot decide (an env value, a call result, a parameter with no literal, an unknown list) is kept as an undecided choice and is an error, naming file, line and condition, unless every branch serves the same resolvers. Loops/switch/try that return or change a list, and objects or server options with an unknown spread, are errors.
- Added: the full `hfs check` (never `--fast`, which says so in its coverage line) emits every back-end api app into a temp directory and compares its hash with the committed `contracts/<app>/schema.graphql`; a mismatch is `HFS_CONTRACT_SNAPSHOT_DRIFT` naming both shas and `npm run contract:emit`, and an emit that cannot run is the same code with the emit error.

- Added: a front end's managed configuration, by the same mechanism as a back end (`fe.tool-config`, `fe.package-manifest`, forbidden `fe.tool-config-local`; `fe.thin-config` and the mixed `repo.package-manifest` are gone). `hfs sync` renders `tsconfig.json` (`@starci/tsconfig/next.json`), the one-line `eslint.config.mjs`, the one-line `stylelint.config.mjs` (`loadAppTokens(import.meta.url)`), `.prettierrc`, `.prettierignore` and the `scripts` block of `package.json` (`lint:check` = one ESLint run plus stylelint over `{apps,packages}/*/src/**/*.css`; `dev:<app>` and `start:<app>` per app). `turbo.json` is the repository's own (`fe.tool-config-repo`).
- Changed: the front-end hooks and workflow: pre-commit runs eslint, stylelint and prettier on the staged files (no lint-staged), pre-push adds `format:check` and `hfs:check -- --fast`, CI runs `hfs:report`, `lint:check` (with stylelint), `format:check`, `typecheck` and `build`.
- Changed: `hfs check` judges both profiles: `HFS_RULE_OFF_WITHOUT_REPLACEMENT` also for `stylelint.config.mjs`, `HFS_TS_STRICT` for the front end's root tsconfig, `HFS_TOOL_CONFIG_LOCAL` also for a stylelint plugin, stylelint flags and a tool configuration key of a `package.json`.
- Changed: one converter for both linters, `hfs report <eslint|stylelint> <in> <out>`; `hfs report-stylelint` is removed and `sonar.eslint.reportPaths` is no longer rendered (Sonar's own ESLint import drops issues on files outside `sonar.sources`). ESLint and stylelint findings on a file Sonar does not index are filed on the first source file with the real path in the message, like the HFS findings. `sonar.externalIssuesReportPaths` lists `reports/{hfs,eslint,stylelint}.sonar.json`; a front end's `sonar.sources` and `sonar.tests` include `packages` when hfs.json opts into a package slot, and its `sonar.typescript.tsconfigPaths` gains `packages/*/tsconfig.json`.
- Changed: the front-end skeleton (`hfs sync --init`): a one-app repository keeps its next-intl stack and its one API client in the app; a repository with two or more apps writes them once as `packages/<project>-i18n` (`createAppI18n`, `./proxy`, `./request`) and `packages/<project>-api` (`request`, `Outcome`) and keeps thin adapters in each app, and `--init` refuses it unless hfs.json opts into `fe.package.i18n` and `fe.package.api`. Every app also gets a `vitest.config.ts`; the shell reads `modules/i18n` through its index.
- Changed: the machine no longer treats a `lint:e2e` command as running e2e (linting is not running), and its root-entry allowlist accepts `stylelint.config.mjs`.

- Changed: `hfs check` runs the whole architecture machine after its slot, pin and size checks. Its violations and errors are findings under the machine's own rule ids, each with the Vietnamese why of its code, and any of them exits 1. The package carries a byte copy of the machine and every file it imports, plus the failure-code slice of every code the machine can emit. The machine loads `typescript` from the checked repository; a repository without it fails with `ARCH_TYPESCRIPT_MISSING`.
- Added: `hfs check --fast [--base <ref>]`, the flag the template pre-push hook already called. It judges the owners changed since the merge-base with `origin/main` (else `main`), skipping clones, dead exports and the file-system tree checks. With no merge-base it is a refusal (exit 2) that names the fix.
- Added: `HFS_EMPTY_DIR`, `HFS_GHOST_TREE` (an empty directory beside a sibling within two edits of its name) and `HFS_UNTRACKED_ROOT_ENTRY` (entries git neither tracks nor ignores, outside an `ignored` slot): rule R03 ships as an `hfs` enforcer.
- Changed: the machine's root-entry allowlist accepts `.prettierignore`, which the slot manifest already requires.
- Changed: one code per finding. `HFS_PATH_NO_SLOT` is `HFS_SLOT_UNDECLARED` and `HFS_REQUIRED_MISSING` is `HFS_SLOT_REQUIRED_MISSING` (the rule catalog's names); `HFS_STACKS_PLAINTEXT` of `hfs work-hygiene` is `HFS_PLAINTEXT_SECRET`. The old names are gone.
- Added: the owed `hfs` enforcers ship, each with a violating and a passing spec: `HFS_PLAINTEXT_SECRET` (R06), `HFS_STACKS_SHAPE` (R10), `HFS_CI_MISSING_CANON` (R13), `HFS_DEP_VERSION_SKEW` (R14), `HFS_CONTRACT_SNAPSHOT_DRIFT` (R23), `BE_TEST_TOPOLOGY` (R47), `FE_WIRE_GENERATED` (R52), `FE_I18N_PLACEMENT` (R59) and `FE_I18N_CATALOG` (R60) in `hfs check`; `HFS_GITIGNORE_BLOCK_DRIFT` (R04) and `HFS_SONAR_CONFIG` (R11) by comparing the file with its render; `HFS_FORMAT` (R19) by running the repository's own prettier (not under `--fast`; a repository without prettier is a refusal, `HFS_FORMAT_TOOL_MISSING`).
- Changed: a plaintext secret file the slot manifest forbids (`.env`, `*.pem`, ...) is one `HFS_PLAINTEXT_SECRET` finding, no longer also `HFS_FORBIDDEN_PRESENT`.
- Changed: the rendered `sonar-project.properties` carries no `sonar.host.url` (the host comes from the CI variable and the stack declaration).
- Changed: `hfs check` needs the repository's installed jest / vitest preset (the coverage exclusions of the render) and prettier; without either it refuses (exit 2) instead of skipping the check.
- Changed: owner test layout 2026-09-30. The tests' own `src/tests/tsconfig.json` (extends the root config and `@starci/tsconfig/e2e.json`) replaces `src/tests/e2e/tsconfig.json`; the managed root `tsconfig.json` excludes `src/tests/world`, `integration`, `e2e` and `contract` (fixtures stay in the root program). Scripts `test:integration`, `test:e2e`, `test:contract` (each `npm run typecheck:tests && jest --selectProjects <name>`) and `typecheck:tests` replace `typecheck:e2e` and `test:e2e:live`. `HFS_E2E_IN_AUTOMATIC_GATE` keeps integration, e2e and contract out of hooks, coverage and automatic CI. A slot forbids the retired `src/tests/e2e/world/` (goes to `src/tests/world/`); a spec whose suffix disagrees with its folder matches no slot.

- Added: `hfs sync` renders a back end's whole tool configuration from templates and `hfs check` compares it. The managed files are the slots of `slots.yaml` that name `managedBy` (each lists literal files; `managedBy` names the template directory `templates/<profile|common>/<managedBy>/`): `tsconfig.json` (extends `@starci/tsconfig/be.json`, adds the three aliases), `tsconfig.build.json`, `src/tests/tsconfig.json`, the one-line `eslint.config.mjs`, `jest.config.js`, `.prettierrc`, `.prettierignore`, and the `scripts` block of `package.json` (`lint`, `lint:check`, `typecheck`, `typecheck:tests`, `test`, `test:integration`, `test:e2e`, `test:contract`, `format`, `format:check`, `hfs:check`, `build`, one `start:<app>` per runnable app and `migrate`), compared as parsed JSON. Only the `.gitignore` block and `.starciwork/.gitignore` remain listed in code.
- Added: `hfs check` reports `HFS_MANAGED_FILE_DRIFT` (R05), `HFS_RULE_OFF_WITHOUT_REPLACEMENT` (R17, the eslint one-liner), `HFS_TOOL_CONFIG_LOCAL` (R16, tool configs outside the managed set, local rule files, flags that swap the configuration) and `HFS_TS_STRICT` (R22, by flag). The bundle no longer holds the templates; the check that renders them lives in `sync/`.
- Changed: the back-end hooks and workflows call only managed scripts: pre-commit runs `eslint` and `prettier --check` on the staged files instead of lint-staged, CI runs `npm run hfs:check` (the second `hfs sync --check` step is gone), `format:check` and `npm test -- --coverage --ci`; pre-push adds `format:check`. The front-end templates lose the `hfs sync --check` CI step.
- Changed: templates moved under `templates/<profile|common>/<managedBy>/`; `validateHfs` compares `hfs` with the manifest major (it wrongly demanded 2); a back-end app needs a `kind`.
- Changed: the machine's root-entry allowlist accepts `.prettierrc`.
- Changed: slots. `be.tool-config` (managed), `be.tool-config-local` (forbidden), `be.package-manifest`, `be.lockfile`, `be.nest-cli` and `fe.thin-config` replace the mixed `repo.tool-config` and `repo.package-manifest`; `repo.tool-config` keeps `.editorconfig` and `.nvmrc`. `.sops.yaml` no longer claims a `managedBy` nothing renders.

- Added: one Sonar mechanism for back ends and front ends. `hfs check --sonar <file>` writes the error findings as a Sonar Generic Issue Import document (engine `starci-hfs`, rule id = the finding code, catalog English and Vietnamese text, deterministic), and `hfs report-stylelint <in> <out>` converts stylelint's json output into the same format (`report/sonar.mjs`). The managed `sonar-project.properties` sets `sonar.eslint.reportPaths` and `sonar.externalIssuesReportPaths` and no longer sets `sonar.host.url` (R11); the managed CI workflows produce `reports/eslint.json`, `reports/hfs.sonar.json` (and the stylelint reports for a front end) and run the Sonar scan and gate with `!cancelled()`; a back end's scripts gain `lint:report` and `hfs:report`; `reports/` is an ignored slot.
- Added: `HFS_SONAR_CONFIG` (R11) ships as an `hfs` enforcer: `sonar-project.properties` differs from its render, or the stack declaration names another quality gate than the bundled `knowledge/sonar-gate.yaml`. The R20 and R21 Sonar enforcers ship as conditions of that gate file (`overall`: 0 open issues, duplicated lines density, S3776).
- Changed: every finding of `hfs check --json` carries the catalog's English `title` beside `titleVi`.

## 1.0.1 - 2026-09-30

- Fixed: `package.json` now has `exports` for `./runtime/*` and `./package.json`, so other published packages can resolve the runtime copy it carries (`@starci/hfs/runtime/knowledge/hfs/slots.yaml`, `@starci/hfs/runtime/engine/yaml.mjs`) with `import.meta.resolve` or `require.resolve`, wherever the package is installed. `@starci/eslint-canon-be` 1.7.1 reads the slot manifest this way.
- Changed: `CHANGELOG.md` ships in the package (`files`).
- The bin is unchanged; the runtime copy is resynced (`canon-pins.yaml` states the new pins).

## 1.0.0 - 2026-09-30

- First registry publication: the `hfs` command line with its runtime bundle, sync files and templates.
