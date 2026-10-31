# Changelog

## 3.11.2 - 2026-10-31

- Changed: the bundled canon pins name @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.19.0, eslint-canon-be 3.11.2, eslint-canon-fe 9.8.1, stylelint-canon 2.4.0 and hfs 4.16.1 (RELEASE_VERSION_NOT_BUMPED: 3.11.1 is on npm).

## 3.11.1 - 2026-10-31

- Changed: the bundled canon pins name @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.19.0, eslint-canon-fe 9.8.0, stylelint-canon 2.4.0, hfs 4.16.0 and eslint-canon-be 3.11.1 (RELEASE_VERSION_NOT_BUMPED: 3.11.0 is on npm).

## 3.11.0 - 2026-10-31

- Changed (breaking for a lite app that kept raw SQL): R334 `no-raw-sql` is one style, no SQL text in lite TypeScript outside the test world. New messages: `query` (a `.query(` outside the world, except the one composer `platform/database/database.client.ts` with its template statements, a file `ruleParams.be.sqlPassThrough` or hfs.json `sides.be.sqlPassThrough` lists with a plain-string argument, and the `*.spec.ts` beside it; `platform/database` loses its blanket exemption), `template` (a `sql` template outside the world), `sqlFile` (a `*.sql.ts` outside the world), `sqlTagImport` (an import of `sql`, `ident`, `SqlText` or `SqlIdent` outside the world; the tag's own module `database.sql.ts` is exempt), `worldCallHelper` (a world `sql` statement that only calls a listed function: it is `callDbFunction`) and `worldTableWrite` (a world statement that writes a `public` or `be_access` table: it goes through the entity or the area's builder). `builder` and `unlisted` are kept; the world keeps raw SQL for probes.
- Changed: the R68 text names the call and LISTEN statements of `database.client.ts`; `HfsRuleParams` carries `sqlPassThrough`.
- Changed: the bundled runtime copies follow @starci/hfs 4.14.0 (R334 law, `ruleParams.be.sqlPassThrough` with the seed runner, the world allows `<name>.sql.ts`) and the canon pins name the cohort hfs 4.15.0, eslint-canon-be 3.11.0, eslint-canon-fe 9.7.0, @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.17.0.

## 3.10.1 - 2026-10-31

- Changed: the bundled canon pins name @starci/ai-router 0.5.0 (many providers behind one virtual key, the persisted key blacklist) and the cohort that carries them: hfs 4.13.3, eslint-canon-be 3.10.1, eslint-canon-fe 9.6.6, eslint-grammar-core and eslint-grammar-offset-pop 0.16.6; no rule changed.

## 3.10.0 - 2026-10-31

- Added: `ai-virtual-key-name` (R344 `BE_AI_VIRTUAL_KEY`): inside `integrations/ai` every `<env>.secret(...)` names exactly `STARCI_AI_KEY`, as a literal: the one virtual key the ai-router gateway mounts and every client uses; the custody owner `integrations/ai-gateway` passes the gateway no `adminToken`, since it exposes no admin API (ruling be-ai-one-virtual-key). Exported: `VIRTUAL_KEY_VARIABLE`.
- Changed: the bundled runtime copies follow @starci/hfs 4.13.2 (R344 in the catalog and on the `be.integrations` slot) and the canon pins name the lint cohort eslint-canon-be 3.10.0, eslint-canon-fe 9.6.5, eslint-grammar-core and eslint-grammar-offset-pop 0.16.5.

## 3.9.4 - 2026-10-31

- Changed: the bundled canon pins name @starci/hfs 4.13.1 and the lint cohort (eslint-canon-be 3.9.4, eslint-canon-fe 9.6.4, eslint-grammar-core and eslint-grammar-offset-pop 0.16.4); no rule changed.

## 3.9.3 - 2026-10-31

- Changed: the bundled canon pins name the 0.16.3 cohort (@starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.16.3, eslint-canon-fe 9.6.3, eslint-canon-be 3.9.3, stylelint-canon 2.3.0, jest-preset 2.6.0, hfs 4.13.0); ChatWorkspace and PaneLayout are removed with no alias; PaneGrid and Pane are the one generic pane grid: grammar names are generic.
- Added: `entity-extends-base` (R342 `BE_ENTITY_EXTENDS_BASE`, `src/entity-base.ts`, BE-PERSISTENCE-3, ruling entity-base), both editions: an `@Entity` class that declares a database-set `created_at` or `updated_at` itself (`@CreateDateColumn`, `@UpdateDateColumn`, or a `@Column` on those names, or on `createdAt` / `updatedAt`, with `insert: false`, `update: false` or a `default`) and, beside both, the generated uuid `id` is refused; the finding names `UuidAbstractEntity` or `AbstractEntity` of `@modules/platform/database` as the base to extend. A timestamp the application sets (a plain `@Column`) and the base file `platform/database/abstract.entity.ts` are not judged. Spec: `src/entity-base.spec.ts`.
- Changed: the bundled rule catalog adds R342 and the failure codes add `BE_ENTITY_EXTENDS_BASE`.
- Added: the lint result cache of `starci app check` (ruling app-check-cache): `crossFileInputs`, the files and folders each rule reads beyond the linted file (git-history inputs; third-party-owner walks the integrations only for integration files; an fs-audit spec proves every rule declares what it reads), and the `projectGraph` export the cache keys a file's lint record on.

## 3.9.2 - 2026-10-31

- Changed: the bundled canon pins name @starci/grammar 0.16.2 (the horizontal Stepper connector line; SurfaceListCard takes its depth from the surface context).

## 3.9.1 - 2026-10-30

- Changed: the bundled canon pins name @starci/grammar 0.16.1 (accentCorner, Backdrop, the shell filling the viewport).

## 3.9.0 - 2026-10-30

- Changed: the bundled runtime copies are now generated from the hfs build (TypeScript emitted as .mjs) per runtime/bundle.json, with a drift check in CI; the copies the package keeps as its own are listed there and stay hand-maintained; R86 sql-owner reads the columns an entity inherits from its base (UuidAbstractEntity); the bundled canon pins name hfs 4.12.0, eslint-canon-be 3.9.0, eslint-canon-fe 9.6.0, the Grammar family 0.16.0, jest-preset 2.5.3 and test-world 1.3.3.

## 3.8.21 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.22 (app check and lint pass under 20 findings), eslint-canon-be 3.8.21, eslint-canon-fe 9.5.23 and the Grammar family 0.15.34. No rule changed.

## 3.8.20 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.21 (the one-command urgent release), eslint-canon-be 3.8.20, eslint-canon-fe 9.5.22 and the Grammar family 0.15.33. No rule changed.

## 3.8.19 - 2026-10-30

- Changed: `unit-test-colocated` (R47) accepts the spec beside a file its slot declares as logic (`HfsSlot.logic`, `src/lib/unit-spec.ts`) as an optional logic-role spec, so the lite passport specs are unit specs and the spec-form rules (R48, R281) apply to them; a spec beside an undeclared file that plays no role is still refused. Spec: `src/unit-spec-declared-logic.spec.ts`.
- Changed: the bundled slot manifest carries the `logic` field (passport declares its tokens, password and cookie files) and the object-storage slot's `object-storage.*` names; the bundled `allows.mjs` and manifest shape admit them; the bundled architecture machine takes a typed-configuration JWT audience (BE_AUTH_JWT_OWN_JWKS, hfs 4.11.20); the bundled canon pins name hfs 4.11.20, jest-preset 2.5.2, eslint-canon-be 3.8.19, eslint-canon-fe 9.5.21 and the Grammar family 0.15.32.

## 3.8.18 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.19 (the schedule scanner reads interpolated identifiers and const-named SQL), eslint-canon-be 3.8.18, eslint-canon-fe 9.5.20 and the Grammar family 0.15.31. No rule changed.

## 3.8.17 - 2026-10-30

- Changed: the bundled canon pins name hfs 4.11.18 (sealed `.enc.yaml` members pass HFS_STACKS_SHAPE; the deploy schema takes `serverRecipient` and a settings list), eslint-canon-be 3.8.17, eslint-canon-fe 9.5.19 and the Grammar family 0.15.30. No rule changed.

## 3.8.16 - 2026-10-30

- Added: a `compose/<area>.ts` group may carry its area's catalogs: a typed list of error-kind tables (every value `platform/errors`' `ErrorKind`) or of `platform/i18n` `MessageBundle`s, which `compose/platform.ts` spreads into `ErrorsModule` and `I18nModule` (`app-composition-typed`, R265 `BE_COMPOSITION_UNTYPED`), so a large app keeps each compose file within its budget. An untyped catalog list, or a list of anything else, is still refused. Spec: `src/app-composition.spec.ts` (typed fixture `MessageBundle`).
- Fixed: `persisting-builder-in-builders-slot` no longer judges a raw INSERT (`.query(`) in the test world (`be.tests.world`, `be.tests.world.kit`) into a table NO entity of the program maps (`storage.objects`, a pgmq queue, a policy table) as a builder: it is a named probe of what entities cannot express, which `no-raw-sql` admits only in the test world and refuses in the builders slot. A raw INSERT into a mapped table, an entity write (`save`, `insert`, `upsert`), and any write outside the world are still builders. Specs: `src/builders.spec.ts`, `src/persisting-builder-home-coverage.spec.ts`.
- Fixed: `event-consumer-shape` names a consumer file after its event with dots AND underscores as dashes (`installation_changed` -> `installation-changed.consumer.ts`), the kebab case `source-suffix` requires of every file; the two rules could not both pass for an underscored event name. Spec: an underscored event in `src/event-bus.spec.ts` (typed fixture `InstallationChangedEvent`).
- Fixed: `jobs-scheduler-owner` requires the tick claim as `callDbFunction(tx, "public.job_tick_claim", ...)`, the schema-qualified name `no-raw-sql` lists and the hfs jobs template calls; the bare `"job_tick_claim"` could not pass both rules.
- Changed: the bundled canon pins name ai-router 0.4.0 (mounted keys), hfs 4.11.17, eslint-canon-be 3.8.16, eslint-canon-fe 9.5.18 and the Grammar family 0.15.29. No rule changed.

## 3.8.15 - 2026-10-30

- Changed: R260 `jwt-alg-pinned` (`BE_JWT_ALG_PINNED`) admits a non-Supabase OIDC verifier such as the Keycloak client of full: every `jose` `jwtVerify` still pins a non-empty literal subset of ES256, RS256 and EdDSA and derives its issuer from typed configuration, and the principal is now bound either by an `audience` that derives from typed configuration (traced like the issuer: a `*Options`/`*Config`/`*Env` parameter or property, a configuration file, a local variable or a string transformation of one) or, where the audience is the issuer-wide literal (Supabase-style `authenticated`), by rejecting every role other than authenticated before the principal is returned, as before. A verifier with neither is refused naming both. The lite Passport verifier (own ES256 tokens, configured audience) passes on its audience. Shared in `runtime/scripts/hfs/architecture/jwt-ast.mjs` (`fromConfig`, formerly `issuerFromConfig`); the bundled `rules.yaml` states the law. Specs: `src/jwt-alg.spec.ts` (role-free OIDC verifiers with a configured client id, audience list, aliased or namespace `jwtVerify` admitted; a literal, `authenticated`, missing or untyped audience, a literal issuer and insecure algorithms refused; the Passport-shaped verifier with a configured audience admitted; every Supabase-style guard case unchanged).
- Proven: R25 (`dead-exports`) counts a unit service spec and a logic client spec that import a public injection token through a `@modules` alias (`KEYCLOAK` of `integrations/keycloak`, `HTTP_CLIENT` of `platform/http`) as consumers of that entry. Spec: `src/hfs-unused-export.spec.ts`. No rule changed.
- Changed: the bundled canon pins name hfs 4.11.16, eslint-canon-be 3.8.15, eslint-canon-fe 9.5.17, the Grammar family 0.15.28 and test-world 1.3.2.

## 3.8.14 - 2026-10-29

- Changed: `inbox-dedupe-required` (R80) and `webhook-inbox-key` (R263) accept `claimRow(source, eventId, tx, receipt)` on the `EntityInbox` port of `platform/inbox` (and `claim` on an `EntityInbox`-typed receiver) as a delivery method's first await, with the same guarantees as `claim`: the real port by its owner (a lookalike is refused), the first await (R263: the first statement, keyed by the delivery id, with the transaction callback's own manager), and the return on a repeat, which for `claimRow` is the receipt id answering `undefined` (`!receiptId` or `receiptId === undefined`, inline or stored and tested straight after). A stored answer is compared by binding in either operand. The R263 receipt-port check also admits an `EntityInbox` constructor parameter. Shared in `lib/ports.ts` (`isInboxPortType`, `inboxClaimOf`, `refusesRepeat`); the typed fixture's inbox port declares `EntityInbox`. Specs: `r80-inbox-dedupe-required.spec.ts` and `webhook-handoff-inbox.spec.ts` (valid claimRow intakes; claimRow not first, on a lookalike, keyed by a constant, with another manager, with too few arguments, without the return, or returning on `false`, refused). The bundled `rules.yaml` states both laws with `claimRow`.
- Changed: the bundled canon pins name hfs 4.11.15, eslint-canon-be 3.8.14, eslint-canon-fe 9.5.16, the Grammar family 0.15.27 and jest-preset 2.5.1.

## 3.8.13 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.14, eslint-canon-be 3.8.13, eslint-canon-fe 9.5.15 and the Grammar family 0.15.26. No rule changed.

## 3.8.12 - 2026-10-29

- Changed: the bundled `runtime/scripts/lib/sops-envelope.mjs` admits an age set of one or more recipients for the selected-identity decrypt (`selectedAgeEnvelope`): the selected recipient must be one of the set, an empty entry or gap (`invalid-age-entry`) and a recipient named twice (`duplicate-age-recipient`) are refused, a dotenv envelope reads every `sops_age__list_<n>__` entry; the bundled canon pins name hfs 4.11.13, eslint-canon-be 3.8.12, eslint-canon-fe 9.5.14 and the Grammar family 0.15.25. No rule changed.

## 3.8.11 - 2026-10-29

- Fixed: `source-suffix` (BE_SOURCE_FORM, R89) admits the one file a file slot names by its path, read from the slot manifest: the lite entity registry `src/modules/platform/database/entities.ts` (slot `be.platform.database.entities`) was refused for having no role suffix.
- Changed: `no-raw-sql` (R334) exempts its two raw SQL owners by side-relative folder (`RAW_SQL_OWNERS`: `src/modules/platform/database/` and `src/tests/world/`) and keeps refusing raw SQL in integration and e2e specs, builders and fixtures; its messages send a spec author to entities on `world.db.<connection>` or a named world helper. `callDbFunction` with a listed function is allowed in specs as in domain code (ruling lite-test-sql-owner).
- Fixed: the edition gate (`pluginForEdition`) reads the rule catalog in full too, so a rule whose catalog entries name only lite is inactive in full: `no-raw-sql` (R334, `editions: [lite]`) no longer fires on a full app, whose SQL law is R36. Full used to return every rule without reading the catalog.
- Changed: the bundled canon pins name hfs 4.11.12, eslint-canon-be 3.8.11, eslint-canon-fe 9.5.13 and the Grammar family 0.15.24.

## 3.8.10 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.11, eslint-canon-be 3.8.10, eslint-canon-fe 9.5.12 and the Grammar family 0.15.23. No rule changed.

## 3.8.9 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.10, eslint-canon-be 3.8.9, eslint-canon-fe 9.5.11 and the Grammar family 0.15.22. No rule changed.

## 3.8.8 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.9, eslint-canon-be 3.8.8, eslint-canon-fe 9.5.10 and the Grammar family 0.15.21. No rule changed.

## 3.8.7 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.8, eslint-canon-be 3.8.7, eslint-canon-fe 9.5.9 and the Grammar family 0.15.20. No rule changed.

## 3.8.6 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.7, eslint-canon-be 3.8.6, eslint-canon-fe 9.5.8 and the Grammar family 0.15.19. No rule changed.

## 3.8.5 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.6, @starci/test-world 1.3.1, eslint-canon-be 3.8.5, eslint-canon-fe 9.5.7 and the Grammar family 0.15.18, and pin `undici` 6.29.0 (owner `platform/http`). No rule changed.

## 3.8.4 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.5, eslint-canon-be 3.8.4, eslint-canon-fe 9.5.6 and the Grammar family 0.15.17. No rule changed.

## 3.8.3 - 2026-10-29

- Changed: the bundled canon pins name @starci/test-world 1.3.0 (HTTPS fakes over the run's ephemeral fake CA), hfs 4.11.4, eslint-canon-be 3.8.3, eslint-canon-fe 9.5.5 and the Grammar family 0.15.16. No rule changed.

## 3.8.2 - 2026-10-29

- Added: R336 `BE_EVENT_BUS_LITE_SHAPE` (`src/event-bus-lite.ts`, contexts/code/be/event-bus.md BE-EVENT-BUS-6), lite only: `event-dedupe-key` refuses an event class of `src/modules/events/**` whose payload type has no `dedupeKey` (a literal, `EventPayload`, or an interface or alias of the file that declares it or extends `EventPayload`), and `event-subscription-static` refuses a `subscribe(queue, consumer, options?)` whose queue is not a `*_TOPIC_QUEUE` constant imported from `@modules/platform/event-bus` or whose options are not a literal object. Spec: `src/event-bus-lite.spec.ts`.
- Changed: the bundled slot manifest 3.13.0 admits `pgmq` in `ruleParams.db.extensions` (the lite event bus, ruling lite-pgmq-bus-bullmq-jobs), retires `ruleParams.db.queueOutbox` and `sides.be.queueOutbox` with the pg_cron half of R258, lists `public.event_bus_send`, `public.event_bus_read`, `public.event_bus_archive`, `public.event_bus_bury`, `public.event_bus_dead_letters` and `public.event_bus_requeue` in place of `public.event_bus_write` in `ruleParams.be.dbFunctions`, and moves slot `app.db.image` to `.starcistacks/images/db/Dockerfile` (ruling lite-db-image-in-stacks, admitted by the lite `app.starcistacks` allows); the bundled rule catalog keeps R258 `DB_PGMQ_DECLARED` as the event-bus law, retires `DB_CRON_OWNED` and adds R336 `BE_EVENT_BUS_LITE_SHAPE`; the bundled canon pins name hfs 4.11.3, eslint-canon-be 3.8.2, eslint-canon-fe 9.5.4 and the Grammar family 0.15.15. Spec `src/lite-event-bus-template.spec.ts` lints the lite pgmq event-bus templates of @starci/hfs with `no-raw-sql` (R334).

## 3.8.1 - 2026-10-29

- Changed: `no-interpolated-sql` (R68 `BE_SQL_INTERPOLATED`) knows the owner R334 names for the lite function-call statement, `platform/database/database.client.ts` of a lite app: there a `.query(` template may substitute only values whose type is a brand that file declares for the parts its validator checked (`DbFunctionPart`, `DbParameterList`); any other substitution, a `+`, the same template in any other file and the same file in full stay refused. Spec: `src/query-safety.spec.ts`.
- Changed: `no-raw-sql` (R334) tells an unlisted name to be listed schema-qualified (`public.job_claim`) in hfs.json `sides.be.dbFunctions`.
- Changed: the bundled slot manifest 3.12.0 lists the canon's database functions of R334 schema-qualified (`public.job_claim`, `public.job_tick_claim`) beside the pg built-ins it names bare (`gen_random_uuid` joins them), and its shape (`rule-params-shape.mjs`, `declaration-shape.mjs`) with the manifest check of `slots.mjs` refuses in hfs.json `sides.be.dbFunctions` a `pg_catalog` name and any bare name that is not a built-in the canon lists; the manifest bump is minor although that refusal is stricter, since R334 is new on manifest major 3 and its one app (nivo-lite) lists only names it admits (its one bare name, `gen_random_uuid`, is now a canon built-in); the bundled rule catalog's R334 and R68 laws name `platform/database/database.client.ts` as the one composer of the call statement; the bundled canon pins name hfs 4.11.2, eslint-canon-be 3.8.1, eslint-canon-fe 9.5.3 and the Grammar family 0.15.14.
- Changed: the bundled canon pins also carry the hfs 4.11.1 re-pin of db baseline --squash (R213 transaction control in migrations, extensions schema in the bootstrap), which bumped no eslint package.

## 3.8.0 - 2026-10-29

- Added: `jobs-scheduler-owner` (R335 `BE_JOBS_SCHEDULER_OWNER`, ruling lite-official-postgres-image): only `platform/jobs/job-tick.service.ts`, its spec and `jobs.module.ts` import `@nestjs/schedule` or `cron`, the `Cron`, `Interval` and `Timeout` decorators are refused everywhere, and a `job-tick.service.ts` must call `advisoryXactLock` and `callDbFunction(..., "job_tick_claim", ...)`. `infra-import-owner` (R90) reads `@nestjs/schedule` and `cron` as owned by `platform/jobs` from the bundled manifest.
- Changed: the bundled slot manifest 3.11.0 adds the managed lite slot `app.db.image` (`db/Dockerfile`), narrows `ruleParams.db.extensions` to what the official postgres image plus pgvector carries (pgcrypto, pg_trgm, vector, uuid-ossp, unaccent, btree_gist; no pgmq, pg_cron, pg_net or supabase_vault) and gives `@nestjs/schedule` and `cron` one owner, `platform/jobs`, in `infraOwners`; the bundled rule catalog adds R335 `BE_JOBS_SCHEDULER_OWNER` and its R250 and R276 laws name the platform/jobs tick and the db image; the bundled canon pins name hfs 4.11.0, eslint-canon-be 3.8.0, eslint-canon-fe 9.5.2 and the Grammar family 0.15.13 and pin `@nestjs/schedule` 6.1.3 (CommonJS on the Nest 11 line) and `cron` 4.4.0.

## 3.7.1 - 2026-10-29

- Changed: the entity registry (persistence.md BE-PERSISTENCE-3, Debug ruling on lite-persistence-typeorm-entities): the bundled slot manifest 3.10.0 adds the lite slot `be.platform.database.entities`, the entity registry (slot fields `role: entity-registry` and `importedBy`, validated by the manifest shape); the bundled architecture machine reads it (`architecture/entity-registry.mjs`): `tier-direction` (R26 `BE_TIER_DIRECTION`) admits the registry's import of a domain or platform capability's `index.ts` that binds only that capability's `<c>Entities`, and `owner-export-bypass` (R30 `ARCH_OWNER_EXPORT_BYPASS`) admits a direct import of the registry from the files `importedBy` names (`apps/*/src/compose/*.ts`, `apps/*/src/app.module.ts`, `src/tests/world/**`); every other import of either shape stays refused, and full has no registry. `import-owner-entry` (R30) admits the deep path `@modules/platform/database/entities` from the same importers only. Spec: `src/entity-registry.spec.ts`.
- Changed: the bundled canon pins name hfs 4.10.1, eslint-canon-be 3.7.1, eslint-canon-fe 9.5.1 and the Grammar family 0.15.12.
- Changed: the owner-cycle check (R27 `ARCH_OWNER_CYCLE`) counts the entity registry as a unit of its own, not part of `platform/database`, so naming every `<c>Entities` closes no cycle among capabilities while any other platform/database file importing a domain still does (spec in `src/entity-registry.spec.ts`); the bundled rule catalog's R26 and R30 laws name the entity registry.

## 3.7.0 - 2026-10-29

- Added: the `auth-passport` law (contexts/code/be/api-auth.md BE-AUTH-2): `own-jwks-only` (R329 `BE_AUTH_JWT_OWN_JWKS`) refuses `createRemoteJWKSet`, `decodeJwt` and `decodeProtectedHeader` of jose anywhere and `jwtVerify` outside `integrations/passport`; `refresh-token-cookie-only` (R330 `BE_AUTH_REFRESH_COOKIE`) refuses a `refreshToken`/`refresh_token` property or member and a refresh cookie set or cleared outside `integrations/passport`.
- Added: `no-raw-sql` (R334 `BE_PERSISTENCE_NO_RAW_SQL`, lite): no `.query(` and no `sql` template outside `platform/database`, and `callDbFunction` names only a listed database function.
- Changed: `no-raw-sql` also refuses a query builder that names no entity (`createQueryBuilder("orders", "o")`, `createQueryBuilder()`) and `getRepository(...)` outside `platform/database`: a builder is `createQueryBuilder(Entity, "alias")` on the injected EntityManager.
- Changed: `no-folder-reexport` admits, in lite only, a capability's `persistence/entities/index.ts` that declares its `<c>Entities` list (BE-PERSISTENCE-3); the machine `schema-owner` (R35) checks the lite shape (the list and its name in `PRIMARY_ENTITIES`), and the dead-export count already counts `<c>Entities` once `PRIMARY_ENTITIES` names it (spec added).
- Changed: `app-file-budget` (R246 `BE_APP_COMPOSITION_BUDGET`) counts a slot file's lines excluding import declarations, a multi-line import included, so naming one more capability costs no budget; the numbers are unchanged (`<app>.env.ts` 150 in both editions).
- Changed: the bundled slot manifest 3.9.0 replaces the lite `app.supabase*` slots with `app.db` (`db/migrations`, `db/migrations/archive`, `db/seed.sql`, the managed `db/bootstrap.sql`), `be.integrations.supabase` with `be.integrations.passport` and `be.integrations.object-storage`, removes `fe.route.callback`, sets lite `schemaAuthority: sql`, gives lite TypeORM entities in `be.persistence`, adds `ruleParams.be.dbFunctions`, and moves the S3 SDKs to `integrations/object-storage` and the identity libraries to `integrations/passport` in `infraOwners` (`@supabase/*`, `minio` and `bcrypt` nowhere); the bundled rule catalog retires R216, R217, R219, R254 and R287 and adds R328-R334, so `infra-import-owner` holds R328 `BE_AUTH_PASSPORT_OWNER` and R331 `BE_STORAGE_OWNER`; R36 runs in full only; `jwt-alg-pinned` reads `architecture/jwt-ast.mjs`; the bundled canon pins name hfs 4.10.0, eslint-canon-be 3.7.0, eslint-canon-fe 9.5.0 and the Grammar family 0.15.11, pin `@nestjs/passport` 11.0.5 (CommonJS on the Nest 11 line), `passport` 0.7.0, `passport-google-oauth20` 2.0.0, `passport-local` 1.0.0, `bcryptjs` 3.0.3 and their types (tokens are signed and verified with `jose`; `@nestjs/jwt` stays allowed in `integrations/passport` but unpinned), and drop `@supabase/ssr`, `@supabase/supabase-js` and the `supabase` CLI.


## 3.6.8 - 2026-10-29

- Added: the `ai-gateway` law (contexts/code/be/ai.md). `provider-key-custody` (R326 `BE_AI_KEY_CUSTODY`) refuses an upstream provider key variable (`PROVIDER_KEY_VARIABLES` of `src/ai-gateway.ts`, the one list: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and the rest, with their `_FILE` twins) named in a literal, a member or a property anywhere but the gateway's custody owner `integrations/ai-gateway`, specs and the test world included. `ai-client-through-gateway` (R327 `BE_AI_GATEWAY_CLIENT`) lets code build only `ChatOpenAI` and `OpenAIEmbeddings` of `@langchain/openai` (found by import), each from an inline options object with no spread, `configuration.baseURL` a member of a `<c>.options.ts` type and `apiKey` the `reveal()` of a `platform/config` `Secret`.
- Changed: the bundled slot manifest gives the model libraries their owners in `ruleParams.be.infraOwners` (`@starci/ai-router` to `integrations/ai-gateway`, `@langchain/*` to `integrations/ai`; `openai`, `langchain`, `@langchain/langgraph`, `@langchain/community` and the provider SDKs nowhere) and lists R326 and R327 on `be.integrations`, so `infra-import-owner` (R90) holds LangChain in one integration and refuses provider SDKs and agent frameworks; its `nowhere` message names the model and agent owners. The bundled rule catalog carries R326 and R327; the bundled canon pins name hfs 4.9.11, eslint-canon-be 3.6.8, eslint-canon-fe 9.4.9, the Grammar family 0.15.10 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), and pin `@langchain/core` 1.3.1 and `@langchain/openai` 1.8.0.

## 3.6.7 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.9.10, eslint-canon-be 3.6.7, eslint-canon-fe 9.4.8, eslint-grammar-core 0.15.9 and eslint-grammar-offset-pop 0.15.9. No rule changed.

## 3.6.6 - 2026-10-29

- Changed: the bundled canon pins name the Grammar family 0.15.8 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), eslint-canon-fe 9.4.7 and eslint-canon-be 3.6.6. No rule changed.

## 3.6.5 - 2026-10-29

- Changed: `starci-be/em-injection-slots` (R88) admits `platform/http-security` as a persistence capability: it owns the shared rate limit windows (BE-AUTH-4), and its guard counts in them through the primary `EntityManager`. Spec: `src/connections.spec.ts`.
- Changed: the bundled canon pins name hfs 4.9.9 and eslint-canon-be 3.6.5.
- Changed: the bundled canon pins name the Grammar family 0.15.7 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.6. No rule changed.
- Changed: the bundled canon pins name the Grammar family 0.15.5 (grammar, eslint-grammar-core, eslint-grammar-offset-pop). No rule changed.
- Changed: the bundled rule catalog states R225 with the app pre-push hook's dependency push gate (`starci deps check`). No rule changed.

## 3.6.4 - 2026-10-28

- Changed: the bundled rule catalog carries R324 and R325 (the Grammar page frame laws), and the bundled canon pins follow release G (Grammar family 0.15.4, hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4, ai-router 0.3.0). No rule changed.

## 3.6.3 - 2026-10-28

- Changed: the bundled rule catalog carries R323 (the Grammar page header law), and the bundled canon pins follow release F (Grammar family 0.15.3, hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3, ai-router 0.3.0). No rule changed.

## 3.6.2 - 2026-10-28

- Changed: the bundled canon pins follow release E (Grammar family 0.15.2, hfs 4.9.3, canon-fe 9.4.2, canon-be 3.6.2, ai-router 0.3.0) and pin no `starci-harness`: an app's CLI is the version of the CLI that runs @starci/hfs. No rule changed.

## 3.6.1 - 2026-10-28

- Fixed: the published declarations of `loadHfs` and `starciBeConfig` name the emitted `dist/lib/hfs-view.d.ts`, not the untyped `runtime/scripts/hfs/view.mjs`, so a consumer's typed lint of the managed `be/eslint.config.mjs` no longer reads an error type (`no-unsafe-assignment` at 3:33). The view's shapes live in `src/lib/hfs-view.ts`; the runtime functions are read through `#runtime/*`. Spec: `src/published-declarations.spec.ts`.
- Changed: the bundled runtime's `repo-identity.mjs` names a repository by its origin remote (hfs 4.9.2).
- Changed: the bundled canon pins follow release D (Grammar family 0.15.1, hfs 4.9.2, canon-fe 9.4.1, canon-be 3.6.1, starci-harness 1.1.0-alpha.2), so an app installs the released versions without pin drift.

## 3.6.0 - 2026-10-28

- Changed: the package is TypeScript built to JavaScript. Source and specs live in `src/*.ts` (strict, no `any`, no
  suppressions), `npm run build` emits `dist/` with declarations, and `exports`/`main`/`files` point at `dist/`. The
  package specifier and every export (`starciBeConfig`, `loadHfs`, the plugin, `rules`, `recommended`, `ruleOwners`,
  `lawOwners`, `ruleDeclarations`, `linterOptions`) are unchanged. No rule changed behaviour; the spec count is unchanged.
- Added: `@typescript-eslint/utils` as a dependency for the rule and AST types (already installed with
  `@typescript-eslint/eslint-plugin`).
- Changed (specs): the front-end canon is loaded through its package entry (`fixtures/sibling-canon.mjs`), not a source
  path; `fixtures/gathered-plugin.mjs` lists law modules by `.mjs` or `.ts`.
- Changed: the bundled canon pins follow release C (Grammar family 0.15.0, hfs 4.9.1, canon-fe 9.4.0, canon-be 3.6.0,
  jest-preset 2.4.1, stylelint-canon 2.2.1, tsconfig 2.1.0, prettier-config 1.1.0, and `@starci/ai-router` 0.2.1
  pinned), so an app installs the released versions without pin drift.
- Fixed: the built declarations name `.js`, not the `.ts` sources (`tsc` keeps a relative `.ts` specifier in a `.d.ts`).

## 3.5.0 - 2026-10-27

- Changed: the bundled runtime copies follow the retirement of `@starci/cli`: the bundled canon pins replace the retired `@starci/cli` with `starci-harness` 1.1.0-alpha.1 (`source: cli/package.json`), the one command line a product installs for `starci app`, and follow the harness packages (Grammar family 0.14.0, hfs 4.9.0, canon-fe 9.3.0, canon-be 3.5.0); the runtime finds an app's `starci` bin in its installed `starci-harness`. No rule changes.

## 3.4.57 - 2026-10-27

- Changed: the bundled runtime copy follows the two-grammars ruling: the Grammar catalog declares `core` and `offset-pop` only, and the canon pins follow the harness packages. The spec fixture app selects `core`. No rule changes.

## 3.4.56 - 2026-10-27

- Changed: licensed MIT (was UNLICENSED); the package metadata names the repository, homepage and bugs so npm can attach provenance. No rule or behaviour changed.

## 3.4.55 - 2026-10-26

- Changed: the bundled runtime copies and canon pins move with the alpha.31 cohort (light push gate, owner rulings of 2026-10-26).

## 3.4.54 - 2026-10-26

- Changed: the bundled canon pins follow the final package versions (Grammar 0.12.12 with the lint families, the event-stream package). No rule changes.

## 3.4.53 - 2026-10-26

- Changed: the bundled canon pins follow the final package versions (Grammar 0.12.11 with the lint families). No rule changes.

## 3.4.52 - 2026-10-26

- Changed: the alpha.31.1 round folded into alpha.31; the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 3.4.51 - 2026-10-26
- Changed: the bundled runtime copies follow the hfs 4.7.44 and cli 1.7.44 pins and the lint family versions (the runtime install file carries the wave version). No rule changes.

## 3.4.50 - 2026-10-26
- Changed: R280 reads one assignment-target index per run (bundled hfs copy); the bundled runtime copies follow the hfs 4.7.43 and cli 1.7.43 pins and the lint family versions. No rule changes.

## 3.4.49 - 2026-10-26
- Fixed: `BE_SQL_TABLE_OWNER` (R86) bounds a FROM-less SELECT and an aggregate-only SELECT as one row; `IN (`, `FROM (` and `FILTER (` are no longer read as unknown function calls.
- Changed: the bundled runtime copies follow the hfs 4.7.42 and cli 1.7.42 pins and the lint family versions.

## 3.4.48 - 2026-10-26
- Changed: the bundled runtime copies (canon pins) follow the hfs 4.7.41 and cli 1.7.41 pins and the lint family versions. No rule changes.

## 3.4.47 - 2026-10-26
- Changed: the bundled runtime copies (canon pins, rules, slots and the declaration shape) follow the hfs 4.7.39 and cli 1.7.39 sources (R258 cron outbox, the integration scripts slot). No rule changes.

## 3.4.46 - 2026-10-26
- Changed: the bundled runtime copies (canon pins) follow the stylelint 2.0.13, hfs 4.7.38 and cli 1.7.38 pins. No rule changes.

## 3.4.45 - 2026-10-26
- Changed: the bundled runtime copies (canon pins, front-end stack, rules and the Grammar index) follow the alpha.31 sources. No rule changes.

## 3.4.44 - 2026-10-26
- Fixed: R80 delegated claims map arguments over runtime parameters and reject spreads, effects hidden in `const` preparation, protected or replaced helpers, and runner or manager unions containing lookalikes. Private helpers (including `#private`) and independently judged public delivery helpers retain the transaction proof; public overrides preserve the claim's manager binding and prelude restrictions, including widened parameters and arrow properties. Every declared runner and manager origin must match its owner.

## 3.4.43 - 2026-10-26
- Changed: `inbox-dedupe-required` (R80 `BE_INBOX_DEDUPE_MISSING`) accepts a delivery whose one write transaction hands its work to a typed helper: the sole `.transaction(...)` runs on typeorm's `EntityManager` or on a port the `platform/database` owner declares, its arrow callback returns `this.<method>(..., tx, ...)` of the same class (resolved by the checker), and that async helper claims first with the never-reassigned manager parameter and returns on `false`. The database port also runs the inline claim callback. A helper that never claims, claims after other work or under a condition, claims with another manager, a lookalike runner, a callback that hands work to another object or detaches it, and an ignored claim answer stay refused; every form refused before stays refused.

## 3.4.42 - 2026-10-26
- Changed: `operation-table-schemas` and `operation-contract-decidable` leave alone a stub table a spec keeps to itself, but judge one a spec exports (`export const`, `export { }`, `export default`); `rest-route-declared` never counts a table made in a spec as the app's declared table. The same stub table in a production file stays refused.
- Changed: R95 requires named zod input/output schema exports for every `defineOperations` entry (`operation-table-schemas`) and a canon `OperationValidationPolicy` constructed with the same table on the route body (`operation-route-driven-by-table`). Schema provenance and route binding are proved in both editions, including strict empty inputs, aliases, mismatched tables and local imitations.

## 3.4.41 - 2026-10-25
- Changed: the bundled canon pins select @starci/stylelint-canon 2.0.11, @starci/hfs 4.7.33 and @starci/cli 1.7.33.

## 3.4.40 - 2026-10-25
- Changed: the bundled canon pins select @starci/grammar 0.11.0, @starci/hfs 4.7.32 and @starci/cli 1.7.32.

## 3.4.39 - 2026-10-24
- Changed: the operation-route rule refuses a body no `OperationValidationService` validates, and the bundled canon text matches the lint (array bounds, shared throttler storage, pagination home, the operation table shape).
- New: the realtime lint recognises the SSE door (`be.feature.realtime.sse`, a hub-only `@Sse` controller under `transport/sse`); the bundled slot manifest and rules carry the amended R212.
- New: `schema-place` (R304 `BE_SCHEMA_PLACE`: `zod` is imported only from a `<name>.schema.ts` of a domain, platform or integrations owner; never in a feature, a transport door or a `dto/` folder; a schema file imports no `class-validator`, `class-transformer` or `@nestjs/graphql`) and `schema-bounded` (R305 `BE_SCHEMA_BOUNDED`: every `z.string()`, array, set, record and map has an upper bound, and `z.any()`, `z.unknown()` and `z.json()` are refused).
- Changed: the bundled slot manifest declares the `schema` role suffix and the `zod` pin is `side: both`.

## 3.4.38 - 2026-10-24
- Changed: the bundled canon pins add the multer 2.5.0 security override and select @starci/hfs 4.7.30 and @starci/cli 1.7.30.

## 3.4.37 - 2026-10-24
- Changed: the bundled canon pins select zod 4.6.7, @starci/hfs 4.7.29 and @starci/cli 1.7.29.

## 3.4.36 - 2026-10-23
- Changed: the bundled rule catalog and slot manifest name the specs that moved into this package (they drive its rules and fixtures and now pass from its own clean install); 3.4.35 was published with the old spec paths and is superseded.

## 3.4.35 - 2026-10-23
- Changed: `BE_AMBIENT_ID` has no exemption for the test world (owner ruling 2026-10-22: a loosening is always red); the world asks the injected `Ids` port like everything else.
- Changed: the bundled canon pins select @starci/hfs 4.7.28 and @starci/cli 1.7.28.

## 3.4.34 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.27 and @starci/cli 1.7.27.

## 3.4.33 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.26 and @starci/cli 1.7.26.

## 3.4.32 - 2026-10-23
- Changed: the bundled canon pins select @starci/hfs 4.7.25 and @starci/cli 1.7.25.

## 3.4.31 - 2026-10-23
- Changed: the `spec-no-skip` rule text says nothing skips, the contract layer included: a missing sandbox is a failing test of `sandbox.describe` from `@starci/test-world` 1.2.3.
- Changed: the bundled canon pins select @starci/hfs 4.7.24 and @starci/cli 1.7.24.
- Changed: no Sonar way rule is left to the server (owner ruling 2026-10-22, no loosening): S3403 `different-types-comparison`, S3800 `function-return-type`, S3782 `argument-type` and S6582 `@typescript-eslint/prefer-optional-chain` run at error, `unicorn/consistent-function-scoping` runs with its default options (arrow functions included). S7785 (top-level await) is recorded as not applicable to a CommonJS back end (`SONAR_WAY_NOT_APPLICABLE`).
- Added: the `@typescript-eslint/no-unsafe-assignment`, `-member-access`, `-call`, `-return` and `-argument` rules at error.

## 3.4.30 - 2026-10-22
- Changed: the bundled canon pins select @starci/hfs 4.7.23 and @starci/cli 1.7.23.

## 3.4.29 - 2026-10-22
- Changed: the bundled canon pins select @starci/hfs 4.7.21 and @starci/cli 1.7.21.

## 3.4.28 - 2026-10-22
- Fixed: Sonar way parity with the server: the injected-constructor-aware `max-params` (S107) replaces core `max-params`, and the ports that report what the server does not on the same source (S1481 `no-unused-vars`, S3403 `different-types-comparison`, S3782 `argument-type`, S3800 `function-return-type`, S6582 `prefer-optional-chain`) are left to the server; NIVO (0 issues on the server) lints at 0 instead of 205 under 1.7.19.
- Changed: the bundled canon-pins and failure-code copies follow the 1.7.20 cohort; lint behavior is unchanged.

## 3.4.27 - 2026-10-21
- Changed: supersedes 3.4.26 (app lint broken: the canons' Sonar way block carries its own ignores, which `starci app lint` refused as an unsupported source scope, so it exited 2 without running ESLint and reported 0 findings); 3.4.26 is not used.
- Changed: the bundled canon-pins copy follows the 1.7.19 cohort (cli 1.7.19, hfs 4.7.19); lint behavior is unchanged.

## 3.4.26 - 2026-10-21
- Changed: supersedes 3.4.25, published from a lane whose history the owner refused (an unapproved allowlist entry) and therefore a superseded orphan that is not used; this version carries the same work plus the standalone scaffold fix.
- Added: Sonar way at lint time: every rule of the Sonar way TypeScript profile with an ESLint equivalent is on at error over the files the scan judges (a unit or end-to-end spec is outside), from the shared `scripts/lib/sonar-way.mjs`: eslint-plugin-sonarjs' Sonar way set (cognitive complexity 15, super-linear and slow regex, sort compare, nested template literals, ...) and the rules SonarSource builds on (`max-params` 7, `no-duplicate-imports`, `@typescript-eslint/prefer-optional-chain`, unicorn's `prefer-native-coercion-functions`, `prefer-includes`, `prefer-set-has` and the other S77xx rules). New exact dependencies eslint-plugin-sonarjs 4.2.1 and eslint-plugin-unicorn 65.0.0 (the last line for ESLint 9).
- Changed: the bundled canon-pins copy follows the 1.7.18 cohort (cli 1.7.18, hfs 4.7.18, jest-preset 2.3.4).

## 3.4.24 - 2026-10-21
- Changed: the bundled canon-pins copy follows the 1.7.16 cohort (cli 1.7.16, hfs 4.7.16); lint behavior is unchanged.

## 3.4.23 - 2026-10-21
- Changed: bundled runtime copies carry slot manifest 3.4.0 (`be.contract.mcp-tools`) and rule R302; lint behavior is unchanged; canon pins follow the matching package cohort.

## 3.4.22 - 2026-10-20
- Changed: republished for the complete 1.7.14 cohort; 3.4.21 was published while @starci/hfs 4.7.14 and @starci/cli 1.7.14 stopped at their clean proof, so it is a superseded orphan and is not used. Content equals 3.4.21 apart from the canon pins.

## 3.4.21 - 2026-10-20
- Changed: bundled runtime copies carry the HFS hooks-installed check (`HFS_HOOKS_NOT_INSTALLED`) the R47 staged-spec law and the R165 component-to-app law; lint behavior is unchanged; canon pins follow the matching package cohort.

## 3.4.20 - 2026-10-20
- Changed: republished for the complete alpha.24 cohort; 3.4.19 was published alone by an interrupted publication and bundles a canon-pins copy taken before the cohort was complete, so it is not used.

## 3.4.19 - 2026-10-20
- Fixed: bundled runtime source clears the SonarCloud code smells of alpha.23 (regex complexity, concise classes, string prefix and suffix checks, block braces, optional chaining, export-from, default parameters, synchronous awaits, dead stores) without behavior change; canon pins follow the matching package cohort.

## 3.4.18 - 2026-10-19
- Fixed: bundled runtime source analysis retains nullable contracts and explicit callback arguments; canon pins follow the matching HFS and CLI cohort.

## 3.4.17 - 2026-10-19
- Changed: bundled canon pins follow the native CLI and HFS provisioning cohort; back-end lint rules are unchanged.

## 3.4.16 - 2026-10-19
- Changed: bundled canon pins follow the regenerated Stylelint vocabulary and the matching HFS and CLI cohort; back-end canon rules are unchanged.

## 3.4.15 - 2026-10-19
- Changed: bundled canon pins follow @starci/hfs 4.7.9, @starci/cli 1.7.9 and the matching lint canon cohort for the lite development guidance update; back-end canon rules are unchanged.

## 3.4.14 - 2026-10-19
- Changed: bundled runtime and canon pins follow @starci/hfs 4.7.8, @starci/cli 1.7.8 and the matching lint canon cohort for the catalog provenance repairs; back-end canon rules are unchanged.

## 3.4.13 - 2026-10-19
- Changed: bundled canon pins follow @starci/hfs 4.7.7, @starci/cli 1.7.7 and @starci/eslint-canon-fe 8.4.13; back-end canon rules are unchanged.

## 3.4.11 - 2026-10-18
- Changed: bundled canon pins follow @starci/hfs 4.7.5 and @starci/cli 1.7.5 for the managed Codecov coverage scope correction; canon rules are unchanged.

## 3.4.10 - 2026-10-18
- Changed: bundled canon pins follow @starci/hfs 4.7.4 and @starci/cli 1.7.4 for the Sonar analyzer heap property correction; canon rules are unchanged.

## 3.4.9 - 2026-10-18
- Changed: bundled canon pins advance with both lint canons after the interrupted alpha.22 package publication; canon rules are unchanged.

## 3.4.8 - 2026-10-18
- Changed: bundled runtime pins follow @starci/hfs 4.7.3 and @starci/cli 1.7.3 for the alpha.22 typecheck heap repair; canon rules are unchanged.

## 3.4.7 - 2026-10-18
- Changed: bundled runtime copies follow the alpha.22 re-cut (canon pins hfs 4.7.2, cli 1.7.2, jest-preset 2.3.2); canon rules are unchanged.

## 3.4.6 - 2026-10-18
- Changed: bundled runtime copies follow the alpha.22 re-cut (canon pins hfs 4.7.1, cli 1.7.1); canon rules are unchanged.

## 3.4.5 - 2026-10-18
- Changed: bundled runtime copies follow runtime 1.0.0-alpha.22 (failure codes, the rule catalog with R301 and the candidate trigger laws, canon pins); canon rules are unchanged.

## 3.4.4 - 2026-10-18
- Changed: bundled runtime copies follow runtime 1.0.0-alpha.21 (canon pins, failure codes, the narrowed secret patterns); canon rules are unchanged.

## 3.4.3 - 2026-10-18
- Changed: bundled runtime copies include the refreshed canon pins for the alpha.20 patch set; canon rules are unchanged.

## 3.4.2 - 2026-10-17

- Changed: bundled runtime copies follow runtime 1.0.0-alpha.20, including the canon pins and shared architecture checks.

## 3.4.1 - 2026-10-17

- Changed: the bundled runtime copies follow the runtime of 1.0.0-alpha.19 (owner ruling no-runtime-specs, 2026-10-17): the failure codes, the slot manifest (`exampleNa`) and the rule catalog (`specNa`, `exampleNa`) carry the removal of the runtime's own specs; package behavior is unchanged.
- Fixed (R263 `BE_WEBHOOK_SCOPE`, a18.1 NIVO requests G and J): a third-party OAuth redirect (a GET route with `PublicReason.AuthHandshake` on a path that is not a webhook or events path) is no longer judged as a webhook door (owner ruling `oauth-redirect-not-webhook`); a call on a domain receipt port (no base class, constructor of platform ports only, one of them the Inbox) inside the receipt transaction is the inbox record and not processing (owner ruling `webhook-receipt-port`); an intake that does process the delivery is now reported with its own `intake` finding instead of the signed-metadata text.
- Known gaps (planned for alpha.19, Nest lifecycle conformance): no enforcer yet for exactly one validation pipe per app, for interceptors limited to logging, timeout and serialization and registered once, or for the absence of authentication middleware. Templates and examples conform today: one `APP_PIPE`, no interceptor, security-headers middleware only.
- Added: `no-guard-injects-guard` (R41 `BE_DEFAULT_DENY`, a18 lifecycle conformance): a guard class (implements `CanActivate` or named `...Guard`) has no constructor parameter that is another guard (a `...Guard` or `CanActivate` type, `Type<CanActivate>`, or `@Inject(SomeGuard)`); the app registers `RateLimitGuard`, `OriginGuard`, `CredentialGuard` and `AuthGuard` as four global `APP_GUARD`s and `@Credential({ kind })` selects the credential behavior.
- Added: R278 `BE_REST_DOOR_EVIDENCE` / `BE_REST_ROUTE_UNDECLARED` accept a credential-guarded route (owner ruling `credential-guarded-rest-door`, 2026-10-16): `@Credential({ kind: "<literal>" })` from the domain identity capability on the route or controller, with the capability declaring a `CredentialGuard implements CanActivate`, resolved by TypeScript symbol. A local decorator, another `@UseGuards` guard and a computed kind still fail.
- Fixed (R281 `BE_SPEC_FORM_ALL_ROLES`, a18 NIVO request A): `spec-infra-double-from-kit` judges a function subject by the callable subset of the sibling's exports (constants, enums, `export ... from` re-exports and overload signatures no longer disable the check; overloads collapse to the implementation); a value-object subject (an undecorated class whose constructor parameters carry no injection token) may be built with `new` (`spec-no-new-subject`, `spec-builds-with-testing-module`, and `useValue: new Subject(...)` in `spec-infra-double-from-kit`) while a decorated or token-injected class stays mandatory; a member of a kit `mock<T>()` object (`mock<{ open: F }>().open`) counts as a kit double.

## 3.4.0 - 2026-10-15
- Added: `module-definition-required` (R295 `BE_MODULE_DEFINITION_MISSING`, owner ruling 2026-10-15 `owner:module-definition-everywhere`): every `<x>.module.ts` of a feature, capability or projection has a sibling `<x>.module-definition.ts` and `<x>.options.ts`, its class extends the `ConfigurableModuleClass` of that definition, and a module of the product is listed in an `imports` array only as `X.register(...)`.
- Changed: `capability-module-shape` judges the definition of every module: the representative module of a capability keeps `.setExtras({ isGlobal: false }, ...)` and the one `register` override; a sub-module, feature, transport module or cli group builds `.setClassMethodName("register").build()` and overrides nothing. A module definition in a feature is no longer refused.

## 3.3.1 - 2026-10-15
- Changed: version-only republish. 3.3.0 was published first and the bundled canon-pins copy then moved with the rest of the alpha.14 package set (hfs 4.3.0, canon-fe 8.3.0, cli 1.3.0); 3.3.0 is superseded and no longer pinned anywhere.

## 3.3.0 - 2026-10-14
- Added: the app file role `<app>.env.ts` (150-line budget, `app-file-budget`): `config-owner` lets `main.ts` and the app's env file parse the environment; `app-options-composition-free` also refuses a module list or `register`/`forRoot` call in it, and it imports no feature.
- Changed: `background-unowned` decides by context (processor, scheduler, saga, event handler and what they call; a resolver or controller is never background) instead of by method name.
- Changed: `webhook-verify-first` and `webhook-shape` accept a first call to a declared domain verifier (`...Verifier` service or a verifier the webhook module declares) beside `WebhookSignatureService.verify`; `feature-thin` treats that proof as a gate call.
- Changed: the bundled architecture machine carries `HFS_DUPLICATE_CODE` canon-shape exclusions, staged dead-export consumers and the `<app>.env.ts` role.


- Added: law `app-composition` (R245 and R246, owner ruling 2026-10-14). `app-options-composition-free` (`BE_APP_OPTIONS_COMPOSITION`) keeps `apps/<app>/src/<app>.options.ts` to env-derived options and port bindings (provider maps such as `{ approvalGate: X }`): an array that lists a `*Module` class, a `X.register(...)`/`forRoot(...)`/`registerQueue(...)` call, a `*SchedulerOf(...)`/`*Queue(...)` entry or a spread of such a list, and an `imports`, `modules`, `schedulers` or `processors` array are refused, pointing to `compose/<area>.ts`. `app-file-budget` (`BE_APP_COMPOSITION_BUDGET`) holds `main.ts` (80), `<app>.options.ts` (200), `compose/<area>.ts` (120) and `app.module.ts` (250) to the `budget` of their app slot; the budget is absolute. The role of an app file is the slot entry it matches (`lib/app-roles.mjs`), never a path list.
- Changed: `is-global-only-in-app` accepts `isGlobal: true` in the composition groups `apps/<app>/src/compose/<area>.ts` (they are part of the app root), and the bundled architecture machine reads an app's root and its groups as one composition (register-once, module-per-transport, the connection and context maps).
- Changed: carry the runtime mirror of HFS manifest 3.1.0 (rule catalog 3.1.0) and the canon pins of eslint-canon-fe 8.2.17, HFS 4.3.0 and CLI 1.2.16.

## 3.2.19 - 2026-10-14

- Changed: carry the canon pins of eslint-canon-fe 8.2.18, HFS 4.2.17 and CLI 1.2.17 in the runtime mirror. ESLint rule implementations are unchanged.

## 3.2.18 - 2026-10-14

- Changed: carry the runtime mirror with the dead-exports fix (an import by a sibling declared entry is a use) and the canon pins of eslint-canon-fe 8.2.17, HFS 4.2.16 and CLI 1.2.16. ESLint rule implementations are unchanged.

## 3.2.17 - 2026-10-13

- Changed: the bundled canon-pins copy carries `@heroicons/react` 2.2.0 and `@starci/heroicons` 0.3.3 in place of `@phosphor-icons/react` (the heroicons family is the one icon set, owner ruling 2026-10-13) and the pins of eslint-canon-fe 8.2.16, HFS 4.2.15 and CLI 1.2.15. ESLint rule implementations are unchanged.

## 3.2.16 - 2026-10-13

- Changed: republish of 3.2.15 with the same rules; the release resumed after a partial publish, so the bundled canon-pins copy moves with the packages published after it (release-plan bundling rule).

## 3.2.15 - 2026-10-13

- Changed: carry the runtime mirror of HFS manifest 3.0.0 (the lite edition re-ruled as full minus self-hosted infrastructure) and the canon pins for Grammar 0.9.14, HFS 4.2.14, jest-preset 2.2.7 and CLI 1.2.14. ESLint rule implementations are unchanged.

## 3.2.14 - 2026-10-12

- Changed: carry the merged runtime mirror and canon pins for Grammar 0.9.13, Stylelint canon 2.0.9, HFS 4.2.13 and CLI 1.2.13. The bundled HFS manifest 2.2.0 recognizes declaration-only ambient owners; ESLint rule implementations are unchanged.

## 3.2.13 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.12 (the secondary tab track keeps its padding).

## 3.2.12 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.11 (secondary Tabs are HeroUI's own pill tabs).

## 3.2.11 - 2026-10-12

- Changed: bundled canon pins carry @starci/grammar 0.9.10 (the grammar ships without spec suites).

## 3.2.10 - 2026-10-12

- Changed: refresh the bundled canon pins for CLI 1.2.9, HFS 4.2.9 and the FE lint canon 8.2.10 after correcting the CLI runtime install pin; ESLint rule implementations are unchanged.

## 3.2.9 - 2026-10-12

- Changed: refresh the bundled runtime and canon pins for grammar 0.9.9, stylelint-canon 2.0.8, CLI 1.2.8 and HFS 4.2.8; ESLint rule implementations are unchanged.

## 3.2.8 - 2026-10-12

- Changed: refresh the bundled canon pins for grammar 0.9.8; behaviour is unchanged.

## 3.2.7 - 2026-10-12

- Changed: refresh the bundled canon pins for grammar 0.9.7 and heroicons 0.3.3; behaviour is unchanged.

## 3.2.6 - 2026-10-11

- Changed: refresh the bundled canon pins for CLI 1.2.5 and HFS 4.2.5; command and lint behavior is unchanged.

## 3.2.5 - 2026-10-11

- Changed: refresh the bundled canon pins for stylelint-canon 2.0.7 and cli 1.2.4; behaviour is unchanged.

## 3.2.4 - 2026-10-11

- Changed: refresh the bundled canon pins for @starci/grammar 0.9.3; lint rules are unchanged.

## 3.2.3 - 2026-10-11

- Changed: refresh the bundled canon pins for @starci/grammar 0.9.1; lint rules are unchanged.

## 3.2.2 - 2026-10-11

- Changed: refresh the bundled canon pins for the alpha.9.1 package bindings.

## 3.2.1 - 2026-10-10

- Changed: refresh the bundled canon pins for the queue-template package patch; lint rules are unchanged.

## 3.2.0 - 2026-10-09

- Changed: the bundled runtime copies (engine config, architecture machine, slot manifest, canon pins, failure codes) follow the runtime of 1.0.0-alpha.9; no rule is added or removed. Version 3.1.0 on the registry carries the copies of an earlier runtime.

## 3.1.0 - 2026-10-08

- New: the `sonar-parity` law (R235 `SCAN_SMELL`): `no-await-in-loop` (S9382), `prefer-code-point` (S7758), `prefer-string-raw` (S7780), `no-nested-conditional` (S3358), `no-void-operator` (S3735), `no-unused-import` (S1128) and `prefer-export-from` (S7763), each the syntax-tree form of the Sonar rule SonarCloud flagged in the example apps, shared with the front-end canon through the bundled `runtime/scripts/lib/sonar-syntax-rules.mjs`. The factory also turns on the typescript-eslint rules `no-deprecated` (S1874), `no-base-to-string` (S6551) and `require-await` (S7503).

- New: `feature-thin` (R203 `BE_FEATURE_THIN`, law `feature-thin`): a feature-tier file of a role of `ruleParams.be.thinRoles` (handler, resolver, controller, consumer, processor, step, saga, saga-step, compensation, webhook, gateway, subscription, cli, mapper, the saga orchestrator service) maps its parameters and makes ONE delegating call into modules/, with no branch, loop, ternary, try, throw or computation. The slot manifest copy gains `coverage` on every tracked be slot and `ruleParams.be.logicRoles` and `thinRoles`.
- Changed: `unit-test-colocated` also allows `<name>.<role>.spec.ts` beside a logic role (policy, client, guard, mapper, ...) inside a slot whose coverage is required; the spec stays required only for the roles of `ruleParams.be.unitRoles`, and the texts say so.
- Changed: `no-repository-class` (R83) accepts `platform/saga` as a platform persistence capability (state of a saga run with its version fence).
- New: `service-isolation` (R168 `BE_SERVICE_ISOLATION`, new law `service-isolation`): a file of a service app imports no file of a sibling service app. The slot manifest copy gains `be.contract.events` and `events.ts`/`consumes.ts` in the api and worker app slots.
- New: `no-ambient-id` (R142 `BE_AMBIENT_ID`): `randomUUID` of Node's crypto, the `uuid` generators `v1`/`v4`/`v6`/`v7`, `nanoid` and `ulid` are used only inside `platform/ids`, specs included; code asks the `Ids` port and specs use `fakeIds()`.
- New: `response-cookie-attributes` (R141 `BE_COOKIE_ATTRIBUTES`): a cookie written through the Express or Fastify response states `httpOnly: true`, `secure: true` and `sameSite` `lax` or `strict` in typed options, and `Set-Cookie` is never written as a header.
- New: `injected-param-name` (R85): a parameter that injects a port of the table `ruleParams.be.paramNames` of the slot manifest (`Clock`, `Logger`, `Cache`, `CommandBus`, `QueryBus`, `EntityManager`, `*Options`) carries the name that table gives it.
- Changed: `secret-compare-timing-safe` (R41) also recognises, by type, the `.digest()` of a crypto `Hash` or `Hmac`.
- Changed: the texts of `unit-test-colocated` and the law headers name the four test kinds and the pattern files; the bundled runtime copies follow.

## 3.0.7 - 2026-10-01

- Changed: the runtime layer check moves test-secrets onto api/sops/decrypt.mjs; bundled copies follow.

## 3.0.6 - 2026-10-01

- Changed: the runtime api layer (lib/git.mjs became api/git/lib.mjs), R112 and the dead-exports pairing, test-world 1.0.5 and the integration test shape.

## 3.0.5 - 2026-10-01

- Changed: bundled slots.yaml (workflow worktree), sonar-gate.yaml (service coverage) and canon-pins.

## 3.0.4 - 2026-10-01

- Changed: the bundled runtime copy of knowledge/hfs/canon-pins.yaml pins @starci/test-world 1.0.3. No rule or command changed.

## 3.0.3 - 2026-10-01

- Changed: the bundled canon-pins copy pins @starci/stylelint-canon 2.0.2, @starci/eslint-canon-fe 8.0.3 and @starci/hfs 4.0.3. No rule changed.

## 3.0.2 - 2026-10-01

- Changed: the bundled runtime copies (slots, canon-pins, failure codes, the architecture machine) put `.starcistacks` and `.sops.yaml` at the app root (`app.starcistacks`, `app.sops`; a side holding either is refused, `HFS_STACKS_IN_SIDE`) and pin @starci/hfs 4.0.2 and this canon at 3.0.2. No lint rule changed.

## 3.0.1 - 2026-10-01

- Changed: the bundled runtime copy of knowledge/hfs/canon-pins.yaml pins @starci/hfs 4.0.1 (the scaffold resolves a real lockfile) and this canon at 3.0.1. No rule changed.

## 3.0.0 - 2026-10-01

- Fixed (lane SHAPE): `source-suffix` (R89 `BE_SOURCE_FORM`) accepts `src/tests/world/fakes/<provider>/server.ts`: an allows entry of the owning slot whose last segment is the literal file name is that file's role (be.tests.world allows `fakes/<provider>/server.ts`). `fakes/<provider>/<name>.server.ts` is still refused (`server` is no role suffix).
- Breaking: the app monorepo standard (hfs 4.0.0). `loadHfs(import.meta.url)` in `be/eslint.config.mjs` finds the app-root `hfs.json` (kind `app`) one level up and gives every linted file the view of the be side (paths relative to `be/`); a standalone back-end `hfs.json` (`profile: be`) is refused. The project graph (`project-graph` law) is built per side from the side folder. The config stays the managed one-liner.
- New (lane c0-orphan): `replacement-throw-carries-cause` (R108 `BE_ERROR_CAUSE_DROPPED`, law error-handling). A `throw` that escapes a `catch` or a promise `.catch` handler rethrows the caught value or carries it (as `cause` of the capability error); a `catch` with no binding throws nothing new. A value the rule cannot see through (a parameter, a call handed the caught value, a variable built from it) counts as carrying. Replaces the unrun foreign-cause script adapter of the retired code-pattern folder.
- New (lane c0-orphan): `require-public-member-jsdoc` (R109 `BE_MEMBER_DOC_MISSING`, law comments). Every public member of an exported class, interface or object type alias opens with JSDoc; private, protected and `#` members, the constructor, index signatures and a property set to a literal or a named constant are not judged, overloads share one doc, and the test tiers (`e2e`, `fixtures`) are out of scope. Replaces the unrun member-documentation script adapter of the retired code-pattern folder.
- New `service-deps` law (lane SVC, restored by lane RESTORE after merge `9958cce38` dropped it): `provider-param-token` (R85: a constructor parameter of a class carrying a `@nestjs/*` class decorator is typed by a class or carries an `Inject<Thing>()`), `no-repository-class` (R83: a class, or an exported function taking an EntityManager first, outside an application handler, a domain service, a platform persistence capability, the migrate app, `src/tests` and a migration takes, holds or returns an `EntityManager`, `Repository`, `DataSource` or `QueryRunner`) and `no-test-double-in-source` (R89: no `Mock`, `Fake` or `Stub` word in the name of a class, function or exported constant outside specs and `src/tests`).
- Changed: `named-entity-manager-only` (R83) also refuses a `DataSource`/`QueryRunner` written as a type, an awaited value or a `provide:` `useValue`/`useFactory` outside the platform database capability, the migrate app, the test world and migrations, and a constructor parameter typed by a class that exposes one.
- Changed: `no-event-bus` (R87) also refuses `new EventEmitter()`/`extends EventEmitter`, `new Subject/BehaviorSubject/ReplaySubject/AsyncSubject` and a class that stores callbacks in a Set/Array/Map property and registers a callback parameter into it.
- New (lane AUTHCHK): `auth-door-strict-rate-tier` (R42). A door opened for `PublicReason.AuthHandshake` or `PublicReason.SignedWebhook` (the reason's TYPE is the member of `PublicReason` of `domain/identity`) carries a decorator whose argument is `RateTier.Strict` of `platform/http-security`, on the method or on its class. BE-CONVENTION 1.7 made this a MUST, and nothing checked it until now.
- New (lane AUTHCHK): `http-client-only-in-integrations` (R90). A call on the `HttpClient` port of `platform/http` (judged by the receiver's type) is made only in an `integrations` owner, in `platform/http` and in the test world. A domain service that calls an identity provider's token or admin endpoint, or a mailer API, directly is refused (BE-INFRA-3).
- New (lane AUTHCHK): `no-secret-in-error` (R71). A `new X(...)` whose type derives from `Error` carries no value typed by the `Secret` brand, nor one read out of it. It also carries no text value whose own name, or whose key, says it is a credential. The name test is the one `secret-compare-timing-safe` uses, now exported as `isCredentialName`. Personal identifiers are not judged.
- Changed (lane AUTHCHK): `secret-compare-timing-safe` (R41) also refuses an equality on a value typed by the `Secret` brand of `platform/config`, or read out of one (`secret.reveal() === x`), whatever it is called. Its credential words gain `authorization`.
- Fixed (lane AUTHCHK): `config-parsed-in-main` (R43) is back. The merge `9958cce38` (merge main into lane/ut-int, round 2) resolved `config-owner.mjs` and its test to the blob from before the rule existed. That dropped the rule, the test world's `process.env` allowance and the removal of the name-based `envConfig()` check, together with its catalog enforcer, README row, failure-code text, code-patterns id and contract change `hfs-be-config-parsed-in-main`. The rule and its fixture files are restored exactly as `d5f11c337` left them.

## 2.1.2 - 2026-10-01

- Fixed: a local export list (`export { x }`, no module specifier) crashed the backend machine behind the project-graph rules (`Cannot read properties of undefined (reading 'kind')` in every file of a repository that has one). The packed-load spec covers it.

## 2.1.2 - 2026-10-01

- Fixed: `duplicate-code` and every project-graph rule failed to load in a repository with a local export list (`export { x }`, no module specifier): the backend machine read `moduleSpecifier.kind` of an absent specifier. The packed-load spec now carries such an export.

## 2.1.1 - 2026-10-01

- Fixed: every rule failed to load in product repositories ("the managed package-scripts template ... cannot be found next to the runtime"): the bundled runtime now carries the data files the architecture machine reads beside its code (the managed package-scripts templates, canon-pins and the Sonar gate). A new runtime spec, `tests/canon-packed-load.spec.mjs`, installs each canon from its packed tarball into a real HFS repository and requires every rule to load.

## 2.1.0 - 2026-10-01

- New: the `project-graph` law: the TS-attached architecture checks (tiers, owners, dead exports, composition, data, paths) as eslint rules at error on the offending line, from one cached project graph per lint run.
- New: `spec-exact-values` (R48): `expect.any(String|Number|Date)` in a `*.service.spec.ts` is refused; ids come from `fakeIds()` and dates from `FakeClock` and are asserted exactly.

- Changed: Back-end apps have no composition spec, including the migrate app. `unit-test-colocated` has no app exception; only service unit specs and the integration, e2e and contract layers remain.

## 2.0.1 - 2026-10-01

- Fixed: `e2e-asserts-persisted-state` accepts `<world>.db.<connection>` and `<world>.services.<name>.api` state reads, the world identified by its `TestWorld` type (from `@starci/test-world` or the `be.tests.world` slot), not by a variable name.

## 2.0.0 - 2026-09-30

- Changed (lane PORT): `ruleParams.be.infraOwners` names `@nestjs/cache-manager` (the `CACHE_MANAGER` token) beside `cache-manager`: it is reached only by `integrations/cache` and `integrations/redis`, which is the retired repository rule `must-use-cache-service`; `infra-import-owner` (R90) covers it with a passing and a violating case.
- Changed (lane UT): `inbox-dedupe-required` (R80) moves from the door to the service. It judges the public methods of a `*.service.ts` whose first parameter TYPE has an `eventId` property: the first awaited expression must be `claim(source, eventId, ...)` on the `Inbox` port, with an early return on `false`. Consumers and `SignedWebhook` controllers are no longer judged by it, and `transport-is-thin` no longer allows an `Inbox` injection or an inbox guard in a door.
- New `spec-exact-values` (R48, unit-spec law): a `*.service.spec.ts` never asserts `expect.any(String)`, `expect.any(Number)` or `expect.any(Date)` (`expect` resolved as the jest global or the `@jest/globals` import); ids come from `fakeIds()` and dates from `FakeClock`, so the spec asserts the exact value.
- Changed: `transport-is-thin` allows `unwrapOutcome` of `platform/primitives` (resolved by its symbol) beside the bus call and pure mapper functions.
- Fixed: `infra-needs-injector` (R85) no longer judges the constructor of a CQRS message (`extends Command<R>` / `Query<R>` of `@nestjs/cqrs`): its `params` is data built with `new`.
- Changed (lane UT, unit-test standard 2026-09-30): `unit-test-colocated` (R47) no longer keeps twin specs for handlers, guards, mappers, policies, clients and row mappers. Only a service is unit-tested: a `<name>.service.ts` has its `<name>.service.spec.ts` beside it (message `missing`), a unit spec (a `*.spec.ts` outside `src/tests/{e2e,integration,contract,world}` and `apps/migrate`) must be a `<name>.service.spec.ts` beside its service (`notService`, `orphan`), and a composition spec is no longer a unit kind.
- New `unit-spec` rules (R48 `BE_SPEC_QUALITY`): `spec-builds-with-testing-module`, `spec-no-new-subject`, `spec-module-definition-only-providers`, `spec-no-module-mock` (own modules and third-party libraries), `no-return-only-generic` (cast laundering in a spec or a test fixture) and `spec-infra-double-from-kit`, which reads the token-to-double table from `ruleParams.be.specDoubles` of the slot manifest (`knowledge/hfs/slots.yaml`).
- Changed: `spec-typed-entity-manager` (R48) requires the EntityManager double to be `mockEntityManager()` or `fakeTransaction()` imported from `@starci/jest-preset`; `src/tests/fixtures/database.ts` is no longer a source, and `mock<EntityManager>()` is refused.
- New `builders` law (R48 `BE_SPEC_QUALITY`, knowledge BE-TEST-16, lane BLD): `spec-no-raw-insert` (a spec, unit service spec, integration or e2e, never runs a raw INSERT/UPDATE/DELETE and never calls `save`/`insert`/`upsert`/`update`/`delete`/`remove` on a receiver typed `EntityManager`, `DataSource` or `QueryRunner`; reads stay allowed) and `builder-arranges-only` (a `*.builder.ts` has no `expect`/jest global, no `Date.now()`/argless `new Date()`/`Math.random()`/`randomUUID()`/`crypto.random*`, and no SQL that switches constraints off). The builder file name and folder are a BE_SOURCE_FORM finding of the slot manifest (`be.tests.fixtures.builders`).
- New (lane BLD, BE-TEST-16): `persisting-builder-in-builders-slot` (R98), `spec-no-repeated-row-literal` (R99) and `tests-keep-constraints` (R100). `spec-no-raw-insert` (R99) also reads a tagged-template statement; `builder-arranges-only` (R101) judges the builders slot through the HFS view and no longer judges constraints (R100 does, for every file of `be.tests.*`, plus `dropForeignKey(s)`, `dropCheckConstraint(s)` and `dropUniqueConstraint(s)` on a QueryRunner). `spec-no-raw-insert` moved from R48 to R99 and `builder-arranges-only` from R48 to R101; the catalog has one rule per builder obligation.
- New `cqrs` rule `handler-is-thin` (R87): a handler injects only `*Service` classes and the Logger, and `process` is one `return this.<service>.<method>(...)`.
- Changed: `transport-dispatch-only` is replaced by `transport-is-thin` (R88), which keeps its injection and one-dispatch checks and adds: no branch, loop or throw, no call other than the bus, the inbox claim and pure `*.mapper.ts` functions (the R80 inbox guard `if (!(await this.inbox.claim(...))) return` is the one allowed `if`), and a route method returns the dispatch result. There is no alias for the old name.
- Changed: `spec-infra-double-from-kit` also accepts a value whose declared type is a kit type (`MockEntityManager`, `FakeCache`, `FakeLock`, `RecordingOutbox`, `FakeClock`, `FakeIds`, or a `ReturnType` of the kit function): a spec helper parameter, `tx.em` of a `fakeTransaction(...)`, inline `fakeTransaction(...).em`.
- Fixed: `no-ambient-clock` (R79) exempts the whole test world, `world/kit` included, not only its root slot.
- Added: the Operations law (R95 `BE_OPERATION_CONTRACT`, `operations.mjs`): `operation-contract-decidable` refuses an `OperationContract` whose input or output is `any`, `unknown`, `Record<string, unknown>`, an unbound generic, a function or a standard-library class, or whose refusal codes are not a closed union of string literals; `operation-route-driven-by-table` requires a route that takes `OperationRequest<Table>` or answers `OperationReply<Table>` to do both, of one table. The canon types are recognised by where they are declared (the platform capability `operations`).
- Changed: `no-non-ascii-source` (R89) folds each line to NFC before it looks for a Vietnamese letter, so a decomposed spelling is caught like the precomposed one, and it exempts the i18n fixtures slot `be.tests.fixtures.i18n` (`src/tests/fixtures/i18n/`) beside the message-catalog slots; a test title, an identifier and a string in any other spec or fixture are still refused. The detection is `scripts/lib/language.mjs`, shipped in `runtime/`.

- Changed: the messages and header of `tests-no-override` and `tests-infra-only-in-world` (`test-world.mjs`) follow the owner refinement 2026-09-30 of R47: a service of the repository's own stack runs real and is failed on purpose through `world.infra.<service>`, only an external SaaS is a network fake (`world.fake.<provider>`). Detection is unchanged.
- Breaking: one configuration, `export default starciBeConfig({ hfs: loadHfs(import.meta.url) })`. The factory is async
  (ESLint awaits it), turns typed linting on for every `.ts/.mts/.cts/.js/.mjs/.cjs` (`parserOptions.projectService`),
  ignores only `dist/`, `coverage/`, `node_modules/`, borrows `@typescript-eslint/{consistent-type-assertions (never),
  no-explicit-any, no-non-null-assertion, no-floating-promises, no-misused-promises, switch-exhaustiveness-check}` and
  puts the repository's slot view in `settings.starci.hfs` (`lib/hfs.mjs`: `slotOf`, `tierOf`, `ownerOf`, `ruleParams`,
  `connections`). It takes no globs, ignores or overrides. `sources`/`plugin`/`recommended` parameters are gone.
- Breaking: every rule ships at `error` in `recommended` (the six `warn` levels are gone); the factory refuses any other level.
- Breaking: `lib/slots.mjs` (which reached into the runtime checkout) is deleted; the manifest ships in `runtime/`
  (byte copy kept by `packages/hfs/scripts/sync-runtime.mjs`). New `lib/types.mjs` answers what a node's TYPE is
  (`typeOrigins`, `isPackageType`) for the type-aware rules.
- Removed: the SAB-only `cdc` and `event-delivery` laws (`projection-listener-contract`, `no-dynamic-projection-group-id`,
  `projection-recompute-must-upsert`, `nats-bridge-delivery-contract`, `no-call-site-transport-override`).
- Breaking (slot sweep, RE1): `type-safety`, `spec-quality`, `testing`, `e2e-flow`, `suppression` and `size-budget` ask the slot view (`hfsOf(context)`) and the file's basename role instead of a path pattern. No rule of these laws exempts a spec or a test lane.
- Removed: `no-never-cast`, `no-non-null-assertion`, `no-double-cast`, `no-unguarded-unknown-cast` (R72) and `spec-typed-doubles` (R48): the borrowed `consistent-type-assertions` (`never`) and `no-non-null-assertion` the factory turns on state exactly the same obligation for every file, specs included. One obligation, one rule.
- New: `no-function-or-eval` (R72: the `Function` type, `eval` and `new Function`, the type escapes the borrowed rules do not cover).
- Removed: `harness-calls-provider-directly` (R48; a `harness` spec kind no longer exists, BE-CONVENTION 1.16).
- Changed: `unit-test-colocated` (R47) requires a twin `.spec.ts` beside a handler, domain service, consumer, job, guard, mapper, policy, client and `*.rows.ts` (by slot and basename role), a subject beside every spec, and refuses `.test.ts`, `.int-spec.ts` and `.harness-spec.ts`.
- Changed: `e2e-asserts-persisted-state` recognises a state read by the TYPE of the receiver (a typeorm `EntityManager`, `DataSource` or `QueryRunner`), not by a variable name; `e2e-uses-production-transport` recognises a bus by its `@nestjs/cqrs` type and an actor by the file (`*.handler.ts`, `*.consumer.ts`, `*.job.ts`) that declares its type; `no-sleep-in-flow` recognises a wait by its shape (a timer, or a `Promise<void>` call given one number); `no-wiring-in-flow-spec` recognises `Test` by its `@nestjs/testing` import; `no-model-call-in-e2e` and `no-marker-model-stub` ask the slot (`be.tests.e2e-live`, `be.tests.fixtures`, `be.tests.e2e-setup`).
- Changed: `no-inline-suppression` (R18) also refuses `eslint-env`, `/* global */`, `istanbul`/`c8`/`v8 ignore`, `NOSONAR`, `sonar-disable` and `prettier-ignore`, and finds a `@ts-` directive anywhere in a comment.
- Changed: `file-size-growth` (R20) takes no option: the `max` and `recorded` options are gone, the budget is `ruleParams.be.fileLines`, the baseline is git. A spec, a fixture and an e2e file are governed like any source file; a migration and a declaration file are not.
- New `cqrs` rules (R87 `BE_CQRS_SHAPE`): `message-typed-result` (a class of `<action>.command.ts`/`.query.ts` extends `Command<R>`/`Query<R>` imported from `@nestjs/cqrs`, with one `readonly params` parameter property), `execute-params-shape` (`params` is `ExecuteParams<X>`/`PublicExecuteParams<X>` declared by `platform/cqrs`; no `@Entity` class reachable from `X`), `no-use-case` (no `*.use-case.ts`, no `*UseCase` class in the application slots, no forwarder `<op>.service.ts` whose every method is `return <bus>.execute(...)` on a `CommandBus`/`QueryBus`), `no-event-bus` (no `EventBus`, `EventsHandler`, `IEventHandler` from `@nestjs/cqrs`, nothing from `@nestjs/event-emitter`).
- Changed: `handler-overrides-process` and `message-carries-params-only` read their scope from the slot (`be.feature.application`), find a handler by the resolved `CommandHandler`/`QueryHandler` import and its template by type (the `ICQRSHandler` of `platform/cqrs`); a handler that does not extend the template is refused, an intermediate base that implements `process` is followed through the type. A message may declare no property and its constructor body is `super()`. The CLI-command exemption (decorated classes) is gone: CLI commands are `.cli.ts` in their own slot.
- New `transport` rules (R88 `BE_TRANSPORT_SHAPE`): `transport-is-thin` (a transport class injects only `CommandBus`/`QueryBus`, plus `RequestLocale` from `platform/i18n` in `transport/http` and `Inbox` from `platform/inbox` in `transport/http` and `transport/message`; every handler method calls `<bus>.execute(` exactly once), `no-response-envelope` (the envelope classes and decorator of the convention, a repository interceptor whose `intercept` maps the response with rxjs `map`, an object literal with `success` and `data` returned from a method), `no-graphql-json` (the JSON scalars of `graphql-type-json`/`graphql-scalars` by import and by re-export, `@Body()` typed `unknown` or a bag of unknowns, `switch (x.operation)`).
- Changed: `door-lives-in-features` (a `@Controller` outside slot `be.transport.http`), `no-capability-imports-features` (an import resolved by the TypeScript program into tier `feature` from a domain, platform or integrations file) and `rest-door-needs-a-reason` (a public reason `Health`/`AuthHandshake`/`SignedWebhook`, a `StreamableFile`, `Redirect`, upload interceptor or `createReadStream` in the class, judged by resolved imports) read the slot view and types instead of path patterns and route names. The `probe`, `machine` and `operator` route heuristics are gone.
- New `naming` rule `no-default-export` (R89): no `export default`, `export { x as default }`, `export { default } from` or `export =` in TypeScript source, except a Jest `*.global-setup.ts` in slot `be.tests.e2e-setup`.
- Changed: `no-non-ascii-source` exempts only message catalogs (slots `be.domain.messages`, `be.feature.messages`); the test-lane exemption for strings is removed, specs and fixtures get the same law.
- New law `infra-owner` with `infra-import-owner` (R90 `BE_INFRA_OWNER`): an import (static, dynamic, `require`, `export ... from`, subpaths included) or a global reference (`fetch`, `setTimeout`, `globalThis.setInterval`) of a library in `ruleParams.be.infraOwners` outside its owning capability is refused; `[]` means nowhere. Specs are included.
- Slot manifest: `ruleParams.be` gains `infraOwners`, `suffixes` and `bannedSuffixes` (validated by `scripts/lib/hfs-slots.mjs` and `modules/schemas/hfs-slots.schema.yaml`); `be.feature.application` no longer allows `use-case`, `be.feature.application.support` allows `<name>.<role>.ts` only, the CLI slot allows `<name>.cli.ts`. `hfs check` reports `BE_SOURCE_FORM` for a tracked `src/`/`apps/` `.ts` outside the closed suffix vocabulary; the architecture machine's `BE_SOURCE_NAME_INVALID` is renamed `BE_SOURCE_FORM`.
- New helpers `lib/import-source.mjs` (resolved import of an identifier, `moduleReferences`) and `lib/transport-slots.mjs`; the typed fixture gains `src/` capabilities (`platform/{cqrs,i18n,inbox,graphql}`, an entity, a feature), stubs for `rxjs`, `graphql-type-json`, `graphql-scalars` and `typeorm`'s `Entity`, and `tester.mjs` raises the default-project file limit so a law can test many virtual files.
- New: `error-home` (rewritten, R38: a class deriving from `DomainError` only in `errors/<capability>.error.ts` of its owner, a class deriving from the built-in `Error` without `DomainError` refused, both by type), `throw-domain-error` (R38: the thrown value's type derives from `DomainError`; `throw new Error`, the Nest `HttpException` family and thrown non-class values are findings; a domain owner throwing a platform error is one too) and `error-family-shape` (R38: one `<C>ErrorCode` enum with `<CAPABILITY>_<WHAT>` values, one `<C>_ERROR_KINDS: Record<<C>ErrorCode, ErrorKind>` table, one empty `<C>Error extends DomainError<<C>ErrorCode>`).
- Changed: `catch-must-account` (R40) accepts a call of a method on a receiver typed `Logger` from `platform/logging`; the receiver-name list is gone.
- Changed: `public-needs-reason` (R41) takes `{ reason: PublicReason.X }` with the enum of `domain/identity` (type-aware); a string or another enum fails. `no-untyped-body` reads the transport slot instead of a path.
- New: `no-auth-use-guards` (R41: any `@UseGuards(...)`; authentication is the global `APP_GUARD` chain). Removed: `identity-needs-guard` (superseded by it and by the machine's `default-deny-app-guard`).
- New: `input-bounded` (R42: every property of an input class in a transport `dto/` folder carries a `class-validator` decorator, plus the bound its type calls for). Removed: `dto-needs-validator` (merged into it). New: `no-offset-pagination` (R42: `skip`/`offset` in `find*` options on an `EntityManager`, `OFFSET` in an `sql` template, `page`/`pageNumber`/`offset` on a transport DTO).
- Changed: `no-direct-env-read` (R43) allows the process environment only in the file that declares the `EnvSource` class in `platform/config`, and refuses every form (`process.env`, destructuring, `Reflect.get`, an `env` import of `node:process`), `@nestjs/config`, `dotenv`, `envConfig()` and a `process.cwd()` path joined into `src` or `.starcistacks`; specs are no longer exempt.
- Changed: `no-secret-default` (R44) is rewritten on types: a default argument to an `EnvSource` reader of `Secret`/`Url`, a `??`/`||`/`??=` fallback on a `Secret` or `Url` value, and a `""`, `localhost`, `127.0.0.1`, `0.0.0.0` or `http(s)://` literal given to any reader returning one. No key-name matching remains.
- New: `no-global-decorator` (R45: any `@Global()`, specs included), `is-global-only-in-app` (R45: `isGlobal: true` only in `apps/<app>/src/app.module.ts`), `no-cross-owner-module-import` (R45: a `@Module({ imports })` entry declared by another owner). Removed: `global-module-allowlist`, with `ruleParams.be.globalModules` in the slot manifest. Changed: `static-module-register` allows only `register` (no `forRoot`, `forFeature`, `registerAsync`); `no-new-injectable` decides by the class declaration (a provider decorator), not by a name suffix; `no-module-let` and `one-module-per-file` no longer exempt specs.
- New: `capability-module-shape` (R45: the representative `<c>.module.ts` of a domain, platform or integrations capability extends the `ConfigurableModuleClass` imported from its own `./<c>.module-definition` and may override only `static register(options: typeof OPTIONS_TYPE): DynamicModule`; the module definition builds `new ConfigurableModuleBuilder<XOptions>().setExtras({ isGlobal: false }, ...).build()`; every sub-module and every feature module is a plain `@Module` class with no base, no `register` and no module definition).
- Dependencies: `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` ^8.70; peer `typescript` >=5.9; node >=22.13.
  The 1.7.1 dependency on `@starci/hfs` (and its sibling-workspace fallback) is gone: the package carries its own
  manifest copy in `runtime/`, one resolution path, no fallback.
- New law `injection` (R85 `BE_RAW_INJECT`, type-aware: a callee is identified by where its function is declared, never by a variable name; specs are not exempt):
  `injector-only` (`Inject(`, `InjectEntityManager(`, `InjectDataSource(`, `InjectQueue(`, `InjectRepository(` and any package function named `Inject*` are called only in a `*.decorators.ts` at an owner root; a raw `@Inject(...)` decorator, property injection and an injector on a non-constructor parameter are findings),
  `injector-shape` (zero-parameter, `TypedParameterDecorator<T>` from `platform/composition`, body `injector<T>(token)`, PascalCase name, JSDoc naming `T`; exported tokens are `unique symbol = Symbol("<owner>.<thing>")`; `provide:` is a class or a `unique symbol`),
  `injector-type-match` (the `T` of the injector equals the parameter annotation), `infra-needs-injector` (a constructor parameter typed by a platform/integrations declaration or a package carries an injector; only domain services and same-owner types are class-injected),
  `no-module-ref`, `no-forward-ref`, `no-string-token` (a string or template literal, or a string-typed value, as `Inject(...)`/`injector(...)`/`provide:` token; a string literal argument of `getEntityManagerToken`/`getDataSourceToken` outside `<conn>.connection.ts`).

### Persistence rules (lane C0 RA)

- New law `connections`: `one-connection-per-database` (R84 `BE_CONNECTION_DUPLICATE`) and `em-injection-slots` (R88 `BE_TRANSPORT_SHAPE`).
- New: `sql-text-only` and `no-query-builder` (R36 `BE_SQL_OUTSIDE_PERSISTENCE`). Removed: `sql-only-in-repository` (a `*.repository.ts` no longer exists; slot `be.persistence` allows `<name>.sql.ts` and `<name>.rows.ts` instead).
- Changed: `no-interpolated-sql` (R68) judges the `sql` tag's substitutions by type (`SqlIdent`), drops the UPPER_SNAKE, `quoteIdent` and `sqlSetClause` allowlists, and refuses a `.query()` string built by template or `+`.
- Changed: `query-needs-limit` (R69) and `no-query-in-loop` (R77) identify the receiver by its `EntityManager` type, not its name; query-builder and raw-SQL reads are gone from both, spec files are no longer exempt, and `.query` text is judged by the machine (R86).
- Changed: `must-inject-entity-manager`, `named-entity-manager-only`, `no-injected-repository`, `no-outer-manager-in-transaction` and `no-external-call-in-transaction` (R82, R83) read types (`typeorm`, integrations, `HttpClient`, `MessagePublisher`) and slots instead of names and path patterns: the injector must be `Inject<Pascal(connection)>EntityManager` of a declared connection, property injection and a `DataSource`/`QueryRunner` outside `platform/database` and the migrate app are refused, `TypeOrmModule.forFeature` is refused, and specs get the same law.
- Changed: `lib/types.mjs` origins include a type's alias declaration and its own symbol (new `originsOfType`), so an alias over a generic type hides nothing; new `lib/persistence.mjs` holds the connection and injection-site helpers.

- Breaking: `must-deep-module-import` is renamed `import-owner-entry` (BE-CONVENTION 2.4); the old name is deleted. A cross-owner import targets the owner's `index.ts`; a same-owner import is relative and never goes through the own `index.ts`. Owners are asked of the HFS slots and aliases of the program's `compilerOptions.paths`, so `no-self-module-alias` and `no-relative-capability-escape` no longer read a path pattern.
- Breaking: `no-folder-reexport` refuses a nested `index.ts` (an index that is not at its owner's root) and an index that holds anything but named `export { } from` lines; its `maxExports` option and the `*_STORE` and types-folder name checks are gone (the budget is the slot's `indexExports`).
- Breaking: `no-ambient-clock` (R79) refuses every reference, not only calls, to `Date.now`, a zero-argument `new Date()`, `Date()`, `performance.now`, `process.hrtime` and `Temporal.Now` (also through `globalThis`, a destructured alias or a `node:perf_hooks` / `node:process` import), and specs are no longer exempt; only the `platform/clock` owner may read them.
- Breaking: `inbox-dedupe-required` (R80) is rewritten type-aware. In a `*.consumer.ts` of slot `be.transport.message` (every public method) and under `@Public({ reason: PublicReason.SignedWebhook })` (read by the enum member's type) the first awaited expression must be `claim(source, eventId)` on a receiver typed as the `Inbox` port of `platform/inbox`, followed by an early return when it answers `false`. The keyword, decorator-name and class-name matching is deleted.
- Breaking: `no-hand-rolled-retry` (R81) keeps the loop + catch (or `.catch`) + wait shape but judges the wait by owner and type: `setTimeout`, a `node:timers` import, or a call resolving to a function declared outside `platform/retry` whose body waits; the names `sleep/delay/wait/backoff` no longer decide anything. `for...of` and `for...in` loops are covered and specs are not exempt.
- Breaking: `no-secret-in-log`, `no-interpolated-log-message`, `no-error-wording-as-log-identity` and `no-framework-logger` (R40/R71) identify the logger by the `Logger` port type of `platform/logging`, not by receiver or method names. A log call's first argument must be a member of an enum declared in an owner's `<owner>.log-events.ts`; `no-secret-in-log` refuses a `Secret` (`platform/config`) or `Pii` (`identity`) value, or a value read out of one, and keeps the key-name list as its second half; `no-framework-logger` also refuses `ConsoleLogger`, a class extending the Nest logger and a namespace-imported `new common.Logger()`. The `standaloneProgramGlobs` export (an exemption list) is deleted.
- Breaking: `no-runtime-schema` (R34) requires the literal `synchronize: false` in every DataSource or TypeORM options object (found by its contextual `typeorm` type), refuses `new DataSource(<not an object literal>)`, bans `migrationsRun` in any form and detects DDL (`CREATE|ALTER|DROP` of a table, index, type, schema, view, ...; `TRUNCATE TABLE`; `ADD|DROP COLUMN`) in any string outside the `migrations/` folder of slot `be.persistence`.
- Breaking: `no-entity-in-contract` (R37) is type-aware: any type whose declaration carries `typeorm`'s `@Entity`, reached directly or through type arguments and properties, from a transport signature, a handler `execute`, a `*.contracts.ts`, `*.command.ts` or `*.query.ts`; and entity files importing `@nestjs/graphql` or `class-validator`. The `*Entity` name test is deleted.
- Changed: `user-copy-through-catalog` (R78) judges error classes by the constructed type extending `Error` (not a `*Error` name) and outbound ports by the receiver's type (declared by an `integrations` owner or `platform/messaging`, not the method names `notify/send/publish`); transport slots come from the slot view.
- Changed: `http-needs-timeout` receivers are identified by type (`AxiosInstance`, `AxiosStatic`, `HttpService`), not by name. `async-needs-await`, `json-parse-needs-guard`, `sql-only-in-repository` and `migration-down-reversible` ask the slot view instead of a path pattern, and none of the R70/R73/R76/R78/R79/R81 rules exempts specs any more.

## 1.8.1 - 2026-09-30 (hotfix off 1.8.0, branch release/canon-be-1.8)

- New: `no-entity-manager-wrapper` (R36): an EntityManager wrapper class outside a service or handler, and an exported function taking an EntityManager first, are findings (the renamed-repository loophole). 2.0.0 carries the structural form as `no-repository-class` (R83).

## 1.8.0 - 2026-09-30 (hotfix off 1.7.1, branch release/canon-be-1.8)

- Breaking: `sql-only-in-repository` removed; `sql-text-only` (R36) allows raw SQL text only in a `<name>.sql.ts` (including `src/tests/fixtures/builders/<area>.sql.ts`); `.query(...)` elsewhere takes an imported constant; `createQueryBuilder` refused; migrations exempt. 2.0.0 keeps the id with the typed `SqlText` check.
- New: `no-repository-file`: a `*.repository.ts` file is a finding (2.0.0 refuses the suffix through R89 as well).

## 1.7.1 - 2026-09-30

- Fixed: eslint no longer fails to start in a product repository with `HFS slot manifest not found at <repo>/knowledge/hfs/slots.yaml`. `lib/slots.mjs` used to look for the manifest at a path above the package (the product repository, or a linked runtime copy that no longer exists). The package now depends on `@starci/hfs` and resolves the manifest and the YAML reader as `@starci/hfs/runtime/knowledge/hfs/slots.yaml` and `@starci/hfs/runtime/engine/yaml.mjs`, so what the canon reads travels with the installed packages. `STARCI_HFS_SLOTS` still overrides the manifest file.

## 1.7.0 - 2026-09-30

- New: `named-entity-manager-only` (R83 `BE_UNNAMED_DATA_ACCESS`, in `data-access`): a bare `@InjectEntityManager()` with no connection argument, any `.getRepository(...)` call (on a DataSource, an EntityManager or a transaction manager) and an injected `DataSource` (a constructor parameter typed `DataSource`, `@InjectDataSource()`, `@InjectConnection()`) are refused. A `DataSource` is allowed only under `platform/database/` or `platform/databases/` (also `platform/db`, `platform/datasource`, `platform/typeorm`) and `apps/migrate/`; spec files are skipped. The message says to inject the shared EntityManager with the named injector and call it directly.
- Changed: `no-injected-repository` now refuses `@InjectRepository(...)` wherever it is written (a property or a method parameter, not only a constructor parameter), and its message states the same one pattern.

## 1.6.1 - 2026-09-30

- Fixed: `inbox-dedupe-required` (R80 `BE_INBOX_DEDUPE_MISSING`) no longer relies only on `<event>.consumer.ts` under `transport/message/` to recognize a consumer. A method decorated `@EventPattern`, `@MessagePattern`, `@OnEvent` or `@Process`, or a class whose name ends `Consumer` or `OutboxConsumer`, is now a consumer wherever the file sits. The producer half of an outbox (typically `*-outbox.service.ts` / `*OutboxService`, which reads pending rows and publishes) carries none of those shapes and stays unflagged unless it also consumes.

## 1.6.0 - 2026-09-30

Round 3 back-end rules (catalog R78 to R82), each with RuleTester specs and a why code in `modules/kernel/failure-codes.yaml`.

- New: `user-copy-through-catalog` (R78 `BE_USER_COPY_LITERAL`, new law `user-copy`): a literal exception message, a `subject`/`title`/`body`/`text`/`message` property of a `notify`/`send`/`publish` call, or a `message`/`description`/`title` property of a `transport/` response comes from the per-capability messages catalog through the typed `MessageCatalog` port; a short code-shaped literal (`UPPER_SNAKE`, a bare word) and a template literal are left alone. `no-ambient-clock` (R79 `BE_AMBIENT_CLOCK`, new law `temporal`): `Date.now()`, a bare `new Date()` and `performance.now()` are read only inside `platform/clock`; `new Date(value)` built from a value the caller already holds is exempt. `inbox-dedupe-required` (R80 `BE_INBOX_DEDUPE_MISSING`, new law `idempotency`): a `@Public()` webhook controller and an outbox/queue consumer (`<event>.consumer.ts`) show a reference to an inbox or dedupe port before they act. `no-hand-rolled-retry` (R81 `BE_HAND_ROLLED_RETRY`, in `resilience`): a `for`, `while` or `do...while` loop that both catches an error and calls something shaped like a delay (`sleep`, `delay`, `wait`, `backoff`, `setTimeout`) goes through `platform/retry`; a polling loop with no `catch` is exempt, same as `no-query-in-loop` exempts a polling `while`. `no-external-call-in-transaction` (R82 `BE_TRANSACTION_EXTERNAL_CALL`, in `data-access`): `fetch`, an HTTP client call or any method of a `*Client`/`*Sdk` receiver does not run inside `.transaction(async (tx) => ...)`.
- Slot manifest (`knowledge/hfs/slots.yaml`, no version bump, additions stamped `since: 1.0.0`): `be.domain.messages` (`src/modules/{domain,integrations}/<capability>/messages/`) and `be.feature.messages` (`src/features/<feature>/messages/`), each an optional per-capability or per-feature vi/en catalog; `be.platform`'s required instances gain `clock` (the injected `Clock` port) and `i18n` (the `MessageCatalog` port); `be.domain` and `be.feature` allow a `messages/` folder.
- Deferred (owner ruling, no rule): floating promises; core `no-await-in-loop` is not adopted.

## 1.5.0 - 2026-09-30

- New: `no-query-in-loop` (R77 `BE_QUERY_IN_LOOP`): a repository, entity-manager or query-builder read (`find`, `findOne`, `count`, `getOne`, a raw `SELECT`) inside a `for`, `for...of`, `for...in` or an array `map`, `forEach`, `flatMap`, `filter`, `reduce`, `some` or `every` callback is one round trip per element (N+1). A polling `while` loop and a write per element are not reported.

## 1.4.0 - 2026-09-30

Round 2 back-end rules (catalog R42, R68 to R76). Every rule below has RuleTester specs and a why code in `modules/kernel/failure-codes.yaml`; each was measured against nivo-backend, starci-next and mia-mia-backend before it shipped and is on at `error`.

- New: `no-interpolated-sql` (R68: SQL text carries no runtime substitution; a constant column list, a `${n}` placeholder, `quoteIdent(...)`, `sqlSetClause(...)` and a ternary of fixed strings are the only substitutions), `query-needs-limit` (R69: `getMany`, `getRawMany`, `find`, `findBy` and a raw `SELECT` state a bound; a lookup by `id` and an aggregate are exempt), `http-needs-timeout` (R70: `fetch` carries a `signal`, axios and HttpService calls carry `timeout` or `signal`, `axios.create` a `timeout`), `no-secret-in-log` (R71: a logger call names no credential and no personal identifier), `no-never-cast` and `no-non-null-assertion` (R72), `async-needs-await` (R73: an `async` function that never awaits; a class that extends or implements, a decorated method and a generator are exempt), `migration-down-reversible` (R74: `down()` exists, is not empty and is not a bare throw), `explicit-handler-return-type` (R75), `json-parse-needs-guard` (R76), and `dto-needs-validator` (R42: every property of an input class carries a `class-validator` decorator).
- New laws: `query-safety`, `resilience`, `log-safety`, `async-discipline`, `input-bounds`; `type-safety` and `schema-authority` gain rules.

## 1.3.0 - 2026-09-29

HFS back-end rules (catalog R18, R20, R34, R36-R38, R40-R45, R48). Every rule below has RuleTester specs and a why code in `modules/kernel/failure-codes.yaml`.

- New: `catch-must-account` (R40), `error-home` (R38), `no-runtime-schema` (R34), `sql-only-in-repository` (R36), `no-entity-in-contract` (R37), `no-untyped-body` and `public-needs-reason` (R41), `no-direct-env-read` (R43), `no-secret-default` (R44), `secret-compare-timing-safe` (R41), `global-module-allowlist`, `typed-module-definition`, `static-module-register`, `no-new-injectable`, `no-module-let`, `one-module-per-file` (R45), `no-inline-suppression` (R18), `file-size-growth` (R20 ratchet; the soft budget is a hfs check report item, not a lint warning), `spec-no-source-read` and `spec-typed-doubles` (R48).
- Fixed: `import-owner-entry` (then under an older name) now holds the HFS owner surface. An aliased import names the owner and stops (`@modules/domain/plan`, `@features/api/plan`, or the explicit `/index`); a path into a file of another owner is refused, and a tier-only or root alias still is. The retired `lib` tier no longer counts as a tier. `no-folder-reexport` accepts a named `index.ts` surface (`export { X } from "./x"`, `export type { T } from "./contracts"`), and refuses `export *`, a `*_STORE` token, a whole `types` folder and an entry wider than the manifest's `indexExports` (60). Both are on again in `starciBeConfig`.
- Removed: no rule is off. The retired-rule list (`RETIRED`) and its export are gone, and so are the rules it switched off: `exception-name-ends-in-exception`, `exception-code-matches-class-name`, `exception-metadata-type-named-for-class`, `exception-extends-abstract`, `exception-in-errors-folder`, `require-exception-object-arg`, `throw-abstract-exception` (the Academy `AbstractException` family, replaced by `error-home`), `no-handler-encoded-failure` (expected refusals are typed unions), `handler-has-twin-spec`, `no-self-global-module` (replaced by `global-module-allowlist`), `no-line-suppression` and `require-vn-ok-reason` (replaced by `no-inline-suppression`), and the `vn-ok` exemption of `no-non-ascii-source`.
- `starciBeConfig` refuses a recommendation that carries an `off`.
- Slot parameters (the `@Global()` allowlist, the file line budget, the `index.ts` width) are read through `lib/slots.mjs` from `knowledge/hfs/slots.yaml` (`ruleParams.be.globalModules`, `ruleParams.be.fileLines.{soft,hardGrowth}`, and the `indexExports` budget of a `be.*` slot), with the rule catalog's values as the fallback.

## 1.2.3 — 2026-09-29

- `starciBeConfig({ sources, plugin, recommended })`, `linterOptions` and `RETIRED` are exported. The factory returns the one flat-config block a repository needs: the canon owns the retired-rule list (checked against the code-pattern manifest) and the warn-to-error lift, so a repository no longer hand-copies `replacedByChecks`.
- `harness-calls-provider-directly` applies only to model harnesses, identified by an LLM provider SDK import, a house model helper or gateway symbol, or a `@harness-kind model` comment - never by the `src/tests/e2e/live/` folder. A live e2e for an identity provider (Keycloak) or any other third party is no longer reported as a model harness with no LLM SDK.

## 1.2.2 — 2026-09-29

- Align module aliases and explicit public `index.ts` exports with HFS capability boundaries. Keep self-aliases, tier-only aliases, folder re-exports, and export-star public entries invalid.
- Accept concrete exceptions in their owning module or feature `errors/` directory, and accept the shared `AbstractException` declaration at its capability root.
- Classify a `.spec.ts` beside its subject in an HFS `src/tests` category as a colocated structural spec. Ordinary unit specs without an adjacent subject remain invalid in test buckets; model-quality harness checks remain in force.
